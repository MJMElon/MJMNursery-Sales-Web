-- PREPAID payment terms, and its own stock auto-release rule.
--
-- What this does, in order:
--   1. lets payment_terms hold prepaid, on the customer and on the order
--   2. place_order carries a prepaid customer onto the order as prepaid
--      (it used to fold everything that was not credit into cash)
--   3. a customer cannot give themselves prepaid, exactly as for credit
--   4. release_abandoned_cash_orders reads TWO rules from the one setting row
--      order_auto_release: the top level is CASH, as it always was, and the
--      prepaid block is PREPAID. No prepaid block means prepaid stock is never
--      released, which is the safe way round until the office switches it on.
--
-- Prepaid behaves as cash everywhere else: it pays before collection, and it
-- gets no AL until it is paid. Credit orders, and any order with a payment
-- against it, are still never released.
--
-- Safe to run twice. The last query prints one line per step and says OK or
-- what is wrong. A good result is every line reading OK.

ALTER TABLE public.salesweb_customer_orders DROP CONSTRAINT IF EXISTS salesweb_customer_orders_payment_terms_check;
ALTER TABLE public.salesweb_customer_orders ADD CONSTRAINT salesweb_customer_orders_payment_terms_check
  CHECK (payment_terms = ANY (ARRAY['cash'::text, 'credit'::text, 'prepaid'::text]));

ALTER TABLE public.shared_profiles DROP CONSTRAINT IF EXISTS shared_profiles_payment_terms_check;
ALTER TABLE public.shared_profiles ADD CONSTRAINT shared_profiles_payment_terms_check
  CHECK (payment_terms = ANY (ARRAY['cash'::text, 'credit'::text, 'prepaid'::text]));

-- 2 and 3: one line changed in each of two existing functions, rewritten in
-- place so nothing else in them moves. A function already changed is left alone.
DO $do$
DECLARE
  d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'place_order' LIMIT 1;
  IF d IS NOT NULL AND position($q$CASE WHEN p.payment_terms = 'credit' THEN 'credit' ELSE 'cash' END$q$ IN d) > 0 THEN
    EXECUTE replace(d,
      $q$CASE WHEN p.payment_terms = 'credit' THEN 'credit' ELSE 'cash' END$q$,
      $q$CASE WHEN p.payment_terms IN ('credit', 'prepaid') THEN p.payment_terms ELSE 'cash' END$q$);
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_mjm_profiles_guard' LIMIT 1;
  IF d IS NOT NULL AND position($q$COALESCE(n ->> 'payment_terms', '') = 'credit'$q$ IN d) > 0 THEN
    EXECUTE replace(d,
      $q$COALESCE(n ->> 'payment_terms', '') = 'credit'$q$,
      $q$COALESCE(n ->> 'payment_terms', 'cash') IN ('credit', 'prepaid')$q$);
  END IF;
END
$do$;

-- 4: the release, one rule per term.
CREATE OR REPLACE FUNCTION public.release_abandoned_cash_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count   integer := 0;
  v_scanned integer := 0;
  v_raw     text;
  v_cfg     jsonb := '{}'::jsonb;
  v_rule    jsonb;
  v_hours   numeric;
  v_tiers   jsonb;
  v_qty     integer;
  v_days    numeric;
  v_note    text;
  v_tier    jsonb;
  v_matched boolean;
  v_terms   text;
  r RECORD;
BEGIN
  SELECT value INTO v_raw FROM salesweb_app_settings WHERE key = 'order_auto_release';
  IF v_raw IS NOT NULL THEN
    BEGIN
      v_cfg := v_raw::jsonb;
    EXCEPTION WHEN others THEN
      v_cfg := '{}'::jsonb;
    END;
  END IF;

  FOR r IN
    SELECT o.id,
           CASE WHEN o.payment_terms = 'prepaid' THEN 'prepaid' ELSE 'cash' END AS terms,
           GREATEST(o.created_at, COALESCE(o.updated_at, o.created_at)) AS effective_at
    FROM   salesweb_customer_orders o
    WHERE  o.status = 'Pending Payment'
      AND  COALESCE(o.amount_paid, 0) = 0
      AND  COALESCE(o.payment_terms, 'cash') <> 'credit'
      AND  o.deleted_at IS NULL
  LOOP
    v_terms := r.terms;
    -- CASH is the top level of the row, as it always was. PREPAID is its own
    -- block, and with no block it is never released.
    IF v_terms = 'prepaid' THEN
      v_rule := COALESCE(v_cfg -> 'prepaid', '{"enabled": false}'::jsonb);
      IF jsonb_typeof(v_rule) <> 'object' THEN v_rule := '{"enabled": false}'::jsonb; END IF;
    ELSE
      v_rule := v_cfg;
    END IF;

    BEGIN
      IF NOT COALESCE((v_rule ->> 'enabled')::boolean, v_terms = 'cash') THEN CONTINUE; END IF;
      v_hours := COALESCE((v_rule ->> 'hours')::numeric, 48);
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    v_tiers := v_rule -> 'tiers';
    IF v_tiers IS NULL OR jsonb_typeof(v_tiers) <> 'array' THEN v_tiers := NULL; END IF;

    v_scanned := v_scanned + 1;
    v_days := NULL; v_matched := false;
    IF v_tiers IS NOT NULL AND jsonb_array_length(v_tiers) > 0 THEN
      SELECT COALESCE(SUM(quantity), 0) INTO v_qty FROM salesweb_order_items WHERE order_id = r.id;
      FOR v_tier IN SELECT * FROM jsonb_array_elements(v_tiers) LOOP
        IF v_qty >= COALESCE((v_tier ->> 'min_qty')::numeric, 0)
           AND (v_tier ->> 'max_qty' IS NULL OR v_qty <= (v_tier ->> 'max_qty')::numeric) THEN
          v_days := (v_tier ->> 'days')::numeric; v_matched := true; EXIT;
        END IF;
      END LOOP;
    END IF;

    IF NOT v_matched THEN
      IF v_hours IS NULL OR v_hours <= 0 THEN CONTINUE; END IF;
      IF r.effective_at >= now() - (v_hours * interval '1 hour') THEN CONTINUE; END IF;
      v_note := 'Auto-cancelled — ' || v_terms || ' order unpaid for ' || v_hours || 'h; stock returned';
    ELSE
      IF v_days IS NULL OR v_days <= 0 THEN CONTINUE; END IF;
      IF r.effective_at >= now() - (v_days * interval '1 day') THEN CONTINUE; END IF;
      v_note := 'Auto-cancelled — ' || v_terms || ' order (qty ' || v_qty || ') unpaid for ' || v_days || ' days; stock returned';
    END IF;

    BEGIN
      UPDATE salesweb_products p SET stock_qty = COALESCE(p.stock_qty, 0) + oi.qty, updated_at = now()
      FROM (SELECT product_id, SUM(quantity) AS qty FROM salesweb_order_items
            WHERE order_id = r.id AND product_id IS NOT NULL GROUP BY product_id) oi
      WHERE p.id = oi.product_id;
      UPDATE salesweb_customer_orders SET status = 'Cancelled', updated_at = now() WHERE id = r.id;
      INSERT INTO salesweb_order_timeline (order_id, status, note, changed_by)
      VALUES (r.id, 'Cancelled', v_note, 'system');
      v_count := v_count + 1;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'release_abandoned_cash_orders: order % skipped: %', r.id, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE 'release_abandoned_cash_orders: scanned %, cancelled %', v_scanned, v_count;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_abandoned_cash_orders() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 1 AS step, 'orders accept prepaid' AS what,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%prepaid%' THEN 'OK' ELSE 'NOT OK' END AS result
FROM pg_constraint WHERE conname = 'salesweb_customer_orders_payment_terms_check'
UNION ALL
SELECT 2, 'customers accept prepaid',
       CASE WHEN pg_get_constraintdef(oid) LIKE '%prepaid%' THEN 'OK' ELSE 'NOT OK' END
FROM pg_constraint WHERE conname = 'shared_profiles_payment_terms_check'
UNION ALL
SELECT 3, 'place_order carries prepaid onto the order',
       CASE WHEN position('''credit'', ''prepaid''' IN prosrc) > 0 THEN 'OK' ELSE 'NOT OK' END
FROM pg_proc WHERE proname = 'place_order'
UNION ALL
SELECT 4, 'a customer cannot give themselves prepaid',
       CASE WHEN position('''credit'', ''prepaid''' IN prosrc) > 0 THEN 'OK' ELSE 'NOT OK' END
FROM pg_proc WHERE proname = '_mjm_profiles_guard'
UNION ALL
SELECT 5, 'release reads a prepaid rule',
       CASE WHEN position('prepaid' IN p.prosrc) > 0 THEN 'OK' ELSE 'NOT OK' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'release_abandoned_cash_orders'
UNION ALL
SELECT 6, 'prepaid rule saved',
       COALESCE((SELECT CASE WHEN value::jsonb ? 'prepaid'
                             THEN 'set: ' || (value::jsonb -> 'prepaid')::text
                             ELSE 'not saved yet: prepaid stock is never released until Settings, Orders is saved' END
                 FROM salesweb_app_settings WHERE key = 'order_auto_release'),
                'no setting row yet: cash releases after 48h, prepaid never')
ORDER BY 1;
