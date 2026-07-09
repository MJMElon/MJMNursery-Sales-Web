-- Backfill columns onto salesweb_order_payments that the original
-- CREATE TABLE IF NOT EXISTS in order_payments_ledger.sql defined but
-- that never got applied on Supabase instances where the table was
-- created from an older version of that migration (CREATE TABLE IF NOT
-- EXISTS doesn't add missing columns to an existing table).
--
-- Adds:
--   - attachment_url / attachment_name — bank slip URL + filename for
--     each recorded payment.
--   - created_by                       — email of the admin who saved
--     the payment entry.
--   - note                             — free-text note per payment.
--   - created_at                       — insert timestamp.
--
-- Idempotent — safe to re-run any number of times.

ALTER TABLE salesweb_order_payments
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by      TEXT,
  ADD COLUMN IF NOT EXISTS note            TEXT,
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT now();
