-- E-Invoice request tracking on customer orders.
--
-- Per policy:
--   * Personal orders < RM10,000 → e-invoice is NOT auto-issued; the
--     customer must request it within 5 calendar days of order date.
--   * Company orders or orders ≥ RM10,000 → auto-issued (no request row).
--
-- Fields on the order:
--   einvoice_requested_at — timestamp the customer clicked Request
--                           (nullable; NULL = not requested yet)
--   einvoice_uploaded_at  — timestamp accounts uploaded the PDF
--   einvoice_url          — signed / public URL of the uploaded PDF
--   einvoice_name         — original filename (e.g. INV-2026-0045.pdf)
--
-- Three RPCs handle the writes so no client key needs write access to
-- these columns directly:
--   * request_einvoice(p_order_id UUID)
--       Customer-only. Refuses if:
--         - caller isn't authenticated
--         - order doesn't belong to caller
--         - order.created_at is > 5 days ago
--         - already requested
--   * mark_einvoice_uploaded(p_order_id UUID, p_url TEXT, p_name TEXT)
--       Admin-only. Records the URL + filename + timestamp.
--   * list_einvoice_requests()
--       Admin-only. Returns every order with einvoice_requested_at set,
--       enriched with customer name/email and days-since.
--
-- Idempotent — safe to re-run.

ALTER TABLE salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS einvoice_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS einvoice_uploaded_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS einvoice_url          TEXT,
  ADD COLUMN IF NOT EXISTS einvoice_name         TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_einvoice_requested
  ON salesweb_customer_orders (einvoice_requested_at)
  WHERE einvoice_requested_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Customer request RPC
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_einvoice(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT id, customer_id, created_at, einvoice_requested_at, einvoice_uploaded_at
    INTO v_row
    FROM salesweb_customer_orders WHERE id = p_order_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF v_row.customer_id IS DISTINCT FROM auth.uid() THEN
    -- Allow admins too for admin-initiated requests.
    IF NOT EXISTS (
      SELECT 1 FROM shared_profiles sp
      WHERE  sp.id = auth.uid()
        AND  ( sp.role='admin'
               OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
    ) THEN
      RAISE EXCEPTION 'This order is not yours.';
    END IF;
  END IF;

  IF v_row.einvoice_uploaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'E-Invoice already issued for this order.';
  END IF;
  IF v_row.einvoice_requested_at IS NOT NULL THEN
    -- Idempotent — return existing timestamp.
    RETURN jsonb_build_object('ok', true, 'already', true, 'requested_at', v_row.einvoice_requested_at);
  END IF;
  IF v_row.created_at < (now() - INTERVAL '5 days') THEN
    RAISE EXCEPTION 'Request window expired — E-Invoice requests must be submitted within 5 calendar days of the order date.';
  END IF;

  UPDATE salesweb_customer_orders
     SET einvoice_requested_at = now(),
         updated_at            = now()
   WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'requested_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.request_einvoice(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_einvoice(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Admin: mark uploaded
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_einvoice_uploaded(
  p_order_id UUID,
  p_url      TEXT,
  p_name     TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN RAISE EXCEPTION 'Not authorised.'; END IF;

  UPDATE salesweb_customer_orders
     SET einvoice_uploaded_at = now(),
         einvoice_url         = p_url,
         einvoice_name        = p_name,
         updated_at           = now()
   WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_einvoice_uploaded(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_einvoice_uploaded(UUID, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- Admin: list requests (for the Payments → E-Invoice Requests tab)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_einvoice_requests()
RETURNS TABLE (
  order_id             UUID,
  order_number         TEXT,
  customer_id          UUID,
  customer_name        TEXT,
  customer_email       TEXT,
  billing_name         TEXT,
  total                NUMERIC,
  ordered_at           TIMESTAMPTZ,
  requested_at         TIMESTAMPTZ,
  uploaded_at          TIMESTAMPTZ,
  einvoice_url         TEXT,
  einvoice_name        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN RAISE EXCEPTION 'Not authorised.'; END IF;

  RETURN QUERY
    SELECT o.id, o.order_number, o.customer_id, o.customer_name, o.customer_email,
           o.billing_name, o.total, o.created_at,
           o.einvoice_requested_at, o.einvoice_uploaded_at,
           o.einvoice_url, o.einvoice_name
    FROM   salesweb_customer_orders o
    WHERE  o.einvoice_requested_at IS NOT NULL
    ORDER  BY o.einvoice_uploaded_at NULLS FIRST, o.einvoice_requested_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_einvoice_requests() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_einvoice_requests() TO authenticated;
