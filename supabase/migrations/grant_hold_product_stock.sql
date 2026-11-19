-- Grant EXECUTE on hold_product_stock to authenticated so the admin
-- portal can call it directly when reactivating a cancelled order.
--
-- The function was created SECURITY DEFINER by
-- supabase/migrations/salesweb_inventory_history.sql with the same
-- GRANT at the bottom of that file, but admins who never ran the
-- inventory_history migration (or ran an earlier version that only
-- installed restore_order_stock) end up with the function present
-- yet unreachable:
--
--   ERROR: permission denied for function hold_product_stock
--
-- which breaks the "flip a cancelled order back to Pending Payment
-- and re-reserve stock" path shipped in PR #359.
--
-- This migration is idempotent and safe to run on a DB that already
-- has the grant applied.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_proc p
    JOIN   pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname = 'hold_product_stock'
  ) THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.hold_product_stock(UUID, INTEGER) FROM PUBLIC';
    EXECUTE 'GRANT  EXECUTE ON FUNCTION public.hold_product_stock(UUID, INTEGER) TO authenticated';
  END IF;
END$$;
