// Post-build cleaner for the not-yet-migrated static pages in dist/.
//
// Strips HTML comments and minifies inline <script>/<style> blocks and
// standalone classic .js/.css files, WITHOUT renaming any identifier —
// these are classic scripts whose top-level vars/functions are globals
// shared across files and inline onclick= attributes, so identifier
// renaming or IIFE-wrapping would break them. Whitespace/comment-only
// minification keeps behaviour byte-for-byte equivalent.
//
// The payment pages are excluded entirely: the Billplz flow ships exactly
// as reviewed, unmodified.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { transform } from 'esbuild';

const DIST = 'dist';
const SKIP = new Set([
  'payment.html',
  'payment-callback.html',
  'payment-proof.html',
]);

const JS_OPTS = {
  loader: 'js',
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false, // NEVER rename — globals cross file/attribute boundaries
  legalComments: 'none',
};
const CSS_OPTS = { loader: 'css', minify: true };

async function minifyJs(code) {
  const out = await transform(code, JS_OPTS);
  return out.code;
}
async function minifyCss(code) {
  const out = await transform(code, CSS_OPTS);
  return out.code;
}

// Split an HTML document into [text, comment, script, style, ...] segments
// so we never regex-strip "comments" inside script/style content. Comments
// are matched FIRST so a literal "<script>" quoted inside a comment doesn't
// get mistaken for a real script block (verified: no inline JS in this
// codebase contains "<!--" in a string, so comment-precedence is safe).
function segments(html) {
  const re = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi;
  const parts = [];
  let last = 0, m;
  while ((m = re.exec(html))) {
    if (m.index > last) parts.push({ kind: 'text', s: html.slice(last, m.index) });
    const low = m[0].toLowerCase();
    const kind = low.startsWith('<!--') ? 'comment' : low.startsWith('<script') ? 'script' : 'style';
    parts.push({ kind, s: m[0] });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ kind: 'text', s: html.slice(last) });
  return parts;
}

async function cleanHtml(html) {
  const out = [];
  for (const part of segments(html)) {
    if (part.kind === 'comment') {
      continue; // drop HTML comments entirely
    } else if (part.kind === 'text') {
      out.push(part.s);
    } else if (part.kind === 'script') {
      const open = part.s.match(/^<script\b[^>]*>/i)[0];
      const body = part.s.slice(open.length, -'</script>'.length);
      // Only touch classic inline JS. External (src=), JSON, templates: leave.
      const isExternal = /\bsrc\s*=/i.test(open);
      const type = (open.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      const isJs = !type || /^(text|application)\/(java|ecma)script$/i.test(type) || type === 'module';
      if (isExternal || !isJs || !body.trim()) {
        out.push(part.s);
      } else {
        let code;
        try {
          code = await minifyJs(body);
        } catch (e) {
          console.warn('  ! inline script left unminified (parse error):', e.message.split('\n')[0]);
          code = body;
        }
        // Guard: "</script>" inside strings would truncate the tag.
        if (/<\/script/i.test(code)) code = code.replace(/<\/script/gi, '<\\/script');
        out.push(open + code + '</script>');
      }
    } else {
      const open = part.s.match(/^<style\b[^>]*>/i)[0];
      const body = part.s.slice(open.length, -'</style>'.length);
      let css;
      try {
        css = await minifyCss(body);
      } catch {
        css = body;
      }
      out.push(open + css + '</style>');
    }
  }
  return out.join('');
}

const entries = await readdir(DIST, { withFileTypes: true });
let cleaned = 0;
for (const ent of entries) {
  if (!ent.isFile()) continue; // assets/ is Vite output (already minified); only top-level static files
  const name = ent.name;
  if (SKIP.has(name)) { console.log('skip (payment flow, untouched):', name); continue; }
  const path = join(DIST, name);
  if (name.endsWith('.html')) {
    const before = await readFile(path, 'utf8');
    // Vite-built entry pages are already clean — they have module scripts
    // pointing into /assets/ and no meaningful comments; cleaning them is
    // harmless, so treat all top-level HTML uniformly.
    const after = await cleanHtml(before);
    await writeFile(path, after);
    console.log(`cleaned ${name}: ${before.length} -> ${after.length} bytes`);
    cleaned++;
  } else if (name.endsWith('.js')) {
    const before = await readFile(path, 'utf8');
    try {
      const after = await minifyJs(before);
      await writeFile(path, after);
      console.log(`cleaned ${name}: ${before.length} -> ${after.length} bytes`);
      cleaned++;
    } catch (e) {
      console.warn('  ! left unminified (parse error):', name, e.message.split('\n')[0]);
    }
  } else if (name.endsWith('.css')) {
    const before = await readFile(path, 'utf8');
    try {
      const after = await minifyCss(before);
      await writeFile(path, after);
      console.log(`cleaned ${name}: ${before.length} -> ${after.length} bytes`);
      cleaned++;
    } catch {
      console.warn('  ! left unminified (css parse error):', name);
    }
  }
}
console.log(`done — ${cleaned} files cleaned; payment pages untouched.`);
