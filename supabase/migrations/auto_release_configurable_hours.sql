-- Makes the cash-order auto-release window configurable from the admin
-- Settings tab instead of being hard-coded to 48h.
--
-- The setting lives in salesweb_app_settings under key 'order_auto_release'
-- as JSON: {"enabled": true, "hours": 48}
--   enabled = false  → no auto-release at all (stock always kept)
--   hours            → how long a CASH-term order may sit Pending Payment
--                      before its stock is returned and the order cancelled
-- Credit-term orders are never auto-released regardless of this setting.
--
-- Run once in the Supabase SQL Editor (safe to run even if the earlier
-- auto_release_abandoned_cash_orders.sql was already applied — this just
-- replaces the function and seeds a default setting row).

-- Seed a default setting row if none exists yet.
INSERT INTO salesweb_app_settings (key, value)
VALUES ('order_auto_release', '{"enabled":true,"hours":48}')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION release_abandoned_cash_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count   integer := 0;
  v_hours   numeric := 48;
  v_enabled boolean := true;
  v_raw     text;
  r RECORD;
BEGIN
  -- Read the configurable window from app settings (defaults: enabled, 48h).
  SELECT value INTO v_raw FROM salesweb_app_settings WHERE key = 'order_auto_release';
  IF v_raw IS NOT NULL THEN
    BEGIN
      v_hours   := COALESCE((v_raw::jsonb ->> 'hours')::numeric, 48);
      v_enabled := COALESCE((v_raw::jsonb ->> 'enabled')::boolean, true);
    EXCEPTION WHEN others THEN
      v_hours := 48; v_enabled := true;
    END;
  END IF;

  IF NOT v_enabled OR v_hours IS NULL OR v_hours <= 0 THEN
    RETURN 0;  -- auto-release disabled
  END IF;

  FOR r IN
    SELECT id
    FROM salesweb_customer_orders
    WHERE status = 'Pending Payment'
      AND COALESCE(payment_terms, 'cash') <> 'credit'   -- cash / null only
      AND created_at < now() - (v_hours * interval '1 hour')
      AND deleted_at IS NULL
  LOOP
    UPDATE salesweb_products p
    SET stock_qty = COALESCE(p.stock_qty, 0) + oi.qty,
        updated_at = now()
    FROM (
      SELECT product_id, SUM(quantity) AS qty
      FROM salesweb_order_items
      WHERE order_id = r.id AND product_id IS NOT NULL
      GROUP BY product_id
    ) oi
    WHERE p.id = oi.product_id;

    UPDATE salesweb_customer_orders
    SET status = 'Cancelled', updated_at = now()
    WHERE id = r.id;

    INSERT INTO salesweb_order_timeline (order_id, status, note, changed_by)
    VALUES (r.id, 'Cancelled',
            'Auto-cancelled — cash order unpaid for ' || v_hours || 'h; stock returned',
            'system');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION release_abandoned_cash_orders() TO anon, authenticated;
