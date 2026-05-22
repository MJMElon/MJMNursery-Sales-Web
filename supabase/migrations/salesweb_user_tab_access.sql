-- ================================================================
-- MJM Salesweb — Per-tab Access Table
-- Run in the Supabase SQL Editor (main project: kibqjztozokohqmhqqqf).
-- ================================================================
--
-- Background:
--   The salesweb admin portal needs to gate visibility of individual
--   pages (Orders, Payments, Promotions, etc.) per user. The first cut
--   stored these flags inside shared_profiles.permissions.salesweb_tabs,
--   but that JSONB column is owned by the umbrella User Access page
--   and its RLS gates writes behind the manage_users meta-permission.
--   A salesweb admin shouldn't need umbrella-wide manage_users power
--   just to tweak which tabs another salesweb user can see.
--
-- This table lives next to the rest of the salesweb_* tables and has
-- its own RLS: any salesweb_admin can write any row, any salesweb
-- user (admin or normal) can read all rows. No dependency on
-- manage_users.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.salesweb_user_tab_access (
    user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tabs        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID        REFERENCES auth.users(id)
);

COMMENT ON TABLE public.salesweb_user_tab_access IS
  'Per-tab visibility flags for salesweb admin portal users. Keyed by '
  'auth.users.id. tabs is a JSONB object of {tabKey: bool} — missing '
  'key counts as false. Owned and gated by salesweb (not the umbrella '
  'manage_users permission).';

ALTER TABLE public.salesweb_user_tab_access ENABLE ROW LEVEL SECURITY;

-- Anyone with any level of salesweb access can read every row.
-- The salesweb admin page needs the full list to render the User
-- Access table, and normal users need to read their own row on boot
-- to compute their sidebar visibility.
DROP POLICY IF EXISTS "salesweb_users_read_tab_access" ON public.salesweb_user_tab_access;
CREATE POLICY "salesweb_users_read_tab_access" ON public.salesweb_user_tab_access
    FOR SELECT TO authenticated
    USING (public._mjm_has_module('salesweb', ARRAY['admin','normal']));

-- Only salesweb_admin can insert / update / delete. _mjm_has_module is
-- SECURITY DEFINER so the policy check doesn't recurse on RLS.
DROP POLICY IF EXISTS "salesweb_admins_write_tab_access" ON public.salesweb_user_tab_access;
CREATE POLICY "salesweb_admins_write_tab_access" ON public.salesweb_user_tab_access
    FOR ALL TO authenticated
    USING      (public._mjm_has_module('salesweb', ARRAY['admin']))
    WITH CHECK (public._mjm_has_module('salesweb', ARRAY['admin']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salesweb_user_tab_access TO authenticated;

-- Keep updated_at fresh on each write.
CREATE OR REPLACE FUNCTION public.salesweb_user_tab_access_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS salesweb_user_tab_access_touch_trg ON public.salesweb_user_tab_access;
CREATE TRIGGER salesweb_user_tab_access_touch_trg
    BEFORE UPDATE ON public.salesweb_user_tab_access
    FOR EACH ROW EXECUTE FUNCTION public.salesweb_user_tab_access_touch();
