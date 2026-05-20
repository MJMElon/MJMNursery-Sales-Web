-- Admin ledger writes — allow admin role to insert ledger rows, and
-- backfill any rows that were silently lost.
-- Run once in Supabase SQL Editor.
--
-- Why:
--   points_ledger.sql enabled RLS with only SELECT policies. The comment
--   in that file said "only service role writes the ledger", which holds
--   for the Billplz webhook (an edge function that uses service_role and
--   bypasses RLS), but breaks for the admin app — admin.html signs in
--   admin users via the anon key, so when an admin marks an order Paid,
--   admin-orders.js:761 attempts a plain INSERT under the user's auth
--   identity. With no INSERT policy that matches an authenticated user,
--   RLS denies it silently. The order's points_issued field and the
--   timeline entry are written to other tables that don't have this
--   restriction, so the UI shows "Points Issued: N loyalty points
--   issued" even though no ledger row was ever created — the customer's
--   spendable balance never updates and the admin's customer-detail
--   points totals stay stale.
--
-- Fix:
--   1) Admin role gets a permissive INSERT policy (still gated on a real
--      admin row in shared_profiles so a hijacked anon key can't write).
--   2) Backfill any non-Cancelled order that has points_issued > 0 or
--      points_redeemed > 0 but no corresponding ledger row. Idempotent —
--      NOT EXISTS keeps it from duplicating rows on re-run, and the
--      uniq_points_ledger_order_type unique index added in
--      points_pending_balance.sql is a hard guarantee against duplicates
--      regardless.

DROP POLICY IF EXISTS "admin writes ledger" ON salesweb_points_ledger;
CREATE POLICY "admin writes ledger" ON salesweb_points_ledger
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM shared_profiles WHERE id = auth.uid() AND role = 'admin'
  ));

-- Backfill missed Earned rows (admin Paid transition was RLS-blocked).
INSERT INTO salesweb_points_ledger
  (user_id, change, type, order_id, rm_value, note, created_by, created_at)
SELECT o.customer_id,
       o.points_issued,
       'Earned',
       o.id,
       o.total,
       'Backfill — admin Paid transition was RLS-blocked before policy fix',
       'system',
       COALESCE(o.updated_at, o.created_at)
FROM salesweb_customer_orders o
WHERE o.status IN ('Paid','Ready for Collection','Completed')
  AND o.points_issued > 0
  AND o.customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM salesweb_points_ledger l
    WHERE l.order_id = o.id AND l.type = 'Earned'
  );

-- Backfill missed Redeemed rows.
INSERT INTO salesweb_points_ledger
  (user_id, change, type, order_id, rm_value, note, created_by, created_at)
SELECT o.customer_id,
       -o.points_redeemed,
       'Redeemed',
       o.id,
       COALESCE(o.points_discount_rm, 0),
       'Backfill — admin Paid transition was RLS-blocked before policy fix',
       'system',
       COALESCE(o.updated_at, o.created_at)
FROM salesweb_customer_orders o
WHERE o.status IN ('Paid','Ready for Collection','Completed')
  AND o.points_redeemed > 0
  AND o.customer_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM salesweb_points_ledger l
    WHERE l.order_id = o.id AND l.type = 'Redeemed'
  );
