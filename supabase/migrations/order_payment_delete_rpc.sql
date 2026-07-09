-- Deleting a payment entry via a direct client DELETE is subject to
-- RLS on salesweb_order_payments — same failure mode the read + write
-- paths had. Ship a SECURITY DEFINER RPC that mirrors the admin gate
-- so the delete works for every admin-portal user regardless of
-- whether their profile satisfies the row-level policy directly.
--
-- Also refreshes the order's amount_paid via the ledger trigger and
-- rolls status back if it had auto-flipped to 'Paid' but the deletion
-- pushes the paid total below the order total.
--
-- Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION public.delete_order_payment(p_payment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id     UUID;
  v_paid_sum     NUMERIC := 0;
  v_order_total  NUMERIC := 0;
  v_current_stat TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN RAISE EXCEPTION 'Not authorised — admin portal access required.'; END IF;

  SELECT order_id INTO v_order_id
    FROM salesweb_order_payments WHERE id = p_payment_id;
  IF v_order_id IS NULL THEN RETURN; END IF;

  DELETE FROM salesweb_order_payments WHERE id = p_payment_id;

  -- If the auto-Paid status flip in save_order_payment fired on the
  -- back of this row, roll status back so the order accurately shows
  -- "Partially Paid" / "Pending Payment" again.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid_sum
    FROM salesweb_order_payments WHERE order_id = v_order_id;
  SELECT COALESCE(total, 0), status INTO v_order_total, v_current_stat
    FROM salesweb_customer_orders WHERE id = v_order_id;

  IF v_current_stat = 'Paid' AND v_paid_sum < v_order_total THEN
    UPDATE salesweb_customer_orders
       SET status     = CASE WHEN v_paid_sum > 0 THEN 'Partially Paid' ELSE 'Pending Payment' END,
           updated_at = now()
     WHERE id = v_order_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_order_payment(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.delete_order_payment(UUID) TO authenticated;
