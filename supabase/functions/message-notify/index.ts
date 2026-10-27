// Supabase Edge Function: message-notify
// Every email about a Contact Us case. One function, three moments:
//
//   new       a customer sent a message. Tells the people ticked "New case"
//             on the Messages tab Settings. Called by the storefront, so it
//             needs no login, and it CLAIMS the message (notified_at) so a
//             second call, or an old id, sends nothing.
//   assigned  "Assign & Notify" on a case. Tells the PIC they have the case,
//             unless their "Upon assigned" tick is off, and the customer
//             who will contact them and from which number.
//   solved    "Solve Case". Tells the customer the case is solved, and the
//             people ticked "Case solved".
//
// assigned and solved need a salesweb staff login, asked as the CALLER.
// What was sent, and what could not be, is written into the case timeline.
//
// The customer WhatsApp on Assign & Notify is sent separately, by the
// whatsapp function, so a WhatsApp problem never holds up the emails.
//
// Replaces notify-new-message. Secrets: RESEND_API_KEY, the one already
// used for order emails. The From address and name are the ones on admin
// Settings → Notifications.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor,
// name it exactly  message-notify , paste this file, Deploy.

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

// Malaysian numbers as WhatsApp wants them: digits only, country code first.
// Same rule as waNumber() in public/admin-messages.js — change both.
function waNumber(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('60')) return d
  if (d.startsWith('0')) return '6' + d
  if (d.startsWith('1') && d.length >= 9 && d.length <= 10) return '60' + d
  return d
}

const ADMIN_URL = 'https://www.mjmnursery.com/admin.html#messages'

function page(fromName: string, colour: string, kicker: string, title: string, inner: string): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F7F3EC;font-family:'Helvetica Neue',Arial,sans-serif;color:#1A2E1B;">
  <div style="max-width:560px;margin:24px auto;background:#FFF;border:1px solid #C8DFC9;border-radius:14px;overflow:hidden;">
    <div style="background:${colour};padding:18px 24px;color:#FFF;">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.75;">${esc(fromName)} · ${esc(kicker)}</div>
      <div style="font-size:20px;font-weight:700;margin-top:4px;">${esc(title)}</div>
    </div>
    <div style="padding:20px 24px;font-size:14px;line-height:1.6;">${inner}</div>
  </div>
</body></html>`
}

const row = (k: string, v: unknown) => v ? `<tr><td style="padding:4px 10px 4px 0;color:#4A6B4C;font-size:12px;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:4px 0;font-size:13px;">${v}</td></tr>` : ''
const quote = (t: unknown) => `<div style="white-space:pre-wrap;font-size:14px;line-height:1.6;background:#F7F3EC;border-radius:10px;padding:14px 16px;">${esc(t)}</div>`
const button = (href: string, label: string) => `<a href="${href}" style="display:inline-block;margin-top:18px;padding:10px 18px;background:#2D4A30;color:#FFF;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">${label}</a>`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!
    const input = await req.json().catch(() => ({}))
    const event = String(input.event || 'new')
    const id = String(input.id || '')
    if (!id) return json({ error: 'id required' }, 400)
    if (!['new', 'assigned', 'solved'].includes(event)) return json({ error: 'unknown event' }, 400)

    const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Who is asking. new comes from the storefront and needs nobody.
    let actorId: string | null = null
    let actorName = 'System'
    if (event !== 'new') {
      const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
      const { data: userData } = await asCaller.auth.getUser()
      const caller = userData?.user
      if (!caller) return json({ error: 'not signed in' }, 401)
      const { data: isStaff } = await asCaller.rpc('salesweb_is_message_staff')
      if (isStaff !== true) return json({ error: 'not allowed' }, 403)
      actorId = caller.id
      actorName = caller.user_metadata?.full_name || caller.email || 'Staff'
    }

    const cols = 'id, ref, name, email, phone, subject, kind, message, order_number, photo_path, created_at, status, assigned_user_id, assigned_name, assigned_phone, notified_at'
    let msg: any
    if (event === 'new') {
      // Claim. Only one caller ever gets the row back.
      const { data, error } = await sb.from('salesweb_messages').update({ notified_at: new Date().toISOString() })
        .eq('id', id).is('notified_at', null).select(cols).maybeSingle()
      if (error) return json({ error: error.message }, 500)
      if (!data) return json({ ok: true, skipped: 'already notified or not found' })
      msg = data
    } else {
      const { data, error } = await sb.from('salesweb_messages').select(cols).eq('id', id).maybeSingle()
      if (error) return json({ error: error.message }, 500)
      if (!data) return json({ error: 'message not found' }, 404)
      msg = data
    }
    const release = () => event === 'new' ? sb.from('salesweb_messages').update({ notified_at: null }).eq('id', id) : Promise.resolve()

    // Email of a portal user: their profile, else their login.
    const emailOf = async (userId: string): Promise<{ name: string; email: string } | null> => {
      const { data: p } = await sb.from('shared_profiles').select('full_name, email').eq('id', userId).maybeSingle()
      let email = p?.email || ''
      let name = p?.full_name || ''
      if (!email) {
        const { data: u } = await sb.auth.admin.getUserById(userId)
        email = u?.user?.email || ''
        name = name || u?.user?.user_metadata?.full_name || ''
      }
      return email ? { name: name || email, email } : null
    }
    const listOf = async (flag: 'notify_new' | 'notify_solved') => {
      const { data } = await sb.from('salesweb_message_pics').select('user_id').eq(flag, true)
      const out: { name: string; email: string }[] = []
      for (const r of data || []) { const e = await emailOf(r.user_id); if (e) out.push(e) }
      return out
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

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
    const send = async (to: string[], subject: string, html: string, replyTo?: string) => {
      if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not set in Supabase' }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to, ...(replyTo ? { reply_to: replyTo } : {}), subject, html }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, error: body?.message || body?.error || ('HTTP ' + res.status) }
      return { ok: true, error: '' }
    }

    const note = (body: string) => sb.from('salesweb_message_events').insert({
      message_id: id, kind: 'email', body, actor_id: actorId, actor_name: actorName,
    })

    const isComplaint = msg.kind === 'complaint'
    const custWa = waNumber(msg.phone)
    const caseRows = () =>
      row('Customer', esc(msg.name)) +
      row('Phone', esc(msg.phone) + (custWa ? ` · <a href="https://wa.me/${custWa}">WhatsApp</a>` : '')) +
      row('Email', esc(msg.email)) + row('Topic', esc(msg.subject)) +
      row('Order #', msg.order_number ? esc('#' + msg.order_number) : '') +
      row('Photo', msg.photo_path ? 'Attached, open it in the admin portal' : '')

    const done: string[] = []
    const failed: string[] = []
    const skipped: string[] = []

    // ── New case ───────────────────────────────────────────────────
    if (event === 'new') {
      const people = await listOf('notify_new')
      if (!people.length) { await release(); return json({ ok: true, skipped: 'nobody is ticked for New case' }) }
      const r = await send(people.map((p) => p.email),
        `${isComplaint ? '⚠ ' : ''}New case ${msg.ref} — ${msg.subject} — ${msg.name}`,
        page(fromName, isComplaint ? '#9B2C2C' : '#2D4A30', 'New case', `New case ${msg.ref} · ${msg.subject}`,
          `<table style="border-collapse:collapse;margin-bottom:14px;">${caseRows()}</table>${quote(msg.message)}${button(ADMIN_URL, 'Open in Admin Portal → Messages')}`),
        msg.email || undefined)
      if (!r.ok) { await release(); return json({ ok: false, error: r.error }, 502) }
      await note('New case email sent to ' + people.map((p) => p.name).join(', '))
      return json({ ok: true, recipients: people.length })
    }

    // ── Assigned ───────────────────────────────────────────────────
    if (event === 'assigned') {
      if (!msg.assigned_user_id || !msg.assigned_name) return json({ ok: false, error: 'assign the case to somebody first' }, 400)
      const pic = await emailOf(msg.assigned_user_id)
      const picPhone = msg.assigned_phone ? '+' + waNumber(msg.assigned_phone) : ''
      // Off only when somebody unticked it. Before the column exists the
      // read fails and the answer is still yes.
      const { data: picRow } = await sb.from('salesweb_message_pics').select('*').eq('user_id', msg.assigned_user_id).maybeSingle()
      const picWants = !picRow || picRow.notify_assigned !== false

      if (!picWants) skipped.push(`${msg.assigned_name} (PIC): Upon assigned is off in Settings`)
      else if (!pic) failed.push(`${msg.assigned_name} (PIC): has no email`)
      else {
        const r = await send([pic.email], `Case ${msg.ref} is assigned to you — ${msg.name}`,
          page(fromName, isComplaint ? '#9B2C2C' : '#2D4A30', 'Case assigned to you', `${msg.ref} · ${msg.subject}`,
            `<p style="margin:0 0 12px;">Hi ${esc(msg.assigned_name)}, this case is now yours. Please contact the customer on WhatsApp${picPhone ? ' from ' + esc(picPhone) : ''}.</p>` +
            `<table style="border-collapse:collapse;margin-bottom:14px;">${caseRows()}</table>${quote(msg.message)}` +
            (custWa ? button(`https://wa.me/${custWa}`, 'WhatsApp the customer') + ' &nbsp;' : '') + button(ADMIN_URL, 'Open the case')),
          msg.email || undefined)
        if (r.ok) done.push(`${msg.assigned_name} (PIC)`); else failed.push(`${msg.assigned_name} (PIC): ${r.error}`)
      }

      if (!msg.email) failed.push('the customer: gave no email')
      else {
        const r = await send([msg.email], `Your case ${msg.ref} — ${fromName}`,
          page(fromName, '#2D4A30', 'Your case', `Case ${msg.ref}`,
            `<p style="margin:0 0 12px;">Hi ${esc(msg.name)},</p>` +
            `<p style="margin:0 0 12px;">Thank you for contacting ${esc(fromName)}. Your case <strong>${esc(msg.ref)}</strong> (${esc(msg.subject)}) has been assigned to <strong>${esc(msg.assigned_name)}</strong>, who will contact you on WhatsApp${picPhone ? ' from <strong>' + esc(picPhone) + '</strong>' : ''} shortly.</p>` +
            `<p style="margin:0;color:#4A6B4C;font-size:13px;">Please keep your case number ${esc(msg.ref)} for reference.</p>`),
          pic?.email)
        if (r.ok) done.push('the customer'); else failed.push(`the customer: ${r.error}`)
      }
    }

    // ── Solved ─────────────────────────────────────────────────────
    if (event === 'solved') {
      const pic = msg.assigned_user_id ? await emailOf(msg.assigned_user_id) : null
      const { data: last } = await sb.from('salesweb_message_events').select('body, actor_name')
        .eq('message_id', id).eq('kind', 'note').order('created_at', { ascending: false }).limit(1).maybeSingle()

      if (!msg.email) failed.push('the customer: gave no email')
      else {
        const r = await send([msg.email], `Your case ${msg.ref} is solved — ${fromName}`,
          page(fromName, '#2D4A30', 'Your case', `Case ${msg.ref} is solved`,
            `<p style="margin:0 0 12px;">Hi ${esc(msg.name)},</p>` +
            `<p style="margin:0 0 12px;">Your case <strong>${esc(msg.ref)}</strong> (${esc(msg.subject)}) has been marked as solved. Thank you for your patience.</p>` +
            `<p style="margin:0;color:#4A6B4C;font-size:13px;">If anything is still not right, simply reply to this email${msg.assigned_name ? ' or WhatsApp ' + esc(msg.assigned_name) : ''} and quote ${esc(msg.ref)}.</p>`),
          pic?.email)
        if (r.ok) done.push('the customer'); else failed.push(`the customer: ${r.error}`)
      }

      const people = await listOf('notify_solved')
      if (people.length) {
        const r = await send(people.map((p) => p.email), `Solved: case ${msg.ref} — ${msg.name}`,
          page(fromName, '#2D4A30', 'Case solved', `${msg.ref} solved · ${msg.subject}`,
            `<table style="border-collapse:collapse;margin-bottom:14px;">${caseRows()}${row('Handled by', esc(msg.assigned_name || '—'))}${row('Solved by', esc(actorName))}</table>` +
            (last?.body ? `<div style="font-size:12px;color:#4A6B4C;margin-bottom:4px;">How it was solved</div>${quote(last.body)}` : '') +
            button(ADMIN_URL, 'Open the case')))
        const names = people.map((p) => p.name).join(', ')
        if (r.ok) done.push(names); else failed.push(`${names}: ${r.error}`)
      }
    }

    const parts = []
    if (done.length) parts.push('Email sent to ' + done.join(', '))
    if (failed.length) parts.push('Not emailed: ' + failed.join('; '))
    if (skipped.length) parts.push('Not emailed by choice: ' + skipped.join('; '))
    if (parts.length) await note(parts.join('. '))
    return json({ ok: failed.length === 0, sent: done, failed, skipped })
  } catch (e) {
    console.error('message-notify:', e)
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
