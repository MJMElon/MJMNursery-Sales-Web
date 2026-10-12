-- ================================================================
-- MJM Salesweb -- Contact Us messages and complaints
-- Run in the Supabase SQL Editor (main project kibqjztozokohqmhqqqf).
-- Safe to run more than once.
-- ================================================================
--
-- Until now the Contact Us form on the storefront said Message Sent
-- and threw the message away. Nothing was saved and nothing was sent.
-- This file gives every message somewhere to land.
--
--   salesweb_messages              one row per message, with a
--                                  reference number like MSG-00042
--   salesweb_message_events        the history of each case. Status
--                                  changes, assignments, WhatsApp
--                                  sends and internal notes. Staff only,
--                                  the customer never sees this table.
--   salesweb_message_handlers      the people a case can be assigned
--                                  to, with the WhatsApp number they
--                                  will use to contact the customer
--   salesweb_message_notify_emails who gets an email for a new message
--   contact-message-photos         private storage bucket for photos
--
-- How each side reaches it
--   The storefront never writes the table directly. It calls
--   salesweb_submit_message(), which checks the input, limits one email
--   address to 5 messages an hour, stamps the logged-in customer (if
--   any) and hands back the reference number.
--   A logged-in customer reads their own messages through
--   salesweb_my_messages(), which returns only the columns meant for
--   them.
--   Salesweb staff (admin or normal) read and update everything through
--   the Messages tab, gated by the same _mjm_has_module check as the
--   rest of salesweb.
--
-- The status and assignment history is written by a TRIGGER, not by
-- the screen, so a change made anywhere is recorded the same way.
-- ================================================================

CREATE SEQUENCE IF NOT EXISTS public.salesweb_message_ref_seq;

CREATE TABLE IF NOT EXISTS public.salesweb_message_handlers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    phone       TEXT        NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID        DEFAULT auth.uid()
);

CREATE TABLE IF NOT EXISTS public.salesweb_message_notify_emails (
    email       TEXT        PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  UUID        DEFAULT auth.uid()
);

CREATE TABLE IF NOT EXISTS public.salesweb_messages (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ref             TEXT        NOT NULL UNIQUE,
    user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    name            TEXT        NOT NULL,
    email           TEXT        NOT NULL,
    phone           TEXT        NOT NULL DEFAULT '',
    subject         TEXT        NOT NULL DEFAULT 'Other',
    kind            TEXT        NOT NULL DEFAULT 'enquiry',
    message         TEXT        NOT NULL,
    order_number    TEXT,
    photo_path      TEXT,
    status          TEXT        NOT NULL DEFAULT 'New',
    handler_id      UUID        REFERENCES public.salesweb_message_handlers(id) ON DELETE SET NULL,
    assigned_name   TEXT,
    assigned_phone  TEXT,
    assigned_at     TIMESTAMPTZ,
    wa_status       TEXT,
    wa_sent_at      TIMESTAMPTZ,
    wa_detail       TEXT,
    notified_at     TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salesweb_messages_status_chk') THEN
    ALTER TABLE public.salesweb_messages ADD CONSTRAINT salesweb_messages_status_chk
      CHECK (status IN ('New','In Progress','Resolved','Closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salesweb_messages_kind_chk') THEN
    ALTER TABLE public.salesweb_messages ADD CONSTRAINT salesweb_messages_kind_chk
      CHECK (kind IN ('enquiry','complaint'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS salesweb_messages_created_idx ON public.salesweb_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS salesweb_messages_user_idx    ON public.salesweb_messages (user_id);
CREATE INDEX IF NOT EXISTS salesweb_messages_email_idx   ON public.salesweb_messages (lower(email), created_at);

CREATE TABLE IF NOT EXISTS public.salesweb_message_events (
    id          BIGSERIAL   PRIMARY KEY,
    message_id  UUID        NOT NULL REFERENCES public.salesweb_messages(id) ON DELETE CASCADE,
    kind        TEXT        NOT NULL DEFAULT 'note',
    body        TEXT        NOT NULL DEFAULT '',
    actor_id    UUID        DEFAULT auth.uid(),
    actor_name  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS salesweb_message_events_msg_idx ON public.salesweb_message_events (message_id, created_at);

-- ── Who is staff ───────────────────────────────────────────────
-- One place that answers it, used by every policy below and by the
-- send-case-whatsapp edge function.
CREATE OR REPLACE FUNCTION public.salesweb_is_message_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public._mjm_has_module('salesweb', ARRAY['admin','normal']), FALSE)
$$;
GRANT EXECUTE ON FUNCTION public.salesweb_is_message_staff() TO authenticated;

-- ── Name of whoever is making a change ─────────────────────────
CREATE OR REPLACE FUNCTION public.salesweb_actor_name(p_uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(NULLIF(u.raw_user_meta_data ->> 'full_name', ''), u.email, 'System')
    FROM auth.users u WHERE u.id = p_uid
$$;

-- ── History trigger ────────────────────────────────────────────
-- Every status change, assignment and order number change writes an
-- event row.
-- Also keeps updated_at, resolved_at and assigned_at honest.
CREATE OR REPLACE FUNCTION public.salesweb_messages_track()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_name TEXT := COALESCE(public.salesweb_actor_name(auth.uid()), 'System');
BEGIN
  NEW.updated_at := NOW();

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('Resolved','Closed') AND OLD.status NOT IN ('Resolved','Closed') THEN
      NEW.resolved_at := NOW();
    ELSIF NEW.status NOT IN ('Resolved','Closed') THEN
      NEW.resolved_at := NULL;
    END IF;
    INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
    VALUES (NEW.id, 'status', OLD.status || ' to ' || NEW.status, v_uid, v_name);
  END IF;

  IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
    VALUES (NEW.id, 'order',
            CASE WHEN NEW.order_number IS NULL THEN 'Order number removed'
                 ELSE 'Order linked: #' || NEW.order_number END,
            v_uid, v_name);
  END IF;

  IF NEW.assigned_name IS DISTINCT FROM OLD.assigned_name
     OR NEW.assigned_phone IS DISTINCT FROM OLD.assigned_phone THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_name IS NULL THEN NULL ELSE NOW() END;
    INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
    VALUES (NEW.id, 'assign',
            CASE WHEN NEW.assigned_name IS NULL THEN 'Unassigned'
                 ELSE 'Assigned to ' || NEW.assigned_name || COALESCE(' (' || NEW.assigned_phone || ')', '') END,
            v_uid, v_name);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS salesweb_messages_track_trg ON public.salesweb_messages;
CREATE TRIGGER salesweb_messages_track_trg
  BEFORE UPDATE ON public.salesweb_messages
  FOR EACH ROW EXECUTE FUNCTION public.salesweb_messages_track();

-- ── Storefront submit ──────────────────────────────────────────
-- Callable by anybody, logged in or not. Name and phone are required,
-- email is optional. Phone digits are counted with translate() rather
-- than a pattern, so this file has no regex in it.
-- The form offers two topics, Order Matters and Other Enquiries. An Order
-- Matters message is the priority kind (stored as complaint) and stays
-- pinned on the Messages tab until somebody resolves it. Complaint and the
-- older topic names are still accepted so nothing already saved changes.
-- The hourly limit counts by email, or by phone digits when no email.
CREATE OR REPLACE FUNCTION public.salesweb_submit_message(
    p_name         TEXT,
    p_email        TEXT,
    p_phone        TEXT,
    p_subject      TEXT,
    p_message      TEXT,
    p_order_number TEXT DEFAULT NULL,
    p_photo_path   TEXT DEFAULT NULL
)
RETURNS TABLE (id UUID, ref TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name    TEXT := btrim(COALESCE(p_name, ''));
  v_email   TEXT := lower(btrim(COALESCE(p_email, '')));
  v_phone   TEXT := btrim(COALESCE(p_phone, ''));
  v_digits  TEXT;
  v_subject TEXT := btrim(COALESCE(p_subject, ''));
  v_msg     TEXT := btrim(COALESCE(p_message, ''));
  v_order   TEXT := NULLIF(btrim(COALESCE(p_order_number, '')), '');
  v_photo   TEXT := NULLIF(btrim(COALESCE(p_photo_path, '')), '');
  v_recent  INT;
  v_id      UUID;
  v_ref     TEXT;
BEGIN
  v_digits := translate(v_phone, translate(v_phone, '0123456789', ''), '');

  IF length(v_name) < 1 OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Please enter your full name.';
  END IF;
  IF length(v_digits) < 9 OR length(v_digits) > 15 THEN
    RAISE EXCEPTION 'Please enter a valid phone number.';
  END IF;
  IF v_email <> '' AND (position('@' IN v_email) < 2 OR position('.' IN split_part(v_email, '@', 2)) < 2 OR length(v_email) > 200) THEN
    RAISE EXCEPTION 'Please check your email address, or leave it empty.';
  END IF;
  IF length(v_msg) < 1 OR length(v_msg) > 5000 THEN
    RAISE EXCEPTION 'Please write your message (up to 5000 characters).';
  END IF;
  IF v_subject NOT IN ('Order Matters','Other Enquiries','Complaint',
                       'Product Enquiry','Bulk / Wholesale Order','Collection Schedule',
                       'Payment & Banking','Other') THEN
    v_subject := 'Other Enquiries';
  END IF;
  IF v_order IS NOT NULL AND length(v_order) > 60 THEN
    v_order := left(v_order, 60);
  END IF;
  IF v_photo IS NOT NULL AND left(v_photo, 9) <> 'incoming/' THEN
    v_photo := NULL;
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.salesweb_messages m
   WHERE m.created_at > NOW() - INTERVAL '1 hour'
     AND CASE WHEN v_email <> '' THEN lower(m.email) = v_email
              ELSE translate(m.phone, translate(m.phone, '0123456789', ''), '') = v_digits END;
  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'Too many messages in the last hour. Please try again later or WhatsApp us.';
  END IF;

  v_ref := 'MSG-' || lpad(nextval('public.salesweb_message_ref_seq')::TEXT, 5, '0');

  INSERT INTO public.salesweb_messages
    (ref, user_id, name, email, phone, subject, kind, message, order_number, photo_path)
  VALUES
    (v_ref, auth.uid(), v_name, v_email, v_phone, v_subject,
     CASE WHEN v_subject IN ('Order Matters','Complaint') THEN 'complaint' ELSE 'enquiry' END,
     v_msg, v_order, v_photo)
  RETURNING salesweb_messages.id INTO v_id;

  INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
  VALUES (v_id, 'created', 'Message received from the website', auth.uid(), v_name);

  RETURN QUERY SELECT v_id::UUID, v_ref::TEXT;
END $$;
GRANT EXECUTE ON FUNCTION public.salesweb_submit_message(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO anon, authenticated;

-- ── Customer portal read ───────────────────────────────────────
-- Only the columns the customer is meant to see, and only their own.
DROP FUNCTION IF EXISTS public.salesweb_my_messages();
CREATE FUNCTION public.salesweb_my_messages()
RETURNS TABLE (
    ref            TEXT,
    subject        TEXT,
    kind           TEXT,
    message        TEXT,
    order_number   TEXT,
    has_photo      BOOLEAN,
    status         TEXT,
    assigned_name  TEXT,
    assigned_phone TEXT,
    created_at     TIMESTAMPTZ,
    resolved_at    TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.ref::TEXT, m.subject::TEXT, m.kind::TEXT, m.message::TEXT, m.order_number::TEXT,
         (m.photo_path IS NOT NULL)::BOOLEAN, m.status::TEXT,
         m.assigned_name::TEXT, m.assigned_phone::TEXT,
         m.created_at::TIMESTAMPTZ, m.resolved_at::TIMESTAMPTZ
    FROM public.salesweb_messages m
   WHERE auth.uid() IS NOT NULL
     AND m.user_id = auth.uid()
   ORDER BY m.created_at DESC
$$;
GRANT EXECUTE ON FUNCTION public.salesweb_my_messages() TO authenticated;

-- ── Customer adds a case sent before signing in ─────────────────
-- A message sent as a guest belongs to nobody. A signed-in customer can
-- link it to their account with its reference AND the phone number on
-- it. References count up and could be guessed, the phone number is
-- what makes it theirs. A wrong reference and a wrong phone give the
-- same answer, so neither can be found out on its own. The reference
-- can be typed loosely (MSG-00001, msg 1, 00001).
CREATE OR REPLACE FUNCTION public.salesweb_claim_message(p_ref TEXT, p_phone TEXT)
RETURNS TABLE (result TEXT, message_ref TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_refin   TEXT := btrim(COALESCE(p_ref, ''));
  v_refnum  TEXT;
  v_ref     TEXT;
  v_phone   TEXT := COALESCE(p_phone, '');
  v_digits  TEXT;
  v_row     public.salesweb_messages%ROWTYPE;
  v_rowdig  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in first.';
  END IF;
  v_refnum := translate(v_refin, translate(v_refin, '0123456789', ''), '');
  IF v_refnum = '' OR length(v_refnum) > 9 THEN
    RAISE EXCEPTION 'Please enter the reference number, e.g. MSG-00001.';
  END IF;
  v_ref := 'MSG-' || lpad((v_refnum::BIGINT)::TEXT, 5, '0');
  v_digits := translate(v_phone, translate(v_phone, '0123456789', ''), '');
  IF length(v_digits) < 9 THEN
    RAISE EXCEPTION 'Please enter the phone number you used on that message.';
  END IF;

  SELECT * INTO v_row FROM public.salesweb_messages m WHERE m.ref = v_ref;
  v_rowdig := translate(COALESCE(v_row.phone, ''), translate(COALESCE(v_row.phone, ''), '0123456789', ''), '');
  IF NOT FOUND OR length(v_rowdig) < 9 OR right(v_rowdig, 9) <> right(v_digits, 9) THEN
    RAISE EXCEPTION 'We could not find a message with that reference and phone number. Please check both and try again.';
  END IF;

  IF v_row.user_id = v_uid THEN
    RETURN QUERY SELECT 'already_yours'::TEXT, v_ref::TEXT;
    RETURN;
  END IF;
  IF v_row.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'This message is already linked to another account. Please contact us on WhatsApp.';
  END IF;

  UPDATE public.salesweb_messages SET user_id = v_uid WHERE salesweb_messages.id = v_row.id;
  INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
  VALUES (v_row.id, 'linked', 'Customer added this case to their account', v_uid,
          COALESCE(public.salesweb_actor_name(v_uid), 'Customer'));

  RETURN QUERY SELECT 'linked'::TEXT, v_ref::TEXT;
END $$;
GRANT EXECUTE ON FUNCTION public.salesweb_claim_message(TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salesweb_claim_message(TEXT, TEXT) FROM anon;

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE public.salesweb_messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salesweb_message_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salesweb_message_handlers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salesweb_message_notify_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "salesweb_messages_staff_read"   ON public.salesweb_messages;
CREATE POLICY "salesweb_messages_staff_read" ON public.salesweb_messages
  FOR SELECT TO authenticated USING (public.salesweb_is_message_staff());
DROP POLICY IF EXISTS "salesweb_messages_staff_update" ON public.salesweb_messages;
CREATE POLICY "salesweb_messages_staff_update" ON public.salesweb_messages
  FOR UPDATE TO authenticated
  USING (public.salesweb_is_message_staff()) WITH CHECK (public.salesweb_is_message_staff());
DROP POLICY IF EXISTS "salesweb_messages_admin_delete" ON public.salesweb_messages;
CREATE POLICY "salesweb_messages_admin_delete" ON public.salesweb_messages
  FOR DELETE TO authenticated USING (public._mjm_has_module('salesweb', ARRAY['admin']));

DROP POLICY IF EXISTS "salesweb_message_events_staff_read"  ON public.salesweb_message_events;
CREATE POLICY "salesweb_message_events_staff_read" ON public.salesweb_message_events
  FOR SELECT TO authenticated USING (public.salesweb_is_message_staff());
DROP POLICY IF EXISTS "salesweb_message_events_staff_note"  ON public.salesweb_message_events;
CREATE POLICY "salesweb_message_events_staff_note" ON public.salesweb_message_events
  FOR INSERT TO authenticated
  WITH CHECK (public.salesweb_is_message_staff() AND kind = 'note' AND actor_id = auth.uid());

DROP POLICY IF EXISTS "salesweb_message_handlers_staff" ON public.salesweb_message_handlers;
CREATE POLICY "salesweb_message_handlers_staff" ON public.salesweb_message_handlers
  FOR ALL TO authenticated
  USING (public.salesweb_is_message_staff()) WITH CHECK (public.salesweb_is_message_staff());

DROP POLICY IF EXISTS "salesweb_message_notify_staff" ON public.salesweb_message_notify_emails;
CREATE POLICY "salesweb_message_notify_staff" ON public.salesweb_message_notify_emails
  FOR ALL TO authenticated
  USING (public.salesweb_is_message_staff()) WITH CHECK (public.salesweb_is_message_staff());

GRANT SELECT, UPDATE, DELETE         ON public.salesweb_messages              TO authenticated;
GRANT SELECT, INSERT                 ON public.salesweb_message_events        TO authenticated;
GRANT USAGE                          ON SEQUENCE public.salesweb_message_events_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salesweb_message_handlers      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salesweb_message_notify_emails TO authenticated;
REVOKE ALL ON public.salesweb_messages              FROM anon;
REVOKE ALL ON public.salesweb_message_events        FROM anon;
REVOKE ALL ON public.salesweb_message_handlers      FROM anon;
REVOKE ALL ON public.salesweb_message_notify_emails FROM anon;

-- ── Photo bucket ───────────────────────────────────────────────
-- Private. Anyone may upload into incoming/ (5 MB, images only), only
-- salesweb staff may look at what is there, and only a salesweb admin
-- may delete. The admin page opens a photo through a short signed link.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contact-message-photos', 'contact-message-photos', FALSE, 5242880,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "contact-message-photos upload" ON storage.objects;
CREATE POLICY "contact-message-photos upload" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'contact-message-photos' AND (storage.foldername(name))[1] = 'incoming');

DROP POLICY IF EXISTS "contact-message-photos staff read" ON storage.objects;
CREATE POLICY "contact-message-photos staff read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contact-message-photos' AND public.salesweb_is_message_staff());

DROP POLICY IF EXISTS "contact-message-photos admin delete" ON storage.objects;
CREATE POLICY "contact-message-photos admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'contact-message-photos' AND public._mjm_has_module('salesweb', ARRAY['admin']));

NOTIFY pgrst, 'reload schema';

-- ── Check ──────────────────────────────────────────────────────
-- Every row should read ok. The two counts at the bottom are just
-- information. Recipients is how many emails get told about a new
-- message, and is 0 until somebody adds one on the Messages tab.
SELECT 'tables' AS item,
       CASE WHEN count(*) = 4 THEN 'ok' ELSE 'MISSING - found ' || count(*) || ' of 4' END AS result
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('salesweb_messages','salesweb_message_events',
                      'salesweb_message_handlers','salesweb_message_notify_emails')
UNION ALL
SELECT 'functions',
       CASE WHEN count(DISTINCT proname) = 5 THEN 'ok' ELSE 'MISSING - found ' || count(DISTINCT proname) || ' of 5' END
  FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('salesweb_submit_message','salesweb_my_messages','salesweb_is_message_staff',
                   'salesweb_actor_name','salesweb_messages_track')
UNION ALL
SELECT 'history trigger',
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'MISSING' END
  FROM pg_trigger WHERE tgname = 'salesweb_messages_track_trg'
UNION ALL
SELECT 'row level security',
       CASE WHEN bool_and(relrowsecurity) AND count(*) = 4 THEN 'ok' ELSE 'OFF on a table' END
  FROM pg_class
 WHERE relnamespace = 'public'::regnamespace
   AND relname IN ('salesweb_messages','salesweb_message_events',
                   'salesweb_message_handlers','salesweb_message_notify_emails')
UNION ALL
SELECT 'website can submit',
       CASE WHEN has_function_privilege('anon',
              'public.salesweb_submit_message(text,text,text,text,text,text,text)', 'EXECUTE')
            THEN 'ok' ELSE 'NOT GRANTED' END
UNION ALL
SELECT 'website cannot read messages',
       CASE WHEN has_table_privilege('anon', 'public.salesweb_messages', 'SELECT')
            THEN 'WRONG - anon can read' ELSE 'ok' END
UNION ALL
SELECT 'photo bucket',
       CASE WHEN count(*) = 1 AND NOT bool_and(public) THEN 'ok' ELSE 'MISSING or public' END
  FROM storage.buckets WHERE id = 'contact-message-photos'
UNION ALL
SELECT 'messages so far', count(*)::TEXT FROM public.salesweb_messages
UNION ALL
SELECT 'notification recipients', count(*)::TEXT FROM public.salesweb_message_notify_emails;
