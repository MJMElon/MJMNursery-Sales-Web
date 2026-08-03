# phone-auth — Twilio setup (SMS + WhatsApp login codes)

Email login codes work out of the box (Resend). SMS and WhatsApp switch on
automatically as soon as the Twilio secrets exist — the storefront asks this
function which channels are configured every time the login modal opens, so
no frontend redeploy is needed.

## 1. Create the Twilio account

1. Sign up at https://www.twilio.com (free trial credit included).
2. From the Console home page, copy the **Account SID** (`AC...`) and
   **Auth Token**.

## 2. SMS sender

1. Console → Phone Numbers → **Buy a number** with SMS capability
   (a US number can send SMS to Malaysia), OR set up a Messaging Service
   and use its `MG...` SID.
2. Trial accounts can only send to **verified** phone numbers
   (Console → Phone Numbers → Verified Caller IDs) — verify your own
   number for testing, upgrade the account before going live.

## 3. WhatsApp sender

For testing — the sandbox works immediately:

1. Console → Messaging → **Try it out → Send a WhatsApp message**.
2. Join the sandbox from your phone (send the shown join code to the
   sandbox number, e.g. `+14155238886`).
3. Use the sandbox number as `TWILIO_WHATSAPP_FROM`. Plain-text codes work
   in the sandbox, so `TWILIO_WHATSAPP_CONTENT_SID` is not needed yet.

For production:

1. Console → Messaging → **Senders → WhatsApp senders** → register your
   business number (needs a Meta Business account; Twilio walks through it).
2. Console → Messaging → **Content Template Builder** → create a template of
   type **Authentication** (body like: `{{1}} is your verification code.`),
   submit for approval, then copy its `HX...` Content SID.
3. Set it as `TWILIO_WHATSAPP_CONTENT_SID` — required, because Meta only
   allows approved templates for business-initiated production messages.

## 4. Set the secrets and deploy

```sh
supabase secrets set \
  TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  TWILIO_SMS_FROM=+1xxxxxxxxxx \
  TWILIO_WHATSAPP_FROM=+14155238886 \
  TWILIO_WHATSAPP_CONTENT_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

supabase functions deploy phone-auth
```

Leave out any secret you don't have yet — each channel only appears in the
login modal once its own secrets are set. To switch a channel off again,
`supabase secrets unset` its secrets and redeploy.

## Costs (approximate, check twilio.com/pricing)

- SMS to Malaysia: ~USD 0.05 per message
- WhatsApp authentication message: ~USD 0.02 per message
- Email via Resend: free tier 3,000/month — kept as the always-on fallback
