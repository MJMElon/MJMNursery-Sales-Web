// Supabase Edge Function: send-case-whatsapp
// When a Contact Us case is assigned on the admin Messages tab, this sends
// the customer ONE WhatsApp message from the nursery's WhatsApp Business
// number, telling them who will handle their case and the number that
// person will contact them from. After that the assigned person talks to
// the customer from their own WhatsApp — this function sends nothing else.
//
// Deploy:
//   supabase functions deploy send-case-whatsapp
//
// Until the WhatsApp Business (Cloud API) number is registered, leave the
// secrets unset: the function then answers { not_configured: true }, the
// case is marked "WhatsApp API not set up", and the admin page offers to
// open WhatsApp by hand instead. Nothing fails.
//
// Secrets, once the Meta app is ready (`supabase secrets set NAME=value`):
//   WHATSAPP_TOKEN            permanent System User access token
//   WHATSAPP_PHONE_NUMBER_ID  the Phone number ID (not the phone number)
//   WHATSAPP_TEMPLATE         approved template name   (default case_assigned)
//   WHATSAPP_TEMPLATE_LANG    its language code         (default en)
//
// WhatsApp only lets a business START a conversation with an approved
// template. Create one in WhatsApp Manager with four body variables, in
// this order:
//   {{1}} customer name  {{2}} case reference  {{3}} staff name  {{4}} staff phone
// e.g. "Hi {{1}}, thank you for contacting MJM Nursery. Your case {{2}} has
// been assigned to {{3}}, who will WhatsApp you from {{4}} shortly."
//
// Only salesweb staff may call it: the caller's own login is checked with
// salesweb_is_message_staff() before anything is read or sent.

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization') || ''
    const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await asCaller.auth.getUser()
    const caller = userData?.user
    if (!caller) return json({ error: 'not signed in' }, 401)
    const { data: isStaff } = await asCaller.rpc('salesweb_is_message_staff')
    if (isStaff !== true) return json({ error: 'not allowed' }, 403)

    const { id } = await req.json().catch(() => ({}))
    if (!id) return json({ error: 'id required' }, 400)

    const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: msg, error } = await sb.from('salesweb_messages')
      .select('id, ref, name, phone, assigned_name, assigned_phone').eq('id', id).maybeSingle()
    if (error) return json({ error: error.message }, 500)
    if (!msg) return json({ error: 'message not found' }, 404)
    if (!msg.assigned_name || !msg.assigned_phone) return json({ error: 'assign the case to somebody first' }, 400)

    const to = waNumber(msg.phone)
    const actorName = caller.user_metadata?.full_name || caller.email || 'Staff'
    const record = async (status: string, detail: string, eventBody: string) => {
      await sb.from('salesweb_messages').update({
        wa_status: status, wa_detail: detail,
        wa_sent_at: status === 'sent' ? new Date().toISOString() : null,
      }).eq('id', id)
      await sb.from('salesweb_message_events').insert({
        message_id: id, kind: 'whatsapp', body: eventBody, actor_id: caller.id, actor_name: actorName,
      })
    }

    if (!to) {
      await record('failed', 'customer gave no phone number', 'WhatsApp not sent: the customer gave no phone number')
      return json({ ok: false, error: 'customer has no phone number' })
    }

    const TOKEN = Deno.env.get('WHATSAPP_TOKEN') || ''
    const PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || ''
    if (!TOKEN || !PHONE_ID) {
      await record('not_configured', 'WhatsApp API not set up yet', 'WhatsApp API not set up yet: customer was not messaged automatically')
      return json({ ok: false, not_configured: true })
    }

    const template = Deno.env.get('WHATSAPP_TEMPLATE') || 'case_assigned'
    const lang = Deno.env.get('WHATSAPP_TEMPLATE_LANG') || 'en'
    const staffPhone = '+' + waNumber(msg.assigned_phone)
    const res = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: lang },
          components: [{
            type: 'body',
            parameters: [msg.name, msg.ref, msg.assigned_name, staffPhone].map((t) => ({ type: 'text', text: String(t) })),
          }],
        },
      }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = body?.error?.message || ('HTTP ' + res.status)
      await record('failed', detail, 'WhatsApp to customer failed: ' + detail)
      return json({ ok: false, error: detail })
    }
    await record('sent', body?.messages?.[0]?.id || '', `WhatsApp sent to customer (+${to}): case assigned to ${msg.assigned_name}`)
    return json({ ok: true })
  } catch (e) {
    console.error('send-case-whatsapp:', e)
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
