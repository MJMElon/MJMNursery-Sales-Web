-- Read-side RPCs so admin-portal users can render the payment ledger and
-- credit bills lists even when their profile doesn't satisfy the RLS
-- SELECT policy on the underlying tables. Both functions are
-- SECURITY DEFINER and re-check the admin-portal gate inside so a
-- non-admin can't call them directly to leak data.
--
-- Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION public.list_order_payments(p_order_id UUID)
RETURNS TABLE (
  id              UUID,
  paid_at         TIMESTAMPTZ,
  amount          NUMERIC,
  note            TEXT,
  attachment_url  TEXT,
  attachment_name TEXT,
  created_by      TEXT
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
  ) THEN RAISE EXCEPTION 'Not authorised — admin portal access required.'; END IF;

  RETURN QUERY
    SELECT p.id, p.paid_at, p.amount, p.note,
           p.attachment_url, p.attachment_name, p.created_by
    FROM   salesweb_order_payments p
    WHERE  p.order_id = p_order_id
    ORDER  BY p.paid_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_order_payments(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_order_payments(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_credit_bills(p_order_id UUID)
RETURNS TABLE (
  id          UUID,
  bill_date   DATE,
  qty         NUMERIC,
  amount      NUMERIC,
  invoice_no  TEXT,
  created_at  TIMESTAMPTZ
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
  ) THEN RAISE EXCEPTION 'Not authorised — admin portal access required.'; END IF;

  RETURN QUERY
    SELECT b.id, b.bill_date, b.qty, b.amount, b.invoice_no, b.created_at
    FROM   salesweb_credit_bills b
    WHERE  b.order_id = p_order_id
    ORDER  BY b.bill_date ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_credit_bills(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_credit_bills(UUID) TO authenticated;
