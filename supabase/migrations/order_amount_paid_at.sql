-- Records WHEN a payment amount was last recorded against an order, so the
-- order detail can show the payment-received date next to the partial /
-- full paid amount.
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS amount_paid_at TIMESTAMPTZ;
