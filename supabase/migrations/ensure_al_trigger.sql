-- ════════════════════════════════════════════════════════════════════════
-- Bulletproof AL auto-creation — RPC + UPDATE trigger
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY:
--   `admin-orders.js` already tries to call createALFromOrder on the three
--   paths that should produce an AL (new credit order, new paid order,
--   status flip to Paid). But that JS path can silently fail (RLS denial,
--   network blip during the multi-statement flow, browser cache running
--   stale code, race against items insert) and the admin only sees a 15-
--   second red toast that's easy to miss. EU18B3 / 3ZMSX8 etc. all landed
--   through that crack.
--
-- WHAT THIS ADDS:
--   * Idempotent SECURITY DEFINER function `ensure_al_for_order(uuid)` —
--     creates an AL for the given order if and only if the order is in a
--     state that requires one (payment_status='Paid' OR legacy status in
--     'Paid'/'Ready for Collection'/'Completed' OR payment_terms='credit')
--     AND no AL exists yet for its order_number. Otherwise a no-op.
--     Because it's SECURITY DEFINER it bypasses RLS — the AL ALWAYS lands
--     regardless of the calling user's permissions.
--
--   * AFTER UPDATE trigger on salesweb_customer_orders that calls the
--     above function whenever `status`, `payment_status`, or `payment_terms`
--     changes. Catches every status-flip path (admin modal, edge-function
--     paid flip, bulk update, even a direct DB edit) without the JS having
--     to remember to call createALFromOrder.
--
-- NOT triggered on INSERT because admin-orders.js inserts items AFTER the
-- order, so an INSERT-time AL would see an empty items table and create
-- the AL with quantity 0. The JS submitNewOrder explicitly calls the RPC
-- after items insertion to cover the "create as Paid from scratch" path.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. The idempotent AL-builder ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_al_for_order(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o            record;
  _total_qty   integer;
  _product_names text;
  _unit_price  numeric;
  _eligible    boolean;
BEGIN
  SELECT * INTO o FROM salesweb_customer_orders WHERE id = _order_id;
  IF NOT FOUND OR o.order_number IS NULL THEN RETURN; END IF;

  -- Cancelled orders never get an AL retroactively created.
  IF COALESCE(o.order_status,'') = 'Cancelled'
     OR COALESCE(o.status,'')       = 'Cancelled' THEN
    RETURN;
  END IF;

  -- Does the order's state actually require an AL?
  _eligible :=
       COALESCE(o.payment_status, '') = 'Paid'
    OR COALESCE(o.status, '') IN ('Paid','Ready for Collection','Completed')
    OR COALESCE(o.payment_terms, '') = 'credit';

  IF NOT _eligible THEN RETURN; END IF;

  -- Already exists? Done.
  IF EXISTS (SELECT 1 FROM shared_al_orders WHERE al_number = o.order_number) THEN
    RETURN;
  END IF;

  -- Aggregate items.
  SELECT COALESCE(SUM(quantity), 0),
         COALESCE(STRING_AGG(product_name, ', '), 'Oil Palm Seedling')
    INTO _total_qty, _product_names
    FROM salesweb_order_items
   WHERE order_id = o.id;

  _unit_price := CASE WHEN _total_qty > 0
                      THEN ROUND((o.total / _total_qty)::numeric, 2)
                      ELSE 0 END;

  INSERT INTO shared_al_orders
    (al_number, order_number, order_date, customer_name, product_name,
     quantity_ordered, balance_quantity, price_per_unit, status, remark)
  VALUES (
    o.order_number, o.order_number,
    COALESCE(o.created_at, now()),
    COALESCE(o.billing_name, o.customer_name, ''),
    _product_names, _total_qty, _total_qty, _unit_price, 'Verified',
    'Auto-created via ensure_al_for_order from Sales Web Order #' || o.order_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_al_for_order(uuid) TO anon, authenticated;

-- ── 2. AFTER UPDATE trigger that calls the builder ──────────────────────
CREATE OR REPLACE FUNCTION public.salesweb_orders_ensure_al_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire when one of the relevant fields actually changed.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.status       IS DISTINCT FROM OLD.status
     OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms THEN
    PERFORM public.ensure_al_for_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesweb_orders_ensure_al_trigger ON public.salesweb_customer_orders;

CREATE TRIGGER salesweb_orders_ensure_al_trigger
  AFTER UPDATE OF status, payment_status, payment_terms
  ON public.salesweb_customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.salesweb_orders_ensure_al_trigger();

-- ── 3. One-shot backfill: every existing eligible order that doesn't
--      yet have an AL gets one (covers EU18B3 and any other orphans). ──
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM salesweb_customer_orders
     WHERE COALESCE(order_status, '') <> 'Cancelled'
       AND COALESCE(status,       '') <> 'Cancelled'
       AND (
            COALESCE(payment_status, '') = 'Paid'
         OR COALESCE(status, '') IN ('Paid','Ready for Collection','Completed')
         OR COALESCE(payment_terms, '') = 'credit'
       )
       AND order_number IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM shared_al_orders WHERE al_number = salesweb_customer_orders.order_number
       )
  LOOP
    PERFORM public.ensure_al_for_order(r.id);
  END LOOP;
END $$;
