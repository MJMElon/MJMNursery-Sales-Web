-- ================================================================
-- MJM Salesweb -- Contact Us, part 5. The people who handle cases.
-- Run in the Supabase SQL Editor after part 4. Safe to run more than once.
-- ================================================================
--
-- 1. salesweb_message_pics is the list of people who may be assigned a
--    case. It is picked on the Messages tab Settings from everybody who
--    has access to the admin portal. Each person also carries two ticks,
--    tell them when a new case comes in, and tell them when a case is
--    solved. Name and email come from their profile, the WhatsApp number
--    from salesweb_message_staff_phone or their profile, as before.
--
-- 2. salesweb_message_assignees() now lists only the people on that list,
--    so Assigned To shows exactly them.
--
-- 3. salesweb_portal_staff() is what the search box on Settings reads.
--    Everybody with admin portal access, and whether they are on the list.
--
-- 4. The first time this runs the list is filled from what is already
--    there, so nothing goes quiet. Everybody already assigned to a case is
--    added. Every address on the old new-message email list that belongs
--    to a portal user is added with New case ticked. An old address that
--    belongs to nobody in the portal cannot be added and is counted in the
--    check below. A second run adds nothing, so somebody removed stays
--    removed.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.salesweb_message_pics (
    user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    notify_new     BOOLEAN     NOT NULL DEFAULT FALSE,
    notify_solved  BOOLEAN     NOT NULL DEFAULT FALSE,
    added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by       TEXT
);
ALTER TABLE public.salesweb_message_pics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "salesweb_message_pics_staff" ON public.salesweb_message_pics;
CREATE POLICY "salesweb_message_pics_staff" ON public.salesweb_message_pics
  FOR ALL TO authenticated
  USING (public.salesweb_is_message_staff()) WITH CHECK (public.salesweb_is_message_staff());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salesweb_message_pics TO authenticated;
REVOKE ALL ON public.salesweb_message_pics FROM anon;

-- ── Fill it once, from what is already there ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.salesweb_message_pics) THEN
    INSERT INTO public.salesweb_message_pics (user_id, added_by)
    SELECT DISTINCT m.assigned_user_id, 'carried over'
      FROM public.salesweb_messages m
      JOIN auth.users u ON u.id = m.assigned_user_id
     WHERE m.assigned_user_id IS NOT NULL
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.salesweb_message_pics (user_id, notify_new, added_by)
    SELECT DISTINCT u.id, TRUE, 'carried over'
      FROM public.salesweb_message_notify_emails e
      JOIN auth.users u ON lower(u.email) = lower(e.email)
      JOIN public.shared_profiles p ON p.id = u.id
     WHERE COALESCE(p.permissions::jsonb -> 'modules' ->> 'salesweb',
                    CASE WHEN p.role::TEXT = 'admin' THEN 'admin' ELSE 'none' END) IN ('admin', 'normal')
    ON CONFLICT (user_id) DO UPDATE SET notify_new = TRUE;
  END IF;
END $$;

-- ── Assigned To lists only the people on the list ─────────────────
CREATE OR REPLACE FUNCTION public.salesweb_message_assignees()
RETURNS TABLE (user_id UUID, name TEXT, email TEXT, phone TEXT, phone_source TEXT, level TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.salesweb_is_message_staff() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT u.id::UUID,
         COALESCE(NULLIF(p.full_name::TEXT, ''), NULLIF(u.raw_user_meta_data ->> 'full_name', ''), u.email::TEXT, 'Staff')::TEXT,
         COALESCE(NULLIF(p.email::TEXT, ''), u.email::TEXT)::TEXT,
         COALESCE(NULLIF(sp.phone, ''), NULLIF(p.phone::TEXT, ''))::TEXT,
         (CASE WHEN NULLIF(sp.phone, '') IS NOT NULL THEN 'messages'
               WHEN NULLIF(p.phone::TEXT, '') IS NOT NULL THEN 'profile'
               ELSE 'none' END)::TEXT,
         COALESCE(p.permissions::jsonb -> 'modules' ->> 'salesweb',
                  CASE WHEN p.role::TEXT = 'admin' THEN 'admin' ELSE 'none' END)::TEXT
    FROM public.salesweb_message_pics pic
    JOIN auth.users u ON u.id = pic.user_id
    LEFT JOIN public.shared_profiles p ON p.id = pic.user_id
    LEFT JOIN public.salesweb_message_staff_phone sp ON sp.user_id = pic.user_id
   ORDER BY 2;
END $$;
GRANT EXECUTE ON FUNCTION public.salesweb_message_assignees() TO authenticated;

-- ── The search box on Settings ────────────────────────────────────
DROP FUNCTION IF EXISTS public.salesweb_portal_staff();
CREATE FUNCTION public.salesweb_portal_staff()
RETURNS TABLE (user_id UUID, name TEXT, email TEXT, level TEXT, on_list BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.salesweb_is_message_staff() THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT s.id::UUID, s.nm::TEXT, s.em::TEXT, s.lvl::TEXT,
         EXISTS (SELECT 1 FROM public.salesweb_message_pics pic WHERE pic.user_id = s.id)
    FROM (
      SELECT p.id,
             COALESCE(NULLIF(p.full_name::TEXT, ''), NULLIF(u.raw_user_meta_data ->> 'full_name', ''), u.email::TEXT, 'Staff') AS nm,
             COALESCE(NULLIF(p.email::TEXT, ''), u.email::TEXT) AS em,
             COALESCE(p.permissions::jsonb -> 'modules' ->> 'salesweb',
                      CASE WHEN p.role::TEXT = 'admin' THEN 'admin' ELSE 'none' END) AS lvl
        FROM public.shared_profiles p
        JOIN auth.users u ON u.id = p.id
    ) s
   WHERE s.lvl IN ('admin', 'normal')
   ORDER BY s.nm;
END $$;
GRANT EXECUTE ON FUNCTION public.salesweb_portal_staff() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Check ──────────────────────────────────────────────────────
-- Five rows. The first four should read ok. The fifth is a count of old
-- new-message email addresses that belong to nobody in the admin portal.
-- Those can no longer be notified, and 0 means nothing was left behind.
SELECT 'people who can be assigned' AS item,
       'ok, ' || count(*)::TEXT || ' on the list' AS result
  FROM public.salesweb_message_pics
UNION ALL
SELECT 'told about a new case',
       'ok, ' || count(*) FILTER (WHERE notify_new)::TEXT || ' people'
  FROM public.salesweb_message_pics
UNION ALL
SELECT 'Assigned To reads the list',
       CASE WHEN position('salesweb_message_pics' IN prosrc) > 0 THEN 'ok' ELSE 'OLD VERSION STILL INSTALLED' END
  FROM pg_proc WHERE proname = 'salesweb_message_assignees' AND pronamespace = 'public'::regnamespace
UNION ALL
SELECT 'search box installed',
       CASE WHEN has_function_privilege('authenticated', 'public.salesweb_portal_staff()', 'EXECUTE')
            THEN 'ok' ELSE 'NOT GRANTED' END
UNION ALL
SELECT 'old notify addresses with no portal login',
       count(*)::TEXT
  FROM public.salesweb_message_notify_emails e
 WHERE NOT EXISTS (
         SELECT 1 FROM auth.users u
           JOIN public.shared_profiles p ON p.id = u.id
          WHERE lower(u.email) = lower(e.email)
            AND COALESCE(p.permissions::jsonb -> 'modules' ->> 'salesweb',
                         CASE WHEN p.role::TEXT = 'admin' THEN 'admin' ELSE 'none' END) IN ('admin', 'normal'));
