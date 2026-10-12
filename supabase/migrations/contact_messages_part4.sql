-- ================================================================
-- MJM Salesweb -- Contact Us, part 4. The case timeline records the
-- first time somebody opens a case.
-- Run in the Supabase SQL Editor after part 3. Safe to run more than once.
-- ================================================================
--
-- The case pop-up now shows a timeline. Received, First opened,
-- Assigned, First response and Resolved, with how long after the
-- message each came, and below it every entry. Status, assignment and
-- order changes were already written by this trigger, notes by the page.
-- Opening a case was not written anywhere except as a time on the row,
-- so the trigger now also writes who opened it first. Nothing else in
-- the trigger changes.
-- ================================================================

CREATE OR REPLACE FUNCTION public.salesweb_messages_track()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_name TEXT := COALESCE(public.salesweb_actor_name(auth.uid()), 'System');
BEGIN
  NEW.updated_at := NOW();

  IF OLD.read_at IS NULL AND NEW.read_at IS NOT NULL THEN
    INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
    VALUES (NEW.id, 'opened', 'First opened on the Messages tab', v_uid, v_name);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('Resolved','Closed') AND OLD.status NOT IN ('Resolved','Closed') THEN
      NEW.resolved_at := NOW();
    ELSIF NEW.status NOT IN ('Resolved','Closed') THEN
      NEW.resolved_at := NULL;
    END IF;
    INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
    VALUES (NEW.id, 'status', OLD.status || ' to ' || NEW.status, v_uid, v_name);
  END IF;

  IF NEW.order_number IS DISTINCT FROM OLD.order_number THEN
    INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
    VALUES (NEW.id, 'order',
            CASE WHEN NEW.order_number IS NULL THEN 'Order number removed'
                 ELSE 'Order linked: #' || NEW.order_number END,
            v_uid, v_name);
  END IF;

  IF NEW.assigned_name IS DISTINCT FROM OLD.assigned_name
     OR NEW.assigned_phone IS DISTINCT FROM OLD.assigned_phone THEN
    NEW.assigned_at := CASE WHEN NEW.assigned_name IS NULL THEN NULL ELSE NOW() END;
    INSERT INTO public.salesweb_message_events (message_id, kind, body, actor_id, actor_name)
    VALUES (NEW.id, 'assign',
            CASE WHEN NEW.assigned_name IS NULL THEN 'Unassigned'
                 ELSE 'Assigned to ' || NEW.assigned_name || COALESCE(' (' || NEW.assigned_phone || ')', '') END,
            v_uid, v_name);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS salesweb_messages_track_trg ON public.salesweb_messages;
CREATE TRIGGER salesweb_messages_track_trg
  BEFORE UPDATE ON public.salesweb_messages
  FOR EACH ROW EXECUTE FUNCTION public.salesweb_messages_track();

NOTIFY pgrst, 'reload schema';

-- ── Check ──────────────────────────────────────────────────────
-- Two rows, both should read ok.
SELECT 'trigger records first opened' AS item,
       CASE WHEN position('First opened' IN prosrc) > 0 THEN 'ok' ELSE 'OLD VERSION STILL INSTALLED' END AS result
  FROM pg_proc WHERE proname = 'salesweb_messages_track' AND pronamespace = 'public'::regnamespace
UNION ALL
SELECT 'trigger attached',
       CASE WHEN count(*) = 1 THEN 'ok' ELSE 'MISSING' END
  FROM pg_trigger WHERE tgname = 'salesweb_messages_track_trg';
