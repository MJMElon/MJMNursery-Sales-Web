// Supabase Edge Function: whatsapp
// Everything the system does with the WhatsApp Business (Cloud) API goes
// through this one function, so there is one set of keys and one log.
//
// Actions (POST { action, ... }):
//   status           is it connected, and which number is it       (WhatsApp tab)
//   templates        list the templates on the WhatsApp account     (WhatsApp tab)
//   save_template    create one, or edit one, and send it to Meta   (WhatsApp tab)
//   delete_template  delete one at Meta                             (WhatsApp tab)
//   test             send an automatic message to one number with
//                    sample values                                  (WhatsApp tab)
//   send_case        tell a Contact Us customer who will handle
//                    their case                                     (Messages tab)
//
// The WhatsApp tab actions need salesweb_can_manage_whatsapp(), send_case
// needs salesweb_is_message_staff(). Both are asked as the CALLER, before
// anything is read or sent.
//
// Which template an automatic message uses, and whether it is switched
// on, is the salesweb_wa_events row the WhatsApp tab saves. Every send,
// sent or not, is written to salesweb_wa_log.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   WHATSAPP_TOKEN                 permanent System User access token
//   WHATSAPP_PHONE_NUMBER_ID       the Phone number ID (not the number itself)
//   WHATSAPP_BUSINESS_ACCOUNT_ID   the WhatsApp Business Account ID
// Until they are set every action answers { not_configured: true } and
// the pages say so. Nothing else breaks.
//
// Templates written on the WhatsApp tab use NAMED fields, {{customer_name}}
// rather than {{1}}, so the text itself says what goes where and no
// separate mapping is kept. A template made in WhatsApp Manager with
// numbered fields still works: {{1}}, {{2}}… are filled in the order the
// event lists its fields below.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor,
// name it exactly  whatsapp , paste this file, Deploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const GRAPH = 'https://graph.facebook.com/v21.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// The automatic messages and the fields each one can fill. Same list as
// WA_EVENTS in public/admin-whatsapp.js — change both.
const EVENTS: Record<string, { fields: string[]; samples: Record<string, string> }> = {
  case_assigned: {
    fields: ['customer_name', 'case_ref', 'staff_name', 'staff_phone'],
    samples: { customer_name: 'Tan Ah Kow', case_ref: 'MSG-00042', staff_name: 'Mei Ling', staff_phone: '+60123456789' },
  },
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

function graphError(body: any, status: number): string {
  const e = body?.error
  if (!e) return 'HTTP ' + status
  return [e.error_user_title, e.error_user_msg || e.error_data?.details || e.message].filter(Boolean).join(': ') +
    (e.code ? ` (code ${e.code})` : '')
}

// {{customer_name}} or {{1}}, in the order they first appear.
function fieldsIn(text: string): string[] {
  const out: string[] = []
  for (const m of String(text || '').matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization') || ''
    const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await asCaller.auth.getUser()
    const caller = userData?.user
    if (!caller) return json({ error: 'not signed in' }, 401)
    const actorName = caller.user_metadata?.full_name || caller.email || 'Staff'

    const input = await req.json().catch(() => ({}))
    const action = String(input.action || '')

    const gate = action === 'send_case' ? 'salesweb_is_message_staff' : 'salesweb_can_manage_whatsapp'
    const { data: allowed } = await asCaller.rpc(gate)
    if (allowed !== true) return json({ error: 'not allowed' }, 403)

    const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const TOKEN = Deno.env.get('WHATSAPP_TOKEN') || ''
    const PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || ''
    const WABA = Deno.env.get('WHATSAPP_BUSINESS_ACCOUNT_ID') || ''
    const missing = [!TOKEN && 'WHATSAPP_TOKEN', !PHONE_ID && 'WHATSAPP_PHONE_NUMBER_ID', !WABA && 'WHATSAPP_BUSINESS_ACCOUNT_ID'].filter(Boolean)

    const graph = async (path: string, method = 'GET', body?: unknown) => {
      const res = await fetch(GRAPH + path, {
        method,
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, data }
    }

    const log = (row: Record<string, unknown>) =>
      sb.from('salesweb_wa_log').insert({ actor_id: caller.id, actor_name: actorName, ...row })

    // Sends an approved template to one number, filling its fields from
    // `values`. Reads the template from Meta first so it knows whether
    // the fields are named or numbered, and which ones it asks for.
    const sendTemplate = async (to: string, name: string, lang: string, order: string[], values: Record<string, string>) => {
      const t = await graph(`/${WABA}/message_templates?name=${encodeURIComponent(name)}&fields=name,language,status,components,parameter_format&limit=50`)
      if (!t.ok) return { ok: false, error: graphError(t.data, t.status), params: null }
      const tpl = (t.data?.data || []).find((x: any) => x.name === name && x.language === lang)
      if (!tpl) return { ok: false, error: `there is no template called ${name} in language ${lang}`, params: null }
      if (tpl.status !== 'APPROVED') return { ok: false, error: `template ${name} is ${String(tpl.status).toLowerCase()} at Meta, not approved`, params: null }
      const bodyText = (tpl.components || []).find((c: any) => c.type === 'BODY')?.text || ''
      const wanted = fieldsIn(bodyText)
      const named = wanted.some((f) => !/^\d+$/.test(f))
      const params: Record<string, string> = {}
      const parameters = []
      for (const f of wanted) {
        const key = named ? f : order[Number(f) - 1]
        if (!key || values[key] === undefined) return { ok: false, error: `template ${name} asks for {{${f}}}, which this message cannot fill`, params: null }
        const text = String(values[key] ?? '').trim() || '-'
        params[f] = text
        parameters.push(named ? { type: 'text', parameter_name: f, text } : { type: 'text', text })
      }
      const res = await graph(`/${PHONE_ID}/messages`, 'POST', {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name, language: { code: lang },
          components: parameters.length ? [{ type: 'body', parameters }] : [],
        },
      })
      if (!res.ok) return { ok: false, error: graphError(res.data, res.status), params }
      return { ok: true, id: res.data?.messages?.[0]?.id || '', params }
    }

    // ── WhatsApp tab ───────────────────────────────────────────────
    if (action === 'status') {
      if (missing.length) return json({ ok: false, not_configured: true, missing })
      const p = await graph(`/${PHONE_ID}?fields=display_phone_number,verified_name,quality_rating,name_status`)
      if (!p.ok) return json({ ok: false, error: graphError(p.data, p.status) })
      return json({ ok: true, phone: p.data })
    }

    if (action === 'templates') {
      if (missing.length) return json({ ok: false, not_configured: true, missing })
      const r = await graph(`/${WABA}/message_templates?fields=id,name,language,status,category,components,rejected_reason,parameter_format&limit=200`)
      if (!r.ok) return json({ ok: false, error: graphError(r.data, r.status) })
      return json({ ok: true, templates: r.data?.data || [] })
    }

    if (action === 'save_template') {
      if (missing.length) return json({ ok: false, not_configured: true, missing })
      const name = String(input.name || '').trim()
      const lang = String(input.language || 'en').trim()
      const body = String(input.body || '').trim()
      const footer = String(input.footer || '').trim()
      const samples: Record<string, string> = input.samples || {}
      if (!/^[a-z0-9_]{1,512}$/.test(name)) return json({ ok: false, error: 'the name may only use small letters, numbers and _' })
      if (!body) return json({ ok: false, error: 'write the message first' })
      if (body.length > 1024) return json({ ok: false, error: 'the message is longer than 1024 characters' })
      const fields = fieldsIn(body)
      if (fields.some((f) => /^\d+$/.test(f))) return json({ ok: false, error: 'use the field buttons, not numbered {{1}} fields' })
      const components: any[] = [{
        type: 'BODY', text: body,
        ...(fields.length ? { example: { body_text_named_params: fields.map((f) => ({ param_name: f, example: samples[f] || f })) } } : {}),
      }]
      if (footer) components.push({ type: 'FOOTER', text: footer })
      const r = input.id
        ? await graph(`/${encodeURIComponent(String(input.id))}`, 'POST', { components })
        : await graph(`/${WABA}/message_templates`, 'POST', {
            name, language: lang, category: 'UTILITY',
            ...(fields.length ? { parameter_format: 'named' } : {}),
            components,
          })
      if (!r.ok) return json({ ok: false, error: graphError(r.data, r.status) })
      return json({ ok: true, id: r.data?.id || input.id, status: r.data?.status || 'PENDING' })
    }

    if (action === 'delete_template') {
      if (missing.length) return json({ ok: false, not_configured: true, missing })
      const name = String(input.name || '').trim()
      if (!name) return json({ ok: false, error: 'name required' })
      const r = await graph(`/${WABA}/message_templates?name=${encodeURIComponent(name)}` +
        (input.id ? `&hsm_id=${encodeURIComponent(String(input.id))}` : ''), 'DELETE')
      if (!r.ok) return json({ ok: false, error: graphError(r.data, r.status) })
      return json({ ok: true })
    }

    if (action === 'test') {
      const ev = EVENTS[String(input.event || '')]
      if (!ev) return json({ ok: false, error: 'unknown message' })
      const to = waNumber(input.to)
      if (to.length < 10 || to.length > 15) return json({ ok: false, error: 'enter a valid WhatsApp number to send the test to' })
      const name = String(input.template_name || '').trim()
      const lang = String(input.template_lang || '').trim()
      if (!name || !lang) return json({ ok: false, error: 'pick a template first' })
      if (missing.length) return json({ ok: false, not_configured: true, missing })
      const r = await sendTemplate(to, name, lang, ev.fields, ev.samples)
      await log({ event_key: input.event, to_phone: to, template_name: name, template_lang: lang, params: r.params,
                  status: r.ok ? 'sent' : 'failed', detail: r.ok ? 'test' : 'test: ' + r.error, wa_message_id: r.ok ? r.id : null, ref_type: 'test' })
      return json(r.ok ? { ok: true } : { ok: false, error: r.error })
    }

    // ── Messages tab: the case was assigned ───────────────────────
    if (action === 'send_case') {
      const id = String(input.id || '')
      if (!id) return json({ error: 'id required' }, 400)
      const { data: msg, error } = await sb.from('salesweb_messages')
        .select('id, ref, name, phone, assigned_name, assigned_phone').eq('id', id).maybeSingle()
      if (error) return json({ error: error.message }, 500)
      if (!msg) return json({ error: 'message not found' }, 404)
      if (!msg.assigned_name || !msg.assigned_phone) return json({ error: 'assign the case to somebody with a WhatsApp number first' }, 400)

      const to = waNumber(msg.phone)
      const record = async (status: string, detail: string, eventBody: string, extra: Record<string, unknown> = {}) => {
        await sb.from('salesweb_messages').update({
          wa_status: status, wa_detail: detail,
          wa_sent_at: status === 'sent' ? new Date().toISOString() : null,
        }).eq('id', id)
        await sb.from('salesweb_message_events').insert({
          message_id: id, kind: 'whatsapp', body: eventBody, actor_id: caller.id, actor_name: actorName,
        })
        await log({ event_key: 'case_assigned', to_phone: to || msg.phone, status, detail, ref_type: 'message', ref_id: msg.ref, ...extra })
      }

      const { data: evRow } = await sb.from('salesweb_wa_events').select('enabled, template_name, template_lang').eq('key', 'case_assigned').maybeSingle()
      if (!evRow?.enabled) {
        await record('disabled', 'switched off on the WhatsApp tab', 'WhatsApp not sent: the case assigned message is switched off on the WhatsApp tab')
        return json({ ok: false, disabled: true })
      }
      if (to.length < 10) {
        await record('failed', 'customer gave no usable phone number', 'WhatsApp not sent: the customer gave no usable phone number')
        return json({ ok: false, error: 'customer has no usable phone number' })
      }
      if (missing.length) {
        await record('not_configured', 'WhatsApp API not set up yet', 'WhatsApp API not set up yet: customer was not messaged automatically')
        return json({ ok: false, not_configured: true })
      }

      const name = evRow.template_name || 'case_assigned'
      const lang = evRow.template_lang || 'en'
      const r = await sendTemplate(to, name, lang, EVENTS.case_assigned.fields, {
        customer_name: msg.name, case_ref: msg.ref, staff_name: msg.assigned_name, staff_phone: '+' + waNumber(msg.assigned_phone),
      })
      const extra = { template_name: name, template_lang: lang, params: r.params, wa_message_id: r.ok ? r.id : null }
      if (!r.ok) {
        await record('failed', r.error, 'WhatsApp to customer failed: ' + r.error, extra)
        return json({ ok: false, error: r.error })
      }
      await record('sent', r.id, `WhatsApp sent to customer (+${to}): case assigned to ${msg.assigned_name}`, extra)
      return json({ ok: true })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error('whatsapp:', e)
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
