/*
 * admin-pages-policies.js — "Pages & Policies" sub-tab under Website Design.
 *
 * Two editors against one JSON blob in salesweb_app_settings
 * (key = 'storefront_pages_config'):
 *
 *   • About MJM nav dropdown — list of sections, each with a title and a
 *     list of { label, action } links. Admin can add / rename / reorder /
 *     delete sections and links. "action" is a tiny grammar understood by
 *     the storefront:
 *       policies              → Info page, first policy tab
 *       policies:<slug>       → Info page, that policy tab selected
 *       page:<id>             → showPage(<id>) — information / contact /
 *                               join / calculator / quotation / home / portal
 *       url:<href>             → a raw href opened in the same tab
 *
 *   • Our Policies — list of tabs, each with a label, auto-slug and an
 *     HTML body. The storefront's Information page reads this and rebuilds
 *     .policy-tabs + .policy-content on load.
 *
 * Storage is one text column (same convention as every other setting on
 * this table). Parse/stringify at the edges. Falls back to the current
 * hard-coded defaults if the row is missing so storefronts keep working
 * through the rollout.
 */

var WDP_CFG = null;        // mutable working copy
var WDP_LOAD_FOR = null;   // which admin loaded, so a stale fetch can't overwrite

var WDP_DEFAULTS = {
  about_sections: [
    { title: 'About MJM', links: [
      { label: 'Our Policies',  action: 'policies' },
      { label: 'Contact Us',    action: 'page:contact' },
      { label: 'Join Our Team', action: 'page:join' }
    ]},
    { title: 'Plan Your Purchase', links: [
      { label: 'Seedling Calculator',  action: 'page:calculator' },
      { label: 'Request a Quotation', action: 'page:quotation' }
    ]}
  ],
  policies: [
    { label: 'Terms & Conditions',         slug: 'terms',      body_html: '<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>' },
    { label: 'Privacy Policy',             slug: 'privacy',    body_html: '<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>' },
    { label: 'Non Refund Policy',          slug: 'refund',     body_html: '<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>' },
    { label: 'Customer Collection Policy', slug: 'collection', body_html: '<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>' },
    { label: 'E-Invoice Policy',           slug: 'einvoice',   body_html: '<p>Edit this policy in Admin → Website Design → Pages &amp; Policies.</p>' }
  ]
};

function _wdpSlug(s){
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'tab';
}

function _wdpEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function _wdpClone(obj){ return JSON.parse(JSON.stringify(obj)); }

async function loadPagesPolicies(){
  var host = document.getElementById('webdesign-pages-list');
  if (!host) return;
  host.innerHTML = '<div class="loading">Loading…</div>';
  var mySeq = (WDP_LOAD_FOR = (WDP_LOAD_FOR || 0) + 1);

  var res = await sb.from('salesweb_app_settings')
    .select('value').eq('key','storefront_pages_config').maybeSingle();
  if (WDP_LOAD_FOR !== mySeq) return;   // a newer load started

  if (res.error && res.error.code !== 'PGRST116'){
    host.innerHTML = '<div style="padding:1rem;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;border-radius:10px;">Could not load: ' + _wdpEsc(res.error.message) + '</div>';
    return;
  }

  var raw = res.data && res.data.value;
  var cfg = null;
  if (raw){
    try { cfg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch(e) { cfg = null; }
  }
  if (!cfg || typeof cfg !== 'object') cfg = _wdpClone(WDP_DEFAULTS);
  if (!Array.isArray(cfg.about_sections)) cfg.about_sections = _wdpClone(WDP_DEFAULTS.about_sections);
  if (!Array.isArray(cfg.policies))       cfg.policies       = _wdpClone(WDP_DEFAULTS.policies);

  WDP_CFG = cfg;
  renderPagesPolicies();
}
window.loadPagesPolicies = loadPagesPolicies;

function renderPagesPolicies(){
  var host = document.getElementById('webdesign-pages-list');
  if (!host || !WDP_CFG) return;

  var html = '';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.8rem;">';
  html +=   '<div style="font-size:12.5px;color:var(--ink3);">Edit the About-MJM dropdown and the Our-Policies tabs shown on the storefront. Changes go live after you click <strong>Save All</strong>.</div>';
  html +=   '<button class="btn btn-primary" onclick="savePagesPolicies()">💾 Save All</button>';
  html += '</div>';

  // ── About MJM Menu ──
  html += '<div class="card" style="margin-bottom:1rem;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;">';
  html +=   '<h3 style="margin:0;">About MJM — Nav Dropdown</h3>';
  html +=   '<button class="btn btn-outline btn-sm" onclick="addAboutSection()">+ Add Section</button>';
  html += '</div>';
  html += '<p style="font-size:12px;color:var(--ink4);margin-bottom:.9rem;">Sections appear as grouped headings in the About-MJM dropdown on the top nav. Each section can hold any number of links.</p>';
  html += '<div id="wdp-sections">' + renderAboutSections() + '</div>';
  html += '</div>';

  // ── Policies ──
  html += '<div class="card">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;">';
  html +=   '<h3 style="margin:0;">Our Policies — Tabs</h3>';
  html +=   '<button class="btn btn-outline btn-sm" onclick="addPolicy()">+ Add Policy</button>';
  html += '</div>';
  html += '<p style="font-size:12px;color:var(--ink4);margin-bottom:.9rem;">Each row is one policy tab on the <em>Information &amp; Policies</em> page. The body accepts raw HTML (use &lt;h3&gt;, &lt;p&gt;, &lt;ul&gt;, etc.).</p>';
  html += '<div id="wdp-policies">' + renderPolicies() + '</div>';
  html += '</div>';

  host.innerHTML = html;
}

function renderAboutSections(){
  var h = '';
  (WDP_CFG.about_sections||[]).forEach(function(sec, si){
    h += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:.8rem;margin-bottom:.8rem;">';
    h += '<div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.6rem;">';
    h +=   '<span style="font-size:10px;font-weight:700;color:var(--ink4);min-width:1.2rem;">#' + (si+1) + '</span>';
    h +=   '<input class="form-input" style="flex:1;font-weight:600;" value="' + _wdpEsc(sec.title||'') + '" placeholder="Section title (e.g. About MJM)" oninput="updateAboutSectionTitle(' + si + ',this.value)">';
    h +=   '<button class="btn btn-outline btn-sm" ' + (si===0 ? 'disabled' : '') + ' onclick="moveAboutSection(' + si + ',-1)" title="Move up">↑</button>';
    h +=   '<button class="btn btn-outline btn-sm" ' + (si === WDP_CFG.about_sections.length-1 ? 'disabled' : '') + ' onclick="moveAboutSection(' + si + ',1)" title="Move down">↓</button>';
    h +=   '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);" onclick="deleteAboutSection(' + si + ')" title="Delete section">✕</button>';
    h += '</div>';
    h += '<div style="padding-left:.6rem;border-left:2px solid var(--border);">';
    (sec.links||[]).forEach(function(lnk, li){
      h += '<div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.4rem;">';
      h +=   '<input class="form-input" style="flex:1.1;" value="' + _wdpEsc(lnk.label||'') + '" placeholder="Link label" oninput="updateAboutLink(' + si + ',' + li + ',\'label\',this.value)">';
      h +=   '<input class="form-input" style="flex:1;font-family:monospace;font-size:11.5px;" value="' + _wdpEsc(lnk.action||'') + '" placeholder="e.g. page:contact or policies:terms" oninput="updateAboutLink(' + si + ',' + li + ',\'action\',this.value)">';
      h +=   '<button class="btn btn-outline btn-sm" ' + (li===0 ? 'disabled' : '') + ' onclick="moveAboutLink(' + si + ',' + li + ',-1)" title="Move up">↑</button>';
      h +=   '<button class="btn btn-outline btn-sm" ' + (li === (sec.links||[]).length-1 ? 'disabled' : '') + ' onclick="moveAboutLink(' + si + ',' + li + ',1)" title="Move down">↓</button>';
      h +=   '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);" onclick="deleteAboutLink(' + si + ',' + li + ')" title="Remove link">✕</button>';
      h += '</div>';
    });
    h += '<button class="btn btn-outline btn-sm" style="margin-top:.2rem;" onclick="addAboutLink(' + si + ')">+ Add Link</button>';
    h += '<div style="font-size:10.5px;color:var(--ink4);margin-top:.5rem;line-height:1.5;">Action grammar: <code>policies</code> · <code>policies:&lt;slug&gt;</code> · <code>page:contact</code> · <code>page:join</code> · <code>page:calculator</code> · <code>page:quotation</code> · <code>page:home</code> · <code>page:portal</code> · <code>url:https://…</code></div>';
    h += '</div>';
    h += '</div>';
  });
  if (!WDP_CFG.about_sections.length) h = '<div style="padding:.9rem;color:var(--ink4);font-size:12px;">No sections yet. Click <strong>+ Add Section</strong>.</div>';
  return h;
}

function renderPolicies(){
  var h = '';
  (WDP_CFG.policies||[]).forEach(function(p, pi){
    h += '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:.8rem;margin-bottom:.8rem;">';
    h += '<div style="display:flex;gap:.4rem;align-items:center;margin-bottom:.5rem;">';
    h +=   '<span style="font-size:10px;font-weight:700;color:var(--ink4);min-width:1.2rem;">#' + (pi+1) + '</span>';
    h +=   '<input class="form-input" style="flex:1;font-weight:600;" value="' + _wdpEsc(p.label||'') + '" placeholder="Policy tab label" oninput="updatePolicyField(' + pi + ',\'label\',this.value)">';
    h +=   '<span style="font-size:10.5px;color:var(--ink4);min-width:4.5rem;text-align:right;" title="Auto-derived from label">slug: <code>' + _wdpEsc(p.slug || _wdpSlug(p.label)) + '</code></span>';
    h +=   '<button class="btn btn-outline btn-sm" ' + (pi===0 ? 'disabled' : '') + ' onclick="movePolicy(' + pi + ',-1)" title="Move up">↑</button>';
    h +=   '<button class="btn btn-outline btn-sm" ' + (pi === WDP_CFG.policies.length-1 ? 'disabled' : '') + ' onclick="movePolicy(' + pi + ',1)" title="Move down">↓</button>';
    h +=   '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);" onclick="deletePolicy(' + pi + ')" title="Delete policy">✕</button>';
    h += '</div>';
    h += '<textarea class="form-input" style="width:100%;min-height:9rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;" placeholder="HTML body — &lt;h3&gt;, &lt;p&gt;, &lt;ul&gt;, etc." oninput="updatePolicyField(' + pi + ',\'body_html\',this.value)">' + _wdpEsc(p.body_html||'') + '</textarea>';
    h += '</div>';
  });
  if (!WDP_CFG.policies.length) h = '<div style="padding:.9rem;color:var(--ink4);font-size:12px;">No policies yet. Click <strong>+ Add Policy</strong>.</div>';
  return h;
}

// ── About MJM editors ──
function addAboutSection(){
  WDP_CFG.about_sections.push({ title:'New Section', links:[] });
  renderPagesPolicies();
}
window.addAboutSection = addAboutSection;

function deleteAboutSection(si){
  if (!confirm('Remove this entire section and its links?')) return;
  WDP_CFG.about_sections.splice(si,1);
  renderPagesPolicies();
}
window.deleteAboutSection = deleteAboutSection;

function updateAboutSectionTitle(si,v){
  WDP_CFG.about_sections[si].title = v;
}
window.updateAboutSectionTitle = updateAboutSectionTitle;

function moveAboutSection(si,dir){
  var arr = WDP_CFG.about_sections, to = si+dir;
  if (to<0 || to>=arr.length) return;
  var t = arr[si]; arr[si] = arr[to]; arr[to] = t;
  renderPagesPolicies();
}
window.moveAboutSection = moveAboutSection;

function addAboutLink(si){
  WDP_CFG.about_sections[si].links.push({ label:'New Link', action:'page:home' });
  renderPagesPolicies();
}
window.addAboutLink = addAboutLink;

function deleteAboutLink(si,li){
  WDP_CFG.about_sections[si].links.splice(li,1);
  renderPagesPolicies();
}
window.deleteAboutLink = deleteAboutLink;

function updateAboutLink(si,li,field,v){
  WDP_CFG.about_sections[si].links[li][field] = v;
}
window.updateAboutLink = updateAboutLink;

function moveAboutLink(si,li,dir){
  var arr = WDP_CFG.about_sections[si].links, to = li+dir;
  if (to<0 || to>=arr.length) return;
  var t = arr[li]; arr[li] = arr[to]; arr[to] = t;
  renderPagesPolicies();
}
window.moveAboutLink = moveAboutLink;

// ── Policy editors ──
function addPolicy(){
  WDP_CFG.policies.push({ label:'New Policy', slug:'new-policy', body_html:'<p>Content here…</p>' });
  renderPagesPolicies();
}
window.addPolicy = addPolicy;

function deletePolicy(pi){
  if (!confirm('Remove this policy tab?')) return;
  WDP_CFG.policies.splice(pi,1);
  renderPagesPolicies();
}
window.deletePolicy = deletePolicy;

function movePolicy(pi,dir){
  var arr = WDP_CFG.policies, to = pi+dir;
  if (to<0 || to>=arr.length) return;
  var t = arr[pi]; arr[pi] = arr[to]; arr[to] = t;
  renderPagesPolicies();
}
window.movePolicy = movePolicy;

function updatePolicyField(pi,field,v){
  WDP_CFG.policies[pi][field] = v;
  if (field === 'label') {
    // auto-derive slug on label change so storefront deep-links stay stable
    WDP_CFG.policies[pi].slug = _wdpSlug(v);
    // repaint only the slug span for this row so typing doesn't lose focus
    var row = document.querySelectorAll('#wdp-policies > div')[pi];
    if (row){
      var slugSpan = row.querySelector('span[title]');
      if (slugSpan) slugSpan.innerHTML = 'slug: <code>' + _wdpEsc(WDP_CFG.policies[pi].slug) + '</code>';
    }
  }
}
window.updatePolicyField = updatePolicyField;

async function savePagesPolicies(){
  if (!WDP_CFG) { toast('Nothing to save yet','error'); return; }
  // Normalise slugs just before writing so blank ones get a sensible value.
  WDP_CFG.policies.forEach(function(p){
    if (!p.slug) p.slug = _wdpSlug(p.label);
  });
  // Light validation
  if (!WDP_CFG.about_sections.every(function(s){ return s && typeof s.title === 'string'; })){
    toast('Every section needs a title','error'); return;
  }
  if (!WDP_CFG.policies.every(function(p){ return p && typeof p.label === 'string' && p.label.trim(); })){
    toast('Every policy needs a label','error'); return;
  }

  var btn = document.querySelector('#webdesign-pages-list .btn-primary');
  var oldLabel = btn && btn.textContent;
  if (btn){ btn.disabled = true; btn.textContent = 'Saving…'; }

  var res = await sb.from('salesweb_app_settings')
    .upsert({ key:'storefront_pages_config', value: JSON.stringify(WDP_CFG) }, { onConflict:'key' });

  if (btn){ btn.disabled = false; btn.textContent = oldLabel || '💾 Save All'; }
  if (res.error){ toast('Save failed: '+res.error.message,'error'); return; }
  toast('Pages & policies saved — storefront reflects on next visit / refresh');
}
window.savePagesPolicies = savePagesPolicies;
