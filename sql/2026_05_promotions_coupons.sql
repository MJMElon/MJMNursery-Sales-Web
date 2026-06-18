-- ═══════════════════════════════════════════════════════════════
--  MJM NURSERY — PROMOTIONS & COUPONS UPGRADE (2026-05-10)
-- ───────────────────────────────────────────────────────────────
--  Run this once in the Supabase SQL editor. It is idempotent
--  (every statement uses IF NOT EXISTS / OR REPLACE) so it is safe
--  to re-apply.
--
--  Sections:
--    1. Coupon schema upgrades
--    2. Promotion schema upgrades
--    3. coupon_redemptions table (per-use ledger)
--    4. promotion_drafts table (AI chat sessions)
--    5. redeem_coupon() RPC — single source of truth
--    6. preview_coupon() RPC — dry-run, no usage_count bump
--    7. promotions_for_cart() RPC — auto-applied promotions
--    8. RLS policies
-- ═══════════════════════════════════════════════════════════════

-- ─────────────── 1. salesweb_coupons upgrades ───────────────
ALTER TABLE salesweb_coupons
  ADD COLUMN IF NOT EXISTS name                  TEXT,
  ADD COLUMN IF NOT EXISTS description           TEXT,
  ADD COLUMN IF NOT EXISTS scope                 TEXT DEFAULT 'all'
    CHECK (scope IN ('all','category','product','customer_segment')),
  ADD COLUMN IF NOT EXISTS scope_ids             UUID[]  DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS scope_categories      TEXT[]  DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS max_discount          NUMERIC,
  ADD COLUMN IF NOT EXISTS per_customer_limit    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_order_only      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stackable_with_promo  BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS start_date            DATE,
  ADD COLUMN IF NOT EXISTS auto_apply            BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS generated_by          TEXT DEFAULT 'manual'
    CHECK (generated_by IN ('manual','bulk','referral','loyalty')),
  ADD COLUMN IF NOT EXISTS bulk_batch_id         UUID,
  ADD COLUMN IF NOT EXISTS bogo_buy_qty          INTEGER,
  ADD COLUMN IF NOT EXISTS bogo_get_qty          INTEGER,
  ADD COLUMN IF NOT EXISTS bogo_get_discount_pct INTEGER,
  ADD COLUMN IF NOT EXISTS notes                 TEXT;

-- Allow free_shipping as a discount_type. If a CHECK constraint exists
-- on discount_type that excludes 'free_shipping', drop and recreate it.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'salesweb_coupons'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%discount_type%'
   LIMIT 1;
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE salesweb_coupons DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;
  ALTER TABLE salesweb_coupons
    ADD CONSTRAINT salesweb_coupons_discount_type_check
    CHECK (discount_type IN ('percentage','fixed','free_shipping'));
END$$;

CREATE INDEX IF NOT EXISTS idx_coupons_active_expiry
  ON salesweb_coupons(is_active, expiry_date);
CREATE INDEX IF NOT EXISTS idx_coupons_auto_apply
  ON salesweb_coupons(auto_apply) WHERE auto_apply = TRUE;
CREATE INDEX IF NOT EXISTS idx_coupons_bulk_batch
  ON salesweb_coupons(bulk_batch_id);

-- ─────────────── 2. salesweb_promotions upgrades ───────────────
ALTER TABLE salesweb_promotions
  ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','live','ended','archived')),
  ADD COLUMN IF NOT EXISTS banner_text         TEXT,
  ADD COLUMN IF NOT EXISTS banner_color        TEXT,
  ADD COLUMN IF NOT EXISTS banner_emoji        TEXT,
  ADD COLUMN IF NOT EXISTS target_product_ids  UUID[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS target_categories   TEXT[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS priority            INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_discount        NUMERIC,
  ADD COLUMN IF NOT EXISTS min_order_value     NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by          UUID,
  ADD COLUMN IF NOT EXISTS published_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_id            UUID;

-- Backfill: legacy rows with is_active=true and dates in range → 'live'
UPDATE salesweb_promotions
   SET status = CASE
     WHEN NOT COALESCE(is_active, FALSE) THEN 'archived'
     WHEN end_date IS NOT NULL AND end_date < CURRENT_DATE THEN 'ended'
     WHEN start_date IS NOT NULL AND start_date > CURRENT_DATE THEN 'scheduled'
     ELSE 'live'
   END
 WHERE status IS NULL OR status = 'draft';

CREATE INDEX IF NOT EXISTS idx_promotions_status
  ON salesweb_promotions(status, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotions_priority
  ON salesweb_promotions(priority DESC) WHERE status = 'live';

-- ─────────────── 2b. salesweb_order_items: track applied promotion ───────────────
ALTER TABLE salesweb_order_items
  ADD COLUMN IF NOT EXISTS promotion_id        UUID,
  ADD COLUMN IF NOT EXISTS promotion_discount  NUMERIC DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_order_items_promotion
  ON salesweb_order_items(promotion_id) WHERE promotion_id IS NOT NULL;

-- ─────────────── 3. coupon_redemptions ledger ───────────────
CREATE TABLE IF NOT EXISTS salesweb_coupon_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id       UUID NOT NULL REFERENCES salesweb_coupons(id) ON DELETE CASCADE,
  coupon_code     TEXT NOT NULL,
  customer_id     UUID,
  customer_email  TEXT,
  order_id        UUID,
  subtotal        NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redemptions_coupon ON salesweb_coupon_redemptions(coupon_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_redemptions_customer ON salesweb_coupon_redemptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_order ON salesweb_coupon_redemptions(order_id);

-- ─────────────── 4. promotion_drafts (AI chat sessions) ───────────────
CREATE TABLE IF NOT EXISTS salesweb_promotion_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID,
  title         TEXT,
  messages      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{role, content, ts}]
  current_draft JSONB,                                 -- last AI-produced PromotionDraft
  published_promotion_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_drafts_user
  ON salesweb_promotion_drafts(created_by, updated_at DESC);

-- ─────────────── 5. preview_coupon() — dry-run validator ───────────────
-- Returns (valid bool, reason text, discount numeric, applies_to_subtotal numeric)
CREATE OR REPLACE FUNCTION preview_coupon(
  p_code        TEXT,
  p_customer_id UUID,
  p_subtotal    NUMERIC,
  p_items       JSONB DEFAULT '[]'::jsonb   -- [{product_id, category, qty, price}]
) RETURNS TABLE(
  valid                 BOOLEAN,
  reason                TEXT,
  discount              NUMERIC,
  applies_to_subtotal   NUMERIC,
  coupon_id             UUID,
  coupon_name           TEXT
) LANGUAGE plpgsql AS $$
DECLARE
  v_coupon       salesweb_coupons%ROWTYPE;
  v_today        DATE := CURRENT_DATE;
  v_eligible_sub NUMERIC := 0;
  v_per_customer INT := 0;
  v_first_order  BOOLEAN := FALSE;
  v_discount     NUMERIC := 0;
BEGIN
  -- Lookup
  SELECT * INTO v_coupon FROM salesweb_coupons
   WHERE UPPER(code) = UPPER(p_code) LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Invalid voucher code', 0::NUMERIC, 0::NUMERIC, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;

  IF NOT COALESCE(v_coupon.is_active, FALSE) THEN
    RETURN QUERY SELECT FALSE, 'This voucher is no longer active', 0::NUMERIC, 0::NUMERIC, v_coupon.id, v_coupon.name;
    RETURN;
  END IF;

  IF v_coupon.start_date IS NOT NULL AND v_coupon.start_date > v_today THEN
    RETURN QUERY SELECT FALSE, 'This voucher is not active yet', 0::NUMERIC, 0::NUMERIC, v_coupon.id, v_coupon.name;
    RETURN;
  END IF;

  IF v_coupon.expiry_date IS NOT NULL AND v_coupon.expiry_date < v_today THEN
    RETURN QUERY SELECT FALSE, 'This voucher has expired', 0::NUMERIC, 0::NUMERIC, v_coupon.id, v_coupon.name;
    RETURN;
  END IF;

  IF COALESCE(v_coupon.usage_limit, 0) > 0
     AND COALESCE(v_coupon.usage_count, 0) >= v_coupon.usage_limit THEN
    RETURN QUERY SELECT FALSE, 'This voucher has reached its usage limit', 0::NUMERIC, 0::NUMERIC, v_coupon.id, v_coupon.name;
    RETURN;
  END IF;

  IF COALESCE(v_coupon.min_order_value, 0) > 0 AND p_subtotal < v_coupon.min_order_value THEN
    RETURN QUERY SELECT FALSE,
      'Minimum order RM ' || to_char(v_coupon.min_order_value, 'FM999990.00') || ' required',
      0::NUMERIC, 0::NUMERIC, v_coupon.id, v_coupon.name;
    RETURN;
  END IF;

  -- Per-customer limit (counts past redemptions)
  IF COALESCE(v_coupon.per_customer_limit, 0) > 0 AND p_customer_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_per_customer
      FROM salesweb_coupon_redemptions r
     WHERE r.coupon_id = v_coupon.id AND r.customer_id = p_customer_id;
    IF v_per_customer >= v_coupon.per_customer_limit THEN
      RETURN QUERY SELECT FALSE, 'You have already used this voucher', 0::NUMERIC, 0::NUMERIC, v_coupon.id, v_coupon.name;
      RETURN;
    END IF;
  END IF;

  -- First-order-only check
  IF COALESCE(v_coupon.first_order_only, FALSE) AND p_customer_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM salesweb_customer_orders
       WHERE customer_id = p_customer_id
         AND COALESCE(order_status, '') <> 'Cancelled'
         AND payment_status <> 'Refunded'
    ) INTO v_first_order;
    IF v_first_order THEN
      RETURN QUERY SELECT FALSE, 'This voucher is for first-time customers only', 0::NUMERIC, 0::NUMERIC, v_coupon.id, v_coupon.name;
      RETURN;
    END IF;
  END IF;

  -- Determine the eligible subtotal based on scope
  IF v_coupon.scope IS NULL OR v_coupon.scope = 'all' THEN
    v_eligible_sub := p_subtotal;
  ELSIF v_coupon.scope = 'product' THEN
    SELECT COALESCE(SUM((it->>'qty')::NUMERIC * (it->>'price')::NUMERIC), 0)
      INTO v_eligible_sub
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
     WHERE (it->>'product_id')::UUID = ANY(COALESCE(v_coupon.scope_ids, '{}'::uuid[]));
  ELSIF v_coupon.scope = 'category' THEN
    SELECT COALESCE(SUM((it->>'qty')::NUMERIC * (it->>'price')::NUMERIC), 0)
      INTO v_eligible_sub
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
     WHERE (it->>'category') = ANY(COALESCE(v_coupon.scope_categories, '{}'::text[]));
  ELSE
    v_eligible_sub := p_subtotal;
  END IF;

  IF v_eligible_sub <= 0 AND v_coupon.scope IN ('product','category') THEN
    RETURN QUERY SELECT FALSE, 'Voucher does not apply to any item in your cart', 0::NUMERIC, 0::NUMERIC, v_coupon.id, v_coupon.name;
    RETURN;
  END IF;

  -- Calculate discount
  IF v_coupon.discount_type = 'percentage' THEN
    v_discount := ROUND(v_eligible_sub * (v_coupon.discount_value / 100.0), 2);
  ELSIF v_coupon.discount_type = 'free_shipping' THEN
    v_discount := COALESCE(v_coupon.discount_value, 0);  -- shipping fee, if you have one
  ELSE
    v_discount := LEAST(v_coupon.discount_value, v_eligible_sub);
  END IF;

  IF COALESCE(v_coupon.max_discount, 0) > 0 AND v_discount > v_coupon.max_discount THEN
    v_discount := v_coupon.max_discount;
  END IF;

  RETURN QUERY SELECT TRUE, 'OK'::TEXT, v_discount, v_eligible_sub, v_coupon.id, v_coupon.name;
END;
$$;

-- ─────────────── 6. redeem_coupon() — atomic apply ───────────────
-- Wraps preview_coupon and (on success) writes a redemption row +
-- bumps usage_count atomically. Use this from checkout AND admin.
CREATE OR REPLACE FUNCTION redeem_coupon(
  p_code           TEXT,
  p_customer_id    UUID,
  p_customer_email TEXT,
  p_order_id       UUID,
  p_subtotal       NUMERIC,
  p_items          JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_preview RECORD;
BEGIN
  SELECT * INTO v_preview FROM preview_coupon(p_code, p_customer_id, p_subtotal, p_items);

  IF NOT v_preview.valid THEN
    RETURN jsonb_build_object(
      'ok', FALSE,
      'reason', v_preview.reason
    );
  END IF;

  -- Idempotency: if this order already redeemed this coupon, return existing row
  IF p_order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM salesweb_coupon_redemptions
     WHERE order_id = p_order_id AND coupon_id = v_preview.coupon_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'discount', v_preview.discount,
      'coupon_id', v_preview.coupon_id,
      'idempotent', TRUE
    );
  END IF;

  INSERT INTO salesweb_coupon_redemptions (
    coupon_id, coupon_code, customer_id, customer_email, order_id, subtotal, discount_amount
  ) VALUES (
    v_preview.coupon_id, UPPER(p_code), p_customer_id, p_customer_email,
    p_order_id, p_subtotal, v_preview.discount
  );

  UPDATE salesweb_coupons
     SET usage_count = COALESCE(usage_count, 0) + 1,
         updated_at  = NOW()
   WHERE id = v_preview.coupon_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'discount', v_preview.discount,
    'eligible_subtotal', v_preview.applies_to_subtotal,
    'coupon_id', v_preview.coupon_id,
    'coupon_name', v_preview.coupon_name
  );
END;
$$;

-- ─────────────── 7. promotions_for_cart() — auto-apply ───────────────
-- Returns the best-eligible LIVE promotion discount for each line item.
-- Promotions don't need a code; they apply automatically based on scope.
CREATE OR REPLACE FUNCTION promotions_for_cart(
  p_items JSONB    -- [{product_id, category, qty, price}]
) RETURNS TABLE(
  product_id    UUID,
  promotion_id  UUID,
  promo_title   TEXT,
  discount      NUMERIC
) LANGUAGE plpgsql AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
BEGIN
  RETURN QUERY
  WITH live_promos AS (
    SELECT *
      FROM salesweb_promotions
     WHERE status = 'live'
       AND COALESCE(is_active, TRUE)
       AND (start_date IS NULL OR start_date <= v_today)
       AND (end_date   IS NULL OR end_date   >= v_today)
  ),
  cart AS (
    SELECT
      (it->>'product_id')::UUID AS product_id,
      (it->>'category')          AS category,
      (it->>'qty')::NUMERIC      AS qty,
      (it->>'price')::NUMERIC    AS price
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS it
  ),
  matches AS (
    SELECT c.product_id,
           lp.id AS promotion_id,
           lp.title AS promo_title,
           lp.priority,
           CASE
             WHEN lp.discount_type = 'percentage' THEN
               LEAST(
                 ROUND(c.qty * c.price * (lp.discount_value / 100.0), 2),
                 COALESCE(NULLIF(lp.max_discount, 0), 1e12)
               )
             ELSE
               LEAST(lp.discount_value * c.qty, c.qty * c.price)
           END AS discount
      FROM cart c
      JOIN live_promos lp ON (
            lp.target = 'all'
         OR (lp.target = 'specific' AND c.product_id = ANY(COALESCE(lp.target_product_ids, '{}'::uuid[])))
         OR (lp.target = 'category' AND c.category = ANY(COALESCE(lp.target_categories, '{}'::text[])))
      )
  ),
  ranked AS (
    SELECT m.*,
           ROW_NUMBER() OVER (PARTITION BY m.product_id ORDER BY m.priority DESC, m.discount DESC) AS rn
      FROM matches m
  )
  SELECT r.product_id, r.promotion_id, r.promo_title, r.discount
    FROM ranked r WHERE r.rn = 1 AND r.discount > 0;
END;
$$;

-- ─────────────── 8. RLS ───────────────
-- Coupon redemptions: customers can read their own; admins (service role) can read all.
ALTER TABLE salesweb_coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "redemptions_self_read" ON salesweb_coupon_redemptions;
CREATE POLICY "redemptions_self_read" ON salesweb_coupon_redemptions
  FOR SELECT USING (auth.uid() = customer_id);

-- Insert is performed via SECURITY DEFINER through redeem_coupon(), so we
-- don't need a public insert policy. (Service role bypasses RLS anyway.)

ALTER TABLE salesweb_promotion_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "drafts_owner_all" ON salesweb_promotion_drafts;
CREATE POLICY "drafts_owner_all" ON salesweb_promotion_drafts
  FOR ALL USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

-- Grants — RPCs are SECURITY INVOKER by default; we want preview_coupon
-- and redeem_coupon callable by anon (used at checkout pre-auth).
GRANT EXECUTE ON FUNCTION preview_coupon(TEXT, UUID, NUMERIC, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_coupon(TEXT, UUID, TEXT, UUID, NUMERIC, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION promotions_for_cart(JSONB) TO anon, authenticated;
