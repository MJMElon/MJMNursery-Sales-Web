// Pure helpers for send-whatsapp-otp. No Deno, no network: index.ts does the
// I/O, so this file can be tested on its own (tests/whatsapp_otp_hook.mjs).

// Malaysian numbers as WhatsApp wants them: digits only, country code first.
// Same rule as waNumber() in ../whatsapp/index.ts and
// public/admin-messages.js — change all three.
export function waNumber(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('60')) return d
  if (d.startsWith('0')) return '6' + d
  if (d.startsWith('1') && d.length >= 9 && d.length <= 10) return '60' + d
  return d
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: ArrayBuffer): string {
  let bin = ''
  const u = new Uint8Array(bytes)
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i])
  return btoa(bin)
}

// Supabase signs every hook call the Standard Webhooks way:
//   webhook-signature: v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">
// keyed with the secret the dashboard generates ("v1,whsec_<base64>").
// Without this check anybody who finds the function URL could make the
// nursery send WhatsApp messages, and every one of them is paid for.
export async function verifyHook(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature || !secret) return false
  const ts = Number(timestamp)
  // Five minutes either way, so a captured call cannot be replayed later.
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false
  const keyB64 = secret.replace(/^v1,/, '').replace(/^whsec_/, '')
  const key = await crypto.subtle.importKey(
    'raw', b64ToBytes(keyB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
  const expected = bytesToB64(mac)
  // The header may carry several space-separated signatures (key rotation).
  return signature.split(' ').some((part) => {
    const [ver, sig] = part.split(',')
    if (ver !== 'v1' || !sig || sig.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    return diff === 0
  })
}

// The Graph API body for an AUTHENTICATION template. Meta writes the text of
// such a template itself ("*{{1}}* is your verification code"), and its
// Copy code button is a URL button at index 0 that takes the same code.
export function otpMessage(to: string, otp: string, template: string, lang: string) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: otp }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: otp }] },
      ],
    },
  }
}

// What Supabase Auth expects back when a hook fails: it shows the message
// to the customer instead of saying the code was sent.
export function hookError(message: string, httpCode = 500) {
  return { error: { http_code: httpCode, message } }
}
