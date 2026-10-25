-- ================================================================
-- MJM Salesweb -- Contact Us, part 6. The Upon assigned tick.
-- Run in the Supabase SQL Editor after part 5. Safe to run more than once.
-- ================================================================
--
-- Each person on the Who Can Be Assigned list gets a third tick, Upon
-- assigned. When it is on, Save and Send emails them the case. When it is
-- off they are still assigned, and only the customer is emailed. It
-- starts ON for everybody, which is what happened before this tick.
-- ================================================================

ALTER TABLE public.salesweb_message_pics
  ADD COLUMN IF NOT EXISTS notify_assigned BOOLEAN NOT NULL DEFAULT TRUE;

NOTIFY pgrst, 'reload schema';

-- ── Check ──────────────────────────────────────────────────────
-- Two rows. The first should read ok. The second says how many people
-- on the list are emailed when a case is assigned to them.
SELECT 'Upon assigned tick added' AS item,
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'MISSING' END AS result
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'salesweb_message_pics' AND column_name = 'notify_assigned'
UNION ALL
SELECT 'emailed upon assigned',
       count(*) FILTER (WHERE notify_assigned)::TEXT || ' of ' || count(*)::TEXT || ' people'
  FROM public.salesweb_message_pics;
