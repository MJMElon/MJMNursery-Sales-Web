// Pure rules for link-profile-phones. No Deno, no network, so the rules are
// tested on their own (tests/link_profile_phones.mjs).
//
// WHAT IT DECIDES
// Which customer accounts may have the phone number typed on their profile
// made into their WhatsApp login, so a WhatsApp code sign-in lands in the
// account that already has their orders instead of opening an empty one.
//
// THE RISK IT IS SHAPED AROUND
// A typed number was never proved. If it was mistyped, whoever owns the
// mistyped number could sign in to that account. So a profile is linked only
// when nothing about its number is in doubt, and everything else is listed
// with the reason, for the office to look at.

import { waNumber } from '../send-whatsapp-otp/lib.ts'

export { waNumber }

// Same rule as isOperationStaff() in public/admin-customers.js: anybody with
// office permissions is staff, whatever their profile says. Change both.
const STAFF_MODULE_VALUES: Record<string, 1> = {
  admin: 1, normal: 1, view: 1, edit: 1, manage: 1, read: 1, write: 1, full: 1, staff: 1,
}
export function isOperationStaff(perms: unknown): boolean {
  if (!perms || typeof perms !== 'object') return false
  const p = perms as Record<string, unknown>
  if (p.manage_users) return true
  if (p.can_verify_operation) return true
  const mods = p.modules
  if (mods && typeof mods === 'object') {
    for (const v of Object.values(mods as Record<string, unknown>)) {
      if (v && STAFF_MODULE_VALUES[String(v).toLowerCase()]) return true
    }
  }
  return false
}

// A Malaysian mobile, as WhatsApp numbers are: 60 then 1, 11 or 12 digits.
export function isMyMobile(key: string): boolean {
  return key.startsWith('601') && (key.length === 11 || key.length === 12)
}

export interface Profile {
  id: string
  email?: string | null
  full_name?: string | null
  phone?: string | null
  role?: string | null
  user_type?: string | null
  permissions?: unknown
}
export interface AuthUser { id: string; phone?: string | null }
export interface Row { id: string; email: string; name: string; typed: string; phone: string; reason?: string }

export function planLinks(profiles: Profile[], users: AuthUser[]): { linked: Row[]; skipped: Row[] } {
  const userById = new Map(users.map((u) => [u.id, u]))
  // Every number some login already signs in with.
  const loginPhones = new Map<string, string>()
  for (const u of users) {
    const k = waNumber(u.phone)
    if (k) loginPhones.set(k, u.id)
  }
  const customers = profiles.filter((p) => p.user_type === 'customer' || p.role === 'customer')
  // How many customer profiles carry each number.
  const carriers = new Map<string, number>()
  for (const p of customers) {
    const k = waNumber(p.phone)
    if (k) carriers.set(k, (carriers.get(k) || 0) + 1)
  }

  const linked: Row[] = []
  const skipped: Row[] = []
  for (const p of customers) {
    const typed = String(p.phone || '').trim()
    if (!typed) continue // nothing typed, nothing to link and nothing to say
    const key = waNumber(typed)
    const row: Row = { id: p.id, email: p.email || '', name: p.full_name || '', typed, phone: key }
    const own = userById.get(p.id)
    const ownKey = waNumber(own?.phone)
    const skip = (reason: string) => skipped.push({ ...row, reason })

    if (!own) { skip('no login for this profile'); continue }
    if (ownKey && ownKey === key) continue // already linked: nothing to do, nothing to report
    if (ownKey) { skip('signs in with a different number already (+' + ownKey + ')'); continue }
    if (isOperationStaff(p.permissions) || (p.role && p.role !== 'customer')) { skip('has office access'); continue }
    if (!isMyMobile(key)) { skip('not a Malaysian mobile number'); continue }
    if ((carriers.get(key) || 0) > 1) { skip('the same number is on ' + carriers.get(key) + ' customer accounts'); continue }
    if (loginPhones.has(key)) { skip('another login already signs in with this number'); continue }
    linked.push(row)
  }
  return { linked, skipped }
}

// The caller may run this only as a Sales Web admin: the same test
// clPostLogin in src/pages/shop/main.js uses to send somebody to admin.html.
export function isSalesAdmin(profile: { role?: string | null; permissions?: unknown } | null): boolean {
  if (!profile) return false
  if (profile.role === 'admin') return true
  const mods = (profile.permissions as { modules?: Record<string, unknown> } | null)?.modules
  const sw = String(mods?.salesweb || 'none').toLowerCase()
  return sw === 'admin' || sw === 'normal'
}
