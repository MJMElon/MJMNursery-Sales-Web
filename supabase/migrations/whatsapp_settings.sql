-- ================================================================
-- MJM Salesweb -- WhatsApp tab. Which automatic WhatsApp is sent when,
-- with which template, and a log of every one sent.
-- Run in the Supabase SQL Editor. Safe to run more than once.
-- ================================================================
--
-- The templates themselves live at Meta and are read and written from
-- the WhatsApp tab through the edge function called whatsapp. This file
-- keeps the two things that belong to us.
--
-- 1. salesweb_wa_events, one row per automatic message (case_assigned
--    now, collection reminder, delivery order and low stock later). It
--    says whether it is switched on and which approved template it uses.
--    The case assigned row is created switched on with the template
--    name the earlier set-up notes asked for, so nothing changes for it.
--
-- 2. salesweb_wa_log, every WhatsApp the system sends, sent or failed,
--    with the reason Meta gave. Only the edge function writes it.
--
-- 3. salesweb_can_manage_whatsapp() answers who may use the tab. The
--    same rule as the sidebar. Admins always, a normal user when the
--    WhatsApp page is ticked in User Access, or when nobody has saved
--    page settings for them yet.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.salesweb_wa_events (
    key            TEXT PRIMARY KEY,
    enabled        BOOLEAN     NOT NULL DEFAULT FALSE,
    template_name  TEXT,
    template_lang  TEXT,
    recipients     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by     TEXT
);

INSERT INTO public.salesweb_wa_events (key, enabled, template_name, template_lang)
VALUES ('case_assigned', TRUE, 'case_assigned', 'en')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.salesweb_wa_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_key      TEXT,
    to_phone       TEXT,
    template_name  TEXT,
    template_lang  TEXT,
    params         JSONB,
    status         TEXT        NOT NULL,
    detail         TEXT,
    wa_message_id  TEXT,
    ref_type       TEXT,
    ref_id         TEXT,
    actor_id       UUID,
    actor_name     TEXT
);
CREATE INDEX IF NOT EXISTS salesweb_wa_log_created_idx ON public.salesweb_wa_log (created_at DESC);

CREATE OR REPLACE FUNCTION public.salesweb_can_manage_whatsapp()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT CASE
             WHEN lvl = 'admin' THEN TRUE
             WHEN lvl = 'normal' THEN (saved IS NULL OR jsonb_typeof(saved) <> 'object'
                                       OR saved ->> 'whatsapp' = 'true')
             ELSE FALSE END
      FROM (
        SELECT COALESCE(p.permissions::jsonb -> 'modules' ->> 'salesweb',
                        CASE WHEN p.role::TEXT = 'admin' THEN 'admin' ELSE 'none' END) AS lvl,
               COALESCE(a.tabs::jsonb, p.permissions::jsonb -> 'salesweb_tabs') AS saved
          FROM public.shared_profiles p
          LEFT JOIN public.salesweb_user_tab_access a ON a.user_id = p.id
         WHERE p.id = auth.uid()
      ) s
  ), FALSE)
$$;
GRANT EXECUTE ON FUNCTION public.salesweb_can_manage_whatsapp() TO authenticated;

ALTER TABLE public.salesweb_wa_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "salesweb_wa_events_read" ON public.salesweb_wa_events;
CREATE POLICY "salesweb_wa_events_read" ON public.salesweb_wa_events
  FOR SELECT TO authenticated USING (public.salesweb_is_message_staff());
DROP POLICY IF EXISTS "salesweb_wa_events_write" ON public.salesweb_wa_events;
CREATE POLICY "salesweb_wa_events_write" ON public.salesweb_wa_events
  FOR ALL TO authenticated
  USING      (public.salesweb_can_manage_whatsapp())
  WITH CHECK (public.salesweb_can_manage_whatsapp());
GRANT SELECT, INSERT, UPDATE ON public.salesweb_wa_events TO authenticated;

ALTER TABLE public.salesweb_wa_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "salesweb_wa_log_read" ON public.salesweb_wa_log;
CREATE POLICY "salesweb_wa_log_read" ON public.salesweb_wa_log
  FOR SELECT TO authenticated USING (public.salesweb_can_manage_whatsapp());
GRANT SELECT ON public.salesweb_wa_log TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Check ──────────────────────────────────────────────────────
-- Four rows, each should read ok.
SELECT 'events table' AS item,
       CASE WHEN count(*) >= 1 THEN 'ok' ELSE 'MISSING' END AS result
  FROM public.salesweb_wa_events
UNION ALL
SELECT 'case assigned row',
       COALESCE((SELECT CASE WHEN enabled THEN 'ok, switched on, template ' || COALESCE(template_name, 'none')
                             ELSE 'ok, switched off' END
                   FROM public.salesweb_wa_events WHERE key = 'case_assigned'), 'MISSING')
UNION ALL
SELECT 'send log table',
       CASE WHEN to_regclass('public.salesweb_wa_log') IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL
SELECT 'access check installed',
       CASE WHEN has_function_privilege('authenticated', 'public.salesweb_can_manage_whatsapp()', 'EXECUTE')
            THEN 'ok' ELSE 'NOT GRANTED' END;
