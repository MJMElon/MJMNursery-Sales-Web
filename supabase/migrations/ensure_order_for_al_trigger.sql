-- Verified AL -> matching Sales Web order, automatically.
--
-- shared_al_orders and salesweb_customer_orders only ever joined by
-- order_number text, and nothing ever created the order side: an AL raised
-- directly in the AI system (bulk/manual entry, no Sales Web order behind
-- it) stayed an "orphan" forever once Verified, invisible to Customer
-- Booking and Collection tabs of Customer Order Management, counted only
-- in the Allocate FAB badge with no button anywhere to act on it.
-- Restoring a cancelled AL and re-verifying it did not fix this either.
--
-- ensure_order_for_al(uuid) is the reverse of the existing
-- ensure_al_for_order(uuid) (see ensure_al_trigger.sql in the Sales Web
-- repo, which auto-creates an AL from a Sales Web order going Paid). This
-- does the opposite: whenever the status of an AL becomes Verified, it
-- makes sure a salesweb_customer_orders row exists for its order_number -
-- creating one if none exists at all, or un-cancelling one that was
-- auto-cancelled earlier by this same AL being cancelled. Customer Order
-- Management already overrides the quantity and balance of a linked order
-- with the figures carried on the AL itself (loadCustomerOrders in
-- operation_stock_sales.js), so the created row only has to exist with a
-- non-cancelled status.
--
-- Safe to run twice: CREATE OR REPLACE and DROP TRIGGER IF EXISTS, and the
-- backfill only inserts where nothing already matches the order_number.
--
-- shared_al_orders.id is bigint, not uuid - the first version of this file
-- guessed uuid (salesweb_customer_orders.id really is one, which is
-- probably where the guess came from) and Postgres refused the backfill
-- with "function public.ensure_order_for_al(bigint) does not exist" the
-- moment it was actually run. The DROP below removes that wrongly-typed
-- function before recreating it with the type the column actually has, so
-- a database that already ran the first version does not end up with two
-- overloads sitting side by side.

DROP FUNCTION IF EXISTS public.ensure_order_for_al(uuid);

CREATE OR REPLACE FUNCTION public.ensure_order_for_al(_al_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  al        record;
  existing  record;
  new_id    uuid;
BEGIN
  SELECT * INTO al FROM shared_al_orders WHERE id = _al_id;
  IF NOT FOUND OR al.order_number IS NULL OR al.status <> 'Verified' THEN RETURN; END IF;

  SELECT id, status INTO existing FROM salesweb_customer_orders WHERE order_number = al.order_number LIMIT 1;

  IF FOUND THEN
    IF existing.status = 'Cancelled' THEN
      UPDATE salesweb_customer_orders
         SET status = 'Paid', updated_at = now()
       WHERE id = existing.id;
      INSERT INTO salesweb_order_timeline (order_id, status, note, changed_by)
      VALUES (existing.id, 'Paid',
              'Restored because linked AL ' || al.al_number || ' was restored and re-verified in AI system.',
              'ai-system');
    END IF;
    RETURN;
  END IF;

  INSERT INTO salesweb_customer_orders
    (order_number, customer_name, billing_name, total, status, payment_terms, created_at)
  VALUES (
    al.order_number,
    al.customer_name,
    al.customer_name,
    COALESCE(al.price_per_unit, 0) * COALESCE(al.quantity_ordered, 0),
    'Paid',
    'cash',
    COALESCE(al.order_date, now())
  )
  RETURNING id INTO new_id;

  INSERT INTO salesweb_order_timeline (order_id, status, note, changed_by)
  VALUES (new_id, 'Paid',
          'Order created from AL ' || al.al_number || ', raised directly in AI system (no original Sales Web order).',
          'ai-system');
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_order_for_al(bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.shared_al_orders_ensure_order_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.ensure_order_for_al(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shared_al_orders_ensure_order_trigger ON public.shared_al_orders;

CREATE TRIGGER shared_al_orders_ensure_order_trigger
  AFTER UPDATE OF status
  ON public.shared_al_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.shared_al_orders_ensure_order_trigger();

-- One-shot backfill: every AL already sitting at Verified gets checked now,
-- not only the next time its status changes - this is what pulls the Coco
-- Lau AL (and any other already-Verified orphan) in immediately rather
-- than waiting for it to be touched again.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM shared_al_orders WHERE status = 'Verified'
  LOOP
    PERFORM public.ensure_order_for_al(r.id);
  END LOOP;
END $$;

-- Check: every Verified AL should now have a linked order, and the row
-- the office actually reported (match it by order_number or customer
-- name below) should show PAID / present. A good result is "still
-- missing" at 0 and "ABWST0 / Coco Lau" showing FOUND.
SELECT 'Verified ALs, total' AS item, count(*)::text AS result
  FROM shared_al_orders WHERE status = 'Verified'
UNION ALL
SELECT 'Verified ALs still missing a linked order (should be 0)',
       count(*)::text
  FROM shared_al_orders al
 WHERE al.status = 'Verified'
   AND al.order_number IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM salesweb_customer_orders o WHERE o.order_number = al.order_number
   )
UNION ALL
SELECT 'ABWST0 / Coco Lau order (should be FOUND)',
       COALESCE(
         (SELECT 'FOUND - status ' || o.status
            FROM salesweb_customer_orders o
           WHERE o.order_number ILIKE '%ABWST0%' OR o.customer_name ILIKE '%coco%'
           LIMIT 1),
         'NOT FOUND'
       );
