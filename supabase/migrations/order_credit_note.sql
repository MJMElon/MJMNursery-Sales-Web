-- Credit-note tracking on customer orders.
--
-- Two nullable timestamps drive the Payments → Credit Note tab:
--
--   credit_note_flagged_at
--     Set when an admin manually flags an order as "needs a credit
--     note" via the Payment Review modal — e.g. a partial refund
--     scenario where the order isn't Refunded/Cancelled but still
--     needs paperwork issued to the customer. NULL when not flagged.
--
--   credit_note_issued_at
--     Set when the admin uploads the credit-note PDF and clicks
--     "Mark Credit Note Issued". The row then disappears from the
--     open queue on the Credit Note tab (issued rows are done work).
--
-- Row visibility on the Credit Note tab (all three OR'd, minus
-- already-issued):
--   status = 'Refunded'
--   status = 'Cancelled' AND SUM(salesweb_order_payments.amount) > 0
--   credit_note_flagged_at IS NOT NULL
--
-- Uploaded credit-note PDFs continue to live in
-- salesweb_order_attachments (same table as any other order doc),
-- so the customer / admin sees them under Attached Documents. No new
-- storage bucket.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS credit_note_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credit_note_issued_at  TIMESTAMPTZ;

-- Partial index so the "still-open credit-note work" query stays
-- fast even as issued rows accumulate.
CREATE INDEX IF NOT EXISTS idx_orders_credit_note_open
  ON public.salesweb_customer_orders (credit_note_flagged_at)
  WHERE credit_note_issued_at IS NULL;
