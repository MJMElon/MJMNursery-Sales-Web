-- ════════════════════════════════════════════════════════════════════════════
-- Migration: Order payments ledger (multi-row amount_paid tracking)
-- ----------------------------------------------------------------------------
-- Replaces the single amount_paid column on salesweb_customer_orders as the
-- source of truth with a proper ledger so admins can record multiple partial
-- payments per order (each with its own date, amount, note, attachment).
--
-- The amount_paid column itself stays on salesweb_customer_orders but is now
-- a derived sum-of-rows kept in sync by a trigger. Every existing consumer
-- of order.amount_paid (orderFullyPaid, payment-state badges, customer
-- portal, send-order-email, billplz-webhook) continues to work without
-- code changes — they just see a number that's automatically refreshed
-- whenever a payment row is inserted, updated, or deleted.
--
-- Idempotent: safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS salesweb_order_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES salesweb_customer_orders(id) ON DELETE CASCADE,
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount          NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  note            TEXT,
  attachment_url  TEXT,
  attachment_name TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_payments_order   ON salesweb_order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_paid_at ON salesweb_order_payments(paid_at DESC);

-- ─── Trigger: keep order.amount_paid / amount_paid_at in sync ──────────────
-- Runs after every insert/update/delete on the ledger. Sums all rows for
-- the affected order and writes the result back to the order row. Uses
-- COALESCE so deleting the last ledger row resets amount_paid to 0.

CREATE OR REPLACE FUNCTION salesweb_recalc_order_amount_paid()
RETURNS TRIGGER AS $$
DECLARE
  _order_id UUID;
  _sum NUMERIC;
  _last TIMESTAMPTZ;
BEGIN
  _order_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT COALESCE(SUM(amount), 0), MAX(paid_at)
    INTO _sum, _last
    FROM salesweb_order_payments
   WHERE order_id = _order_id;
  UPDATE salesweb_customer_orders
     SET amount_paid    = _sum,
         amount_paid_at = _last
   WHERE id = _order_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalc_amount_paid ON salesweb_order_payments;
CREATE TRIGGER trg_recalc_amount_paid
AFTER INSERT OR UPDATE OR DELETE ON salesweb_order_payments
FOR EACH ROW EXECUTE FUNCTION salesweb_recalc_order_amount_paid();

-- ─── Backfill ──────────────────────────────────────────────────────────────
-- Seed a single legacy ledger row for each existing order that already has
-- amount_paid > 0 but no ledger entries. Without this, the trigger would
-- recompute amount_paid to 0 the first time a real payment row lands.

INSERT INTO salesweb_order_payments (order_id, paid_at, amount, note, created_by)
SELECT o.id,
       COALESCE(o.amount_paid_at, o.created_at, now()),
       o.amount_paid,
       'Legacy entry — migrated from amount_paid column',
       'system'
FROM salesweb_customer_orders o
LEFT JOIN salesweb_order_payments p ON p.order_id = o.id
WHERE o.amount_paid IS NOT NULL
  AND o.amount_paid > 0
  AND p.id IS NULL;

-- ─── RLS ───────────────────────────────────────────────────────────────────
-- Mirrors salesweb_customer_orders: customers can read their own order's
-- payments; admin / normal salesweb staff (via shared_profiles permissions)
-- can do anything. Service-role writes (e.g. billplz-webhook) bypass RLS.

ALTER TABLE salesweb_order_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salesweb_order_payments_admin_all ON salesweb_order_payments;
CREATE POLICY salesweb_order_payments_admin_all
  ON salesweb_order_payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM shared_profiles sp
      WHERE sp.id = auth.uid()
        AND (
          sp.role = 'admin'
          OR (sp.permissions->'modules'->>'salesweb') IN ('admin','normal')
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM shared_profiles sp
      WHERE sp.id = auth.uid()
        AND (
          sp.role = 'admin'
          OR (sp.permissions->'modules'->>'salesweb') IN ('admin','normal')
        )
    )
  );

DROP POLICY IF EXISTS salesweb_order_payments_customer_select ON salesweb_order_payments;
CREATE POLICY salesweb_order_payments_customer_select
  ON salesweb_order_payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM salesweb_customer_orders o
      WHERE o.id = salesweb_order_payments.order_id
        AND o.customer_id = auth.uid()
    )
  );
