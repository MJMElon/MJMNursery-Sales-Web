-- ════════════════════════════════════════════════════════════════════════════
-- Migration: Salesweb admins can SELECT all shared_profiles rows
-- ----------------------------------------------------------------------------
-- The customer-list tab in the salesweb admin (admin.html → Customers) reads
-- shared_profiles directly with the user's session (not the service role
-- key). If RLS is enabled on shared_profiles and there is no admin SELECT
-- policy, the admin only sees their own row — which isn't a customer — and
-- the list shows "No customers yet" even though customers exist.
--
-- This migration adds a SELECT-all policy that grants salesweb admins
-- (anyone with role='admin' or permissions.modules.salesweb in ('admin',
-- 'normal')) read access to every shared_profiles row. The salesweb-only
-- email signups are still segregated at the application layer (the
-- customer list filters to user_type='customer' or role='customer'), so
-- nothing about who shows up in the admin UI changes — this policy just
-- unblocks the read.
--
-- Idempotent: safe to re-run.
-- Depends on the is_salesweb_admin() helper added by customer_orders_rls.sql.
-- ════════════════════════════════════════════════════════════════════════════

-- shared_profiles may or may not already have RLS enabled; either way is fine.
ALTER TABLE shared_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shared_profiles_salesweb_admin_select ON shared_profiles;
CREATE POLICY shared_profiles_salesweb_admin_select
    ON shared_profiles FOR SELECT
    USING (is_salesweb_admin());

-- Note: this does NOT add INSERT/UPDATE/DELETE policies. The customer-list
-- view is read-only; profile mutations still happen through the user's own
-- session (each user can edit their own row via the existing
-- "users can manage their own profile" policy, if present) or via the
-- service-role key from Edge Functions.
