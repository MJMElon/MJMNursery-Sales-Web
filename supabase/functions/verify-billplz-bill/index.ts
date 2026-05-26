// Supabase Edge Function: Verify Billplz Bill (server-side fallback)
//
// Called from payment-callback.html when the customer returns from Billplz.
// Queries the Billplz API directly using the secret API key — the redirect
// query params are not trusted, since they can be tampered with. If the bill
// is genuinely paid, runs the same idempotent promote-to-Paid logic the
// webhook uses (status flip, points issuance, AL creation).
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
    const BILLPLZ_SANDBOX = Deno.env.get('BILLPLZ_SANDBOX') !== 'false'
    if (!BILLPLZ_API_KEY) {
      return jsonResp({ error: 'Server misconfigured: BILLPLZ_API_KEY missing' }, 500)
    }

    const body = await req.json().catch(() => ({}))
    const bill_id = (body && body.bill_id) || ''
    const expected_order_id = (body && body.order_id) || ''
    if (!bill_id) {
      return jsonResp({ error: 'Missing bill_id' }, 400)
    }

    // Ask Billplz directly — never trust the redirect params.
    const baseUrl = BILLPLZ_SANDBOX
      ? 'https://www.billplz-sandbox.com/api/v3'
      : 'https://www.billplz.com/api/v3'
    const billRes = await fetch(`${baseUrl}/bills/${encodeURIComponent(bill_id)}`, {
      headers: { 'Authorization': 'Basic ' + btoa(BILLPLZ_API_KEY + ':') },
    })
    const bill = await billRes.json()
    if (!billRes.ok) {
      console.error('Billplz API error:', bill)
      return jsonResp({ error: 'Could not verify with Billplz', detail: bill }, 502)
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
      return jsonResp({ error: 'Server misconfigured: Supabase env missing' }, 500)
    }
    const sb = createClient(supabaseUrl, supabaseKey)

    const { data: existing } = await sb
      .from('salesweb_customer_orders')
      .select('id, order_number, customer_id, customer_name, billing_name, customer_email, status, total, points_issued, points_redeemed, points_discount_rm')
      .eq('id', order_id)
      .maybeSingle()
    if (!existing) {
      return jsonResp({ error: 'Order not found' }, 404)
    }
    if (existing.status === 'Paid') {
      return jsonResp({ paid: true, already: true, order_id }, 200)
    }

    const paidAt = bill.paid_at || new Date().toISOString()

    // 1. Flip the order to Paid.
    await sb.from('salesweb_customer_orders')
      .update({ status: 'Paid', updated_at: new Date().toISOString() })
      .eq('id', order_id)

    await sb.from('salesweb_order_timeline').insert([{
      order_id,
      status: 'Paid',
      note: `Online payment confirmed via Billplz (Bill: ${bill_id}, Paid at: ${paidAt}) — verified on return from payment gateway`,
      changed_by: 'billplz-verify',
    }])

    // 2. Issue loyalty points — same formula and idempotency guard as the
    //    webhook. Both code paths gate on `!points_issued` so a duplicate
    //    call (webhook + fallback firing for the same order) never
    //    double-credits.
    const total = Number(existing.total || 0)
    let earnRm = 1, earnPts = 1
    try {
      const { data: cfgRow } = await sb
        .from('salesweb_app_settings')
        .select('value').eq('key', 'points_config').maybeSingle()
      if (cfgRow && cfgRow.value) {
        const cfg = typeof cfgRow.value === 'string' ? JSON.parse(cfgRow.value) : cfgRow.value
        if (cfg && cfg.earn_rm)  earnRm  = Math.max(0.01, Number(cfg.earn_rm)  || 1)
        if (cfg && cfg.earn_pts !== undefined) earnPts = Math.max(0, Number(cfg.earn_pts) || 0)
      }
    } catch (e) { console.warn('points config load failed:', e) }

    const points = Math.floor(total / earnRm) * earnPts
    const redeemed = Number(existing.points_redeemed || 0)
    if (!existing.points_issued) {
      if (points > 0) {
        await sb.from('salesweb_customer_orders')
          .update({ points_issued: points }).eq('id', order_id)
        await sb.from('salesweb_order_timeline').insert([{
          order_id,
          status: 'Points Issued',
          note: `${points} loyalty points issued (RM ${total.toFixed(2)} @ ${earnPts} pt per RM ${earnRm})`,
          changed_by: 'billplz-verify',
        }])
      }
      if (existing.customer_id) {
        const ledgerRows: any[] = []
        if (points > 0) {
          ledgerRows.push({
            user_id: existing.customer_id,
            change: points,
            type: 'Earned',
            order_id,
            rm_value: total,
            note: `Order ${existing.order_number || order_id}`,
            created_by: 'billplz-verify',
          })
        }
        if (redeemed > 0) {
          ledgerRows.push({
            user_id: existing.customer_id,
            change: -redeemed,
            type: 'Redeemed',
            order_id,
            rm_value: Number(existing.points_discount_rm || 0),
            note: `Redeemed on order ${existing.order_number || order_id}`,
            created_by: 'billplz-verify',
          })
        }
        if (ledgerRows.length) {
          const { error: ledgerErr } = await sb.from('salesweb_points_ledger').insert(ledgerRows)
          if (ledgerErr) console.error('points ledger insert failed:', ledgerErr)
        }
      }
    }

    // 3. Auto-create AL — idempotent on al_number.
    const alNumber = existing.order_number
    if (alNumber) {
      const { data: existingAL } = await sb
        .from('shared_al_orders')
        .select('id').eq('al_number', alNumber).maybeSingle()
      if (!existingAL) {
        const { data: items } = await sb
          .from('salesweb_order_items')
          .select('product_name, quantity, unit_price')
          .eq('order_id', order_id)
        const lines = items || []
        const totalQty = lines.reduce((s: number, it: any) => s + Number(it.quantity || 0), 0)
        const productNames = lines.map((it: any) => it.product_name).join(', ')
        const unitPrice = totalQty > 0 ? Math.round((total / totalQty) * 100) / 100 : 0

        const { error: alErr } = await sb.from('shared_al_orders').insert([{
          al_number: alNumber,
          order_number: alNumber,
          order_date: new Date().toISOString(),
          customer_name: existing.billing_name || existing.customer_name || '',
          product_name: productNames || 'Oil Palm Seedling',
          quantity_ordered: totalQty,
          balance_quantity: totalQty,
          price_per_unit: unitPrice,
          status: 'Verified',
          remark: `Auto-generated from Sales Web Order #${alNumber} (Billplz ${bill_id})`,
        }])

        if (alErr) {
          console.error('AL creation error:', alErr)
          await sb.from('salesweb_order_timeline').insert([{
            order_id,
            status: 'AL Creation Failed',
            note: `Could not auto-create AL: ${alErr.message}`,
            changed_by: 'billplz-verify',
          }])
        } else {
          await sb.from('salesweb_order_timeline').insert([{
            order_id,
            status: 'AL Created',
            note: `Acknowledgement Letter ${alNumber} auto-created in nursery system`,
            changed_by: 'billplz-verify',
          }])
        }
      }
    }

    // 4. Send payment-confirmed email to customer (CC admin). Mirrors the
    //    webhook's behaviour. Fire-and-forget so a Resend hiccup doesn't
    //    fail the verification; send-order-email is idempotent via
    //    order.email_sent_at so a duplicate dispatch (webhook + verifier
    //    both firing) won't send two emails.
    try {
      const fnUrl = `${supabaseUrl}/functions/v1/send-order-email`
      fetch(fnUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_id }),
      }).then(async (r) => {
        if (!r.ok) console.error('send-order-email returned', r.status, await r.text())
      }).catch((e) => console.error('send-order-email fetch threw:', e))
    } catch (e) {
      console.error('send-order-email dispatch failed:', e)
    }

    return jsonResp({ paid: true, updated: true, order_id }, 200)

  } catch (err) {
    console.error('verify-billplz-bill error:', err)
    return jsonResp({ error: (err as Error).message }, 500)
  }
})

function jsonResp(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
