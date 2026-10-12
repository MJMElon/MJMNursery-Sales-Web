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
        (edge function send-case-whatsapp) saying who will handle it and
        the number they will be contacted from. Until the WhatsApp API is
        registered that step reports "not set up" and offers to open
        WhatsApp by hand — nothing breaks.
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
var MSG_HANDLERS = [];
var MSG_CURRENT = null;         // the message open in the modal
var MSG_PHOTO_BUCKET = 'contact-message-photos';
var MSG_STATUSES = ['New', 'In Progress', 'Resolved', 'Closed'];

// Malaysian numbers as WhatsApp wants them: digits only, country code
// first. Same rule as waNumber() in supabase/functions/send-case-whatsapp
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
async function openMessage(id) {
  var m = MSG_ROWS.find(function (r) { return r.id === id; });
  if (!m) return;
  MSG_CURRENT = m;
  document.getElementById('mmsg-title').textContent = m.ref + ' — ' + m.subject;
  document.getElementById('mmsg-body').innerHTML = '<div class="loading">Loading…</div>';
  openModal('modal-message');

  if (!m.read_at) {
    var now = new Date().toISOString();
    m.read_at = now;
    sb.from('salesweb_messages').update({ read_at: now }).eq('id', id).then(function () { renderMessagesTable(); updateMessagesBadge(); });
  }
  if (!MSG_HANDLERS.length) await loadMessageHandlers();
  await renderMessageDetail();
}

async function renderMessageDetail() {
  var m = MSG_CURRENT;
  if (!m) return;
  var ev = await sb.from('salesweb_message_events').select('kind,body,actor_name,created_at').eq('message_id', m.id).order('created_at', { ascending: true });
  var events = ev.data || [];

  var waCust = waNumber(m.phone);
  // A handler removed from Settings leaves the case with the name it was
  // assigned under and no handler_id. Show that as the current choice so
  // pressing Save does not quietly unassign it.
  var orphan = m.assigned_name && !MSG_HANDLERS.some(function (h) { return h.id === m.handler_id; });
  var handlerOpts = '<option value="">— Not assigned —</option>' +
    (orphan ? '<option value="__keep" selected>' + esc(m.assigned_name) + ' (' + esc(m.assigned_phone || '') + ') — no longer in the list</option>' : '') +
    MSG_HANDLERS.filter(function (h) { return h.active || h.id === m.handler_id; }).map(function (h) {
    return '<option value="' + h.id + '"' + (h.id === m.handler_id ? ' selected' : '') + '>' + esc(h.name) + ' (' + esc(h.phone) + ')</option>';
  }).join('');
  var greeting = 'Hi ' + m.name + ', this is ' + (m.assigned_name || 'MJM Nursery') + ' from MJM Nursery regarding your message ' + m.ref + ' (' + m.subject + ').';

  var waLine = '';
  if (m.wa_status === 'sent') waLine = '<div class="msg-wa msg-wa-ok">✓ Customer was told on WhatsApp who is handling this (' + msgWhen(m.wa_sent_at) + ').</div>';
  else if (m.wa_status === 'not_configured') waLine = '<div class="msg-wa msg-wa-warn">WhatsApp API not set up yet — the customer was <strong>not</strong> messaged automatically. ' +
      (waCust ? '<a href="https://wa.me/' + waCust + '?text=' + encodeURIComponent('Hi ' + m.name + ', thank you for contacting MJM Nursery. Your case ' + m.ref + ' has been assigned to ' + m.assigned_name + ', who will contact you on WhatsApp from +' + waNumber(m.assigned_phone) + ' shortly.') + '" target="_blank" rel="noopener">Send it by hand</a>.' : '') + '</div>';
  else if (m.wa_status === 'failed') waLine = '<div class="msg-wa msg-wa-err">WhatsApp to customer failed: ' + esc(m.wa_detail || '') + ' <button class="btn btn-outline btn-sm" onclick="sendCaseWhatsapp()">Try again</button></div>';

  var row = function (k, v) { return '<div class="msg-kv"><span>' + k + '</span><div>' + v + '</div></div>'; };

  document.getElementById('mmsg-body').innerHTML =
    '<div class="msg-grid">' +
      '<div>' +
        '<div class="msg-section-title">Message</div>' +
        (m.kind === 'complaint' ? '<div style="margin-bottom:.5rem;"><span class="badge badge-red">' + esc(m.subject) + '</span></div>' : '') +
        '<div class="msg-text">' + esc(m.message) + '</div>' +
        '<div id="mmsg-photo"></div>' +
        '<div class="msg-section-title" style="margin-top:1.2rem;">Internal Notes &amp; History <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--ink4);">— staff only, never shown to the customer</span></div>' +
        '<div class="msg-history">' + (events.length ? events.map(function (e) {
          return '<div class="msg-ev msg-ev-' + esc(e.kind) + '"><div class="msg-ev-head"><strong>' + esc(e.actor_name || 'System') + '</strong> · ' + msgWhen(e.created_at) + '</div><div class="msg-ev-body">' + esc(e.body) + '</div></div>';
        }).join('') : '<div style="font-size:12px;color:var(--ink4);">Nothing yet.</div>') + '</div>' +
        '<textarea class="form-input" id="mmsg-note" rows="2" placeholder="Add an internal note, e.g. Called customer, replacing 50 seedlings on Friday" style="margin-top:.6rem;"></textarea>' +
        '<div style="text-align:right;margin-top:.4rem;"><button class="btn btn-outline btn-sm" onclick="addMessageNote()">Add Note</button></div>' +
      '</div>' +
      '<div>' +
        '<div class="msg-section-title">Customer</div>' +
        row('Name', esc(m.name) + (m.user_id ? ' <span class="badge badge-blue">member</span>' : '')) +
        row('Phone', esc(m.phone || '—')) +
        row('Email', m.email ? '<a href="mailto:' + esc(m.email) + '?subject=' + encodeURIComponent('Re: ' + m.ref + ' ' + m.subject) + '">' + esc(m.email) + '</a>' : '—') +
        (m.order_number ? row('Order #', esc(m.order_number) + ' <a href="#" onclick="findMessageOrder();return false;" style="font-size:11px;">find order</a>') : '') +
        row('Received', msgWhen(m.created_at)) +
        '<div style="display:flex;gap:.4rem;flex-wrap:wrap;margin:.6rem 0 1rem;">' +
          (waCust ? '<a class="btn btn-primary btn-sm msg-wa-btn" href="https://wa.me/' + waCust + '?text=' + encodeURIComponent(greeting) + '" target="_blank" rel="noopener">WhatsApp Customer</a>' : '') +
          (m.email ? '<a class="btn btn-outline btn-sm" href="mailto:' + esc(m.email) + '?subject=' + encodeURIComponent('Re: ' + m.ref + ' ' + m.subject) + '">Email</a>' : '') +
        '</div>' +

        '<div class="msg-section-title">Assigned To</div>' +
        '<select class="form-input" id="mmsg-handler">' + handlerOpts + '</select>' +
        (MSG_HANDLERS.length ? '' : '<div style="font-size:11px;color:var(--ink4);margin-top:.3rem;">No handlers yet — add them in ⚙ Settings.</div>') +
        '<label style="display:flex;gap:.4rem;align-items:center;font-size:12px;margin-top:.5rem;"><input type="checkbox" id="mmsg-notify" checked> Tell the customer on WhatsApp who will handle it</label>' +
        '<button class="btn btn-primary btn-sm" style="margin-top:.5rem;width:100%;" onclick="assignMessage()">Save Assignment</button>' +
        waLine +

        '<div class="msg-section-title" style="margin-top:1.2rem;">Status</div>' +
        '<div style="display:flex;gap:.4rem;">' +
          '<select class="form-input" id="mmsg-status">' + MSG_STATUSES.map(function (s) { return '<option' + (s === m.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
          '<button class="btn btn-outline btn-sm" onclick="saveMessageStatus()">Save</button>' +
        '</div>' +
        (m.resolved_at ? '<div style="font-size:11px;color:var(--ink4);margin-top:.3rem;">' + esc(m.status) + ' ' + msgWhen(m.resolved_at) + '</div>' : '') +
        (window.__SW_IS_ADMIN__ ? '<div style="margin-top:1.4rem;text-align:right;"><button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);" onclick="deleteMessage()">Delete Message</button></div>' : '') +
      '</div>' +
    '</div>';

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

async function assignMessage() {
  var m = MSG_CURRENT; if (!m) return;
  var hid = document.getElementById('mmsg-handler').value;
  var notify = document.getElementById('mmsg-notify').checked;
  if (hid === '__keep') {
    if (notify && m.wa_status !== 'sent') await sendCaseWhatsapp();
    else toast('Nothing changed');
    return;
  }
  var h = MSG_HANDLERS.find(function (x) { return x.id === hid; });
  var upd = h
    ? { handler_id: h.id, assigned_name: h.name, assigned_phone: h.phone }
    : { handler_id: null, assigned_name: null, assigned_phone: null };
  var changed = (upd.assigned_name || null) !== (m.assigned_name || null) || (upd.assigned_phone || null) !== (m.assigned_phone || null);
  // Picking somebody on a New case means somebody is on it.
  if (h && m.status === 'New') upd.status = 'In Progress';
  if (!changed && !upd.status && !(h && notify)) { toast('Nothing changed'); return; }

  if (changed || upd.status) {
    var r = await sb.from('salesweb_messages').update(upd).eq('id', m.id);
    if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  }
  toast(h ? 'Assigned to ' + h.name : 'Unassigned');
  if (h && notify && (changed || m.wa_status !== 'sent')) await sendCaseWhatsapp(true);
  else await reloadCurrentMessage();
}

async function sendCaseWhatsapp(quiet) {
  var m = MSG_CURRENT; if (!m) return;
  try {
    var r = await sb.functions.invoke('send-case-whatsapp', { body: { id: m.id } });
    var d = r.data || {};
    if (r.error) toast('WhatsApp: ' + (r.error.message || 'failed'), 'error');
    else if (d.ok) toast('Customer notified on WhatsApp');
    else if (d.not_configured) { if (!quiet) toast('WhatsApp API not set up yet', 'error'); }
    else toast('WhatsApp: ' + (d.error || 'failed'), 'error');
  } catch (e) {
    toast('WhatsApp: ' + (e.message || e), 'error');
  }
  await reloadCurrentMessage();
}

async function saveMessageStatus() {
  var m = MSG_CURRENT; if (!m) return;
  var s = document.getElementById('mmsg-status').value;
  if (s === m.status) { toast('Status unchanged'); return; }
  var r = await sb.from('salesweb_messages').update({ status: s }).eq('id', m.id);
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  toast('Status: ' + s);
  await reloadCurrentMessage();
}

async function addMessageNote() {
  var m = MSG_CURRENT; if (!m) return;
  var el = document.getElementById('mmsg-note');
  var body = (el.value || '').trim();
  if (!body) { toast('Write a note first', 'error'); return; }
  var nameEl = document.getElementById('admin-name');
  var r = await sb.from('salesweb_message_events').insert({
    message_id: m.id, kind: 'note', body: body,
    actor_id: window.__SW_USER_ID__, actor_name: nameEl ? nameEl.textContent : null,
  });
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  el.value = '';
  toast('Note added');
  await renderMessageDetail();
}

async function deleteMessage() {
  var m = MSG_CURRENT; if (!m) return;
  if (!confirm('Delete ' + m.ref + ' from ' + m.name + '?\n\nThe message and its notes are removed for good. To keep a record, set the status to Closed instead.')) return;
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

function findMessageOrder() {
  var m = MSG_CURRENT; if (!m || !m.order_number) return;
  closeModal('modal-message');
  switchTab('orders', document.getElementById('sb-orders-item'));
  var s = document.getElementById('order-search');
  if (s) { s.value = m.order_number; if (typeof loadOrders === 'function') loadOrders(); }
}

// ── Settings: handlers + notification emails ────────────────────────
async function loadMessageHandlers() {
  var r = await sb.from('salesweb_message_handlers').select('*').order('name');
  MSG_HANDLERS = r.data || [];
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

  document.getElementById('mms-body').innerHTML =
    '<div class="msg-section-title">Email Notifications</div>' +
    '<div style="font-size:12px;color:var(--ink3);margin-bottom:.6rem;">Each address below gets an email when a new message arrives from the Contact Us page.</div>' + err +
    (emails.length ? emails.map(function (e) {
      return '<div class="msg-set-row"><span>' + esc(e.email) + '</span><button class="btn btn-outline btn-sm" onclick="removeNotifyEmail(\'' + encodeURIComponent(e.email) + '\')">Remove</button></div>';
    }).join('') : '<div style="font-size:12px;color:var(--ink4);padding:.4rem 0;">Nobody yet — no email is sent until you add someone.</div>') +
    '<div style="display:flex;gap:.4rem;margin-top:.5rem;"><input class="form-input" id="mms-new-email" type="email" placeholder="name@example.com" onkeydown="if(event.key===\'Enter\')addNotifyEmail()"><button class="btn btn-primary btn-sm" onclick="addNotifyEmail()">Add</button></div>' +

    '<div class="msg-section-title" style="margin-top:1.6rem;">Case Handlers</div>' +
    '<div style="font-size:12px;color:var(--ink3);margin-bottom:.6rem;">The people a message can be assigned to. The WhatsApp number is the one they will use to contact the customer — it is what the customer is told.</div>' +
    (MSG_HANDLERS.length ? MSG_HANDLERS.map(function (h) {
      return '<div class="msg-set-row"' + (h.active ? '' : ' style="opacity:.55;"') + '><span><strong>' + esc(h.name) + '</strong> · ' + esc(h.phone) + (h.active ? '' : ' (inactive)') + '</span>' +
        '<span style="display:flex;gap:.3rem;"><button class="btn btn-outline btn-sm" onclick="toggleHandler(\'' + h.id + '\',' + (!h.active) + ')">' + (h.active ? 'Deactivate' : 'Activate') + '</button>' +
        '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);" onclick="removeHandler(\'' + h.id + '\')">Remove</button></span></div>';
    }).join('') : '<div style="font-size:12px;color:var(--ink4);padding:.4rem 0;">No handlers yet.</div>') +
    '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:.4rem;margin-top:.5rem;"><input class="form-input" id="mms-h-name" placeholder="Name"><input class="form-input" id="mms-h-phone" type="tel" placeholder="WhatsApp e.g. 012-345 6789"><button class="btn btn-primary btn-sm" onclick="addHandler()">Add</button></div>';
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

async function addHandler() {
  var name = (document.getElementById('mms-h-name').value || '').trim();
  var phone = (document.getElementById('mms-h-phone').value || '').trim();
  if (!name) { toast('Enter a name', 'error'); return; }
  var d = waNumber(phone);
  if (d.length < 10 || d.length > 15) { toast('Enter a valid WhatsApp number', 'error'); return; }
  var r = await sb.from('salesweb_message_handlers').insert({ name: name, phone: phone });
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  toast('Added ' + name);
  await renderMessageSettings();
}

async function toggleHandler(id, active) {
  var r = await sb.from('salesweb_message_handlers').update({ active: active }).eq('id', id);
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  await renderMessageSettings();
}

async function removeHandler(id) {
  var h = MSG_HANDLERS.find(function (x) { return x.id === id; });
  if (!confirm('Remove ' + (h ? h.name : 'this handler') + '?\n\nCases already assigned keep the name and number they were assigned with. Use Deactivate instead to keep them in the list.')) return;
  var r = await sb.from('salesweb_message_handlers').delete().eq('id', id);
  if (r.error) { toast('Error: ' + r.error.message, 'error'); return; }
  await renderMessageSettings();
}
