-- Add the missing updated_at column to salesweb_coupons.
--
-- Symptom: applying a coupon on either the storefront checkout
-- (redeem_coupon called after order placement) or the admin portal
-- (redeem_coupon called from Apply Coupon) returned HTTP 400 with:
--
--   {"code":"42703","message":"column \"updated_at\" of relation
--    \"salesweb_coupons\" does not exist"}
--
-- Root cause: redeem_coupon's final step bumps the usage counter and
-- stamps the row's updated_at. The original sql/2026_05_promotions_coupons.sql
-- ALTER TABLE added fourteen new columns to salesweb_coupons but
-- forgot the updated_at timestamp the function writes to. On fresh
-- Supabase instances that never had updated_at from a prior migration
-- the column is missing and the UPDATE fails hard.
--
-- The default of NOW() keeps the historical rows timestamped as of
-- the moment this migration runs, which is harmless — nothing else
-- in the codebase reads this column, and the storefront only uses it
-- as a free side-effect of UPDATE … SET usage_count = … + 1.
--
-- Safe to re-run: IF NOT EXISTS makes it idempotent.

ALTER TABLE salesweb_coupons
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
