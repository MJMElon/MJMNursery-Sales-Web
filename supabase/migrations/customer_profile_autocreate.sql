-- ════════════════════════════════════════════════════════════════════════════
-- Migration: a customer sign-up always gets a customer-list row
-- ----------------------------------------------------------------------------
-- WHY "USER ALREADY REGISTERED" BUT NOT IN THE CUSTOMER LIST
--
-- Signing up is two steps: auth.signUp creates the LOGIN (auth.users, owned
-- by Supabase Auth), then the BROWSER writes the customer row into
-- shared_profiles — and the admin Customer List reads shared_profiles. If
-- that second write fails (page closed too soon, signal lost, or RLS refused
-- the write because sign-ups with email confirmation have no session yet to
-- write with), the login exists and the customer row does not. From then on:
-- registering again says "User already registered", signing in works, and
-- the admin list has never heard of them. The browser code never checked
-- whether the second step worked, so nobody saw it fail.
--
-- THE FIX: the database creates the row itself, in the same transaction that
-- creates the login. A trigger on auth.users fires on every sign-up that
-- carries user_type='customer' in its metadata (the sales-web sign-up always
-- sends it) and inserts the shared_profiles row. No browser step, no session
-- needed, nothing to silently fail. Staff accounts (no customer marker) are
-- untouched, so office-side account flows keep working exactly as before.
--
-- This file also BACKFILLS: every existing login with no shared_profiles row
-- at all gets one as a customer, which is what puts the already-orphaned
-- sign-ups (e.g. mjmp.puigroups@gmail.com) into the Customer List. Office
-- staff all have profile rows already — a login with none is a stranded
-- customer sign-up.
--
-- Run in the Supabase SQL Editor. Safe to run twice: the trigger is replaced
-- in place and the backfill only fills rows that are missing.
-- ════════════════════════════════════════════════════════════════════════════


-- ── 1. THE TRIGGER ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_customer()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'user_type' = 'customer' THEN
    INSERT INTO public.shared_profiles (id, email, full_name, role, user_type)
    VALUES (NEW.id,
            NEW.email,
            COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NEW.email),
            'customer',
            'customer')
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_customer_created ON auth.users;
CREATE TRIGGER on_auth_customer_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_customer();


-- ── 2. BACKFILL THE ORPHANS ─────────────────────────────────────
-- Logins with no profile row at all. Collected into a temp table so the
-- check below can show exactly who was rescued.
DROP TABLE IF EXISTS _rescued;
CREATE TEMP TABLE _rescued (email TEXT);

WITH ins AS (
  INSERT INTO public.shared_profiles (id, email, full_name, role, user_type)
  SELECT u.id,
         u.email,
         COALESCE(NULLIF(u.raw_user_meta_data->>'full_name', ''), u.email),
         'customer',
         'customer'
  FROM   auth.users u
  WHERE  NOT EXISTS (SELECT 1 FROM public.shared_profiles p WHERE p.id = u.id)
  ON CONFLICT (id) DO NOTHING
  RETURNING email
)
INSERT INTO _rescued SELECT email FROM ins;


NOTIFY pgrst, 'reload schema';


-- ── 3. DID IT TAKE? ─────────────────────────────────────────────
-- First two rows say the machinery is in; every row after is a rescued
-- sign-up that will now appear in the admin Customer List. Expect
-- mjmp.puigroups@gmail.com among them. On a second run the rescued list is
-- empty — that is correct, there is nobody left to rescue.
SELECT 'trigger' AS what,
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgname = 'on_auth_customer_created'
                           AND tgrelid = 'auth.users'::regclass)
            THEN 'OK — every customer sign-up now writes its own list row'
            ELSE 'MISSING' END AS detail
UNION ALL
SELECT 'rescued this run', count(*)::text || ' login(s) with no profile row were added to the customer list'
FROM _rescued
UNION ALL
SELECT 'now in customer list', email FROM _rescued
ORDER BY 1, 2;
