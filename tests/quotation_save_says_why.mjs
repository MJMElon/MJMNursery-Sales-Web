/* THE QUOTATION SAVE SAYS WHO WAS REFUSED, AND SAYS IT BEFORE THE WORK.

   "SAVE FAILED" reached the office with nothing on it to act on. The
   database was checked first (the real insert goes through for every
   account that passes the gate), so the refusal is the RLS gate
   _sw_is_admin(): role 'admin', or the Sales Web module at
   'admin'/'normal'. This holds the client half:

   - _quotSaveGate applies the SAME formula (copied from the database
     function — change one, change the other);
   - a login failing it gets a red bar on the list BEFORE keying a
     quotation, and a refusal at Save that names the login and the
     remedy, with nothing keyed lost;
   - an expired sign-in is told apart from a login without access;
   - a profile read that ERRORS fails OPEN and caches nothing — a check
     that cannot run must not paint a warning it cannot disprove;
   - a raw "row-level security" message is rewritten into the remedy.

   Run: node tests/quotation_save_says_why.mjs
*/
import { readFileSync } from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'public', 'admin-quotations.js'), 'utf8');

let fails = 0;
const check = (ok, m) => { console.log((ok ? '  ok  ' : ' FAIL ') + m); if (!ok) fails++; };

function makeCtx({ session, profile, profileError }) {
  const toasts = [];
  const ctx = {
    window: {},
    console,
    toast: (m, k) => toasts.push({ m, k }),
    esc: (s) => String(s == null ? '' : s),
    fmtDate: (d) => String(d),
    openModal: () => {}, closeModal: () => {},
    document: { getElementById: () => null },
    sb: {
      auth: { getSession: async () => ({ data: { session } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => profileError ? { data: null, error: { message: profileError } } : { data: profile, error: null },
          }),
        }),
        order: () => {},
      }),
      rpc: async () => ({ data: null, error: null }),
    },
    toasts,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

const USER = { id: 'u1', email: 'someone@mjm.test' };

// 1. role admin passes; 2. customer + salesweb normal passes
for (const [label, profile] of [
  ['role admin', { role: 'admin', permissions: {} }],
  ['salesweb module normal', { role: 'customer', permissions: { modules: { salesweb: 'normal' } } }],
]) {
  const ctx = makeCtx({ session: { user: USER }, profile });
  const gate = await vm.runInContext('_quotSaveGate()', ctx);
  check(gate.known && gate.ok, `${label} passes the gate, same answer as the database`);
  check(vm.runInContext('_quotGateBarHtml(' + JSON.stringify(gate) + ')', ctx) === '', `and draws no bar`);
}

// 3. a login outside the gate is told so, by name
{
  const ctx = makeCtx({ session: { user: USER }, profile: { role: 'customer', permissions: { modules: { salesweb: 'none' } } } });
  const gate = await vm.runInContext('_quotSaveGate()', ctx);
  check(gate.known && !gate.ok && gate.signedIn, 'a login with neither role nor module fails the gate');
  const bar = vm.runInContext('_quotGateBarHtml(' + JSON.stringify(gate) + ')', ctx);
  check(bar.includes('someone@mjm.test') && /Manage Users/i.test(bar), `the bar names the login and the remedy`);
}

// 4. no session is an expired sign-in, not a missing permission
{
  const ctx = makeCtx({ session: null, profile: null });
  const gate = await vm.runInContext('_quotSaveGate()', ctx);
  check(gate.known && !gate.ok && !gate.signedIn, 'no session answers "signed out", not "no access"');
  const bar = vm.runInContext('_quotGateBarHtml(' + JSON.stringify(gate) + ')', ctx);
  check(/sign-?in has expired/i.test(bar), 'and the bar says to sign in again');
}

// 5. a profile read that errors fails OPEN and caches nothing
{
  const ctx = makeCtx({ session: { user: USER }, profileError: 'network down' });
  const gate = await vm.runInContext('_quotSaveGate()', ctx);
  check(!gate.known && gate.ok, 'a failed read answers "cannot tell", never "no"');
  check(vm.runInContext('_quotGateCache', ctx) === null, 'and a non-answer is not cached');
  check(vm.runInContext('_quotGateBarHtml(' + JSON.stringify(gate) + ')', ctx) === '', 'and paints no bar');
}

// 6. the refusal wording: RLS is rewritten into the remedy, anything else passes through
{
  const ctx = makeCtx({ session: { user: USER }, profile: { role: 'admin' } });
  vm.runInContext('_quotSaveErr("Save failed", { message: "new row violates row-level security policy for table x" })', ctx);
  vm.runInContext('_quotSaveErr("Save failed", { message: "duplicate key value" })', ctx);
  const [rls, other] = ctx.toasts;
  check(/Manage Users/i.test(rls.m) && !/row-level security/i.test(rls.m) && rls.k === 'error',
    `an RLS refusal reads as a permission with a remedy (got "${rls.m}")`);
  check(other.m.includes('duplicate key value'), 'any other refusal keeps its own message');
}

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
