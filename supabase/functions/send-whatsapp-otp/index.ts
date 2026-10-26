// Supabase Edge Function: send-whatsapp-otp
// Sends the shop login code on WhatsApp, from the nursery's own WhatsApp
// Business number, through Meta's Cloud API.
//
// HOW IT IS CALLED
// Not by the browser. The shop asks Supabase Auth for a phone code
// (signInWithOtp with channel 'whatsapp'); Supabase makes the code, keeps
// it, checks it on verifyOtp, and hands it to THIS function through the
// "Send SMS" Auth Hook to deliver. So the code never passes through the
// page, and expiry, rate limits and the check itself stay Supabase's job.
//
// SET UP (once)
//   supabase functions deploy send-whatsapp-otp --no-verify-jwt
//   supabase secrets set WHATSAPP_TOKEN=...            (System User token, never expires)
//   supabase secrets set WHATSAPP_PHONE_NUMBER_ID=...  (the Phone number ID, not the number)
//   supabase secrets set WHATSAPP_OTP_TEMPLATE=login_code   (optional, this is the default)
//   supabase secrets set WHATSAPP_OTP_TEMPLATE_LANG=en      (optional, this is the default)
// Dashboard: Authentication > Sign In / Providers > Phone: enable it.
// Dashboard: Authentication > Hooks > Send SMS > HTTPS, URL of this
// function, Generate secret, then
//   supabase secrets set SEND_SMS_HOOK_SECRET='v1,whsec_...'
//
// WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are the same two secrets
// the whatsapp function reads: one number, one token, for both.
//
// The template must be category AUTHENTICATION with a Copy code button.
// Meta writes its wording; the only variable is the code.

import { hookError, otpMessage, verifyHook, waNumber } from './lib.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(hookError('Method not allowed', 405), 405)

  const body = await req.text()
  const ok = await verifyHook(body, {
    id: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signature: req.headers.get('webhook-signature'),
  }, Deno.env.get('SEND_SMS_HOOK_SECRET') || '')
  if (!ok) return json(hookError('Invalid hook signature', 401), 401)

  let payload: { user?: { phone?: string }; sms?: { otp?: string } }
  try { payload = JSON.parse(body) } catch { return json(hookError('Bad payload', 400), 400) }

  const to = waNumber(payload.user?.phone)
  const otp = String(payload.sms?.otp || '')
  if (!to || !otp) return json(hookError('No phone number or code to send', 400), 400)

  const TOKEN = Deno.env.get('WHATSAPP_TOKEN') || ''
  const PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || ''
  if (!TOKEN || !PHONE_ID) {
    console.error('[send-whatsapp-otp] WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set')
    return json(hookError('WhatsApp login is not set up yet. Please sign in with email.'))
  }
  const template = Deno.env.get('WHATSAPP_OTP_TEMPLATE') || 'login_code'
  const lang = Deno.env.get('WHATSAPP_OTP_TEMPLATE_LANG') || 'en'

  try {
    const res = await fetch(`https://graph.facebook.com/v25.0/${PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(otpMessage(to, otp, template, lang)),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Logged in full (the function log is the only place an expired token
      // or a rejected template shows up); the customer gets a plain line.
      console.error('[send-whatsapp-otp] Meta refused', res.status, JSON.stringify(out))
      const notOnWa = out?.error?.code === 131026
      return json(hookError(notOnWa
        ? 'WhatsApp could not deliver to this number. Please check it is on WhatsApp, or sign in with email.'
        : 'Could not send the WhatsApp code. Please try again, or sign in with email.'))
    }
    console.log('[send-whatsapp-otp] sent to', to.slice(0, 4) + '****' + to.slice(-3))
    return json({})
  } catch (e) {
    console.error('[send-whatsapp-otp] fetch failed', String(e))
    return json(hookError('Could not reach WhatsApp. Please try again, or sign in with email.'))
  }
})
