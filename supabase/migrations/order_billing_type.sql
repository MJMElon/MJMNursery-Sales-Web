-- Persist the billing type ('personal' | 'company') on every order at
-- checkout time so the Active Orders / E-Invoice logic doesn't have to
-- guess later.
--
-- Before this, the customer portal derived billingType with the heuristic:
--   (billing_name && billing_tax_id) ? 'company' : 'personal'
-- but personal profiles with a TIN filled in get misclassified as
-- company, breaking two flows:
--   1. Checkout still popped the "Request E-Invoice" modal for a real
--      company order (billingType default was 'personal', selectBilling
--      never updated it).
--   2. Active Orders' E-Invoice strip showed the "for company / corporate"
--      confirmation on personal orders under RM10k that had a TIN.
--
-- New column: billing_type text — 'personal' | 'company', nullable so
-- historical rows are left alone (the customer-portal mapper still
-- falls back to the old heuristic when billing_type is NULL).
--
-- Run once in the Supabase SQL Editor.

ALTER TABLE public.salesweb_customer_orders
  ADD COLUMN IF NOT EXISTS billing_type text
    CHECK (billing_type IN ('personal','company'));
