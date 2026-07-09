-- ════════════════════════════════════════════════════════════════════════
-- Migration: attach_do_to_order — DO PDFs land on the customer's order
-- ----------------------------------------------------------------------------
-- WHY:
--   The Barcode Counter / scan app issues Delivery Orders into
--   shared_do_records keyed by al_number, and (for Sales Web orders) the AL
--   number IS the order number (see ensure_al_trigger.sql). The customer
--   portal renders per-order documents from salesweb_order_attachments, so
--   an issued DO should surface there automatically — but the barcode staff
--   user has no RLS path into salesweb_* tables (they are neither the
--   customer nor a salesweb admin).
--
-- WHAT THIS ADDS:
--   * SECURITY DEFINER function attach_do_to_order(...) that resolves the
--     Sales Web order from the AL number (directly, or via
--     shared_al_orders.order_number), then idempotently inserts one
--     salesweb_order_attachments row for the uploaded DO PDF plus a
--     salesweb_order_timeline entry. Returns true when the attachment row
--     landed (false = no matching order, e.g. a manual AL, or already
--     attached).
--   * file_size column on salesweb_order_attachments if it is missing
--     (the admin UI already renders it when present).
--
-- The PDF file itself is uploaded by the barcode app into the existing
-- public `order-attachments` bucket (authenticated INSERT is already
-- allowed by order_attachments_bucket.sql) — this function only records
-- the metadata row the portals read.
--
-- Idempotent — safe to re-run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE salesweb_order_attachments
  ADD COLUMN IF NOT EXISTS file_size BIGINT;

CREATE OR REPLACE FUNCTION public.attach_do_to_order(
  _al_number   text,
  _do_number   text,
  _file_name   text,
  _file_url    text,
  _file_size   bigint DEFAULT NULL,
  _uploaded_by text   DEFAULT 'barcode-counter'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _order_no text;
  _order_id uuid;
BEGIN
  IF COALESCE(_al_number, '') = '' OR COALESCE(_do_number, '') = ''
     OR COALESCE(_file_url, '') = '' THEN
    RETURN false;
  END IF;

  -- AL number normally equals the Sales Web order number; fall back to the
  -- AL row's explicit order_number link when they differ.
  SELECT COALESCE(NULLIF(order_number, ''), _al_number)
    INTO _order_no
    FROM shared_al_orders
   WHERE al_number = _al_number
   LIMIT 1;
  _order_no := COALESCE(_order_no, _al_number);

  SELECT id INTO _order_id
    FROM salesweb_customer_orders
   WHERE order_number = _order_no
   LIMIT 1;

  -- Manual ALs / walk-in sales have no Sales Web order — nothing to attach.
  IF _order_id IS NULL THEN
    RETURN false;
  END IF;

  -- Already attached (same DO re-synced / re-printed)? Done.
  IF EXISTS (
    SELECT 1 FROM salesweb_order_attachments
     WHERE order_id = _order_id AND file_url = _file_url
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO salesweb_order_attachments
    (order_id, file_name, file_url, file_type, file_size, uploaded_by)
  VALUES
    (_order_id, COALESCE(NULLIF(_file_name, ''), 'Delivery Order ' || _do_number || '.pdf'),
     _file_url, 'application/pdf', _file_size, COALESCE(NULLIF(_uploaded_by, ''), 'barcode-counter'));

  INSERT INTO salesweb_order_timeline (order_id, status, note, changed_by)
  VALUES (_order_id, 'DO Issued',
          'Delivery Order ' || _do_number || ' issued via barcode counter',
          COALESCE(NULLIF(_uploaded_by, ''), 'barcode-counter'));

  RETURN true;
END;
$$;

-- Barcode staff sign in with Supabase auth, so authenticated is enough —
-- do NOT grant anon.
REVOKE ALL ON FUNCTION public.attach_do_to_order(text, text, text, text, bigint, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attach_do_to_order(text, text, text, text, bigint, text) TO authenticated;
