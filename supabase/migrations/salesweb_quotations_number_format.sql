-- Switch next_quotation_number() from 'Q<YY>-<5alnum><digit>' to
-- 'QUO-<YYMMDD>-<4digit>' — matches the printed template ops uses.
--
-- Example: QUO-260813-7369
--
-- Existing quotation rows keep their old numbers (unique constraint
-- doesn't care about the format). The change only affects newly-
-- allocated numbers.
--
-- Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION public.next_quotation_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT := 'QUO-' || to_char(now(), 'YYMMDD') || '-';
  v_try    TEXT;
  v_i      INT := 0;
BEGIN
  LOOP
    v_i := v_i + 1;
    v_try := v_prefix || lpad((floor(random() * 10000))::text, 4, '0');
    IF NOT EXISTS (SELECT 1 FROM salesweb_quotations WHERE quotation_number = v_try) THEN
      RETURN v_try;
    END IF;
    IF v_i > 50 THEN
      RAISE EXCEPTION 'Could not allocate a unique quotation number after 50 tries.';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.next_quotation_number() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.next_quotation_number() TO authenticated;
