-- Per-product inventory history — an append-only ledger of every
-- stock movement so admin can see when stock was added, deducted,
-- or restored, and by which order.
--
-- Populated two ways:
--   1. The AFTER-UPDATE trigger below fires on any change to
--      salesweb_products.stock_qty and logs a row with a heuristic
--      action ('Item restocked' when delta > 0, 'Manual adjustment'
--      when delta < 0). Any direct UPDATE from the admin UI is
--      captured this way, no client-side code needed.
--
--   2. The order-side RPCs (hold_product_stock, restore_order_stock)
--      set a transaction-scoped GUC 'mjm.stock_logged' = '1' so the
--      trigger skips their UPDATE, then explicitly INSERT a history
--      row with the full order context (action='Order placed' or
--      'Order restored', ref_id, ref_number). That's how the
--      reference screenshot's 'Order placed #1625' / 'Order restored
--      #1606' rows get their order links.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.salesweb_inventory_history (
  id            BIGSERIAL     PRIMARY KEY,
  product_id    UUID          NOT NULL REFERENCES public.salesweb_products(id) ON DELETE CASCADE,
  delta         INTEGER       NOT NULL,        -- signed: + is stock added, - is stock removed
  balance_after INTEGER       NOT NULL,        -- stock_qty AFTER this movement
  action        TEXT          NOT NULL,        -- 'Order placed' | 'Order restored' | 'Item restocked' | 'Manual adjustment'
  ref_id        UUID,                          -- order_id when the change came from an order
  ref_number    TEXT,                          -- order_number for display
  note          TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_history_product_date
  ON public.salesweb_inventory_history (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_history_ref
  ON public.salesweb_inventory_history (ref_id)
  WHERE ref_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Trigger — logs stock_qty changes not already logged by an RPC.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._sw_log_stock_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor TEXT;
BEGIN
  -- Order-side RPCs set this GUC before their UPDATE so they can log
  -- with richer context (action + ref_id) after the fact.
  IF COALESCE(current_setting('mjm.stock_logged', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(OLD.stock_qty, 0) = COALESCE(NEW.stock_qty, 0) THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT email INTO v_actor FROM auth.users WHERE id = auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;
  v_actor := COALESCE(v_actor, 'system');

  INSERT INTO salesweb_inventory_history
    (product_id, delta, balance_after, action, created_by)
  VALUES
    (NEW.id,
     COALESCE(NEW.stock_qty,0) - COALESCE(OLD.stock_qty,0),
     COALESCE(NEW.stock_qty,0),
     CASE WHEN COALESCE(NEW.stock_qty,0) > COALESCE(OLD.stock_qty,0)
          THEN 'Item restocked' ELSE 'Manual adjustment' END,
     v_actor);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_stock_change ON public.salesweb_products;
CREATE TRIGGER trg_log_stock_change
  AFTER UPDATE ON public.salesweb_products
  FOR EACH ROW
  EXECUTE FUNCTION public._sw_log_stock_change();

-- ─────────────────────────────────────────────────────────────────────
-- Extend the order-side RPCs so they log with order context.
-- ─────────────────────────────────────────────────────────────────────

-- hold_product_stock: called at checkout to reserve seedlings.
CREATE OR REPLACE FUNCTION public.hold_product_stock(p_product_id UUID, p_qty INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_stock INTEGER;
  v_order_no  TEXT;
  v_actor     TEXT;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Qty must be positive.';
  END IF;

  -- Silence the trigger for our own UPDATE so we can log with richer
  -- context afterwards. SET LOCAL scopes to this transaction.
  PERFORM set_config('mjm.stock_logged', '1', true);

  UPDATE salesweb_products
     SET stock_qty  = GREATEST(0, COALESCE(stock_qty, 0) - p_qty),
         updated_at = now()
   WHERE id = p_product_id
  RETURNING stock_qty INTO v_new_stock;

  IF v_new_stock IS NULL THEN
    RAISE EXCEPTION 'Product not found.';
  END IF;

  -- Best-effort context: pick the newest order that has this product
  -- in its items list — the checkout call that just added the item.
  BEGIN
    SELECT o.order_number
      INTO v_order_no
      FROM salesweb_order_items i
      JOIN salesweb_customer_orders o ON o.id = i.order_id
     WHERE i.product_id = p_product_id
     ORDER BY o.created_at DESC
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_order_no := NULL;
  END;

  BEGIN
    SELECT email INTO v_actor FROM auth.users WHERE id = auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  INSERT INTO salesweb_inventory_history
    (product_id, delta, balance_after, action, ref_number, created_by)
  VALUES
    (p_product_id, -p_qty, v_new_stock, 'Order placed', v_order_no, COALESCE(v_actor, 'system'));

  RETURN v_new_stock;
END;
$$;

REVOKE ALL ON FUNCTION public.hold_product_stock(UUID, INTEGER) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.hold_product_stock(UUID, INTEGER) TO authenticated;

-- restore_order_stock: called when an order is cancelled. Extend to
-- also log a history row per product it restores.
CREATE OR REPLACE FUNCTION public.restore_order_stock(p_order_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_customer UUID;
  v_order_status   TEXT;
  v_order_number   TEXT;
  v_restored       INTEGER := 0;
  v_item RECORD;
  v_actor          TEXT;
  v_new_stock      INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT customer_id, status, order_number
    INTO v_order_customer, v_order_status, v_order_number
  FROM   salesweb_customer_orders WHERE id = p_order_id;
  IF v_order_customer IS NULL AND v_order_status IS NULL THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;

  IF v_order_customer <> auth.uid() AND NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN
    RAISE EXCEPTION 'Not authorised to restore this order.';
  END IF;

  IF v_order_status <> 'Cancelled' THEN
    RAISE EXCEPTION 'Order is % — stock can only be restored on cancelled orders.', v_order_status;
  END IF;

  BEGIN
    SELECT email INTO v_actor FROM auth.users WHERE id = auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_actor := NULL;
  END;

  FOR v_item IN
    SELECT product_id, quantity
    FROM   salesweb_order_items
    WHERE  order_id = p_order_id
      AND  product_id IS NOT NULL
      AND  quantity > 0
  LOOP
    -- Silence the trigger for our UPDATE, then log with order context.
    PERFORM set_config('mjm.stock_logged', '1', true);
    UPDATE salesweb_products
       SET stock_qty = COALESCE(stock_qty, 0) + v_item.quantity,
           updated_at = now()
     WHERE id = v_item.product_id
    RETURNING stock_qty INTO v_new_stock;

    INSERT INTO salesweb_inventory_history
      (product_id, delta, balance_after, action, ref_id, ref_number, created_by)
    VALUES
      (v_item.product_id, v_item.quantity, COALESCE(v_new_stock, 0),
       'Order restored', p_order_id, v_order_number, COALESCE(v_actor, 'system'));

    v_restored := v_restored + v_item.quantity;
  END LOOP;

  RETURN v_restored;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_order_stock(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.restore_order_stock(UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- RLS — admin-portal users only can read history.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.salesweb_inventory_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_history_admin_read ON public.salesweb_inventory_history;
CREATE POLICY inventory_history_admin_read ON public.salesweb_inventory_history
  FOR SELECT
  USING (public._sw_is_admin());
