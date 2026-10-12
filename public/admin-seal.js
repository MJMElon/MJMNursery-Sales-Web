/* ═══════════════════════════════════════════════════════════════════
   admin-seal.js — the Seal tab, and the "Seals & DOs" panel on an order

   A seal is a barcode sticker ("0009297") that goes on a customer's
   seedlings. Each one moves through four states, all decided in the
   database rather than here:
     in_stock  received at UNN 1 (seal_receipts)
     pending   allocated to a customer on a signed consent (Mobile Consent)
     scanned   scanned at collection in the FC Portal, no DO issued yet
     collected printed on a DO (shared_do_records.seal_ranges)

   This file only READS — seal_list / seal_order_seals / seal_order_dos,
   all staff-gated inside the functions themselves.
   SQL: mjm-ai-system/shared/RUN_ME_seal_management.sql

   Classic script: it cannot import src/lib/sealRanges.js, so the one rule
   it needs (how a range is written) is copied below. Same rule as
   formatSealRanges() there — a single seal prints once, a run prints as
   "start - end". Change both.
   ═══════════════════════════════════════════════════════════════════ */

var SEAL_ROWS = [];
var SEAL_STATUS = '';             // '' = all | in_stock | pending | scanned | collected
var SEAL_LOADED_FOR = null;       // the search the rows above answer
var _sealTimer = null;
var _sealSeq = 0;                 // a slow answer to an old search must not overwrite a newer one

var SEAL_STATES = [
  { key: 'in_stock',  label: 'In stock',           badge: 'badge-grey',  color: '#475569' },
  { key: 'pending',   label: 'Pending collection', badge: 'badge-amber', color: 'var(--amber)' },
  { key: 'scanned',   label: 'Scanned',            badge: 'badge-blue',  color: '#1d4ed8' },
  { key: 'collected', label: 'Collected',          badge: 'badge-green', color: 'var(--green)' }
];
function sealState(k) { for (var i = 0; i < SEAL_STATES.length; i++) if (SEAL_STATES[i].key === k) return SEAL_STATES[i]; return { key: k, label: k || '—', badge: 'badge-grey', color: 'var(--ink3)' }; }

// One seal reads as one code; a run reads as "start – end".
function sealFmtRange(start, end) {
  if (!start) return '';
  return (!end || String(start) === String(end)) ? String(start) : String(start) + ' – ' + String(end);
}
function sealFmtRanges(list) {
  return (list || []).map(function (r) { return sealFmtRange(r.start || r.start_code, r.end || r.end_code); }).filter(Boolean).join(', ');
}
function sealNum(n) { return Number(n || 0).toLocaleString('en-MY'); }

// The functions are new; until the SQL has been pasted PostgREST answers
// "could not find the function" (PGRST202) or Postgres 42883.
function sealRpcMissing(err) {
  if (!err) return false;
  var m = String(err.message || '') + ' ' + String(err.code || '');
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function|does not exist/i.test(m);
}

// ── List ────────────────────────────────────────────────────────────
async function loadSeals() {
  var host = document.getElementById('seal-table');
  if (!host) return;
  var q = ((document.getElementById('seal-search') || {}).value || '').trim();
  if (!SEAL_ROWS.length || SEAL_LOADED_FOR !== q) host.innerHTML = '<div class="loading">Loading seals...</div>';
  var seq = ++_sealSeq;
  // Status is filtered here rather than in the call, so the four cards
  // can count every state of the same search.
  var res = await sb.rpc('seal_list', { p_search: q || null, p_status: null });
  if (seq !== _sealSeq) return;
  if (res.error) {
    SEAL_ROWS = []; SEAL_LOADED_FOR = null;
    renderSealStats();
    host.innerHTML = sealRpcMissing(res.error)
      ? '<div style="padding:1.2rem;background:#f8fafc;border:1px solid var(--border);border-radius:12px;font-size:13px;line-height:1.6;">' +
          '<strong>Seal data is not set up yet</strong> — run <code>RUN_ME_seal_management.sql</code> in the Supabase SQL Editor, then refresh this page.</div>'
      : '<div style="padding:1.2rem;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;font-size:13px;color:#b91c1c;">Could not load seals: ' + esc(res.error.message || '') + '</div>';
    return;
  }
  SEAL_ROWS = res.data || [];
  SEAL_LOADED_FOR = q;
  renderSealStats();
  renderSealTable();
}

function sealSearchChanged() {
  clearTimeout(_sealTimer);
  _sealTimer = setTimeout(loadSeals, 350);
}

function setSealStatus(s) {
  SEAL_STATUS = (SEAL_STATUS === s && s) ? '' : s;   // a second click on a card clears it
  document.querySelectorAll('[data-seal-status]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-seal-status') === SEAL_STATUS);
  });
  renderSealStats();
  renderSealTable();
}

function renderSealStats() {
  var el = document.getElementById('seal-stats');
  if (!el) return;
  var t = {};
  SEAL_STATES.forEach(function (s) { t[s.key] = { qty: 0, n: 0 }; });
  SEAL_ROWS.forEach(function (r) { var x = t[r.seg_status]; if (x) { x.qty += Number(r.qty || 0); x.n++; } });
  el.innerHTML = SEAL_STATES.map(function (s) {
    var on = SEAL_STATUS === s.key;
    return '<div class="stat-box" role="button" tabindex="0" style="cursor:pointer;' + (on ? 'outline:2px solid ' + s.color + ';outline-offset:-1px;' : '') + '" ' +
      'onclick="setSealStatus(\'' + s.key + '\')" title="Show only ' + esc(s.label.toLowerCase()) + '">' +
      '<div class="stat-body"><div class="stat-label">' + esc(s.label) + '</div>' +
      '<div class="stat-val" style="color:' + s.color + ';">' + sealNum(t[s.key].qty) + '</div>' +
      '<div style="font-size:11px;color:var(--ink4);">' + t[s.key].n + ' range' + (t[s.key].n === 1 ? '' : 's') + '</div></div></div>';
  }).join('');
  SEAL_STATES.forEach(function (s) {
    var c = document.getElementById('seal-count-' + s.key);
    if (!c) return;
    if (t[s.key].n) { c.textContent = t[s.key].n; c.setAttribute('data-count', t[s.key].n); }
    else { c.textContent = ''; c.removeAttribute('data-count'); }
  });
}

function renderSealTable() {
  var host = document.getElementById('seal-table');
  if (!host) return;
  var rows = SEAL_ROWS.filter(function (r) { return !SEAL_STATUS || r.seg_status === SEAL_STATUS; });
  var countEl = document.getElementById('seal-count');
  if (countEl) {
    var qty = rows.reduce(function (a, r) { return a + Number(r.qty || 0); }, 0);
    countEl.textContent = rows.length + ' range' + (rows.length === 1 ? '' : 's') + ' · ' + sealNum(qty) + ' seal' + (qty === 1 ? '' : 's');
  }
  if (!rows.length) {
    host.innerHTML = '<div class="loading">' + (SEAL_LOADED_FOR ? 'No seals match "' + esc(SEAL_LOADED_FOR) + '".' : (SEAL_ROWS.length ? 'No seals in this state.' : 'No seals yet. Seals received at UNN 1 will appear here.')) + '</div>';
    return;
  }
  host.innerHTML =
    '<table class="data-table"><thead><tr>' +
      '<th>Seal range</th><th style="text-align:right;">Qty</th><th>Customer</th><th>AL / Order</th><th>Consent date</th><th>Status</th><th>DO</th>' +
    '</tr></thead><tbody>' +
    rows.map(function (r) {
      var st = sealState(r.seg_status);
      var al = r.al_number ? String(r.al_number) : '';
      var alJs = al.replace(/[\\'"<>]/g, '');
      var prob = Number(r.open_problems || 0);
      return '<tr>' +
        '<td style="font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;">' + esc(sealFmtRange(r.start_code, r.end_code)) + '</td>' +
        '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + sealNum(r.qty) + '</td>' +
        '<td>' + (r.customer_name ? esc(r.customer_name) : '<span style="color:var(--ink4);">—</span>') + '</td>' +
        '<td style="white-space:nowrap;">' + (al ? '<a href="#" onclick="sealOpenOrder(\'' + alJs + '\');return false;" style="color:var(--green);font-weight:600;" title="Open this order">' + esc(al) + '</a>' : '<span style="color:var(--ink4);">—</span>') +
          (prob ? ' <span class="badge badge-red" title="' + prob + ' open seal problem' + (prob === 1 ? '' : 's') + ' on this AL — a case has gone to HQ">⚠ ' + prob + '</span>' : '') + '</td>' +
        '<td style="white-space:nowrap;font-size:12px;">' + (r.consent_at ? fmtDate(r.consent_at) : '<span style="color:var(--ink4);">—</span>') + '</td>' +
        '<td><span class="badge ' + st.badge + '">' + esc(st.label) + '</span></td>' +
        '<td style="white-space:nowrap;font-size:12px;">' + (r.do_number ? esc(r.do_number) : '<span style="color:var(--ink4);">—</span>') + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

// An AL is a Sales Web order number only when the order came through the
// website; walk-in and office orders have an AL and no order here.
async function sealOpenOrder(al) {
  if (!al) return;
  var r = await sb.from('salesweb_customer_orders').select('id').eq('order_number', al).limit(1);
  var row = r.data && r.data[0];
  if (!row) { toast(al + ' is not a Sales Web order', 'error'); return; }
  viewOrder(row.id);
}

// ── Order modal: "Seals & DOs" ──────────────────────────────────────
// Filled after the modal opens, like Documents and the Timeline. The
// section stays hidden when the order has no seals and no DOs, and when
// the functions are not there yet — an order screen is not the place to
// say the seal SQL has not been run.
async function loadOrderSeals(orderNo) {
  var el = document.getElementById('mo-seals');
  if (!el || !orderNo) return;
  var res = await Promise.all([
    sb.rpc('seal_order_dos', { p_order: orderNo }),
    sb.rpc('seal_order_seals', { p_order: orderNo })
  ]).catch(function () { return [{ error: true }, { error: true }]; });
  if (!document.getElementById('mo-seals')) return;
  var dos = (!res[0].error && res[0].data) || [];
  var segs = (!res[1].error && res[1].data) || [];
  if (!dos.length && !segs.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

  var h = '<div style="font-size:13px;font-weight:600;margin-bottom:.4rem;">Seals &amp; DOs</div>';
  if (dos.length) {
    h += '<div style="font-size:11px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.04em;margin:.2rem 0 .3rem;">Delivery Orders</div>';
    h += dos.map(function (d) {
      var rs = Array.isArray(d.seal_ranges) ? d.seal_ranges : [];
      return '<div style="border:1px solid var(--border);border-radius:8px;padding:.5rem .7rem;margin-bottom:.4rem;font-size:12px;">' +
        '<div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap;">' +
          '<strong>' + esc(d.do_number || '—') + '</strong>' +
          '<span style="color:var(--ink3);">' + (d.delivery_date ? fmtDate(d.delivery_date) : '') + (d.total_qty != null ? ' · ' + sealNum(d.total_qty) + ' seedlings' : '') + '</span>' +
        '</div>' +
        (rs.length
          ? '<div style="margin-top:.25rem;color:var(--ink2);">Seals: <span style="font-variant-numeric:tabular-nums;">' + esc(sealFmtRanges(rs)) + '</span>' +
              (d.seal_qty ? ' <span style="color:var(--ink4);">(' + sealNum(d.seal_qty) + ')</span>' : '') + '</div>'
          : '<div style="margin-top:.25rem;color:var(--ink4);">No seals on this DO</div>') +
      '</div>';
    }).join('');
  }
  if (segs.length) {
    h += '<div style="font-size:11px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.04em;margin:.5rem 0 .3rem;">Allocated Seals</div>';
    h += ['pending', 'scanned', 'collected', 'in_stock'].map(function (k) {
      var list = segs.filter(function (s) { return s.seg_status === k; });
      if (!list.length) return '';
      var st = sealState(k);
      var qty = list.reduce(function (a, s) { return a + Number(s.qty || 0); }, 0);
      return '<div style="margin-bottom:.35rem;font-size:12px;">' +
        '<span class="badge ' + st.badge + '">' + esc(st.label) + ' · ' + sealNum(qty) + '</span>' +
        '<div style="margin-top:.2rem;line-height:1.6;font-variant-numeric:tabular-nums;">' +
          list.map(function (s) {
            return esc(sealFmtRange(s.start_code, s.end_code)) + (k === 'collected' && s.do_number ? ' <span style="color:var(--ink4);">(' + esc(s.do_number) + ')</span>' : '');
          }).join(', ') +
        '</div></div>';
    }).join('');
  }
  el.innerHTML = h;
  el.style.display = '';
}
