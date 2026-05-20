-- Add order_number column to customer_orders
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS order_number TEXT UNIQUE;

-- Backfill existing orders with a generated number
UPDATE customer_orders
SET order_number = UPPER(
  CHR(65 + FLOOR(RANDOM() * 26)::INT) ||
  FLOOR(RANDOM() * 10)::INT ||
  CHR(65 + FLOOR(RANDOM() * 26)::INT) ||
  FLOOR(RANDOM() * 10)::INT ||
  CHR(65 + FLOOR(RANDOM() * 26)::INT) ||
  FLOOR(RANDOM() * 10)::INT
)
WHERE order_number IS NULL;
