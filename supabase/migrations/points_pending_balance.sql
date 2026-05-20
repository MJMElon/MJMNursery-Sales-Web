-- Points balance view — subtract pending-payment redemptions from available balance.
-- Run once in Supabase SQL Editor.
--
-- Why:
--   The previous behaviour only wrote the negative "Redeemed" ledger row when the
--   order flipped to Paid (webhook or admin). Until then, the customer's
--   ledger-based balance still showed the full pre-redemption number, so they
--   could redeem the same points again on a second pending-payment order. Both
--   would later flip to Paid, both would insert a -N ledger row, and the
--   customer's balance would silently go negative.
--
-- Fix:
--   The balance view now subtracts the sum of `points_redeemed` from every order
--   in 'Pending Payment' status. The moment the customer places the order the
--   redemption is reflected in the displayed balance and in the server-side
--   pre-insert check in payment.html — no race window. When the order flips to
--   Paid, the webhook inserts the actual -N ledger row AND the order leaves
--   Pending Payment; net effect on balance is zero (correct). When the order
--   is cancelled, it also leaves Pending Payment; the subtraction simply
--   stops applying; balance restores; no refund ledger row needed.

--   When the order flips to Paid the webhook inserts the actual -N ledger
--   row AND the order leaves Pending Payment; net effect on balance is zero
--   (correct). When the order is cancelled, it also leaves Pending Payment;
--   the subtraction simply stops applying; balance restores; no refund
--   ledger row needed.
--
-- We DROP-then-CREATE (rather than CREATE OR REPLACE) because Postgres
-- refuses to replace a view in place if the column types/order differ in
-- any way — even when the column names are identical. Dropping is safe:
-- nothing else in the schema depends on this view.
DROP VIEW IF EXISTS salesweb_customer_points_balance;

CREATE VIEW salesweb_customer_points_balance AS
WITH ledger_totals AS (
  SELECT user_id,
         COALESCE(SUM(change), 0)::INTEGER                                       AS ledger_balance,
         COALESCE(SUM(CASE WHEN change > 0 THEN change ELSE 0 END), 0)::INTEGER  AS lifetime_earned,
         COALESCE(SUM(CASE WHEN change < 0 THEN -change ELSE 0 END), 0)::INTEGER AS lifetime_redeemed,
         MAX(created_at)                                                         AS last_activity
  FROM salesweb_points_ledger
  GROUP BY user_id
),
pending_redemptions AS (
  SELECT customer_id                                AS user_id,
         COALESCE(SUM(points_redeemed), 0)::INTEGER AS pending_redeemed
  FROM salesweb_customer_orders
  WHERE status = 'Pending Payment'
    AND points_redeemed > 0
    AND customer_id IS NOT NULL
  GROUP BY customer_id
),
all_users AS (
  SELECT user_id FROM ledger_totals
  UNION
  SELECT user_id FROM pending_redemptions
)
SELECT u.user_id,
       (COALESCE(l.ledger_balance, 0) - COALESCE(p.pending_redeemed, 0))::INTEGER AS balance,
       COALESCE(l.lifetime_earned,    0)::INTEGER                                  AS lifetime_earned,
       COALESCE(l.lifetime_redeemed,  0)::INTEGER                                  AS lifetime_redeemed,
       l.last_activity,
       -- Exposed so the checkout UI can render "X on hold for pending order"
       -- next to the balance — without this column payment.html sees only the
       -- net balance and can't tell the customer *why* their points dropped.
       COALESCE(p.pending_redeemed, 0)::INTEGER                                   AS pending_redeemed
FROM all_users u
LEFT JOIN ledger_totals       l ON l.user_id = u.user_id
LEFT JOIN pending_redemptions p ON p.user_id = u.user_id;

-- Hard guarantee that the same order can never produce two Earned or two
-- Redeemed ledger rows even if a status-transition handler is invoked twice
-- (webhook retry, admin double-click). 'Adjusted' rows are not tied to an
-- order (order_id NULL) so the partial WHERE keeps them out of the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_points_ledger_order_type
  ON salesweb_points_ledger (order_id, type)
  WHERE order_id IS NOT NULL;
