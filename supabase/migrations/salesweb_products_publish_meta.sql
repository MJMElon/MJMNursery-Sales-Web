-- Publish metadata columns on salesweb_products.
--
-- admin-products.js confirmPublish() writes these on every publish
-- to record how many units were surfaced and which strategy was
-- picked (Raw / Minus alloc / Maturity+suitable-estimate / Manual).
-- Without these columns the UPDATE silently fails with a schema-cache
-- error and the Confirm & Publish button appears to do nothing.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.salesweb_products
  ADD COLUMN IF NOT EXISTS published_qty     INTEGER,
  ADD COLUMN IF NOT EXISTS publish_strategy  TEXT,
  ADD COLUMN IF NOT EXISTS published_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by      TEXT;
