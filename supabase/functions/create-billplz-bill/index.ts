// Supabase Edge Function: Create Billplz Bill
// Deploy: supabase functions deploy create-billplz-bill
// Set secrets:
//   supabase secrets set BILLPLZ_API_KEY=your-api-key
//   supabase secrets set BILLPLZ_COLLECTION_ID=your-collection-id
//   supabase secrets set BILLPLZ_SANDBOX=true   (set to "false" for production)
//
// THE AMOUNT IS THE ORDER'S, NEVER THE BROWSER'S. This used to bill whatever
// `amount` the page sent, so anybody with the browser's developer tools could
// pay RM 1 for any order. Now the caller must be signed in as the customer the
// order belongs to, the order must be waiting for payment, and the amount is
// read from salesweb_customer_orders.total — which place_order works out in
// the database. An `amount` in the request body is ignored.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { billplzBaseUrl, toSen } from "../_shared/billplz.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Where Billplz may send the customer back to. Anything else falls back to
// the shop's own return page, so a crafted request cannot turn the payment
// page into a redirect to somebody else's site.
const RETURN_ORIGINS = (Deno.env.get('SALESWEB_ORIGINS') ||
  'https://www.mjmnursery.com,https://mjmnursery.com').split(',').map((s) => s.trim()).filter(Boolean)
const DEFAULT_RETURN = 'https://www.mjmnursery.com/payment-callback.html'

function safeReturnUrl(asked: unknown): string {
  try {
    const u = new URL(String(asked || ''))
    if (RETURN_ORIGINS.includes(u.origin) && u.pathname.endsWith('/payment-callback.html')) return u.toString()
  } catch (_) { /* not a URL */ }
  return DEFAULT_RETURN
}

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const BILLPLZ_API_KEY = Deno.env.get('BILLPLZ_API_KEY') || ''
    const BILLPLZ_COLLECTION_ID = Deno.env.get('BILLPLZ_COLLECTION_ID') || ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!BILLPLZ_API_KEY || !BILLPLZ_COLLECTION_ID || !supabaseUrl || !anonKey || !serviceKey) {
      console.error('create-billplz-bill: a secret is missing')
      return json({ error: 'Online payment is not available right now. Please choose offline payment.' }, 500)
    }

    // Who is asking — from their own login token, not from the body.
    const authHeader = req.headers.get('Authorization') || ''
    const asCaller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: who } = await asCaller.auth.getUser()
    const user = who && who.user
    if (!user) return json({ error: 'Please sign in again before paying.' }, 401)

    const body = await req.json().catch(() => ({}))
    const order_id = String((body && body.order_id) || '')
    if (!order_id) return json({ error: 'Missing order' }, 400)

    const sb = createClient(supabaseUrl, serviceKey)
    const { data: order } = await sb
      .from('salesweb_customer_orders')
      .select('id, order_number, customer_id, customer_name, customer_email, status, total')
      .eq('id', order_id)
      .maybeSingle()
    if (!order || order.customer_id !== user.id) return json({ error: 'Order not found' }, 404)
    if (order.status !== 'Pending Payment') {
      return json({ error: 'This order is not waiting for payment (it is ' + order.status + ').' }, 409)
    }
    const amountSen = toSen(order.total)
    if (!(amountSen > 0)) return json({ error: 'This order has nothing to pay.' }, 409)

    const email = order.customer_email || user.email || ''
    if (!email) return json({ error: 'Your account has no email address for the receipt.' }, 400)
    const name = String(order.customer_name || (body && body.name) || 'Customer').slice(0, 200)
    const phone = String((body && body.phone) || '')

    const formBody = new URLSearchParams()
    formBody.append('collection_id', BILLPLZ_COLLECTION_ID)
    formBody.append('email', email)
    // Billplz requires mobile in format like +60123456789 or 60123456789
    if (phone) {
      let cleanPhone = phone.replace(/[\s\-()]/g, '')
      if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1)
      if (/^60\d{9,10}$/.test(cleanPhone)) formBody.append('mobile', cleanPhone)
    }
    formBody.append('name', name)
    formBody.append('amount', String(amountSen))
    formBody.append('description', `MJM Nursery Order #${order.order_number || order_id.substring(0, 8).toUpperCase()}`)
    formBody.append('callback_url', supabaseUrl + '/functions/v1/billplz-webhook')
    formBody.append('redirect_url', safeReturnUrl(body && body.callback_url))
    formBody.append('reference_1_label', 'Order ID')
    formBody.append('reference_1', order_id)
    if (order.order_number) {
      formBody.append('reference_2_label', 'Order No')
      formBody.append('reference_2', String(order.order_number))
    }

    const billRes = await fetch(`${billplzBaseUrl()}/bills`, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + btoa(BILLPLZ_API_KEY + ':') },
      body: formBody,
    })
    const billData = await billRes.json().catch(() => ({}))
    if (!billRes.ok) {
      console.error('Billplz API error:', JSON.stringify(billData))
      return json({ error: 'The payment gateway did not accept the bill. Please try again or choose offline payment.' }, 502)
    }

    console.log('Billplz bill created:', billData.id, 'order', order_id, 'sen', amountSen)

    // No timeline row is written here on purpose: a bill being CREATED is not
    // a payment event — the customer may close the Billplz page without
    // paying. The webhook / verify are the only writers of the outcome.
    return json({ url: billData.url, bill_id: billData.id, amount: amountSen / 100 }, 200)
  } catch (err) {
    console.error('create-billplz-bill error:', err)
    return json({ error: 'Could not start the payment. Please try again.' }, 500)
  }
})
