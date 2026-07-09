-- Two features in one paste:
--   1. Auto-flip order status to 'Paid' whenever a payment reaches the
--      order total. Applied inside save_order_payment (SECURITY DEFINER).
--   2. Per-order credit-bill ledger. Admin can key in one or many bill
--      entries per credit order (date, qty, amount, invoice_no), each
--      row is editable / deletable, and the parent order's
--      credit_billed_at flips ON only once the cumulative billed amount
--      reaches the order total.
--
-- All installs are idempotent — safe to re-run.

-- ─── 1. Credit-bill ledger table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS salesweb_credit_bills (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     UUID NOT NULL REFERENCES salesweb_customer_orders(id) ON DELETE CASCADE,
  bill_date    DATE NOT NULL,
  qty          NUMERIC(12,2) NOT NULL CHECK (qty >= 0),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  invoice_no   TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credit_bills_order ON salesweb_credit_bills(order_id);

ALTER TABLE salesweb_credit_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesweb_credit_bills_admin_read ON salesweb_credit_bills;
CREATE POLICY salesweb_credit_bills_admin_read
  ON salesweb_credit_bills FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM shared_profiles sp
      WHERE sp.id = auth.uid()
        AND ( sp.role = 'admin'
              OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
    )
  );

-- Customer can see bills against their own orders (Statement page uses this).
DROP POLICY IF EXISTS salesweb_credit_bills_customer_read ON salesweb_credit_bills;
CREATE POLICY salesweb_credit_bills_customer_read
  ON salesweb_credit_bills FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM salesweb_customer_orders o
      WHERE o.id = salesweb_credit_bills.order_id
        AND o.customer_id = auth.uid()
    )
  );

-- Writes go through the RPCs below (SECURITY DEFINER), so we don't add
-- a write policy here — direct writes from client keys are refused.

-- ─── 2. Helper: refresh credit_billed_at on the parent order ──────────
CREATE OR REPLACE FUNCTION public.salesweb_refresh_credit_billed_flag(p_order_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_billed_sum NUMERIC := 0;
  v_order_total NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_billed_sum
    FROM salesweb_credit_bills WHERE order_id = p_order_id;
  SELECT COALESCE(total, 0) INTO v_order_total
    FROM salesweb_customer_orders WHERE id = p_order_id;
  IF v_billed_sum >= v_order_total AND v_order_total > 0 THEN
    UPDATE salesweb_customer_orders
       SET credit_billed_at = COALESCE(credit_billed_at, now()),
           updated_at       = now()
     WHERE id = p_order_id;
  ELSE
    UPDATE salesweb_customer_orders
       SET credit_billed_at = NULL,
           updated_at       = now()
     WHERE id = p_order_id;
  END IF;
END;
$$;

-- ─── 3. RPCs: save / update / delete a credit bill ────────────────────
CREATE OR REPLACE FUNCTION public.save_credit_bill(
  p_order_id   UUID,
  p_bill_date  DATE,
  p_qty        NUMERIC,
  p_amount     NUMERIC,
  p_invoice_no TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN RAISE EXCEPTION 'Not authorised.'; END IF;

  INSERT INTO salesweb_credit_bills (order_id, bill_date, qty, amount, invoice_no, created_by)
  VALUES (p_order_id, p_bill_date, p_qty, p_amount, NULLIF(p_invoice_no, ''), COALESCE(auth.jwt()->>'email','admin'))
  RETURNING id INTO v_id;

  PERFORM public.salesweb_refresh_credit_billed_flag(p_order_id);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_credit_bill(
  p_bill_id    UUID,
  p_bill_date  DATE,
  p_qty        NUMERIC,
  p_amount     NUMERIC,
  p_invoice_no TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN RAISE EXCEPTION 'Not authorised.'; END IF;

  UPDATE salesweb_credit_bills
     SET bill_date  = p_bill_date,
         qty        = p_qty,
         amount     = p_amount,
         invoice_no = NULLIF(p_invoice_no, ''),
         updated_at = now()
   WHERE id = p_bill_id
   RETURNING order_id INTO v_order_id;

  IF v_order_id IS NOT NULL THEN
    PERFORM public.salesweb_refresh_credit_billed_flag(v_order_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_credit_bill(p_bill_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_order_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN RAISE EXCEPTION 'Not authorised.'; END IF;

  SELECT order_id INTO v_order_id FROM salesweb_credit_bills WHERE id = p_bill_id;
  DELETE FROM salesweb_credit_bills WHERE id = p_bill_id;
  IF v_order_id IS NOT NULL THEN
    PERFORM public.salesweb_refresh_credit_billed_flag(v_order_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_credit_bill(UUID, DATE, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.save_credit_bill(UUID, DATE, NUMERIC, NUMERIC, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.update_credit_bill(UUID, DATE, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.update_credit_bill(UUID, DATE, NUMERIC, NUMERIC, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_credit_bill(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.delete_credit_bill(UUID) TO authenticated;

-- ─── 4. Extend save_order_payment: auto-flip status to Paid ───────────
CREATE OR REPLACE FUNCTION public.save_order_payment(
  p_order_id        UUID,
  p_paid_at         TIMESTAMPTZ,
  p_amount          NUMERIC,
  p_note            TEXT DEFAULT NULL,
  p_attachment_url  TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL,
  p_created_by      TEXT DEFAULT NULL
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
    order_id, paid_at, amount, note, attachment_url, attachment_name, created_by
  ) VALUES (
    p_order_id, p_paid_at, p_amount, p_note,
    p_attachment_url, p_attachment_name, COALESCE(p_created_by, auth.jwt()->>'email')
  )
  RETURNING id INTO v_id;

  -- Fetch fresh totals AFTER the trigger has recalced amount_paid.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid_sum
    FROM salesweb_order_payments WHERE order_id = p_order_id;
  SELECT COALESCE(total, 0), status INTO v_order_total, v_current_stat
    FROM salesweb_customer_orders WHERE id = p_order_id;

  IF v_paid_sum >= v_order_total AND v_order_total > 0
     AND v_current_stat NOT IN ('Paid', 'Ready for Collection', 'Completed', 'Cancelled', 'Refunded') THEN
    UPDATE salesweb_customer_orders
       SET status     = 'Paid',
           updated_at = now()
     WHERE id = p_order_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_order_payment(UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.save_order_payment(UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;
