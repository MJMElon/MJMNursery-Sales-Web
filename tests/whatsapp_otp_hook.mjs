// Run: node --experimental-strip-types tests/whatsapp_otp_hook.mjs
// Holds the pure half of supabase/functions/send-whatsapp-otp: the hook
// signature check (the only thing standing between the function URL and a
// paid WhatsApp message) and the Graph API body Meta expects.
import { createHmac } from 'node:crypto'
import { verifyHook, otpMessage, waNumber, hookError } from '../supabase/functions/send-whatsapp-otp/lib.ts'

let fail = 0
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++ }

const keyB64 = Buffer.from('a-test-secret-of-some-length-1234').toString('base64')
const secret = 'v1,whsec_' + keyB64
const body = JSON.stringify({ user: { phone: '60123456789' }, sms: { otp: '123456' } })
const now = 1_760_000_000
const sign = (id, ts, b, k = keyB64) =>
  'v1,' + createHmac('sha256', Buffer.from(k, 'base64')).update(`${id}.${ts}.${b}`).digest('base64')

const h = (sig, ts = String(now), id = 'msg_1') => ({ id, timestamp: ts, signature: sig })

ok(await verifyHook(body, h(sign('msg_1', now, body)), secret, now), 'a correctly signed call is accepted')
ok(await verifyHook(body, h('v1,bogus ' + sign('msg_1', now, body)), secret, now), 'one good signature among several is accepted')
ok(!(await verifyHook(body.replace('123456', '999999'), h(sign('msg_1', now, body)), secret, now)), 'a changed body is refused')
ok(!(await verifyHook(body, h(sign('msg_1', now, body, Buffer.from('other').toString('base64'))), secret, now)), 'a different key is refused')
ok(!(await verifyHook(body, h(sign('msg_1', now - 600, body), String(now - 600)), secret, now)), 'a call older than five minutes is refused')
ok(!(await verifyHook(body, h(null), secret, now)), 'a call with no signature is refused')
ok(!(await verifyHook(body, h(sign('msg_1', now, body)), '', now)), 'nothing is accepted while the secret is unset')

ok(waNumber('+60123456789') === '60123456789', '+60 number -> 60...')
ok(waNumber('012-345 6789') === '60123456789', 'local 012 number -> 60...')
ok(waNumber('60123456789') === '60123456789', 'Supabase stores it without + -> unchanged')

const m = otpMessage('60123456789', '482913', 'login_code', 'en')
ok(m.messaging_product === 'whatsapp' && m.type === 'template' && m.to === '60123456789', 'template message to the right number')
ok(m.template.name === 'login_code' && m.template.language.code === 'en', 'template name and language')
ok(m.template.components[0].type === 'body' && m.template.components[0].parameters[0].text === '482913', 'code in the body')
const btn = m.template.components[1]
ok(btn.type === 'button' && btn.sub_type === 'url' && btn.index === '0' && btn.parameters[0].text === '482913', 'code on the Copy code button')
ok(hookError('x').error.http_code === 500 && hookError('x', 401).error.http_code === 401, 'hook error shape')

console.log(fail ? `\n${fail} FAILED` : '\nall passed')
process.exit(fail ? 1 : 0)
