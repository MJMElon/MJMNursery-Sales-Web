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

    const { order_id } = await req.json()
    if (!order_id) {
      return new Response(JSON.stringify({ error: 'order_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const sb = createClient(supabaseUrl, supabaseKey)

    const { data: order, error: orderErr } = await sb
      .from('salesweb_customer_orders')
      .select('id, order_number, customer_name, customer_email, total, status, points_issued, points_redeemed, email_sent_at')
      .eq('id', order_id)
      .maybeSingle()
    if (orderErr || !order) {
      console.error('Order lookup failed:', orderErr)
      return new Response(JSON.stringify({ error: 'order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }
    if (!order.customer_email) {
      return new Response(JSON.stringify({ skipped: 'no customer_email on order' }), { status: 200, headers: { ...corsHeaders, 'Content-Type':'application/json' } })
    }
    if (order.email_sent_at) {
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

    const payload = {
      from: `${fromName} <${fromEmail}>`,
      to:   [order.customer_email],
      cc:   (cfg.admin_emails || []).filter((e) => !!e && e !== order.customer_email),
      subject: `Payment confirmed — Order #${orderNum}`,
      html: buildEmailHtml(order as OrderRow, cfg, orderItems),
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

    // Record send so subsequent triggers (admin retry, webhook redelivery)
    // don't double-send.
    await sb.from('salesweb_customer_orders')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('id', order_id)

    return new Response(JSON.stringify({ ok: true, email_id: resendBody.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type':'application/json' },
    })
  } catch (e) {
    console.error('send-order-email exception:', e)
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type':'application/json' },
    })
  }
})
