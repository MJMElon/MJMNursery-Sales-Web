-- Sequential, year-prefixed order numbers: <YY><4-digit running seq>,
-- resetting each calendar year (Malaysia time). e.g. 2026 → 260001, 260002…
-- and from 1 Jan 2027 → 270001, 270002…
--
-- A small counter table + an atomic upsert guarantees no duplicates even
-- under concurrent checkouts (the ON CONFLICT DO UPDATE locks the year row).
--
-- Run once in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS salesweb_order_counters (
  year_yy  text PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_order_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yy  text := to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur', 'YY');
  v_seq integer;
BEGIN
  INSERT INTO salesweb_order_counters (year_yy, last_seq)
  VALUES (v_yy, 1)
  ON CONFLICT (year_yy)
    DO UPDATE SET last_seq = salesweb_order_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN v_yy || lpad(v_seq::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION next_order_number() TO anon, authenticated;

-- Optional: if you want the running sequence for the current year to start
-- at a specific number (e.g. you already issued some), set last_seq here.
-- The next order becomes (last_seq + 1). Example to make the next one 260001:
--   INSERT INTO salesweb_order_counters(year_yy, last_seq) VALUES ('26', 0)
--   ON CONFLICT (year_yy) DO UPDATE SET last_seq = 0;
