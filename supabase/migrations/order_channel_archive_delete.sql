-- Adds order-bucketing columns referenced by the admin filter sidebar:
--   channel     — where the order came from. Captured at order creation:
--                   'online_store' (customer checkout in payment.html)
--                   'admin_panel'  (+ Add Order in admin)
--                 Reserved for future entry points: 'shopping_app',
--                 'google', 'whatsapp'.
--   archived_at — soft archive. Order stays in the database but is hidden
--                 from the default Manage Orders list. Surfaced via the
--                 "Archived" filter checkbox.
--   deleted_at  — soft delete. Order is hidden everywhere except when the
--                 "Deleted" filter is explicitly selected.
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS channel      TEXT,
  ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;

-- Partial indexes — only worth indexing the (small) rows that are flagged.
CREATE INDEX IF NOT EXISTS idx_orders_channel
  ON salesweb_customer_orders(channel)
  WHERE channel IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_archived_at
  ON salesweb_customer_orders(archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_deleted_at
  ON salesweb_customer_orders(deleted_at)
  WHERE deleted_at IS NOT NULL;
