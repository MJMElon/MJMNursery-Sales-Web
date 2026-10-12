-- ================================================================
-- MJM Salesweb -- Contact Us, part 3. Add a Case, and Assigned To.
-- Run in the Supabase SQL Editor AFTER contact_messages.sql and
-- contact_messages_simplify.sql. Safe to run more than once.
-- ================================================================
--
-- The SQL Editor runs a paste as ONE transaction, so an error anywhere
-- undoes everything above it. The first two versions of this file both
-- ended in an error on databases without salesweb_user_tab_access, and
-- so changed nothing at all. Everything here is now written for that.
--
-- 0. salesweb_user_tab_access, the table User Access, Edit Pages saves
--    page ticks into. Its own file (salesweb_user_tab_access.sql) was
--    never run on production, so ticking Messages for a normal user
--    failed with "table is missing". This creates it exactly as that
--    file does. Until somebody saves Edit Pages for a user, that user
--    has no row and the portal keeps reading the ticks stored on their
--    profile, the same as today. Nothing changes on the day it is run.
--
-- 1. salesweb_claim_message() lets a signed-in customer add a message
--    they sent as a guest to their account, from My Account, Messages,
--    Add a Case, by its reference number.
--
-- Permissions are read with ::jsonb so the list works whether the profile
-- column is json or jsonb.
--
-- 2. Assigned To lists the portal users who may handle messages. That
--    is every salesweb admin, and every normal user with Messages ticked
--    in User Access (or with no pages set at all, which has always meant
--    every page). salesweb_message_assignees() reads that list, because a
--    normal user is not allowed to read other profiles directly. Each
--    person is offered with the WhatsApp number from their profile,
--    unless one was typed for them on the Messages tab Settings, kept in
--    salesweb_message_staff_phone.
--
-- 3. A one-off repair. Until now the Contact Us form attached a message
--    to whatever login the browser was holding, and the admin portal
--    shares that login. So a message sent from the shop by somebody
--    still signed in to the ADMIN portal was attached to the staff
--    account, not left as a guest message. The rule below unlinks every
--    message whose account is a salesweb staff account (admin or normal,
--    or the legacy admin role). Customer accounts are left alone. A
--    second run finds nothing.
-- ================================================================

-- ── 0. Page access table, as in salesweb_user_tab_access.sql ──────
CREATE TABLE IF NOT EXISTS public.salesweb_user_tab_access (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tabs        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID        REFERENCES auth.users(id)
);
ALTER TABLE public.salesweb_user_tab_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "salesweb_users_read_tab_access" ON public.salesweb_user_tab_access;
CREATE POLICY "salesweb_users_read_tab_access" ON public.salesweb_user_tab_access
    FOR SELECT TO authenticated
    USING (public._mjm_has_module('salesweb', ARRAY['admin','normal']));
DROP POLICY IF EXISTS "salesweb_admins_write_tab_access" ON public.salesweb_user_tab_access;
CREATE POLICY "salesweb_admins_write_tab_access" ON public.salesweb_user_tab_access
    FOR ALL TO authenticated
    USING      (public._mjm_has_module('salesweb', ARRAY['admin']))
    WITH CHECK (public._mjm_has_module('salesweb', ARRAY['admin']));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salesweb_user_tab_access TO authenticated;

CREATE OR REPLACE FUNCTION public.salesweb_user_tab_access_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS salesweb_user_tab_access_touch_trg ON public.salesweb_user_tab_access;
CREATE TRIGGER salesweb_user_tab_access_touch_trg
    BEFORE UPDATE ON public.salesweb_user_tab_access
    FOR EACH ROW EXECUTE FUNCTION public.salesweb_user_tab_access_touch();

-- ── 1. Customer adds a case sent before signing in ─────────────────
-- By reference number alone, as the office asked. Note that references
-- count up, so a signed-in customer who types somebody else number can
-- add that message to their own account. A message already linked to an
-- account cannot be taken by another. The reference can be typed
-- loosely (MSG-00001, msg 1, 00001).
DROP FUNCTION IF EXISTS public.salesweb_claim_message(TEXT, TEXT);
CREATE FUNCTION public.salesweb_claim_message(p_ref TEXT, p_phone TEXT DEFAULT NULL)
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
  v_row     public.salesweb_messages%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in first.';
  END IF;
  v_refnum := translate(v_refin, translate(v_refin, '0123456789', ''), '');
  IF v_refnum = '' OR length(v_refnum) > 9 THEN
    RAISE EXCEPTION 'Please enter the reference number, e.g. MSG-00001.';
  END IF;
  v_ref := 'MSG-' || lpad((v_refnum::BIGINT)::TEXT, 5, '0');

  SELECT * INTO v_row FROM public.salesweb_messages m WHERE m.ref = v_ref;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'We could not find a message with reference %. Please check the number and try again.', v_ref;
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

-- ── Assigned To ─────────────────────────────────────────────────
ALTER TABLE public.salesweb_messages ADD COLUMN IF NOT EXISTS assigned_user_id UUID;

CREATE TABLE IF NOT EXISTS public.salesweb_message_staff_phone (
    user_id     UUID        PRIMARY KEY,
    phone       TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID        DEFAULT auth.uid()
);
ALTER TABLE public.salesweb_message_staff_phone ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "salesweb_message_staff_phone_staff" ON public.salesweb_message_staff_phone;
CREATE POLICY "salesweb_message_staff_phone_staff" ON public.salesweb_message_staff_phone
  FOR ALL TO authenticated
  USING (public.salesweb_is_message_staff()) WITH CHECK (public.salesweb_is_message_staff());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salesweb_message_staff_phone TO authenticated;
REVOKE ALL ON public.salesweb_message_staff_phone FROM anon;

-- Same rule as canSeeTab() and effectiveTabs() in the admin portal. An
-- admin sees every tab. A normal user sees Messages when it is ticked, or
-- when no pages were ever saved for them. Change one, change all three.
DROP FUNCTION IF EXISTS public.salesweb_message_assignees();
CREATE FUNCTION public.salesweb_message_assignees()
RETURNS TABLE (user_id UUID, name TEXT, email TEXT, phone TEXT, phone_source TEXT, level TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.salesweb_is_message_staff() THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH staff AS (
    SELECT p.id,
           COALESCE(NULLIF(p.full_name::TEXT, ''), p.email::TEXT, 'Staff') AS nm,
           p.email::TEXT AS em,
           p.phone::TEXT AS profile_phone,
           COALESCE(p.permissions::jsonb -> 'modules' ->> 'salesweb',
                    CASE WHEN p.role::TEXT = 'admin' THEN 'admin' ELSE 'none' END) AS lvl,
           COALESCE(a.tabs::jsonb, p.permissions::jsonb -> 'salesweb_tabs') AS saved
      FROM public.shared_profiles p
      LEFT JOIN public.salesweb_user_tab_access a ON a.user_id = p.id
  )
  SELECT s.id::UUID, s.nm::TEXT, s.em::TEXT,
         COALESCE(NULLIF(sp.phone, ''), NULLIF(s.profile_phone, ''))::TEXT,
         (CASE WHEN NULLIF(sp.phone, '') IS NOT NULL THEN 'messages'
               WHEN NULLIF(s.profile_phone, '') IS NOT NULL THEN 'profile'
               ELSE 'none' END)::TEXT,
         s.lvl::TEXT
    FROM staff s
    LEFT JOIN public.salesweb_message_staff_phone sp ON sp.user_id = s.id
   WHERE s.lvl = 'admin'
      OR (s.lvl = 'normal' AND (s.saved IS NULL OR jsonb_typeof(s.saved) <> 'object'
                                OR s.saved ->> 'messages' = 'true'))
   ORDER BY s.nm;
END $$;
GRANT EXECUTE ON FUNCTION public.salesweb_message_assignees() TO authenticated;

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

NOTIFY pgrst, 'reload schema';

-- ── Repair and check ───────────────────────────────────────────
-- Five rows. The first three should read ok. The fourth lists, by name,
-- the portal users Assigned To will offer, with the WhatsApp number each
-- will be offered with, or no phone (type one on the Messages tab
-- Settings). NOBODY there means no user has Messages access. The fifth
-- lists the references unlinked from a staff account (your own test
-- messages), or none. Run it again and the fifth row reads none.
WITH unlinked AS (
  UPDATE public.salesweb_messages m
     SET user_id = NULL
    FROM public.shared_profiles p
   WHERE p.id = m.user_id
     AND (p.role::TEXT = 'admin'
          OR COALESCE(p.permissions::jsonb -> 'modules' ->> 'salesweb', 'none') IN ('admin', 'normal'))
  RETURNING m.ref
)
SELECT 'add a case function' AS item,
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'MISSING' END AS result
  FROM pg_proc WHERE proname = 'salesweb_claim_message' AND pronamespace = 'public'::regnamespace
UNION ALL
SELECT 'signed-in customers can use it',
       CASE WHEN has_function_privilege('authenticated', 'public.salesweb_claim_message(text,text)', 'EXECUTE')
            THEN 'ok' ELSE 'NOT GRANTED' END
UNION ALL
SELECT 'assigned to column',
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'MISSING' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'salesweb_messages' AND column_name = 'assigned_user_id'
UNION ALL
SELECT 'Assigned To will list',
       COALESCE(string_agg(nm || CASE WHEN ph IS NULL THEN ' (no phone)' ELSE ' (' || ph || ')' END, ', ' ORDER BY nm), 'NOBODY')
  FROM (
    SELECT COALESCE(NULLIF(p.full_name::TEXT, ''), p.email::TEXT, 'Staff') AS nm,
           COALESCE(NULLIF(sp.phone, ''), NULLIF(p.phone::TEXT, '')) AS ph,
           COALESCE(p.permissions::jsonb -> 'modules' ->> 'salesweb',
                    CASE WHEN p.role::TEXT = 'admin' THEN 'admin' ELSE 'none' END) AS lvl,
           COALESCE(a.tabs::jsonb, p.permissions::jsonb -> 'salesweb_tabs') AS saved
      FROM public.shared_profiles p
      LEFT JOIN public.salesweb_user_tab_access a ON a.user_id = p.id
      LEFT JOIN public.salesweb_message_staff_phone sp ON sp.user_id = p.id
  ) x
 WHERE lvl = 'admin'
    OR (lvl = 'normal' AND (saved IS NULL OR jsonb_typeof(saved) <> 'object' OR saved ->> 'messages' = 'true'))
UNION ALL
SELECT 'unlinked from a staff account',
       COALESCE((SELECT string_agg(ref, ', ' ORDER BY ref) FROM unlinked), 'none');
