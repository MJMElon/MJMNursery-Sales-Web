// Run: node --experimental-strip-types tests/link_profile_phones.mjs
// Holds the rules in supabase/functions/link-profile-phones/lib.ts: which
// customer accounts may have their typed phone made their WhatsApp login.
// A number is linked only when nothing about it is in doubt.
import { planLinks, isSalesAdmin, isMyMobile } from '../supabase/functions/link-profile-phones/lib.ts'

let fail = 0
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++ }
const C = { user_type: 'customer', role: 'customer' }

const profiles = [
  { id: 'amy', email: 'amy@x', phone: '019-855 8755', ...C },              // links
  { id: 'bob', email: 'bob@x', phone: '0111222333', ...C },                // already linked
  { id: 'cat', email: 'cat@x', phone: '0123456789', ...C },                // login has other number
  { id: 'dan', email: 'dan@x', phone: '0166666666', ...C, permissions: { modules: { audit: 'admin' } } }, // staff
  { id: 'eve', email: 'eve@x', phone: '03-1234 5678', ...C },              // landline
  { id: 'fay', email: 'fay@x', phone: '0177777777', ...C },                // shared number
  { id: 'gus', email: 'gus@x', phone: '+60177777777', ...C },              // shared number
  { id: 'hal', email: 'hal@x', phone: '0188888888', ...C },                // number used by another login
  { id: 'ivy', email: 'ivy@x', phone: '', ...C },                          // nothing typed
  { id: 'jon', email: 'jon@x', phone: '0199999999', user_type: 'system', role: null }, // not a customer
  { id: 'kim', email: 'kim@x', phone: '0155555555', ...C },                // no login
  { id: 'lee', email: 'lee@x', phone: '011-2345 6789', ...C },             // 12-digit mobile links
]
const users = [
  { id: 'amy', phone: '' }, { id: 'bob', phone: '60111222333' }, { id: 'cat', phone: '60199999990' },
  { id: 'dan', phone: null }, { id: 'eve', phone: null }, { id: 'fay', phone: null }, { id: 'gus', phone: null },
  { id: 'hal', phone: null }, { id: 'zed', phone: '60188888888' }, { id: 'ivy', phone: null },
  { id: 'jon', phone: null }, { id: 'lee', phone: null },
]
const { linked, skipped } = planLinks(profiles, users)
const L = Object.fromEntries(linked.map(r => [r.id, r]))
const S = Object.fromEntries(skipped.map(r => [r.id, r.reason]))

ok(L.amy && L.amy.phone === '60198558755', '019-855 8755 links as 60198558755')
ok(L.lee && L.lee.phone === '601123456789', '12-digit 011 mobile links')
ok(linked.length === 2, 'only those two link (got ' + linked.map(r => r.id).join(',') + ')')
ok(!L.bob && !S.bob, 'already linked: neither linked nor reported')
ok(/different number/.test(S.cat || ''), 'login with another number is skipped')
ok(/office access/.test(S.dan || ''), 'staff permissions are skipped')
ok(/Malaysian mobile/.test(S.eve || ''), 'landline is skipped')
ok(/2 customer accounts/.test(S.fay || '') && /2 customer accounts/.test(S.gus || ''), 'one number on two accounts: both skipped')
ok(/another login/.test(S.hal || ''), 'number another login signs in with is skipped')
ok(!S.ivy && !L.ivy, 'empty phone is silent')
ok(!S.jon && !L.jon, 'non-customer profiles are ignored')
ok(/no login/.test(S.kim || ''), 'profile with no login is skipped')

ok(isMyMobile('60198558755') && isMyMobile('601123456789') && !isMyMobile('60312345678') && !isMyMobile('6019855875'), 'mobile shape')
ok(isSalesAdmin({ role: 'admin' }) && isSalesAdmin({ permissions: { modules: { salesweb: 'normal' } } }), 'admin and salesweb normal may run it')
ok(!isSalesAdmin({ role: 'customer' }) && !isSalesAdmin({ permissions: { modules: { salesweb: 'view' } } }) && !isSalesAdmin(null), 'customers, view-only and unknown may not')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
