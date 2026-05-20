-- App Settings table for points config, member tiers, etc.
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read
CREATE POLICY "Allow read for authenticated" ON app_settings FOR SELECT TO authenticated USING (true);

-- Allow admin to update (via service role or anon for now)
CREATE POLICY "Allow all for anon" ON app_settings FOR ALL TO anon USING (true) WITH CHECK (true);

-- Also ensure profiles has phone column
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- Ensure order_number column exists
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS order_number TEXT UNIQUE;
