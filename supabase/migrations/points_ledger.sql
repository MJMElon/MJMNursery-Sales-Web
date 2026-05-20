-- Points Ledger — single source of truth for customer loyalty points.
-- Run this once in Supabase SQL Editor.
--
-- Design notes:
--   * Append-only ledger of every point movement (+ earn, − redeem, ± adjust).
--   * Balance for a customer = SUM(change) WHERE user_id = X (via the view below).
--   * No cached balance column → no drift between two sources of truth.
--   * Volume is small; SUM-on-read is fine. Add a cached column later if needed.
--   * Earn is recorded when an order flips to Paid (webhook or admin).
--   * Redeem is recorded at the SAME moment (only after Paid) — so cancelled
--     orders never consume points. The order row carries the redemption
--     snapshot (points_redeemed / points_discount_rm) until Paid.

-- 1) The ledger table
CREATE TABLE IF NOT EXISTS salesweb_points_ledger (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change      INTEGER     NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('Earned','Redeemed','Adjusted')),
  order_id    UUID                 REFERENCES salesweb_customer_orders(id) ON DELETE SET NULL,
  rm_value    NUMERIC(10,2),                  -- order total (Earned) or discount given (Redeemed)
  note        TEXT,
  created_by  TEXT,                           -- 'billplz' | 'admin' | admin email | 'system'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_points_ledger_user  ON salesweb_points_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_points_ledger_order ON salesweb_points_ledger (order_id);

-- 2) Snapshot fields on the order (redemption captured at checkout, ledger row
--    only written when the order flips to Paid)
ALTER TABLE salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS points_redeemed    INTEGER       DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_discount_rm NUMERIC(10,2) DEFAULT 0;

-- 3) Convenience view: current balance + lifetime totals per customer
CREATE OR REPLACE VIEW salesweb_customer_points_balance AS
SELECT user_id,
       COALESCE(SUM(change), 0)::INTEGER                                                 AS balance,
       COALESCE(SUM(CASE WHEN change > 0 THEN change ELSE 0 END), 0)::INTEGER            AS lifetime_earned,
       COALESCE(SUM(CASE WHEN change < 0 THEN -change ELSE 0 END), 0)::INTEGER           AS lifetime_redeemed,
       MAX(created_at)                                                                   AS last_activity
FROM salesweb_points_ledger
GROUP BY user_id;

-- 4) RLS — customer reads own; admin reads all; service role inserts.
ALTER TABLE salesweb_points_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer reads own ledger" ON salesweb_points_ledger;
CREATE POLICY "customer reads own ledger" ON salesweb_points_ledger
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "admin reads all ledger" ON salesweb_points_ledger;
CREATE POLICY "admin reads all ledger" ON salesweb_points_ledger
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM shared_profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- (No INSERT/UPDATE/DELETE policies — only service role writes the ledger.)

-- 5) Backfill from existing Paid orders so customer portals aren't empty on launch.
--    Idempotent: only inserts rows that don't already exist for (order_id, type).
INSERT INTO salesweb_points_ledger (user_id, change, type, order_id, rm_value, note, created_by, created_at)
SELECT o.customer_id,
       o.points_issued,
       'Earned',
       o.id,
       o.total,
       'Backfilled from order ' || COALESCE(o.order_number, o.id::text),
       'system',
       COALESCE(o.updated_at, o.created_at)
FROM salesweb_customer_orders o
WHERE o.status = 'Paid'
  AND o.points_issued > 0
  AND o.customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM salesweb_points_ledger l
    WHERE l.order_id = o.id AND l.type = 'Earned'
  );
