/* PREPAID PAYMENT TERMS, and its own stock auto-release rule.

   The office: "create a new payment terms called Prepaid. and at settings -
   orders, I will need a stock auto release function for Cash and this
   prepaid. so that I can decide how long prepaid not to release the stock
   or maybe close that function and the stock will always reserved."

   This lifts the SHIPPED settings code out of src/lib/adminShell.js and the
   SHIPPED terms helpers, drives them in a real browser against a stub of the
   settings row, and reads the source for the markup and the screens that had
   to learn a third term.

   Run: node tests/prepaid_terms_and_release.mjs
*/
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(['/opt/node-tools/node_modules/playwright', 'playwright']
  .find(p => { try { require.resolve(p); return true; } catch (e) { return false; } }) || 'playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(path.join(here, '..', f), 'utf8');
const shell = read('src/lib/adminShell.js');
const jsx = read('src/pages/Admin.jsx');

let fails = 0;
const check = (ok, m) => { console.log((ok ? '  ok  ' : ' FAIL ') + m); if (!ok) fails++; };

function between(s, a, b) {
  const i = s.indexOf(a), j = s.indexOf(b, i);
  return (i < 0 || j < 0) ? null : s.slice(i, j);
}
const settingsCode = between(shell, '// PREPAID has its own block', '// ═══════════════════════════════════════\n//  NOTIFICATION CONFIG');
const termsCode = between(shell, '// ── Payment terms ─', '// ── Classic module loading');

console.log('0. The shipped code is there to lift');
check(!!settingsCode, 'the auto-release settings block');
check(!!termsCode, 'the payment terms helpers');

console.log('\n1. The card has a Cash block and a Prepaid block');
for (const id of ['autorel-enabled', 'autorel-hours', 'autorel-tiers-body', 'autorel-rules',
                  'autorelpp-enabled', 'autorelpp-hours', 'autorelpp-tiers-body', 'autorelpp-rules', 'autorel-save-btn'])
  check(jsx.includes('id="' + id + '"'), 'Admin.jsx carries #' + id);
check(/addAutorelTier\('autorelpp'\)/.test(jsx), 'the Prepaid block adds its own tiers');

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let browser;
try { browser = await chromium.launch({ executablePath: exe }); } catch (e) { browser = await chromium.launch(); }
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
const block = p => `<input type="checkbox" id="${p}-enabled"><div id="${p}-rules"><input id="${p}-hours" value="48"><div id="${p}-tiers-body"></div></div>`;
await page.setContent(`<!doctype html><body><p id="autorel-debug"></p><button id="autorel-save-btn">Save</button>${block('autorel')}${block('autorelpp')}</body>`);

async function boot(stored) {
  await page.evaluate(v => {
    window.toasts = []; window.toast = (m, t) => window.toasts.push([m, t]);
    window.__row = v; window.__saved = null;
    window.sb = { from() { return {
      select() { return this; }, eq() { return this; },
      maybeSingle() { return Promise.resolve({ data: window.__row == null ? null : { value: window.__row } }); },
      upsert(r) { window.__saved = r; window.__row = r.value; return Promise.resolve({ error: null }); },
    }; } };
  }, stored);
}
await boot(null);
const code = (settingsCode || '').replace(/^export /gm, '') + '\n' + (termsCode || '') +
  '\nwindow.loadAutoReleaseConfig=loadAutoReleaseConfig;window.saveAutoReleaseConfig=saveAutoReleaseConfig;window.addAutorelTier=addAutorelTier;';
await page.addScriptTag({ content: code });

console.log('\n2. A row saved before Prepaid existed reads the same for Cash, and Prepaid is OFF');
await boot(JSON.stringify({ enabled: true, hours: 72, tiers: [{ min_qty: 1, max_qty: 1000, days: 7 }] }));
await page.evaluate(() => window.loadAutoReleaseConfig());
const s2 = await page.evaluate(() => ({
  cashOn: document.getElementById('autorel-enabled').checked,
  cashH: document.getElementById('autorel-hours').value,
  cashTiers: document.querySelectorAll('#autorel-tiers-tbody tr').length,
  ppOn: document.getElementById('autorelpp-enabled').checked,
  ppTiers: document.querySelectorAll('#autorelpp-tiers-tbody tr').length,
  dbg: document.getElementById('autorel-debug').textContent,
}));
check(s2.cashOn && s2.cashH === '72' && s2.cashTiers === 1, 'Cash: on, 72h, its one tier');
check(!s2.ppOn && s2.ppTiers === 0, 'Prepaid: off, no tiers -> stock always reserved');
check(/Prepaid: off/.test(s2.dbg), 'the line under the title says Prepaid is off → ' + s2.dbg);

console.log('\n3. The Prepaid block is set and saved beside Cash, which does not move');
await page.evaluate(() => {
  document.getElementById('autorelpp-enabled').checked = true;
  document.getElementById('autorelpp-hours').value = '24';
  window.addAutorelTier('autorelpp');
});
check(await page.evaluate(() => document.querySelectorAll('#autorelpp-tiers-tbody tr').length) === 1, 'a tier added to Prepaid lands in Prepaid');
check(await page.evaluate(() => document.querySelectorAll('#autorel-tiers-tbody tr').length) === 1, 'and Cash still has its own one');
await page.evaluate(() => window.saveAutoReleaseConfig());
const saved = await page.evaluate(() => window.__saved && JSON.parse(window.__saved.value));
check(saved && saved.enabled === true && saved.hours === 72 && saved.tiers.length === 1, 'Cash saved as it was');
check(saved && saved.prepaid && saved.prepaid.enabled === true && saved.prepaid.hours === 24 && saved.prepaid.tiers.length === 1 && saved.prepaid.tiers[0].days === 7,
      'Prepaid saved: on, 24h, one tier of 7 days → ' + JSON.stringify(saved && saved.prepaid));

console.log('\n4. Prepaid switched off saves off, and a bad hour box on an OFF block is not a refusal');
await page.evaluate(() => { document.getElementById('autorelpp-enabled').checked = false; document.getElementById('autorelpp-hours').value = ''; });
await page.evaluate(() => window.saveAutoReleaseConfig());
const saved2 = await page.evaluate(() => window.__saved && JSON.parse(window.__saved.value));
check(saved2 && saved2.prepaid.enabled === false, 'Prepaid saved OFF');
check(!(await page.evaluate(() => window.toasts.some(t => t[1] === 'error'))), 'no error raised');

console.log('\n5. A tier removed from Prepaid comes off Prepaid only');
await page.evaluate(() => window.loadAutoReleaseConfig());
await page.evaluate(() => window.removeAutorelTier(0, 'autorelpp'));
check(await page.evaluate(() => document.querySelectorAll('#autorelpp-tiers-tbody tr').length) === 0, 'Prepaid tier gone');
check(await page.evaluate(() => document.querySelectorAll('#autorel-tiers-tbody tr').length) === 1, 'Cash tier still there');

console.log('\n6. Three terms, one reading');
const t = await page.evaluate(() => [window.termsOf('prepaid'), window.termsOf({ payment_terms: 'credit' }), window.termsOf(null), window.termsOf('weird'), window.termsLabel('prepaid')]);
check(JSON.stringify(t) === '["prepaid","credit","cash","cash","Prepaid"]', 'termsOf / termsLabel → ' + JSON.stringify(t));
check(/Prepaid/.test(await page.evaluate(() => window.termsBadge('prepaid'))), 'a Prepaid badge');

console.log('\n7. Every screen that picks a term offers Prepaid');
check((jsx.match(/<option value="prepaid">/g) || []).length === 3, 'the new order, add customer and edit customer forms');
check(/className="fd-term" defaultValue="prepaid"/.test(jsx) && /className="cf-term" defaultValue="prepaid"/.test(jsx), 'the order and customer filters');
const orders = read('public/admin-orders.js'), custs = read('public/admin-customers.js');
check(/<option value="prepaid"/.test(orders), 'the order terms dropdown');
check(/setCustomerTerms\(\\''\+id\+'\\',\\'prepaid\\'\)/.test(custs), 'the customer Prepaid button');
check(/terms!=='prepaid'\)return;/.test(custs), 'and setCustomerTerms accepts it');
check(!/payment_terms==='credit'\?'credit':'cash'/.test(orders + custs), 'no screen folds Prepaid back into Cash');

console.log('\n8. The SQL');
const sql = read('supabase/migrations/payment_terms_prepaid.sql');
check(/'prepaid'::text/.test(sql), 'the constraints take prepaid');
check(/v_cfg -> 'prepaid'/.test(sql) && /"enabled": false/.test(sql), 'the release reads a prepaid rule, off when absent');

check(errs.length === 0, 'no page errors ' + (errs.join(' | ') || ''));
await browser.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
