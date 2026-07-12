-- Read-side RPC so the admin portal can show a customer's saved billing
-- info even though the salesweb_billing_info RLS policy is scoped to
-- user_id = auth.uid() (customer-owned rows only). Mirrors the admin
-- portal gate: role='admin' OR permissions.modules.salesweb IN
-- ('admin','normal').
--
-- Powers the "billing address" fallback on the order detail modal for
-- every historical online-store order whose customer_remark didn't
-- carry the address segment.
--
-- Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION public.get_customer_billing_info(p_user_id UUID)
RETURNS TABLE (
  billing_address TEXT,
  city            TEXT,
  postcode        TEXT,
  state           TEXT,
  country         TEXT,
  ic_number       TEXT,
  company_reg     TEXT,
  mpob_license    TEXT,
  tin             TEXT,
  name            TEXT,
  type            TEXT,
  created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role='admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN RAISE EXCEPTION 'Not authorised — admin portal access required.'; END IF;

  RETURN QUERY
    SELECT bi.billing_address, bi.city, bi.postcode, bi.state, bi.country,
           bi.ic_number, bi.company_reg, bi.mpob_license, bi.tin, bi.name,
           bi.type, bi.created_at
    FROM   salesweb_billing_info bi
    WHERE  bi.user_id = p_user_id
    ORDER  BY bi.created_at DESC
    LIMIT  1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_billing_info(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_customer_billing_info(UUID) TO authenticated;
