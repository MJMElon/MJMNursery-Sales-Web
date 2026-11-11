/* AN ORDER PRINTS.

   The office: "In Nursery Sales web portal, create a print button for
   order, meaning if I click print, I can print out the order details."

   The order modal's footer carries 🖨 Print. It prints ONE sheet built
   from exactly what viewOrder() drew (window._moPrint) — the same items,
   totals and payments, never a second read — through a hidden iframe,
   because a new tab is a popup a blocker can eat.

   This drives the REAL public/admin-orders.js in a real browser: the
   order is stashed the way viewOrder() stashes it, the button is pressed,
   and the sheet that reached print() is read back.

   Run: node tests/an_order_prints.mjs
*/
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(['/opt/node-tools/node_modules/playwright', 'playwright']
  .find(p => { try { require.resolve(p); return true; } catch (e) { return false; } }) || 'playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'public', 'admin-orders.js'), 'utf8');

let fails = 0;
const check = (ok, m) => { console.log((ok ? '  ok  ' : ' FAIL ') + m); if (!ok) fails++; };

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let browser;
try { browser = await chromium.launch({ executablePath: exe }); }
catch (e) { browser = await chromium.launch(); }
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.setContent('<!doctype html><html><body><div id="mo-foot"></div></body></html>');
await page.evaluate(() => {
  window.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.toasts = []; window.toast = (m, t) => window.toasts.push([m, t]);
  window.sb = { from() { return {}; }, rpc() { return Promise.resolve({}); } };
});
await page.addScriptTag({ content: src });

console.log('1. The button exists');
check(await page.evaluate(() => typeof window.printOrderSheet === 'function'), 'printOrderSheet is on window');
check(/onclick="printOrderSheet\(\)"[^>]*>🖨 Print</.test(src), 'and the order modal footer offers 🖨 Print');
check(/window\._moPrint\s*=\s*\{\s*order:\s*order/.test(src), 'viewOrder stashes the order it drew for the sheet');

console.log('\n2. With no order open it says so instead of printing a blank page');
await page.evaluate(() => { window._moPrint = null; window.printOrderSheet(); });
check(await page.evaluate(() => window.toasts.some(t => /Open an order first/.test(t[0]))), 'a toast, not a blank print');

console.log('\n3. The sheet carries the order');
await page.evaluate(() => {
  window._moPrint = {
    titleId: '#MUGJB9',
    order: { status: 'Processing', payment_terms: 'credit', created_at: '2026-11-05T01:30:34Z',
             customer_name: 'ROZALIA BINTI SAHARI', customer_email: 'r@example.com', billing_name: 'Rozalia & Co',
             total: 2900, discount_amount: 100, discount_note: 'Loyal customer' },
    items: [{ product_name: 'Oil Palm Seedling — January 2027', unit_price: 25, quantity: 120, subtotal: 3000 }],
    parsed: { phone: '012-3456789', billReg: '202601234567', billMpob: '123-456', billAddr: 'Lot 1, Kota Kinabalu', userRemark: 'Collect <after> 10am' },
    payments: [{ paid_at: '2026-11-06T02:00:00Z', amount: 1000, note: 'Bank transfer' }],
    subtotal: 3000, paid: 1000, balance: 1900,
  };
  window.__printed = null;
  window.printOrderSheet();
});
await page.waitForTimeout(500);
const sheet = await page.evaluate(() => {
  const f = document.getElementById('mo-print-frame');
  return f ? f.contentWindow.document.body.innerText : null;
});
check(!!sheet, 'a hidden print frame was written');
const has = (re, m) => check(sheet && re.test(sheet), m);
has(/Order #MUGJB9/, 'the order number');
has(/ROZALIA BINTI SAHARI/, 'the customer');
has(/012-3456789/, 'the phone');
has(/Rozalia & Co/, 'the bill-to name, escaped and read back intact');
has(/123-456/, 'the MPOB licence');
has(/Oil Palm Seedling — January 2027/, 'the item');
has(/RM 3,000\.00/, 'the subtotal, money grouped');
has(/Discount \(Loyal customer\)[\s\S]*-RM 100\.00/, 'the discount with its note');
has(/Total\s+RM 2,900\.00/, 'the total');
has(/Paid\s+RM 1,000\.00/, 'what was paid');
has(/Balance\s+RM 1,900\.00/, 'the balance');
has(/Bank transfer/, 'the payment line');
has(/Collect <after> 10am/, 'the customer remark, HTML in it shown as text and not parsed');
has(/Credit/, 'the payment terms');
check(sheet && !/Edit|Remove|Upload/.test(sheet), 'no admin controls on the paper');
check(await page.evaluate(() => document.querySelectorAll('#mo-print-frame').length) === 1, 'one frame, reused — a second print does not stack frames');
await page.evaluate(() => window.printOrderSheet());
await page.waitForTimeout(100);
check(await page.evaluate(() => document.querySelectorAll('#mo-print-frame').length) === 1, 'still one frame after printing again');

check(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await browser.close();
console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
process.exit(fails ? 1 : 0);
