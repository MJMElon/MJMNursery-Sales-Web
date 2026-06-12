-- Re-sync every shared_al_orders row against the live qty on its linked
-- salesweb_customer_orders. For each AL whose al_number matches a sales-web
-- order_number we recompute:
--
--   collected   = OLD quantity_ordered − OLD balance_quantity  (preserved)
--   new_qty     = SUM(salesweb_order_items.quantity) for that order
--   new_balance = MAX(0, new_qty − collected)
--
-- Cancelled orders are skipped (the cancel flow handles their AL on its own).
-- Safe to re-run — only orders where qty or balance actually drift get
-- touched.
--
-- Run once in the Supabase SQL Editor.

WITH order_qty AS (
  SELECT o.id            AS order_id,
         o.order_number  AS order_number,
         COALESCE(SUM(oi.quantity), 0) AS new_qty
  FROM   salesweb_customer_orders o
  LEFT JOIN salesweb_order_items oi ON oi.order_id = o.id
  WHERE  o.status <> 'Cancelled'
    AND  o.order_number IS NOT NULL
  GROUP BY o.id, o.order_number
)
UPDATE shared_al_orders al
SET    quantity_ordered = q.new_qty,
       balance_quantity = GREATEST(
                            0,
                            q.new_qty
                            - GREATEST(0, COALESCE(al.quantity_ordered,0) - COALESCE(al.balance_quantity,0))
                          )
FROM   order_qty q
WHERE  al.al_number = q.order_number
  AND  ( COALESCE(al.quantity_ordered, -1) <> q.new_qty
      OR COALESCE(al.balance_quantity, -1) <>
         GREATEST(
           0,
           q.new_qty
           - GREATEST(0, COALESCE(al.quantity_ordered,0) - COALESCE(al.balance_quantity,0))
         ) );
