// WhatsApp OTP login: on or off, in one place.
//
// While false, the shop still shows the WhatsApp tab and the My Profile
// "Link" button, but neither sends anything: both say it is coming soon,
// and customers sign in with email. Read by src/pages/shop/main.js (login
// modal + My Profile) and src/pages/Auth.jsx (the auth page).
//
// Set it to true once the Supabase secrets WHATSAPP_TOKEN and
// WHATSAPP_PHONE_NUMBER_ID are in place and a test code has arrived.
export const WA_LOGIN_READY = false;

export const WA_LOGIN_SOON_MSG = 'WhatsApp login is coming soon. Please sign in with email for now.';
