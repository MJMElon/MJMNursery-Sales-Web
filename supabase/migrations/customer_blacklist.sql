-- Adds a soft blacklist flag for customers, surfaced by the Manage
-- Customers "Status" filter (Verified / Unverified / Blacklisted) and a
-- Blacklist / Unblacklist action on the customer profile.
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE shared_profiles
  ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shared_profiles_blacklisted
  ON shared_profiles(blacklisted_at)
  WHERE blacklisted_at IS NOT NULL;
