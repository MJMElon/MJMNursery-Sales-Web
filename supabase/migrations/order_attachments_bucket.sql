-- ════════════════════════════════════════════════════════════════════════════
-- Migration: Ensure the order-attachments storage bucket exists with RLS
-- ----------------------------------------------------------------------------
-- The admin orders UI uploads invoices / receipts / etc. to the
-- `order-attachments` bucket (admin-orders.js). The customer-facing
-- payment-proof page (payment-proof.html) now uploads payment proofs
-- into the same bucket — single source of truth, single set of
-- policies, one place for the admin to look.
--
-- This migration:
--   1. Creates the bucket if it isn't there yet (idempotent).
--   2. Adds RLS policies on storage.objects so:
--        • Authenticated customers can INSERT under payment-proofs/*
--          (the prefix used by payment-proof.html).
--        • Anyone authenticated can INSERT anywhere else in the bucket
--          (covers the admin uploads from admin-orders.js — they're
--          authenticated as the salesweb admin user).
--        • Anyone can SELECT (public read; the bucket is also marked
--          public so getPublicUrl() works in the storefront).
--   3. Bucket is marked public so PostgREST-issued public URLs work
--      without signing. We still keep the SELECT policy explicit
--      because RLS on storage.objects evaluates independently of the
--      bucket.public flag.
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('order-attachments', 'order-attachments', true, 5242880)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

-- 2. Policies (idempotent — drop + recreate so re-runs always converge)

DROP POLICY IF EXISTS "order-attachments customer insert payment proofs" ON storage.objects;
CREATE POLICY "order-attachments customer insert payment proofs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'order-attachments'
    AND (storage.foldername(name))[1] = 'payment-proofs'
  );

DROP POLICY IF EXISTS "order-attachments authenticated insert any" ON storage.objects;
CREATE POLICY "order-attachments authenticated insert any"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'order-attachments'
  );

DROP POLICY IF EXISTS "order-attachments authenticated update own" ON storage.objects;
CREATE POLICY "order-attachments authenticated update own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'order-attachments'
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "order-attachments authenticated delete own" ON storage.objects;
CREATE POLICY "order-attachments authenticated delete own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'order-attachments'
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS "order-attachments public select" ON storage.objects;
CREATE POLICY "order-attachments public select"
  ON storage.objects FOR SELECT
  TO public
  USING (
    bucket_id = 'order-attachments'
  );
