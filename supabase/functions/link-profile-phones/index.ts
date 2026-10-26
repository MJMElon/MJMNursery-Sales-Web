// Supabase Edge Function: link-profile-phones
// Makes the phone number typed on each customer account that account's
// WhatsApp login, so signing in on the shop's WhatsApp tab lands in the
// account that already holds the customer's orders.
//
// Called from Manage Customers ("Link phones to WhatsApp login"), by a Sales
// Web admin, with the admin's own session:
//   { apply: false }  preview, changes nothing
//   { apply: true }   links every account the preview listed as linkable
// It answers { linked: [...], skipped: [...], failed: [...] }.
//
// The rules (lib.ts) only link a number nothing is in doubt about, and list
// every other one with its reason. It writes through the Auth Admin API, not
// SQL, so the login is made the way Supabase makes it.
//
// Deploy with JWT verification ON (the default):
//   supabase functions deploy link-profile-phones
// It needs no secrets of its own: SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided to every function.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isSalesAdmin, planLinks, type AuthUser, type Profile } from './lib.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const URL_ = Deno.env.get('SUPABASE_URL')!
    const asCaller = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    })
    const { data: who } = await asCaller.auth.getUser()
    if (!who?.user) return json({ error: 'not signed in' }, 401)

    const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: me } = await sb.from('shared_profiles').select('role, permissions').eq('id', who.user.id).maybeSingle()
    if (!isSalesAdmin(me)) return json({ error: 'only a Sales Web admin may do this' }, 403)

    const { apply } = await req.json().catch(() => ({ apply: false }))

    const { data: profiles, error: pErr } = await sb.from('shared_profiles')
      .select('id, email, full_name, phone, role, user_type, permissions')
      .or('user_type.eq.customer,role.eq.customer')
    if (pErr) return json({ error: 'could not read profiles: ' + pErr.message }, 500)

    const users: AuthUser[] = []
    for (let page = 1; ; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) return json({ error: 'could not read logins: ' + error.message }, 500)
      for (const u of data.users) users.push({ id: u.id, phone: u.phone })
      if (data.users.length < 1000) break
    }

    const plan = planLinks((profiles || []) as Profile[], users)
    if (!apply) return json({ ...plan, failed: [] })

    const failed: typeof plan.linked = []
    const linked: typeof plan.linked = []
    for (const row of plan.linked) {
      const { error } = await sb.auth.admin.updateUserById(row.id, { phone: row.phone, phone_confirm: true })
      if (error) { failed.push({ ...row, reason: error.message }); continue }
      // Keep the profile showing the number the login now uses.
      await sb.from('shared_profiles').update({ phone: '+' + row.phone }).eq('id', row.id)
      linked.push(row)
    }
    console.log('[link-profile-phones] by', who.user.email, 'linked', linked.length, 'failed', failed.length)
    return json({ linked, skipped: plan.skipped, failed })
  } catch (e) {
    console.error('[link-profile-phones]', String(e))
    return json({ error: String(e) }, 500)
  }
})
