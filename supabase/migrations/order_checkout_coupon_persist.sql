-- Backfill orders where a checkout-time voucher was redeemed but the
-- coupon_code / coupon_discount fields on the order row are empty.
--
-- Symptom we are fixing: the customer applied a voucher at checkout, the
-- PDF receipt shows the discount, but the customer portal modal AND admin
-- portal show the full subtotal as Total. Root cause: checkout baked the
-- discount into `total` but never persisted coupon_code / coupon_discount
-- to the row, so any later recompute (Edit Items, Apply/Remove Discount,
-- Apply/Remove Coupon) snapped `total` back to the items subtotal.
--
-- This migration:
--   1. Backfills coupon_code + coupon_discount on every order that has a
--      row in salesweb_coupon_redemptions but no coupon_code recorded.
--   2. Recomputes `total = items_subtotal - discount_amount
--                          - coupon_discount - points_discount_rm`
--      for those backfilled orders so the discount is reflected end-to-end.
--
-- Run once in the Supabase SQL Editor. Safe to re-run (no-op on already-
-- backfilled orders).

-- 1. Backfill coupon_code / coupon_discount from the redemption ledger
WITH redemption AS (
  SELECT r.order_id,
         (SELECT code FROM salesweb_coupons c WHERE c.id = r.coupon_id) AS code,
         r.discount_amount
  FROM salesweb_coupon_redemptions r
)
UPDATE salesweb_customer_orders o
SET    coupon_code     = COALESCE(o.coupon_code, r.code),
       coupon_discount = COALESCE(NULLIF(o.coupon_discount, 0), r.discount_amount),
       updated_at      = now()
FROM   redemption r
WHERE  o.id = r.order_id
  AND  (COALESCE(o.coupon_code, '') = '' OR COALESCE(o.coupon_discount, 0) = 0);

-- 2. Recompute total for orders with persisted discounts so the cached
--    `total` column reflects subtotal minus all known discounts.
WITH item_sums AS (
  SELECT order_id, SUM(subtotal) AS sub
  FROM salesweb_order_items
  GROUP BY order_id
)
UPDATE salesweb_customer_orders o
SET    total = GREATEST(
                 0,
                 s.sub
                 - COALESCE(o.discount_amount, 0)
                 - COALESCE(o.coupon_discount, 0)
                 - COALESCE(o.points_discount_rm, 0)
               ),
       updated_at = now()
FROM   item_sums s
WHERE  s.order_id = o.id
  AND  ( COALESCE(o.coupon_discount,    0) > 0
      OR COALESCE(o.discount_amount,    0) > 0
      OR COALESCE(o.points_discount_rm, 0) > 0 )
  AND  o.total <> GREATEST(
                    0,
                    s.sub
                    - COALESCE(o.discount_amount, 0)
                    - COALESCE(o.coupon_discount, 0)
                    - COALESCE(o.points_discount_rm, 0)
                  );
