/* ═══════════════════════════════════════════════════════════════════
   admin-messages.js — the Messages tab: Contact Us enquiries & complaints

   Where a message comes from
     The storefront Contact Us form → salesweb_submit_message() → a row in
     salesweb_messages with a reference like MSG-00042. A logged-in
     customer also sees it, and its status, under My Account → Messages.

   What the office does with it here
     1. Assign it to a PIC and press Save & Send. Settings ⚙ keeps the
        list of people who can be assigned, with their email and the
        WhatsApp number each one uses.
     2. Save & Send emails the PIC the case, and the customer who will
        contact them and from which number (edge function
        message-notify). WhatsApp copies follow once the WhatsApp
        Business number is connected.
     3. The PIC contacts the customer from their OWN WhatsApp (the
        "WhatsApp customer" button), and records what happened as a
        note. Notes are never shown to the customer.
     4. Solve Case closes it off and tells the customer, and the people
        ticked for "Case solved". Status moves New → In Progress →
        Solved (stored as Resolved); nobody picks it by hand.

   The history (status changes, assignments, WhatsApp sends) is written by
   a database trigger, not by this file, so it is the same however the
   row was changed. Settings ⚙ also keeps who is told when a new case
   comes in and when one is solved.

   SQL: supabase/migrations/contact_messages.sql
   ═══════════════════════════════════════════════════════════════════ */

var MSG_ROWS = [];
var MSG_VIEW = 'open';          // open | New | In Progress | Resolved | Closed | all
var MSG_HANDLERS = [];        // the people on the Settings list (salesweb_message_assignees)
var MSG_CURRENT = null;         // the message open in the modal
var MSG_PHOTO_BUCKET = 'contact-message-photos';

// Malaysian numbers as WhatsApp wants them: digits only, country code
// first. Same rule as waNumber() in supabase/functions/message-notify
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

// Whole days since the case came in. A solved case shows how many days
// it took. An open one goes red from 3 days.
function msgRaisedDays(m) {
  var day = 86400000;
  if (!msgIsOpen(m) && m.resolved_at) {
    var took = Math.floor((new Date(m.resolved_at) - new Date(m.created_at)) / day);
    return '<span style="color:var(--ink4);font-size:12px;">took ' + (took < 1 ? 'under a day' : took + ' day' + (took === 1 ? '' : 's')) + '</span>';
  }
  var d = Math.floor((Date.now() - new Date(m.created_at).getTime()) / day);
  var txt = d < 1 ? 'Today' : d + ' day' + (d === 1 ? '' : 's');
  return '<span style="font-weight:700;' + (d >= 3 && msgIsOpen(m) ? 'color:var(--red);' : '') + '">' + txt + '</span>';
}

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
    .select('id,ref,user_id,name,email,phone,subject,kind,message,order_number,photo_path,status,handler_id,assigned_user_id,assigned_name,assigned_phone,assigned_at,wa_status,wa_sent_at,wa_detail,read_at,resolved_at,created_at')
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
    '<div class="stat-box"><div class="stat-body"><div class="stat-label">Solved This Month</div><div class="stat-val green">' + cDone + '</div></div></div>';

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

  // width:0 + min-width:100% lets the table scroll inside its card on a
  // phone instead of widening the whole page.
  host.innerHTML =
    '<div style="overflow-x:auto;width:0;min-width:100%;"><table class="data-table msg-table"><thead><tr>' +
      '<th style="width:14px;"></th><th>Ref</th><th>Received</th><th>From</th><th>Subject</th><th>Assigned To</th><th>Raised Days</th><th>Status</th>' +
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
        '<td style="white-space:nowrap;">' + msgRaisedDays(m) + '</td>' +
        '<td><span class="badge ' + msgStatusBadge(m.status) + '">' + esc(msgStatusLabel(m.status)) + '</span></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table></div>';
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

// ── Case pop-up ─────────────────────────────────────────────────────
// Title row: case number, topic, and the status badge at the right.
// Then one section under the other: ① customer (name, phone, email,
// order # with View), ② the message, ③ case handling (Assigned To +
// Save & Send, which emails the PIC and the customer), ④ the case
// timeline, ⑤ notes, with Save Note for the everyday and Solve Case
// when it is done.
// The status is not picked by hand: Save & Send moves a New case to In
// Progress, Solve Case moves it to Solved (stored as Resolved), and a
// solved case can be reopened from the title row.
// Every change lands in the timeline: the database trigger writes
// status, assignment, order and first-opened entries, notes are their
// own entries, and the message-notify function writes who was emailed.
var MSG_NOTIFY_FN = 'message-notify';

function msgStatusLabel(s) { return s === 'Resolved' ? 'Solved' : s; }

async function openMessage(id) {
  var m = MSG_ROWS.find(function (r) { return r.id === id; });
  if (!m) return;
  MSG_CURRENT = m;
  document.getElementById('mmsg-title').textContent = m.ref + ' · ' + m.subject;
  document.getElementById('mmsg-status-slot').innerHTML = '';
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

// Something typed in Notes, or a person picked and not sent, is unsaved.
function msgUnsaved() {
  var note = document.getElementById('mmsg-note');
  var h = document.getElementById('mmsg-handler');
  var m = MSG_CURRENT;
  if (note && note.value.trim()) return true;
  if (h && m && h.value !== '__keep' && (h.value || null) !== (m.assigned_user_id || null)) return true;
  return false;
}

function closeMessageModal() {
  if (msgUnsaved() && !confirm('You have changes that are not saved. Close without saving?')) return;
  closeModal('modal-message');
}

// Assigned To changed: the button says what pressing it will do.
function msgHandlerChanged() {
  var m = MSG_CURRENT; if (!m) return;
  var sel = document.getElementById('mmsg-handler');
  var btn = document.getElementById('mmsg-send');
  if (!sel || !btn) return;
  var v = sel.value;
  if (v === '__keep') { btn.textContent = 'Send Again'; btn.disabled = false; return; }
  if (!v) { btn.textContent = m.assigned_name ? 'Unassign' : 'Save & Send'; btn.disabled = !m.assigned_name; return; }
  btn.disabled = false;
  btn.textContent = v === m.assigned_user_id ? 'Send Again' : 'Save & Send';
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

var MSG_EV_ICON = { created: '📩', opened: '👁', assign: '👤', status: '🔄', order: '🧾', note: '📝', whatsapp: '💬', email: '✉️', linked: '🔗' };
var MSG_EV_LABEL = { created: 'Received', opened: 'Opened', assign: 'Assignment', status: 'Status', order: 'Order', note: 'Note', whatsapp: 'WhatsApp', email: 'Email', linked: 'Customer account' };

function msgTimelineHtml(m, events) {
  var t0 = new Date(m.created_at).getTime();
  var firstOf = function (kinds) { return events.find(function (e) { return kinds.indexOf(e.kind) >= 0; }); };
  var opened = firstOf(['opened']);
  var assigned = events.filter(function (e) { return e.kind === 'assign' && e.body !== 'Unassigned'; })[0];
  var response = firstOf(['note', 'whatsapp']);
  var steps = [
    { label: 'Received', at: m.created_at, who: m.name },
    { label: 'First opened', at: m.read_at, who: opened && opened.actor_name },
    { label: 'Assigned', at: assigned ? assigned.created_at : m.assigned_at, who: assigned ? assigned.body.replace(/^Assigned to /, '').replace(/ \(.*\)$/, '') : m.assigned_name },
    { label: 'First response', at: response && response.created_at, who: response && response.actor_name },
    { label: (m.status === 'Closed' ? 'Closed' : 'Solved'), at: m.resolved_at, who: null },
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
    var body = e.kind === 'status' ? String(e.body || '').replace(/\bResolved\b/g, 'Solved') : e.body;
    return '<div class="msg-ev msg-ev-' + esc(e.kind) + '">' +
      '<div class="msg-ev-head">' + (MSG_EV_ICON[e.kind] || '•') + ' <strong>' + esc(MSG_EV_LABEL[e.kind] || e.kind) + '</strong> · ' + esc(e.actor_name || 'System') + ' · ' + msgWhen(e.created_at) + '</div>' +
      '<div class="msg-ev-body">' + esc(body) + '</div></div>';
  }).join('') : '<div style="font-size:12px;color:var(--ink4);">Nothing yet.</div>';

  return summary + '<div class="msg-subtitle">Every entry <span>newest first</span></div><div class="msg-history">' + log + '</div>';
}

async function renderMessageDetail() {
  var m = MSG_CURRENT;
  if (!m) return;
  var ev = await sb.from('salesweb_message_events').select('kind,body,actor_name,created_at').eq('message_id', m.id).order('created_at', { ascending: true }).order('id', { ascending: true });
  var events = ev.data || [];

  // A half-typed note, or a person picked and not sent, survives a redraw.
  var keepNote = document.getElementById('mmsg-note'); keepNote = keepNote ? keepNote.value : '';
  var keepH = document.getElementById('mmsg-handler'); keepH = keepH ? keepH.value : null;

  var waCust = waNumber(m.phone);
  var solved = m.status === 'Resolved' || m.status === 'Closed';
  // Assigned To lists the people on the Settings list. Somebody taken off
  // the list stays shown on the cases already assigned to them.
  var current = MSG_HANDLERS.find(function (h) { return h.user_id === m.assigned_user_id; });
  var orphan = m.assigned_name && !current;
  var handlerOpts = '<option value="">— Not assigned —</option>' +
    (orphan ? '<option value="__keep" selected>' + esc(m.assigned_name) + ' — no longer on the list</option>' : '') +
    MSG_HANDLERS.map(function (h) {
      return '<option value="' + h.user_id + '"' + (current && h.user_id === current.user_id ? ' selected' : '') + '>' + esc(h.name) + '</option>';
    }).join('');
  var greeting = 'Hi ' + m.name + ', this is ' + (m.assigned_name || 'MJM Nursery') + ' from MJM Nursery regarding your case ' + m.ref + ' (' + m.subject + ').';
  var lastEmail = events.filter(function (e) { return e.kind === 'email'; }).slice(-1)[0];

  var row = function (k, v) { return '<div class="msg-kv"><span>' + k + '</span><div>' + v + '</div></div>'; };

  document.getElementById('mmsg-status-slot').innerHTML =
    '<span class="badge ' + msgStatusBadge(m.status) + ' msg-status-big">' + esc(msgStatusLabel(m.status)) + '</span>' +
    (solved ? '<a href="#" class="msg-reopen" onclick="reopenMessageCase();return false;">Reopen</a>' : '');

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
            (m.order_number
              ? '<strong>#' + esc(m.order_number) + '</strong> <button class="btn btn-outline btn-sm msg-view-order" onclick="viewCaseOrder()">View</button> <a href="#" onclick="toggleOrderPicker();return false;" style="font-size:11px;">change</a>'
              : '<span style="color:var(--ink4);">—</span> <a href="#" onclick="toggleOrderPicker();return false;" style="font-size:11px;">Link order</a>') +
            '<div class="msg-order-pick" id="mmsg-order-pick" style="display:none;">' +
              '<input class="form-input" id="mmsg-order-q" placeholder="Type a name or order number" autocomplete="off" oninput="searchMessageOrders()">' +
              '<div class="msg-order-list" id="mmsg-order-list"></div>' +
              (m.order_number ? '<a href="#" onclick="setMessageOrder(null);return false;" style="font-size:11px;color:var(--red);">Remove order number</a>' : '') +
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
        // ③ Case handling
        '<div class="msg-card">' +
          '<div class="msg-section-title"><span class="msg-num">3</span> Case Handling</div>' +
          '<label class="msg-field-label" for="mmsg-handler">Assigned To</label>' +
          '<div class="msg-assign-row">' +
            '<select class="form-input" id="mmsg-handler" onchange="msgHandlerChanged()">' + handlerOpts + '</select>' +
            '<button class="btn btn-primary" id="mmsg-send" onclick="sendMessageCase()">Save & Send</button>' +
          '</div>' +
          (MSG_HANDLERS_ERR ? '<div style="font-size:11px;color:var(--red);margin-top:.3rem;">Could not load the list of staff: ' + esc(MSG_HANDLERS_ERR) + '</div>'
            : MSG_HANDLERS.length ? '' : '<div style="font-size:11px;color:var(--ink4);margin-top:.3rem;">Nobody on the list yet. Add people in ⚙ on the Messages tab.</div>') +
          (lastEmail ? '<div class="msg-wa ' + (/Not emailed:/.test(lastEmail.body) ? 'msg-wa-warn' : 'msg-wa-ok') + '">' + esc(lastEmail.body) + ' <span style="opacity:.7;">(' + msgWhen(lastEmail.created_at) + ')</span></div>' : '') +
        '</div>' +
        // ④ Timeline
        '<div class="msg-card">' +
          '<div class="msg-section-title"><span class="msg-num">4</span> Case Timeline</div>' +
          msgTimelineHtml(m, events) +
        '</div>' +
        // ⑤ Notes
        '<div class="msg-card">' +
          '<div class="msg-section-title"><span class="msg-num">5</span> Notes</div>' +
          '<textarea class="form-input" id="mmsg-note" rows="3" placeholder="What was done or agreed, e.g. Called customer, replacing 50 seedlings on Friday"></textarea>' +
          '<div class="msg-note-actions">' +
            '<button class="btn btn-outline" id="mmsg-save-note" onclick="saveMessageNote()">Save Note</button>' +
            (solved ? '' : '<button class="btn btn-primary msg-solve-btn" id="mmsg-solve" onclick="solveMessageCase()">✓ Solve Case</button>') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  if (keepNote) document.getElementById('mmsg-note').value = keepNote;
  var hs = document.getElementById('mmsg-handler');
  if (keepH !== null && hs.querySelector('option[value="' + keepH + '"]')) hs.value = keepH;
  msgHandlerChanged();

  document.getElementById('mmsg-foot').innerHTML =
    (window.__SW_IS_ADMIN__ ? '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);margin-right:auto;" onclick="deleteMessage()">Delete Message</button>' : '<span style="margin-right:auto;"></span>') +
    '<button class="btn btn-outline" onclick="closeMessageModal()">Close</button>';

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

// Calls message-notify and says in a toast who was emailed. The function
// also writes the same thing into the timeline.
async function msgNotify(event) {
  var m = MSG_CURRENT; if (!m) return;
  try {
    var r = await sb.functions.invoke(MSG_NOTIFY_FN, { body: { event: event, id: m.id } });
    if (r.error) {
      var ctx = r.error.context;
      if (ctx && ctx.status === 404) { toast('Saved, but no email was sent: the message-notify function is not in Supabase yet', 'error'); return; }
      var msg = r.error.message || 'failed';
      if (ctx && typeof ctx.json === 'function') { try { var j = await ctx.json(); if (j && j.error) msg = j.error; } catch (e) {} }
      toast('Saved, but the emails failed: ' + msg, 'error');
      return;
    }
    var d = r.data || {};
    var sent = (d.sent || []).join(', ');
    var off = (d.skipped && d.skipped.length) ? ' (' + d.skipped.join('; ') + ')' : '';
    if (d.failed && d.failed.length) toast((sent ? 'Emailed ' + sent + '. ' : '') + 'Not emailed: ' + d.failed.join('; ') + off, 'error');
    else if (sent || off) toast((sent ? 'Emailed ' + sent : 'Nobody emailed') + off);
  } catch (e) {
    toast('Saved, but the emails failed: ' + (e.message || e), 'error');
  }
}

// ③ Save & Send: assign (or send again), then email the PIC and the
// customer. Picking nobody unassigns and sends nothing.
async function sendMessageCase() {
  var m = MSG_CURRENT; if (!m) return;
  var btn = document.getElementById('mmsg-send');
  var v = document.getElementById('mmsg-handler').value;

  if (v === '__keep' || (v && v === m.assigned_user_id)) {
    if (!confirm('Send the emails for ' + m.ref + ' again to ' + m.assigned_name + ' and the customer?')) return;
    btn.disabled = true; btn.textContent = 'Sending…';
    await msgNotify('assigned');
    await reloadCurrentMessage();
    return;
  }

  var h = MSG_HANDLERS.find(function (x) { return x.user_id === v; });
  if (!v) {
    if (!m.assigned_name || !confirm('Take ' + m.ref + ' off ' + m.assigned_name + '? Nobody is emailed.')) return;
  } else if (!h) { toast('Pick somebody from the list', 'error'); return; }
  else if (!h.phone && !confirm(h.name + ' has no WhatsApp number in ⚙ Settings, so the customer will not be given a number to expect. Send anyway?')) return;

  var upd = {
    assigned_user_id: h ? h.user_id : null, handler_id: null,
    assigned_name: h ? h.name : null, assigned_phone: h ? (h.phone || null) : null,
  };
  if (h && m.status === 'New') upd.status = 'In Progress';
  btn.disabled = true; btn.textContent = h ? 'Sending…' : 'Saving…';
  var r = await sb.from('salesweb_messages').update(upd).eq('id', m.id);
  if (r.error) { toast('Error: ' + r.error.message, 'error'); msgHandlerChanged(); return; }
  if (h) { toast('Assigned to ' + h.name); await msgNotify('assigned'); }
  else toast('Unassigned');
  await reloadCurrentMessage();
}

async function insertMessageNote(m, text) {
  var nameEl = document.getElementById('admin-name');
  return sb.from('salesweb_message_events').insert({
    message_id: m.id, kind: 'note', body: text,
    actor_id: window.__SW_USER_ID__, actor_name: nameEl ? nameEl.textContent : null,
  });
}

// ⑤ Save Note: the everyday entry. Nothing else changes.
async function saveMessageNote() {
  var m = MSG_CURRENT; if (!m) return;
  var el = document.getElementById('mmsg-note');
  var text = (el.value || '').trim();
  if (!text) { toast('Write the note first', 'error'); el.focus(); return; }
  var btn = document.getElementById('mmsg-save-note'); btn.disabled = true; btn.textContent = 'Saving…';
  var n = await insertMessageNote(m, text);
  if (n.error) { toast('Error: ' + n.error.message, 'error'); btn.disabled = false; btn.textContent = 'Save Note'; return; }
  el.value = '';
  toast('Note saved');
  await reloadCurrentMessage();
}

// ⑤ Solve Case: the note says how it was solved, then the case is closed
// off and the customer and the "Case solved" people are emailed.
async function solveMessageCase() {
  var m = MSG_CURRENT; if (!m) return;
  var el = document.getElementById('mmsg-note');
  var text = (el.value || '').trim();
  if (!text) { toast('Write in Notes how the case was solved, then press Solve Case', 'error'); el.focus(); return; }
  if (!confirm('Mark ' + m.ref + ' as solved?\n\nThe customer' + (m.email ? ' (' + m.email + ')' : '') + ' and the people ticked for "Case solved" will be told.')) return;
  var btn = document.getElementById('mmsg-solve'); btn.disabled = true; btn.textContent = 'Solving…';
  var n = await insertMessageNote(m, text);
  if (n.error) { toast('Error: ' + n.error.message, 'error'); btn.disabled = false; btn.textContent = '✓ Solve Case'; return; }
  el.value = '';
  var r = await sb.from('salesweb_messages').update({ status: 'Resolved' }).eq('id', m.id);
  if (r.error) { toast('Note saved, but the case is not solved: ' + r.error.message, 'error'); await reloadCurrentMessage(); return; }
  toast(m.ref + ' solved');
  await reloadCurrentMessage();
  await msgNotify('solved');
  await reloadCurrentMessage();
}

async function reopenMessageCase() {
  var m = MSG_CURRENT; if (!m) return;
  if (!confirm('Reopen ' + m.ref + '? It goes back to In Progress. Nobody is emailed.')) return;
  var r = await sb.from('salesweb_messages').update({ status: 'In Progress' }).eq('id', m.id);
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  toast(m.ref + ' reopened');
  await reloadCurrentMessage();
}

async function deleteMessage() {
  var m = MSG_CURRENT; if (!m) return;
  if (!confirm('Delete ' + m.ref + ' from ' + m.name + '?\n\nThe message and its timeline are removed for good. To keep a record, solve it instead.')) return;
  var r = await sb.from('salesweb_messages').delete().eq('id', m.id).select('id');
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  if (!r.data || !r.data.length) { toast('Only a salesweb admin can delete messages', 'error'); return; }
  if (m.photo_path) sb.storage.from(MSG_PHOTO_BUCKET).remove([m.photo_path]);
  closeModal('modal-message');
  MSG_CURRENT = null;
  MSG_ROWS = MSG_ROWS.filter(function (x) { return x.id !== m.id; });
  renderMessageStats(); renderMessagesTable(); updateMessagesBadge();
  toast('Deleted');
}

// ── View the linked order, and come back ────────────────────────────
// The case is hidden, not closed, so whatever was typed in it is still
// there when "Back to case" brings it back.
async function viewCaseOrder() {
  var m = MSG_CURRENT; if (!m || !m.order_number) return;
  var r = await sb.from('salesweb_customer_orders').select('id').eq('order_number', m.order_number).limit(1);
  var o = r.data && r.data[0];
  if (!o) { toast('No order #' + m.order_number + ' found. Use change to link the right one.', 'error'); return; }
  if (typeof viewOrder !== 'function') { toast('The order screen is not loaded', 'error'); return; }
  closeModal('modal-message');
  await viewOrder(o.id);
  var back = '<button class="btn btn-primary msg-back-btn" onclick="backToCase()">← Back to case ' + esc(m.ref) + '</button>';
  var body = document.getElementById('mo-body');
  if (body) body.insertAdjacentHTML('afterbegin', '<div class="msg-back-bar"><span>Viewing the order for case <strong>' + esc(m.ref) + '</strong></span>' + back + '</div>');
  var foot = document.getElementById('mo-foot');
  if (foot) foot.insertAdjacentHTML('afterbegin', '<button class="btn btn-outline" style="margin-right:auto;" onclick="backToCase()">← Back to case</button>');
}

function backToCase() {
  closeModal('modal-order');
  if (MSG_CURRENT) openModal('modal-message');
}

// ── Link an order: a small search under Order # ────────────────────
// Type a customer name, billing name or order number and pick a row. It
// is saved straight away and the database trigger writes "Order linked:
// #K3M7B0" into the timeline.
function toggleOrderPicker() {
  var box = document.getElementById('mmsg-order-pick'); if (!box) return;
  var open = box.style.display === 'none';
  box.style.display = open ? 'block' : 'none';
  if (open) {
    var q = document.getElementById('mmsg-order-q');
    if (q && !q.value && MSG_CURRENT) q.value = MSG_CURRENT.order_number || MSG_CURRENT.name || '';
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

async function setMessageOrder(orderNumber) {
  var m = MSG_CURRENT; if (!m) return;
  var v = orderNumber || null;
  if (v === (m.order_number || null)) { toggleOrderPicker(); return; }
  if (!v && !confirm('Remove order #' + m.order_number + ' from ' + m.ref + '?')) return;
  var r = await sb.from('salesweb_messages').update({ order_number: v }).eq('id', m.id);
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  toast(v ? 'Order #' + v + ' linked' : 'Order number removed');
  await reloadCurrentMessage();
}

// ── Settings: the people who handle cases ──────────────────────────
// One list. Everybody on it can be picked in Assigned To, and each one
// has three ticks: told when a case is assigned to them, when a new case
// comes in, and when a case is solved. People are added from everybody
// with admin portal access.
// Nothing is written until the one Save at the bottom: added and removed
// people, WhatsApp numbers and ticks all go together.
// A failure here must SAY so: an empty Assigned To list looks exactly
// like "nobody added yet", which sends people to the wrong fix.
var MSG_HANDLERS_ERR = '';
var MSG_PORTAL_STAFF = [];    // salesweb_portal_staff()
var MSG_SET = null;           // { rows, orig, hasAssignedCol, err }
var MSG_PIC_PICK = null;      // the name picked in the search, not yet added

async function loadMessageHandlers() {
  var r = await sb.rpc('salesweb_message_assignees');
  MSG_HANDLERS = r.data || [];
  MSG_HANDLERS_ERR = r.error ? (r.error.message || String(r.error)) : '';
  if (r.error) console.error('salesweb_message_assignees:', r.error);
}

async function openMessageSettings() {
  document.getElementById('mms-body').innerHTML = '<div class="loading">Loading…</div>';
  document.getElementById('mms-foot').innerHTML = '';
  openModal('modal-message-settings');
  await loadMessageSettings();
}

async function loadMessageSettings() {
  var res = await Promise.all([
    loadMessageHandlers(),
    sb.from('salesweb_message_pics').select('*'),
    sb.rpc('salesweb_portal_staff'),
  ]);
  var pics = {};
  var picRows = (res[1] && res[1].data) || [];
  picRows.forEach(function (p) { pics[p.user_id] = p; });
  MSG_PORTAL_STAFF = (res[2] && res[2].data) || [];
  // Upon assigned is on unless somebody turned it off. Before
  // contact_messages_part6.sql adds the column it reads as on and is
  // not written.
  var hasCol = picRows.length ? ('notify_assigned' in picRows[0]) : true;
  var rows = MSG_HANDLERS.map(function (h) {
    var p = pics[h.user_id] || {};
    return { user_id: h.user_id, name: h.name, email: h.email, phone: h.phone || '', phone_source: h.phone_source,
             notify_assigned: p.notify_assigned !== false, notify_new: !!p.notify_new, notify_solved: !!p.notify_solved };
  });
  MSG_SET = {
    rows: rows, removed: [], hasAssignedCol: hasCol,
    orig: JSON.stringify(rows),
    err: MSG_HANDLERS_ERR || (res[1] && res[1].error && res[1].error.message) || (res[2] && res[2].error && res[2].error.message) || '',
  };
  MSG_PIC_PICK = null;
  renderMessageSettings();
}

function msgSetDirty() {
  return !!MSG_SET && (MSG_SET.removed.length > 0 || JSON.stringify(MSG_SET.rows) !== MSG_SET.orig);
}

function msgSetRefreshFoot() {
  var b = document.getElementById('mms-save'); if (!b) return;
  var dirty = msgSetDirty();
  b.disabled = !dirty;
  b.textContent = dirty ? 'Save' : 'Saved';
  var w = document.getElementById('mms-dirty'); if (w) w.style.display = dirty ? '' : 'none';
}

function renderMessageSettings() {
  var S = MSG_SET; if (!S) return;
  var tick = function (r, key) {
    if (key === 'notify_assigned' && !S.hasAssignedCol) return '<input type="checkbox" checked disabled title="Run contact_messages_part6.sql to turn this off">';
    return '<input type="checkbox"' + (r[key] ? ' checked' : '') + ' onchange="setPicField(\'' + r.user_id + '\',\'' + key + '\',this.checked)">';
  };
  document.getElementById('mms-body').innerHTML =
    '<div class="msg-section-title">Who Can Be Assigned</div>' +
    '<div class="msg-pic-search">' +
      '<div class="msg-pic-add">' +
        '<input class="form-input" id="mms-pic-q" placeholder="Search a name to add…" autocomplete="off" oninput="MSG_PIC_PICK=null;searchPortalStaff()" onkeydown="if(event.key===\'Enter\'&&MSG_PIC_PICK)addPic()">' +
        '<button class="btn btn-primary" id="mms-pic-add" onclick="addPic()" disabled>Add</button>' +
      '</div>' +
      '<div class="msg-pic-results" id="mms-pic-results" style="display:none;"></div>' +
    '</div>' +
    (S.err ? '<div style="font-size:12px;color:var(--red);padding:.4rem 0;">Could not load: ' + esc(S.err) + '</div>' : '') +
    (S.rows.length
      ? '<div class="msg-pic-table-wrap"><table class="msg-pic-table"><thead><tr><th>Name</th><th>Email</th><th>WhatsApp number</th><th class="c">Upon assigned</th><th class="c">New case</th><th class="c">Case solved</th><th></th></tr></thead><tbody>' +
        S.rows.map(function (r) {
          return '<tr class="msg-staff-row" data-user="' + r.user_id + '">' +
            '<td><strong>' + esc(r.name) + '</strong>' + (r.isNew ? ' <span class="msg-pending">new</span>' : '') + '</td>' +
            '<td class="msg-pic-email">' + esc(r.email || '—') + '</td>' +
            '<td><input class="form-input msg-pic-phone" id="mms-ph-' + r.user_id + '" type="tel" value="' + esc(r.phone) + '" placeholder="e.g. 012-345 6789" oninput="setPicField(\'' + r.user_id + '\',\'phone\',this.value)" style="' + (r.phone ? '' : 'border-color:var(--amber);') + '"></td>' +
            '<td class="c">' + tick(r, 'notify_assigned') + '</td>' +
            '<td class="c">' + tick(r, 'notify_new') + '</td>' +
            '<td class="c">' + tick(r, 'notify_solved') + '</td>' +
            '<td><button class="btn btn-outline btn-sm" style="color:var(--red);" title="Take off the list" onclick="removePic(\'' + r.user_id + '\')">Remove</button></td>' +
          '</tr>';
        }).join('') + '</tbody></table></div>'
      : (S.err ? '' : '<div style="font-size:12px;color:var(--ink4);padding:.6rem 0;">Nobody yet. Search a name above to add them.</div>'));

  document.getElementById('mms-foot').innerHTML =
    '<span id="mms-dirty" class="msg-pending" style="display:none;margin-right:auto;align-self:center;">Unsaved changes</span>' +
    '<button class="btn btn-outline" onclick="closeMessageSettings()">Close</button>' +
    '<button class="btn btn-primary" id="mms-save" onclick="saveMessageSettings()" disabled>Saved</button>';
  msgSetRefreshFoot();
}

// The list only shows once something is typed.
function searchPortalStaff() {
  var box = document.getElementById('mms-pic-results'); if (!box) return;
  var add = document.getElementById('mms-pic-add'); if (add) add.disabled = !MSG_PIC_PICK;
  var q = (document.getElementById('mms-pic-q').value || '').trim().toLowerCase();
  if (!q) { box.style.display = 'none'; box.innerHTML = ''; return; }
  var rows = MSG_PORTAL_STAFF.filter(function (s) {
    if (MSG_SET.rows.some(function (r) { return r.user_id === s.user_id; })) return false;
    return (s.name + ' ' + (s.email || '')).toLowerCase().indexOf(q) >= 0;
  }).slice(0, 12);
  box.style.display = '';
  box.innerHTML = rows.length ? rows.map(function (s) {
    return '<div class="msg-order-row" onclick="pickPic(\'' + s.user_id + '\')"><strong>' + esc(s.name) + '</strong>' +
      '<div class="msg-order-sub">' + esc(s.email || '') + ' · ' + esc(s.level) + '</div></div>';
  }).join('') : '<div class="msg-order-empty">Nobody with admin portal access matches, or they are already on the list.</div>';
}

function pickPic(userId) {
  var s = MSG_PORTAL_STAFF.find(function (x) { return x.user_id === userId; });
  if (!s) return;
  MSG_PIC_PICK = userId;
  document.getElementById('mms-pic-q').value = s.name;
  document.getElementById('mms-pic-results').style.display = 'none';
  var add = document.getElementById('mms-pic-add'); add.disabled = false; add.focus();
}

// Add puts the person on the list here. Save writes it.
function addPic() {
  var s = MSG_PORTAL_STAFF.find(function (x) { return x.user_id === MSG_PIC_PICK; });
  if (!s) { toast('Search and pick a name first', 'error'); return; }
  MSG_SET.removed = MSG_SET.removed.filter(function (id) { return id !== s.user_id; });
  MSG_SET.rows.push({ user_id: s.user_id, name: s.name, email: s.email, phone: '', phone_source: 'none',
                      notify_assigned: true, notify_new: false, notify_solved: false, isNew: true });
  MSG_PIC_PICK = null;
  renderMessageSettings();
  var ph = document.getElementById('mms-ph-' + s.user_id); if (ph) ph.focus();
}

function removePic(userId) {
  var r = MSG_SET.rows.find(function (x) { return x.user_id === userId; }); if (!r) return;
  var open = MSG_ROWS.filter(function (m) { return m.assigned_user_id === userId && msgIsOpen(m); }).length;
  if (open && !confirm(r.name + ' still has ' + open + ' open case' + (open === 1 ? '' : 's') + ', which stay assigned to them. Take them off the list?')) return;
  MSG_SET.rows = MSG_SET.rows.filter(function (x) { return x.user_id !== userId; });
  if (!r.isNew) MSG_SET.removed.push(userId);
  renderMessageSettings();
}

function setPicField(userId, key, value) {
  var r = MSG_SET.rows.find(function (x) { return x.user_id === userId; }); if (!r) return;
  r[key] = key === 'phone' ? String(value) : !!value;
  msgSetRefreshFoot();
}

function closeMessageSettings() {
  if (msgSetDirty() && !confirm('You have changes that are not saved. Close without saving?')) return;
  closeModal('modal-message-settings');
}

// The one Save. A WhatsApp number typed here is kept for the Messages
// tab only and wins over the profile phone; clearing it goes back to the
// profile phone.
async function saveMessageSettings() {
  var S = MSG_SET; if (!S || !msgSetDirty()) return;
  var orig = {}; JSON.parse(S.orig).forEach(function (r) { orig[r.user_id] = r; });
  for (var i = 0; i < S.rows.length; i++) {
    var ph = S.rows[i].phone.trim();
    if (ph && (!orig[S.rows[i].user_id] || ph !== orig[S.rows[i].user_id].phone)) {
      var d = waNumber(ph);
      if (d.length < 10 || d.length > 15) { toast('Check the WhatsApp number for ' + S.rows[i].name, 'error'); document.getElementById('mms-ph-' + S.rows[i].user_id).focus(); return; }
    }
  }
  var btn = document.getElementById('mms-save'); btn.disabled = true; btn.textContent = 'Saving…';
  var nameEl = document.getElementById('admin-name');
  var who = nameEl ? nameEl.textContent : null;
  var fail = function (what, err) { toast('Not saved (' + what + '): ' + err.message, 'error'); msgSetRefreshFoot(); };

  if (S.removed.length) {
    var del = await sb.from('salesweb_message_pics').delete().in('user_id', S.removed);
    if (del.error) return fail('remove', del.error);
  }
  var picRows = S.rows.filter(function (r) {
    var o = orig[r.user_id];
    return r.isNew || !o || o.notify_assigned !== r.notify_assigned || o.notify_new !== r.notify_new || o.notify_solved !== r.notify_solved;
  }).map(function (r) {
    var row = { user_id: r.user_id, notify_new: r.notify_new, notify_solved: r.notify_solved };
    if (S.hasAssignedCol) row.notify_assigned = r.notify_assigned;
    if (r.isNew) row.added_by = who;
    return row;
  });
  if (picRows.length) {
    var up = await sb.from('salesweb_message_pics').upsert(picRows, { onConflict: 'user_id' });
    if (up.error) return fail('list', up.error);
  }
  for (var j = 0; j < S.rows.length; j++) {
    var r = S.rows[j], o = orig[r.user_id], phone = r.phone.trim();
    if (o ? phone === (o.phone || '') : !phone) continue;
    var w = phone
      ? await sb.from('salesweb_message_staff_phone').upsert({ user_id: r.user_id, phone: phone, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      : await sb.from('salesweb_message_staff_phone').delete().eq('user_id', r.user_id);
    if (w.error) return fail('WhatsApp number for ' + r.name, w.error);
  }
  toast('Settings saved');
  await loadMessageSettings();
}

// Close the name search when clicking anywhere else.
document.addEventListener('click', function (e) {
  var box = document.getElementById('mms-pic-results');
  if (box && box.style.display !== 'none' && !e.target.closest('.msg-pic-search')) box.style.display = 'none';
});
