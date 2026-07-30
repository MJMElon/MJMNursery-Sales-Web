// Storefront logic — ported 1:1 from the big inline <script> in
// public/index.html (lines 2286-5650 of the legacy page). The entire
// original script body runs inside initShopMain(), exactly once, right
// after the React tree is committed — same as the original classic script
// executing after the markup parsed. Function declarations share one
// closure scope (they were all globals of a single classic script before),
// and every function referenced from markup — both the static JSX handlers
// (which call window.<fn>) and the HTML strings this script itself builds
// via innerHTML with onclick="..." — is bridged onto window at the end.
//
// Deliberate changes vs the legacy inline script (behaviour-preserving):
//   1. loadSupabaseSdk() resolves the bundled npm @supabase/supabase-js
//      client instead of injecting a CDN <script> (see below). Same
//      client config => same sb-*-auth-token session sharing.
//   2. closeMobileMenu() is defined at module scope and window-bridged at
//      import time — the legacy page defined it in an earlier standalone
//      <script> so it existed even if the main script failed; module scope
//      gives the same earlier-availability guarantee.
// Everything else — including the checkout redirects to payment.html /
// payment-proof.html and every sessionStorage key — is verbatim.
import { supabase as sharedSupabaseClient } from '../../lib/supabase.js';

// Global mobile-menu close helper — inline onclicks in the mobile nav drawer
// (Log In, My Account, Sign Out) call this. Defining it here, BEFORE the
// main storefront <script>, guarantees the symbol exists even if a later
// script errors out partway through. A missing closeMobileMenu used to
// throw ReferenceError on tap, which halted execution and left the
// product grid empty.
function closeMobileMenu(){var l=document.getElementById('navLinks');if(l)l.classList.remove('open');}
window.closeMobileMenu = closeMobileMenu;

export function initShopMain() {
  // Previous build loaded @supabase/supabase-js from jsDelivr in the <head>
  // and called supabase.createClient() inline. On Safari/iOS that pipeline
  // was failing as cross-origin "Script error." with no detail — most
  // likely the auto-resolved jsDelivr URL serving a CJS or ESM bundle
  // Safari refused to execute as a classic script. The page rendered
  // blank because anything depending on `_sb` (fetchProducts, passion
  // section, portal init) silently broke.
  //
  // New approach: the public storefront NO LONGER needs supabase-js at all.
  // Product fetch, passion section, and any other read-only API call now
  // uses `sbFetch()`, a tiny raw-fetch wrapper around Supabase's REST API.
  // The supabase-js SDK only gets loaded LAZILY (on demand) when the user
  // actually opens the login modal or the My Account page — those features
  // need auth.signInWithPassword(), realtime, etc.
  //
  // Result: even with a total CDN outage, the public storefront still
  // renders products. The cross-origin Script error from the SDK can no
  // longer take down the whole page.
  var SUPA_URL='https://kibqjztozokohqmhqqqf.supabase.co';
  var SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';
  var _sb = null;
  var _sbLoadPromise = null;

  // Raw fetch wrapper that talks directly to Supabase's REST API. No SDK,
  // no CDN dependency, works in every browser that has fetch() (IE11 is
  // the only modern browser without it — out of scope).
  // Pull the logged-in user's JWT out of supabase-js's localStorage entry.
  // The SDK key format for v2 is `sb-<projectRef>-auth-token`; the value is
  // JSON. By reading it directly we don't need the SDK to be loaded yet.
  function getStoredJwt() {
    try {
      var key = 'sb-' + (SUPA_URL.replace('https://','').split('.')[0]) + '-auth-token';
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (p && p.access_token) return p.access_token;
      if (p && p.currentSession && p.currentSession.access_token) return p.currentSession.access_token;
      if (Array.isArray(p) && p[0]) return p[0];   // some SDK versions store [token, ...]
      return null;
    } catch (_) { return null; }
  }

  async function sbFetch(table, params) {
    var url = SUPA_URL + '/rest/v1/' + table;
    if (params) {
      var qs = [];
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) {
          qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
        }
      }
      if (qs.length) url += '?' + qs.join('&');
    }
    // If the user is logged in, send their access token as Authorization so
    // PostgREST resolves them as `authenticated` role (broader RLS access)
    // instead of `anon`. Falls back to the anon key if nobody is signed in.
    var jwt = getStoredJwt();
    var bearer = jwt || SUPA_KEY;
    window._lastSbUrl = url;
    window._lastSbAuth = jwt ? 'user-jwt' : 'anon';
    var res = await fetch(url, {
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + bearer,
        'Accept': 'application/json'
      }
    });
    window._lastSbStatus = res.status;
    // Stored JWT expired (PGRST303 / 401). Retry once with the anon key so
    // public reads (products, site content) still succeed on the customer's
    // first landing — they shouldn't see "JWT expired" diagnostics for a
    // page that doesn't actually require auth. Also fire-and-forget a
    // session refresh so the next call goes back to using the user JWT.
    if (res.status === 401 && jwt) {
      triggerSessionRefresh();
      res = await fetch(url, {
        headers: {
          'apikey': SUPA_KEY,
          'Authorization': 'Bearer ' + SUPA_KEY,
          'Accept': 'application/json'
        }
      });
      window._lastSbStatus = res.status;
      window._lastSbAuth = 'anon-retry';
    }
    if (!res.ok) {
      var body = '';
      try { body = (await res.text()).slice(0, 200); } catch (_) {}
      throw new Error('sbFetch ' + table + ' → HTTP ' + res.status + (body ? ' · ' + body : ''));
    }
    return await res.json();
  }

  // Async background session refresh. Lazy-loads supabase-js (it's already
  // loaded on most pages anyway) and asks it to swap the expired JWT for a
  // fresh one via the refresh_token Supabase stashes in localStorage. We
  // don't await this — the current sbFetch retries with anon for an
  // instant render, and subsequent calls pick up the new JWT.
  var _swRefreshInflight = false;
  function triggerSessionRefresh() {
    if (_swRefreshInflight) return;
    _swRefreshInflight = true;
    Promise.resolve()
      .then(function () { return typeof loadSupabaseSdk === 'function' ? loadSupabaseSdk() : null; })
      .then(function (sb) {
        if (sb && sb.auth && sb.auth.refreshSession) return sb.auth.refreshSession();
      })
      .catch(function (e) { console.warn('session refresh failed:', e && e.message); })
      .then(function () { _swRefreshInflight = false; });
  }

  // MIGRATION CHANGE (React port): the supabase-js SDK is no longer lazy-
  // loaded from jsDelivr/unpkg — the npm client bundled with the app
  // (src/lib/supabase.js, same project + same localStorage session key as
  // every other migrated page) is used instead. loadSupabaseSdk() keeps its
  // name, promise contract, and the `_sb` variable every caller reads, so
  // all downstream code is untouched. It can no longer fail to load.
  function loadSupabaseSdk() {
    if (!_sb) {
      try { _sb = sharedSupabaseClient; } catch (e) { console.error('Supabase init failed:', e); }
    }
    return Promise.resolve(_sb);
  }

  // ── PAGE NAVIGATION ──
  function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-' + page).classList.add('active');
    // Update active nav link
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    const navMap = { home: 'nav-shop', information: 'nav-information', contact: 'nav-contact', join: 'nav-join', portal: 'nav-myaccount', calculator: 'nav-information', quotation: 'nav-information', 'checkout-login': null };
    if (page === 'portal') { setTimeout(function(){ try { initPortal(); } catch(e) { console.error('Portal init error:', e); } }, 50); }
    // Calculator + Quotation forms: clear on every visit so each entry
    // starts fresh — DOM-toggled pages otherwise keep stale typed values.
    if (page === 'calculator') {
      setTimeout(function(){
        try {
          var el = document.getElementById('calc-area'); if (el) el.value = '';
          calcSeedlings();
        } catch(e){}
      }, 0);
    }
    if (page === 'quotation') {
      setTimeout(function(){
        try {
          ['quote-company','quote-attn','quote-phone','quote-email','quote-addr'].forEach(function(id){
            var el = document.getElementById(id); if (el) el.value = '';
          });
          renderQuotation();
        } catch(e){}
      }, 0);
    }
    if (page === 'checkout-login') {
      // The checkout-login page is a router target only — it opens the login
      // modal then hands control back to whichever page was last active.
      setTimeout(function(){ try { openLoginModal('checkout'); } catch(e) { console.error('Checkout login modal error:', e); } }, 0);
    }
    // Highlight the matching nav link. Defensive: not every page has a
    // dedicated nav anchor (e.g. join/contact appear in dropdowns and have
    // no top-level nav element with these ids), so skip silently if the
    // element isn't present.
    if (navMap[page]) {
      var navEl = document.getElementById(navMap[page]);
      if (navEl) navEl.classList.add('active');
    }
    // Close mobile menu
    document.getElementById('navLinks').classList.remove('open');
    // Save last page for refresh persistence (skip transient pages)
    if (page !== 'checkout-login') sessionStorage.setItem('mjm_last_page', page);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function scrollToSection(id) {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  // ══════════════════════════════════════════════
  // SEEDLING CALCULATOR
  // ══════════════════════════════════════════════
  // 1 acre = 0.404686 hectares. Density is fixed at the Malaysian
  // industry standard (136 palms/ha, 9.2 m triangular spacing).
  var CALC_DENSITY_PER_HA = 136;
  // Fixed quotation validity window — every quote is valid for 14 days
  // from the issue date. Not user-configurable per company policy.
  var QUOTE_VALIDITY_DAYS = 14;

  function calcSeedlings(){
    var areaEl = document.getElementById('calc-area');
    if (!areaEl) return; // page not in DOM yet
    var area    = parseFloat(areaEl.value) || 0;
    var unit    = document.getElementById('calc-unit').value;
    var wrap    = document.getElementById('calc-result-wrap');

    if (area <= 0) {
      wrap.innerHTML = '<div class="tool-card"><div class="tool-empty"><div style="font-size:2rem;margin-bottom:.5rem;">🌱</div><div>Enter your land area on the left to see the recommended number of seedlings.</div></div></div>';
      window._calcLastTotal = 0;
      return;
    }

    var hectares = unit === 'acre' ? area * 0.404686 : area;
    var total    = Math.round(hectares * CALC_DENSITY_PER_HA);
    window._calcLastTotal = total;  // stashed for addCalcToCart() and the WhatsApp share
    var fmt = function(n){ return n.toLocaleString('en-MY'); };

    // Area display: show in the input unit only (no parenthesised hectare echo),
    // since unit=ha already reads "ha" and unit=acre rarely needs a conversion
    // on screen — the math runs in hectares either way.
    var areaText = area.toLocaleString() + ' ' + (unit==='acre'?'acres':'ha');

    wrap.innerHTML =
      '<div class="tool-result">'+
        '<div class="tool-result-label">Recommended Order</div>'+
        '<div class="tool-result-big">'+fmt(total)+'<em>seedlings</em></div>'+
        '<div class="tool-result-breakdown">'+
          '<div class="tr-row"><span>Area</span><span>'+areaText+'</span></div>'+
          '<div class="tr-row"><span>Density</span><span>'+CALC_DENSITY_PER_HA+' palms / ha</span></div>'+
          '<div class="tr-row total"><span>Total Required Seedlings</span><span>'+fmt(total)+'</span></div>'+
        '</div>'+
        '<button class="tool-btn" onclick="addCalcToCart()">Add to Cart</button>'+
        '<div class="tool-btn-row">'+
          '<button class="tool-btn-mini whatsapp" onclick="shareCalcToWhatsApp()">'+
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg>'+
            'Share this calculation'+
          '</button>'+
          '<button class="tool-btn-mini ghost" onclick="addCalcToCartAndQuote()">Request a Quotation →</button>'+
        '</div>'+
      '</div>';
  }

  // Build a clean WhatsApp message summarising the calculation and open
  // wa.me so the customer picks the recipient from their chats.
  function shareCalcToWhatsApp(){
    var total = window._calcLastTotal || 0;
    if (total <= 0) { showPortalToast('Enter your land area first'); return; }

    var area = parseFloat(document.getElementById('calc-area').value) || 0;
    var unit = document.getElementById('calc-unit').value;
    var hectares = unit === 'acre' ? area * 0.404686 : area;
    var fmt = function(n){ return n.toLocaleString('en-MY'); };

    var areaLine = 'Land area: ' + area.toLocaleString() + ' ' + (unit==='acre'?'acres':'ha');
    if (unit === 'acre') areaLine += ' (' + hectares.toFixed(2) + ' ha)';
    var lines = [
      '🌱 *MJM Nursery — Seedling Calculator*',
      '',
      areaLine,
      'Planting density: ' + CALC_DENSITY_PER_HA + ' palms / ha (industry standard)',
      '*Total required seedlings: ' + fmt(total) + '*',
      '',
      'Calculate yours at https://www.mjmnursery.com'
    ];
    var url = 'https://wa.me/?text=' + encodeURIComponent(lines.join('\n'));
    window.open(url, '_blank');
  }

  // Allocate the calculator's recommended total across available products.
  // Greedy: walk `products` in the order the storefront already shows them
  // (sort_order, then sell-year/month), and take min(remaining, stock) from
  // each. When the first product runs out of stock, the next product picks
  // up the rest. Returns true if any seedlings were added.
  function allocateCalcTotal(total){
    if (!total || total <= 0) return [];
    if (!products || !products.length) return null;  // products not loaded yet

    var picks = [];
    var remaining = total;
    for (var i = 0; i < products.length && remaining > 0; i++) {
      var p = products[i];
      // Skip sold-out / unavailable; treat undefined status as available.
      if (p.status && p.status !== 'available' && p.status !== 'promo') continue;
      var stock = p.stock || 0;
      if (stock <= 0) continue;
      var take = Math.min(remaining, stock);
      picks.push({ product: p, qty: take });
      remaining -= take;
    }
    return picks;
  }

  function addCalcToCart(){
    var total = window._calcLastTotal || 0;
    if (total <= 0) { showPortalToast('Enter your land area first'); return; }

    var picks = allocateCalcTotal(total);
    if (picks === null) {
      showPortalToast('Seedlings are still loading — please try again in a moment.');
      return;
    }
    if (!picks.length) {
      showPortalToast('No seedlings currently in stock. Please contact us at 085-419907.');
      return;
    }

    var added = 0;
    picks.forEach(function(pick){
      var p = pick.product;
      var existing = cart.find(function(c){ return c.id === p.id; });
      var capped = Math.min(pick.qty, p.stock || 999);
      if (existing) {
        existing.qty = Math.min((existing.qty || 0) + capped, p.stock || 999);
      } else {
        cart.push({
          id: p.id, name: p.fullName || p.name, month: p.month || '',
          price: p.priceNum || 0, priceHtml: p.price, qty: capped,
          image_url: p.image_url || null, stock: p.stock || 0
        });
      }
      added += capped;
    });
    updateCartUI();

    if (added < total) {
      showPortalToast('Added ' + added.toLocaleString() + ' of ' + total.toLocaleString() + ' — that is all the seedlings currently in stock.');
    } else {
      showPortalToast('🌱 ' + added.toLocaleString() + ' seedlings added to cart across ' + picks.length + ' batch' + (picks.length>1?'es':''));
    }
  }

  function addCalcToCartAndQuote(){
    addCalcToCart();
    // Give the toast a moment to show, then navigate to quotation.
    setTimeout(function(){ showPage('quotation'); }, 400);
  }

  // ══════════════════════════════════════════════
  // QUOTATION GENERATOR
  // ══════════════════════════════════════════════
  // Builds a printable quotation from whatever is in the cart
  // (sessionStorage 'mjm_cart'). Form fields are cleared when the page is
  // opened (see showPage), so the customer always starts from a blank
  // company/address — we no longer prefill from the logged-in profile,
  // because that prefill made the field feel undeletable (re-applied on
  // every oninput render).
  function renderQuotation(){
    var out = document.getElementById('quote-output');
    if (!out) return;

    var cartItems = [];
    try { cartItems = JSON.parse(sessionStorage.getItem('mjm_cart') || '[]'); } catch (e) {}

    if (!cartItems.length) {
      out.innerHTML =
        '<div class="quote-doc"><div class="tool-empty" style="padding:3rem 1rem;">'+
          '<div style="font-size:2rem;margin-bottom:.5rem;">🛒</div>'+
          '<div style="font-weight:600;color:var(--text-dark);margin-bottom:.3rem;">Your cart is empty</div>'+
          '<div>Add seedlings to your cart, then come back here to generate a quotation.</div>'+
          '<button class="tool-btn" style="margin-top:1.25rem;max-width:240px;" onclick="showPage(\'home\'); scrollToSection(\'salesweb_products\');">Browse Seedlings</button>'+
        '</div></div>';
      return;
    }

    var company  = (document.getElementById('quote-company').value || '').trim() || '—';
    var attn     = (document.getElementById('quote-attn').value || '').trim();
    var phone    = (document.getElementById('quote-phone').value || '').trim();
    var email    = (document.getElementById('quote-email').value || '').trim();
    var addr     = (document.getElementById('quote-addr').value || '').trim();
    // Quotation validity is fixed at 14 days from issue date (policy).
    // We still need expiry for the meta header "Valid Until" line.
    var today = new Date();
    var expiry = new Date(today.getTime() + QUOTE_VALIDITY_DAYS * 86400000);
    var fmtDate = function(d){ return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }); };
    // Quote number: QUO-YYMMDD-XXXX. Cached for the day so the number stays
    // stable as the customer types into the form fields.
    var pad = function(n){ return ('0'+n).slice(-2); };
    var stamp = String(today.getFullYear()).slice(-2) + pad(today.getMonth()+1) + pad(today.getDate());
    var quoteNum = sessionStorage.getItem('mjm_quote_num_'+stamp);
    if (!quoteNum) {
      quoteNum = 'QUO-' + stamp + '-' + String(Math.floor(Math.random()*10000)).padStart(4,'0');
      sessionStorage.setItem('mjm_quote_num_'+stamp, quoteNum);
    }

    var fmtMoney = function(n){ return (n||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}); };
    var bcell = 'border:1px solid var(--green-pale);padding:.65rem .8rem;';
    var subtotal = 0;
    var rows = cartItems.map(function(c, i){
      var line = (c.price || 0) * (c.qty || 0);
      subtotal += line;
      // c.name is canonical ("Name - Month Year"); legacy cart items may still need the suffix.
      var hasMonth = c.month && c.name && c.name.indexOf(c.month) !== -1;
      var label = (c.name || '—') + (c.month && !hasMonth ? ' - ' + c.month : '');
      var shade = (i % 2 === 1) ? 'background:#faf9f4;' : '';
      return '<tr style="'+shade+'">'+
        '<td style="'+bcell+'text-align:center;color:var(--text-mid);">'+(i+1)+'</td>'+
        '<td style="'+bcell+'font-weight:700;color:var(--text-dark);">'+escapeQuote(label)+'</td>'+
        '<td style="'+bcell+'text-align:right;font-variant-numeric:tabular-nums;">'+(c.qty||0).toLocaleString()+'</td>'+
        '<td style="'+bcell+'text-align:right;font-variant-numeric:tabular-nums;">'+fmtMoney(c.price||0)+'</td>'+
        '<td style="'+bcell+'text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">'+fmtMoney(line)+'</td>'+
      '</tr>';
    }).join('');

    var th = 'border:1px solid var(--green-pale);padding:.6rem .8rem;background:var(--cream);font-size:11px;font-weight:700;color:var(--text-mid);';
    out.innerHTML =
      '<div class="quote-doc" id="quote-doc">'+
        '<div class="quote-doc-head">'+
          '<div>'+
            '<div class="qd-brand"><img src="https://cdn.store-assets.com/s/1408881/f/16655641.png" alt="MJM Nursery" style="height:64px;width:auto;display:block;"></div>'+
            '<div style="font-size:11px;color:var(--text-light);margin-top:.4rem;line-height:1.6;">MEGA JUTAMAS SDN BHD (663951-U)<br>2ND Floor (B), Lot 1180, Bangunan BEI, Lorong Dua, Krokop,<br>P.O. Box 163, 98007 Miri, Sarawak.<br>Tel: 085-419907 · Fax: 085-413264</div>'+
          '</div>'+
          '<div class="qd-meta">'+
            '<div><strong>Quotation</strong></div>'+
            '<div>No: '+escapeQuote(quoteNum)+'</div>'+
            '<div>Date: '+fmtDate(today)+'</div>'+
            '<div>Valid Until: '+fmtDate(expiry)+'</div>'+
          '</div>'+
        '</div>'+
        '<div class="quote-parties">'+
          '<div>'+
            '<div class="qp-label">Quotation For</div>'+
            '<div class="qp-value">'+
              '<strong>'+escapeQuote(company)+'</strong>'+
              (attn  ? '<br>Attn: '+escapeQuote(attn)  : '')+
              (addr  ? '<br>'+escapeQuote(addr)        : '')+
              (phone ? '<br>Tel: '+escapeQuote(phone)  : '')+
              (email ? '<br>Email: '+escapeQuote(email): '')+
            '</div>'+
          '</div>'+
        '</div>'+
        '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:1.25rem;">'+
          '<thead><tr>'+
            '<th style="'+th+'text-align:center;">No</th>'+
            '<th style="'+th+'text-align:left;">Description</th>'+
            '<th style="'+th+'text-align:right;">Qty<br><span style="font-weight:400;">(Palm)</span></th>'+
            '<th style="'+th+'text-align:right;">Unit Price<br><span style="font-weight:400;">(RM)</span></th>'+
            '<th style="'+th+'text-align:right;">Amount<br><span style="font-weight:400;">(RM)</span></th>'+
          '</tr></thead>'+
          '<tbody>'+rows+'</tbody>'+
        '</table>'+
        '<div class="quote-totals">'+
          '<div class="qt-row"><span>Subtotal (RM)</span><span>'+fmtMoney(subtotal)+'</span></div>'+
          '<div class="qt-row grand"><span>TOTAL QUOTE (RM)</span><span>'+fmtMoney(subtotal)+'</span></div>'+
        '</div>'+
        '<div class="quote-footer-note">'+
          '<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-light);margin-bottom:.5rem;">Terms &amp; Conditions</div>'+
          '<ol style="margin:0;padding-left:1.2rem;font-size:11.5px;color:var(--text-mid);line-height:1.85;">'+
            '<li>Payment Term: Cash Only.</li>'+
            '<li>All payment should be crossed and made payable to:<br><strong style="color:var(--text-dark);">MEGA JUTAMAS SDN BHD</strong><br>A/C No : HLBB 027-00-11609-6 · Hong Leong Bank Berhad</li>'+
            '<li>All payment made towards the purchase of oil palm seedlings are non-refundable.</li>'+
            '<li>Collection must be made according to the scheduled collection date.</li>'+
          '</ol>'+
          '<div style="margin-top:1.5rem;padding-top:.8rem;border-top:1px solid #eee;display:flex;justify-content:space-between;gap:1rem;font-size:10px;color:var(--text-light);">'+
            '<span style="font-weight:700;">MJM NURSERY</span>'+
            '<span style="font-style:italic;">"This is a computer-generated quotation and no signature is required."</span>'+
            '<span>'+escapeQuote(quoteNum)+' · Page 1 of 1</span>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="quote-actions">'+
        '<button class="tool-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>'+
      '</div>';
  }

  function escapeQuote(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br>');
  }

  // ── POLICY TABS ──
  // Callers pass either a button element (from the click) or nothing at
  // all (when we're auto-selecting from a URL query param). Falls back
  // to matching the tab button by its onclick binding so deep-links
  // like /index.html?policy=einvoice highlight the right chip too.
  function switchPolicyTab(tab, btn) {
    document.querySelectorAll('.policy-tab').forEach(function(t) { t.classList.remove('active'); });
    document.querySelectorAll('.policy-content').forEach(function(c) { c.classList.remove('active'); });
    var target = btn;
    if (!target) {
      var tabs = document.querySelectorAll('.policy-tab');
      for (var i = 0; i < tabs.length; i++) {
        var attr = tabs[i].getAttribute('onclick') || '';
        if (attr.indexOf("'"+tab+"'") !== -1 || (tabs[i].textContent || '').toLowerCase().indexOf(tab) !== -1) {
          target = tabs[i]; break;
        }
      }
    }
    if (target && target.classList) target.classList.add('active');
    var el = document.getElementById('pol-' + tab);
    if (el) el.classList.add('active');
  }

  // Deep-link handler: /index.html?policy=<key> auto-navigates to the
  // Information page and opens the requested tab. Used by the checkout
  // E-Invoice modal's "E-Invoice Policy" link so customers land on the
  // right section, not a generic policies page.
  function applyPolicyDeepLink(){
    try{
      var params = new URLSearchParams(window.location.search);
      var policy = params.get('policy');
      if(!policy) return;
      showPage('information');
      setTimeout(function(){ switchPolicyTab(policy); }, 40);
    }catch(_){}
  }
  setTimeout(applyPolicyDeepLink, 0);

  // ── PRODUCTS ──
  let products = [];
  let cartCount = 0;
  let lastFetchDebug = null;

  // Fetch published products via raw fetch — no supabase-js SDK needed, so a
  // CDN outage or Safari Script-error on the SDK cannot break the storefront.
  async function fetchProducts() {
    var debug = { startedAt: new Date().toISOString(), step: 'start' };
    var data = null;
    // Try 1 — full query with sort_order
    try {
      data = await sbFetch('salesweb_products', {
        'select': '*',
        'is_published': 'eq.true',
        'is_active': 'eq.true',
        'order': 'sort_order.asc.nullslast,sell_year.asc,sell_month.asc'
      });
      debug.firstCount = (data && data.length) || 0;
      debug.step = 'done';
    } catch (e) {
      debug.firstError = (e && e.message) ? e.message : String(e);
    }
    // Try 2 — drop sort_order (older deployments)
    if (!data || !data.length) {
      try {
        data = await sbFetch('salesweb_products', {
          'select': '*',
          'is_published': 'eq.true',
          'is_active': 'eq.true',
          'order': 'sell_year.asc,sell_month.asc'
        });
        debug.fallbackCount = (data && data.length) || 0;
        debug.step = 'done-fallback';
      } catch (e2) {
        debug.fallbackError = (e2 && e2.message) ? e2.message : String(e2);
      }
    }
    // Try 3 — boolean filter syntax variant (`is.true` instead of `eq.true`).
    // PostgREST treats these subtly differently; if RLS or some quirk is
    // hiding rows under one syntax it may not under the other.
    if (!data || !data.length) {
      try {
        data = await sbFetch('salesweb_products', {
          'select': '*',
          'is_published': 'is.true',
          'is_active': 'is.true'
        });
        debug.is2Count = (data && data.length) || 0;
        debug.step = 'done-is';
      } catch (e3) {
        debug.is2Error = (e3 && e3.message) ? e3.message : String(e3);
      }
    }
    // Try 4 (final, ANON-READ probe) — no filters, just a limit. If THIS
    // returns rows we know RLS/auth is fine and the bug is in our filter
    // syntax. If THIS returns 0 too, then RLS is blocking anon SELECT and
    // we need a policy fix in Supabase, not a code fix here.
    if (!data || !data.length) {
      try {
        var probe = await sbFetch('salesweb_products', { 'select': 'id,name,is_published,is_active', 'limit': '5' });
        debug.probeCount = (probe && probe.length) || 0;
        debug.probeSample = (probe && probe[0]) ? JSON.stringify(probe[0]).slice(0, 200) : null;
      } catch (e4) {
        debug.probeError = (e4 && e4.message) ? e4.message : String(e4);
      }
    }
    // Capture the last URL + status so the diagnostic banner shows it.
    debug.lastUrl = window._lastSbUrl || null;
    debug.lastStatus = window._lastSbStatus || null;
    lastFetchDebug = debug;
    if (!data || !data.length) {
      products = [];
      renderProducts();
      return;
    }

    products = data.map(function(p) {
      // Only include the actual sell month/year here — DO NOT fall back to
      // the description field, since description is reserved for the product
      // popup and must never bleed onto the main card.
      var sellLabel = (p.sell_month && p.sell_year) ? p.sell_month + ' ' + p.sell_year : '';
      // Strip any trailing " — Month YYYY" / " - Month YYYY" from the name so the
      // month never renders twice (in the title AND as the subtitle).
      var rawName = p.name || '';
      var monthRe = /\s*[-—–]\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\s*$/i;
      var match = rawName.match(monthRe);
      var displayName = rawName.replace(monthRe, '').trim();
      if (!sellLabel && match) { sellLabel = match[1] + ' ' + match[2]; }
      // Render the title as "<name> -" when there's a month subtitle to anchor below it.
      var titleLine = sellLabel ? displayName + ' -' : displayName;
      // Canonical full label used by the cart, popup, and toast (always "Name — Month Year" if applicable).
      var canonicalName = displayName + (sellLabel ? ' — ' + sellLabel : '');
      var status = 'available';
      var badge = null;
      if (p.stock_qty <= 0) { status = 'sold-out'; badge = 'Sold Out'; }
      else if (p.stock_qty <= 20) { badge = 'Low Stock'; }
      if (p.collection === 'Promotion') { badge = 'Promo'; }
      // Pricing: if compare_price > price, show strikethrough
      var fmtMyr = function(n) { return (n || 0).toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2}); };
      var priceHtml = 'RM ' + fmtMyr(p.price);
      if (p.compare_price && p.compare_price > p.price) {
        priceHtml = '<span style="text-decoration:line-through;color:var(--text-light);font-size:.75em;">RM ' + fmtMyr(p.compare_price) + '</span> RM ' + fmtMyr(p.price);
      }
      return {
        id: p.id,
        name: titleLine,
        fullName: canonicalName,
        month: sellLabel,
        description: p.description || '',
        price: priceHtml,
        priceNum: p.price || 0,
        stock: p.stock_qty || 0,
        status: status,
        badge: badge,
        image_url: p.image_url || null,
        collection: p.collection || 'Normal Sales'
      };
    });
    renderProducts();
  }

  function renderProductCard(p) {
    var bc = p.status === 'sold-out' ? 'sold-out' : p.status === 'coming-soon' ? 'coming-soon' : '';
    var badge = p.badge ? '<div class="product-badge ' + bc + '">' + esc(p.badge) + '</div>' : '';
    var canAdd = p.status === 'available' || p.status === 'promo';
    var imgHtml = p.image_url
      ? '<img src="' + esc(p.image_url) + '" loading="lazy" decoding="async" fetchpriority="low" style="width:100%;height:100%;object-fit:cover;" alt="' + esc(p.fullName || p.name) + '">'
      : '<svg viewBox="0 0 80 100" fill="none"><path d="M40 85 Q25 65 25 50 Q25 30 40 15 Q55 30 55 50 Q55 65 40 85Z" fill="#6A9B6E" opacity=".4"/><path d="M40 85 Q20 70 18 55 Q16 38 30 25" stroke="#3E6B42" stroke-width="1.5" fill="none" opacity=".5"/><path d="M40 85 Q60 70 62 55 Q64 38 50 25" stroke="#3E6B42" stroke-width="1.5" fill="none" opacity=".5"/><rect x="32" y="85" width="16" height="12" rx="2" fill="#2D4A30" opacity=".6"/></svg>';
    var idx = products.indexOf(p);

    // Main page card: image + name open the popup (read-only product detail).
    // Qty +/-, qty input, and Add-to-Cart are clickable directly on the card —
    // stopPropagation prevents those clicks from bubbling up to the popup
    // opener. Description NEVER renders on the card by spec.
    var qtyRow = canAdd
      ? '<div class="card-qty-row" onclick="event.stopPropagation();">'
        + '<button class="card-qty-btn" type="button" onclick="event.stopPropagation();changeCardQty(' + idx + ',-1)" aria-label="Decrease quantity">−</button>'
        + '<input type="text" class="card-qty-input" id="cardQty-' + idx + '" value="1" inputmode="numeric" onclick="event.stopPropagation()" onkeydown="if(event.key===\'Enter\')this.blur();" onblur="setCardQty(' + idx + ',this.value)">'
        + '<button class="card-qty-btn" type="button" onclick="event.stopPropagation();changeCardQty(' + idx + ',1)" aria-label="Increase quantity">+</button>'
        + '</div>'
      : '';
    var addLabel = p.status === 'sold-out' ? 'Sold Out' : p.status === 'coming-soon' ? 'Coming Soon' : 'Add to Cart';
    var addBtn = '<button class="btn-add card-add-btn" type="button" ' + (canAdd ? '' : 'disabled ') + 'onclick="event.stopPropagation();addCardToCart(' + idx + ')">' + addLabel + '</button>';
    var cardClass = 'product-card' + (p.status === 'sold-out' ? ' is-sold-out' : '');

    return '<div class="' + cardClass + '" onclick="openProductPopup(' + idx + ')">'
         +   '<div class="product-img">' + badge + imgHtml + '</div>'
         +   '<div class="product-info">'
         +     '<div class="product-name">' + esc(p.name) + '</div>'
         +     (p.month ? '<div class="product-month">' + esc(p.month) + '</div>' : '')
         +     '<div class="product-price" style="margin-top:.3rem;">' + esc(p.price) + '</div>'
         +     '<div class="product-stock">' + (p.stock > 0 ? p.stock.toLocaleString() + ' left' : 'Out of stock') + '</div>'
         +     qtyRow
         +     addBtn
         +   '</div>'
         + '</div>';
  }

  function renderProducts() {
    var specialEl = document.getElementById('specialGrid');
    var gridEl = document.getElementById('productsGrid');
    var specialSection = specialEl.closest('section');
    var promoProducts = products.filter(function(p) { return p.collection === 'Promotion'; });
    var normalProducts = products.filter(function(p) { return p.collection !== 'Promotion'; });

    // Special For You: only Promotion collection products
    if (promoProducts.length) {
      specialSection.style.display = '';
      specialEl.innerHTML = promoProducts.map(renderProductCard).join('');
    } else {
      specialSection.style.display = 'none';
    }

    // Featured Products: everything else (Normal Sales etc.)
    if (normalProducts.length) {
      gridEl.innerHTML = normalProducts.map(renderProductCard).join('');
    } else if (!promoProducts.length) {
      var dbg = lastFetchDebug || {};
      var dbgLine = 'step:' + (dbg.step || '?')
        + ' · first:' + (dbg.firstCount || 0)
        + (dbg.fallbackCount !== undefined ? ' · fb:' + dbg.fallbackCount : '')
        + (dbg.is2Count !== undefined ? ' · is:' + dbg.is2Count : '')
        + (dbg.probeCount !== undefined ? ' · probe:' + dbg.probeCount : '');
      if (dbg.firstError) dbgLine += ' · firstErr:' + dbg.firstError;
      if (dbg.fallbackError) dbgLine += ' · fbErr:' + dbg.fallbackError;
      if (dbg.is2Error) dbgLine += ' · isErr:' + dbg.is2Error;
      if (dbg.probeError) dbgLine += ' · probeErr:' + dbg.probeError;
      if (dbg.probeSample) dbgLine += ' · sample:' + dbg.probeSample;
      if (dbg.threw) dbgLine += ' · threw:' + dbg.threw;
      if (dbg.lastStatus) dbgLine += ' · HTTP ' + dbg.lastStatus;
      if (window._lastSbAuth) dbgLine += ' · auth:' + window._lastSbAuth;
      if (dbg.lastUrl) dbgLine += '\nURL: ' + dbg.lastUrl;
      gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem 1.5rem;background:#fff;border:1px dashed var(--green-pale);border-radius:16px;">'
        + '<div style="font-size:42px;margin-bottom:.5rem;">&#127793;</div>'
        + '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.4rem;color:var(--text-dark);margin-bottom:.4rem;">New seedlings coming soon</div>'
        + '<div style="color:var(--text-light);font-size:13px;line-height:1.55;max-width:320px;margin:0 auto;">Our growers are preparing the next batch. Tap <strong style="color:var(--green-dark);">Book Seedling Collection</strong> to reserve a slot, or check back shortly.</div>'
        + '<button onclick="fetchProducts()" style="margin-top:1rem;background:var(--green-dark);color:#fff;border:none;padding:.5rem 1.2rem;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;">Reload products</button>'
        + '<div style="margin-top:.8rem;font-size:10px;color:#bbb;font-family:monospace;word-break:break-all;white-space:pre-wrap;text-align:left;max-width:520px;margin-left:auto;margin-right:auto;">' + esc(dbgLine) + '</div>'
        + '</div>';
    } else {
      gridEl.innerHTML = '';
    }
  }

  // ═══════════════════════════════════════
  //  SHOPPING CART SYSTEM
  // ═══════════════════════════════════════
  var cart = JSON.parse(sessionStorage.getItem('mjm_cart') || '[]');
  var popupProductIdx = -1;
  var popupQty = 1;

  function fmtRM(n) { return 'RM ' + n.toLocaleString('en-MY', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
  function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  // Product popup — read-only product detail (photo + description). Qty input
  // and Add-to-Cart now live on the main page card, not in the popup.
  function openProductPopup(idx) {
    var p = products[idx];
    if (!p) return;
    popupProductIdx = idx;
    popupQty = 1;

    var imgEl = document.getElementById('ppImg');
    if (p.image_url) imgEl.innerHTML = '<img src="' + esc(p.image_url) + '">';
    else imgEl.innerHTML = '<div style="font-size:3rem;">🌱</div>';

    document.getElementById('ppName').textContent = p.fullName || p.name;
    // ppDesc now shows the REAL product description (or a graceful fallback).
    var descEl = document.getElementById('ppDesc');
    if (p.description) {
      descEl.textContent = p.description;
      descEl.style.display = '';
    } else {
      descEl.textContent = '';
      descEl.style.display = 'none';
    }
    document.getElementById('ppPrice').textContent = fmtRM(p.priceNum || 0);
    document.getElementById('ppStock').textContent = p.stock > 0 ? p.stock.toLocaleString() + ' available' : 'Out of stock';
    document.getElementById('productPopup').classList.add('open');
  }

  function closeProductPopup() {
    document.getElementById('productPopup').classList.remove('open');
    popupProductIdx = -1;
  }

  // ── In-card quantity + Add to Cart (main page) ─────────────────────────────
  function changeCardQty(idx, delta) {
    var p = products[idx];
    if (!p) return;
    var input = document.getElementById('cardQty-' + idx);
    if (!input) return;
    var cur = parseInt(input.value) || 1;
    var next = cur + delta;
    next = Math.max(1, Math.min(p.stock || 999, next));
    input.value = next;
  }

  function setCardQty(idx, val) {
    var p = products[idx];
    if (!p) return;
    var input = document.getElementById('cardQty-' + idx);
    if (!input) return;
    var n = parseInt(val) || 1;
    n = Math.max(1, Math.min(p.stock || 999, n));
    input.value = n;
  }

  function addCardToCart(idx) {
    var p = products[idx];
    if (!p) return;
    if (p.status !== 'available' && p.status !== 'promo') return;
    var input = document.getElementById('cardQty-' + idx);
    var qty = parseInt(input ? input.value : '1') || 1;
    qty = Math.max(1, Math.min(p.stock || 999, qty));
    var priceNum = p.priceNum || 0;
    var existing = cart.find(function(c) { return c.id === p.id; });
    if (existing) {
      existing.qty = Math.min((existing.qty || 0) + qty, p.stock || 999);
    } else {
      cart.push({
        id: p.id, name: p.fullName || p.name, month: p.month || '',
        price: priceNum, priceHtml: p.price, qty: qty,
        image_url: p.image_url || null, stock: p.stock || 0
      });
    }
    updateCartUI();
    if (typeof showPortalToast === 'function') showPortalToast((p.fullName || p.name) + ' × ' + qty + ' added to cart');
    if (input) input.value = 1;
  }

  function addPopupToCart() {
    var p = products[popupProductIdx];
    if (!p) return;

    var priceNum = p.priceNum || 0;

    // Check if already in cart
    var existing = cart.find(function(c) { return c.id === p.id; });
    if (existing) {
      existing.qty += popupQty;
    } else {
      cart.push({
        id: p.id,
        name: p.fullName || p.name,
        month: p.month || '',
        price: priceNum,
        priceHtml: p.price,
        qty: popupQty,
        image_url: p.image_url || null,
        stock: p.stock || 0
      });
    }

    closeProductPopup();
    updateCartUI();
  }

  // Cart dropdown
  function toggleCartDropdown() {
    var dd = document.getElementById('cartDropdown');
    dd.classList.toggle('open');
  }

  function saveCart() {
    sessionStorage.setItem('mjm_cart', JSON.stringify(cart));
  }

  function updateCartUI() {
    saveCart();
    // Update count badge
    var totalItems = cart.reduce(function(s, c) { return s + c.qty; }, 0);
    document.getElementById('cartCount').textContent = totalItems.toLocaleString();

    // Render cart items
    var itemsEl = document.getElementById('cartItems');
    var footerEl = document.getElementById('cartFooter');

    if (!cart.length) {
      itemsEl.innerHTML = '<div class="cart-empty">Your cart is empty</div>';
      footerEl.innerHTML = '';
      return;
    }

    var html = '';
    cart.forEach(function(c, i) {
      var imgHtml = c.image_url
        ? '<img src="' + c.image_url + '" class="cart-item-img">'
        : '<div class="cart-item-img" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🌱</div>';
      html += '<div class="cart-item">' +
        imgHtml +
        '<div class="cart-item-info">' +
          '<div class="cart-item-name" title="' + c.name + (c.month && c.name.indexOf(c.month) === -1 ? ' — ' + c.month : '') + '">' + c.name + (c.month && c.name.indexOf(c.month) === -1 ? ' — ' + c.month : '') + '</div>' +
          '<div class="cart-item-price">' + fmtRM(c.price) + ' each</div>' +
        '</div>' +
        '<button class="cart-item-remove" onclick="removeCartItem(' + i + ')" title="Remove">✕</button>' +
        '<div class="cart-item-bottom">' +
          '<div class="cart-item-qty">' +
            '<button class="cart-qty-btn" onclick="changeCartQty(' + i + ',-1)">−</button>' +
            '<input class="cart-qty-input" type="text" value="' + c.qty.toLocaleString() + '" data-idx="' + i + '" onfocus="this.value=this.value.replace(/,/g,\'\')" onblur="setCartQty(' + i + ',this.value)" onkeydown="if(event.key===\'Enter\'){this.blur();}">' +
            '<button class="cart-qty-btn" onclick="changeCartQty(' + i + ',1)">+</button>' +
          '</div>' +
          '<div class="cart-item-total">' + fmtRM(c.price * c.qty) + '</div>' +
        '</div>' +
      '</div>';
    });
    itemsEl.innerHTML = html;

    // Footer with total
    var total = cart.reduce(function(s, c) { return s + (c.price * c.qty); }, 0);
    footerEl.innerHTML =
      '<div class="cart-total-row"><span>Total</span><span>' + fmtRM(total) + '</span></div>' +
      '<button class="cart-checkout-btn" onclick="proceedToCheckout()">Proceed to Payment</button>';
  }

  function changeCartQty(idx, delta) {
    if (!cart[idx]) return;
    cart[idx].qty = Math.max(1, Math.min(cart[idx].stock || 999, cart[idx].qty + delta));
    updateCartUI();
  }

  function setCartQty(idx, val) {
    if (!cart[idx]) return;
    var n = parseInt(String(val).replace(/,/g, '')) || 1;
    cart[idx].qty = Math.max(1, Math.min(cart[idx].stock || 999, n));
    updateCartUI();
  }

  function removeCartItem(idx) {
    cart.splice(idx, 1);
    updateCartUI();
  }

  function proceedToCheckout() {
    if (!cart.length) return;
    saveCart();
    // Check if user is logged in
    var userName = sessionStorage.getItem('mjm_user_name');
    if (userName) {
      // Already logged in — go straight to payment
      window.location.href = 'payment.html';
    } else {
      // Not logged in — open login modal (stays on current page)
      toggleCartDropdown();
      openLoginModal('checkout');
    }
  }

  // Close cart dropdown when clicking outside
  document.addEventListener('click', function(e) {
    var dd = document.getElementById('cartDropdown');
    var btn = document.getElementById('cartBtn');
    if (dd && dd.classList.contains('open') && !dd.contains(e.target) && !btn.contains(e.target)) {
      dd.classList.remove('open');
    }
  });

  // Without this, clicking the per-item ✕ / qty buttons closes the whole cart:
  // removeCartItem/changeCartQty rewrite the cart's innerHTML synchronously, so by
  // the time the click bubbles to the document the original target has been
  // detached from the DOM — `dd.contains(e.target)` then returns false and the
  // outside-click handler above closes the dropdown. Containing the click here
  // prevents that misfire.
  (function(){
    var cartDD = document.getElementById('cartDropdown');
    if (cartDD) cartDD.addEventListener('click', function(e){ e.stopPropagation(); });
  })();

  function submitContactForm(e) {
    e.preventDefault();
    e.target.innerHTML = '<div style="text-align:center;padding:3rem 1rem"><div style="font-size:3rem;margin-bottom:1rem">✅</div><h3 style="font-family:Cormorant Garamond,serif;font-size:1.8rem;color:var(--green-dark);margin-bottom:.5rem">Message Sent!</h3><p style="color:var(--text-mid)">Thank you for reaching out. We\'ll get back to you shortly.</p></div>';
  }

  // Nav scroll shadow
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 50);
  });

  // Mobile hamburger
  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('open');
  });

  // ── Logo fly-to-center on hover ──
  var logoFlying = false;
  var logoFlyWrap = document.getElementById('logoFlyWrap');
  var logoBackdrop = document.getElementById('logoBackdrop');
  var logoSlogan = document.getElementById('logoSlogan');
  var navLogoImg = document.getElementById('nav-logo-img');

  logoFlyWrap.style.display = 'none';

  function showLogoOverlay() {
    if (logoFlying) return;
    logoFlying = true;

    var rect = navLogoImg.getBoundingClientRect();
    navLogoImg.style.opacity = '0';

    logoFlyWrap.style.display = 'block';
    logoFlyWrap.style.transition = 'none';
    logoFlyWrap.style.left = rect.left + 'px';
    logoFlyWrap.style.top = rect.top + 'px';
    logoFlyWrap.style.width = rect.width + 'px';
    logoFlyWrap.style.height = rect.height + 'px';

    void logoFlyWrap.offsetWidth;

    var targetSize = 260;
    logoFlyWrap.style.transition = 'all .6s cubic-bezier(.4, 0, .1, 1)';
    logoFlyWrap.style.left = (window.innerWidth / 2 - targetSize / 2) + 'px';
    logoFlyWrap.style.top = (window.innerHeight / 2 - targetSize / 2) + 'px';
    logoFlyWrap.style.width = targetSize + 'px';
    logoFlyWrap.style.height = targetSize + 'px';
    logoFlyWrap.classList.add('flying');

    logoBackdrop.classList.add('active');

    setTimeout(function() {
      logoSlogan.style.left = '50%';
      logoSlogan.style.top = (window.innerHeight / 2 + targetSize / 2 + 8) + 'px';
      logoSlogan.style.transform = 'translateX(-50%)';
      logoSlogan.classList.add('visible');
    }, 250);
  }

  function logoFlyBack() {
    if (!logoFlying) return;
    var rect = navLogoImg.getBoundingClientRect();

    logoSlogan.classList.remove('visible');
    logoBackdrop.classList.remove('active');

    logoFlyWrap.style.transition = 'all .25s cubic-bezier(.4, 0, .8, 1)';
    logoFlyWrap.style.left = rect.left + 'px';
    logoFlyWrap.style.top = rect.top + 'px';
    logoFlyWrap.style.width = rect.width + 'px';
    logoFlyWrap.style.height = rect.height + 'px';
    logoFlyWrap.classList.remove('flying');

    setTimeout(function() {
      logoFlyWrap.style.display = 'none';
      navLogoImg.style.opacity = '1';
      logoFlying = false;
    }, 250);
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') logoFlyBack();
  });

  fetchProducts();
  updateCartUI();
  loadPassionSection();

  // Preload the supabase SDK in the background (non-blocking). By the time
  // the user clicks Login or My Account, it's usually already loaded. If the
  // load fails on Safari/iOS, the storefront still works — only portal
  // features will be unavailable.
  (function preloadSdkIdle() {
    function go() { try { loadSupabaseSdk(); } catch (_) {} }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(go, { timeout: 4000 });
    } else {
      setTimeout(go, 2500);
    }
  })();

  // ── Load passion section (fast: metadata first, images lazy-loaded individually) ──
  var _passionPlaceholderBg = {
    plantation: 'linear-gradient(135deg, #2e7d32, #4caf50)',
    nursery: 'linear-gradient(135deg, #2D4A30, #3E6B42)',
    mill: 'linear-gradient(135deg, #bf360c, #e65100)',
    collection: 'linear-gradient(135deg, #0d47a1, #1565c0)',
    baja: 'linear-gradient(135deg, #4a148c, #7b1fa2)'
  };
  var _passionEmoji = { plantation:'🌴', nursery:'🌱', mill:'🏭', collection:'🚛', baja:'♻️' };
  var _passionDefaults = [
    { id:'d1', key:'plantation', label:'Oil Palm Plantation', description:'Where it all begins' },
    { id:'d2', key:'nursery', label:'MJM Nursery', description:'Premium seedling supplier' },
    { id:'d3', key:'mill', label:'MJM Palm Oil Mill', description:'Processing into crude palm oil' },
    { id:'d4', key:'collection', label:'MJM Collection Center', description:'Collection points for planters' },
    { id:'d5', key:'baja', label:'SawitGro Baja Kompos', description:'Completing the cycle' }
  ];

  async function loadPassionSection() {
    var container = document.getElementById('passionFlow');
    if (!container) return;

    // Step 1: Fetch metadata only (no image_url) — instant. Raw fetch so no
    // dependency on supabase-js SDK loading first. Defaults to an empty
    // array so the page never crashes with "items.forEach is undefined" if
    // _passionDefaults somehow isn't available at this point.
    var items = (typeof _passionDefaults !== 'undefined' && _passionDefaults) ? _passionDefaults : [];
    try {
      var data = await sbFetch('salesweb_site_content', {
        'select': 'id,key,label,description,sort_order',
        'section': 'eq.passion',
        'order': 'sort_order.asc'
      });
      if (data && data.length > 0) items = data;
    } catch(e) { /* use defaults */ }
    if (!Array.isArray(items)) items = [];

    // Step 2: Render placeholders immediately
    var html = '';
    items.forEach(function(item, i) {
      if (i > 0) html += '<div class="passion-divider"><span class="passion-divider-arrow">&rsaquo;</span></div>';
      var bg = _passionPlaceholderBg[item.key] || _passionPlaceholderBg.plantation;
      var emoji = _passionEmoji[item.key] || '';
      html += '<div class="passion-panel" id="pp-' + item.id + '">' +
        '<div class="passion-panel-img" style="background:' + bg + ';"></div>' +
        '<div class="passion-panel-placeholder">' + emoji + '</div>' +
        '<div class="passion-panel-overlay">' +
          '<div class="passion-panel-name">' + (item.label||'') + '</div>' +
          '<div class="passion-panel-desc">' + (item.description||'') + '</div>' +
        '</div>' +
      '</div>';
    });
    container.innerHTML = html;

    // Step 3: Load each image individually in background (non-blocking)
    items.forEach(function(item) {
      if (item.id && !item.id.startsWith('d')) loadPassionPanelImg(item.id, item.key);
    });
  }

  async function loadPassionPanelImg(id, key) {
    try {
      var rows = await sbFetch('salesweb_site_content', {
        'select': 'image_url',
        'id': 'eq.' + id
      });
      var data = rows && rows[0];
      if (data && data.image_url) {
        var panel = document.getElementById('pp-' + id);
        if (!panel) return;
        var placeholder = panel.querySelector('.passion-panel-placeholder');
        if (placeholder) placeholder.remove();
        var bgDiv = panel.querySelector('.passion-panel-img');
        if (bgDiv) bgDiv.remove();
        var img = document.createElement('img');
        img.className = 'passion-panel-img';
        img.src = data.image_url;
        img.alt = key || '';
        img.loading = 'lazy';
        panel.insertBefore(img, panel.firstChild);
      }
    } catch(e) { /* keep placeholder */ }
  }

  // Restore last page on refresh
  (function(){
    try {
      var lastPage=sessionStorage.getItem('mjm_last_page');
      // Clear stale checkout-login page (transient, should never restore)
      if(lastPage==='checkout-login'){sessionStorage.setItem('mjm_last_page','home');lastPage='home';}
      if(lastPage&&lastPage!=='home'&&document.getElementById('page-'+lastPage)){
        showPage(lastPage);
      }
    } catch(e) { console.error('Restore page error:', e); }
  })();

  // ══════════════════════════════════════════════
  //  PORTAL (embedded in sales web)
  // ══════════════════════════════════════════════
  var P_ORDERS = [];
  var P_POINTS = {balance:0,tier:'Bronze',totalEarned:0,redeemed:0,tiers:[{name:'Bronze',min_points:0,color:'#CD7F32'}]};
  var pConsentSigned={}, pRatings={}, pVtab='active', pRatingOrderId=null, pRatingVal=0;
  var portalUser = null;

  // Strip the " — <month>" suffix that payment.html appends to product_name
  // when an item has a sell month. Display layer only — the DB row keeps the
  // full string for back-office cross-reference.
  function stripMonth(name){ return String(name||'').replace(/\s+—\s+.*$/, '').trim(); }

  function pBadge(s){return{
    'Paid':'p-badge-green','Order Confirmed':'p-badge-green',
    'Pending Payment':'p-badge-amber',
    'Ready for Collection':'p-badge-teal','Ready-to-Collect':'p-badge-teal',
    'Collecting':'p-badge-orange',
    'Completed':'p-badge-grey','Order Completed':'p-badge-grey',
    'Cancelled':'p-badge-red','Refunded':'p-badge-red'
  }[s]||'p-badge-grey';}

  // Terminal statuses live in Order History: Completed, Cancelled, Refunded.
  // Everything else (Pending Payment, Paid, Ready for Collection, …) stays
  // in Active Orders. DB stores 'Completed'; older demo data used
  // 'Order Completed', kept for backwards compatibility.
  function pIsOrderDone(o){
    return o.status==='Completed' || o.status==='Order Completed'
        || o.status==='Cancelled' || o.status==='Refunded';
  }

  async function saveProfileDetails(){
    try{
      var sess=await _sb.auth.getSession();
      var uid=sess?.data?.session?.user?.id;
      if(!uid){showPortalToast('Please log in first');return;}
      var name=document.getElementById('pf-name2').value.trim();
      var phone=document.getElementById('pf-phone2').value.trim();
      var updates={};
      if(name)updates.full_name=name;
      if(phone)updates.phone=phone;
      if(Object.keys(updates).length){
        await _sb.from('shared_profiles').update(updates).eq('id',uid);
        // Also update auth metadata for name
        if(name)await _sb.auth.updateUser({data:{full_name:name}});
        sessionStorage.setItem('mjm_user_name',name);
      }
      showPortalToast('Account details saved');
    }catch(e){showPortalToast('Error saving: '+e.message);}
  }

  async function initPortal(){
    // Portal needs the supabase SDK (auth.getSession, etc.) — make sure it's
    // loaded before any _sb.* call below. Safe to await even if already loaded.
    await loadSupabaseSdk();
    if (!_sb) { console.warn('Portal: supabase SDK unavailable'); return; }
    portalUser = sessionStorage.getItem('mjm_user_name')||'Customer';
    var nameEl=document.getElementById('pf-name2');if(nameEl)nameEl.value=portalUser;
    var emailEl=document.getElementById('pf-email2');if(emailEl)emailEl.value=sessionStorage.getItem('mjm_user_email')||'';
    // Load phone from profiles table
    try{
      var sess=await _sb.auth.getSession();
      var uid=sess?.data?.session?.user?.id;
      if(uid){
        var{data:prof}=await _sb.from('shared_profiles').select('phone').eq('id',uid).single();
        if(prof&&prof.phone){document.getElementById('pf-phone2').value=prof.phone;}
      }
    }catch(e){console.error('Phone load:',e);}

    // Load real orders from database
    await loadCustomerOrders();
    try{await loadPortalSettings();}catch(e){console.error('portal settings load:',e);}

    // Defensively clear the search input before rendering. Chrome/Safari can
    // ignore autocomplete=off for fields near a logged-in user's context and
    // autofill the email here — which would then filter every order out.
    // Schedule additional clears at 200ms and 800ms to catch autofill that
    // arrives after the initial render.
    (function clearSearchDefensively(){
      var inp=document.getElementById('pp-order-search');
      function clear(){ if(inp && inp.value && /@|\s/.test(inp.value)){ inp.value=''; if(typeof pRenderOrders==='function') pRenderOrders(); if(typeof pRenderHistory==='function') pRenderHistory(); } }
      if(inp){ inp.value=''; }
      setTimeout(clear, 200);
      setTimeout(clear, 800);
      setTimeout(clear, 2000);
    })();

    try{pRenderOrders();}catch(e){console.error('orders:',e);}
    try{pRenderHistory();}catch(e){console.error('history:',e);}
    try{await loadCustomerPoints();}catch(e){console.error('points load:',e);}
    try{pRenderMemberCard();}catch(e){console.error('member:',e);}
    try{pRenderPointsCard();}catch(e){console.error('points:',e);}
    pActivityRows=null; pActivityShowAll=false;
    try{pRenderPointsActivity();}catch(e){console.error('points activity:',e);}
    try{loadBillingFromDb().then(function(){renderBillingEntries();}).catch(function(){loadBillingFromStorage();renderBillingEntries();});}catch(e){loadBillingFromStorage();renderBillingEntries();}

    var lastTab=sessionStorage.getItem('mjm_portal_tab');
    if(lastTab){var btn=document.getElementById('ptab-'+lastTab);if(btn)pShowOrderView(lastTab,btn);}
  }

  async function loadCustomerOrders(){
    var session=await _sb.auth.getSession();
    var userId=session?.data?.session?.user?.id;
    if(!userId)return;
    var{data:orders,error:ordErr}=await _sb.from('salesweb_customer_orders').select('*').eq('customer_id',userId).order('created_at',{ascending:false});
    if(ordErr){console.error('Orders load error:',ordErr);}
    if(!orders||!orders.length){P_ORDERS=[];return;}
    // Load order items for each order
    var orderIds=orders.map(function(o){return o.id;});
    var{data:items}=await _sb.from('salesweb_order_items').select('*').in('order_id',orderIds);
    var itemsByOrder={};
    if(items)items.forEach(function(it){if(!itemsByOrder[it.order_id])itemsByOrder[it.order_id]=[];itemsByOrder[it.order_id].push(it);});
    // Map to P_ORDERS format
    // Load DOs linked to order numbers (via al_orders)
    var orderNumbers=orders.map(function(o){return o.order_number;}).filter(Boolean);
    var dosByAL={};
    var attachmentsByOrder={};
    try{
      if(orderNumbers.length){
        var{data:dos}=await _sb.from('shared_do_records').select('*').in('al_number',orderNumbers).order('created_at',{ascending:false});
        if(dos)dos.forEach(function(d){if(!dosByAL[d.al_number])dosByAL[d.al_number]=[];dosByAL[d.al_number].push(d);});
      }
    }catch(e){console.error('DO load error:',e);}
    // Load order attachments
    try{
      if(orderIds.length){
        var{data:atts}=await _sb.from('salesweb_order_attachments').select('*').in('order_id',orderIds).order('created_at',{ascending:false});
        if(atts)atts.forEach(function(a){if(!attachmentsByOrder[a.order_id])attachmentsByOrder[a.order_id]=[];attachmentsByOrder[a.order_id].push(a);});
      }
    }catch(e){console.error('Attachments load error:',e);}
    // Load order timelines
    var timelinesByOrder={};
    try{
      if(orderIds.length){
        var{data:tl}=await _sb.from('salesweb_order_timeline').select('*').in('order_id',orderIds).order('created_at',{ascending:true});
        if(tl)tl.forEach(function(t){if(!timelinesByOrder[t.order_id])timelinesByOrder[t.order_id]=[];timelinesByOrder[t.order_id].push(t);});
      }
    }catch(e){console.error('Timeline load error:',e);}
    // Collection bookings keyed by order_number. The booking app
    // (CollectionTimeBooking) saves the verified order_number into
    // shared_collection_bookings.order_number — we join on that. Filter
    // out cancelled bookings so a customer who booked, cancelled, and
    // re-booked doesn't see the cancelled slot still listed.
    var bookingsByOrderNum={};
    try{
      if(orderNumbers.length){
        var{data:bks}=await _sb.from('shared_collection_bookings')
          .select('id,booking_date,start_time,end_time,collection_qty,status,notes,al_number,order_number,created_at')
          .in('order_number',orderNumbers)
          .neq('status','cancelled')
          .order('booking_date',{ascending:true});
        if(bks)bks.forEach(function(b){
          var k=b.order_number;
          if(!bookingsByOrderNum[k])bookingsByOrderNum[k]=[];
          bookingsByOrderNum[k].push(b);
        });
      }
    }catch(e){console.error('Bookings load error:',e);}

    P_ORDERS=orders.map(function(o){
      var oItems=itemsByOrder[o.id]||[];
      var totalQty=oItems.reduce(function(s,it){return s+it.quantity;},0);
      var variety=oItems.length?oItems.map(function(it){return stripMonth(it.product_name);}).join(', '):'Order';
      var d=new Date(o.created_at);
      var orderDate=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      // Parse remark for individual fields
      var remarkParts=(o.customer_remark||'').split(' | ');
      var userRemark='',phone='';
      remarkParts.forEach(function(p){
        if(p.startsWith('Phone: '))phone=p.replace('Phone: ','');
        else if(!p.startsWith('Payment:')&&!p.startsWith('Voucher:')&&!p.startsWith('Points:')&&!p.startsWith('Billing Addr:')&&!p.startsWith('IC:')&&!p.startsWith('Reg:')&&!p.startsWith('MPOB:'))userRemark=p;
      });
      var billingAddr='';
      remarkParts.forEach(function(p){if(p.startsWith('Billing Addr: '))billingAddr=p.replace('Billing Addr: ','');});
      var billingIc='';remarkParts.forEach(function(p){if(p.startsWith('IC: '))billingIc=p.replace('IC: ','');});
      return{
        id:o.order_number||o.id.substring(0,8).toUpperCase(),
        fullId:o.id,
        orderNumber:o.order_number||'',
        items:oItems,
        variety:variety,
        qty:totalQty,
        total:o.total,
        // Break the total-discount lump into its parts so the order
        // detail modal can render Voucher and Points on separate lines
        // instead of a single "Discount / Voucher" row.
        couponCode:       o.coupon_code||'',
        couponDiscount:   Number(o.coupon_discount)||0,
        discountAmount:   Number(o.discount_amount)||0,
        discountNote:     o.discount_note||'',
        pointsRedeemed:   Number(o.points_redeemed)||0,
        pointsDiscountRm: Number(o.points_discount_rm)||0,
        // E-Invoice state — nullable timestamps, drive the Request /
        // Countdown / Uploaded UI on the Active Orders card.
        einvoiceRequestedAt: o.einvoice_requested_at || null,
        einvoiceUploadedAt:  o.einvoice_uploaded_at  || null,
        einvoiceUrl:         o.einvoice_url  || '',
        einvoiceName:        o.einvoice_name || '',
        createdAt:           o.created_at || null,
        // Prefer the type the customer actually picked at checkout
        // (persisted via order_billing_type.sql). Fall back to the old
        // heuristic only for historical rows placed before that column
        // existed — that heuristic misclassifies personal-with-TIN as
        // company, which is exactly the bug billing_type fixes.
        billingType:         (o.billing_type==='company'||o.billing_type==='personal')
                              ? o.billing_type
                              : ((o.billing_name && o.billing_tax_id) ? 'company' : 'personal'),
        orderDate:orderDate,
        collDate:o.collection_date||'TBC',
        completedDate:o.completed_at?o.completed_at.substring(0,10):null,
        status:o.status,
        collectionStatus:(o.status==='Completed'||o.status==='Order Completed')?'Collected':(o.status==='Cancelled'?'—':o.status==='Refunded'?'Refunded':'Pending Collection'),
        billingName:o.billing_name||o.customer_name||'—',
        billingTin:o.billing_tax_id||'',
        billingAddr:billingAddr,
        billingIc:billingIc,
        contactPhone:phone,
        email:o.customer_email||'',
        customerRemark:userRemark,
        sellerNote:o.seller_note||'',
        paymentMethod:o.customer_remark&&o.customer_remark.includes('Payment: offline')?'Offline Payment Method':'Online Payment Method',
        dos:dosByAL[o.order_number]||[],
        attachments:attachmentsByOrder[o.id]||[],
        timeline:timelinesByOrder[o.id]||[],
        bookings:bookingsByOrderNum[o.order_number]||[]
      };
    });
  }

  function pShowOrderView(view,btn){
    document.querySelectorAll('#page-portal .portal-tab').forEach(function(b){b.classList.remove('active');});
    if(btn)btn.classList.add('active');
    document.getElementById('pp-orders').style.display=view==='active'?'block':'none';
    document.getElementById('pp-history').style.display=view==='history'?'block':'none';
    document.getElementById('pp-profile').style.display=view==='profile'?'block':'none';
    sessionStorage.setItem('mjm_portal_tab',view);
  }

  function showPortalToast(msg){
    var t=document.getElementById('portal-toast');t.textContent=msg;t.style.opacity='1';t.style.transform='translateX(-50%) translateY(0)';
    setTimeout(function(){t.style.opacity='0';t.style.transform='translateX(-50%) translateY(80px)';},3000);
  }

  // Orders (active only — left side)
  function pRenderOrders(){
    // Final safety net: if the input still contains autofilled noise (the user's
    // email, or whitespace from a paste), treat it as no filter at all. Browser
    // autofill into a "search by order #" box is virtually always wrong.
    var q=(document.getElementById('pp-order-search').value||'').trim().toLowerCase();
    if(q.indexOf('@')>=0) q='';
    var recent=P_ORDERS.filter(function(o){return !pIsOrderDone(o);});
    if(q)recent=recent.filter(function(o){return pOrderMatchSearch(o,q);});
    var html='';
    if(recent.length){recent.forEach(function(o){html+=pOrderCard(o);});}
    else if(q){html='<div class="p-card" style="text-align:center;padding:1.5rem;font-size:13px;color:var(--text-light);">No matching orders found.</div>';}
    else{html='<div class="p-card" style="text-align:center;padding:2.5rem 1.5rem;"><div style="font-size:2rem;margin-bottom:.6rem;">📦</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:1.1rem;color:var(--text-dark);margin-bottom:.4rem;">No Active Orders</div><div style="font-size:12px;color:var(--text-light);line-height:1.5;">You don\'t have any active orders at the moment.<br>Browse our shop to place your first order.</div><button onclick="showPage(\'home\')" class="p-btn" style="margin-top:1rem;">Browse Shop</button></div>';}
    document.getElementById('pp-orders').innerHTML=html;
    pStartEInvoiceCountdowns();
  }

  // History (left side — separate panel)
  function pRenderHistory(){
    // Final safety net: if the input still contains autofilled noise (the user's
    // email, or whitespace from a paste), treat it as no filter at all. Browser
    // autofill into a "search by order #" box is virtually always wrong.
    var q=(document.getElementById('pp-order-search').value||'').trim().toLowerCase();
    if(q.indexOf('@')>=0) q='';
    var hist=P_ORDERS.filter(pIsOrderDone);
    if(q)hist=hist.filter(function(o){return pOrderMatchSearch(o,q);});
    var html='';
    if(hist.length){hist.forEach(function(o){html+=pOrderCard(o);});}
    else if(q){html='<div class="p-card" style="text-align:center;padding:1.5rem;font-size:13px;color:var(--text-light);">No matching orders found.</div>';}
    else{html='<div class="p-card" style="text-align:center;padding:2.5rem 1.5rem;"><div style="font-size:2rem;margin-bottom:.6rem;">📋</div><div style="font-family:\'Cormorant Garamond\',serif;font-size:1.1rem;color:var(--text-dark);margin-bottom:.4rem;">No Order History</div><div style="font-size:12px;color:var(--text-light);line-height:1.5;">Your completed orders will appear here.</div></div>';}
    document.getElementById('pp-history').innerHTML=html;
    pStartEInvoiceCountdowns();
  }

  function pOrderMatchSearch(o,q){
    return o.id.toLowerCase().includes(q)||
      (o.orderNumber||'').toLowerCase().includes(q)||
      o.billingName.toLowerCase().includes(q)||
      o.variety.toLowerCase().includes(q)||
      o.status.toLowerCase().includes(q);
  }

  function pFilterOrders(){
    pRenderOrders();
    pRenderHistory();
  }

  function pOrderCard(o){
    var isComp=o.status==='Completed' || o.status==='Order Completed';
    var isPending=o.status==='Pending Payment';

    // Items list — handle multiple items
    var itemsHtml='';
    if(o.items&&o.items.length){
      o.items.forEach(function(it){
        itemsHtml+='<div style="display:flex;justify-content:space-between;align-items:center;padding:.25rem 0;font-size:12px;border-bottom:1px solid #f5f5f0;">'+
          '<span style="color:var(--text-dark);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(stripMonth(it.product_name))+'</span>'+
          '<span style="color:var(--text-mid);white-space:nowrap;margin-left:.5rem;">x '+it.quantity.toLocaleString()+'</span>'+
        '</div>';
      });
    } else {
      itemsHtml='<div style="font-size:12px;color:var(--text-mid);">'+esc(o.variety)+'</div>';
    }

    // Action button — fullId / id are UUIDs but escape defensively for the JS
    // string literals (single-quote injection would break out of the onclick).
    var fullIdJs = String(o.fullId || '').replace(/[\\'"<>]/g, '');
    var idJs     = String(o.id     || '').replace(/[\\'"<>]/g, '');
    var actionHtml='';
    if(isPending){
      actionHtml='<button class="p-btn" style="background:var(--gold);color:var(--green-dark);font-size:11px;padding:.4rem .8rem;" onclick="event.stopPropagation();goPayOrder(\''+fullIdJs+'\','+o.total+')">Pay Now / Upload Payment</button>';
    } else if(isComp){
      actionHtml=pRatings[o.id]?'<span style="font-size:11px;color:var(--gold);">'+('⭐'.repeat(pRatings[o.id]))+' Reviewed</span>':'<button class="p-btn" onclick="event.stopPropagation();pOpenRating(\''+idJs+'\')">⭐ Review</button>';
    }

    return '<div class="p-order" style="cursor:pointer;" onclick="openOrderDetail(\''+idJs+'\')">'+
      '<div class="p-order-head">'+
        '<div><div class="p-order-id">#'+esc(o.id)+'</div><div class="p-order-date">Ordered '+esc(o.orderDate)+'</div></div>'+
        '<span class="p-badge '+pBadge(o.status)+'">'+esc(o.status)+'</span>'+
      '</div>'+
      '<div class="p-order-body">'+
        '<div class="p-order-row"><span class="p-order-row-l">Bill To</span><span class="p-order-row-v">'+esc(o.billingName)+'</span></div>'+
        '<div style="padding:.4rem 0;"><div style="font-size:10px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.3rem;">Items</div>'+itemsHtml+'</div>'+
        '<div class="p-order-row"><span class="p-order-row-l">Collection</span><span class="p-order-row-v">'+esc(o.collectionStatus)+'</span></div>'+
      '</div>'+
      // DOs section
      (o.dos&&o.dos.length?
        '<div style="padding:.6rem .8rem;border-top:1px solid #f0f0ec;background:#fafff8;">'+
          '<div style="font-size:10px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.4rem;">Delivery Orders</div>'+
          o.dos.map(function(d){
            var doDate=d.delivery_date?new Date(d.delivery_date).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'}):'—';
            var doStatusCls=d.status==='Delivered'?'color:#15803d;':'color:var(--gold);';
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.25rem 0;font-size:12px;border-bottom:1px solid #f0f5ec;">'+
              '<div><span style="font-weight:600;">DO #'+esc(d.do_number||'—')+'</span><span style="color:var(--text-light);margin-left:.5rem;">'+doDate+'</span></div>'+
              '<div><span style="margin-right:.5rem;">Qty: '+(parseInt(d.total_qty)||0)+'</span><span style="font-weight:600;'+doStatusCls+'">'+esc(d.status)+'</span></div>'+
            '</div>';
          }).join('')+
        '</div>':'')+
      // Documents listed only inside the per-order modal (under
      // "Attached Documents"), not inline on the row — keeps the order
      // list visually tight. Clicking the row opens the modal where
      // the customer gets the full categorised view + a "View" button
      // per file.
      // E-Invoice strip — shown only for personal orders under RM10k
      // (company / high-value orders auto-invoice per policy). One of
      // three states: not-requested-yet + countdown, already requested,
      // or uploaded (with a view link).
      pEInvoiceStrip(o) +
      '<div class="p-order-foot">'+
        '<div class="p-order-total">RM '+o.total.toLocaleString('en-MY',{minimumFractionDigits:2})+'</div>'+
        '<div style="display:flex;gap:.4rem;align-items:center;">'+actionHtml+'</div>'+
      '</div>'+
    '</div>';
  }

  // Renders the per-order E-Invoice strip. Every order gets a strip so
  // customers see the E-Invoice status at a glance — company orders and
  // orders ≥RM10k show an "auto-generated" confirmation; personal
  // orders under RM10k get the manual Request E-Invoice button + 5-day
  // countdown.
  function pEInvoiceStrip(o){
    if(!o.createdAt) return '';
    var HIGH_VALUE = 10000;
    var isCompany  = (o.billingType === 'company');
    var isHighVal  = (Number(o.total)||0) >= HIGH_VALUE;
    var isCancelled= (o.status === 'Cancelled' || o.status === 'Refunded');
    var idJs = String(o.fullId || o.id || '').replace(/[\\'"<>]/g,'');

    // Uploaded state — clickable link to the E-Invoice PDF.
    if(o.einvoiceUploadedAt && o.einvoiceUrl){
      return '<div style="padding:.55rem .8rem;border-top:1px solid #f0f0ec;background:#ecfdf5;display:flex;justify-content:space-between;align-items:center;font-size:12px;">'+
               '<div><strong style="color:#15803d;">✓ E-Invoice issued</strong><span style="color:var(--text-light);margin-left:.4rem;">'+esc(o.einvoiceName||'invoice.pdf')+'</span></div>'+
               '<a href="'+esc(o.einvoiceUrl)+'" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="color:#15803d;font-weight:600;text-decoration:underline;">View E-Invoice</a>'+
             '</div>';
    }
    // Cancelled / refunded — E-Invoice can't be requested. Show a
    // greyed-out disabled button so customers know the option existed
    // but is no longer available for this order.
    if(isCancelled){
      return '<div style="padding:.55rem .8rem;border-top:1px solid #f0f0ec;background:#f5f5f4;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-light);gap:.5rem;flex-wrap:wrap;">'+
               '<div>E-Invoice not available — order '+esc(String(o.status||'').toLowerCase())+'.</div>'+
               '<button disabled style="background:#e5e7eb;color:#9ca3af;border:none;border-radius:8px;font-size:11px;padding:.4rem .8rem;cursor:not-allowed;">Request E-Invoice</button>'+
             '</div>';
    }
    // Company OR ≥RM10k — auto-generated per policy. Positive
    // confirmation instead of hiding the strip so customers know it's
    // handled without a button click. Wording lifted verbatim from
    // the ops spec (Case 2 of the E-Invoice Request Logic).
    if(isCompany || isHighVal){
      var reason = isCompany ? 'for company / corporate orders' : 'order value ≥ RM 10,000';
      return '<div style="padding:.55rem .8rem;border-top:1px solid #f0f0ec;background:#eff6ff;font-size:12px;color:#1e40af;line-height:1.5;">'+
               '<div>✓ <strong>E-Invoice will be prepared and submitted to LHDN</strong> ('+reason+').</div>'+
               '<div style="color:#3b6bd6;font-size:11px;margin-top:.15rem;">Click on the order to view your E-Invoice once ready.</div>'+
             '</div>';
    }
    // Requested but not uploaded yet.
    if(o.einvoiceRequestedAt){
      return '<div style="padding:.55rem .8rem;border-top:1px solid #f0f0ec;background:#fef3c7;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#78350f;">'+
               '<div>⏳ <strong>E-Invoice requested</strong> — Verifying &amp; Processing</div>'+
             '</div>';
    }
    // Personal < RM10k, no request yet — show button + live D:H:M:S
    // countdown. Deadline is stamped as a data attribute so
    // pStartEInvoiceCountdowns() can tick every element once a second
    // without re-rendering the whole order card.
    var ordered = new Date(o.createdAt).getTime();
    var deadline = ordered + 5*24*60*60*1000;
    var msLeft = deadline - Date.now();
    if(msLeft <= 0){
      return '<div style="padding:.55rem .8rem;border-top:1px solid #f0f0ec;background:#f5f5f4;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-light);">'+
               '<div>E-Invoice request window closed (5 days expired).</div>'+
               '<button disabled style="background:#e5e7eb;color:#9ca3af;border:none;border-radius:8px;font-size:11px;padding:.4rem .8rem;cursor:not-allowed;">Request E-Invoice</button>'+
             '</div>';
    }
    // Countdown chip styling — compact black/dark background with
    // orange digit-labels, echoing the flip-clock look ops asked for.
    var chip = 'display:inline-flex;flex-direction:column;align-items:center;justify-content:center;background:#1f1d1a;color:#fff;border-radius:6px;padding:.25rem .45rem;min-width:38px;line-height:1;box-shadow:inset 0 -2px 0 rgba(0,0,0,.35);';
    var lab  = 'font-size:8px;color:#f59e0b;text-transform:uppercase;letter-spacing:.06em;margin-top:2px;font-weight:600;';
    var num  = 'font-family:\'SFMono-Regular\',Consolas,monospace;font-size:14px;font-weight:700;letter-spacing:.03em;';
    return '<div style="padding:.55rem .8rem;border-top:1px solid #f0f0ec;background:#fffbeb;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#78350f;gap:.6rem;flex-wrap:wrap;">'+
             '<div style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;">'+
               '<div><strong>Need an E-Invoice?</strong><div style="font-size:10px;color:#9a3412;margin-top:2px;">Request window closes in</div></div>'+
               '<div class="einv-countdown" data-einv-deadline="'+deadline+'" style="display:flex;gap:.25rem;align-items:center;">'+
                 '<div style="'+chip+'"><span style="'+num+'" data-slot="d">--</span><span style="'+lab+'">Days</span></div>'+
                 '<span style="color:#9a3412;font-weight:700;">:</span>'+
                 '<div style="'+chip+'"><span style="'+num+'" data-slot="h">--</span><span style="'+lab+'">Hrs</span></div>'+
                 '<span style="color:#9a3412;font-weight:700;">:</span>'+
                 '<div style="'+chip+'"><span style="'+num+'" data-slot="m">--</span><span style="'+lab+'">Min</span></div>'+
                 '<span style="color:#9a3412;font-weight:700;">:</span>'+
                 '<div style="'+chip+'"><span style="'+num+'" data-slot="s">--</span><span style="'+lab+'">Sec</span></div>'+
               '</div>'+
             '</div>'+
             '<button onclick="event.stopPropagation();pRequestEInvoice(\''+idJs+'\')" class="p-btn" style="background:var(--green-dark);color:#fff;font-size:11px;padding:.4rem .8rem;">Request E-Invoice</button>'+
           '</div>';
  }

  // One global 1-Hz tick refreshes every visible countdown chip so
  // hundreds of orders on-screen cost one interval, not one-per-card.
  // If the deadline lapses mid-tick, the whole strip re-renders (via
  // pRenderOrders/pRenderHistory) so the button flips to the disabled
  // "window closed" state without a page reload.
  var _P_EINV_TIMER = null;
  function pStartEInvoiceCountdowns(){
    if(_P_EINV_TIMER) return;   // idempotent — pRender* fires it every render
    _P_EINV_TIMER = setInterval(function(){
      var nodes = document.querySelectorAll('.einv-countdown[data-einv-deadline]');
      if(!nodes.length) return;
      var now = Date.now();
      var flippedAny = false;
      nodes.forEach(function(el){
        var deadline = Number(el.getAttribute('data-einv-deadline'))||0;
        var ms = deadline - now;
        if(ms <= 0){ flippedAny = true; return; }
        var days = Math.floor(ms / 86400000);
        var hrs  = Math.floor((ms % 86400000) / 3600000);
        var mins = Math.floor((ms % 3600000) / 60000);
        var secs = Math.floor((ms % 60000) / 1000);
        var pad  = function(n){ return (n<10?'0':'')+n; };
        var slots = { d:pad(days), h:pad(hrs), m:pad(mins), s:pad(secs) };
        el.querySelectorAll('[data-slot]').forEach(function(sp){
          var k = sp.getAttribute('data-slot');
          if(slots[k] != null && sp.textContent !== slots[k]) sp.textContent = slots[k];
        });
      });
      if(flippedAny){
        try{ pRenderOrders(); pRenderHistory(); }catch(_){}
      }
    }, 1000);
  }

  async function pRequestEInvoice(orderId){
    if(!confirm('Request an official LHDN-compliant E-Invoice for this order?\n\nMake sure your billing details (TIN, IC / Registration No., contact) are complete and accurate.')) return;
    try{
      var res = await _sb.rpc('request_einvoice', { p_order_id: orderId });
      if(res && res.error){
        showPortalToast(res.error.message || 'Could not submit request');
        return;
      }
      showPortalToast('✓ E-Invoice request submitted — accounts will process shortly.');
      try{ await loadCustomerOrders(); pRenderOrders(); pRenderHistory(); }catch(_){}
    }catch(e){
      showPortalToast('Request failed: ' + (e.message || e));
    }
  }
  window.pRequestEInvoice = pRequestEInvoice;

  function goPayOrder(orderId,total){
    sessionStorage.setItem('mjm_pay_order_id',orderId);
    sessionStorage.setItem('mjm_pay_order_total',total);
    window.location.href='payment-proof.html';
  }

  function _odLabel(label,val){return'<div style="color:var(--text-light);font-size:11px;">'+label+'</div><div style="font-weight:600;font-size:12px;">'+esc(val||'—')+'</div>';}
  function _odSection(title){return'<div style="font-size:10px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.06em;margin:1rem 0 .5rem;padding-bottom:.3rem;border-bottom:1px solid var(--green-pale);">'+title+'</div>';}

  // Cached portal-wide settings — booking URL for the collection CTA in the
  // timeline, and bank details printed on the downloadable copy of any
  // Pending-Payment order. Both come from salesweb_app_settings.
  var P_BOOKING_URL='https://collect.mjmnursery.com/';
  var P_PAY_DETAILS={bank_name:'',account_name:'',account_number:'',duitnow_qr_url:''};
  async function loadPortalSettings(){
    if(!_sb)return;
    try{
      var{data:notif}=await _sb.from('salesweb_app_settings').select('value').eq('key','notification_config').maybeSingle();
      if(notif&&notif.value){
        var nv=typeof notif.value==='string'?JSON.parse(notif.value):notif.value;
        if(nv&&nv.booking_url)P_BOOKING_URL=nv.booking_url;
      }
    }catch(e){/* keep default */}
    try{
      var{data:pay}=await _sb.from('salesweb_app_settings').select('value').eq('key','payment_details').maybeSingle();
      if(pay&&pay.value){
        var pv=typeof pay.value==='string'?JSON.parse(pay.value):pay.value;
        if(pv)P_PAY_DETAILS={...P_PAY_DETAILS,...pv};
      }
    }catch(e){/* keep default */}
  }

  // ── Collection-booking edit / share ────────────────────────────────
  // Capacity model — kept in sync with collect.mjmnursery.com so the
  // inline edit on My Account validates the same way the full booking
  // calendar does. If you change RATE / MAX_LOAD here, also update them
  // in CollectionTimeBooking/index.html (~line 295). HRS_WD / HRS_SAT
  // must match getHoursFor() there.
  var _BE_RATE = 350;
  var _BE_MAX_LOAD = 600;
  var _BE_HRS_WD  = [8,9,10,11,12,13,14,15,16];
  var _BE_HRS_SAT = [8,9,10,11];
  var _BE_HOLIDAYS = {'2026-01-01':'New Year','2026-01-14':'Nuzul Al-Quran','2026-01-29':'Thaipusam','2026-02-01':'FT Day','2026-02-17':'CNY','2026-02-18':'CNY','2026-03-28':'Hari Raya Aidilfitri','2026-03-29':'Hari Raya Aidilfitri','2026-05-01':'Labour Day','2026-05-11':'Vesak Day','2026-06-01':'Agong Birthday','2026-06-04':'Hari Raya Haji','2026-06-05':'Hari Raya Haji','2026-06-25':'Awal Muharram','2026-08-31':'Merdeka Day','2026-09-03':'Maulidur Rasul','2026-09-16':'Malaysia Day','2026-10-20':'Deepavali','2026-12-25':'Christmas'};

  // Lazy-loaded caches scoped to the edit modal:
  //   _BE_OVERRIDES        — full shared_date_overrides table keyed by
  //                          date_str. Loaded once per session.
  //   _BE_BOOKINGS_BY_DATE — { 'YYYY-MM-DD': [rows] } loaded per date
  //                          when the customer picks a date in the
  //                          calendar.
  //   pBeSelectedDate      — 'YYYY-MM-DD' string of the currently-
  //                          picked calendar cell. Replaces the old
  //                          <input type=date>.
  //   pBeCalMonth / Year   — month being shown in the calendar grid.
  var _BE_OVERRIDES = null;
  var _BE_BOOKINGS_BY_DATE = {};
  var pBeSelectedDate = '';
  var pBeCalMonth = 0;
  var pBeCalYear = 2026;

  function _beHrsNeeded(q){ return Math.max(1, Math.ceil((Number(q)||0)/_BE_RATE)); }
  function _beHrLoad(q){ var qn=Number(q)||0; return qn/_beHrsNeeded(qn); }
  function _beFmtHour(h){
    if(h===0) return '12 AM';
    if(h<12) return h+' AM';
    if(h===12) return '12 PM';
    return (h-12)+' PM';
  }
  function _beIsDateClosed(ds){
    var ovr=_BE_OVERRIDES&&_BE_OVERRIDES[ds];
    if(ovr) return !ovr.is_open;
    var d=new Date(ds+'T00:00:00');
    return d.getDay()===0 || !!_BE_HOLIDAYS[ds];
  }
  function _beIsAdminFullyBooked(ds){
    var ovr=_BE_OVERRIDES&&_BE_OVERRIDES[ds];
    return !!(ovr && ovr.is_open && ovr.is_fully_booked);
  }
  function _beHoursFor(ds){
    var ovr=_BE_OVERRIDES&&_BE_OVERRIDES[ds];
    if(ovr){
      if(!ovr.is_open) return [];
      var arr=[]; for(var h=ovr.open_hour;h<ovr.close_hour;h++) arr.push(h);
      return arr;
    }
    var d=new Date(ds+'T00:00:00'),dow=d.getDay();
    if(dow===0||_BE_HOLIDAYS[ds]) return [];
    return dow===6?_BE_HRS_SAT:_BE_HRS_WD;
  }
  function _beClosing(ds){
    var ovr=_BE_OVERRIDES&&_BE_OVERRIDES[ds];
    if(ovr && ovr.is_open && ovr.close_hour) return ovr.close_hour;
    return new Date(ds+'T00:00:00').getDay()===6?12:17;
  }
  function _beHourLoad(ds, h, excludeId){
    var bks=_BE_BOOKINGS_BY_DATE[ds]||[];
    var total=0;
    bks.forEach(function(b){
      if(excludeId && b.id===excludeId) return;
      if(String(b.status||'').toLowerCase()==='cancelled') return;
      var s=parseInt(String(b.start_time||'00').split(':')[0],10);
      var e=parseInt(String(b.end_time||'00').split(':')[0],10);
      if(e<=s) e=s+1;
      if(h>=s && h<e) total += _beHrLoad(b.collection_qty||0);
    });
    return total;
  }
  function _beCanFit(ds, startH, qty, excludeId){
    var cl=_beClosing(ds);
    var hrs=_beHrsNeeded(qty), endH=startH+hrs;
    if(endH>cl) return false;
    var ld=_beHrLoad(qty);
    for(var h=startH; h<endH; h++){
      if(_beHourLoad(ds, h, excludeId) + ld > _BE_MAX_LOAD) return false;
    }
    return true;
  }
  async function _beFetchOverrides(){
    if(_BE_OVERRIDES) return _BE_OVERRIDES;
    _BE_OVERRIDES={};
    try{
      var{data}=await _sb.from('shared_date_overrides').select('*');
      (data||[]).forEach(function(o){ _BE_OVERRIDES[o.date_str]=o; });
    }catch(e){ console.warn('overrides fetch failed:',e); }
    return _BE_OVERRIDES;
  }
  async function _beFetchBookingsForDate(ds){
    // Always refetch on date change — bookings on a busy day can move
    // fast, and the customer would otherwise edit against a stale
    // capacity snapshot from a few minutes ago.
    try{
      var{data}=await _sb.from('shared_collection_bookings')
        .select('id,booking_date,start_time,end_time,collection_qty,status')
        .eq('booking_date', ds)
        .neq('status','cancelled');
      _BE_BOOKINGS_BY_DATE[ds]=data||[];
    }catch(e){
      console.warn('bookings fetch failed:',e);
      _BE_BOOKINGS_BY_DATE[ds]=[];
    }
    return _BE_BOOKINGS_BY_DATE[ds];
  }

  // ── Calendar ─────────────────────────────────────────────────────
  // Render the month grid for the edit-booking modal. Same visual
  // shape as the booking-site month grid but stripped down to "what
  // the customer needs to know about THEIR booking": their own
  // booking dates ringed, closed / holiday / admin-full days
  // disabled. Other customers' booking details never render here.
  function _beFmtDate(d){
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function _beIsPastDate(ds){
    var t=new Date(); t.setHours(0,0,0,0);
    return new Date(ds+'T00:00:00') < t;
  }
  // All non-cancelled bookings belonging to the signed-in customer,
  // across every one of their orders, keyed by date. The full booking
  // row is kept so the calendar cell can show time + qty inline ("8A ·
  // 100") — this is the customer's own data, never anybody else's.
  function _beMyBookingsByDate(){
    var map={};
    (P_ORDERS||[]).forEach(function(o){
      (o.bookings||[]).forEach(function(b){
        if(b.booking_date && String(b.status||'').toLowerCase()!=='cancelled'){
          map[b.booking_date]=b;
        }
      });
    });
    return map;
  }
  async function pBeRenderCalendar(){
    if(!P_EDIT_BOOKING) return;
    await _beFetchOverrides();
    var grid=document.getElementById('p-be-cal-grid');
    var label=document.getElementById('p-be-cal-label');
    var MNAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
    label.textContent = MNAMES[pBeCalMonth] + ' ' + pBeCalYear;
    // Cap prev-nav at the current month — there's no use case for
    // editing a booking into the past, and the calendar would just
    // render every day as greyed-out anyway.
    var now=new Date();
    var prevBtn=document.getElementById('p-be-prev');
    prevBtn.disabled = (pBeCalYear < now.getFullYear()) ||
                       (pBeCalYear === now.getFullYear() && pBeCalMonth <= now.getMonth());

    var firstDay=new Date(pBeCalYear, pBeCalMonth, 1);
    // Week starts Monday — matches the booking site.
    var startDow=firstDay.getDay(); if(startDow===0) startDow=7;
    var cd=new Date(firstDay); cd.setDate(cd.getDate()-(startDow-1));

    var myBookings=_beMyBookingsByDate();
    var todayStr=_beFmtDate(new Date());

    var html='';
    ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(function(d){
      html += '<div class="p-be-cal-dow">'+d+'</div>';
    });
    for(var r=0;r<6;r++){
      var has=false;
      for(var c=0;c<7;c++){
        var isThisMonth=cd.getMonth()===pBeCalMonth;
        var ds=_beFmtDate(cd);
        if(isThisMonth) has=true;
        var classes=['p-be-cal-cell'];
        var tag='';
        var clickable=false;
        if(!isThisMonth){
          classes.push('other-month');
        } else if(_beIsPastDate(ds)){
          classes.push('past','disabled');
        } else if(_beIsDateClosed(ds)){
          classes.push('closed','disabled');
          // Differentiate Sunday vs holiday vs admin-closed for the
          // little tag under the day number.
          var ovr=_BE_OVERRIDES && _BE_OVERRIDES[ds];
          if(ovr && !ovr.is_open) tag='Closed';
          else if(_BE_HOLIDAYS[ds]) tag='Holiday';
          else tag='Sun';
        } else if(_beIsAdminFullyBooked(ds)){
          classes.push('full','disabled');
          tag='Full';
        } else {
          clickable=true;
        }
        if(ds===todayStr) classes.push('today');
        var myB=myBookings[ds]||null;
        if(myB) classes.push('my-booking');
        if(ds===pBeSelectedDate) classes.push('selected');
        // Cell content: day number on top. For the customer's own
        // booked dates, also show start-hour + qty so they can see at
        // a glance what they booked without opening the time / qty
        // inputs. Closed/holiday tag wins on the second line when
        // both apply (rare: an override could open a Sunday they have
        // a booking on — show the closed reason).
        var lineTwo='';
        if(tag) lineTwo='<span class="tag">'+tag+'</span>';
        else if(myB){
          // Customer's own booking on this date — show a big BOOKED
          // label + the start hour in plain AM/PM format. Quantity
          // stays out of the cell to keep it scannable; clicking the
          // cell loads it into the qty input below the calendar.
          var startH=parseInt(String(myB.start_time||'00').split(':')[0],10);
          lineTwo='<span class="booked-label">Booked</span>'+
                  '<span class="booked-time">'+_beFmtHour(startH)+'</span>';
        }
        var safeDs=ds.replace(/[\\'"<>]/g,'');
        var click = clickable ? ' onclick="pBeSelectDate(\''+safeDs+'\')"' : '';
        // The .selected ::before would have been a cleaner spot for
        // the "SELECTED" word, but stacking pseudo-elements on a
        // flex parent gets squirrelly across browsers. Render it as
        // a real <span> always-present and let the CSS show it only
        // when the cell carries the .selected class.
        html += '<div class="'+classes.join(' ')+'"'+click+'>'+
                  '<span>'+cd.getDate()+'</span>'+
                  lineTwo+
                  '<span class="sel-label">Selected</span>'+
                '</div>';
        cd.setDate(cd.getDate()+1);
      }
      if(!has && r>4) break;
    }
    grid.innerHTML=html;
  }
  function pBePrevMonth(){
    pBeCalMonth--;
    if(pBeCalMonth<0){ pBeCalMonth=11; pBeCalYear--; }
    pBeRenderCalendar();
  }
  function pBeNextMonth(){
    pBeCalMonth++;
    if(pBeCalMonth>11){ pBeCalMonth=0; pBeCalYear++; }
    pBeRenderCalendar();
  }
  async function pBeSelectDate(ds){
    if(_beIsPastDate(ds) || _beIsDateClosed(ds) || _beIsAdminFullyBooked(ds)) return;
    pBeSelectedDate = ds;
    // Re-render so the green Selected highlight moves to the new
    // cell, then run the live availability check for the new date.
    await pBeRenderCalendar();
    var dateLabel = new Date(ds+'T00:00:00').toLocaleDateString('en-MY',
      {weekday:'long',day:'2-digit',month:'short',year:'numeric'});
    var pill=document.getElementById('p-be-selected-pill');
    pill.style.display='block';
    pill.textContent='Selected: '+dateLabel;
    await pBeRefreshSlots();
  }

  // Refresh the time-slot dropdown using the live capacity model.
  // Disabled options are kept (greyed out + "— Full") instead of being
  // removed so the customer can see WHY a slot they expected isn't
  // available. Save button enables only when there's at least one
  // pickable slot at the requested qty.
  async function pBeRefreshSlots(){
    if(!P_EDIT_BOOKING) return;
    var ds=pBeSelectedDate;
    if(!ds) return;
    var sel=document.getElementById('p-be-time');
    var avail=document.getElementById('p-be-avail');
    var saveBtn=document.getElementById('p-be-save');
    avail.textContent='Checking availability…';
    avail.style.color='var(--text-light)';
    await _beFetchOverrides();
    await _beFetchBookingsForDate(ds);
    var prev=sel.value;
    // Hide the estimate panel on every early-out so the customer
    // doesn't see a leftover estimate from a previous date when the
    // newly-picked date is closed / fully booked / has no slots.
    var estBox=document.getElementById('p-be-est');
    if(_beIsDateClosed(ds)){
      sel.innerHTML='<option value="">Closed</option>';
      sel.disabled=true;
      avail.textContent='❌ Closed on this date';
      avail.style.color='#dc2626';
      saveBtn.disabled=true;
      estBox.style.display='none';
      return;
    }
    if(_beIsAdminFullyBooked(ds)){
      sel.innerHTML='<option value="">Fully booked</option>';
      sel.disabled=true;
      avail.textContent='❌ Fully booked';
      avail.style.color='#dc2626';
      saveBtn.disabled=true;
      estBox.style.display='none';
      return;
    }
    var hours=_beHoursFor(ds);
    if(!hours.length){
      sel.innerHTML='<option value="">No slots</option>';
      sel.disabled=true;
      avail.textContent='❌ No bookable hours';
      avail.style.color='#dc2626';
      saveBtn.disabled=true;
      estBox.style.display='none';
      return;
    }
    var qty=parseInt(document.getElementById('p-be-qty').value,10)||1;
    var excludeId=P_EDIT_BOOKING.booking.id;
    sel.innerHTML='';
    var anyOpen=false;
    hours.forEach(function(h){
      var hh=String(h).padStart(2,'0')+':00';
      var fits=_beCanFit(ds, h, qty, excludeId);
      var opt=document.createElement('option');
      opt.value=hh;
      opt.textContent=_beFmtHour(h)+(fits?'':' — Full');
      if(!fits) opt.disabled=true; else anyOpen=true;
      sel.appendChild(opt);
    });
    sel.disabled=false;
    // Restore the customer's previous choice if it's still bookable;
    // otherwise auto-pick the first available slot.
    var restored=false;
    for(var i=0;i<sel.options.length;i++){
      if(sel.options[i].value===prev && !sel.options[i].disabled){ sel.value=prev; restored=true; break; }
    }
    if(!restored){
      for(var j=0;j<sel.options.length;j++){
        if(!sel.options[j].disabled){ sel.value=sel.options[j].value; break; }
      }
    }
    if(!anyOpen){
      avail.textContent='❌ Not available';
      avail.style.color='#dc2626';
      saveBtn.disabled=true;
    } else {
      avail.textContent='✅ Available';
      avail.style.color='var(--green-mid)';
      saveBtn.disabled=false;
    }
    _bePaintEstimate(ds, qty);
  }

  // Render the "Estimated Collection Time" panel under the form —
  // same shape and wording as the live one on
  // collect.mjmnursery.com so the customer sees a familiar at-a-glance
  // summary of what they're booking. Hidden when there's nothing
  // meaningful to show (no date / qty / time picked yet, or the
  // selected slot is disabled).
  function _bePaintEstimate(ds, qty){
    var box=document.getElementById('p-be-est');
    var sel=document.getElementById('p-be-time');
    var st=sel && sel.value;
    if(!st || !qty || sel.disabled || (sel.selectedOptions[0] && sel.selectedOptions[0].disabled)){
      box.style.display='none';
      return;
    }
    var startH=parseInt(st.split(':')[0],10);
    var hrs=_beHrsNeeded(qty);
    var endH=startH+hrs;
    document.getElementById('p-be-est-hrs').textContent = hrs + ' hour' + (hrs>1?'s':'');
    document.getElementById('p-be-est-range').textContent = _beFmtHour(startH) + ' to ' + _beFmtHour(endH);
    document.getElementById('p-be-est-desc').textContent =
      'Your selected quantity of ' + qty.toLocaleString() + ' seedlings will take approximately ' +
      hrs + ' hour' + (hrs>1?'s':'') + ' to prepare and load.';
    box.style.display='block';
  }

  // Open the inline edit modal for a booking. The modal lets the
  // customer change date / start time / qty / note and validates the
  // new slot against shared_date_overrides + shared_collection_bookings
  // using the same capacity model as collect.mjmnursery.com.
  var P_EDIT_BOOKING = null;
  async function pEditBooking(bookingId){
    var b = null;
    for(var i=0;i<P_ORDERS.length;i++){
      var bs=P_ORDERS[i].bookings||[];
      for(var j=0;j<bs.length;j++){ if(bs[j].id===bookingId){ b=bs[j]; P_EDIT_BOOKING={booking:b, order:P_ORDERS[i]}; break; } }
      if(b) break;
    }
    if(!b){ showPortalToast('Booking not found'); return; }
    // If the booking is in the past, don't let them open the editor —
    // matches the gating on the Edit button itself but defends against
    // a direct call via console or stale UI.
    if(b.booking_date && _beIsPastDate(b.booking_date)){
      showPortalToast('Past bookings can\'t be edited');
      return;
    }
    document.getElementById('p-be-qty').value  = b.collection_qty || 1;
    document.getElementById('p-be-note').value = b.notes || '';
    var qtyInput=document.getElementById('p-be-qty');
    var qtyHint=document.getElementById('p-be-qty-hint');
    var ord = P_EDIT_BOOKING.order;
    if(ord && Number(ord.qty)>0){
      qtyInput.max = ord.qty;
      qtyHint.textContent = 'Order quantity: '+ord.qty+' seedlings';
    } else {
      qtyInput.removeAttribute('max');
      qtyHint.textContent = '';
    }
    document.getElementById('p-be-booking-no').textContent = '#'+(b.order_number||b.al_number||b.id);
    document.getElementById('p-be-error').style.display='none';
    document.getElementById('p-be-fullcal').href = 'https://collect.mjmnursery.com/';
    document.getElementById('p-be-save').disabled = false;
    document.getElementById('p-be-save').textContent = 'Save Changes';
    // Pre-populate the time dropdown with the saved start_time so it
    // shows during the initial availability fetch; pBeRefreshSlots
    // will replace it with the live list a moment later.
    var sel=document.getElementById('p-be-time');
    sel.innerHTML='<option value="'+(b.start_time||'08:00').substring(0,5)+'">'+(b.start_time||'08:00').substring(0,5)+'</option>';
    sel.value=(b.start_time||'08:00').substring(0,5);
    // Calendar starts on the month of the existing booking (or today
    // if the booking has no date for some reason).
    var seed = b.booking_date ? new Date(b.booking_date+'T00:00:00') : new Date();
    pBeCalMonth = seed.getMonth();
    pBeCalYear  = seed.getFullYear();
    pBeSelectedDate = b.booking_date || '';
    document.getElementById('p-booking-edit-modal').classList.add('open');
    // qty input change still triggers availability re-check (a higher
    // qty might no longer fit the selected slot).
    document.getElementById('p-be-qty').oninput  = pBeRefreshSlots;
    await pBeRenderCalendar();
    if(pBeSelectedDate){
      var dateLabel = new Date(pBeSelectedDate+'T00:00:00').toLocaleDateString('en-MY',
        {weekday:'long',day:'2-digit',month:'short',year:'numeric'});
      var pill=document.getElementById('p-be-selected-pill');
      pill.style.display='block';
      pill.textContent='Selected: '+dateLabel;
      await pBeRefreshSlots();
    } else {
      document.getElementById('p-be-selected-pill').style.display='none';
    }
  }
  function pCloseBookingEdit(){
    document.getElementById('p-booking-edit-modal').classList.remove('open');
    P_EDIT_BOOKING = null;
    pBeSelectedDate = '';
  }
  async function pSaveBookingEdit(){
    if(!P_EDIT_BOOKING){ pCloseBookingEdit(); return; }
    var date = pBeSelectedDate;
    var st   = document.getElementById('p-be-time').value;
    var qty  = parseInt(document.getElementById('p-be-qty').value,10);
    var note = document.getElementById('p-be-note').value.trim();
    var errEl = document.getElementById('p-be-error');
    errEl.style.display='none';
    if(!date){ errEl.textContent='Please pick a date.'; errEl.style.display='block'; return; }
    if(!st){   errEl.textContent='Please pick a start time.'; errEl.style.display='block'; return; }
    if(!(qty>0)){ errEl.textContent='Quantity must be at least 1.'; errEl.style.display='block'; return; }
    var ord = P_EDIT_BOOKING.order;
    if(ord && Number(ord.qty)>0 && qty>Number(ord.qty)){
      errEl.textContent='Quantity cannot exceed your ordered '+ord.qty+' seedlings.';
      errEl.style.display='block';
      return;
    }
    var picked = new Date(date+'T00:00:00');
    var today = new Date(); today.setHours(0,0,0,0);
    if(picked < today){
      errEl.textContent='Please pick today or a future date.';
      errEl.style.display='block';
      return;
    }
    // Final availability re-check at save time — the dropdown blocks
    // disabled options, but a slot could have filled while the modal
    // sat open. Re-fetch the live state and re-validate before writing.
    await _beFetchBookingsForDate(date);
    var startH = parseInt(st.split(':')[0],10);
    if(_beIsDateClosed(date)){ errEl.textContent='That date just became closed. Pick another day.'; errEl.style.display='block'; return; }
    if(_beIsAdminFullyBooked(date)){ errEl.textContent='That date is now fully booked.'; errEl.style.display='block'; return; }
    if(!_beCanFit(date, startH, qty, P_EDIT_BOOKING.booking.id)){
      errEl.textContent='Sorry, that slot just filled up. Pick another time or reduce the quantity.';
      errEl.style.display='block';
      await pBeRefreshSlots();
      return;
    }
    var endH = startH + _beHrsNeeded(qty);
    var et = String(endH).padStart(2,'0')+':00';

    // Confirm the change before writing — date / time / qty edits all
    // affect the nursery's prep schedule, so a "did you mean to change
    // this?" prompt protects against an accidental click. Notes-only
    // edits skip the confirm (low blast radius). Format the before vs
    // after as plain text so it reads cleanly in the browser confirm
    // dialog on every platform.
    var oldB = P_EDIT_BOOKING.booking;
    var dateChanged = (date !== oldB.booking_date);
    var stChanged   = (st   !== (String(oldB.start_time||'').substring(0,5)));
    var qtyChanged  = (qty  !== (Number(oldB.collection_qty)||0));
    if(dateChanged || stChanged || qtyChanged){
      function _fmtForConfirm(d, s, q){
        var dt = d ? new Date(d+'T00:00:00').toLocaleDateString('en-MY',{weekday:'long',day:'2-digit',month:'short',year:'numeric'}) : '—';
        var hr = parseInt(String(s||'00').split(':')[0],10);
        var tt = isNaN(hr) ? (s||'—') : _beFmtHour(hr);
        return dt + '  ·  ' + tt + '  ·  ' + (Number(q)||0).toLocaleString() + ' seedlings';
      }
      var prompt = 'Confirm change to your collection booking?\n\n'+
        'FROM:\n  '+_fmtForConfirm(oldB.booking_date, (oldB.start_time||'').substring(0,5), oldB.collection_qty)+'\n\n'+
        'TO:\n  '+_fmtForConfirm(date, st, qty);
      if(!confirm(prompt)) return;
    }

    var btn = document.getElementById('p-be-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    var{error} = await _sb.from('shared_collection_bookings').update({
      booking_date: date,
      start_time: st,
      end_time: et,
      collection_qty: qty,
      notes: note || null
    }).eq('id', P_EDIT_BOOKING.booking.id);
    if(error){
      btn.disabled=false; btn.textContent='Save Changes';
      errEl.textContent='Could not save: '+error.message;
      errEl.style.display='block';
      return;
    }
    var b = P_EDIT_BOOKING.booking;
    b.booking_date=date; b.start_time=st; b.end_time=et; b.collection_qty=qty; b.notes=note||null;
    showPortalToast('Booking updated');
    pCloseBookingEdit();
    if(ord) openOrderDetail(ord.id);
  }

  // Compose a WhatsApp message with the booking details and open the
  // share sheet. wa.me with no recipient lets the customer pick who to
  // send it to — useful for sharing with family, drivers, etc.
  function pShareBookingWhatsApp(bookingId){
    var b = null;
    var orderRef = '';
    for(var i=0;i<P_ORDERS.length;i++){
      var bs=P_ORDERS[i].bookings||[];
      for(var j=0;j<bs.length;j++){ if(bs[j].id===bookingId){ b=bs[j]; orderRef=P_ORDERS[i].id; break; } }
      if(b) break;
    }
    if(!b){ showPortalToast('Booking not found'); return; }
    var dateStr = b.booking_date ? new Date(b.booking_date+'T00:00:00').toLocaleDateString('en-MY',{weekday:'long',day:'2-digit',month:'short',year:'numeric'}) : 'TBC';
    var st = (b.start_time||'').substring(0,5);
    var et = (b.end_time||'').substring(0,5);
    var lines = [];
    lines.push('Hi! I\'ve booked my seedling collection at MJM Nursery.');
    lines.push('');
    lines.push('📅 ' + dateStr);
    if(st) lines.push('⏰ ' + st + (et ? ' – ' + et : ''));
    lines.push('🌱 Qty: ' + (b.collection_qty||0) + ' seedlings');
    if(orderRef) lines.push('📦 Order #' + orderRef);
    lines.push('');
    lines.push('See you at MJM Nursery!');
    var text = lines.join('\n');
    var url = 'https://wa.me/?text=' + encodeURIComponent(text);
    window.open(url, '_blank', 'noopener');
  }

  // Inline file viewer. Opens in #p-file-viewer-modal so the customer
  // stays inside the portal modal flow — no tab switching, no losing
  // scroll position on the order list. Image / PDF / fallback branches
  // chosen from the file extension first, then content-type as a hint.
  function pViewFile(url, name, type){
    if(!url){return;}
    document.getElementById('p-file-viewer-title').textContent = name || 'File';
    var dl = document.getElementById('p-file-viewer-dl');
    dl.href = url;
    // download attribute is only honoured for same-origin URLs but it
    // doesn't hurt to set it — the link still works as a plain new-tab
    // fallback for cross-origin storage URLs.
    dl.setAttribute('download', name || '');
    var body = document.getElementById('p-file-viewer-body');
    var lowerName = String(name||'').toLowerCase();
    var lowerType = String(type||'').toLowerCase();
    var isImage = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(url)
               || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(lowerName)
               || lowerType.indexOf('image/') === 0;
    var isPdf = /\.pdf(\?|$)/i.test(url)
             || /\.pdf$/i.test(lowerName)
             || lowerType.indexOf('pdf') > -1;
    if(isImage){
      body.innerHTML = '<img src="'+url+'" alt="'+esc(name||'file')+'" style="max-width:100%;max-height:65vh;border-radius:8px;display:block;" onerror="this.outerHTML=\'<div style=&quot;padding:2rem;text-align:center;color:var(--text-mid);font-size:12px;&quot;>Could not preview this file. Use the Download button above.</div>\'">';
    } else if(isPdf){
      body.innerHTML = '<iframe src="'+url+'" style="width:100%;min-height:65vh;border:0;border-radius:8px;background:#fff;"></iframe>';
    } else {
      // Fallback for other formats — Excel, Word, etc. — that the
      // browser can't render inline. Show a friendly note + the
      // existing Download button is right there in the header.
      body.innerHTML = '<div style="padding:2rem;text-align:center;font-size:13px;color:var(--text-mid);line-height:1.6;">'+
        '<div style="font-size:36px;margin-bottom:.5rem;">📄</div>'+
        'This file type can\'t be previewed in the browser.<br>Use <b>Download</b> above to open it on your device.'+
      '</div>';
    }
    document.getElementById('p-file-viewer-modal').classList.add('open');
  }
  function pCloseFileViewer(){
    document.getElementById('p-file-viewer-modal').classList.remove('open');
    // Clear iframe src so a PDF doesn't keep loading in the background
    // (mostly relevant for mobile data plans).
    document.getElementById('p-file-viewer-body').innerHTML = '';
  }

  function openOrderDetail(ordNum){
    var o=P_ORDERS.find(function(x){return x.id===ordNum;});
    if(!o)return;
    var h='';

    // ── Order Info ──
    var idJsDl=String(o.id||'').replace(/[\\'"<>]/g,'');
    h+='<div style="background:var(--cream);border-radius:12px;padding:1rem;margin-bottom:.8rem;">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;"><span style="font-family:\'Cormorant Garamond\',serif;font-size:1.1rem;font-weight:600;">Order #'+o.id+'</span><span class="p-badge '+pBadge(o.status)+'" style="font-size:11px;">'+o.status+'</span></div>';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;gap:.5rem;flex-wrap:wrap;">';
    h+='<div style="font-size:12px;color:var(--text-mid);">'+o.orderDate+'</div>';
    h+='<button onclick="downloadOrder(\''+idJsDl+'\')" style="background:#fff;border:1.5px solid var(--green-pale);color:var(--green-dark);padding:.35rem .75rem;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:.3rem;transition:all .15s;" onmouseover="this.style.background=\'var(--green-dark)\';this.style.color=\'#fff\';this.style.borderColor=\'var(--green-dark)\';" onmouseout="this.style.background=\'#fff\';this.style.color=\'var(--green-dark)\';this.style.borderColor=\'var(--green-pale)\';">📄 Download Order</button>';
    h+='</div>';
    h+='</div>';

    // ── Billing Details ──
    h+=_odSection('Billing Details');
    h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:.2rem .8rem;margin-bottom:.8rem;">';
    h+=_odLabel('Name',o.billingName);
    if(o.email)h+=_odLabel('Email',o.email);
    if(o.contactPhone)h+=_odLabel('Phone',o.contactPhone);
    if(o.billingTin)h+=_odLabel('TIN',o.billingTin);
    if(o.billingIc)h+=_odLabel('IC',o.billingIc);
    if(o.billingAddr)h+=_odLabel('Address',o.billingAddr);
    h+=_odLabel('Payment',o.paymentMethod);
    h+='</div>';

    // ── Items ──
    h+=_odSection('Items');
    h+='<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    h+='<thead><tr style="border-bottom:2px solid var(--green-pale);"><th style="text-align:left;padding:.3rem;color:var(--text-light);font-size:10px;font-weight:700;text-transform:uppercase;">Product</th><th style="text-align:right;padding:.3rem;color:var(--text-light);font-size:10px;font-weight:700;">Price</th><th style="text-align:right;padding:.3rem;color:var(--text-light);font-size:10px;font-weight:700;">Qty</th><th style="text-align:right;padding:.3rem;color:var(--text-light);font-size:10px;font-weight:700;">Subtotal</th></tr></thead><tbody>';
    var subtotal=0;
    if(o.items&&o.items.length){
      o.items.forEach(function(it){
        subtotal+=(it.subtotal||it.unit_price*it.quantity);
        h+='<tr style="border-bottom:1px solid #f0f0ec;"><td style="padding:.3rem;">'+esc(stripMonth(it.product_name))+'</td><td style="padding:.3rem;text-align:right;">RM '+(it.unit_price||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td><td style="padding:.3rem;text-align:right;">'+it.quantity.toLocaleString()+'</td><td style="padding:.3rem;text-align:right;font-weight:600;">RM '+(it.subtotal||it.unit_price*it.quantity).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td></tr>';
      });
    }
    h+='</tbody></table>';
    h+='<div style="border-top:2px solid var(--green-pale);margin-top:.4rem;padding-top:.4rem;">';
    if(subtotal!==o.total){
      h+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:.15rem 0;"><span style="color:var(--text-light);">Subtotal</span><span>RM '+subtotal.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</span></div>';
      // Break the total discount into its named components so the
      // customer sees exactly what came off. Falls back to a single
      // "Discount / Voucher" row for legacy orders where none of the
      // per-source fields were captured.
      var fmt = function(n){return n.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});};
      var namedTotal = (o.couponDiscount||0) + (o.discountAmount||0) + (o.pointsDiscountRm||0);
      var totalDisc  = subtotal - o.total;
      if(namedTotal > 0.001){
        if(o.couponDiscount > 0){
          var codeLabel = o.couponCode ? ' ('+esc(o.couponCode)+')' : '';
          h+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:.15rem 0;color:#dc2626;"><span>Voucher'+codeLabel+'</span><span>-RM '+fmt(o.couponDiscount)+'</span></div>';
        }
        if(o.discountAmount > 0){
          var noteLabel = o.discountNote ? ' <span style="color:#9ca3af;font-weight:400;font-style:italic;">('+esc(o.discountNote)+')</span>' : '';
          h+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:.15rem 0;color:#dc2626;"><span>Discount'+noteLabel+'</span><span>-RM '+fmt(o.discountAmount)+'</span></div>';
        }
        if(o.pointsDiscountRm > 0){
          var ptsLabel = o.pointsRedeemed ? ' ('+o.pointsRedeemed.toLocaleString()+' pts)' : '';
          h+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:.15rem 0;color:#dc2626;"><span>Points'+ptsLabel+'</span><span>-RM '+fmt(o.pointsDiscountRm)+'</span></div>';
        }
        // Any residual discount not captured by the named fields (rare —
        // covers legacy admin discounts that predate discount_amount).
        var residual = totalDisc - namedTotal;
        if(residual > 0.005){
          h+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:.15rem 0;color:#dc2626;"><span>Other adjustment</span><span>-RM '+fmt(residual)+'</span></div>';
        }
      } else if(totalDisc > 0){
        h+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:.15rem 0;color:#dc2626;"><span>Discount / Voucher</span><span>-RM '+fmt(totalDisc)+'</span></div>';
      }
    }
    h+='<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;padding:.2rem 0;"><span>Total</span><span>RM '+o.total.toLocaleString('en-MY',{minimumFractionDigits:2})+'</span></div>';
    h+='</div>';

    // ── Customer Remark ──
    if(o.customerRemark){
      h+=_odSection('Customer Remark');
      h+='<div style="font-size:12px;color:var(--text-mid);padding:.4rem .6rem;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;">'+esc(o.customerRemark)+'</div>';
    }

    // ── Seller Note ──
    if(o.sellerNote){
      h+=_odSection('Seller Note');
      h+='<div style="font-size:12px;color:var(--text-mid);padding:.4rem .6rem;background:var(--cream);border:1px solid var(--green-pale);border-radius:8px;">'+esc(o.sellerNote)+'</div>';
    }

    // ── Collection Booking ──
    // Renders any non-cancelled rows from shared_collection_bookings
    // that match this order's order_number. Customer self-bookings
    // (made at CollectionTimeBooking with a verified order number) link
    // here directly; walk-in bookings without a linked order won't show
    // because they were saved with al_number 'PENDING' and an unrelated
    // order_number. Multiple bookings (split collection) all render.
    if(o.bookings && o.bookings.length){
      h+=_odSection('Collection Booking');
      o.bookings.forEach(function(b){
        var dateStr=b.booking_date?new Date(b.booking_date+'T00:00:00').toLocaleDateString('en-MY',{weekday:'long',day:'2-digit',month:'short',year:'numeric'}):'—';
        var st=(b.start_time||'').substring(0,5);
        var et=(b.end_time||'').substring(0,5);
        var statusLower=(b.status||'pending').toLowerCase();
        var statusStyle = statusLower==='completed' ? 'background:#d1fae5;color:#065f46;' :
                         statusLower==='confirmed' ? 'background:#dbeafe;color:#1e3a8a;' :
                                                     'background:#fef3c7;color:#92400e;';
        // Hide the Edit button on completed/cancelled bookings (once
        // the nursery has marked it done, the customer shouldn't be
        // moving the slot) and on past-date bookings (no point
        // editing a slot that already came and went). WhatsApp share
        // stays available always so a customer can re-share the time
        // even after confirmation.
        var bookingIsPast = false;
        if(b.booking_date){
          var bd = new Date(b.booking_date+'T00:00:00');
          var todayMid = new Date(); todayMid.setHours(0,0,0,0);
          bookingIsPast = bd < todayMid;
        }
        var canEdit = statusLower !== 'completed' && statusLower !== 'cancelled' && !bookingIsPast;
        var idJs=String(b.id||'').replace(/[\\'"<>]/g,'');
        h+='<div style="background:#fff;border:1px solid var(--green-pale);border-radius:10px;padding:.7rem .85rem;margin-bottom:.4rem;font-size:12px;">';
        h+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">';
        h+='<div style="flex:1;min-width:0;">';
        h+='<div style="font-weight:700;color:var(--text-dark);">📅 '+esc(dateStr)+'</div>';
        h+='<div style="font-size:11px;color:var(--text-mid);margin-top:.15rem;">'+esc(st)+(et?' – '+esc(et):'')+' · Qty: <strong>'+(b.collection_qty||0)+'</strong></div>';
        if(b.notes) h+='<div style="font-size:11px;color:var(--text-light);margin-top:.2rem;font-style:italic;">'+esc(b.notes)+'</div>';
        h+='</div>';
        h+='<span style="font-size:9px;font-weight:700;padding:.2rem .5rem;border-radius:6px;letter-spacing:.05em;text-transform:uppercase;white-space:nowrap;'+statusStyle+'">'+esc(b.status||'pending')+'</span>';
        h+='</div>';
        // Action row — Edit (when allowed) + WhatsApp share. Buttons
        // are small inline pills so they don't dominate the card; the
        // booking summary is still the focus.
        h+='<div style="display:flex;gap:.4rem;justify-content:flex-end;margin-top:.55rem;padding-top:.5rem;border-top:1px solid #f0f0ec;">';
        if(canEdit){
          h+='<button onclick="pEditBooking(\''+idJs+'\')" style="background:#fff;border:1.5px solid var(--green-pale);color:var(--green-dark);padding:.3rem .7rem;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:.25rem;transition:all .15s;" onmouseover="this.style.background=\'var(--green-dark)\';this.style.color=\'#fff\';this.style.borderColor=\'var(--green-dark)\';" onmouseout="this.style.background=\'#fff\';this.style.color=\'var(--green-dark)\';this.style.borderColor=\'var(--green-pale)\';">✏️ Edit</button>';
        }
        h+='<button onclick="pShareBookingWhatsApp(\''+idJs+'\')" style="background:#25D366;border:none;color:#fff;padding:.3rem .7rem;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:.25rem;transition:background .15s;" onmouseover="this.style.background=\'#1FAA52\';" onmouseout="this.style.background=\'#25D366\';">📱 Share to WhatsApp</button>';
        h+='</div>';
        h+='</div>';
      });
    }

    // ── Attached Documents ──
    // Two sources feed this section:
    //   1. salesweb_order_attachments — files uploaded against this order
    //      by either the customer (payment proofs, from payment-proof.html)
    //      or staff (invoices / receipts / etc. from the admin orders
    //      view). We split them by matching uploaded_by against the
    //      customer's own email so the customer immediately sees which
    //      side put what here.
    //   2. shared_do_records — DOs allocated against the AL. Rendered as
    //      cards with their own delivery-date / qty / status because the
    //      shape is richer than a plain file row.
    var atts=(o.attachments||[]);
    var custEmail=String(o.email||'').toLowerCase();
    var customerUploads=[];
    var adminUploads=[];
    atts.forEach(function(a){
      var who=String(a.uploaded_by||'').toLowerCase();
      // Customer-side uploads come from payment-proof.html which stamps
      // the user's email into uploaded_by; the legacy fallback was the
      // literal string "customer". Anything else (including null) is
      // treated as a staff upload.
      var isCustomer = (who==='customer') || (custEmail && who===custEmail);
      (isCustomer ? customerUploads : adminUploads).push(a);
    });
    var hasDocs=(o.dos&&o.dos.length)||atts.length;
    if(hasDocs){
      h+=_odSection('Attached Documents');

      // Helper that renders one file-row inside whichever sub-group it
      // belongs to. The file name is plain text now (not a link) — the
      // "View" button on the right opens the file inline via
      // pViewFile() instead of a tab navigation. Keeps the customer in
      // the portal, especially on mobile where new tabs lose context.
      function _renderFileRow(a){
        var icon=a.file_type&&String(a.file_type).indexOf('pdf')>-1?'📄':'🖼️';
        var dt=a.created_at?new Date(a.created_at).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
        var safeUrl=String(a.file_url||'').replace(/[\\'"<>]/g,'');
        var safeName=String(a.file_name||'file').replace(/[\\'"<>]/g,'');
        var safeType=String(a.file_type||'').replace(/[\\'"<>]/g,'');
        return '<div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;background:#fff;border:1px solid var(--green-pale);border-radius:8px;margin-bottom:.3rem;font-size:12px;">'+
          '<span>'+icon+'</span>'+
          '<span style="flex:1;color:var(--text-dark);font-weight:500;word-break:break-all;">'+esc(a.file_name||'file')+'</span>'+
          (dt?'<span style="font-size:10px;color:var(--text-light);white-space:nowrap;">'+dt+'</span>':'')+
          '<button type="button" onclick="pViewFile(\''+safeUrl+'\',\''+safeName+'\',\''+safeType+'\')" style="background:var(--green-dark);color:#fff;border:none;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:.3rem .65rem;border-radius:6px;cursor:pointer;font-family:inherit;">View</button>'+
        '</div>';
      }

      // All attachments + DOs render under the single "Attached
      // Documents" header — no sub-section labels. Customer uploads
      // (payment proofs) come first, then staff uploads (invoices /
      // receipts / etc.), then delivery-order cards.
      customerUploads.forEach(function(a){h+=_renderFileRow(a);});
      adminUploads.forEach(function(a){h+=_renderFileRow(a);});

      // Delivery Orders keep their richer card style because each DO
      // has delivery date, qty, status, and an optional linked BA —
      // none of which fit the plain "file link + date" row above.
      if(o.dos&&o.dos.length){
        o.dos.forEach(function(d){
          var doDate=d.delivery_date?new Date(d.delivery_date).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'}):'—';
          var doStatusColor=d.status==='Delivered'?'#15803d':d.status==='Cancelled'?'#dc2626':'var(--gold)';
          h+='<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:.5rem .7rem;margin-bottom:.4rem;font-size:12px;">';
          h+='<div style="display:flex;justify-content:space-between;align-items:center;">';
          h+='<div><span style="font-weight:700;color:#15803d;">DO '+(d.do_number||'—')+'</span><span style="color:var(--text-light);margin-left:.5rem;font-size:11px;">'+doDate+'</span></div>';
          h+='<div><span style="margin-right:.4rem;">Qty: <strong>'+d.total_qty+'</strong></span><span style="font-weight:700;font-size:11px;color:'+doStatusColor+';">'+d.status+'</span></div>';
          h+='</div>';
          if(d.ba_number||d.ba_raw_name){
            h+='<div style="font-size:11px;color:var(--text-mid);margin-top:.2rem;">BA: <strong>'+(d.ba_number||d.ba_raw_name)+'</strong>';
            if(d.ba_image_url)h+=' <a href="'+d.ba_image_url+'" target="_blank" style="color:var(--green-mid);font-size:10px;">[View BA]</a>';
            h+='</div>';
          }
          if(d.image_url&&!String(d.image_url).startsWith('data:')){
            h+='<div style="margin-top:.3rem;"><a href="'+d.image_url+'" target="_blank" style="font-size:10px;color:var(--green-mid);text-decoration:none;">📄 View DO Document</a></div>';
          }
          h+='</div>';
        });
      }
    }

    // ── Order Timeline (curated flow) ──
    // We don't render the raw `salesweb_order_timeline` rows directly — that
    // table holds bookkeeping entries the customer doesn't need to see
    // ("Payment Initiated", "AL Created", verifier diagnostics, etc.). Instead
    // we project a fixed customer-facing flow:
    //   Order Placed → Payment Confirmed → Points Issued → Book Collection
    //   → Collected Seedling on <date> → Order Completed
    // The raw rows are still scanned to pick up the timestamps for each step.
    h+=_odSection('Order Status');
    h+='<div style="position:relative;padding-left:20px;">';
    h+='<div style="position:absolute;left:5px;top:4px;bottom:4px;width:2px;background:var(--green-pale);"></div>';

    var stampPlaced=null,stampPaid=null,stampPoints=null,stampCollected=null,stampCompleted=null,stampCancelled=null;
    var pointsCount=Number(o.pointsIssued||0)||0;
    if(o.timeline&&o.timeline.length){
      o.timeline.forEach(function(t){
        var s=String(t.status||'').toLowerCase();
        if(!stampPlaced && (s==='order placed'||s==='placed')) stampPlaced=t.created_at;
        if(!stampPaid && (s==='paid'||s.indexOf('payment confirmed')>-1)) stampPaid=t.created_at;
        if(!stampPoints && s==='points issued'){
          stampPoints=t.created_at;
          var m=String(t.note||'').match(/(\d+)\s+loyalty/i);
          if(m && !pointsCount) pointsCount=parseInt(m[1],10);
        }
        if(!stampCompleted && (s==='completed'||s==='order completed')) stampCompleted=t.created_at;
        if(!stampCancelled && s==='cancelled') stampCancelled=t.created_at;
      });
    }
    if(!stampPlaced) stampPlaced=o.orderDate;

    // Collected = the nursery has actually handed the seedlings over (a DO was
    // marked Delivered). Attach any DO documents + admin-uploaded files to
    // this step so the customer can grab their proof of collection in one place.
    var collectedFiles=[];
    if(o.dos&&o.dos.length){
      o.dos.forEach(function(d){
        if(d.status==='Delivered'){
          var dt=d.delivery_date||d.created_at;
          if(!stampCollected || new Date(dt) < new Date(stampCollected)) stampCollected=dt;
          if(d.image_url && String(d.image_url).indexOf('data:')!==0){
            collectedFiles.push({url:d.image_url,name:'DO '+(d.do_number||'document')});
          }
        }
      });
    }

    // The post-payment flow (Payment Confirmed, Points, Collection booking) is
    // gated on the order's CURRENT status — not on historical timeline stamps.
    // An order that is still Pending Payment (or only Partially Paid) must show
    // no payment/points/collection steps, even if it was briefly marked Paid
    // before and those bookkeeping rows linger in the timeline table.
    var isPaidOrBeyond = ['Paid','Ready for Collection','Collecting','Completed','Order Completed'].indexOf(o.status) !== -1;

    var steps=[];
    if(stampCancelled){
      steps.push({label:'Order Placed',note:'Order placed by customer',date:stampPlaced,done:true});
      steps.push({label:'Order Cancelled',note:'This order was cancelled',date:stampCancelled,done:true,isCancelled:true});
    } else {
      steps.push({label:'Order Placed',note:'Order placed by customer',date:stampPlaced,done:true});
      if(!isPaidOrBeyond){
        // Not yet paid — the only next action is to complete payment.
        steps.push({label:'Awaiting Payment',note:'Complete your payment to confirm this order.',done:false});
      } else {
        steps.push({label:'Payment Confirmed',note:o.paymentMethod||'Payment received',date:stampPaid,done:true});
        if(stampPoints || pointsCount>0){
          var pNote = pointsCount>0 ? (pointsCount+' loyalty points credited') : 'Loyalty points credited';
          steps.push({label:'Points Issued',note:pNote,date:stampPoints,done:true});
        }
        // Collection step has three possible states (in order of
        // priority):
        //   1. A DO marked Delivered → collected.
        //   2. One or more non-cancelled bookings exist in
        //      shared_collection_bookings → one "Collection Booked"
        //      step per booking, oldest first, with the actual
        //      booked date/time/qty pulled from the row. The split-
        //      collection case (two pickups for one order) shows
        //      both steps so the customer can see their full plan.
        //   3. Paid but no booking yet → "Book Your Collection" CTA.
        var bookingsForTimeline = (o.bookings||[]).slice().sort(function(a,b){
          return String(a.booking_date||'').localeCompare(String(b.booking_date||''));
        });
        function _fmtBookingNote(b, withQty){
          var d = b.booking_date ? new Date(b.booking_date+'T00:00:00').toLocaleDateString('en-MY',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}) : '—';
          var t = (b.start_time||'').substring(0,5);
          var base = d + (t?' · '+t:'');
          return withQty ? (base + ' · '+(b.collection_qty||0)+' seedlings') : base;
        }
        if(stampCollected){
          if(bookingsForTimeline.length){
            bookingsForTimeline.forEach(function(b){
              steps.push({label:'Collection Booked',note:_fmtBookingNote(b,true),done:true});
            });
          } else {
            steps.push({label:'Collection Booked',note:'Collection slot confirmed',done:true});
          }
          var cDate=new Date(stampCollected).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});
          steps.push({label:'Collected Seedling on '+cDate,note:'',date:stampCollected,done:true,files:collectedFiles});
        } else if(bookingsForTimeline.length){
          // Mark only the most recent (last after sort = furthest future)
          // as the current step; earlier ones are completed slots already
          // booked, so they show as plain done steps in the curated flow.
          bookingsForTimeline.forEach(function(b, i){
            var isLast = (i === bookingsForTimeline.length-1);
            steps.push({label:'Collection Booked',note:_fmtBookingNote(b,true),done:true,isCurrent:isLast});
          });
        } else {
          steps.push({label:'Book Your Collection',note:'Pick a collection time at the nursery',done:false,action:'book'});
        }
        if(stampCompleted || o.status==='Completed' || o.status==='Order Completed'){
          steps.push({label:'Order Completed',note:'Thank you for your purchase! 🌱',date:stampCompleted,done:true,isFinal:true});
        }
      }
    }

    // Render newest first — the current/next step sits at the top so the
    // customer sees what's actionable without scrolling. Compute the
    // current-step index off the original forward-ordered array (it's the
    // last non-done step), then reverse for display.
    var currentIdx = -1;
    for(var ci=steps.length-1; ci>=0; ci--){ if(!steps[ci].done){ currentIdx=ci; break; } }
    var stepsReversed = steps.slice().reverse();
    stepsReversed.forEach(function(t,i){
      var origIdx = steps.length - 1 - i;
      var isCurrent = !t.done && origIdx === currentIdx;
      var dt = t.date ? new Date(t.date).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
      var dotColor = t.isCancelled ? '#dc2626' : (isCurrent ? 'var(--gold)' : (t.isFinal ? '#15803d' : (t.done ? 'var(--green-mid)' : 'var(--green-pale)')));
      var highlight = isCurrent ? 'background:rgba(201,168,76,.10);border:1px solid #F2D58F;border-radius:8px;padding:.55rem .7rem .6rem;margin-left:-.7rem;' : '';
      h+='<div style="position:relative;padding-bottom:.65rem;margin-bottom:.2rem;'+highlight+'">';
      h+='<div style="position:absolute;left:'+(isCurrent?'-15px':'-20px')+';top:'+(isCurrent?'.65rem':'3px')+';width:'+(isCurrent?'12px':'10px')+';height:'+(isCurrent?'12px':'10px')+';border-radius:50%;background:'+dotColor+';border:2px solid #fff;box-shadow:0 0 0 '+(isCurrent?'2px':'1px')+' '+dotColor+';"></div>';
      h+='<div style="font-size:12.5px;font-weight:'+(isCurrent?'700':'600')+';color:var(--text-dark);">'+esc(t.label)+'</div>';
      if(t.note) h+='<div style="font-size:11px;color:var(--text-mid);margin-top:.1rem;">'+esc(t.note)+'</div>';
      if(dt) h+='<div style="font-size:10px;color:var(--text-light);margin-top:.1rem;">'+dt+'</div>';
      if(t.action==='book'){
        var bookingUrl = P_BOOKING_URL || 'https://collect.mjmnursery.com/';
        h+='<div style="margin-top:.55rem;"><a href="'+esc(bookingUrl)+'" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:.4rem;background:var(--green-dark);color:#fff;padding:.5rem .95rem;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;">📅 Book Collection Time</a></div>';
      }
      if(t.files && t.files.length){
        h+='<div style="margin-top:.4rem;display:flex;flex-direction:column;gap:.2rem;">';
        t.files.forEach(function(f){
          h+='<a href="'+esc(f.url)+'" target="_blank" rel="noopener" style="font-size:11px;color:var(--green-mid);text-decoration:none;font-weight:500;">📎 '+esc(f.name)+'</a>';
        });
        h+='</div>';
      }
      h+='</div>';
    });
    h+='</div>';

    // ── Cancel order action (only while the order is still unpaid) ──
    // Per spec: as long as payment is NOT yet confirmed, the customer can cancel.
    // "Pending Payment" is the unpaid state; everything past that (Order Confirmed
    // and onward) is post-payment and can't be cancelled from the portal.
    var canCancel = (o.status === 'Pending Payment');
    if (canCancel) {
      var idJsC = String(o.id || '').replace(/[\\'"<>]/g, '');
      h += '<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--green-pale);display:flex;justify-content:flex-end;">';
      h += '<button onclick="pCancelOrder(\'' + idJsC + '\')" style="background:#fee2e2;color:#b91c1c;border:1.5px solid #fca5a5;padding:.5rem 1rem;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;" onmouseover="this.style.background=\'#dc2626\';this.style.color=\'#fff\';" onmouseout="this.style.background=\'#fee2e2\';this.style.color=\'#b91c1c\';">✕ Cancel Order</button>';
      h += '</div>';
    }

    document.getElementById('p-od-body').innerHTML=h;
    document.getElementById('p-order-detail-modal').classList.add('open');
  }

  // Opens a print-friendly window with the order receipt — order number,
  // date, billing details, items, total. When the order is still Pending
  // Payment, also shows the bank details + a "use Order # as reference"
  // hint so the customer can pay via bank transfer from the printout.
  // Print is triggered automatically; the customer's browser print dialog
  // is the "Save as PDF" entry point on every desktop platform.
  function downloadOrder(orderId){
    var o = P_ORDERS.find(function(x){return x.id===orderId;});
    if(!o){ showPortalToast('Order not found'); return; }

    var isPending = (o.status==='Pending Payment');
    var totalLabel = isPending ? 'Amount to be Paid' : 'Total Paid';
    var statusColor = isPending ? '#b45309' : '#15803d';
    var pd = P_PAY_DETAILS || {};

    var itemsHtml = '';
    var subtotal = 0;
    if(o.items && o.items.length){
      o.items.forEach(function(it){
        var st = Number(it.subtotal!=null ? it.subtotal : it.unit_price*it.quantity) || 0;
        subtotal += st;
        itemsHtml += '<tr>'+
          '<td style="padding:8px;border-bottom:1px solid #EEE;">'+esc(stripMonth(it.product_name))+'</td>'+
          '<td style="padding:8px;border-bottom:1px solid #EEE;text-align:right;">RM '+(Number(it.unit_price)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
          '<td style="padding:8px;border-bottom:1px solid #EEE;text-align:right;">'+it.quantity+'</td>'+
          '<td style="padding:8px;border-bottom:1px solid #EEE;text-align:right;">RM '+st.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
        '</tr>';
      });
    }
    var subRow='', discRow='';
    if(Math.abs(subtotal - (Number(o.total)||0)) > 0.001){
      subRow = '<tr><td colspan="3" style="padding:6px 8px;text-align:right;color:#8AAB8C;">Subtotal</td><td style="padding:6px 8px;text-align:right;">RM '+subtotal.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td></tr>';
      var fmt = function(n){return n.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});};
      var namedTotal = (o.couponDiscount||0) + (o.discountAmount||0) + (o.pointsDiscountRm||0);
      var disc = subtotal - (Number(o.total)||0);
      if(namedTotal > 0.001){
        if(o.couponDiscount > 0){
          var codeLabel = o.couponCode ? ' ('+esc(o.couponCode)+')' : '';
          discRow += '<tr><td colspan="3" style="padding:6px 8px;text-align:right;color:#dc2626;">Voucher'+codeLabel+'</td><td style="padding:6px 8px;text-align:right;color:#dc2626;">-RM '+fmt(o.couponDiscount)+'</td></tr>';
        }
        if(o.discountAmount > 0){
          discRow += '<tr><td colspan="3" style="padding:6px 8px;text-align:right;color:#dc2626;">Discount'+(o.discountNote?' ('+esc(o.discountNote)+')':'')+'</td><td style="padding:6px 8px;text-align:right;color:#dc2626;">-RM '+fmt(o.discountAmount)+'</td></tr>';
        }
        if(o.pointsDiscountRm > 0){
          var ptsLabel = o.pointsRedeemed ? ' ('+o.pointsRedeemed.toLocaleString()+' pts)' : '';
          discRow += '<tr><td colspan="3" style="padding:6px 8px;text-align:right;color:#dc2626;">Points'+ptsLabel+'</td><td style="padding:6px 8px;text-align:right;color:#dc2626;">-RM '+fmt(o.pointsDiscountRm)+'</td></tr>';
        }
        var residual = disc - namedTotal;
        if(residual > 0.005){
          discRow += '<tr><td colspan="3" style="padding:6px 8px;text-align:right;color:#dc2626;">Other adjustment</td><td style="padding:6px 8px;text-align:right;color:#dc2626;">-RM '+fmt(residual)+'</td></tr>';
        }
      } else if(disc > 0){
        discRow = '<tr><td colspan="3" style="padding:6px 8px;text-align:right;color:#dc2626;">Discount / Voucher</td><td style="padding:6px 8px;text-align:right;color:#dc2626;">-RM '+fmt(disc)+'</td></tr>';
      }
    }

    var bankBlock = '';
    if(isPending){
      var hasBank = pd.bank_name || pd.account_name || pd.account_number || pd.duitnow_qr_url;
      bankBlock = '<div style="margin-top:24px;padding:18px;background:#FFF8EB;border:1px solid #F2D58F;border-radius:8px;">'+
        '<div style="font-size:11px;font-weight:700;color:#8A6314;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Payment Instructions</div>'+
        (hasBank ?
          '<div style="font-size:13px;color:#5C4308;line-height:1.7;">'+
            (pd.bank_name ?      '<div><strong>Bank:</strong> '+esc(pd.bank_name)+'</div>' : '')+
            (pd.account_name ?   '<div><strong>Account Name:</strong> '+esc(pd.account_name)+'</div>' : '')+
            (pd.account_number ? '<div><strong>Account Number:</strong> '+esc(pd.account_number)+'</div>' : '')+
            '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #E2C76E;font-size:12px;">Please use <strong>Order #'+esc(o.id)+'</strong> as your payment reference, then upload your payment proof from the portal.</div>'+
          '</div>'
          :
          '<div style="font-size:12px;color:#5C4308;">Please contact MJM Nursery for payment details, and use <strong>Order #'+esc(o.id)+'</strong> as your reference.</div>'
        )+
      '</div>';
    }

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Order #'+esc(o.id)+' — MJM Nursery</title>'+
      '<style>'+
        'body{font-family:Helvetica,Arial,sans-serif;color:#1A2E1B;max-width:680px;margin:30px auto;padding:0 24px;line-height:1.5;}'+
        'h1{font-family:Georgia,serif;font-size:26px;margin:0 0 4px;color:#2D4A30;font-weight:600;}'+
        '.muted{color:#8AAB8C;font-size:12px;}'+
        '.sect{font-size:11px;font-weight:700;color:#4A6B4C;text-transform:uppercase;letter-spacing:.06em;margin:24px 0 8px;padding-bottom:6px;border-bottom:1px solid #C8DFC9;}'+
        '.row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;}'+
        '.row .lbl{color:#8AAB8C;}'+
        '.row .val{font-weight:600;text-align:right;}'+
        'table{width:100%;border-collapse:collapse;margin-top:6px;}'+
        'th{font-size:11px;text-align:left;color:#4A6B4C;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #2D4A30;padding:8px;}'+
        '.total{font-size:16px;font-weight:700;color:'+statusColor+';}'+
        '.brand{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8AAB8C;}'+
        '@media print{body{margin:0;padding:0 18px;}.no-print{display:none !important;}}'+
      '</style></head><body>'+
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #2D4A30;padding-bottom:14px;">'+
        '<div><div class="brand">MJM Nursery</div><h1>Order #'+esc(o.id)+'</h1><div class="muted">Placed on '+esc(o.orderDate)+'</div></div>'+
        '<div style="text-align:right;"><div class="muted">Status</div><div style="font-size:14px;font-weight:700;color:'+statusColor+';">'+esc(o.status)+'</div></div>'+
      '</div>'+

      '<div class="sect">Billing Details</div>'+
      '<div>'+
        '<div class="row"><span class="lbl">Name</span><span class="val">'+esc(o.billingName)+'</span></div>'+
        (o.email      ? '<div class="row"><span class="lbl">Email</span><span class="val">'+esc(o.email)+'</span></div>' : '')+
        (o.contactPhone ? '<div class="row"><span class="lbl">Phone</span><span class="val">'+esc(o.contactPhone)+'</span></div>' : '')+
        (o.billingTin ? '<div class="row"><span class="lbl">TIN</span><span class="val">'+esc(o.billingTin)+'</span></div>' : '')+
        (o.billingIc  ? '<div class="row"><span class="lbl">IC</span><span class="val">'+esc(o.billingIc)+'</span></div>' : '')+
        (o.billingAddr? '<div class="row"><span class="lbl">Address</span><span class="val">'+esc(o.billingAddr)+'</span></div>' : '')+
        '<div class="row"><span class="lbl">Payment Method</span><span class="val">'+esc(o.paymentMethod)+'</span></div>'+
      '</div>'+

      '<div class="sect">Items</div>'+
      '<table><thead><tr><th>Product</th><th style="text-align:right;">Price</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Subtotal</th></tr></thead>'+
      '<tbody>'+itemsHtml+'</tbody></table>'+
      (subRow ? '<table style="margin-top:0;"><tbody>'+subRow+discRow+'</tbody></table>' : '')+
      '<div style="border-top:2px solid #2D4A30;margin-top:10px;padding-top:12px;display:flex;justify-content:space-between;align-items:center;">'+
        '<div class="total">'+totalLabel+'</div>'+
        '<div class="total">RM '+(Number(o.total)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div>'+
      '</div>'+

      bankBlock +

      '<div style="margin-top:30px;padding-top:14px;border-top:1px solid #C8DFC9;text-align:center;font-size:11px;color:#8AAB8C;">Thank you for choosing MJM Nursery.</div>'+
      '<div class="no-print" style="text-align:center;margin-top:24px;"><button onclick="window.print()" style="padding:10px 22px;background:#2D4A30;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">Print / Save as PDF</button></div>'+
      '<script>setTimeout(function(){try{window.print();}catch(e){}},500);<\/script>'+
      '</body></html>';

    var w = window.open('','_blank','width=760,height=920');
    if(!w){ showPortalToast('Please allow pop-ups to download the order'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // Flow held stock back to products when an order is cancelled. Stock is
  // held at order creation; cancelling returns each item's quantity via
  // a SECURITY DEFINER RPC. Customers can't UPDATE salesweb_products
  // directly (RLS is admin-only), so the previous client-side update
  // silently no-op'd and stock never flowed back.
  async function pRestoreOrderStock(ord){
    var fullId = ord && (ord.fullId || ord.id);
    if(!fullId) return;
    try{
      var res = await _sb.rpc('restore_order_stock', { p_order_id: fullId });
      if(res && res.error){
        console.error('[restore_order_stock] rpc failed:', res.error.message||res.error);
        // Fallback: attempt the old direct update in case the RPC
        // isn't installed yet on this Supabase. Will still silently
        // fail if RLS blocks the write, but preserves the previous
        // behaviour.
        var items=(ord && ord.items)||[];
        await Promise.all(items.map(async function(it){
          var pid=it.product_id, qty=Number(it.quantity)||0;
          if(!pid || qty<=0) return;
          try{
            var{data:prod}=await _sb.from('salesweb_products').select('stock_qty').eq('id',pid).maybeSingle();
            if(prod){
              await _sb.from('salesweb_products').update({stock_qty:(prod.stock_qty||0)+qty,updated_at:new Date().toISOString()}).eq('id',pid);
            }
          }catch(e){ console.error('stock restore fallback failed for',pid,e); }
        }));
      } else {
        console.log('[restore_order_stock] restored', res && res.data, 'units');
      }
    }catch(e){ console.error('stock restore threw:', e); }
  }

  // Customer-initiated order cancel. Allowed only while status === 'Pending Payment'.
  // We re-check the current status against the DB (not the in-memory P_ORDERS cache)
  // because the cache can be stale — a webhook or admin update could have moved the
  // order past Pending Payment after the modal was opened.
  async function pCancelOrder(orderId){
    var ord = P_ORDERS.find(function(x){return x.id === orderId;});
    if (!ord) { showPortalToast('Order not found'); return; }
    if (!confirm('Cancel order #' + ord.id + '?\n\nThis will set the order to Cancelled and cannot be undone. The items will be returned to stock automatically.')) return;

    try {
      await loadSupabaseSdk();
      if (!_sb) { showPortalToast('Connection error — try again'); return; }
      var fullId = ord.fullId || orderId;
      var email = sessionStorage.getItem('mjm_user_email') || 'customer';

      var { data: latest, error: readErr } = await _sb.from('salesweb_customer_orders')
          .select('status').eq('id', fullId).maybeSingle();
      if (readErr || !latest) { showPortalToast('Could not verify order — try again'); return; }
      if (latest.status !== 'Pending Payment') {
        showPortalToast('Order is now "' + latest.status + '" — please contact us to cancel.');
        return;
      }

      var { error } = await _sb.from('salesweb_customer_orders')
          .update({ status: 'Cancelled', updated_at: new Date().toISOString() })
          .eq('id', fullId);
      if (error) { showPortalToast('Cancel failed: ' + error.message); return; }
      // Return the held stock now that the order is cancelled.
      await pRestoreOrderStock(ord);
      await _sb.from('salesweb_order_timeline').insert([{
        order_id: fullId,
        status: 'Cancelled',
        note: 'Order cancelled by customer via portal — stock returned',
        changed_by: email
      }]);
      showPortalToast('Order cancelled — items returned to stock');
      document.getElementById('p-order-detail-modal').classList.remove('open');
      // Refresh portal data so the order moves into the Cancelled state instantly.
      try { await loadCustomerOrders(); pRenderOrders(); pRenderHistory(); } catch(e){ console.error('portal refresh:', e); }
    } catch (e) {
      showPortalToast('Cancel failed: ' + (e.message || e));
    }
  }

  // When the portal page is restored from the browser's back/forward cache
  // (e.g. user goes portal → checkout → back), the page state — including any
  // autofilled value in the order search input — is preserved as-is and
  // initPortal() is NOT re-run. Clear stale search filters and re-render so the
  // list isn't empty just because the browser auto-pasted the user's email into
  // the search box.
  window.addEventListener('pageshow', function(e){
    try{
      var search = document.getElementById('pp-order-search');
      if(search && search.value){ search.value = ''; }
      var portalActive = document.getElementById('page-portal')
                         && document.getElementById('page-portal').classList.contains('active');
      if(portalActive){
        if(typeof pRenderOrders === 'function') pRenderOrders();
        if(typeof pRenderHistory === 'function') pRenderHistory();
        // On a bfcache restore (e.persisted=true), also re-fetch orders so
        // that any change made on another tab/page (e.g. a new order placed,
        // a cancellation) is reflected.
        if(e.persisted && typeof loadCustomerOrders === 'function'){
          loadCustomerOrders().then(function(){
            if(typeof pRenderOrders === 'function') pRenderOrders();
            if(typeof pRenderHistory === 'function') pRenderHistory();
          }).catch(function(){});
        }
      }
    }catch(err){ console.error('portal pageshow handler:', err); }
  });

  // Load real points data from DB
  async function loadCustomerPoints(){
    var sess=await _sb.auth.getSession();
    var uid=sess?.data?.session?.user?.id;
    if(!uid)return;

    // Load member tiers from app_settings
    var tiers=[{name:'Bronze',min_points:0,color:'#CD7F32'}];
    try{
      var{data:tiersData}=await _sb.from('salesweb_app_settings').select('value').eq('key','member_tiers').single();
      if(tiersData&&tiersData.value)tiers=JSON.parse(tiersData.value);
    }catch(e){}

    // Single source of truth: the points ledger (via balance view).
    // Falls back to computing from the orders table when the view lacks
    // Earned rows (issuePoints never fired) so a redemption that would
    // otherwise push view balance negative still shows the right number.
    var balance=0,totalEarned=0,redeemed=0;
    try{
      var{data:bal}=await _sb.from('salesweb_customer_points_balance')
        .select('balance,lifetime_earned,lifetime_redeemed')
        .eq('user_id',uid).maybeSingle();
      if(bal){
        balance=Number(bal.balance)||0;
        totalEarned=Number(bal.lifetime_earned)||0;
        redeemed=Number(bal.lifetime_redeemed)||0;
      }
    }catch(e){}
    if(!totalEarned){
      // Recompute from the orders table: EVERY non-cancelled order counts
      // for both earned (points_issued) and redeemed (points_redeemed).
      // Redeemed picks up BOTH committed (order status → Paid → ledger
      // row) and pending (still Pending Payment, no ledger row yet)
      // redemptions in one pass. Cancelled orders don't contribute to
      // either side.
      var{data:orders}=await _sb.from('salesweb_customer_orders')
        .select('points_issued,points_redeemed,status')
        .eq('customer_id',uid);
      var totalRedeemedFromOrders = 0;
      (orders||[]).forEach(function(o){
        if(o.status === 'Cancelled') return;
        totalEarned            += Number(o.points_issued  )||0;
        totalRedeemedFromOrders += Number(o.points_redeemed)||0;
      });
      // Prefer the higher of the two redemption totals — covers customers
      // whose ledger already carries a Redeemed row (redeemed > 0) and
      // customers whose redemption is still tracked only on the order
      // row (totalRedeemedFromOrders > 0). Avoids double-counting.
      redeemed = Math.max(redeemed, totalRedeemedFromOrders);
      balance  = Math.max(0, totalEarned - redeemed);
    }

    // Determine tier from lifetime earned (not current balance — spending
    // redeemed points shouldn't demote you).
    tiers.sort(function(a,b){return b.min_points-a.min_points;});
    var currentTier=tiers[tiers.length-1]; // lowest tier as default
    for(var i=0;i<tiers.length;i++){
      if(totalEarned>=tiers[i].min_points){currentTier=tiers[i];break;}
    }

    P_POINTS={
      balance:balance,
      tier:currentTier.name,
      tierColor:currentTier.color||'#CD7F32',
      totalEarned:totalEarned,
      redeemed:redeemed,
      tiers:tiers
    };
  }

  // Right side: Member card — simple tier display
  function pRenderMemberCard(){
    var p=P_POINTS;
    var tierColor=p.tierColor||'#CD7F32';
    document.getElementById('pp-member-card').innerHTML=
      '<div class="p-card" style="background:linear-gradient(135deg,var(--green-dark),var(--green-mid));color:#fff;border:none;padding:1.5rem;">'+
        '<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:.3rem;">Member Tier</div>'+
        '<div style="display:flex;align-items:center;gap:.5rem;">'+
          '<div style="width:12px;height:12px;border-radius:50%;background:'+tierColor+';border:2px solid rgba(255,255,255,.3);"></div>'+
          '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:300;">'+p.tier+' Member</div>'+
        '</div>'+
      '</div>';
  }

  // Right side: Points — balance only (big, prominent)
  function pRenderPointsCard(){
    var p=P_POINTS;
    document.getElementById('pp-points-card').innerHTML=
      '<div class="p-card" style="text-align:center;padding:1.5rem 1rem;">'+
        '<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-light);margin-bottom:.5rem;">Available Points</div>'+
        '<div style="font-family:\'Cormorant Garamond\',serif;font-weight:600;color:var(--green-mid);line-height:1;">'+
          '<span style="font-size:3.5rem;">'+p.balance.toLocaleString()+'</span>'+
          '<span style="font-size:1rem;font-weight:400;color:var(--text-light);margin-left:.4rem;">pts</span>'+
        '</div>'+
      '</div>';
  }

  // Right side: Points Activity — current-month entries by default; user can
  // expand to full history. Cached on first fetch so the toggle is instant.
  var pActivityRows=null;
  var pActivityShowAll=false;
  async function pRenderPointsActivity(){
    var el=document.getElementById('pp-points-activity');
    if(!el)return;
    var sess=await _sb.auth.getSession();
    var uid=sess?.data?.session?.user?.id;
    if(!uid){el.innerHTML='';return;}

    if(pActivityRows===null){
      try{
        var{data}=await _sb.from('salesweb_points_ledger')
          .select('id,change,type,order_id,rm_value,note,created_at')
          .eq('user_id',uid)
          .order('created_at',{ascending:false})
          .limit(200);
        pActivityRows=data||[];
      }catch(e){ pActivityRows=[]; }
    }

    var now=new Date();
    var monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();
    var thisMonth=pActivityRows.filter(function(r){return new Date(r.created_at).getTime()>=monthStart;});
    var rows=pActivityShowAll?pActivityRows:thisMonth;

    // Map order_id (UUID) → order_number (display) so the activity row can label it.
    var orderMap={};
    (P_ORDERS||[]).forEach(function(o){if(o.fullId) orderMap[o.fullId]=o.id;});

    function fmtDate(s){var d=new Date(s);return d.toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});}
    function rowHtml(r){
      var sign = r.change>=0 ? '+' : '−';
      var amt  = Math.abs(r.change).toLocaleString();
      var color = r.change>=0 ? 'var(--green-mid)' : '#b45309';
      var typeLabel = r.type==='Earned' ? '⭐ Earned' : (r.type==='Redeemed' ? '🎁 Redeemed' : '✏️ Adjusted');
      var orderRef = r.order_id && orderMap[r.order_id] ? '<div style="font-size:10px;color:var(--text-light);">Order '+orderMap[r.order_id]+'</div>' : '';
      return '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid #e8ede8;font-size:12px;">'+
          '<div><div style="font-weight:600;color:var(--text-dark);">'+typeLabel+'</div>'+orderRef+
            '<div style="font-size:10px;color:var(--text-light);margin-top:.1rem;">'+fmtDate(r.created_at)+'</div></div>'+
          '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.1rem;font-weight:600;color:'+color+';white-space:nowrap;">'+sign+amt+'</div>'+
        '</div>';
    }

    var monthName=now.toLocaleDateString('en-MY',{month:'long',year:'numeric'});
    var rangeLabel=pActivityShowAll?'All history':monthName;
    var toggleLabel=pActivityShowAll?'Show this month':'View full history';

    var body;
    if(!rows.length){
      body='<div style="font-size:12px;color:var(--text-light);text-align:center;padding:.8rem 0;">'+
             (pActivityShowAll?'No activity yet. Your earn and redeem history will appear here.':'No activity this month.')+
           '</div>';
    } else {
      body=rows.map(rowHtml).join('');
    }

    // Only show the toggle if expanding would actually reveal more rows
    // (otherwise this month already equals all history).
    var showToggle=pActivityRows.length>thisMonth.length;
    var toggleHtml=showToggle
      ? '<div style="text-align:center;padding-top:.7rem;"><a href="javascript:void(0)" onclick="pTogglePointsActivity()" style="font-size:12px;color:var(--green-mid);font-weight:600;text-decoration:none;">'+toggleLabel+' →</a></div>'
      : '';

    el.innerHTML='<div class="p-card">'+
      '<h3 style="display:flex;justify-content:space-between;align-items:center;"><span>Points Activity</span><span style="font-size:10px;font-weight:400;color:var(--text-light);">'+rangeLabel+'</span></h3>'+
      body+
      toggleHtml+
    '</div>';
  }

  function pTogglePointsActivity(){
    pActivityShowAll=!pActivityShowAll;
    pRenderPointsActivity();
  }

  // Rating
  function pOpenRating(id){pRatingOrderId=id;pRatingVal=0;document.getElementById('p-rating-comment').value='';document.getElementById('p-rating-btn').disabled=true;document.getElementById('p-star-label').textContent='Tap a star';document.querySelectorAll('.p-star').forEach(function(s){s.classList.remove('active');});var o=P_ORDERS.find(function(x){return x.id===id;});document.getElementById('p-rating-info').innerHTML=o?o.id+' — '+o.variety:'';document.getElementById('p-rating-modal').classList.add('open');}
  function pSetRating(v){pRatingVal=v;var l=['','😐 Poor','🙂 Fair','😊 Good','😄 Great','🤩 Excellent!'];document.getElementById('p-star-label').textContent=l[v];document.querySelectorAll('.p-star').forEach(function(s){s.classList.toggle('active',parseInt(s.dataset.v)<=v);});document.getElementById('p-rating-btn').disabled=false;}
  function pSubmitRating(){if(!pRatingOrderId||!pRatingVal)return;pRatings[pRatingOrderId]=pRatingVal;document.getElementById('p-rating-modal').classList.remove('open');showPortalToast('⭐'.repeat(pRatingVal)+' Thank you!');pRenderOrders();}

  // ═══════════════════════════════════════
  //  CHECKOUT LOGIN (inline)
  // ═══════════════════════════════════════
  var clIsSignUp = false;
  var clInputType = 'phone';        // 'phone' or 'email' — driven by active tab
  var clLoginContext = 'nav';       // 'nav' or 'checkout'
  var clOtpChannel = 'sms';         // 'sms' or 'whatsapp' — for phone OTP

  function openLoginModal(context) {
    // Login needs supabase-js for auth.signInWithPassword etc — kick off the
    // SDK load now (no await, so the modal opens instantly; auth.* calls below
    // already await _sb internally via the lazy guard).
    loadSupabaseSdk();
    clLoginContext = context || 'nav';
    // Reset form state
    clIsSignUp = false;
    ['cl-signup-fields','cl-signup-fields-phone'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    var btnTog = document.getElementById('cl-btn-toggle');
    if (btnTog) btnTog.textContent = 'Create Account';
    var btnTogP = document.getElementById('cl-btn-toggle-phone');
    if (btnTogP) btnTogP.textContent = 'First time? Create Account';
    var btnLogin = document.getElementById('cl-btn-login');
    if (btnLogin) btnLogin.textContent = 'Sign In';
    var statusEl = document.getElementById('cl-status');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cl-status'; }
    ['cl-otp-row','cl-otp-row-phone'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.classList.remove('show');
    });
    // Clear any stale OTP code left in the inputs from a previous session
    ['cl-otp-code','cl-otp-code-phone'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.value = '';
    });
    // Default to phone tab
    clSwitchMode('email');
    // Update subtitle
    var subEl = document.getElementById('lm-sub');
    if (subEl) subEl.textContent = context === 'checkout'
      ? 'Sign in to complete your order'
      : 'Sign in to your account';
    // Show overlay
    var overlay = document.getElementById('login-modal-overlay');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Focus phone field
    setTimeout(function() {
      var inp = document.getElementById('cl-phone');
      if (inp) inp.focus();
    }, 100);

    // If a code was already sent and is still inside its 1-hour window, restore
    // the code-entry state so the user can finish logging in with that code
    // rather than having to request a new one.
    try {
      var pend = JSON.parse(sessionStorage.getItem('mjm_pending_otp') || 'null');
      if (pend && pend.identity && (Date.now() - pend.ts) < 3600000) {
        clSwitchMode(pend.isPhone ? 'phone' : 'email');
        var idEl = document.getElementById(pend.isPhone ? 'cl-phone' : 'cl-identity');
        if (idEl) idEl.value = pend.identity;
        var rowEl = document.getElementById(pend.isPhone ? 'cl-otp-row-phone' : 'cl-otp-row');
        if (rowEl) rowEl.classList.add('show');
        var codeEl = document.getElementById(pend.isPhone ? 'cl-otp-code-phone' : 'cl-otp-code');
        if (codeEl) { codeEl.value = ''; setTimeout(function(){ codeEl.focus(); }, 120); }
        clShowStatus('Enter the code we sent to ' + pend.identity + ', or resend a new one.', 'success');
      } else if (pend) {
        // Expired — drop it so we don't show a stale prompt.
        sessionStorage.removeItem('mjm_pending_otp');
      }
    } catch (e) {}
  }

  function closeLoginModal() {
    var overlay = document.getElementById('login-modal-overlay');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    // If we were on checkout-login page, go back to home
    if (document.getElementById('page-checkout-login').classList.contains('active')) {
      showPage('home');
    }
  }

  // Escape key closes login modal
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var overlay = document.getElementById('login-modal-overlay');
      if (overlay && overlay.classList.contains('open')) closeLoginModal();
    }
  });

  function clSwitchMode(mode) {
    clInputType = mode;
    var tabPhone = document.getElementById('lm-tab-phone');
    var tabEmail = document.getElementById('lm-tab-email');
    var paneP = document.getElementById('lm-pane-phone');
    var paneE = document.getElementById('lm-pane-email');
    if (tabPhone) tabPhone.classList.toggle('active', mode === 'phone');
    if (tabEmail) tabEmail.classList.toggle('active', mode === 'email');
    if (paneP) paneP.classList.toggle('active', mode === 'phone');
    if (paneE) paneE.classList.toggle('active', mode === 'email');
    var statusEl = document.getElementById('cl-status');
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'cl-status'; }
  }
  function clToggleSignup(pane) {
    clIsSignUp = !clIsSignUp;
    if (pane === 'phone' || (!pane && clInputType === 'phone')) {
      var sf = document.getElementById('cl-signup-fields-phone');
      var btnP = document.getElementById('cl-btn-toggle-phone');
      if (sf) sf.style.display = clIsSignUp ? 'block' : 'none';
      if (btnP) btnP.textContent = clIsSignUp ? 'Back to Sign In' : 'First time? Create Account';
    } else {
      document.getElementById('cl-signup-fields').style.display = clIsSignUp ? 'block' : 'none';
      document.getElementById('cl-btn-login').textContent = clIsSignUp ? 'Create Account' : 'Sign In';
      document.getElementById('cl-btn-toggle').textContent = clIsSignUp ? 'Back to Sign In' : 'Create Account';
    }
  }

  function clShowStatus(msg, type) { var el = document.getElementById('cl-status'); el.textContent = msg; el.className = 'cl-status ' + type; }
  function clClearStatus() { document.getElementById('cl-status').className = 'cl-status'; }

  async function clPostLogin(session) {
    if (!session) { clShowStatus('Login failed.', 'error'); return; }
    var name = session.user.user_metadata?.full_name || session.user.email || session.user.phone || '';
    sessionStorage.setItem('mjm_user_email', session.user.email || '');
    sessionStorage.setItem('mjm_user_name', name);
    // Update nav (desktop + mobile)
    setLoggedInUi(name);
    // Check role + permissions
    var { data: profile } = await _sb.from('shared_profiles').select('role, permissions').eq('id', session.user.id).single();
    var swLevel = (profile && profile.permissions && profile.permissions.modules && profile.permissions.modules.salesweb) || 'none';
    var isAdmin = swLevel === 'admin' || swLevel === 'normal' || (profile && profile.role === 'admin');

    if (isAdmin) {
      clShowStatus('Welcome, admin! Redirecting...', 'success');
      setTimeout(function() { window.location.href = 'admin.html'; }, 700);
    } else if (clLoginContext === 'checkout') {
      clShowStatus('Welcome! Redirecting to checkout...', 'success');
      setTimeout(function() { window.location.href = 'payment.html'; }, 700);
    } else {
      // nav login — show customer portal inline
      clShowStatus('Welcome! Opening your account...', 'success');
      setTimeout(function() {
        closeLoginModal();
        showPage('portal');
        initPortal();
      }, 500);
    }
  }

  // Normalise phone to E.164 (Malaysia default if no country code)
  function clNormalisePhone(raw) {
    var v = (raw || '').replace(/[\s\-\(\)]/g, '');
    if (!v) return '';
    if (v.startsWith('+')) return v;
    // Local Malaysian format starting with 0 (e.g. 0123456789) -> +60123456789
    if (v.startsWith('0')) return '+60' + v.substring(1);
    // Already country-code with no plus
    if (/^\d{10,}$/.test(v)) return '+' + v;
    return v;
  }

  async function clLoginPassword() {
    var identity = document.getElementById('cl-identity').value.trim();
    var pw = document.getElementById('cl-password').value;
    if (!identity || !pw) { clShowStatus('Please enter email and password.', 'error'); return; }
    if (clIsSignUp) {
      var name = document.getElementById('cl-signup-name').value.trim();
      if (!name) { clShowStatus('Please enter your full name.', 'error'); return; }
      if (pw.length < 6) { clShowStatus('Password must be at least 6 characters.', 'error'); return; }
      clShowStatus('Creating account...', 'success');
      var { data: signUpData, error } = await _sb.auth.signUp({ email: identity, password: pw, options: { data: { full_name: name, user_type: 'customer' } } });
      if (error) {
        if (error.message.toLowerCase().includes('database')) {
          var { data: retryData, error: retryErr } = await _sb.auth.signUp({ email: identity, password: pw });
          if (retryErr) { clShowStatus(retryErr.message, 'error'); return; }
          if (retryData && retryData.user) {
            await _sb.from('shared_profiles').upsert({ id: retryData.user.id, email: identity, full_name: name, role: 'customer', user_type: 'customer' }, { onConflict: 'id' });
          }
        } else {
          clShowStatus(error.message, 'error'); return;
        }
      } else if (signUpData && signUpData.user) {
        await _sb.from('shared_profiles').upsert({ id: signUpData.user.id, email: identity, full_name: name, role: 'customer', user_type: 'customer' }, { onConflict: 'id' });
      }
      clShowStatus('Account created! You can now sign in.', 'success');
      clToggleSignup('email');
      return;
    }
    clShowStatus('Signing in...', 'success');
    var { data, error } = await _sb.auth.signInWithPassword({ email: identity, password: pw });
    if (error) { clShowStatus(error.message, 'error'); return; }
    await clPostLogin(data.session);
  }

  // Send OTP via SMS, WhatsApp, or Email.
  //   channel: 'sms' | 'whatsapp' | 'email'
  async function clSendOTP(channel) {
    channel = channel || (clInputType === 'phone' ? 'sms' : 'email');
    clOtpChannel = channel;
    var isPhone = channel === 'sms' || channel === 'whatsapp';

    // Pick the right input
    var identity = isPhone
      ? clNormalisePhone(document.getElementById('cl-phone').value)
      : document.getElementById('cl-identity').value.trim();
    if (!identity) {
      clShowStatus(isPhone ? 'Please enter your phone number.' : 'Please enter your email address.', 'error');
      return;
    }

    // Optional sign-up name capture
    var signupName = '';
    if (clIsSignUp) {
      var nameEl = document.getElementById(isPhone ? 'cl-signup-name-phone' : 'cl-signup-name');
      signupName = nameEl ? nameEl.value.trim() : '';
      if (!signupName) { clShowStatus('Please enter your full name.', 'error'); return; }
    }

    // Disable the channel button for this transaction
    var btnIds = isPhone ? ['cl-btn-sms', 'cl-btn-wa'] : ['cl-btn-otp'];
    btnIds.forEach(function(id){ var b = document.getElementById(id); if (b) b.disabled = true; });
    var clickedBtn = document.getElementById(channel === 'whatsapp' ? 'cl-btn-wa' : channel === 'sms' ? 'cl-btn-sms' : 'cl-btn-otp');
    var origLabel = clickedBtn ? clickedBtn.textContent : '';
    if (clickedBtn) clickedBtn.textContent = 'Sending...';

    var opts;
    if (isPhone) {
      opts = { phone: identity, options: { channel: channel } };
      if (clIsSignUp && signupName) opts.options.data = { full_name: signupName, user_type: 'customer' };
    } else {
      opts = { email: identity };
      if (clIsSignUp && signupName) opts.options = { data: { full_name: signupName, user_type: 'customer' } };
    }

    var { error } = await _sb.auth.signInWithOtp(opts);
    if (error) {
      clShowStatus(error.message, 'error');
      btnIds.forEach(function(id){ var b = document.getElementById(id); if (b) b.disabled = false; });
      if (clickedBtn) clickedBtn.textContent = origLabel;
      return;
    }
    var destLabel = channel === 'whatsapp' ? 'WhatsApp message sent to ' : channel === 'sms' ? 'SMS sent to ' : 'Code sent to ';
    clShowStatus(destLabel + identity, 'success');

    // Show the right OTP row + focus
    var otpRowId = isPhone ? 'cl-otp-row-phone' : 'cl-otp-row';
    var otpInputId = isPhone ? 'cl-otp-code-phone' : 'cl-otp-code';
    document.getElementById(otpRowId).classList.add('show');
    document.getElementById(otpInputId).focus();

    // Remember that a code is pending so the user can close the login modal and
    // re-open it within the code's 1-hour validity to finish keying it in,
    // instead of being forced to request a brand-new code.
    try {
      sessionStorage.setItem('mjm_pending_otp', JSON.stringify({
        identity: identity, channel: channel, isPhone: isPhone, ts: Date.now()
      }));
    } catch (e) {}

    // Cooldown only on the clicked button; sibling stays usable for fallback channel
    if (clickedBtn) clickedBtn.textContent = 'Sent';
    var cd = 30;
    var t = setInterval(function() {
      cd--;
      if (clickedBtn) clickedBtn.textContent = 'Resend (' + cd + ')';
      if (cd <= 0) {
        clearInterval(t);
        btnIds.forEach(function(id){ var b = document.getElementById(id); if (b) b.disabled = false; });
        if (clickedBtn) clickedBtn.textContent = origLabel;
      }
    }, 1000);
  }

  async function clVerifyOTP(pane) {
    pane = pane || clInputType;
    var isPhone = pane === 'phone';
    var identity = isPhone
      ? clNormalisePhone(document.getElementById('cl-phone').value)
      : document.getElementById('cl-identity').value.trim();
    var otp = (isPhone
      ? document.getElementById('cl-otp-code-phone').value
      : document.getElementById('cl-otp-code').value).trim();
    if (!identity || !otp) { clShowStatus('Please enter the 8-digit code.', 'error'); return; }
    clShowStatus('Verifying...', 'success');
    // For Supabase verifyOtp, the type is 'sms' for both SMS and WhatsApp channels.
    var opts = isPhone
      ? { phone: identity, token: otp, type: 'sms' }
      : { email: identity, token: otp, type: 'email' };
    var { data, error } = await _sb.auth.verifyOtp(opts);
    if (error) { clShowStatus(error.message, 'error'); return; }
    // Code consumed — forget the pending-OTP marker.
    try { sessionStorage.removeItem('mjm_pending_otp'); } catch (e) {}
    // For first-time phone signups, ensure profile row exists with full_name
    if (isPhone && data && data.user) {
      var fullName = data.user.user_metadata?.full_name || '';
      var phoneVal = data.user.phone || identity;
      await _sb.from('shared_profiles').upsert({
        id: data.user.id,
        phone: phoneVal,
        full_name: fullName || phoneVal,
        role: 'customer',
        user_type: 'customer'
      }, { onConflict: 'id' });
    }
    await clPostLogin(data.session);
  }

  async function clForgotPassword() {
    var identity = document.getElementById('cl-identity').value.trim();
    if (!identity || clInputType === 'phone') { clShowStatus('Enter your email address first.', 'error'); return; }
    // Send the customer back to this app's recovery page (auth.html). Without an
    // explicit redirectTo, Supabase uses the shared project Site URL and the
    // reset link opens a different MJM app's login page instead.
    var { error } = await _sb.auth.resetPasswordForEmail(identity, {
      redirectTo: window.location.origin + '/auth.html'
    });
    if (error) { clShowStatus(error.message, 'error'); return; }
    clShowStatus('Reset link sent! Check your inbox.', 'success');
  }

  // Enter key support for login modal
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'cl-otp-code') clVerifyOTP('email');
    else if (e.target.id === 'cl-otp-code-phone') clVerifyOTP('phone');
    else if (e.target.id === 'cl-identity' || e.target.id === 'cl-password') clLoginPassword();
    else if (e.target.id === 'cl-phone') clSendOTP('sms');
  });

  // Sign out
  async function portalSignOut(){
    Object.keys(localStorage).forEach(function(k){if(k.startsWith('sb-'))localStorage.removeItem(k);});
    sessionStorage.clear();
    // Wipe any OTP code still sitting in the login inputs
    ['cl-otp-code','cl-otp-code-phone'].forEach(function(id){
      var el = document.getElementById(id); if (el) el.value = '';
    });
    try{await _sb.auth.signOut({scope:'local'});}catch(e){}
    setLoggedOutUi();
    showPage('home');
    showPortalToast('Signed out');
  }

  // Sync the desktop + mobile nav into the logged-in / logged-out state.
  // The mobile menu has its own duplicate set (mob-*) that used to drift
  // out of sync — making the user think Shop signed them out.
  function setLoggedInUi(name){
    var first = (name||'').split(' ')[0] || 'Account';
    var set = function(id, disp, txt){
      var el = document.getElementById(id); if (!el) return;
      el.style.display = disp;
      if (typeof txt === 'string') el.textContent = txt;
    };
    set('nav-login-link', 'none');
    set('nav-myaccount',  'inline', 'Hi, ' + first);
    set('nav-signout',    'inline');
    set('mob-login-link', 'none');
    set('mob-myaccount',  'inline', 'Hi, ' + first);
    set('mob-signout',    'inline');
  }
  function setLoggedOutUi(){
    var set = function(id, disp){ var el = document.getElementById(id); if (!el) return; el.style.display = disp; };
    set('nav-login-link', 'inline');
    set('nav-myaccount',  'none');
    set('nav-signout',    'none');
    set('mob-login-link', 'inline');
    set('mob-myaccount',  'none');
    set('mob-signout',    'none');
  }

  // Password eye toggle
  function showPw(id){document.getElementById(id).type='text';}
  function hidePw(id){document.getElementById(id).type='password';}

  // Collapsible sections
  function toggleCollapse(h3){
    var card=h3.closest('.p-collapse');
    var body=card.querySelector('.p-collapse-body');
    var icon=card.querySelector('.p-collapse-icon');
    if(body.style.display==='none'){body.style.display='block';icon.textContent='▼';card.classList.add('open');}
    else{body.style.display='none';icon.textContent='▶';card.classList.remove('open');}
  }

  // Billing entries
  var billingEntries=[];
  var addBillingType='personal';

  function switchAddBillingType(type){
    addBillingType=type;
    document.getElementById('add-bill-personal').style.display=type==='personal'?'block':'none';
    document.getElementById('add-bill-company').style.display=type==='company'?'block':'none';
    document.getElementById('add-bill-personal-btn').classList.toggle('active',type==='personal');
    document.getElementById('add-bill-company-btn').classList.toggle('active',type==='company');
  }

  function openAddBilling(){
    document.getElementById('billing-add-form').style.display='block';
    addBillingType='personal';switchAddBillingType('personal');
    ['ab-name','ab-ic','ab-tin','ab-mpob','ab-coname','ab-coreg','ab-cotin','ab-compob','ab-contact','ab-cophone'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  }
  function saveBillingEntry(){
    var entry={type:addBillingType,id:editingBillingId||Date.now()};
    if(addBillingType==='personal'){
      entry.name=document.getElementById('ab-name').value.trim();
      entry.ic=document.getElementById('ab-ic').value.trim();
      entry.tin=document.getElementById('ab-tin').value.trim();
      entry.mpob=document.getElementById('ab-mpob').value.trim();
      if(!entry.name){showPortalToast('Please enter billing name');return;}
    } else {
      entry.name=document.getElementById('ab-coname').value.trim();
      entry.reg=document.getElementById('ab-coreg').value.trim();
      entry.tin=document.getElementById('ab-cotin').value.trim();
      entry.mpob=document.getElementById('ab-compob').value.trim();
      entry.contact=document.getElementById('ab-contact').value.trim();
      entry.contactPhone=document.getElementById('ab-cophone').value.trim();
      if(!entry.name){showPortalToast('Please enter company name');return;}
    }
    if(editingBillingId){
      var idx=billingEntries.findIndex(function(e){return e.id===editingBillingId;});
      if(idx>=0){entry.dbId=billingEntries[idx].dbId;billingEntries[idx]=entry;}
      editingBillingId=null;
      showPortalToast('Billing info updated ✅');
    } else {
      billingEntries.push(entry);
      showPortalToast('Billing info added ✅');
    }
    closeAddBilling();
    renderBillingEntries();
    saveBillingToStorage();
    saveBillingToDb(entry);
  }

  function deleteBillingEntry(id){
    var entry=billingEntries.find(function(e){return e.id===id;});
    if(entry&&entry.dbId)deleteBillingFromDb(entry.dbId);
    billingEntries=billingEntries.filter(function(e){return e.id!==id;});
    renderBillingEntries();
    saveBillingToStorage();
    showPortalToast('Billing info removed');
  }

  async function saveBillingToDb(entry){
    var session=await _sb.auth.getSession();
    var userId=session?.data?.session?.user?.id;
    if(!userId)return;
    var row={
      user_id:userId, type:entry.type, name:entry.name,
      ic_number:entry.ic||null, tin:entry.tin||null, mpob_license:entry.mpob||null,
      company_reg:entry.reg||null, contact_name:entry.contact||null, contact_phone:entry.contactPhone||null
    };
    if(entry.dbId){
      await _sb.from('salesweb_billing_info').update(row).eq('id',entry.dbId);
    } else {
      var{data}=await _sb.from('salesweb_billing_info').insert([row]).select();
      if(data&&data[0])entry.dbId=data[0].id;
    }
  }

  async function deleteBillingFromDb(dbId){
    if(dbId)await _sb.from('salesweb_billing_info').delete().eq('id',dbId);
  }

  async function loadBillingFromDb(){
    var session=await _sb.auth.getSession();
    var userId=session?.data?.session?.user?.id;
    if(!userId){loadBillingFromStorage();return;}
    var{data}=await _sb.from('salesweb_billing_info').select('*').eq('user_id',userId).order('created_at',{ascending:true});
    if(data&&data.length){
      billingEntries=data.map(function(r,i){
        var e={id:Date.now()+i,dbId:r.id,type:r.type,name:r.name,tin:r.tin||'',mpob:r.mpob_license||''};
        if(r.type==='personal'){e.ic=r.ic_number||'';}
        else{e.reg=r.company_reg||'';e.contact=r.contact_name||'';e.contactPhone=r.contact_phone||'';}
        return e;
      });
    } else {
      loadBillingFromStorage();
    }
  }

  // SECURITY: previously persisted full billing PII (names, phones, addresses,
  // TIN/MPOB/registration numbers) into localStorage where they were readable
  // by any XSS payload. We now keep them in-memory only — they are re-fetched
  // from the DB by loadBillingForUser() when a logged-in customer opens the
  // page, and forgotten when the tab closes. We also proactively clear any
  // stale entries left by older versions of the page.
  function saveBillingToStorage(){
    try{localStorage.removeItem('mjm_billing');}catch(e){}
  }
  function loadBillingFromStorage(){
    try{localStorage.removeItem('mjm_billing');}catch(e){}
  }
  function closeAddBilling(){document.getElementById('billing-add-form').style.display='none';editingBillingId=null;}

  var editingBillingId=null;

  function editBillingEntry(id){
    var entry=billingEntries.find(function(e){return e.id===id;});
    if(!entry)return;
    editingBillingId=id;
    openAddBilling();
    switchAddBillingType(entry.type);
    if(entry.type==='personal'){
      document.getElementById('ab-name').value=entry.name||'';
      document.getElementById('ab-ic').value=entry.ic||'';
      document.getElementById('ab-tin').value=entry.tin||'';
      document.getElementById('ab-mpob').value=entry.mpob||'';
    } else {
      document.getElementById('ab-coname').value=entry.name||'';
      document.getElementById('ab-coreg').value=entry.reg||'';
      document.getElementById('ab-cotin').value=entry.tin||'';
      document.getElementById('ab-compob').value=entry.mpob||'';
      document.getElementById('ab-contact').value=entry.contact||'';
      document.getElementById('ab-cophone').value=entry.contactPhone||'';
    }
  }

  function renderBillingEntries(){
    var el=document.getElementById('billing-entries-list');
    if(!billingEntries.length){el.innerHTML='<div style="text-align:center;padding:1.2rem;color:var(--text-light);font-size:12px;background:var(--cream);border-radius:10px;">No billing info added yet</div>';return;}
    el.innerHTML=billingEntries.map(function(e){
      var icon=e.type==='personal'?'🧑':'🏢';
      var typeLabel=e.type==='personal'?'Personal':'Company';
      var details='';
      if(e.type==='personal'){
        details=(e.ic?'I/C: '+e.ic:'')+(e.tin?' · TIN: '+e.tin:'')+(e.mpob?'<br>MPOB: '+e.mpob:'');
      } else {
        details=(e.reg?'Reg: '+e.reg:'')+(e.tin?' · TIN: '+e.tin:'')+(e.mpob?'<br>MPOB: '+e.mpob:'')+(e.contact?'<br>Contact: '+e.contact:'')+(e.contactPhone?' · '+e.contactPhone:'');
      }
      return '<div class="p-billing-card"><div style="position:absolute;top:.7rem;right:.7rem;display:flex;gap:.4rem;"><button class="p-billing-edit" onclick="editBillingEntry('+e.id+')" title="Edit">Edit</button><button class="p-billing-del" onclick="deleteBillingEntry('+e.id+')" title="Remove">✕</button></div><div class="p-billing-type">'+icon+' '+typeLabel+'</div><div class="p-billing-name">'+e.name+'</div><div class="p-billing-detail">'+details+'</div></div>';
    }).join('');
  }

  // Consent
  function portalSignConsent(){document.getElementById('p-consent-modal').classList.remove('open');showPortalToast('✅ Consent signed!');}

  // Check if user is logged in — sync both desktop AND mobile nav.
  (function(){
    var name=sessionStorage.getItem('mjm_user_name');
    if(name) setLoggedInUi(name);
  })();

  // Modal overlay click to close
  document.querySelectorAll('.portal-modal-overlay').forEach(function(m){
    m.addEventListener('click',function(e){if(e.target===m)m.classList.remove('open');});
  });

  // Splash dismiss lives in its own <script> block right after the splash
  // HTML so it cannot be killed by failures elsewhere in this script.

  // ── Channel detection ──────────────────────────────────────────────────
  // Sticky tag for the session. Detect Google or WhatsApp from either
  // ?utm_source=… on the landing URL or the referrer. Defaults to
  // 'online_store'. Read by payment.html when the order is inserted.
  (function(){
    try{
      var existing = sessionStorage.getItem('mjm_channel');
      if(existing) return; // first-touch wins for the session
      var params = new URLSearchParams(window.location.search || '');
      var src = (params.get('utm_source') || '').toLowerCase();
      var ref = (document.referrer || '').toLowerCase();
      var ch = 'online_store';
      if(src.indexOf('google')>=0 || /google\.[a-z.]+/.test(ref)) ch = 'google';
      else if(src.indexOf('whatsapp')>=0 || /(?:wa\.me|whatsapp\.com)/.test(ref)) ch = 'whatsapp';
      sessionStorage.setItem('mjm_channel', ch);
    }catch(e){ /* private mode etc. — fall back to default in payment.html */ }
  })();

  // ── WINDOW BRIDGE ─────────────────────────────────────────────────────
  // In the legacy page this was one classic <script>, so every top-level
  // function was a window global. The static markup (now JSX calling
  // window.<fn>) and the dynamically-generated HTML strings above (product
  // cards, cart rows, portal orders, calculator/quotation output, calendar
  // cells, billing cards — all wired with onclick="fn(...)" that resolves
  // against window at click time) depend on that. Re-expose everything.
  // NOTE: must be an object literal (shorthand keys survive minification);
  // `window[fn.name] = fn` breaks in the production build because the
  // minifier renames local function identifiers, so fn.name !== 'showPage'.
  Object.assign(window, {
    // page navigation / shared UI (static markup + generated HTML)
    showPage, scrollToSection, showPortalToast,
    // nav / logo
    openLoginModal, closeLoginModal, portalSignOut, toggleCartDropdown,
    showLogoOverlay, logoFlyBack,
    // information page
    switchPolicyTab,
    // contact page
    submitContactForm,
    // calculator (form inputs + generated result card)
    calcSeedlings, shareCalcToWhatsApp, addCalcToCart, addCalcToCartAndQuote,
    // quotation (form inputs + generated empty-state)
    renderQuotation,
    // products (generated product cards + empty-state reload button)
    fetchProducts, openProductPopup, closeProductPopup,
    changeCardQty, setCardQty, addCardToCart, addPopupToCart,
    // cart (generated cart rows + footer)
    removeCartItem, changeCartQty, setCartQty, proceedToCheckout,
    // portal (static tabs + generated order cards / detail modal)
    pShowOrderView, pFilterOrders, saveProfileDetails, toggleCollapse,
    showPw, hidePw,
    goPayOrder, openOrderDetail, downloadOrder, pCancelOrder,
    pOpenRating, pSetRating, pSubmitRating,
    pViewFile, pCloseFileViewer,
    pEditBooking, pCloseBookingEdit, pSaveBookingEdit,
    pBePrevMonth, pBeNextMonth, pBeSelectDate,
    pShareBookingWhatsApp, pTogglePointsActivity,
    // billing (static buttons + generated billing cards)
    openAddBilling, closeAddBilling, switchAddBillingType,
    saveBillingEntry, editBillingEntry, deleteBillingEntry,
    // consent modal
    portalSignConsent,
    // login modal
    clLoginPassword, clSendOTP, clVerifyOTP, clForgotPassword,
    clToggleSignup, clSwitchMode,
    // misc helpers referenced indirectly
    initPortal, pRenderOrders, pRenderHistory, loadCustomerOrders,
    setLoggedInUi, setLoggedOutUi, loadSupabaseSdk, sbFetch,
  });
}
