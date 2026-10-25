// Who is calling an Edge Function — asked the same way by every function
// that must not answer just anybody.
//
// The anon key ships in the web page, and with "verify JWT" on a function
// still accepts it: it IS a valid JWT. So "it came with a token" proves
// nothing. These two questions are what decide.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/** Another of our own functions, calling with the service key (the Billplz
 *  webhook and verify do this to send the paid email). Never true for a
 *  browser: the service key is only in the functions' secrets. */
export function isServiceCall(req: Request): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const got = req.headers.get('Authorization') || ''
  return key.length > 0 && got === 'Bearer ' + key
}

/** A signed-in Sales Web staff member: the database's own is_salesweb_admin()
 *  asked as the caller, so it is the rule every table already uses. */
export async function isSalesStaff(req: Request): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL') || ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const auth = req.headers.get('Authorization') || ''
  if (!url || !anon || !auth) return false
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: auth } } })
  const { data: who } = await asCaller.auth.getUser()
  if (!who || !who.user) return false
  const { data: ok } = await asCaller.rpc('is_salesweb_admin')
  return ok === true
}
