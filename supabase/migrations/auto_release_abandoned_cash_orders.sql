-- Auto-release stock from abandoned CASH-term orders.
--
-- Rule: a Pending Payment order on CASH terms that has sat unpaid for more
-- than 48 hours is auto-cancelled and its held stock is returned to the
-- products. CREDIT-term orders are NEVER auto-released — their stock is
-- always kept (the company bills them monthly).
--
-- Run once in the Supabase SQL Editor. The function is also called
-- opportunistically from the admin Manage Orders page, so it works even if
-- you don't set up the cron schedule below.

CREATE OR REPLACE FUNCTION release_abandoned_cash_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id
    FROM salesweb_customer_orders
    WHERE payment_status = 'Pending Payment'
      AND order_status IS NULL                          -- still Active
      AND COALESCE(payment_terms, 'cash') <> 'credit'   -- cash / null only
      AND created_at < now() - interval '48 hours'
      AND deleted_at IS NULL
  LOOP
    -- Return each line item's quantity to its product's stock.
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

    -- Cancel the order so it can't be paid after its stock was released.
    -- Only order_status changes; payment_status stays 'Pending Payment'.
    UPDATE salesweb_customer_orders
    SET order_status = 'Cancelled', updated_at = now()
    WHERE id = r.id;

    -- Audit trail on the order timeline.
    INSERT INTO salesweb_order_timeline (order_id, status, note, changed_by)
    VALUES (r.id, 'Cancelled', 'Auto-cancelled — cash order unpaid for 48h; stock returned', 'system');

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Allow the app (anon / authenticated) to trigger the cleanup via RPC.
GRANT EXECUTE ON FUNCTION release_abandoned_cash_orders() TO anon, authenticated;

-- ── Optional: fully-automatic schedule via pg_cron ─────────────────────────
-- Enable pg_cron once (Supabase: Dashboard → Database → Extensions → pg_cron,
-- or the line below), then schedule the cleanup to run every 30 minutes.
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule(
--     'release-abandoned-cash-orders',
--     '*/30 * * * *',
--     $$ SELECT release_abandoned_cash_orders(); $$
--   );
--
-- To remove the schedule later:
--   SELECT cron.unschedule('release-abandoned-cash-orders');
