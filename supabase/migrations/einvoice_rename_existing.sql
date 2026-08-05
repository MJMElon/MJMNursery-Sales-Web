-- One-shot backfill: rename existing E-Invoice display names to the
-- standard "<order_number>_E-Invoice.<ext>" convention introduced
-- for new uploads.
--
-- We only touch the DISPLAY name (einvoice_name + the mirrored
-- salesweb_order_attachments.file_name). The storage object key
-- stays put on purpose — renaming it would 404 any URL that customers
-- or old email notifications already have.
--
-- Idempotent: rows already matching the pattern are skipped.
--
-- Run once in the Supabase SQL Editor.

-- 1) salesweb_customer_orders.einvoice_name
UPDATE public.salesweb_customer_orders
   SET einvoice_name = order_number || '_E-Invoice.' ||
                        COALESCE(
                          LOWER(SUBSTRING(einvoice_name FROM '\.([^.]+)$')),
                          'pdf'
                        ),
       updated_at   = now()
 WHERE einvoice_uploaded_at IS NOT NULL
   AND order_number         IS NOT NULL
   AND einvoice_name        IS NOT NULL
   AND einvoice_name NOT LIKE (order_number || '_E-Invoice.%');

-- 2) salesweb_order_attachments.file_name — the mirror row that the
--    Payments-tab upload writes so the customer sees the E-Invoice
--    under Attached Documents. Matched via file_url = einvoice_url.
UPDATE public.salesweb_order_attachments AS a
   SET file_name = o.order_number || '_E-Invoice.' ||
                    COALESCE(
                      LOWER(SUBSTRING(a.file_name FROM '\.([^.]+)$')),
                      'pdf'
                    )
  FROM public.salesweb_customer_orders AS o
 WHERE a.order_id     = o.id
   AND o.einvoice_url IS NOT NULL
   AND a.file_url     = o.einvoice_url
   AND o.order_number IS NOT NULL
   AND a.file_name    IS NOT NULL
   AND a.file_name NOT LIKE (o.order_number || '_E-Invoice.%');
