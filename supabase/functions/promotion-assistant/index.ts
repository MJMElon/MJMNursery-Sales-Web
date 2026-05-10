// ─────────────────────────────────────────────────────────────
//  MJM Nursery — Promotion Assistant (Supabase Edge Function)
// ─────────────────────────────────────────────────────────────
//  Wraps the Anthropic API. Browser → this function → Claude.
//  Never expose ANTHROPIC_API_KEY in the client.
//
//  Deploy:
//    supabase functions deploy promotion-assistant --no-verify-jwt
//    supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
//  Request body:
//    {
//      messages: [{role:'user'|'assistant', content:string}, ...],
//      catalog: {                       // small, sent every call
//        products: [{id, name, category, price}],
//        categories: [string]
//      }
//    }
//
//  Response:
//    {
//      reply: string,                    // assistant's chat reply
//      draft: PromotionDraft | null      // structured promotion if confident
//    }
//
//  PromotionDraft schema is enforced by Claude via tool_use.
// ─────────────────────────────────────────────────────────────

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are the promotion-builder assistant for MJM Nursery, a Malaysian oil-palm seedling and merchandise retailer. Prices are in Ringgit (RM).

Your job: have a brief, friendly conversation with the admin to design a promotion, then output a structured PromotionDraft via the propose_promotion tool whenever you have enough information.

Tone: concise, practical, no fluff. The admin is busy.

Guidelines for drafts:
- Keep banner_text under 60 characters and punchy.
- Pick a single emoji that matches the offer (🌱 plants, 🌴 palm, 🎁 generic, 🔥 limited-time, 💸 discount, 🆕 new, ❄ end-of-season).
- banner_color must be one of: green, amber, red, blue, purple.
- For percentage discounts > 30%, suggest a max_discount cap unless the admin says otherwise.
- target='all' unless the admin clearly names a category or specific products.
- When the admin names categories or products, match against the catalog passed in. If you can't find a match, ask which they meant.
- Default duration: 7 days starting today, unless the admin specifies otherwise.
- Always call propose_promotion when you have enough info — don't ask the admin to confirm before the first draft. They'll see the preview and can iterate.
- If the admin asks to tweak ("shorter copy", "extend by a week", "make it 25%"), call propose_promotion again with the updated draft.

When unsure, ask ONE clarifying question. Never more than one at a time.`;

const PROPOSE_TOOL = {
  name: "propose_promotion",
  description: "Output the current promotion draft. Call this whenever you have enough information to show a preview, or after the admin requests a change.",
  input_schema: {
    type: "object",
    properties: {
      title:           { type: "string", description: "Internal promotion title (admin-facing)" },
      description:     { type: "string", description: "1-2 sentence summary for the admin" },
      banner_text:     { type: "string", description: "Customer-facing banner copy, <60 chars" },
      banner_emoji:    { type: "string", description: "Single emoji" },
      banner_color:    { type: "string", enum: ["green","amber","red","blue","purple"] },
      discount_type:   { type: "string", enum: ["percentage","fixed"] },
      discount_value:  { type: "number" },
      max_discount:    { type: "number", description: "Cap on percentage discounts; 0 = no cap" },
      min_order_value: { type: "number", description: "Cart subtotal floor; 0 = no minimum" },
      target:          { type: "string", enum: ["all","category","specific"] },
      target_categories:  { type: "array", items: { type: "string" } },
      target_product_ids: { type: "array", items: { type: "string" } },
      start_date:      { type: "string", description: "YYYY-MM-DD" },
      end_date:        { type: "string", description: "YYYY-MM-DD" },
      priority:        { type: "integer", description: "Higher wins when multiple promos apply; default 0" },
    },
    required: ["title","banner_text","discount_type","discount_value","target","start_date","end_date"],
  },
};

function buildCatalogContext(catalog: any): string {
  if (!catalog) return "";
  const cats: string[] = (catalog.categories || []).slice(0, 30);
  const prods: any[] = (catalog.products || []).slice(0, 60);
  let out = "\n\n<catalog>\n";
  if (cats.length) out += "Categories: " + cats.join(", ") + "\n";
  if (prods.length) {
    out += "Products (id · name · category · price):\n";
    for (const p of prods) {
      out += `  ${p.id} · ${p.name} · ${p.category ?? "—"} · RM ${p.price ?? "?"}\n`;
    }
  }
  out += "</catalog>";
  return out;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")    return json({ error: "Method not allowed" }, 405);

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY not configured on the server" }, 500);
  }

  let body: any;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: "messages required" }, 400);

  const systemWithCatalog = SYSTEM_PROMPT + buildCatalogContext(body.catalog);

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemWithCatalog,
        messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
        tools: [PROPOSE_TOOL],
      }),
    });
  } catch (e) {
    return json({ error: "Upstream fetch failed: " + (e as Error).message }, 502);
  }

  if (!resp.ok) {
    const txt = await resp.text();
    return json({ error: "Anthropic API error", status: resp.status, body: txt }, 502);
  }

  const data = await resp.json();
  let reply = "";
  let draft: any = null;

  for (const block of data.content || []) {
    if (block.type === "text")     reply += block.text;
    if (block.type === "tool_use" && block.name === "propose_promotion") draft = block.input;
  }

  return json({ reply: reply.trim(), draft });
});

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
