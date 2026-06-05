-- ════════════════════════════════════════════════════════════════════════════
-- Migration: Add address columns to salesweb_billing_info
-- ----------------------------------------------------------------------------
-- The checkout page asks the customer for full billing address (street +
-- city + postcode + state + country) every time but, until now, only
-- name / IC or company reg / TIN / MPOB persisted to the saved billing
-- entry. Address fields were typed fresh into the form per order, stored
-- on the order row, and never round-tripped on a future visit — which
-- meant "Edit" on a saved billing entry showed blank address fields and
-- the customer had to re-type them.
--
-- Adds the address columns so a saved billing entry is a complete copy
-- of what the customer typed. Idempotent (IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE salesweb_billing_info
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS country         text,
  ADD COLUMN IF NOT EXISTS state           text,
  ADD COLUMN IF NOT EXISTS city            text,
  ADD COLUMN IF NOT EXISTS postcode        text;

-- No backfill — existing rows simply have NULLs for these. The checkout
-- page tolerates that: when the customer edits an old entry the address
-- inputs render blank and they can fill them in once, after which every
-- future visit auto-fills them.
