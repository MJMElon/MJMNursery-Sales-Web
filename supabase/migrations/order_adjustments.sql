-- Allows the admin to stack multiple discounts and/or multiple coupons on
-- one order. The single `discount_amount` + `coupon_code` fields on
-- salesweb_customer_orders stay as the checkout-time snapshot (the first
-- discount/coupon); every additional adjustment the admin keys in from
-- the order modal lands as a row here.
--
-- order total = items_subtotal
--             − discount_amount
--             − coupon_discount
--             − SUM(salesweb_order_adjustments.amount)
--             − points_discount_rm
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS salesweb_order_adjustments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    UUID NOT NULL REFERENCES salesweb_customer_orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('discount','coupon')),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  coupon_code TEXT,          -- only used when kind='coupon'
  note        TEXT,          -- remarks for kind='discount'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_adjustments_order
  ON salesweb_order_adjustments (order_id);

ALTER TABLE salesweb_order_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin reads order adjustments" ON salesweb_order_adjustments;
CREATE POLICY "admin reads order adjustments" ON salesweb_order_adjustments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM shared_profiles p
      WHERE p.id = auth.uid()
        AND ( p.role='admin'
              OR (p.permissions->'modules'->>'salesweb') IN ('admin','normal') )
    )
  );

DROP POLICY IF EXISTS "admin writes order adjustments" ON salesweb_order_adjustments;
CREATE POLICY "admin writes order adjustments" ON salesweb_order_adjustments
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM shared_profiles p
      WHERE p.id = auth.uid()
        AND ( p.role='admin'
              OR (p.permissions->'modules'->>'salesweb') IN ('admin','normal') )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM shared_profiles p
      WHERE p.id = auth.uid()
        AND ( p.role='admin'
              OR (p.permissions->'modules'->>'salesweb') IN ('admin','normal') )
    )
  );

-- Customer can read adjustments on their own orders so the customer portal
-- modal / PDF can break the discount down.
DROP POLICY IF EXISTS "customer reads own order adjustments" ON salesweb_order_adjustments;
CREATE POLICY "customer reads own order adjustments" ON salesweb_order_adjustments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM salesweb_customer_orders o
      WHERE o.id = order_id AND o.customer_id = auth.uid()
    )
  );
