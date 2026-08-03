// Supabase Edge Function: phone-auth
// Lets customers sign up and log in with a PHONE NUMBER without any SMS
// provider. The account is a normal Supabase email user under the hood;
// the phone number is stored on shared_profiles (unique) and used to look
// the email up at login time. OTP codes are delivered to the account's
// EMAIL via Resend — the same transport send-order-email already uses.
//
// Actions (POST JSON { action, ... }):
//   signup     { name, phone, email, password? }
//                → creates the auth user + shared_profiles row.
//                  With a password → returns a session (auto login).
//                  Without        → emails a login code, returns masked email.
//   login      { phone, password }         → session
//   send-otp   { phone }                   → emails login code, masked email
//   verify-otp { phone, token }            → session
//
// Deploy:
//   supabase functions deploy phone-auth
//   (config.toml sets verify_jwt = false — callers are logged-out browsers)
//
// Required secrets (already set for send-order-email):
//   RESEND_API_KEY            = re_xxxxxxxxxxxx
//   SUPABASE_URL              = injected automatically
//   SUPABASE_ANON_KEY         = injected automatically
//   SUPABASE_SERVICE_ROLE_KEY = injected automatically
//
// From-address comes from salesweb_app_settings key='notification_config'
// (admin → Settings → Notifications), same as the order emails.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Mirror of clNormalisePhone() in the storefront — keep the two in sync so
// the number the browser sends always matches what we stored at signup.
function normalisePhone(raw: string): string {
  const v = (raw || '').replace(/[\s\-()]/g, '')
  if (!v) return ''
  if (v.startsWith('+')) return v
  if (v.startsWith('0')) return '+60' + v.substring(1)
  if (/^\d{10,}$/.test(v)) return '+' + v
  return v
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  const visible = user.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(user.length - 2, 2))}@${domain}`
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c] as string))
}

interface ProfileRow { id: string; email: string | null; full_name: string | null }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const admin = createClient(supabaseUrl, serviceKey)
    // Auth calls (sign-in, verify) run with the anon key so they behave
    // exactly like a browser calling supabase-js — sessions, not admin power.
    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })

    const body = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    const phone = normalisePhone(String(body.phone || ''))
    if (!phone || !/^\+\d{9,15}$/.test(phone)) {
      return json({ error: 'Please enter a valid phone number.' }, 400)
    }

    async function profileByPhone(): Promise<ProfileRow | null> {
      const { data } = await admin
        .from('shared_profiles')
        .select('id, email, full_name')
        .eq('phone', phone)
        .maybeSingle()
      return (data as ProfileRow) || null
    }

    // Generate an email OTP for `email` and deliver it via Resend, using the
    // same from-address the order emails use.
    async function emailLoginCode(email: string, name: string): Promise<{ error?: string }> {
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink', email,
      })
      const otp = linkData?.properties?.email_otp
      if (linkErr || !otp) {
        console.error('generateLink failed:', linkErr)
        return { error: 'Could not create a login code. Please try again.' }
      }

      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
      if (!RESEND_API_KEY) return { error: 'Email service is not configured.' }

      let fromEmail = 'orders@mjmnursery.com'
      let fromName = 'MJM Nursery'
      const { data: cfgRow } = await admin
        .from('salesweb_app_settings').select('value').eq('key', 'notification_config').maybeSingle()
      if (cfgRow?.value) {
        try {
          const cfg = typeof cfgRow.value === 'string' ? JSON.parse(cfgRow.value) : cfgRow.value
          if (cfg.from_email) fromEmail = cfg.from_email
          if (cfg.from_name) fromName = cfg.from_name
        } catch (_e) { /* keep defaults */ }
      }

      const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F7F3EC;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:480px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E5DFD3;">
    <div style="background:#2D4A30;padding:22px 28px;color:#fff;">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.7;">${esc(fromName)}</div>
      <div style="font-size:20px;font-weight:bold;margin-top:4px;">Your login code</div>
    </div>
    <div style="padding:26px 28px;color:#333;">
      <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">Hi ${esc(name || 'there')},</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;">Use this code to sign in to your ${esc(fromName)} account (phone ending ${esc(phone.slice(-4))}):</p>
      <div style="text-align:center;margin:0 0 18px;">
        <span style="display:inline-block;background:#F1EDE3;border:1px dashed #C9A84C;border-radius:10px;padding:12px 26px;font-size:26px;font-weight:bold;letter-spacing:.35em;color:#2D4A30;">${esc(otp)}</span>
      </div>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#8AAB8C;">The code expires in 1 hour. If you didn't request it, you can safely ignore this email.</p>
    </div>
    <div style="background:#F7F3EC;padding:12px 28px;font-size:11px;color:#8AAB8C;text-align:center;">— The ${esc(fromName)} Team</div>
  </div>
</body></html>`

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${fromName} <${fromEmail}>`,
          to: [email],
          subject: `${fromName} login code`,
          html,
        }),
      })
      if (!res.ok) {
        console.error('Resend API error:', await res.text())
        return { error: 'Could not send the email. Please try again.' }
      }
      return {}
    }

    function sessionPayload(session: { access_token: string; refresh_token: string } | null) {
      if (!session) return null
      return { access_token: session.access_token, refresh_token: session.refresh_token }
    }

    // ── SIGNUP ──
    if (action === 'signup') {
      const name = String(body.name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')
      if (!name) return json({ error: 'Please enter your full name.' }, 400)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'Please enter a valid email address.' }, 400)
      }
      if (password && password.length < 6) {
        return json({ error: 'Password must be at least 6 characters.' }, 400)
      }

      if (await profileByPhone()) {
        return json({ error: 'This phone number already has an account. Please sign in instead.' }, 409)
      }

      // No password chosen → the customer will always log in with emailed
      // codes. A random password keeps the auth row valid; they can set a
      // real one later via Forgot Password on the email tab.
      const effectivePassword = password ||
        crypto.randomUUID() + crypto.randomUUID()

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: effectivePassword,
        email_confirm: true,
        user_metadata: { full_name: name, phone, user_type: 'customer' },
      })
      if (createErr || !created?.user) {
        const msg = String(createErr?.message || '')
        if (/already|registered|exists/i.test(msg)) {
          return json({ error: 'This email is already registered. Sign in on the Email tab, or use a different email.' }, 409)
        }
        console.error('createUser failed:', createErr)
        return json({ error: 'Could not create the account. Please try again.' }, 500)
      }

      const { error: profErr } = await admin.from('shared_profiles').upsert({
        id: created.user.id,
        email,
        phone,
        full_name: name,
        role: 'customer',
        user_type: 'customer',
      }, { onConflict: 'id' })
      if (profErr) {
        // Unique-phone race: someone grabbed the number between our check and
        // the insert. Roll the auth user back so the email isn't burned.
        console.error('profile upsert failed:', profErr)
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: 'This phone number already has an account. Please sign in instead.' }, 409)
      }

      if (password) {
        const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password })
        if (signInErr || !signIn?.session) {
          console.error('post-signup sign-in failed:', signInErr)
          return json({ ok: true, otp_sent: false, masked_email: maskEmail(email) })
        }
        return json({ ok: true, session: sessionPayload(signIn.session), masked_email: maskEmail(email) })
      }

      const sendErr = await emailLoginCode(email, name)
      if (sendErr.error) return json({ ok: true, otp_sent: false, masked_email: maskEmail(email), warning: sendErr.error })
      return json({ ok: true, otp_sent: true, masked_email: maskEmail(email) })
    }

    // Everything below needs an existing account.
    const profile = await profileByPhone()
    if (!profile || !profile.email) {
      return json({ error: 'No account found for this phone number. Tap "Create Account" to sign up.' }, 404)
    }

    // ── LOGIN (phone + password) ──
    if (action === 'login') {
      const password = String(body.password || '')
      if (!password) return json({ error: 'Please enter your password, or use a login code instead.' }, 400)
      const { data, error } = await anon.auth.signInWithPassword({ email: profile.email, password })
      if (error || !data?.session) {
        return json({ error: 'Wrong phone number or password. You can also sign in with a login code.' }, 401)
      }
      return json({ ok: true, session: sessionPayload(data.session) })
    }

    // ── SEND OTP ──
    if (action === 'send-otp') {
      const sendErr = await emailLoginCode(profile.email, profile.full_name || '')
      if (sendErr.error) return json({ error: sendErr.error }, 502)
      return json({ ok: true, masked_email: maskEmail(profile.email) })
    }

    // ── VERIFY OTP ──
    if (action === 'verify-otp') {
      const token = String(body.token || '').trim()
      if (!token) return json({ error: 'Please enter the code from your email.' }, 400)
      let { data, error } = await anon.auth.verifyOtp({ email: profile.email, token, type: 'email' })
      if (error) {
        // Older GoTrue versions file generateLink(magiclink) codes under the
        // 'magiclink' type instead of 'email' — accept either.
        const retry = await anon.auth.verifyOtp({ email: profile.email, token, type: 'magiclink' })
        data = retry.data; error = retry.error
      }
      if (error || !data?.session) {
        return json({ error: 'That code is wrong or has expired. Please request a new one.' }, 401)
      }
      return json({ ok: true, session: sessionPayload(data.session) })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    console.error('phone-auth exception:', e)
    return json({ error: 'Something went wrong. Please try again.' }, 500)
  }
})
