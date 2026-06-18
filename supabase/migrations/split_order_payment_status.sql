-- ════════════════════════════════════════════════════════════════════════
-- Split salesweb_customer_orders.status → payment_status + order_status
-- ════════════════════════════════════════════════════════════════════════
--
-- WHY:
--   The old `status` column mixed two different lifecycles in one field —
--   payment progress ('Pending Payment' → 'Partially Paid' → 'Paid' →
--   'Refunded') and order progress ('Ready for Collection' → 'Completed'
--   → 'Cancelled'). Splitting them is needed so an order can be Cancelled
--   while still tracking that the customer had already Paid (or vice
--   versa), and so the admin can drive each lifecycle from its own
--   dropdown without losing information.
--
-- WHAT THIS MIGRATION DOES:
--   1. Adds two new columns:
--        payment_status (DEFAULT 'Pending Payment')  4 allowed values
--        order_status   (NULL = "Active")            3 allowed values + NULL
--   2. Backfills both from the legacy `status` column. For cancelled
--      orders, payment_status is INFERRED FROM amount_paid (not forced to
--      'Pending Payment' or 'Refunded') so it reflects what actually
--      happened — admin can mark Refunded manually later if/when a real
--      refund is issued.
--   3. Installs a dual-write trigger that keeps `status` synced with the
--      two new columns in both directions. Legacy code reading or writing
--      `status` keeps working unchanged during the rollout. Once every
--      reader / writer has been migrated, a follow-up migration can drop
--      the trigger and the column.
--
-- Safe to re-run: every step uses IF NOT EXISTS / IF EXISTS guards.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS order_status   text;

-- 2. Backfill ────────────────────────────────────────────────────────────
--    Run UPDATEs only on rows where the new columns are still NULL so the
--    migration is idempotent.
UPDATE salesweb_customer_orders
   SET payment_status = CASE status
         WHEN 'Pending Payment'      THEN 'Pending Payment'
         WHEN 'Partially Paid'       THEN 'Partially Paid'
         WHEN 'Paid'                 THEN 'Paid'
         WHEN 'Refunded'             THEN 'Refunded'
         WHEN 'Ready for Collection' THEN 'Paid'
         WHEN 'Completed'            THEN 'Paid'
         -- Cancelled: infer from money rather than guessing. amount_paid
         -- reflects what actually changed hands at cancel time. Admin can
         -- flip to 'Refunded' manually if a real refund is issued later.
         WHEN 'Cancelled' THEN
           CASE
             WHEN COALESCE(total,0) > 0
              AND COALESCE(amount_paid,0) >= COALESCE(total,0) THEN 'Paid'
             WHEN COALESCE(amount_paid,0) > 0                  THEN 'Partially Paid'
             ELSE 'Pending Payment'
           END
         ELSE 'Pending Payment'
       END
 WHERE payment_status IS NULL;

UPDATE salesweb_customer_orders
   SET order_status = CASE status
         WHEN 'Cancelled'            THEN 'Cancelled'
         WHEN 'Ready for Collection' THEN 'Ready for Collection'
         WHEN 'Completed'            THEN 'Completed'
         ELSE NULL
       END
 WHERE order_status IS NULL
   AND status IN ('Cancelled','Ready for Collection','Completed');

-- 3. Now that every row has a non-null payment_status, set the default for
--    new inserts and add the CHECK constraint.
ALTER TABLE salesweb_customer_orders
  ALTER COLUMN payment_status SET DEFAULT 'Pending Payment';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'salesweb_customer_orders_payment_status_check'
  ) THEN
    ALTER TABLE salesweb_customer_orders
      ADD CONSTRAINT salesweb_customer_orders_payment_status_check
      CHECK (payment_status IN ('Pending Payment','Partially Paid','Paid','Refunded'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'salesweb_customer_orders_order_status_check'
  ) THEN
    ALTER TABLE salesweb_customer_orders
      ADD CONSTRAINT salesweb_customer_orders_order_status_check
      CHECK (order_status IS NULL OR order_status IN ('Cancelled','Ready for Collection','Completed'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON salesweb_customer_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_order_status   ON salesweb_customer_orders(order_status);

-- 4. Dual-write trigger ──────────────────────────────────────────────────
--    Keeps the legacy `status` column synced with the two new columns
--    while every reader / writer is being migrated. Direction:
--      - If the JS writes the new columns, derive status as
--        order_status (if set) else payment_status.
--      - If the JS writes the legacy `status` column, derive both new
--        columns from it using the same backfill mapping.
CREATE OR REPLACE FUNCTION public.salesweb_orders_dual_write_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _legacy_changed   boolean := false;
  _new_changed      boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    _legacy_changed := NEW.status         IS DISTINCT FROM OLD.status;
    _new_changed    := NEW.payment_status IS DISTINCT FROM OLD.payment_status
                    OR NEW.order_status   IS DISTINCT FROM OLD.order_status;
  END IF;

  -- INSERT case: figure out which side was filled in.
  IF TG_OP = 'INSERT' THEN
    _legacy_changed := NEW.status IS NOT NULL;
    _new_changed    := NEW.payment_status IS NOT NULL OR NEW.order_status IS NOT NULL;
  END IF;

  -- When the new columns are explicitly being written, they win — keep
  -- the legacy column in sync so old readers stay coherent.
  IF _new_changed THEN
    IF NEW.payment_status IS NULL THEN NEW.payment_status := 'Pending Payment'; END IF;
    NEW.status := COALESCE(NEW.order_status, NEW.payment_status);
    RETURN NEW;
  END IF;

  -- Otherwise (legacy-only write) — derive the new columns from `status`.
  IF _legacy_changed AND NEW.status IS NOT NULL THEN
    NEW.payment_status := CASE NEW.status
      WHEN 'Pending Payment'      THEN 'Pending Payment'
      WHEN 'Partially Paid'       THEN 'Partially Paid'
      WHEN 'Paid'                 THEN 'Paid'
      WHEN 'Refunded'             THEN 'Refunded'
      WHEN 'Ready for Collection' THEN 'Paid'
      WHEN 'Completed'            THEN 'Paid'
      WHEN 'Cancelled' THEN
        CASE
          WHEN COALESCE(NEW.total,0) > 0
           AND COALESCE(NEW.amount_paid,0) >= COALESCE(NEW.total,0) THEN 'Paid'
          WHEN COALESCE(NEW.amount_paid,0) > 0                      THEN 'Partially Paid'
          ELSE COALESCE(OLD.payment_status, 'Pending Payment')
        END
      ELSE COALESCE(OLD.payment_status, 'Pending Payment')
    END;
    NEW.order_status := CASE NEW.status
      WHEN 'Cancelled'            THEN 'Cancelled'
      WHEN 'Ready for Collection' THEN 'Ready for Collection'
      WHEN 'Completed'            THEN 'Completed'
      ELSE NULL
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesweb_orders_dual_write_status_trigger ON salesweb_customer_orders;

CREATE TRIGGER salesweb_orders_dual_write_status_trigger
  BEFORE INSERT OR UPDATE OF status, payment_status, order_status
  ON salesweb_customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.salesweb_orders_dual_write_status();
