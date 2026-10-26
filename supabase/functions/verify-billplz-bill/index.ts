// Supabase Edge Function: Verify Billplz Bill (server-side fallback)
//
// Called from payment-callback.html when the customer returns from Billplz.
// Queries the Billplz API directly using the secret API key — the redirect
// query params are not trusted, since they can be tampered with. If the bill
// is genuinely paid, runs the same promote-to-Paid the webhook uses
// (_shared/billplz.ts) — which marks the order Paid only when the amount
// Billplz received is the order total.
//
// This serves as a fallback for cases where Billplz did not call our webhook
// (JWT verification failure, network error, signature key mismatch, etc.) so
// the customer's order is never stuck at "Pending Payment" after they paid.
//
// Deploy:
//   supabase functions deploy verify-billplz-bill --no-verify-jwt
// Required secrets (same set the other Billplz functions use):
//   BILLPLZ_API_KEY, BILLPLZ_SANDBOX, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { billplzBaseUrl, promoteOrderToPaid } from "../_shared/billplz.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const BILLPLZ_API_KEY = Deno.env.get('BILLPLZ_API_KEY') || ''
    if (!BILLPLZ_API_KEY) {
      return jsonResp({ error: 'Payment check is not available right now' }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const bill_id = String((body && body.bill_id) || '')
    const expected_order_id = String((body && body.order_id) || '')
    if (!bill_id || bill_id.length > 64) {
      return jsonResp({ error: 'Missing bill_id' }, 400)
    }

    // Ask Billplz directly — never trust the redirect params.
    const billRes = await fetch(`${billplzBaseUrl()}/bills/${encodeURIComponent(bill_id)}`, {
      headers: { 'Authorization': 'Basic ' + btoa(BILLPLZ_API_KEY + ':') },
    })
    const bill = await billRes.json().catch(() => ({}))
    if (!billRes.ok) {
      console.error('Billplz API error:', bill)
      return jsonResp({ error: 'Could not verify with Billplz' }, 502)
    }
    const collectionId = Deno.env.get('BILLPLZ_COLLECTION_ID') || ''
    if (collectionId && bill.collection_id && bill.collection_id !== collectionId) {
      return jsonResp({ error: 'Bill not found' }, 404)
    }

    const order_id = (bill && bill.reference_1) || ''
    if (!order_id) {
      return jsonResp({ error: 'Bill has no order reference' }, 400)
    }
    // Defence against a client passing a bill_id that doesn't belong to the
    // order_id it claims — refuse if both were supplied and don't match.
    if (expected_order_id && expected_order_id !== order_id) {
      return jsonResp({ error: 'Bill / order mismatch' }, 400)
    }

    if (!bill.paid) {
      return jsonResp({ paid: false, state: bill.state || 'pending' }, 200)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!supabaseUrl || !supabaseKey) {
      return jsonResp({ error: 'Payment check is not available right now' }, 500)
    }
    const sb = createClient(supabaseUrl, supabaseKey)

    const r = await promoteOrderToPaid(sb, {
      orderId: order_id,
      billId: bill_id,
      paidAt: String(bill.paid_at || new Date().toISOString()),
      paidSen: Number(bill.paid_amount ?? bill.amount ?? 0),
      source: 'billplz-verify',
      supabaseUrl,
      serviceKey: supabaseKey,
    })

    switch (r.result) {
      case 'paid':     return jsonResp({ paid: true, updated: true, order_id }, 200)
      case 'already':  return jsonResp({ paid: true, already: true, order_id }, 200)
      case 'not_found': return jsonResp({ error: 'Order not found' }, 404)
      // The customer did pay something, but it is not this order total, or
      // the order was no longer waiting. Say so plainly: the office has a
      // note on the order and will settle it.
      case 'mismatch':
        return jsonResp({ paid: false, review: true, order_id,
          message: 'Your payment was received but does not match the order total. Our team will contact you.' }, 200)
      case 'not_payable':
        return jsonResp({ paid: false, review: true, order_id,
          message: 'Your payment was received but this order is no longer waiting for payment. Our team will contact you.' }, 200)
    }
  } catch (err) {
    console.error('verify-billplz-bill error:', err)
    return jsonResp({ error: 'Could not check the payment. Please refresh in a minute.' }, 500)
  }
})

function jsonResp(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
