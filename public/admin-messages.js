/* ═══════════════════════════════════════════════════════════════════
   admin-messages.js — the Messages tab: Contact Us enquiries & complaints

   Where a message comes from
     The storefront Contact Us form → salesweb_submit_message() → a row in
     salesweb_messages with a reference like MSG-00042. A logged-in
     customer also sees it, and its status, under My Account → Messages.

   What the office does with it here
     1. Assign it to a handler (Settings ⚙ keeps the list of handlers and
        the WhatsApp number each one uses).
     2. Assigning sends the customer ONE WhatsApp from the nursery number
        (edge function whatsapp, action send_case) saying who will handle
        it and the number they will be contacted from. The template, and
        whether it is sent at all, are set on the WhatsApp tab. Until the
        WhatsApp API is connected that step reports "not set up" and
        offers to open WhatsApp by hand — nothing breaks.
     3. The handler contacts the customer from their OWN WhatsApp (the
        "WhatsApp customer" button), and records what happened as an
        internal note. Notes are never shown to the customer.
     4. Status moves New → In Progress → Resolved / Closed.

   The history (status changes, assignments, WhatsApp sends) is written by
   a database trigger, not by this file, so it is the same however the
   row was changed. Settings ⚙ also keeps who gets an EMAIL when a new
   message arrives (edge function notify-new-message).

   SQL: supabase/migrations/contact_messages.sql
   ═══════════════════════════════════════════════════════════════════ */

var MSG_ROWS = [];
var MSG_VIEW = 'open';          // open | New | In Progress | Resolved | Closed | all
var MSG_HANDLERS = [];        // portal users who may be assigned (salesweb_message_assignees)
var MSG_CURRENT = null;         // the message open in the modal
var MSG_PHOTO_BUCKET = 'contact-message-photos';
var MSG_STATUSES = ['New', 'In Progress', 'Resolved', 'Closed'];

// Malaysian numbers as WhatsApp wants them: digits only, country code
// first. Same rule as waNumber() in supabase/functions/whatsapp
// and pWaNumber() in the storefront — change all three.
function waNumber(raw) {
  var d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.indexOf('60') === 0) return d;
  if (d.charAt(0) === '0') return '6' + d;
  if (d.charAt(0) === '1' && d.length >= 9 && d.length <= 10) return '60' + d;
  return d;
}

function msgStatusBadge(s) {
  return { 'New': 'badge-amber', 'In Progress': 'badge-blue', 'Resolved': 'badge-green', 'Closed': 'badge-grey' }[s] || 'badge-grey';
}

function msgWhen(d) {
  if (!d) return '—';
  var t = new Date(d);
  return t.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
         t.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
}

function msgAgo(d) {
  var mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 60) return Math.max(mins, 1) + 'm ago';
  var h = Math.floor(mins / 60);
  if (h < 48) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function msgIsOpen(m) { return m.status === 'New' || m.status === 'In Progress'; }

function msgMissingTable(err) {
  var host = document.getElementById('messages-table');
  host.innerHTML =
    '<div style="padding:1.2rem;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;font-size:13px;line-height:1.6;">' +
    '<strong style="color:#dc2626;">The Messages tables are not set up yet.</strong><br>' +
    'Run <code>supabase/migrations/contact_messages.sql</code> in the Supabase SQL Editor, then refresh this page.' +
    '<div style="font-size:11px;color:var(--ink4);margin-top:.5rem;">' + esc(err && err.message || '') + '</div></div>';
}

// ── List ────────────────────────────────────────────────────────────
async function loadMessages() {
  var host = document.getElementById('messages-table');
  if (!host) return;
  if (!MSG_ROWS.length) host.innerHTML = '<div class="loading">Loading messages...</div>';
  var res = await sb.from('salesweb_messages')
    .select('id,ref,user_id,name,email,phone,subject,kind,message,order_number,photo_path,status,handler_id,assigned_name,assigned_phone,assigned_at,wa_status,wa_sent_at,wa_detail,read_at,resolved_at,created_at')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (res.error) { msgMissingTable(res.error); return; }
  MSG_ROWS = res.data || [];
  renderMessageStats();
  renderMessagesTable();
  updateMessagesBadge();
}

function renderMessageStats() {
  var el = document.getElementById('message-stats');
  if (!el) return;
  var now = new Date(), monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var cNew = 0, cProg = 0, cComp = 0, cDone = 0;
  MSG_ROWS.forEach(function (m) {
    if (m.status === 'New') cNew++;
    if (m.status === 'In Progress') cProg++;
    if (m.kind === 'complaint' && msgIsOpen(m)) cComp++;
    if ((m.status === 'Resolved' || m.status === 'Closed') && m.resolved_at && new Date(m.resolved_at) >= monthStart) cDone++;
  });
  el.innerHTML =
    '<div class="stat-box"><div class="stat-body"><div class="stat-label">New</div><div class="stat-val" style="color:var(--amber);">' + cNew + '</div></div></div>' +
    '<div class="stat-box"><div class="stat-body"><div class="stat-label">In Progress</div><div class="stat-val" style="color:#1d4ed8;">' + cProg + '</div></div></div>' +
    '<div class="stat-box"><div class="stat-body"><div class="stat-label">Open Order Matters</div><div class="stat-val" style="color:var(--red);">' + cComp + '</div></div></div>' +
    '<div class="stat-box"><div class="stat-body"><div class="stat-label">Resolved This Month</div><div class="stat-val green">' + cDone + '</div></div></div>';

  var setCount = function (id, n) { var c = document.getElementById(id); if (!c) return; if (n) { c.textContent = n; c.setAttribute('data-count', n); } else { c.textContent = ''; c.removeAttribute('data-count'); } };
  setCount('msg-count-open', cNew + cProg);
  setCount('msg-count-new', cNew);
}

function setMessageView(v) {
  MSG_VIEW = v;
  document.querySelectorAll('[data-msg-view]').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-msg-view') === v);
  });
  renderMessagesTable();
}

function renderMessagesTable() {
  var host = document.getElementById('messages-table');
  if (!host) return;
  var q = ((document.getElementById('message-search') || {}).value || '').trim().toLowerCase();
  var kind = (document.getElementById('message-kind') || {}).value || '';

  var rows = MSG_ROWS.filter(function (m) {
    if (MSG_VIEW === 'open' && !msgIsOpen(m)) return false;
    if (MSG_VIEW !== 'open' && MSG_VIEW !== 'all' && m.status !== MSG_VIEW) return false;
    if (kind && m.kind !== kind) return false;
    if (q) {
      var hay = [m.ref, m.name, m.email, m.phone, m.subject, m.order_number, m.message, m.assigned_name].join(' ').toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });

  // Open complaints stay on top until somebody resolves them, so they
  // cannot be buried under a pile of enquiries.
  rows.sort(function (a, b) {
    var pa = (a.kind === 'complaint' && msgIsOpen(a)) ? 0 : 1;
    var pb = (b.kind === 'complaint' && msgIsOpen(b)) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  var countEl = document.getElementById('messages-count');
  if (countEl) countEl.textContent = rows.length + ' message' + (rows.length === 1 ? '' : 's');

  if (!rows.length) {
    host.innerHTML = '<div class="loading">' + (MSG_ROWS.length ? 'No messages match.' : 'No messages yet. Messages sent from the Contact Us page will appear here.') + '</div>';
    return;
  }

  host.innerHTML =
    '<table class="data-table msg-table"><thead><tr>' +
      '<th style="width:14px;"></th><th>Ref</th><th>Received</th><th>From</th><th>Subject</th><th>Assigned To</th><th>Status</th>' +
    '</tr></thead><tbody>' +
    rows.map(function (m) {
      var unread = !m.read_at;
      var isComp = m.kind === 'complaint';
      var preview = (m.message || '').replace(/\s+/g, ' ');
      if (preview.length > 70) preview = preview.slice(0, 70) + '…';
      return '<tr class="msg-row' + (unread ? ' msg-unread' : '') + (isComp && msgIsOpen(m) ? ' msg-complaint' : '') + '" onclick="openMessage(\'' + m.id + '\')" style="cursor:pointer;">' +
        '<td>' + (unread ? '<span class="msg-dot" title="Not opened yet"></span>' : '') + '</td>' +
        '<td style="font-weight:700;white-space:nowrap;">' + esc(m.ref) + '</td>' +
        '<td style="white-space:nowrap;font-size:12px;">' + fmtDate(m.created_at) + '<div style="font-size:11px;color:var(--ink4);">' + msgAgo(m.created_at) + '</div></td>' +
        '<td><div style="font-weight:600;">' + esc(m.name) + (m.user_id ? ' <span class="badge badge-blue" title="Sent while logged in to a customer account">member</span>' : '') + '</div>' +
          '<div style="font-size:11px;color:var(--ink4);">' + esc(m.phone || m.email) + '</div></td>' +
        '<td>' + (isComp ? '<span class="badge badge-red">' + esc(m.subject) + '</span> ' : '<span style="font-weight:600;">' + esc(m.subject) + '</span>') +
          (m.photo_path ? ' <span title="Photo attached">📷</span>' : '') +
          '<div style="font-size:11px;color:var(--ink4);max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(preview) + '</div></td>' +
        '<td style="font-size:12px;">' + (m.assigned_name ? esc(m.assigned_name) : '<span style="color:var(--ink4);">—</span>') + '</td>' +
        '<td><span class="badge ' + msgStatusBadge(m.status) + '">' + esc(m.status) + '</span></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>';
}

// Sidebar badge: how many are still New. Refreshed on boot, on every
// list load, and every two minutes while the portal is open.
async function updateMessagesBadge() {
  var el = document.getElementById('sb-messages-count');
  if (!el) return;
  var n;
  if (MSG_ROWS.length) n = MSG_ROWS.filter(function (m) { return m.status === 'New'; }).length;
  else {
    var r = await sb.from('salesweb_messages').select('id', { count: 'exact', head: true }).eq('status', 'New');
    if (r.error) { el.style.display = 'none'; return; }
    n = r.count || 0;
  }
  el.textContent = n;
  el.style.display = n ? '' : 'none';
}

var _msgBadgeTimer = null;
function startMessagesBadge() {
  if (typeof canSeeTab === 'function' && !canSeeTab('messages')) return;
  updateMessagesBadge();
  if (_msgBadgeTimer) clearInterval(_msgBadgeTimer);
  _msgBadgeTimer = setInterval(function () {
    var tab = document.getElementById('tab-messages');
    if (tab && tab.classList.contains('active')) loadMessages(); else { MSG_ROWS = []; updateMessagesBadge(); }
  }, 120000);
}

// ── Detail ──────────────────────────────────────────────────────────
// ── Case pop-up ─────────────────────────────────────────────────────
// Left: ① customer (name, phone, email, order #), ② the message (category,
// content, photo). Right: case handling (assigned to, status), ③ the
// timeline of the case, then a new internal note. Nothing is written until
// the one Save button at the bottom right: assignee, status, linked order
// and the note all go together, and every change lands in the timeline
// (the database trigger writes status, assignment, order and first-opened
// entries; the note is its own entry).
var MSG_PENDING_ORDER;       // undefined = unchanged, null = remove, 'K3M7B0' = link
var MSG_DIRTY = false;

async function openMessage(id) {
  var m = MSG_ROWS.find(function (r) { return r.id === id; });
  if (!m) return;
  MSG_CURRENT = m;
  MSG_PENDING_ORDER = undefined;
  MSG_DIRTY = false;
  var note = document.getElementById('mmsg-note'); if (note) note.value = '';
  document.getElementById('mmsg-title').textContent = m.ref + ' — ' + m.subject;
  document.getElementById('mmsg-body').innerHTML = '<div class="loading">Loading…</div>';
  document.getElementById('mmsg-foot').innerHTML = '';
  openModal('modal-message');

  if (!m.read_at) {
    var now = new Date().toISOString();
    m.read_at = now;
    await sb.from('salesweb_messages').update({ read_at: now }).eq('id', id);
    renderMessagesTable(); updateMessagesBadge();
  }
  await loadMessageHandlers();
  await renderMessageDetail();
}

// Closing with something typed or picked and not saved asks first.
function closeMessageModal() {
  if (MSG_DIRTY && !confirm('You have changes that are not saved. Close without saving?')) return;
  MSG_DIRTY = false;
  closeModal('modal-message');
}

function msgMarkDirty() {
  MSG_DIRTY = true;
  var b = document.getElementById('mmsg-save'); if (b) { b.disabled = false; b.textContent = 'Save Changes'; }
  var w = document.getElementById('mmsg-dirty'); if (w) w.style.display = '';
}

function msgDur(ms) {
  if (ms == null || isNaN(ms) || ms < 0) return '';
  var m = Math.round(ms / 60000);
  if (m < 60) return m + 'm';
  var h = Math.floor(m / 60);
  if (h < 48) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  var d = Math.floor(h / 24);
  return d + 'd' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}

var MSG_EV_ICON = { created: '📩', opened: '👁', assign: '👤', status: '🔄', order: '🧾', note: '📝', whatsapp: '💬', linked: '🔗' };
var MSG_EV_LABEL = { created: 'Received', opened: 'Opened', assign: 'Assignment', status: 'Status', order: 'Order', note: 'Internal note', whatsapp: 'WhatsApp', linked: 'Customer account' };

function msgTimelineHtml(m, events) {
  var t0 = new Date(m.created_at).getTime();
  var firstOf = function (kinds) { return events.find(function (e) { return kinds.indexOf(e.kind) >= 0; }); };
  var opened = firstOf(['opened']);
  var assigned = events.filter(function (e) { return e.kind === 'assign' && e.body !== 'Unassigned'; })[0];
  var response = firstOf(['note', 'whatsapp']);
  var steps = [
    { label: 'Received', at: m.created_at, who: m.name },
    { label: 'First opened', at: m.read_at, who: opened && opened.actor_name },
    { label: 'Assigned', at: assigned ? assigned.created_at : m.assigned_at, who: assigned ? assigned.body.replace(/^Assigned to /, '') : m.assigned_name },
    { label: 'First response', at: response && response.created_at, who: response && response.actor_name },
    { label: (m.status === 'Closed' ? 'Closed' : 'Resolved'), at: m.resolved_at, who: null },
  ];
  var summary = '<div class="msg-steps">' + steps.map(function (s, i) {
    var done = !!s.at;
    var after = done && i > 0 ? msgDur(new Date(s.at).getTime() - t0) : '';
    return '<div class="msg-step' + (done ? ' done' : '') + '">' +
      '<div class="msg-step-dot"></div>' +
      '<div class="msg-step-body"><div class="msg-step-label">' + s.label + (after ? ' <span class="msg-step-after">+' + after + '</span>' : '') + '</div>' +
      '<div class="msg-step-when">' + (done ? msgWhen(s.at) + (s.who ? ' · ' + esc(s.who) : '') : 'Not yet') + '</div></div>' +
    '</div>';
  }).join('') + '</div>';

  var log = events.length ? events.slice().reverse().map(function (e) {
    return '<div class="msg-ev msg-ev-' + esc(e.kind) + '">' +
      '<div class="msg-ev-head">' + (MSG_EV_ICON[e.kind] || '•') + ' <strong>' + esc(MSG_EV_LABEL[e.kind] || e.kind) + '</strong> · ' + esc(e.actor_name || 'System') + ' · ' + msgWhen(e.created_at) + '</div>' +
      '<div class="msg-ev-body">' + esc(e.body) + '</div></div>';
  }).join('') : '<div style="font-size:12px;color:var(--ink4);">Nothing yet.</div>';

  return summary + '<div class="msg-subtitle">Every entry <span>newest first</span></div><div class="msg-history">' + log + '</div>';
}

async function renderMessageDetail() {
  var m = MSG_CURRENT;
  if (!m) return;
  var ev = await sb.from('salesweb_message_events').select('kind,body,actor_name,created_at').eq('message_id', m.id).order('created_at', { ascending: true }).order('id', { ascending: true });
  var events = ev.data || [];

  // Anything picked or typed and not yet saved survives a redraw.
  var keep = {};
  ['mmsg-note', 'mmsg-handler', 'mmsg-status'].forEach(function (id) { var el = document.getElementById(id); if (el && MSG_DIRTY) keep[id] = el.value; });
  var keepNotify = document.getElementById('mmsg-notify'); keepNotify = keepNotify ? keepNotify.checked : true;

  var waCust = waNumber(m.phone);
  // Assigned To lists the portal users with Messages access (User Access
  // → Edit Pages → Messages, and every admin). Somebody who has since
  // lost that access stays shown on the cases already assigned to them,
  // so pressing Save does not quietly unassign it.
  var current = MSG_HANDLERS.find(function (h) { return h.user_id === m.assigned_user_id; });
  var orphan = m.assigned_name && !current;
  var handlerOpts = '<option value="">— Not assigned —</option>' +
    (orphan ? '<option value="__keep" selected>' + esc(m.assigned_name) + ' — no longer has Messages access</option>' : '') +
    MSG_HANDLERS.map(function (h) {
      return '<option value="' + h.user_id + '"' + (current && h.user_id === current.user_id ? ' selected' : '') + '>' + esc(h.name) + '</option>';
    }).join('');
  var greeting = 'Hi ' + m.name + ', this is ' + (m.assigned_name || 'MJM Nursery') + ' from MJM Nursery regarding your message ' + m.ref + ' (' + m.subject + ').';

  var waLine = '';
  if (m.wa_status === 'sent') waLine = '<div class="msg-wa msg-wa-ok">✓ Customer was told on WhatsApp who is handling this (' + msgWhen(m.wa_sent_at) + ').</div>';
  else if (m.wa_status === 'not_configured') waLine = '<div class="msg-wa msg-wa-warn">WhatsApp API not set up yet — the customer was <strong>not</strong> messaged automatically. ' +
      (waCust && m.assigned_name ? '<a href="https://wa.me/' + waCust + '?text=' + encodeURIComponent('Hi ' + m.name + ', thank you for contacting MJM Nursery. Your case ' + m.ref + ' has been assigned to ' + m.assigned_name + ', who will contact you on WhatsApp from +' + waNumber(m.assigned_phone) + ' shortly.') + '" target="_blank" rel="noopener">Send it by hand</a>.' : '') + '</div>';
  else if (m.wa_status === 'disabled') waLine = '<div class="msg-wa msg-wa-warn">The case assigned WhatsApp is switched off on the WhatsApp tab — the customer was <strong>not</strong> messaged automatically.</div>';
  else if (m.wa_status === 'failed') waLine = '<div class="msg-wa msg-wa-err">WhatsApp to customer failed: ' + esc(m.wa_detail || '') + ' <button class="btn btn-outline btn-sm" onclick="sendCaseWhatsapp()">Try again</button></div>';

  var row = function (k, v) { return '<div class="msg-kv"><span>' + k + '</span><div>' + v + '</div></div>'; };
  var shownOrder = MSG_PENDING_ORDER === undefined ? m.order_number : MSG_PENDING_ORDER;
  var orderPending = MSG_PENDING_ORDER !== undefined;

  document.getElementById('mmsg-body').innerHTML =
    '<div class="msg-grid">' +
      '<div class="msg-col">' +
        // ① Customer
        '<div class="msg-card">' +
          '<div class="msg-section-title"><span class="msg-num">1</span> Customer Details</div>' +
          row('Name', esc(m.name) + (m.user_id ? ' <span class="badge badge-blue">member</span>' : '')) +
          row('Contact', esc(m.phone || '—')) +
          row('Email', m.email ? '<a href="mailto:' + esc(m.email) + '?subject=' + encodeURIComponent('Re: ' + m.ref + ' ' + m.subject) + '">' + esc(m.email) + '</a>' : '—') +
          row('Order #', '<div class="msg-order">' +
            (shownOrder ? '<strong>#' + esc(shownOrder) + '</strong> ' + (orderPending ? '' : '<a href="#" onclick="findMessageOrder();return false;" style="font-size:11px;">open</a> · ') : '<span style="color:var(--ink4);">—</span> ') +
            (orderPending ? '<span class="msg-pending">not saved yet</span> · ' : '') +
            '<a href="#" onclick="toggleOrderPicker();return false;" style="font-size:11px;">' + (shownOrder ? 'change' : 'link order') + '</a>' +
            '<div class="msg-order-pick" id="mmsg-order-pick" style="display:none;">' +
              '<input class="form-input" id="mmsg-order-q" placeholder="Type a name or order number" autocomplete="off" oninput="searchMessageOrders()">' +
              '<div class="msg-order-list" id="mmsg-order-list"></div>' +
              (shownOrder ? '<a href="#" onclick="setMessageOrder(null);return false;" style="font-size:11px;color:var(--red);">Remove order number</a>' : '') +
            '</div></div>') +
          '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.6rem;">' +
            (waCust ? '<a class="btn btn-primary btn-sm msg-wa-btn" href="https://wa.me/' + waCust + '?text=' + encodeURIComponent(greeting) + '" target="_blank" rel="noopener">WhatsApp Customer</a>' : '') +
            (m.email ? '<a class="btn btn-outline btn-sm" href="mailto:' + esc(m.email) + '?subject=' + encodeURIComponent('Re: ' + m.ref + ' ' + m.subject) + '">Email</a>' : '') +
          '</div>' +
        '</div>' +
        // ② Message
        '<div class="msg-card">' +
          '<div class="msg-section-title"><span class="msg-num">2</span> Message</div>' +
          '<div style="margin-bottom:.5rem;"><span class="badge ' + (m.kind === 'complaint' ? 'badge-red' : 'badge-blue') + '">' + esc(m.subject) + '</span>' +
            ' <span style="font-size:11px;color:var(--ink4);">' + msgWhen(m.created_at) + '</span></div>' +
          '<div class="msg-text">' + esc(m.message) + '</div>' +
          '<div id="mmsg-photo"></div>' +
        '</div>' +
      '</div>' +
      '<div class="msg-col">' +
        // Case handling
        '<div class="msg-card">' +
          '<div class="msg-section-title">Case Handling</div>' +
          '<label class="msg-field-label" for="mmsg-handler">Assigned To</label>' +
          '<select class="form-input" id="mmsg-handler" onchange="msgMarkDirty()">' + handlerOpts + '</select>' +
          (MSG_HANDLERS_ERR ? '<div style="font-size:11px;color:var(--red);margin-top:.3rem;">Could not load the list of staff: ' + esc(MSG_HANDLERS_ERR) + '</div>'
            : MSG_HANDLERS.length ? '' : '<div style="font-size:11px;color:var(--ink4);margin-top:.3rem;">Nobody has Messages access yet. Tick <strong>Messages</strong> for a user in User Access → Edit Pages.</div>') +
          '<label style="display:flex;gap:.4rem;align-items:center;font-size:12px;margin-top:.4rem;"><input type="checkbox" id="mmsg-notify"' + (keepNotify ? ' checked' : '') + ' onchange="msgMarkDirty()"> Tell the customer on WhatsApp who will handle it</label>' +
          waLine +
          '<label class="msg-field-label" for="mmsg-status" style="margin-top:.7rem;">Status</label>' +
          '<select class="form-input" id="mmsg-status" onchange="msgMarkDirty()">' + MSG_STATUSES.map(function (s) { return '<option' + (s === m.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
        '</div>' +
        // ③ Timeline
        '<div class="msg-card">' +
          '<div class="msg-section-title"><span class="msg-num">3</span> Case Timeline</div>' +
          msgTimelineHtml(m, events) +
        '</div>' +
        // New internal note
        '<div class="msg-card">' +
          '<div class="msg-section-title">Internal Note <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--ink4);">— staff only, never shown to the customer</span></div>' +
          '<textarea class="form-input" id="mmsg-note" rows="3" placeholder="What was done or agreed, e.g. Called customer, replacing 50 seedlings on Friday" oninput="msgMarkDirty()"></textarea>' +
        '</div>' +
      '</div>' +
    '</div>';

  Object.keys(keep).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = keep[id]; });

  document.getElementById('mmsg-foot').innerHTML =
    (window.__SW_IS_ADMIN__ ? '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);margin-right:auto;" onclick="deleteMessage()">Delete Message</button>' : '<span style="margin-right:auto;"></span>') +
    '<span id="mmsg-dirty" class="msg-pending" style="' + (MSG_DIRTY ? '' : 'display:none;') + 'align-self:center;">Unsaved changes</span>' +
    '<button class="btn btn-outline" onclick="closeMessageModal()">Close</button>' +
    '<button class="btn btn-primary" id="mmsg-save" onclick="saveMessageCase()"' + (MSG_DIRTY ? '' : ' disabled') + '>' + (MSG_DIRTY ? 'Save Changes' : 'Saved') + '</button>';

  if (m.photo_path) {
    var s = await sb.storage.from(MSG_PHOTO_BUCKET).createSignedUrl(m.photo_path, 3600);
    var ph = document.getElementById('mmsg-photo');
    if (ph && MSG_CURRENT === m) {
      ph.innerHTML = s.data && s.data.signedUrl
        ? '<a href="' + s.data.signedUrl + '" target="_blank" rel="noopener"><img src="' + s.data.signedUrl + '" alt="Photo from customer" class="msg-photo"></a>'
        : '<div style="font-size:12px;color:var(--red);margin-top:.6rem;">Photo could not be loaded: ' + esc(s.error && s.error.message || '') + '</div>';
    }
  }
}

async function reloadCurrentMessage() {
  if (!MSG_CURRENT) return;
  var r = await sb.from('salesweb_messages').select('*').eq('id', MSG_CURRENT.id).maybeSingle();
  if (r.data) {
    var i = MSG_ROWS.findIndex(function (x) { return x.id === r.data.id; });
    if (i >= 0) MSG_ROWS[i] = r.data;
    MSG_CURRENT = r.data;
  }
  renderMessageStats();
  renderMessagesTable();
  updateMessagesBadge();
  await renderMessageDetail();
}

// The one Save: assignee, status, linked order and the new note together.
async function saveMessageCase() {
  var m = MSG_CURRENT; if (!m) return;
  var btn = document.getElementById('mmsg-save');
  var hid = document.getElementById('mmsg-handler').value;
  var notify = document.getElementById('mmsg-notify').checked;
  var status = document.getElementById('mmsg-status').value;
  var note = (document.getElementById('mmsg-note').value || '').trim();

  var upd = {}, done = [], sendWa = false;

  if (hid !== '__keep') {
    var h = MSG_HANDLERS.find(function (x) { return x.user_id === hid; });
    var newName = h ? h.name : null, newPhone = h ? (h.phone || null) : null;
    if ((newName || null) !== (m.assigned_name || null) || (newPhone || null) !== (m.assigned_phone || null) || (h ? h.user_id : null) !== (m.assigned_user_id || null)) {
      if (h && notify && !h.phone) { toast(h.name + ' has no WhatsApp number — add one in ⚙ Settings, or untick the WhatsApp box', 'error'); return; }
      upd.assigned_user_id = h ? h.user_id : null;
      upd.handler_id = null;
      upd.assigned_name = newName;
      upd.assigned_phone = newPhone;
      done.push(h ? 'assigned to ' + h.name : 'unassigned');
      if (h && notify) sendWa = true;
      // Picking somebody on a New case means somebody is on it.
      if (h && m.status === 'New' && status === 'New') status = 'In Progress';
    }
  }
  if (status !== m.status) { upd.status = status; done.push('status ' + status); }
  if (MSG_PENDING_ORDER !== undefined && (MSG_PENDING_ORDER || null) !== (m.order_number || null)) {
    upd.order_number = MSG_PENDING_ORDER || null;
    done.push(MSG_PENDING_ORDER ? 'order #' + MSG_PENDING_ORDER : 'order removed');
  }
  if (!Object.keys(upd).length && !note && !sendWa) { toast('Nothing to save'); MSG_DIRTY = false; await renderMessageDetail(); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  if (Object.keys(upd).length) {
    var r = await sb.from('salesweb_messages').update(upd).eq('id', m.id);
    if (r.error) { toast('Error: ' + r.error.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; } return; }
  }
  if (note) {
    var nameEl = document.getElementById('admin-name');
    var n = await sb.from('salesweb_message_events').insert({
      message_id: m.id, kind: 'note', body: note,
      actor_id: window.__SW_USER_ID__, actor_name: nameEl ? nameEl.textContent : null,
    });
    if (n.error) {
      // The case itself is already saved; keep the note so it is not lost.
      toast('Saved, but the note was not: ' + n.error.message, 'error');
      MSG_PENDING_ORDER = undefined;
      await reloadCurrentMessage();
      return;
    }
    done.push('note added');
  }
  MSG_PENDING_ORDER = undefined;
  MSG_DIRTY = false;
  var noteEl = document.getElementById('mmsg-note'); if (noteEl) noteEl.value = '';
  toast('Saved: ' + done.join(', '));
  if (sendWa) await sendCaseWhatsapp(true);
  else await reloadCurrentMessage();
}

async function sendCaseWhatsapp(quiet) {
  var m = MSG_CURRENT; if (!m) return;
  try {
    var r = await sb.functions.invoke('whatsapp', { body: { action: 'send_case', id: m.id } });
    var d = r.data || {};
    if (r.error) toast('WhatsApp: ' + (r.error.message || 'failed'), 'error');
    else if (d.ok) toast('Customer notified on WhatsApp');
    else if (d.not_configured) { if (!quiet) toast('WhatsApp API not set up yet', 'error'); }
    else if (d.disabled) toast('Not sent: the case assigned WhatsApp is switched off on the WhatsApp tab', 'error');
    else toast('WhatsApp: ' + (d.error || 'failed'), 'error');
  } catch (e) {
    toast('WhatsApp: ' + (e.message || e), 'error');
  }
  await reloadCurrentMessage();
}

async function deleteMessage() {
  var m = MSG_CURRENT; if (!m) return;
  if (!confirm('Delete ' + m.ref + ' from ' + m.name + '?\n\nThe message and its timeline are removed for good. To keep a record, set the status to Closed instead.')) return;
  var r = await sb.from('salesweb_messages').delete().eq('id', m.id).select('id');
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  if (!r.data || !r.data.length) { toast('Only a salesweb admin can delete messages', 'error'); return; }
  if (m.photo_path) sb.storage.from(MSG_PHOTO_BUCKET).remove([m.photo_path]);
  MSG_DIRTY = false;
  closeModal('modal-message');
  MSG_CURRENT = null;
  MSG_ROWS = MSG_ROWS.filter(function (x) { return x.id !== m.id; });
  renderMessageStats(); renderMessagesTable(); updateMessagesBadge();
  toast('Deleted');
}

function findMessageOrder() {
  var m = MSG_CURRENT; if (!m || !m.order_number) return;
  if (MSG_DIRTY && !confirm('You have changes that are not saved. Leave this case without saving?')) return;
  MSG_DIRTY = false;
  closeModal('modal-message');
  switchTab('orders', document.getElementById('sb-orders-item'));
  var s = document.getElementById('order-search');
  if (s) { s.value = m.order_number; if (typeof loadOrders === 'function') loadOrders(); }
}

// ── Link an order: a small search under Order # ────────────────────
// Type a customer name, billing name or order number and pick a row.
// The pick waits for Save like everything else on the case, and the
// database trigger then writes "Order linked: #K3M7B0" into the timeline.
function toggleOrderPicker() {
  var box = document.getElementById('mmsg-order-pick'); if (!box) return;
  var open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  if (open) {
    var q = document.getElementById('mmsg-order-q');
    var shown = MSG_PENDING_ORDER === undefined ? (MSG_CURRENT && MSG_CURRENT.order_number) : MSG_PENDING_ORDER;
    if (q && !q.value && MSG_CURRENT) q.value = shown || MSG_CURRENT.name || '';
    if (q) { q.focus(); q.select(); }
    searchMessageOrders();
  }
}

var _msgOrderTimer = null, _msgOrderSeq = 0;
function searchMessageOrders() {
  clearTimeout(_msgOrderTimer);
  _msgOrderTimer = setTimeout(runMessageOrderSearch, 250);
}

async function runMessageOrderSearch() {
  var list = document.getElementById('mmsg-order-list'); if (!list) return;
  // PostgREST or() filters are comma separated, so commas, brackets and
  // wildcards are taken out of what was typed before it goes in one.
  var raw = (document.getElementById('mmsg-order-q').value || '').trim();
  var q = raw.replace(/^#/, '').replace(/[,()%*:"\\]/g, ' ').trim();
  var seq = ++_msgOrderSeq;
  list.innerHTML = '<div class="msg-order-empty">Searching…</div>';
  var query = sb.from('salesweb_customer_orders')
    .select('id,order_number,customer_name,billing_name,total,status,created_at')
    .order('created_at', { ascending: false }).limit(15);
  if (q) query = query.or('order_number.ilike.*' + q + '*,customer_name.ilike.*' + q + '*,billing_name.ilike.*' + q + '*,customer_email.ilike.*' + q + '*');
  var r = await query;
  if (seq !== _msgOrderSeq) return;   // a later keystroke already answered
  if (r.error) { list.innerHTML = '<div class="msg-order-empty" style="color:var(--red);">' + esc(r.error.message) + '</div>'; return; }
  var rows = (r.data || []).filter(function (o) { return o.order_number; });
  if (!rows.length) { list.innerHTML = '<div class="msg-order-empty">No orders match.</div>'; return; }
  list.innerHTML = rows.map(function (o) {
    var who = o.customer_name || o.billing_name || '—';
    return '<div class="msg-order-row" onclick="setMessageOrder(\'' + esc(o.order_number) + '\')">' +
      '<div><strong>#' + esc(o.order_number) + '</strong> · ' + esc(who) +
        (o.billing_name && o.billing_name !== o.customer_name ? ' <span style="color:var(--ink4);">(' + esc(o.billing_name) + ')</span>' : '') + '</div>' +
      '<div class="msg-order-sub">' + fmtDate(o.created_at) + ' · ' + esc(o.status || '') +
        (o.total != null ? ' · RM ' + Number(o.total).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '') + '</div>' +
    '</div>';
  }).join('');
}

function setMessageOrder(orderNumber) {
  var m = MSG_CURRENT; if (!m) return;
  var v = orderNumber || null;
  MSG_PENDING_ORDER = (v === (m.order_number || null)) ? undefined : v;
  msgMarkDirty();
  renderMessageDetail();
}

// ── Settings: notification emails + WhatsApp numbers ───────────────
// A failure here must SAY so: an empty Assigned To list looks exactly
// like "nobody has Messages access", which sends people to the wrong fix.
var MSG_HANDLERS_ERR = '';
async function loadMessageHandlers() {
  var r = await sb.rpc('salesweb_message_assignees');
  MSG_HANDLERS = r.data || [];
  MSG_HANDLERS_ERR = r.error ? (r.error.message || String(r.error)) : '';
  if (r.error) console.error('salesweb_message_assignees:', r.error);
}

async function openMessageSettings() {
  document.getElementById('mms-body').innerHTML = '<div class="loading">Loading…</div>';
  openModal('modal-message-settings');
  await renderMessageSettings();
}

async function renderMessageSettings() {
  await loadMessageHandlers();
  var em = await sb.from('salesweb_message_notify_emails').select('email,created_at').order('created_at');
  var emails = em.data || [];
  var err = em.error ? '<div style="color:var(--red);font-size:12px;">' + esc(em.error.message) + '</div>' : '';
  var src = { messages: 'set here', profile: 'from profile', none: '' };

  document.getElementById('mms-body').innerHTML =
    '<div class="msg-section-title">Email Notifications</div>' +
    '<div style="font-size:12px;color:var(--ink3);margin-bottom:.6rem;">Each address below gets an email when a new message arrives from the Contact Us page.</div>' + err +
    (emails.length ? emails.map(function (e) {
      return '<div class="msg-set-row"><span>' + esc(e.email) + '</span><button class="btn btn-outline btn-sm" onclick="removeNotifyEmail(\'' + encodeURIComponent(e.email) + '\')">Remove</button></div>';
    }).join('') : '<div style="font-size:12px;color:var(--ink4);padding:.4rem 0;">Nobody yet — no email is sent until you add someone.</div>') +
    '<div style="display:flex;gap:.4rem;margin-top:.5rem;"><input class="form-input" id="mms-new-email" type="email" placeholder="name@example.com" onkeydown="if(event.key===\'Enter\')addNotifyEmail()"><button class="btn btn-primary btn-sm" onclick="addNotifyEmail()">Add</button></div>' +

    '<div class="msg-section-title" style="margin-top:1.6rem;">Who Can Be Assigned</div>' +
    '<div style="font-size:12px;color:var(--ink3);margin-bottom:.6rem;">Everyone with <strong>Messages</strong> access in User Access (all admins, and normal users with Messages ticked under Edit Pages). The WhatsApp number is the one they will use to contact the customer — it is what the customer is told.</div>' +
    (MSG_HANDLERS.length ? MSG_HANDLERS.map(function (h) {
      return '<div class="msg-set-row msg-staff-row"><span><strong>' + esc(h.name) + '</strong><span style="font-size:11px;color:var(--ink4);"> · ' + esc(h.level) + (h.phone_source && src[h.phone_source] ? ' · ' + src[h.phone_source] : '') + '</span></span>' +
        '<span style="display:flex;gap:.3rem;"><input class="form-input" id="mms-ph-' + h.user_id + '" type="tel" value="' + esc(h.phone || '') + '" placeholder="WhatsApp number" style="width:150px;padding:5px 8px;font-size:12px;' + (h.phone ? '' : 'border-color:var(--amber);') + '">' +
        '<button class="btn btn-outline btn-sm" onclick="saveStaffPhone(\'' + h.user_id + '\')">Save</button></span></div>';
    }).join('') : (MSG_HANDLERS_ERR ? '<div style="font-size:12px;color:var(--red);padding:.4rem 0;">Could not load the list of staff: ' + esc(MSG_HANDLERS_ERR) + '</div>' : '<div style="font-size:12px;color:var(--ink4);padding:.4rem 0;">Nobody has Messages access yet.</div>'));
}

async function addNotifyEmail() {
  var el = document.getElementById('mms-new-email');
  var e = (el.value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { toast('Enter a valid email address', 'error'); return; }
  var r = await sb.from('salesweb_message_notify_emails').upsert({ email: e }, { onConflict: 'email' });
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  toast('Added ' + e);
  await renderMessageSettings();
}

async function removeNotifyEmail(enc) {
  var e = decodeURIComponent(enc);
  if (!confirm('Stop emailing ' + e + ' about new messages?')) return;
  var r = await sb.from('salesweb_message_notify_emails').delete().eq('email', e);
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  toast('Removed');
  await renderMessageSettings();
}

// The number typed here is kept for the Messages tab only and wins over
// the profile phone. Clearing it goes back to the profile phone.
async function saveStaffPhone(userId) {
  var phone = (document.getElementById('mms-ph-' + userId).value || '').trim();
  var r;
  if (!phone) r = await sb.from('salesweb_message_staff_phone').delete().eq('user_id', userId);
  else {
    var d = waNumber(phone);
    if (d.length < 10 || d.length > 15) { toast('Enter a valid WhatsApp number', 'error'); return; }
    r = await sb.from('salesweb_message_staff_phone').upsert({ user_id: userId, phone: phone, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  toast('Saved');
  await renderMessageSettings();
}
