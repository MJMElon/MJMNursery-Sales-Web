-- Promote redeem_coupon to SECURITY DEFINER so the INSERT into
-- salesweb_coupon_redemptions runs with the function's owner, not the
-- caller. The original migration (sql/2026_05_promotions_coupons.sql)
-- left this function as SECURITY INVOKER with the comment
--   "Insert is performed via SECURITY DEFINER through redeem_coupon()"
-- — the comment lied; the keyword was missing. Result: when an admin
-- applied a coupon on a customer's order from the admin side, the
-- INSERT hit the row-level security policy on
-- salesweb_coupon_redemptions (which only exposes `auth.uid() =
-- customer_id` for SELECT; INSERT had no policy at all because the
-- author assumed the RPC bypassed RLS) and failed with:
--
--     new row violates row-level security policy for table
--     "salesweb_coupon_redemptions"
--
-- preview_coupon stays SECURITY INVOKER — it doesn't INSERT anything,
-- just reads coupons / orders / redemptions, which the public roles can
-- do under the existing SELECT policies.
--
-- Safe to re-run; ALTER FUNCTION is idempotent on identical state.

ALTER FUNCTION public.redeem_coupon(TEXT, UUID, TEXT, UUID, NUMERIC, JSONB)
  SECURITY DEFINER
  SET search_path = public;

-- Belt-and-braces: lock down who can execute it. anon + authenticated
-- cover the storefront (guest + logged-in customer) and the admin
-- portal (admin accounts are authenticated).
REVOKE ALL ON FUNCTION public.redeem_coupon(TEXT, UUID, TEXT, UUID, NUMERIC, JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.redeem_coupon(TEXT, UUID, TEXT, UUID, NUMERIC, JSONB) TO anon, authenticated;
