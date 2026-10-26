/* ═══════════════════════════════════════════════════════════════════
   admin-whatsapp.js — the WhatsApp tab: the nursery WhatsApp Business
   number, what it sends automatically, the templates, and a log.

   Sections
     Connection           is the WhatsApp API connected, which number
     Automatic Messages   one row per message the system sends by itself:
                          switched on or off, which approved template,
                          and a test send to any number
     Templates            the templates on the WhatsApp account, read live
                          from Meta. New and edited ones go to Meta for
                          approval, and show Pending until Meta answers.
     Sent Log             every WhatsApp the system sent, or failed to

   Everything that talks to Meta goes through the edge function called
   whatsapp (supabase/functions/whatsapp). The switches and template
   choices are salesweb_wa_events, the log is salesweb_wa_log
   (supabase/migrations/whatsapp_settings.sql).

   Templates written here use NAMED fields — {{customer_name}} — inserted
   with the field buttons, so the text says what goes where.
   ═══════════════════════════════════════════════════════════════════ */

// The automatic messages and the fields each one can fill. Same list as
// EVENTS in supabase/functions/whatsapp/index.ts — change both.
var WA_EVENTS = [
  { key: 'case_assigned', label: 'Case assigned',
    desc: 'Sent to the customer when a Contact Us case is assigned on the Messages tab, saying who will contact them and from which number.',
    fields: ['customer_name', 'case_ref', 'staff_name', 'staff_phone'],
    samples: { customer_name: 'Tan Ah Kow', case_ref: 'MSG-00042', staff_name: 'Mei Ling', staff_phone: '+60123456789' },
    suggest: 'Hi {{customer_name}}, thank you for contacting MJM Nursery. Your case {{case_ref}} has been assigned to {{staff_name}}, who will WhatsApp you from {{staff_phone}} shortly.' },
  { key: 'collection_reminder', label: 'Collection reminder', soon: true,
    desc: 'Sent to the customer the day before their booked collection.' },
  { key: 'delivery_order', label: 'New Delivery Order', soon: true,
    desc: 'Sent to the customer when a Delivery Order is issued.' },
  { key: 'low_stock', label: 'Low stock alert', soon: true,
    desc: 'Sent to the staff numbers you list when stock in the AI system drops below its baseline.' },
];

var WA_FIELD_LABELS = {
  customer_name: 'Customer name', case_ref: 'Case ref', staff_name: 'Staff name', staff_phone: 'Staff phone',
};

var WA_LANGS = [{ code: 'en', label: 'English' }, { code: 'ms', label: 'Malay' }, { code: 'zh_CN', label: 'Chinese (Simplified)' }];

var WA_STATUS = null;        // answer of the status action
var WA_TEMPLATES = [];       // from Meta
var WA_TEMPLATES_ERR = '';
var WA_EVENT_ROWS = {};      // key → salesweb_wa_events row
var WA_EDIT = null;          // template being edited in the modal, or null for a new one

async function waCall(body) {
  try {
    var r = await sb.functions.invoke('whatsapp', { body: body });
    if (r.error) {
      // A function that is not deployed yet answers 404 — say what to do.
      var msg = r.error.message || String(r.error);
      var ctx = r.error.context;
      if (ctx && ctx.status === 404) return { ok: false, not_deployed: true, error: 'the whatsapp function is not deployed in Supabase yet' };
      if (ctx && typeof ctx.json === 'function') { try { var j = await ctx.json(); if (j && j.error) msg = j.error; } catch (e) {} }
      return { ok: false, error: msg };
    }
    return r.data || { ok: false, error: 'no answer' };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

function waLangLabel(code) {
  var l = WA_LANGS.find(function (x) { return x.code === code; });
  return l ? l.label : code;
}

function waStatusBadge(s) {
  var cls = { APPROVED: 'badge-green', PENDING: 'badge-amber', REJECTED: 'badge-red', PAUSED: 'badge-amber', DISABLED: 'badge-grey' }[s] || 'badge-grey';
  var txt = { APPROVED: 'Approved', PENDING: 'Waiting for Meta', REJECTED: 'Rejected', PAUSED: 'Paused', DISABLED: 'Disabled' }[s] || (s || '—');
  return '<span class="badge ' + cls + '">' + esc(txt) + '</span>';
}

function waBodyOf(t) {
  var b = (t.components || []).find(function (c) { return c.type === 'BODY'; });
  return b ? b.text || '' : '';
}
function waFooterOf(t) {
  var f = (t.components || []).find(function (c) { return c.type === 'FOOTER'; });
  return f ? f.text || '' : '';
}

function waFieldsIn(text) {
  var out = [], re = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, m;
  while ((m = re.exec(String(text || '')))) if (out.indexOf(m[1]) < 0) out.push(m[1]);
  return out;
}

// The message as the customer would read it, with sample values in.
function waPreview(text, samples) {
  return esc(text || '').replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, function (all, f) {
    var v = samples && samples[f];
    return v ? '<strong>' + esc(v) + '</strong>' : '<span class="wa-unknown">' + all + '</span>';
  }).replace(/\n/g, '<br>');
}

async function loadWhatsapp() {
  var root = document.getElementById('wa-root'); if (!root) return;
  root.innerHTML = '<div class="loading">Loading…</div>';
  var res = await Promise.all([
    waCall({ action: 'status' }),
    waCall({ action: 'templates' }),
    sb.from('salesweb_wa_events').select('*'),
  ]);
  WA_STATUS = res[0];
  WA_TEMPLATES = (res[1] && res[1].templates) || [];
  WA_TEMPLATES_ERR = res[1] && !res[1].ok && !res[1].not_configured && !res[1].not_deployed ? (res[1].error || '') : '';
  WA_EVENT_ROWS = {};
  ((res[2] && res[2].data) || []).forEach(function (r) { WA_EVENT_ROWS[r.key] = r; });
  var evErr = res[2] && res[2].error ? res[2].error.message : '';
  renderWhatsapp(evErr);
  loadWaLog();
}

function renderWhatsapp(evErr) {
  var root = document.getElementById('wa-root'); if (!root) return;
  root.innerHTML =
    '<div class="card">' + waConnectionHtml() + '</div>' +
    '<div class="card"><div class="wa-card-head"><div class="msg-section-title" style="margin:0;">Automatic Messages</div></div>' +
      (evErr ? '<div class="msg-wa msg-wa-err">Could not read the settings: ' + esc(evErr) + '. Has whatsapp_settings.sql been run in Supabase?</div>' : '') +
      WA_EVENTS.map(waEventRowHtml).join('') + '</div>' +
    '<div class="card"><div class="wa-card-head"><div class="msg-section-title" style="margin:0;">Templates</div>' +
      '<button class="btn btn-primary btn-sm" onclick="openWaTemplate()"' + (waConnected() ? '' : ' disabled') + '>+ New Template</button></div>' +
      '<div class="wa-hint">WhatsApp only lets a business start a chat with a template Meta has approved. A new template, or an edit, goes to Meta first — usually minutes, sometimes a few hours. An approved template can be edited about once a day.</div>' +
      waTemplatesHtml() + '</div>' +
    '<div class="card"><div class="wa-card-head"><div class="msg-section-title" style="margin:0;">Sent Log</div><span class="wa-hint" style="margin:0;">Last 100</span></div>' +
      '<div id="wa-log"><div class="loading">Loading…</div></div></div>';
}

function waConnected() { return !!(WA_STATUS && WA_STATUS.ok); }

function waConnectionHtml() {
  var s = WA_STATUS || {};
  var head = '<div class="msg-section-title" style="margin-top:0;">Connection</div>';
  if (s.ok) {
    var p = s.phone || {};
    return head + '<div class="msg-wa msg-wa-ok" style="margin-top:0;">✓ Connected — <strong>' + esc(p.verified_name || 'WhatsApp Business') + '</strong> ' +
      esc(p.display_phone_number || '') + (p.quality_rating ? ' · quality ' + esc(String(p.quality_rating).toLowerCase()) : '') + '</div>';
  }
  if (s.not_deployed) {
    return head + '<div class="msg-wa msg-wa-warn" style="margin-top:0;">Not connected yet — the <strong>whatsapp</strong> function has not been put into Supabase. ' +
      'Supabase → Edge Functions → Deploy a new function → Via editor, name it <code>whatsapp</code>, paste supabase/functions/whatsapp/index.ts and Deploy.</div>';
  }
  if (s.not_configured) {
    return head + '<div class="msg-wa msg-wa-warn" style="margin-top:0;">Not connected yet — these keys are missing in Supabase → Edge Functions → Secrets: <strong>' +
      esc((s.missing || []).join(', ')) + '</strong>. They come from developers.facebook.com → your app → WhatsApp → API Setup, and a System User token from Business Settings.</div>';
  }
  return head + '<div class="msg-wa msg-wa-err" style="margin-top:0;">Could not reach WhatsApp: ' + esc(s.error || 'no answer') + '</div>';
}

function waEventRowHtml(ev) {
  if (ev.soon) {
    return '<div class="wa-event wa-event-soon"><div class="wa-event-main"><div><strong>' + esc(ev.label) + '</strong> <span class="badge badge-grey">Coming next</span></div>' +
      '<div class="wa-hint" style="margin:0;">' + esc(ev.desc) + '</div></div></div>';
  }
  var row = WA_EVENT_ROWS[ev.key] || {};
  var cur = row.template_name ? row.template_name + '|' + (row.template_lang || 'en') : '';
  var approved = WA_TEMPLATES.filter(function (t) { return t.status === 'APPROVED'; });
  var haveCur = !cur || approved.some(function (t) { return t.name + '|' + t.language === cur; });
  var opts = '<option value="">— Pick a template —</option>' +
    (haveCur ? '' : '<option value="' + esc(cur) + '" selected>' + esc(row.template_name) + ' (' + esc(waLangLabel(row.template_lang)) + ')' +
      (waConnected() ? ' — not approved or not found' : '') + '</option>') +
    approved.map(function (t) {
      var v = t.name + '|' + t.language;
      return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t.name) + ' (' + esc(waLangLabel(t.language)) + ')</option>';
    }).join('');
  var curTpl = WA_TEMPLATES.find(function (t) { return t.name + '|' + t.language === cur; });
  var unfillable = curTpl ? waFieldsIn(waBodyOf(curTpl)).filter(function (f) { return !/^\d+$/.test(f) && ev.fields.indexOf(f) < 0; }) : [];
  return '<div class="wa-event">' +
    '<div class="wa-event-main">' +
      '<div><strong>' + esc(ev.label) + '</strong> ' + (row.enabled ? '<span class="badge badge-green">On</span>' : '<span class="badge badge-grey">Off</span>') + '</div>' +
      '<div class="wa-hint" style="margin:0;">' + esc(ev.desc) + '</div>' +
      (curTpl ? '<div class="wa-bubble wa-bubble-sm">' + waPreview(waBodyOf(curTpl), ev.samples) + '</div>' : '') +
      (unfillable.length ? '<div class="msg-wa msg-wa-err">This template asks for ' + esc(unfillable.map(function (f) { return '{{' + f + '}}'; }).join(', ')) + ', which this message cannot fill. Pick another template.</div>' : '') +
    '</div>' +
    '<div class="wa-event-ctl">' +
      '<label class="wa-switch"><input type="checkbox" ' + (row.enabled ? 'checked' : '') + ' onchange="saveWaEvent(\'' + ev.key + '\')" id="wa-on-' + ev.key + '"> Send automatically</label>' +
      '<select class="form-input" id="wa-tpl-' + ev.key + '" onchange="saveWaEvent(\'' + ev.key + '\')">' + opts + '</select>' +
      '<div style="display:flex;gap:.3rem;"><input class="form-input" type="tel" id="wa-test-' + ev.key + '" placeholder="Your WhatsApp number" style="flex:1;min-width:0;">' +
        '<button class="btn btn-outline btn-sm" onclick="sendWaTest(\'' + ev.key + '\')"' + (waConnected() ? '' : ' disabled') + '>Send test</button></div>' +
    '</div>' +
  '</div>';
}

function waTemplatesHtml() {
  if (!waConnected()) return '<div class="wa-hint">Templates show here once WhatsApp is connected.</div>';
  if (WA_TEMPLATES_ERR) return '<div class="msg-wa msg-wa-err">Could not read the templates: ' + esc(WA_TEMPLATES_ERR) + '</div>';
  if (!WA_TEMPLATES.length) return '<div class="wa-hint">No templates yet. Press <strong>+ New Template</strong> to write the first one.</div>';
  var used = {};
  Object.keys(WA_EVENT_ROWS).forEach(function (k) { var r = WA_EVENT_ROWS[k]; if (r.template_name) used[r.template_name + '|' + r.template_lang] = k; });
  var samples = {};
  WA_EVENTS.forEach(function (e) { Object.assign(samples, e.samples || {}); });
  return WA_TEMPLATES.map(function (t, i) {
    var ev = WA_EVENTS.find(function (e) { return e.key === used[t.name + '|' + t.language]; });
    var footer = waFooterOf(t);
    return '<div class="wa-tpl">' +
      '<div class="wa-tpl-head"><div><strong>' + esc(t.name) + '</strong> <span class="wa-hint" style="margin:0;display:inline;">· ' + esc(waLangLabel(t.language)) + ' · ' + esc(String(t.category || '').toLowerCase()) + '</span></div>' +
        '<div style="display:flex;gap:.3rem;align-items:center;">' + waStatusBadge(t.status) +
          '<button class="btn btn-outline btn-sm" onclick="openWaTemplate(' + i + ')">Edit</button>' +
          '<button class="btn btn-outline btn-sm" onclick="deleteWaTemplate(' + i + ')">Delete</button></div></div>' +
      (ev ? '<div class="wa-hint" style="margin:.2rem 0 0;">Used for: <strong>' + esc(ev.label) + '</strong></div>' : '') +
      (t.status === 'REJECTED' && t.rejected_reason && t.rejected_reason !== 'NONE' ? '<div class="msg-wa msg-wa-err">Meta rejected it: ' + esc(String(t.rejected_reason).replace(/_/g, ' ').toLowerCase()) + '. Edit the text and send it again.</div>' : '') +
      '<div class="wa-bubble">' + waPreview(waBodyOf(t), samples) + (footer ? '<div class="wa-bubble-foot">' + esc(footer) + '</div>' : '') + '</div>' +
    '</div>';
  }).join('');
}

async function saveWaEvent(key) {
  var on = document.getElementById('wa-on-' + key).checked;
  var v = document.getElementById('wa-tpl-' + key).value;
  if (on && !v) { toast('Pick a template before switching it on', 'error'); document.getElementById('wa-on-' + key).checked = false; return; }
  var parts = v ? v.split('|') : [null, null];
  var nameEl = document.getElementById('admin-name');
  var r = await sb.from('salesweb_wa_events').upsert({
    key: key, enabled: on, template_name: parts[0], template_lang: parts[1],
    updated_at: new Date().toISOString(), updated_by: nameEl ? nameEl.textContent : null,
  }, { onConflict: 'key' }).select().single();
  if (r.error) { toast('Error: ' + r.error.message, 'error'); await loadWhatsapp(); return; }
  WA_EVENT_ROWS[key] = r.data;
  var ev = WA_EVENTS.find(function (e) { return e.key === key; });
  toast(ev.label + ': ' + (on ? 'on' : 'off') + (parts[0] ? ', template ' + parts[0] : ''));
  renderWhatsapp();
  loadWaLog();
}

async function sendWaTest(key) {
  var to = (document.getElementById('wa-test-' + key).value || '').trim();
  var v = document.getElementById('wa-tpl-' + key).value;
  if (!v) { toast('Pick a template first', 'error'); return; }
  if (!to) { toast('Type the WhatsApp number to send the test to', 'error'); return; }
  var parts = v.split('|');
  toast('Sending test…');
  var d = await waCall({ action: 'test', event: key, to: to, template_name: parts[0], template_lang: parts[1] });
  if (d.ok) toast('Test sent — check that WhatsApp');
  else toast('Test not sent: ' + (d.error || (d.not_configured ? 'WhatsApp is not connected' : 'failed')), 'error');
  loadWaLog();
}

async function loadWaLog() {
  var box = document.getElementById('wa-log'); if (!box) return;
  var r = await sb.from('salesweb_wa_log').select('*').order('created_at', { ascending: false }).limit(100);
  if (r.error) { box.innerHTML = '<div class="msg-wa msg-wa-err">' + esc(r.error.message) + '</div>'; return; }
  var rows = r.data || [];
  if (!rows.length) { box.innerHTML = '<div class="wa-hint">Nothing sent yet.</div>'; return; }
  var label = {}; WA_EVENTS.forEach(function (e) { label[e.key] = e.label; });
  var stat = { sent: '<span class="badge badge-green">Sent</span>', failed: '<span class="badge badge-red">Failed</span>',
               not_configured: '<span class="badge badge-amber">Not connected</span>', disabled: '<span class="badge badge-grey">Switched off</span>' };
  // width:0 + min-width:100% keeps a wide table from widening the page on
  // a phone: it scrolls inside its card instead.
  box.innerHTML = '<div style="overflow-x:auto;width:0;min-width:100%;"><table class="data-table"><thead><tr><th>When</th><th>Message</th><th>To</th><th>Template</th><th>Status</th><th>Detail</th></tr></thead><tbody>' +
    rows.map(function (x) {
      return '<tr><td style="white-space:nowrap;">' + msgWhen(x.created_at) + '</td>' +
        '<td>' + esc(label[x.event_key] || x.event_key || '') + (x.ref_id ? '<div class="wa-hint" style="margin:0;">' + esc(x.ref_id) + '</div>' : '') + (x.ref_type === 'test' ? '<div class="wa-hint" style="margin:0;">test</div>' : '') + '</td>' +
        '<td style="white-space:nowrap;">' + (x.to_phone ? '+' + esc(String(x.to_phone).replace(/^\+/, '')) : '—') + '</td>' +
        '<td>' + esc(x.template_name || '—') + '</td>' +
        '<td>' + (stat[x.status] || esc(x.status)) + '</td>' +
        '<td style="font-size:12px;color:var(--ink3);max-width:320px;">' + esc(x.status === 'sent' ? (x.actor_name ? 'by ' + x.actor_name : '') : (x.detail || '')) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}

// ── Template editor ──────────────────────────────────────────────
function openWaTemplate(i) {
  var t = (i === undefined || i === null) ? null : WA_TEMPLATES[i];
  if (t && waFieldsIn(waBodyOf(t)).some(function (f) { return /^\d+$/.test(f); })) {
    toast('This template uses numbered fields ({{1}}), so it was made in WhatsApp Manager — edit it there, or write a new one here', 'error');
    return;
  }
  WA_EDIT = t;
  var evKey = 'case_assigned';
  if (t) {
    var fs = waFieldsIn(waBodyOf(t));
    var hit = WA_EVENTS.find(function (e) { return !e.soon && fs.every(function (f) { return e.fields.indexOf(f) >= 0; }); });
    if (hit) evKey = hit.key;
  }
  var live = WA_EVENTS.filter(function (e) { return !e.soon; });
  var ev = WA_EVENTS.find(function (e) { return e.key === evKey; });
  document.getElementById('wat-title').textContent = t ? 'Edit Template — ' + t.name : 'New Template';
  document.getElementById('wat-body').innerHTML =
    '<div class="form-group"><label class="form-label">For which message</label>' +
      '<select class="form-input" id="wat-event" onchange="waTemplateEventChanged()">' +
      live.map(function (e) { return '<option value="' + e.key + '"' + (e.key === evKey ? ' selected' : '') + '>' + esc(e.label) + '</option>'; }).join('') +
      '</select></div>' +
    '<div class="wa-two">' +
      '<div class="form-group"><label class="form-label">Template name</label>' +
        '<input class="form-input" id="wat-name" value="' + esc(t ? t.name : waSuggestName(evKey)) + '"' + (t ? ' disabled' : '') + ' oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_]/g,\'_\')">' +
        '<div class="wa-hint" style="margin:.2rem 0 0;">Small letters, numbers and _ only. Cannot be changed later.</div></div>' +
      '<div class="form-group"><label class="form-label">Language</label>' +
        '<select class="form-input" id="wat-lang"' + (t ? ' disabled' : '') + '>' +
        WA_LANGS.map(function (l) { return '<option value="' + l.code + '"' + ((t ? t.language : 'en') === l.code ? ' selected' : '') + '>' + l.label + '</option>'; }).join('') +
        (t && !WA_LANGS.some(function (l) { return l.code === t.language; }) ? '<option value="' + esc(t.language) + '" selected>' + esc(t.language) + '</option>' : '') +
        '</select></div>' +
    '</div>' +
    '<div class="form-group"><label class="form-label">Message</label>' +
      '<div class="wa-chips" id="wat-chips">' + waChipsHtml(ev) + '</div>' +
      '<textarea class="form-input" id="wat-text" rows="6" maxlength="1024" oninput="waTemplatePreview()">' + esc(t ? waBodyOf(t) : ev.suggest || '') + '</textarea>' +
      '<div class="wa-hint" style="margin:.2rem 0 0;">Press a field button to put it where the cursor is. The message cannot start or end with a field.</div></div>' +
    '<div class="form-group"><label class="form-label">Footer <span style="font-weight:400;color:var(--ink4);">(optional, small grey line)</span></label>' +
      '<input class="form-input" id="wat-footer" maxlength="60" value="' + esc(t ? waFooterOf(t) : 'MJM Nursery') + '" oninput="waTemplatePreview()"></div>' +
    '<div class="form-label">Preview, with sample values</div>' +
    '<div class="wa-phone"><div class="wa-bubble" id="wat-preview"></div></div>';
  document.getElementById('wat-save').disabled = false;
  document.getElementById('wat-save').textContent = t ? 'Send Edit to Meta' : 'Send to Meta for Approval';
  waTemplatePreview();
  openModal('modal-wa-template');
}

function waSuggestName(evKey) {
  var n = evKey, k = 2;
  while (WA_TEMPLATES.some(function (t) { return t.name === n; })) n = evKey + '_' + (k++);
  return n;
}

function waChipsHtml(ev) {
  return ev.fields.map(function (f) {
    return '<button type="button" class="wa-chip" onclick="waInsertField(\'' + f + '\')">+ ' + esc(WA_FIELD_LABELS[f] || f) + '</button>';
  }).join('');
}

function waTemplateEventChanged() {
  var ev = WA_EVENTS.find(function (e) { return e.key === document.getElementById('wat-event').value; });
  document.getElementById('wat-chips').innerHTML = waChipsHtml(ev);
  var nm = document.getElementById('wat-name');
  if (!WA_EDIT && nm) nm.value = waSuggestName(ev.key);
  var tx = document.getElementById('wat-text');
  if (!WA_EDIT && tx && !tx.value.trim()) tx.value = ev.suggest || '';
  waTemplatePreview();
}

function waInsertField(f) {
  var tx = document.getElementById('wat-text');
  var token = '{{' + f + '}}';
  var s = tx.selectionStart != null ? tx.selectionStart : tx.value.length;
  var e = tx.selectionEnd != null ? tx.selectionEnd : s;
  tx.value = tx.value.slice(0, s) + token + tx.value.slice(e);
  tx.focus();
  tx.selectionStart = tx.selectionEnd = s + token.length;
  waTemplatePreview();
}

function waTemplatePreview() {
  var ev = WA_EVENTS.find(function (e) { return e.key === document.getElementById('wat-event').value; });
  var text = document.getElementById('wat-text').value;
  var foot = document.getElementById('wat-footer').value.trim();
  document.getElementById('wat-preview').innerHTML = (text.trim() ? waPreview(text, ev.samples) : '<span style="color:var(--ink4);">Your message shows here.</span>') +
    (foot ? '<div class="wa-bubble-foot">' + esc(foot) + '</div>' : '');
}

async function saveWaTemplate() {
  var ev = WA_EVENTS.find(function (e) { return e.key === document.getElementById('wat-event').value; });
  var name = document.getElementById('wat-name').value.trim();
  var lang = document.getElementById('wat-lang').value;
  var text = document.getElementById('wat-text').value.trim();
  var footer = document.getElementById('wat-footer').value.trim();
  if (!name) { toast('Give the template a name', 'error'); return; }
  if (!text) { toast('Write the message', 'error'); return; }
  var fs = waFieldsIn(text);
  var bad = fs.filter(function (f) { return ev.fields.indexOf(f) < 0; });
  if (bad.length) { toast('This message cannot fill ' + bad.map(function (f) { return '{{' + f + '}}'; }).join(', ') + ' — use the field buttons', 'error'); return; }
  if (/^\{\{/.test(text) || /\}\}$/.test(text)) { toast('Meta does not accept a message that starts or ends with a field — add a word before or after it', 'error'); return; }
  if (!WA_EDIT && WA_TEMPLATES.some(function (t) { return t.name === name && t.language === lang; })) { toast('There is already a template called ' + name + ' in ' + waLangLabel(lang), 'error'); return; }
  var btn = document.getElementById('wat-save');
  btn.disabled = true; btn.textContent = 'Sending to Meta…';
  var d = await waCall({ action: 'save_template', id: WA_EDIT ? WA_EDIT.id : null, name: name, language: lang, body: text, footer: footer, samples: ev.samples });
  if (!d.ok) {
    btn.disabled = false; btn.textContent = WA_EDIT ? 'Send Edit to Meta' : 'Send to Meta for Approval';
    toast('Meta did not accept it: ' + (d.error || 'failed'), 'error');
    return;
  }
  closeModal('modal-wa-template');
  toast(d.status === 'APPROVED' ? 'Approved by Meta already' : 'Sent to Meta — it shows "Waiting for Meta" until they approve it');
  await loadWhatsapp();
}

async function deleteWaTemplate(i) {
  var t = WA_TEMPLATES[i]; if (!t) return;
  var usedBy = Object.keys(WA_EVENT_ROWS).filter(function (k) { var r = WA_EVENT_ROWS[k]; return r.template_name === t.name && r.enabled; });
  var warn = usedBy.length ? '\n\nIt is in use — ' + usedBy.map(function (k) { return WA_EVENTS.find(function (e) { return e.key === k; }).label; }).join(', ') + ' will stop sending until you pick another template.' : '';
  if (!confirm('Delete the template ' + t.name + ' at Meta?' + warn + '\n\nMeta does not let the same name be used again for 30 days.')) return;
  var d = await waCall({ action: 'delete_template', name: t.name, id: t.id });
  if (!d.ok) { toast('Not deleted: ' + (d.error || 'failed'), 'error'); return; }
  toast('Deleted ' + t.name);
  await loadWhatsapp();
}
