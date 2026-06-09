-- Customer Groups feature — group customers together so coupons /
-- promotions can target a specific cohort (e.g. "Loyalty VIP",
-- "Wholesale", "Trade Show 2026").
--
-- Two tables: the group itself, and an explicit many-to-many membership
-- so a customer can belong to several groups and the lookup is fast.
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS salesweb_customer_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  color       TEXT,                    -- optional hex like '#7c5cbf' for the badge tint
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salesweb_customer_group_members (
  group_id    UUID NOT NULL REFERENCES salesweb_customer_groups(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES shared_profiles(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, customer_id)
);

CREATE INDEX IF NOT EXISTS idx_cust_group_members_customer
  ON salesweb_customer_group_members (customer_id);

-- RLS — admins access via the existing salesweb permission gate.
ALTER TABLE salesweb_customer_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE salesweb_customer_group_members ENABLE ROW LEVEL SECURITY;

-- Allow authenticated admins (anyone with a salesweb permission ≠ none, or
-- the legacy role='admin') to read + write groups. Customers can read
-- their own group memberships (used to evaluate coupon eligibility).
DROP POLICY IF EXISTS "admin reads groups" ON salesweb_customer_groups;
CREATE POLICY "admin reads groups" ON salesweb_customer_groups
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM shared_profiles p
      WHERE p.id = auth.uid()
        AND ( p.role='admin'
              OR (p.permissions->'modules'->>'salesweb') IN ('admin','normal') )
    )
  );

DROP POLICY IF EXISTS "admin writes groups" ON salesweb_customer_groups;
CREATE POLICY "admin writes groups" ON salesweb_customer_groups
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM shared_profiles p
      WHERE p.id = auth.uid()
        AND ( p.role='admin'
              OR (p.permissions->'modules'->>'salesweb') IN ('admin','normal') )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM shared_profiles p
      WHERE p.id = auth.uid()
        AND ( p.role='admin'
              OR (p.permissions->'modules'->>'salesweb') IN ('admin','normal') )
    )
  );

DROP POLICY IF EXISTS "admin manages members" ON salesweb_customer_group_members;
CREATE POLICY "admin manages members" ON salesweb_customer_group_members
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM shared_profiles p
      WHERE p.id = auth.uid()
        AND ( p.role='admin'
              OR (p.permissions->'modules'->>'salesweb') IN ('admin','normal') )
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM shared_profiles p
      WHERE p.id = auth.uid()
        AND ( p.role='admin'
              OR (p.permissions->'modules'->>'salesweb') IN ('admin','normal') )
    )
  );

-- Customer can read their own memberships (so preview_coupon can evaluate
-- group eligibility when it's wired up later).
DROP POLICY IF EXISTS "customer reads own memberships" ON salesweb_customer_group_members;
CREATE POLICY "customer reads own memberships" ON salesweb_customer_group_members
  FOR SELECT TO authenticated USING (customer_id = auth.uid());
