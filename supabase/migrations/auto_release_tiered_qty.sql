-- Tiered cash-order auto-release. The setting row extends the existing
-- 'order_auto_release' JSON with a 'tiers' array; when tiers are set,
-- the RPC picks the matching tier's day-count based on the order's
-- total qty (sum of salesweb_order_items.quantity). Falls back to the
-- flat 'hours' when tiers are empty or no tier matches, so the
-- historical behaviour is unchanged for admins who haven't switched to
-- tiered rules.
--
-- Setting shape (extends what's already there):
--   {
--     "enabled": true,
--     "hours":   48,
--     "tiers": [
--       {"min_qty":    1, "max_qty": 1000, "days":  7},
--       {"min_qty": 1001, "max_qty": null, "days": 14}
--     ]
--   }
--
-- max_qty: NULL means "no upper bound". Tiers are evaluated as [min,max]
-- inclusive on both ends. If two tiers overlap, the first one that
-- matches wins (JSONB array preserves order).
--
-- Filters candidate orders on the legacy `status` column, which is
-- guaranteed present and kept in sync with payment_status/order_status
-- by the salesweb_orders_dual_write_status trigger. This makes the RPC
-- work on any Supabase instance regardless of whether the split-columns
-- backfill has run.
--
-- Emits RAISE NOTICE lines so runs are visible in Supabase logs even
-- when the caller ignores the return value.
--
-- Safe to re-run: replaces the function definition, no data loss.

CREATE OR REPLACE FUNCTION release_abandoned_cash_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count   integer := 0;
  v_scanned integer := 0;
  v_hours   numeric := 48;
  v_enabled boolean := true;
  v_raw     text;
  v_cfg     jsonb;
  v_tiers   jsonb;
  v_qty     integer;
  v_days    numeric;
  v_note    text;
  v_tier    jsonb;
  v_matched boolean;
  r RECORD;
BEGIN
  SELECT value INTO v_raw FROM salesweb_app_settings WHERE key = 'order_auto_release';
  IF v_raw IS NOT NULL THEN
    BEGIN
      v_cfg     := v_raw::jsonb;
      v_hours   := COALESCE((v_cfg ->> 'hours')::numeric, 48);
      v_enabled := COALESCE((v_cfg ->> 'enabled')::boolean, true);
      v_tiers   := v_cfg -> 'tiers';
      IF jsonb_typeof(v_tiers) <> 'array' THEN v_tiers := NULL; END IF;
    EXCEPTION WHEN others THEN
      v_hours := 48; v_enabled := true; v_tiers := NULL;
    END;
  END IF;

  IF NOT v_enabled THEN
    RAISE NOTICE 'release_abandoned_cash_orders: disabled';
    RETURN 0;
  END IF;

  FOR r IN
    SELECT o.id, o.created_at
    FROM   salesweb_customer_orders o
    WHERE  o.status = 'Pending Payment'
      AND  COALESCE(o.payment_terms, 'cash') <> 'credit'
      AND  o.deleted_at IS NULL
  LOOP
    v_scanned := v_scanned + 1;
    v_days    := NULL;
    v_matched := false;

    IF v_tiers IS NOT NULL AND jsonb_array_length(v_tiers) > 0 THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_qty
      FROM   salesweb_order_items
      WHERE  order_id = r.id;

      FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers)
      LOOP
        IF v_qty >= COALESCE((v_tier ->> 'min_qty')::numeric, 0)
           AND (v_tier ->> 'max_qty' IS NULL
                OR v_qty <= (v_tier ->> 'max_qty')::numeric)
        THEN
          v_days    := (v_tier ->> 'days')::numeric;
          v_matched := true;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    -- Fall back to the flat 'hours' setting if no tier matched.
    IF NOT v_matched THEN
      IF v_hours IS NULL OR v_hours <= 0 THEN
        CONTINUE;   -- flat cutoff is disabled → skip this order
      END IF;
      IF r.created_at >= now() - (v_hours * interval '1 hour') THEN
        CONTINUE;   -- still within the flat window
      END IF;
      v_note := 'Auto-cancelled — cash order unpaid for ' || v_hours || 'h; stock returned';
    ELSE
      IF v_days IS NULL OR v_days <= 0 THEN
        CONTINUE;   -- tier explicitly says 'never cancel'
      END IF;
      IF r.created_at >= now() - (v_days * interval '1 day') THEN
        CONTINUE;   -- still within the tier window
      END IF;
      v_note := 'Auto-cancelled — cash order (qty ' || v_qty || ') unpaid for ' || v_days || ' days; stock returned';
    END IF;

    -- Restore stock, flip status, log timeline. Wrap in a sub-block so
    -- that a per-row failure (e.g. a stray constraint on a single
    -- order's items) doesn't kill the whole cleanup pass.
    BEGIN
      UPDATE salesweb_products p
      SET stock_qty  = COALESCE(p.stock_qty, 0) + oi.qty,
          updated_at = now()
      FROM (
        SELECT product_id, SUM(quantity) AS qty
        FROM   salesweb_order_items
        WHERE  order_id = r.id AND product_id IS NOT NULL
        GROUP  BY product_id
      ) oi
      WHERE p.id = oi.product_id;

      UPDATE salesweb_customer_orders
      SET status = 'Cancelled', updated_at = now()
      WHERE id = r.id;

      INSERT INTO salesweb_order_timeline (order_id, status, note, changed_by)
      VALUES (r.id, 'Cancelled', v_note, 'system');

      v_count := v_count + 1;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'release_abandoned_cash_orders: order % skipped: %', r.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'release_abandoned_cash_orders: scanned %, cancelled %', v_scanned, v_count;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION release_abandoned_cash_orders() TO anon, authenticated;
