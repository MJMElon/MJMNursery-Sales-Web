-- Adds attachment_url + attachment_name columns to salesweb_order_payments
-- so admins can attach a bank slip / payment proof when recording each
-- payment entry via the Record Payment modal. The upload flow already
-- pushes the file into the order-attachments storage bucket; these two
-- columns persist the resulting URL and original filename alongside the
-- payment row so the entry can render a clickable document ribbon in the
-- Payment Tracking table.
--
-- Idempotent — safe to re-run.

ALTER TABLE salesweb_order_payments
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT;
