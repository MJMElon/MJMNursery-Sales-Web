# phone-auth — SMS & WhatsApp login code setup

Email login codes work out of the box (Resend). SMS and WhatsApp switch on
automatically as soon as ONE provider's secrets exist per channel — the
storefront asks this function which channels are configured every time the
login modal opens, so no frontend redeploy is needed.

Supported providers (first configured one wins):

| Channel  | Provider 1 (preferred)      | Provider 2 (fallback) |
|----------|-----------------------------|-----------------------|
| SMS      | Mocean (Malaysian gateway)  | Twilio                |
| WhatsApp | Meta WhatsApp Cloud API     | Twilio                |
| Email    | Resend (always on)          | —                     |

Set secrets in Supabase dashboard → Edge Functions → Secrets (or
`supabase secrets set NAME=value`), then redeploy:
`supabase functions deploy phone-auth`.

---

## Option A — WhatsApp via Meta Cloud API (recommended, no Twilio)

Direct from Meta (WhatsApp's owner). Cheapest per message (~USD 0.02 per
auth message to Malaysia), and unverified businesses can still send up to
250 business-initiated conversations per day — plenty for login codes.

1. Go to https://developers.facebook.com → Log in with the Facebook account
   → **My Apps → Create App** → type **Business**.
2. In the new app, click **Add product → WhatsApp → Set up**. This creates a
   Meta Business portfolio and gives you a **free test number**.
3. On the WhatsApp → **API Setup** page you'll see:
   - **Phone number ID** → secret `WHATSAPP_PHONE_NUMBER_ID`
   - a **temporary access token** — fine for first tests, but it expires in
     24h. For a permanent one: Business Settings → Users → **System users**
     → create one → generate token with `whatsapp_business_messaging`
     permission → secret `WHATSAPP_CLOUD_TOKEN`.
4. Testing: add up to 5 recipient numbers on the API Setup page ("To"
   dropdown → Manage phone number list), each confirms a code on WhatsApp.
   Plain-text sends work to those numbers with no template.
5. Production:
   - **Add a real phone number** (WhatsApp → API Setup → Add phone number).
     Use a number NOT already registered on the WhatsApp app (a spare SIM or
     landline works — verification is by SMS or voice call).
   - **Create an Authentication template**: WhatsApp Manager → Message
     templates → Create → category **Authentication** (body like
     `{{1}} is your verification code`, with copy-code button). Approval is
     usually automatic within minutes.
   - Set `WHATSAPP_TEMPLATE_NAME` (the template's name) and
     `WHATSAPP_TEMPLATE_LANG` (e.g. `en` — must match the template's
     language code exactly).
   - Add a payment method in WhatsApp Manager → Billing.

Secrets: `WHATSAPP_CLOUD_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_TEMPLATE_NAME` (production), `WHATSAPP_TEMPLATE_LANG` (default en).

## Option B — SMS via Mocean (Malaysian gateway, no compliance profile)

MoceanAPI (https://moceanapi.com) is a Malaysian SMS provider — sign-up is
a normal account registration, prices in local terms, and sender IDs for
Malaysia are their bread and butter.

1. Register at moceanapi.com (free trial credit for testing).
2. Dashboard → **API keys**: copy the API key and API secret.
3. Top up credit when going live.

Secrets: `MOCEAN_API_KEY`, `MOCEAN_API_SECRET`, and optionally
`MOCEAN_SMS_FROM` (sender ID shown on the phone, max 11 chars, e.g.
`MJMNursery`; defaults to the notification from-name). Note: Malaysian
carriers may require sender ID registration for volume traffic — Mocean
support handles this if delivery issues appear.

Similar local alternatives (iSMS.com.my, SMSniaga) can be swapped in on
request — the provider layer in index.ts is one function per provider.

## Option C — Twilio (SMS + WhatsApp)

Needs an approved compliance profile to buy an SMS number, which can be
rejected for some businesses. If approved:

- SMS secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_SMS_FROM` (a `+…` number or `MG…` Messaging Service SID).
  Trial accounts only deliver to Verified Caller IDs.
- WhatsApp secrets: same SID/token plus `TWILIO_WHATSAPP_FROM`
  (sandbox `+14155238886` for testing) and, for production,
  `TWILIO_WHATSAPP_CONTENT_SID` (approved auth template `HX…`).

---

## Costs (approximate — check each provider's pricing page)

- WhatsApp auth message (Meta direct): ~USD 0.02
- SMS to Malaysia (Mocean): a few sen per message
- SMS to Malaysia (Twilio): ~USD 0.05
- Email via Resend: free tier 3,000/month — kept as the always-on fallback
