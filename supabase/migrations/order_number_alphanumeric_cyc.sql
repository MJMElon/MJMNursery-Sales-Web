-- New order-number format: 5 random alphanumeric characters + 1 running
-- digit that cycles 0..9 and restarts at 0. Examples: K3M7B0, X9PA21, …
-- Replaces the year-prefixed sequential numbering with the previous
-- alphanumeric style, keeping atomic safety via the shared counter table.
--
-- Run once in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION next_order_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq    integer;
  v_prefix text := '';
  -- 24 letters (no I, O — easy to misread) + 0..9
  v_chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  i int;
BEGIN
  -- Atomic 0..9 cycle counter. Reuses salesweb_order_counters with the
  -- special key 'cyc' (ON CONFLICT DO UPDATE locks the row, so two
  -- concurrent inserts can never grab the same digit).
  INSERT INTO salesweb_order_counters (year_yy, last_seq)
  VALUES ('cyc', 0)
  ON CONFLICT (year_yy) DO UPDATE
    SET last_seq = (salesweb_order_counters.last_seq + 1) % 10
  RETURNING last_seq INTO v_seq;

  -- 5 random alphanumeric chars
  FOR i IN 1..5 LOOP
    v_prefix := v_prefix || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
  END LOOP;

  RETURN v_prefix || v_seq::text;
END;
$$;

GRANT EXECUTE ON FUNCTION next_order_number() TO anon, authenticated;

-- If you ever want the next order's last digit to restart at 0:
--   UPDATE salesweb_order_counters SET last_seq = 9 WHERE year_yy = 'cyc';
-- (the next call will add 1 mod 10 → 0)
