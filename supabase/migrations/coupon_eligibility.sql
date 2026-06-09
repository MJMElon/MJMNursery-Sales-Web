-- Adds a customer-eligibility setting to the coupons table, stored as a
-- single JSONB so we can extend it (selected customers, tier names,
-- groups…) without further migrations.
--
-- Shape (JSON):
--   { "type": "public" | "all_members" | "groups" | "customers" | "tiers",
--     "customer_ids": ["<uuid>", …],          -- when type = customers
--     "tier_names":   ["Basic Member", …],     -- when type = tiers
--     "group_ids":    ["<id>", …]              -- when type = groups (reserved)
--   }
--
-- Defaults to NULL (interpreted as "all_members" — the previous behaviour).
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE salesweb_coupons
  ADD COLUMN IF NOT EXISTS eligibility JSONB;

-- Partial index for the "customers" eligibility, in case a future feature
-- needs to look up coupons by a specific customer id.
CREATE INDEX IF NOT EXISTS idx_coupons_eligibility_type
  ON salesweb_coupons ((eligibility->>'type'))
  WHERE eligibility IS NOT NULL;
