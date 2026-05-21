-- Adds an idempotency flag for the post-payment customer email.
-- Run once in Supabase SQL Editor.
--
-- The send-order-email edge function (called from the Billplz webhook
-- after an order flips to Paid) sets this timestamp once the customer
-- email is dispatched via Resend. Subsequent invocations (webhook
-- redelivery, an admin pressing a retry button, etc.) skip the send
-- if email_sent_at is already populated, so customers can't end up
-- with duplicate "Payment Confirmed" emails.

ALTER TABLE salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;
