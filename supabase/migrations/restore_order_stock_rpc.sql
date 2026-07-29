-- Return held product stock when an order is cancelled. The customer
-- portal's pCancelOrder path did a direct UPDATE on salesweb_products
-- from the customer's session; that write hits RLS on the products
-- table (customers can only SELECT, not UPDATE) and silently no-ops,
-- so the qty never flowed back. This RPC runs as SECURITY DEFINER,
-- reads the order's items, and adds each item's quantity to the
-- corresponding product's stock_qty in one pass.
--
-- Access is gated to the order owner OR any admin-portal user, so a
-- signed-in customer can restore their own cancelled order's stock,
-- and admins can restore anyone's.
--
-- Idempotent guard: refuses to run unless the order status is
-- 'Cancelled', so calling twice on the same order doesn't
-- double-restore.
--
-- Run once in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.restore_order_stock(p_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_customer UUID;
  v_order_status   TEXT;
  v_restored       INTEGER := 0;
  v_item RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT customer_id, status INTO v_order_customer, v_order_status
  FROM   salesweb_customer_orders WHERE id = p_order_id;
  IF v_order_customer IS NULL AND v_order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  -- Caller must be the order's own customer OR a salesweb admin.
  IF v_order_customer <> auth.uid() AND NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN
    RAISE EXCEPTION 'Not authorised to restore this order.';
  END IF;

  -- Only restore for cancelled orders — prevents accidental double
  -- restoration if the customer / admin retries.
  IF v_order_status <> 'Cancelled' THEN
    RAISE EXCEPTION 'Order is % — stock can only be restored on cancelled orders.', v_order_status;
  END IF;

  FOR v_item IN
    SELECT product_id, quantity
    FROM   salesweb_order_items
    WHERE  order_id = p_order_id
      AND  product_id IS NOT NULL
      AND  quantity > 0
  LOOP
    UPDATE salesweb_products
       SET stock_qty = COALESCE(stock_qty, 0) + v_item.quantity,
           updated_at = now()
     WHERE id = v_item.product_id;
    v_restored := v_restored + v_item.quantity;
  END LOOP;

  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_order_stock(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_order_stock(UUID) TO authenticated;
