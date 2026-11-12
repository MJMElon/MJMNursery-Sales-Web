// Supabase Edge Function: update-customer-email
// Lets a signed-in Sales Web admin change the EMAIL A CUSTOMER LOGS IN WITH.
//
// WHY THIS EXISTS
// The admin "Edit Customer" form used to change only shared_profiles.email —
// the row the Customer List reads. The login itself (auth.users, owned by
// Supabase Auth) kept the old address, so a customer who registered with a
// typo could never receive the password-reset email, and nobody could fix it
// from the admin page. Only the service key may edit auth.users, and that key
// never goes in the browser, so the change has to be made here.
//
// WHAT IT DOES
//   1. Checks the caller is signed in and is_salesweb_admin() says yes.
//   2. Checks the target is a CUSTOMER profile (never a staff/admin login).
//   3. Changes the login email (auth.users) and marks it confirmed, so the
//      customer can sign in / reset their password at the new address at once.
//   4. Writes the same email on shared_profiles so the list, the profile view
//      and the Reset Password button all agree.
//
// Request body:  { customer_id: string, email: string }
// Response:      { ok: true, email }   or   { error: string, code?: string }
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor,
// name it exactly  update-customer-email , paste this file, Deploy.
// (or: supabase functions deploy update-customer-email)
// No extra secrets: it uses the project's own SUPABASE_URL, SUPABASE_ANON_KEY
// and SUPABASE_SERVICE_ROLE_KEY, which every function gets automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// Same rule as isOperationStaff() in public/admin-customers.js — change both.
const STAFF_MODULE_VALUES: Record<string, 1> = { admin: 1, normal: 1, view: 1, edit: 1, manage: 1, read: 1, write: 1, full: 1, staff: 1 }
// deno-lint-ignore no-explicit-any
function isOperationStaff(perms: any): boolean {
  if (!perms || typeof perms !== 'object') return false
  if (perms.manage_users) return true
  if (perms.can_verify_operation) return true
  if (perms.modules && typeof perms.modules === 'object') {
    for (const k in perms.modules) {
      const v = perms.modules[k]
      if (v && STAFF_MODULE_VALUES[String(v).toLowerCase()]) return true
    }
  }
  return false
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!

    // 1. Who is asking — a signed-in Sales Web admin, by the database's own rule.
    const authHeader = req.headers.get('Authorization') || ''
    const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await asCaller.auth.getUser()
    const caller = userData?.user
    if (!caller) return json({ error: 'not signed in' }, 401)
    const { data: allowed } = await asCaller.rpc('is_salesweb_admin')
    if (allowed !== true) return json({ error: 'not allowed' }, 403)

    // 2. What is asked.
    const input = await req.json().catch(() => ({}))
    const customerId = String(input.customer_id || '').trim()
    const email = String(input.email || '').trim().toLowerCase()
    if (!customerId) return json({ error: 'customer_id is required' }, 400)
    if (!email || !EMAIL_RE.test(email)) return json({ error: 'Please enter a valid email address' }, 400)
    if (/@admin\.mjmnursery\.local$/i.test(email)) return json({ error: 'That is a walk-in placeholder address, not a real email' }, 400)

    const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // 3. The target must be a customer. A staff or admin login is never
    //    changed from here — that is what User Access is for.
    const { data: profile, error: pErr } = await sb
      .from('shared_profiles')
      .select('id, email, full_name, role, user_type, permissions')
      .eq('id', customerId)
      .maybeSingle()
    if (pErr) return json({ error: 'could not read customer: ' + pErr.message }, 500)
    if (!profile) return json({ error: 'Customer not found' }, 404)
    const isCustomer = profile.user_type !== 'system'
      && (!profile.role || profile.role === 'customer')
      && !isOperationStaff(profile.permissions)
    if (!isCustomer) return json({ error: 'That account is a staff account, not a customer. Change it in User Access instead.' }, 403)

    // Nobody else may already hold the new address.
    const { data: clash } = await sb
      .from('shared_profiles')
      .select('id')
      .ilike('email', email)
      .neq('id', customerId)
      .limit(1)
    if (clash && clash.length) return json({ error: 'Another account already uses ' + email }, 409)

    // 4. The login itself. email_confirm so the customer is not asked to
    //    confirm an address the admin has just typed in for them.
    const { data: upd, error: uErr } = await sb.auth.admin.updateUserById(customerId, { email, email_confirm: true })
    if (uErr) {
      const msg = uErr.message || 'could not update login'
      console.error('[update-customer-email] auth update failed', customerId, msg)
      if (/not found/i.test(msg)) return json({ error: 'This customer has no login account to change', code: 'no_login' }, 404)
      if (/already|registered|exists|duplicate/i.test(msg)) return json({ error: 'Another login already uses ' + email }, 409)
      return json({ error: msg }, 500)
    }

    // 5. The profile row, so every admin screen shows the same address.
    const { error: sErr } = await sb.from('shared_profiles').update({ email }).eq('id', customerId)
    if (sErr) {
      console.error('[update-customer-email] profile update failed', customerId, sErr.message)
      return json({ error: 'Login email changed, but the customer list could not be updated: ' + sErr.message }, 500)
    }

    console.log('[update-customer-email]', caller.email || caller.id, 'changed', customerId, 'from', profile.email || '(none)', 'to', upd?.user?.email || email)
    return json({ ok: true, email: upd?.user?.email || email })
  } catch (e) {
    console.error('[update-customer-email] error', e)
    return json({ error: (e as Error).message || 'unexpected error' }, 500)
  }
})
