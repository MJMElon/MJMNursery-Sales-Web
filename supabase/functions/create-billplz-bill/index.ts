// Supabase Edge Function: Create Billplz Bill
// Deploy: supabase functions deploy create-billplz-bill
// Set secrets:
//   supabase secrets set BILLPLZ_API_KEY=your-api-key
//   supabase secrets set BILLPLZ_COLLECTION_ID=your-collection-id
//   supabase secrets set BILLPLZ_SANDBOX=true   (set to "false" for production)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const BILLPLZ_API_KEY = Deno.env.get('BILLPLZ_API_KEY') || ''
    const BILLPLZ_COLLECTION_ID = Deno.env.get('BILLPLZ_COLLECTION_ID') || ''
    const BILLPLZ_SANDBOX = Deno.env.get('BILLPLZ_SANDBOX') !== 'false'

    if (!BILLPLZ_API_KEY || !BILLPLZ_COLLECTION_ID) {
      return new Response(
        JSON.stringify({ error: 'Billplz not configured. API_KEY=' + (BILLPLZ_API_KEY ? 'set' : 'missing') + ', COLLECTION=' + (BILLPLZ_COLLECTION_ID ? 'set' : 'missing') }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { order_id, amount, email, name, phone, description, callback_url } = await req.json()

    if (!order_id || !amount || !email || !name) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: order_id=' + !!order_id + ', amount=' + !!amount + ', email=' + !!email + ', name=' + !!name }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Billplz API base URL
    const baseUrl = BILLPLZ_SANDBOX
      ? 'https://www.billplz-sandbox.com/api/v3'
      : 'https://www.billplz.com/api/v3'

    // Webhook URL (server-to-server, Billplz calls this after payment)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const webhookUrl = supabaseUrl + '/functions/v1/billplz-webhook'

    // Redirect URL (browser redirect after payment)
    const redirectUrl = callback_url || 'https://kibqjztozokohqmhqqqf.supabase.co/functions/v1/billplz-webhook'

    console.log('Creating Billplz bill:', { baseUrl, order_id, amount, email, name, webhookUrl, redirectUrl })

    // Build form data — Billplz API requires x-www-form-urlencoded
    const formBody = new URLSearchParams()
    formBody.append('collection_id', BILLPLZ_COLLECTION_ID)
    formBody.append('email', email)
    // Billplz requires mobile in format like +60123456789 or 60123456789
    if (phone) {
      let cleanPhone = phone.replace(/[\s\-()]/g, '')
      if (cleanPhone.startsWith('+')) cleanPhone = cleanPhone.substring(1)
      if (/^60\d{9,10}$/.test(cleanPhone)) {
        formBody.append('mobile', cleanPhone)
      }
    }
    formBody.append('name', name)
    formBody.append('amount', String(amount))
    formBody.append('description', description || `Order ${order_id.substring(0, 8).toUpperCase()}`)
    formBody.append('callback_url', webhookUrl)
    formBody.append('redirect_url', redirectUrl)
    formBody.append('reference_1_label', 'Order ID')
    formBody.append('reference_1', order_id)

    // Create bill via Billplz API
    const billRes = await fetch(`${baseUrl}/bills`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(BILLPLZ_API_KEY + ':'),
      },
      body: formBody,
    })

    const billData = await billRes.json()

    if (!billRes.ok) {
      console.error('Billplz API error:', JSON.stringify(billData))
      return new Response(
        JSON.stringify({ error: billData.error?.message || billData.error || JSON.stringify(billData) }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Billplz bill created:', billData.id, billData.url)

    // No timeline row is written here on purpose: a bill being CREATED
    // is not a payment event — the customer may close the Billplz page
    // without paying, in which case a "Payment Initiated" row would
    // mislead admins reviewing the order. The billplz-webhook handler
    // is the only writer for the actual outcome ("Paid" or "Payment
    // Failed"), which is what admins want to see.

    // Return the payment URL
    return new Response(
      JSON.stringify({ url: billData.url, bill_id: billData.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('Edge function error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
