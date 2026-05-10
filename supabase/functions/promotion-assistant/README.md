# promotion-assistant — Supabase Edge Function

Wraps Anthropic's Messages API so the browser can chat with Claude to draft a
promotion. The `ANTHROPIC_API_KEY` secret stays on the server; never put it in
the client bundle.

## One-time setup

```bash
# Install / login the supabase CLI if you haven't
supabase login
supabase link --project-ref kibqjztozokohqmhqqqf

# Add the secret (get a key at https://console.anthropic.com/)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# Optional override (default is claude-sonnet-4-6)
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-6
```

## Deploy

```bash
supabase functions deploy promotion-assistant --no-verify-jwt
```

`--no-verify-jwt` is needed because the admin portal calls this from the
browser using the anon key, not a JWT. We rely on the admin auth gate
in `admin.html` and the fact that the client-supplied messages can't do
anything destructive.

## Local test

```bash
supabase functions serve promotion-assistant --no-verify-jwt --env-file .env

curl -X POST http://localhost:54321/functions/v1/promotion-assistant \
  -H 'content-type: application/json' \
  -d '{
    "messages":[{"role":"user","content":"20% off all seedlings this weekend"}],
    "catalog":{"categories":["Seedling","Merchandise"]}
  }'
```

## Request / response shape

See the inline doc in `index.ts`. Tl;dr:

* **Request** — `{ messages, catalog }`
* **Response** — `{ reply: string, draft: PromotionDraft | null }`

The `draft` is produced via Claude's tool-use feature, so it always conforms
to the schema declared in `PROPOSE_TOOL`. The browser uses it to render the
preview pane.
