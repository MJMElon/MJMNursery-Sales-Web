-- Admin-managed quotations for MJM Nursery.
--
-- Distinct from salesweb_customer_orders because:
--   * A quotation is a pre-sale document — no stock hold, no payment,
--     no customer_id required, no order lifecycle status.
--   * Line items are FREE-FORM (typed product name + qty + unit price)
--     so admin can quote for anything, including products that aren't
--     yet in the online catalog.
--   * A quotation can eventually be converted to an order, but that's
--     a separate manual step in the admin (not modelled here yet).
--
-- Layout mirrors the customer-facing "Request a Quotation" form:
--   Company/personal name · Contact person · Contact number · Email ·
--   Address, then a stack of line items, then subtotal + optional tax +
--   grand total, notes / terms.
--
-- Idempotent — safe to re-run.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Header table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.salesweb_quotations (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number   TEXT          NOT NULL UNIQUE,
  customer_name      TEXT          NOT NULL,
  contact_person     TEXT,
  contact_number     TEXT,
  email              TEXT,
  address            TEXT,
  subtotal           NUMERIC(12,2) DEFAULT 0,
  tax_amount         NUMERIC(12,2) DEFAULT 0,
  total              NUMERIC(12,2) DEFAULT 0,
  notes              TEXT,
  status             TEXT          DEFAULT 'Draft',   -- Draft | Sent | Accepted | Expired | Converted
  valid_until        DATE,
  created_by         TEXT,
  created_at         TIMESTAMPTZ   DEFAULT now(),
  updated_at         TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotations_created_at
  ON public.salesweb_quotations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_status
  ON public.salesweb_quotations (status);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Line-item table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.salesweb_quotation_items (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id   UUID          NOT NULL REFERENCES public.salesweb_quotations(id) ON DELETE CASCADE,
  product_name   TEXT          NOT NULL,
  quantity       NUMERIC(12,2) DEFAULT 0,
  unit_price     NUMERIC(12,2) DEFAULT 0,
  line_subtotal  NUMERIC(12,2) DEFAULT 0,
  sort_order     INTEGER       DEFAULT 0,
  created_at     TIMESTAMPTZ   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id
  ON public.salesweb_quotation_items (quotation_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Sequential quotation number generator
-- ─────────────────────────────────────────────────────────────────────
-- Format: Q<YY><6-char alnum>, e.g. Q26-A3K7B2. Unique constraint on
-- quotation_number is the collision guard — this function just gives a
-- clean default so the admin isn't typing it by hand.
CREATE OR REPLACE FUNCTION public.next_quotation_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT := 'Q' || to_char(now(), 'YY') || '-';
  v_try    TEXT;
  v_i      INT := 0;
BEGIN
  LOOP
    v_i := v_i + 1;
    v_try := v_prefix ||
             upper(substring(md5(random()::text || clock_timestamp()::text) FROM 1 FOR 5)) ||
             (floor(random()*10))::text;
    IF NOT EXISTS (SELECT 1 FROM salesweb_quotations WHERE quotation_number = v_try) THEN
      RETURN v_try;
    END IF;
    IF v_i > 20 THEN
      RAISE EXCEPTION 'Could not allocate a unique quotation number after 20 tries.';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.next_quotation_number() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.next_quotation_number() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. RLS — admin-portal users only
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.salesweb_quotations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salesweb_quotation_items  ENABLE ROW LEVEL SECURITY;

-- One admin-gate helper the two policies below share.
CREATE OR REPLACE FUNCTION public._sw_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role = 'admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  );
$$;

DROP POLICY IF EXISTS quotations_admin_all ON public.salesweb_quotations;
CREATE POLICY quotations_admin_all ON public.salesweb_quotations
  FOR ALL
  USING (public._sw_is_admin())
  WITH CHECK (public._sw_is_admin());

DROP POLICY IF EXISTS quotation_items_admin_all ON public.salesweb_quotation_items;
CREATE POLICY quotation_items_admin_all ON public.salesweb_quotation_items
  FOR ALL
  USING (public._sw_is_admin())
  WITH CHECK (public._sw_is_admin());
