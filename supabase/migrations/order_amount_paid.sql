-- Adds per-order paid-amount tracking so the admin can record partial
-- payments and the Manage Orders filter can distinguish between
-- Unpaid / Partially Paid / Paid based on real numbers instead of just
-- the workflow status.
--
-- Run once in the Supabase SQL Editor.
--
-- Source of truth for payment state:
--   amount_paid == 0                      → Unpaid
--   0 < amount_paid < total               → Partially Paid
--   amount_paid >= total                  → Paid
--   status = 'Refunded'                   → Refunded
--
-- Existing orders that reached a paid workflow status are backfilled
-- so they don't show as "Unpaid" the moment the column ships.

ALTER TABLE salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0 NOT NULL;

UPDATE salesweb_customer_orders
SET amount_paid = total
WHERE amount_paid = 0
  AND total > 0
  AND status IN ('Paid', 'Ready for Collection', 'Completed');
