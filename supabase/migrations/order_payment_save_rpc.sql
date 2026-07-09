-- One-shot install for the Record Payment save function.
--
-- Runs everything the save flow needs in a single SQL block so the admin
-- doesn't have to chase piecemeal errors:
--   1. Backfill every column savePaymentEntry writes to.
--   2. Create/replace a SECURITY DEFINER RPC that inserts the payment row
--      as postgres (bypassing the finicky RLS on salesweb_order_payments)
--      while still enforcing "must be a signed-in Supabase user".
--   3. Grant EXECUTE on the RPC to `authenticated` role.
--
-- Idempotent — safe to re-run.

-- ─── 1. Column backfill ───────────────────────────────────────────────
ALTER TABLE salesweb_order_payments
  ADD COLUMN IF NOT EXISTS attachment_url  TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS created_by      TEXT,
  ADD COLUMN IF NOT EXISTS note            TEXT,
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─── 2. SECURITY DEFINER save RPC ─────────────────────────────────────
-- Bypasses the table's RLS (runs as the function owner = postgres) but
-- gates the insert with the SAME check that checkAdmin() in admin.html
-- uses to let a user into the admin portal: either role='admin' or
-- permissions.modules.salesweb IN ('admin','normal'). So every user who
-- can open the admin portal can record a payment — no more, no less.
CREATE OR REPLACE FUNCTION public.save_order_payment(
  p_order_id        UUID,
  p_paid_at         TIMESTAMPTZ,
  p_amount          NUMERIC,
  p_note            TEXT DEFAULT NULL,
  p_attachment_url  TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL,
  p_created_by      TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated — sign in to record a payment.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM   shared_profiles sp
    WHERE  sp.id = auth.uid()
      AND  ( sp.role = 'admin'
             OR COALESCE(sp.permissions->'modules'->>'salesweb','none') IN ('admin','normal') )
  ) THEN
    RAISE EXCEPTION 'Not authorised — admin portal access required.';
  END IF;

  INSERT INTO salesweb_order_payments (
    order_id, paid_at, amount, note,
    attachment_url, attachment_name, created_by
  ) VALUES (
    p_order_id, p_paid_at, p_amount, p_note,
    p_attachment_url, p_attachment_name, COALESCE(p_created_by, auth.jwt()->>'email')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ─── 3. Grants ────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.save_order_payment(UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_order_payment(UUID, TIMESTAMPTZ, NUMERIC, TEXT, TEXT, TEXT, TEXT) TO authenticated;
