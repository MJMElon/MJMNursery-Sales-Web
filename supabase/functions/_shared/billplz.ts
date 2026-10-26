// Shared by billplz-webhook, verify-billplz-bill and create-billplz-bill.
//
// There used to be two copies of "mark this order Paid" — one in the webhook,
// one in the verify fallback — and neither of them looked at how much was
// actually paid. A bill for RM 1 against an RM 5,000 order flipped it to Paid
// all the same. This is the one copy now, and it refuses to call an order paid
// unless Billplz says the money that arrived is the order's own total, to the
// sen.

// deno-lint-ignore-file no-explicit-any
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export function billplzBaseUrl(): string {
  return Deno.env.get('BILLPLZ_SANDBOX') !== 'false'
    ? 'https://www.billplz-sandbox.com/api/v3'
    : 'https://www.billplz.com/api/v3'
}

// RM -> sen, the unit Billplz counts in. Rounded once, here, so the bill and
// the check can never round differently.
export function toSen(rm: unknown): number {
  return Math.round(Number(rm || 0) * 100)
}

function rm(sen: number): string {
  return (sen / 100).toFixed(2)
}

export type PromoteResult =
  | { result: 'paid'; order_id: string }
  | { result: 'already'; order_id: string }
  | { result: 'mismatch'; order_id: string; paid_sen: number; due_sen: number }
  | { result: 'not_payable'; order_id: string; status: string }
  | { result: 'not_found'; order_id: string }

export async function promoteOrderToPaid(
  sb: SupabaseClient,
  opts: {
    orderId: string
    billId: string
    paidAt: string
    paidSen: number          // what Billplz says arrived, in sen
    source: 'billplz' | 'billplz-verify'
    supabaseUrl: string
    serviceKey: string
  },
): Promise<PromoteResult> {
  const { orderId, billId, paidAt, paidSen, source } = opts

  const { data: existing } = await sb
    .from('salesweb_customer_orders')
    .select('id, order_number, customer_id, customer_name, billing_name, customer_email, status, total, points_issued, points_redeemed, points_discount_rm')
    .eq('id', orderId)
    .maybeSingle()
  if (!existing) return { result: 'not_found', order_id: orderId }
  if (existing.status === 'Paid') return { result: 'already', order_id: orderId }

  // A payment that lands on an order which is no longer waiting for one —
  // cancelled, or already moved on by the office — is money somebody has to
  // look at, not a status to overwrite. Stock on a cancelled order has
  // already been given back.
  if (existing.status !== 'Pending Payment') {
    await noteOnce(sb, orderId, 'Payment Needs Review', billId,
      `Billplz bill ${billId} paid RM ${rm(paidSen)} at ${paidAt}, but the order is "${existing.status}", not waiting for payment. Not marked Paid — please check and settle by hand.`,
      source)
    return { result: 'not_payable', order_id: orderId, status: existing.status }
  }

  const dueSen = toSen(existing.total)
  if (!(paidSen > 0) || paidSen !== dueSen) {
    await noteOnce(sb, orderId, 'Payment Amount Mismatch', billId,
      `Billplz bill ${billId} paid RM ${rm(paidSen)} but the order total is RM ${rm(dueSen)}. Not marked Paid — please check and settle by hand.`,
      source)
    return { result: 'mismatch', order_id: orderId, paid_sen: paidSen, due_sen: dueSen }
  }

  // 1. Flip to Paid — and only if nobody else got there first. The webhook
  //    and the verify fallback routinely arrive within a second of each
  //    other; without the status in the WHERE both would go on to issue
  //    points and write ledger rows.
  const { data: flipped, error: flipErr } = await sb.from('salesweb_customer_orders')
    .update({ status: 'Paid', updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('status', 'Pending Payment')
    .select('id')
  if (flipErr) throw new Error('could not mark order paid: ' + flipErr.message)
  if (!flipped || flipped.length === 0) return { result: 'already', order_id: orderId }

  // What was received, for the office. A separate write so a database
  // without these columns still gets the status above.
  const { error: amtErr } = await sb.from('salesweb_customer_orders')
    .update({ amount_paid: paidSen / 100, amount_paid_at: new Date().toISOString() })
    .eq('id', orderId)
  if (amtErr) console.warn('amount_paid not recorded:', amtErr.message)

  await sb.from('salesweb_order_timeline').insert([{
    order_id: orderId,
    status: 'Paid',
    note: `Online payment confirmed via Billplz (Bill: ${billId}, RM ${rm(paidSen)}, Paid at: ${paidAt})`
      + (source === 'billplz-verify' ? ' — verified on return from payment gateway' : ''),
    changed_by: source,
  }])

  // 2. Loyalty points — points = floor(total / earn_rm) * earn_pts, the rate
  //    the office sets in Points Settings. A snapshot on the order.
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
  } catch (e) { console.warn('points config load failed, using defaults:', e) }

  const points = Math.floor(total / earnRm) * earnPts
  const redeemed = Number(existing.points_redeemed || 0)
  if (!existing.points_issued) {
    if (points > 0) {
      await sb.from('salesweb_customer_orders')
        .update({ points_issued: points }).eq('id', orderId)
      await sb.from('salesweb_order_timeline').insert([{
        order_id: orderId,
        status: 'Points Issued',
        note: `${points} loyalty points issued (RM ${total.toFixed(2)} @ ${earnPts} pt per RM ${earnRm})`,
        changed_by: source,
      }])
    }
    if (existing.customer_id) {
      const ledgerRows: any[] = []
      if (points > 0) {
        ledgerRows.push({
          user_id: existing.customer_id, change: points, type: 'Earned', order_id: orderId,
          rm_value: total, note: `Order ${existing.order_number || orderId}`, created_by: source,
        })
      }
      if (redeemed > 0) {
        ledgerRows.push({
          user_id: existing.customer_id, change: -redeemed, type: 'Redeemed', order_id: orderId,
          rm_value: Number(existing.points_discount_rm || 0),
          note: `Redeemed on order ${existing.order_number || orderId}`, created_by: source,
        })
      }
      if (ledgerRows.length) {
        const { error: ledgerErr } = await sb.from('salesweb_points_ledger').insert(ledgerRows)
        if (ledgerErr) console.error('points ledger insert failed:', ledgerErr)
      }
    }
  }

  // 3. Acknowledgement Letter in the nursery system — idempotent on al_number.
  const alNumber = existing.order_number
  if (alNumber) {
    const { data: existingAL } = await sb
      .from('shared_al_orders').select('id').eq('al_number', alNumber).maybeSingle()
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
        customer_name: existing.billing_name || existing.customer_name || '',
        product_name: productNames || 'Oil Palm Seedling',
        quantity_ordered: totalQty,
        balance_quantity: totalQty,
        price_per_unit: unitPrice,
        status: 'Verified',
        remark: `Auto-generated from Sales Web Order #${alNumber} (Billplz ${billId})`,
      }])
      await sb.from('salesweb_order_timeline').insert([alErr
        ? { order_id: orderId, status: 'AL Creation Failed', note: `Could not auto-create AL: ${alErr.message}`, changed_by: source }
        : { order_id: orderId, status: 'AL Created', note: `Acknowledgement Letter ${alNumber} auto-created in nursery system`, changed_by: source }])
      if (alErr) console.error('AL creation error:', alErr)
    }
  }

  // 4. Payment-confirmed email. Fire-and-forget: send-order-email is
  //    idempotent on email_sent_at, and a slow mail provider must not make
  //    Billplz retry the webhook.
  try {
    fetch(`${opts.supabaseUrl}/functions/v1/send-order-email`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${opts.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    }).then(async (r) => {
      if (!r.ok) console.error('send-order-email returned', r.status, await r.text())
    }).catch((e) => console.error('send-order-email fetch threw:', e))
  } catch (e) {
    console.error('send-order-email dispatch failed:', e)
  }

  return { result: 'paid', order_id: orderId }
}

// One review line per bill. Billplz retries its callback and the customer's
// return page calls verify as well, so the same mismatch would otherwise be
// written three or four times.
async function noteOnce(
  sb: SupabaseClient, orderId: string, status: string, billId: string, note: string, source: string,
) {
  const { data: prior } = await sb.from('salesweb_order_timeline')
    .select('id').eq('order_id', orderId).eq('status', status).like('note', `%${billId}%`).limit(1)
  if (prior && prior.length) return
  await sb.from('salesweb_order_timeline').insert([{ order_id: orderId, status, note, changed_by: source }])
  console.warn(status, orderId, note)
}
