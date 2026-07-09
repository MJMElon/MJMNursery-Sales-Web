-- Ties every payment ledger row to a specific credit bill via bill_id
-- so the order-modal UI can render per-invoice paid amounts and flip
-- each bill's action cell to "Fully Paid" once its cumulative payments
-- reach its amount. Nulls allowed (legacy / order-wide payments show
-- as "Unlinked" in the UI).
--
-- Also updates save_order_payment + list_order_payments to accept /
-- return the new bill_id column.
--
-- Idempotent — safe to re-run.

ALTER TABLE salesweb_order_payments
  ADD COLUMN IF NOT EXISTS bill_id UUID REFERENCES salesweb_credit_bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_payments_bill ON salesweb_order_payments(bill_id);

-- Refresh save_order_payment with the extra p_bill_id parameter. Same
-- SECURITY DEFINER gate; same auto-flip-to-Paid behaviour.
CREATE OR REPLACE FUNCTION public.save_order_payment(
  p_order_id        UUID,
  p_paid_at         TIMESTAMPTZ,
  p_amount          NUMERIC,
  p_note            TEXT DEFAULT NULL,
  p_attachment_url  TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL,
  p_created_by      TEXT DEFAULT NULL,
  p_bill_id         UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id           UUID;
  v_paid_sum     NUMERIC := 0;
  v_order_total  NUMERIC := 0;
  v_current_stat TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated — sign in to record a payment.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN RAISE EXCEPTION 'Not authorised — admin portal access required.'; END IF;

  INSERT INTO salesweb_order_payments (
    order_id, paid_at, amount, note,
    attachment_url, attachment_name, created_by, bill_id
  ) VALUES (
    p_order_id, p_paid_at, p_amount, p_note,
    p_attachment_url, p_attachment_name, COALESCE(p_created_by, auth.jwt()->>'email'),
    p_bill_id
  )
  RETURNING id INTO v_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid_sum
    FROM salesweb_order_payments WHERE order_id = p_order_id;
  SELECT COALESCE(total, 0), status INTO v_order_total, v_current_stat
    FROM salesweb_customer_orders WHERE id = p_order_id;
  IF v_paid_sum >= v_order_total AND v_order_total > 0
     AND v_current_stat NOT IN ('Paid','Ready for Collection','Completed','Cancelled','Refunded') THEN
    UPDATE salesweb_customer_orders
       SET status = 'Paid', updated_at = now()
     WHERE id = p_order_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_order_payment(UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.save_order_payment(UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID) TO authenticated;

-- Refresh list_order_payments to return bill_id so the UI can bucket
-- per invoice.
CREATE OR REPLACE FUNCTION public.list_order_payments(p_order_id UUID)
RETURNS TABLE (
  id              UUID,
  bill_id         UUID,
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
    SELECT p.id, p.bill_id, p.paid_at, p.amount, p.note,
           p.attachment_url, p.attachment_name, p.created_by
    FROM   salesweb_order_payments p
    WHERE  p.order_id = p_order_id
    ORDER  BY p.paid_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_order_payments(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.list_order_payments(UUID) TO authenticated;
