// Supabase Edge Function: notify-new-message
// Emails the office when a customer sends a message through the Contact Us
// form. Recipients are the list kept on the admin portal's Messages tab
// (salesweb_message_notify_emails), not the order-email list, so the people
// who handle complaints can be different from the people who handle orders.
//
// Deploy:
//   supabase functions deploy notify-new-message
//
// Secrets: RESEND_API_KEY (already set for send-order-email).
// The From address / name are reused from admin → Settings → Notifications.
//
// The storefront calls this right after salesweb_submit_message() returns,
// with nothing but the new message's id. Anybody can call it, so it must be
// harmless to call twice or with an old id: it CLAIMS the message by setting
// notified_at only where it is still null, and a message already claimed is
// skipped. If the send fails the claim is released so a retry can send it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string))
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { id } = await req.json().catch(() => ({}))
    if (!id || typeof id !== 'string') return json({ error: 'id required' }, 400)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Claim. Only one caller ever gets the row back.
    const { data: msg, error: claimErr } = await sb
      .from('salesweb_messages')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', id)
      .is('notified_at', null)
      .select('id, ref, name, email, phone, subject, kind, message, order_number, photo_path, created_at')
      .maybeSingle()
    if (claimErr) return json({ error: claimErr.message }, 500)
    if (!msg) return json({ ok: true, skipped: 'already notified or not found' })

    const release = () => sb.from('salesweb_messages').update({ notified_at: null }).eq('id', id)

    const { data: rows } = await sb.from('salesweb_message_notify_emails').select('email')
    const to = (rows || []).map((r: { email: string }) => r.email).filter(Boolean)
    if (!to.length) {
      await release()
      return json({ ok: true, skipped: 'no recipients configured' })
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
    if (!RESEND_API_KEY) {
      await release()
      return json({ error: 'RESEND_API_KEY not configured' }, 500)
    }

    let fromEmail = 'orders@mjmnursery.com', fromName = 'MJM Nursery'
    try {
      const { data: cfgRow } = await sb.from('salesweb_app_settings').select('value').eq('key', 'notification_config').maybeSingle()
      if (cfgRow?.value) {
        const cfg = typeof cfgRow.value === 'string' ? JSON.parse(cfgRow.value) : cfgRow.value
        if (cfg.from_email) fromEmail = cfg.from_email
        if (cfg.from_name) fromName = cfg.from_name
      }
    } catch (_) { /* defaults */ }

    const isComplaint = msg.kind === 'complaint'
    const adminUrl = 'https://www.mjmnursery.com/admin.html#messages'
    const subject = `${isComplaint ? '⚠ Complaint' : 'New message'} ${msg.ref} — ${msg.subject} — ${msg.name}`
    const row = (k: string, v: unknown) => v ? `<tr><td style="padding:4px 10px 4px 0;color:#4A6B4C;font-size:12px;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:4px 0;font-size:13px;">${esc(v)}</td></tr>` : ''

    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F7F3EC;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A2E1B;">
  <div style="max-width:560px;margin:24px auto;background:#FFF;border:1px solid #C8DFC9;border-radius:14px;overflow:hidden;">
    <div style="background:${isComplaint ? '#9B2C2C' : '#2D4A30'};padding:18px 24px;color:#FFF;">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.75;">${esc(fromName)} · Contact Us</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">${isComplaint ? 'New complaint' : 'New message'} ${esc(msg.ref)}</div>
    </div>
    <div style="padding:20px 24px;">
      <table style="border-collapse:collapse;margin-bottom:14px;">
        ${row('From', msg.name)}${row('Email', msg.email)}${row('Phone', msg.phone)}
        ${row('Subject', msg.subject)}${row('Order #', msg.order_number)}${row('Photo', msg.photo_path ? 'Attached — open it in the admin portal' : '')}
      </table>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.6;background:#F7F3EC;border-radius:10px;padding:14px 16px;">${esc(msg.message)}</div>
      <a href="${adminUrl}" style="display:inline-block;margin-top:18px;padding:10px 18px;background:#2D4A30;color:#FFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">Open in Admin Portal → Messages</a>
    </div>
  </div>
</body></html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to, reply_to: msg.email, subject, html }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('Resend error:', body)
      await release()
      return json({ error: 'resend failed', detail: body }, 502)
    }
    return json({ ok: true, email_id: body.id, recipients: to.length })
  } catch (e) {
    console.error('notify-new-message:', e)
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
