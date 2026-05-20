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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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
    if (!xSigKey) {
      // Refuse to run without the secret — otherwise webhook is forgeable.
      console.error('BILLPLZ_X_SIGNATURE_KEY not set; refusing to process webhook')
      return new Response('Server misconfigured: signature key missing', { status: 500 })
    }

    // Billplz sends POST with form-urlencoded body
    const formData = await req.formData()

    const sigOk = await verifyBillplzSignature(formData, xSigKey)
    if (!sigOk) {
      console.warn('Billplz webhook signature mismatch — rejecting request')
      return new Response('Invalid signature', { status: 401 })
    }

    const billId = formData.get('id') as string
    const paid = formData.get('paid') === 'true'
    const paidAt = formData.get('paid_at') as string
    const orderId = formData.get('reference_1') as string // We stored order_id here

    console.log('Billplz webhook (verified):', { billId, paid, paidAt, orderId })

    if (!orderId) {
      return new Response('No order reference', { status: 400 })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!supabaseUrl || !supabaseKey) {
      console.error('Supabase service-role env not configured')
      return new Response('Server misconfigured', { status: 500 })
    }
    const sb = createClient(supabaseUrl, supabaseKey)

    if (paid) {
      // Idempotency: if already Paid, skip duplicate side effects
      const { data: existing } = await sb
        .from('salesweb_customer_orders')
        .select('id, order_number, customer_id, customer_name, customer_email, status, total, points_issued, points_redeemed, points_discount_rm')
        .eq('id', orderId)
        .maybeSingle()
      if (!existing) {
        return new Response('Order not found', { status: 404 })
      }
      if (existing.status === 'Paid') {
        return new Response('OK (already paid)', { status: 200 })
      }

      // 1. Flip order to Paid status
      await sb.from('salesweb_customer_orders')
        .update({ status: 'Paid', updated_at: new Date().toISOString() })
        .eq('id', orderId)

      await sb.from('salesweb_order_timeline').insert([{
        order_id: orderId,
        status: 'Paid',
        note: `Online payment confirmed via Billplz (Bill: ${billId}, Paid at: ${paidAt})`,
        changed_by: 'billplz',
      }])

      // 2. Issue loyalty points — formula is configurable from admin →
      //    Points Settings (salesweb_app_settings.key='points_config'):
      //      points = floor(total / earn_rm) * earn_pts
      //    The number saved on the order is a snapshot; later changes to
      //    the rate don't retroactively rewrite past orders.
      const total = Number(existing.total || 0)
      let earnRm = 1, earnPts = 1
      try {
        const { data: cfgRow } = await sb
          .from('salesweb_app_settings')
          .select('value').eq('key', 'points_config').maybeSingle()
        if (cfgRow && cfgRow.value) {
          const cfg = typeof cfgRow.value === 'string'
            ? JSON.parse(cfgRow.value) : cfgRow.value
          if (cfg && cfg.earn_rm)  earnRm  = Math.max(0.01, Number(cfg.earn_rm)  || 1)
          if (cfg && cfg.earn_pts !== undefined) earnPts = Math.max(0, Number(cfg.earn_pts) || 0)
        }
      } catch (e) { console.warn('points config load failed, using defaults:', e) }

      const points = Math.floor(total / earnRm) * earnPts
      const redeemed = Number(existing.points_redeemed || 0)
      if (!existing.points_issued) {
        if (points > 0) {
          await sb.from('salesweb_customer_orders')
            .update({ points_issued: points })
            .eq('id', orderId)
          await sb.from('salesweb_order_timeline').insert([{
            order_id: orderId,
            status: 'Points Issued',
            note: `${points} loyalty points issued (RM ${total.toFixed(2)} @ ${earnPts} pt per RM ${earnRm})`,
            changed_by: 'billplz',
          }])
        }

        // Ledger writes — the single source of truth for customer balance.
        // Both rows are gated together by `!existing.points_issued`, so a
        // duplicate webhook delivery never produces duplicate ledger entries.
        if (existing.customer_id) {
          const ledgerRows: any[] = []
          if (points > 0) {
            ledgerRows.push({
              user_id: existing.customer_id,
              change: points,
              type: 'Earned',
              order_id: orderId,
              rm_value: total,
              note: `Order ${existing.order_number || orderId}`,
              created_by: 'billplz',
            })
          }
          if (redeemed > 0) {
            ledgerRows.push({
              user_id: existing.customer_id,
              change: -redeemed,
              type: 'Redeemed',
              order_id: orderId,
              rm_value: Number(existing.points_discount_rm || 0),
              note: `Redeemed on order ${existing.order_number || orderId}`,
              created_by: 'billplz',
            })
          }
          if (ledgerRows.length) {
            const { error: ledgerErr } = await sb
              .from('salesweb_points_ledger').insert(ledgerRows)
            if (ledgerErr) console.error('points ledger insert failed:', ledgerErr)
          }
        }
      }

      // 3. Auto-create AL (Acknowledgement Letter) in nursery system
      const alNumber = existing.order_number
      if (alNumber) {
        const { data: existingAL } = await sb
          .from('shared_al_orders')
          .select('id')
          .eq('al_number', alNumber)
          .maybeSingle()

        if (!existingAL) {
          const { data: items } = await sb
            .from('salesweb_order_items')
            .select('product_name, quantity, unit_price')
            .eq('order_id', orderId)
          const lines = items || []
          const totalQty = lines.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0)
          const productNames = lines.map((it: any) => it.product_name).join(', ')
          const unitPrice = totalQty > 0 ? Math.round((total / totalQty) * 100) / 100 : 0

          const { error: alErr } = await sb.from('shared_al_orders').insert([{
            al_number: alNumber,
            order_number: alNumber,
            order_date: new Date().toISOString(),
            customer_name: existing.customer_name || '',
            product_name: productNames || 'Oil Palm Seedling',
            quantity_ordered: totalQty,
            balance_quantity: totalQty,
            price_per_unit: unitPrice,
            status: 'Verified',
            remark: `Auto-generated from Sales Web Order #${alNumber} (Billplz ${billId})`,
          }])

          if (alErr) {
            console.error('AL creation error:', alErr)
            await sb.from('salesweb_order_timeline').insert([{
              order_id: orderId,
              status: 'AL Creation Failed',
              note: `Could not auto-create AL: ${alErr.message}`,
              changed_by: 'billplz',
            }])
          } else {
            await sb.from('salesweb_order_timeline').insert([{
              order_id: orderId,
              status: 'AL Created',
              note: `Acknowledgement Letter ${alNumber} auto-created in nursery system`,
              changed_by: 'billplz',
            }])
          }
        }
      }
    } else {
      await sb.from('salesweb_order_timeline').insert([{
        order_id: orderId,
        status: 'Payment Failed',
        note: `Billplz payment not completed (Bill: ${billId})`,
        changed_by: 'billplz',
      }])
    }

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('Webhook error:', err)
    return new Response('Internal error', { status: 500 })
  }
})
