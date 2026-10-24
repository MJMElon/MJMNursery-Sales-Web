// Supabase Edge Function: Billplz Webhook
// Receives payment confirmation from Billplz and updates order status
// Deploy: supabase functions deploy billplz-webhook
// Set the webhook URL in Billplz dashboard to:
//   https://kibqjztozokohqmhqqqf.supabase.co/functions/v1/billplz-webhook
//
// Required secrets:
//   supabase secrets set BILLPLZ_X_SIGNATURE_KEY=<copy-from-Billplz-dashboard>
//
// Without BILLPLZ_X_SIGNATURE_KEY any caller could POST `paid=true` and forge
// payment confirmations. We refuse to run if the secret is missing.
//
// The signed callback is only the doorbell. What was paid, against which order
// and how much, is read back from the Billplz API with our own key, and the
// order is marked Paid only when that amount is the order total
// (_shared/billplz.ts). Also needs BILLPLZ_API_KEY.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { billplzBaseUrl, promoteOrderToPaid } from "../_shared/billplz.ts"

// ── Billplz X-Signature verification ───────────────────────────────────────
// Billplz signs the webhook body with HMAC-SHA256 using the X-Signature Key.
// Source string = sort form fields by key (excluding `x_signature`), then
// concatenate `${key}${value}` and join pairs with `|`.
async function verifyBillplzSignature(
  formData: FormData,
  xSignatureKey: string,
): Promise<boolean> {
  const sigFromBody = (formData.get('x_signature') as string) || ''
  if (!sigFromBody) return false

  const entries: Array<[string, string]> = []
  for (const [k, v] of formData.entries()) {
    if (k === 'x_signature') continue
    entries.push([k, typeof v === 'string' ? v : ''])
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const base = entries.map(([k, v]) => `${k}${v}`).join('|')

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(xSignatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(base))
  const expected = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Constant-time comparison
  if (expected.length !== sigFromBody.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sigFromBody.charCodeAt(i)
  }
  return diff === 0
}

serve(async (req) => {
  try {
    const xSigKey = Deno.env.get('BILLPLZ_X_SIGNATURE_KEY') || ''
    const apiKey = Deno.env.get('BILLPLZ_API_KEY') || ''
    if (!xSigKey || !apiKey) {
      // Refuse to run without the secrets — otherwise the webhook is forgeable.
      console.error('BILLPLZ_X_SIGNATURE_KEY or BILLPLZ_API_KEY not set; refusing to process webhook')
      return new Response('Server misconfigured', { status: 500 })
    }

    // Billplz sends POST with form-urlencoded body
    const formData = await req.formData()

    const sigOk = await verifyBillplzSignature(formData, xSigKey)
    if (!sigOk) {
      console.warn('Billplz webhook signature mismatch — rejecting request')
      return new Response('Invalid signature', { status: 401 })
    }

    const billId = (formData.get('id') as string) || ''
    if (!billId) return new Response('No bill id', { status: 400 })

    // Read the bill back from Billplz. The callback form does not carry our
    // order reference, and the amount that decides Paid should come from the
    // same place as the order it belongs to.
    const billRes = await fetch(`${billplzBaseUrl()}/bills/${encodeURIComponent(billId)}`, {
      headers: { 'Authorization': 'Basic ' + btoa(apiKey + ':') },
    })
    const bill = await billRes.json().catch(() => ({}))
    if (!billRes.ok) {
      console.error('Billplz bill lookup failed:', billRes.status, JSON.stringify(bill))
      // 5xx so Billplz retries later.
      return new Response('Could not read bill', { status: 502 })
    }
    const collectionId = Deno.env.get('BILLPLZ_COLLECTION_ID') || ''
    if (collectionId && bill.collection_id && bill.collection_id !== collectionId) {
      console.warn('Bill from another collection, ignored:', billId, bill.collection_id)
      return new Response('OK (not ours)', { status: 200 })
    }

    const orderId = (bill.reference_1 as string) || ''
    console.log('Billplz webhook (verified):', { billId, paid: bill.paid, orderId, paid_amount: bill.paid_amount })
    if (!orderId) return new Response('No order reference', { status: 400 })

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase service-role env not configured')
      return new Response('Server misconfigured', { status: 500 })
    }
    const sb = createClient(supabaseUrl, supabaseKey)

    if (bill.paid === true) {
      const r = await promoteOrderToPaid(sb, {
        orderId,
        billId,
        paidAt: String(bill.paid_at || formData.get('paid_at') || new Date().toISOString()),
        paidSen: Number(bill.paid_amount ?? bill.amount ?? 0),
        source: 'billplz',
        supabaseUrl,
        serviceKey: supabaseKey,
      })
      if (r.result === 'not_found') return new Response('Order not found', { status: 404 })
      // mismatch / not_payable are recorded on the order for the office.
      // Answer 200 so Billplz does not keep retrying a payment it already made.
      return new Response('OK (' + r.result + ')', { status: 200 })
    }

    await sb.from('salesweb_order_timeline').insert([{
      order_id: orderId,
      status: 'Payment Failed',
      note: `Billplz payment not completed (Bill: ${billId})`,
      changed_by: 'billplz',
    }])
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('Webhook error:', err)
    return new Response('Internal error', { status: 500 })
  }
})
