-- Flip public.v_credit_outstanding from Supabase's "UNRESTRICTED" state
-- to RESTRICTED by turning on security_invoker. Without this the view
-- runs with SECURITY DEFINER semantics (as the postgres role) and
-- bypasses RLS on every underlying table it selects from. With
-- security_invoker = on, the view runs as the caller so the RLS
-- policies on the underlying tables (salesweb_customer_orders,
-- salesweb_credit_invoices, etc.) are enforced end-to-end.
--
-- Also revoke anon SELECT so only signed-in users can query the view.
--
-- Requires PostgreSQL 15+ (Supabase). Idempotent — safe to re-run.

ALTER VIEW public.v_credit_outstanding SET (security_invoker = on);

REVOKE  SELECT ON public.v_credit_outstanding FROM anon;
GRANT   SELECT ON public.v_credit_outstanding TO   authenticated;
