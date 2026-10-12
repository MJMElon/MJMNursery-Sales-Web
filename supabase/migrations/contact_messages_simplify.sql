-- ================================================================
-- MJM Salesweb -- Contact Us form, simplified
-- Run in the Supabase SQL Editor AFTER contact_messages.sql.
-- Safe to run more than once.
-- ================================================================
--
-- The form now asks for two topics only, Order Matters and Other
-- Enquiries, and the email address became optional (name and phone
-- are required). This replaces salesweb_submit_message() to match.
-- Without it an Order Matters message would be saved under Other
-- Enquiries and lose its place at the top of the Messages tab, and a
-- message with no email would be refused.
-- Messages already saved are not touched.
-- ================================================================

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

NOTIFY pgrst, 'reload schema';

-- ── Check ──────────────────────────────────────────────────────
-- Three rows, each should read ok. Nothing is saved by this check.
SELECT 'submit function updated' AS item,
       CASE WHEN position('Order Matters' IN prosrc) > 0 THEN 'ok' ELSE 'OLD VERSION STILL INSTALLED' END AS result
  FROM pg_proc WHERE proname = 'salesweb_submit_message' AND pronamespace = 'public'::regnamespace
UNION ALL
SELECT 'email optional',
       CASE WHEN position('v_email <> ' IN prosrc) > 0 THEN 'ok' ELSE 'NO - email still required' END
  FROM pg_proc WHERE proname = 'salesweb_submit_message' AND pronamespace = 'public'::regnamespace
UNION ALL
SELECT 'website can submit',
       CASE WHEN has_function_privilege('anon',
              'public.salesweb_submit_message(text,text,text,text,text,text,text)', 'EXECUTE')
            THEN 'ok' ELSE 'NOT GRANTED' END;
