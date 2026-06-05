// Supabase Edge Function: send-order-email
// Sends a "payment confirmed" email to the customer (CC'd to admin emails)
// when an order flips to Paid. Resend is the transport.
//
// Deploy:
//   supabase functions deploy send-order-email
//
// Required secrets (set once with `supabase secrets set NAME=value`):
//   RESEND_API_KEY                = re_xxxxxxxxxxxx                (Resend dashboard → API Keys)
//   SUPABASE_URL                  = injected automatically
//   SUPABASE_SERVICE_ROLE_KEY     = injected automatically
//
// One Resend setup step the team has to do:
//   1. Sign up at resend.com and verify the domain (DNS records).
//   2. Generate an API key.
//   3. In admin → Settings → Notifications, set:
//        From Email   = something@mjmnursery.com  (must be on the verified domain)
//        From Name    = MJM Nursery
//        Admin emails = one address per line
//        Booking URL  = https://collect.mjmnursery.com/
//
// Idempotency:
//   The Billplz webhook only calls this function the first time it sees the
//   order transition to Paid (gated by `!existing.points_issued`). For belt-
//   and-braces, this function bails early if the order already has an
//   `email_sent_at` timestamp, and records that timestamp at the end so
//   later invocations (admin manual Paid transition, retries) won't re-send.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function fmtRM(n: number): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c] as string))
}

interface OrderRow {
  id: string
  order_number: string | null
  customer_name: string | null
  customer_email: string | null
  total: number | null
  status: string
  points_issued: number | null
  points_redeemed: number | null
  email_sent_at: string | null
  created_at?: string | null
  billing_name?: string | null
  billing_tax_id?: string | null
  shipping_address?: string | null
  customer_remark?: string | null
  payment_terms?: string | null
  discount_amount?: number | null
  coupon_code?: string | null
  coupon_discount?: number | null
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-MY', { day:'2-digit', month:'short', year:'numeric' }) }
  catch { return '—' }
}

function buildProformaHtml(order: OrderRow, cfg: NotificationConfig, items: Array<{product_name:string;quantity:number;unit_price:number;subtotal:number}>): string {
  const orderNum = order.order_number || (order.id || '').substring(0, 8).toUpperCase()
  const fromName = cfg.from_name || 'MJM Nursery'
  const total = Number(order.total) || 0
  const subtotal = items.reduce((s, it) => s + (Number(it.subtotal) || 0), 0)

  // Pull billing address out of customer_remark — matches admin-orders parser.
  let billAddr = '', billReg = '', billIc = '', billMpob = ''
  if (order.customer_remark) {
    String(order.customer_remark).split(' | ').forEach((p) => {
      const t = p.trim()
      if      (t.indexOf('Billing Addr: ') === 0) billAddr = t.substring(14)
      else if (t.indexOf('Reg: ') === 0)          billReg  = t.substring(5)
      else if (t.indexOf('IC: ') === 0)           billIc   = t.substring(4)
      else if (t.indexOf('MPOB: ') === 0)         billMpob = t.substring(6)
    })
  }
  const addr = billAddr || order.shipping_address || ''
  const termsLabel = order.payment_terms === 'credit' ? 'Credit' : 'Cash on Collection'

  const itemsHtml = items.map((it) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;">${esc(it.product_name)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;">${fmtRM(it.unit_price)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;">${it.quantity}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;font-weight:600;">${fmtRM(it.subtotal)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F7F3EC;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A2E1B;">
  <div style="max-width:640px;margin:24px auto;background:#FFF;border:1px solid #C8DFC9;border-radius:14px;overflow:hidden;">
    <div style="background:#2D4A30;padding:22px 28px;color:#FFF;display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.7;">${esc(fromName)}</div>
        <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;margin-top:6px;">Proforma Invoice</div>
      </div>
      <div style="text-align:right;font-size:11px;line-height:1.6;opacity:.85;">
        <div>Order #${esc(orderNum)}</div>
        <div>${esc(fmtDate(order.created_at || null))}</div>
      </div>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">Hi ${esc(order.customer_name || 'there')},</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">As requested, here is the proforma invoice for your order. This is a <b>quotation</b> — no payment has been received yet. A formal tax invoice will follow once payment is confirmed.</p>

      <table style="width:100%;border-collapse:collapse;margin:8px 0 16px;background:#FAF7EE;border:1px solid #E8E2D2;border-radius:8px;">
        <tr>
          <td style="padding:10px 14px;font-size:12px;line-height:1.6;vertical-align:top;width:50%;">
            <div style="font-weight:700;color:#2D4A30;margin-bottom:4px;">Bill To</div>
            <div>${esc(order.billing_name || order.customer_name || '—')}</div>
            ${billReg ? `<div>Reg No: ${esc(billReg)}</div>` : ''}
            ${billIc ? `<div>IC: ${esc(billIc)}</div>` : ''}
            ${order.billing_tax_id ? `<div>TIN: ${esc(order.billing_tax_id)}</div>` : ''}
            ${billMpob ? `<div>MPOB: ${esc(billMpob)}</div>` : ''}
            ${addr ? `<div style="white-space:pre-wrap;margin-top:4px;">${esc(addr)}</div>` : ''}
          </td>
          <td style="padding:10px 14px;font-size:12px;line-height:1.6;vertical-align:top;width:50%;text-align:right;">
            <div style="font-weight:700;color:#2D4A30;margin-bottom:4px;">Payment</div>
            <div>Terms: ${esc(termsLabel)}</div>
            <div style="color:#7B8A6E;">Payment requested before delivery / collection.</div>
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin:8px 0 16px;">
        <thead><tr>
          <th style="padding:8px 10px;border-bottom:2px solid #2D4A30;font-size:11px;letter-spacing:.06em;text-transform:uppercase;text-align:left;color:#4A6B4C;">Item</th>
          <th style="padding:8px 10px;border-bottom:2px solid #2D4A30;font-size:11px;letter-spacing:.06em;text-transform:uppercase;text-align:right;color:#4A6B4C;">Unit Price</th>
          <th style="padding:8px 10px;border-bottom:2px solid #2D4A30;font-size:11px;letter-spacing:.06em;text-transform:uppercase;text-align:right;color:#4A6B4C;">Qty</th>
          <th style="padding:8px 10px;border-bottom:2px solid #2D4A30;font-size:11px;letter-spacing:.06em;text-transform:uppercase;text-align:right;color:#4A6B4C;">Subtotal</th>
        </tr></thead>
        <tbody>${itemsHtml || `<tr><td colspan="4" style="padding:10px;font-size:13px;color:#8AAB8C;">No items.</td></tr>`}</tbody>
      </table>

      <table style="width:100%;border-collapse:collapse;margin:8px 0 8px;">
        <tr><td style="padding:4px 10px;text-align:right;font-size:13px;">Subtotal</td><td style="padding:4px 10px;text-align:right;font-size:13px;width:140px;">${fmtRM(subtotal)}</td></tr>
        ${Number(order.discount_amount || 0) > 0 ? `<tr><td style="padding:4px 10px;text-align:right;font-size:13px;color:#B91C1C;">Discount</td><td style="padding:4px 10px;text-align:right;font-size:13px;color:#B91C1C;">-${fmtRM(order.discount_amount || 0)}</td></tr>` : ''}
        ${order.coupon_code ? `<tr><td style="padding:4px 10px;text-align:right;font-size:13px;color:#B91C1C;">Coupon (${esc(order.coupon_code)})</td><td style="padding:4px 10px;text-align:right;font-size:13px;color:#B91C1C;">-${fmtRM(order.coupon_discount || 0)}</td></tr>` : ''}
        <tr><td style="padding:8px 10px;text-align:right;font-size:15px;font-weight:800;border-top:2px solid #2D4A30;">Total Due</td><td style="padding:8px 10px;text-align:right;font-size:15px;font-weight:800;border-top:2px solid #2D4A30;color:#2D4A30;">${fmtRM(total)}</td></tr>
      </table>

      <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#4A6B4C;">If you have any questions, reply to this email and we'll get back to you.</p>
      <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:#4A6B4C;">— The ${esc(fromName)} Team</p>
    </div>
    <div style="background:#F7F3EC;padding:14px 28px;font-size:11px;color:#8AAB8C;text-align:center;">
      Proforma · Order #${esc(orderNum)} · ${fmtRM(total)}
    </div>
  </div>
</body></html>`
}

interface NotificationConfig {
  admin_emails?: string[]
  from_email?: string
  from_name?: string
  booking_url?: string
}

function buildEmailHtml(order: OrderRow, cfg: NotificationConfig, items: Array<{product_name:string;quantity:number;unit_price:number;subtotal:number}>): string {
  const orderNum = order.order_number || order.id.substring(0, 8).toUpperCase()
  const total = Number(order.total) || 0
  const bookingUrl = cfg.booking_url || 'https://collect.mjmnursery.com/'
  const fromName = cfg.from_name || 'MJM Nursery'

  const itemsHtml = items.map(it => `
    <tr>
      <td style="padding:8px 6px;border-bottom:1px solid #EEE;font-size:13px;">${esc(it.product_name)}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #EEE;font-size:13px;text-align:center;">${it.quantity}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #EEE;font-size:13px;text-align:right;">${fmtRM(it.subtotal)}</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F7F3EC;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A2E1B;">
  <div style="max-width:560px;margin:24px auto;background:#FFF;border:1px solid #C8DFC9;border-radius:14px;overflow:hidden;">
    <div style="background:#2D4A30;padding:22px 28px;color:#FFF;">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.7;">${esc(fromName)}</div>
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;margin-top:6px;">Payment Confirmed</div>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 12px;font-size:14px;line-height:1.6;">Hi ${esc(order.customer_name || 'there')},</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">Thank you — we've received your payment for <b>Order #${esc(orderNum)}</b>. Your seedlings are reserved and waiting at the nursery.</p>

      <table style="width:100%;border-collapse:collapse;margin:8px 0 16px;">
        <thead><tr>
          <th style="padding:8px 6px;border-bottom:2px solid #2D4A30;font-size:11px;letter-spacing:.06em;text-transform:uppercase;text-align:left;color:#4A6B4C;">Item</th>
          <th style="padding:8px 6px;border-bottom:2px solid #2D4A30;font-size:11px;letter-spacing:.06em;text-transform:uppercase;text-align:center;color:#4A6B4C;">Qty</th>
          <th style="padding:8px 6px;border-bottom:2px solid #2D4A30;font-size:11px;letter-spacing:.06em;text-transform:uppercase;text-align:right;color:#4A6B4C;">Subtotal</th>
        </tr></thead>
        <tbody>${itemsHtml || `<tr><td colspan="3" style="padding:10px;font-size:13px;color:#8AAB8C;">Order #${esc(orderNum)}</td></tr>`}</tbody>
        <tfoot><tr>
          <td colspan="2" style="padding:10px 6px;font-size:14px;font-weight:700;text-align:right;border-top:2px solid #2D4A30;">Total Paid</td>
          <td style="padding:10px 6px;font-size:14px;font-weight:700;text-align:right;border-top:2px solid #2D4A30;color:#2D4A30;">${fmtRM(total)}</td>
        </tr></tfoot>
      </table>

      <div style="background:#FFF8EB;border:1px solid #F2D58F;border-radius:10px;padding:14px 16px;margin:18px 0;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8A6314;margin-bottom:6px;">Next step — Book Your Collection</div>
        <p style="margin:0 0 10px;font-size:13px;line-height:1.55;color:#5C4308;">Pick a date and time slot for collection at our nursery. Bring this order number with you.</p>
        <a href="${esc(bookingUrl)}" style="display:inline-block;padding:10px 18px;background:#2D4A30;color:#FFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Book Collection Time →</a>
      </div>

      <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#4A6B4C;">If you have any questions, reply to this email and we'll get back to you.</p>
      <p style="margin:18px 0 0;font-size:12px;line-height:1.6;color:#4A6B4C;">— The ${esc(fromName)} Team</p>
    </div>
    <div style="background:#F7F3EC;padding:14px 28px;font-size:11px;color:#8AAB8C;text-align:center;">
      Order #${esc(orderNum)} · ${fmtRM(total)} · Paid
    </div>
  </div>
</body></html>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY missing — refusing to send email')
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }

    const reqBody = await req.json()
    const order_id: string | undefined = reqBody.order_id
    const emailType: 'paid' | 'proforma' = reqBody.type === 'proforma' ? 'proforma' : 'paid'
    const overrideTo: string | undefined = typeof reqBody.to === 'string' ? reqBody.to.trim() : undefined
    if (!order_id) {
      return new Response(JSON.stringify({ error: 'order_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const sb = createClient(supabaseUrl, supabaseKey)

    // Proforma needs extra columns (billing, address, terms, discounts);
    // the paid-confirmation path is happy with the slimmer projection.
    const selectCols = emailType === 'proforma'
      ? 'id, order_number, customer_name, customer_email, total, status, points_issued, points_redeemed, email_sent_at, created_at, billing_name, billing_tax_id, shipping_address, customer_remark, payment_terms, discount_amount, coupon_code, coupon_discount'
      : 'id, order_number, customer_name, customer_email, total, status, points_issued, points_redeemed, email_sent_at'
    const { data: order, error: orderErr } = await sb
      .from('salesweb_customer_orders')
      .select(selectCols)
      .eq('id', order_id)
      .maybeSingle()
    if (orderErr || !order) {
      console.error('Order lookup failed:', orderErr)
      return new Response(JSON.stringify({ error: 'order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }
    const recipient = overrideTo || order.customer_email
    if (!recipient) {
      return new Response(JSON.stringify({ skipped: 'no recipient email' }), { status: 200, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }
    // Idempotency only applies to the auto-sent paid confirmation. A proforma
    // is an on-demand admin action and is allowed to be re-sent.
    if (emailType === 'paid' && order.email_sent_at) {
      return new Response(JSON.stringify({ skipped: 'email_sent_at already populated', email_sent_at: order.email_sent_at }), { status: 200, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }

    const { data: items } = await sb
      .from('salesweb_order_items')
      .select('product_name, quantity, unit_price, subtotal')
      .eq('order_id', order_id)
    const orderItems = (items || []) as Array<{product_name:string;quantity:number;unit_price:number;subtotal:number}>

    const { data: cfgRow } = await sb
      .from('salesweb_app_settings')
      .select('value')
      .eq('key', 'notification_config')
      .maybeSingle()
    let cfg: NotificationConfig = { admin_emails: [], from_email: '', from_name: 'MJM Nursery', booking_url: 'https://collect.mjmnursery.com/' }
    if (cfgRow && cfgRow.value) {
      try {
        const parsed = typeof cfgRow.value === 'string' ? JSON.parse(cfgRow.value) : cfgRow.value
        cfg = { ...cfg, ...parsed }
      } catch (_e) { /* keep defaults */ }
    }

    const fromEmail = cfg.from_email || 'orders@mjmnursery.com'
    const fromName  = cfg.from_name  || 'MJM Nursery'
    const orderNum  = order.order_number || order.id.substring(0, 8).toUpperCase()

    const subject = emailType === 'proforma'
      ? `Proforma invoice — Order #${orderNum}`
      : `Payment confirmed — Order #${orderNum}`
    const htmlBody = emailType === 'proforma'
      ? buildProformaHtml(order as OrderRow, cfg, orderItems)
      : buildEmailHtml(order as OrderRow, cfg, orderItems)

    const payload = {
      from: `${fromName} <${fromEmail}>`,
      to:   [recipient],
      cc:   (cfg.admin_emails || []).filter((e) => !!e && e !== recipient),
      subject,
      html: htmlBody,
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const resendBody = await resendRes.json()
    if (!resendRes.ok) {
      console.error('Resend API error:', resendBody)
      return new Response(JSON.stringify({ error: 'resend failed', detail: resendBody }), { status: 502, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }

    // Only the paid-confirmation flow records email_sent_at; the proforma is
    // an ad-hoc admin send and shouldn't gate the real payment confirmation
    // that comes later.
    if (emailType === 'paid') {
      await sb.from('salesweb_customer_orders')
        .update({ email_sent_at: new Date().toISOString() })
        .eq('id', order_id)
    }

    return new Response(JSON.stringify({ ok: true, email_id: resendBody.id, type: emailType }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type':'application/json' },
    })
  } catch (e) {
    console.error('send-order-email exception:', e)
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type':'application/json' },
    })
  }
})
