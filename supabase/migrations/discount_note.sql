-- Adds an optional remarks field for the order-level discount, so admins
-- can note why a discount was given (e.g. "Loyalty top-up", "Damaged item
-- replacement", "Trade-show promo"). Stored next to discount_amount on the
-- order; not surfaced to customers.
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS discount_note TEXT;
