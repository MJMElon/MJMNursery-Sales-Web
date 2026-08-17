// Admin shell — faithful port of the inline <script> that lived at the
// bottom of the old public/admin.html, plus the window bridge and the
// loader for the nine NOT-yet-migrated classic admin-*.js modules.
//
// ── Why a bridge ─────────────────────────────────────────────────────
// The nine modules in public/ (admin-orders.js, admin-customers.js, …)
// are classic scripts: their top-level functions are globals, they call
// helpers the inline script used to define (sb, toast, esc, openModal,
// closeModal, fmtDate, statusBadge, canSeeTab, applyTabVisibility,
// SALESWEB_TAB_KEYS, SB_URL/SB_KEY, updateProductFormDropdowns,
// supabase.createClient for throw-away clients) and they read
// window.__SW_IS_ADMIN__ / __SW_USER_ID__ / __SW_LEVEL__ / __SW_TABS__.
// Everything they consume is therefore explicitly assigned onto window
// below, with identical names and semantics, BEFORE the modules load.
//
// This file is imported for its side effects at entry evaluation time,
// so the bridge exists before React renders (matching the old page,
// where the inline script ran before any handler could fire). boot()
// is then called from the page's useEffect once the DOM is mounted:
// inject the nine module scripts sequentially (same order as the old
// <script src> tags), re-fire DOMContentLoaded for modules that listen
// to it (admin-customers.js wires the points-settings inputs there),
// and finally run checkAdmin() — exactly what the old page did on
// DOMContentLoaded.
//
// The functions below are copied 1:1 from admin.html's inline script.
// Only three mechanical changes were made:
//   1. the CDN supabase client (`var sb=supabase.createClient(...)`) is
//      replaced by the shared npm client from src/lib/supabase.js;
//   2. calls to functions that live in the nine modules (loadOrders,
//      loadCustomers, …) go through window.* since the modules stay
//      classic scripts;
//   3. the mutable settings objects (adminSettings, notificationConfig,
//      paymentDetails) live on window so there is a single shared copy,
//      same as when they were top-level vars of a classic script.

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { createClient } from '@supabase/supabase-js';

var SB_URL = SUPABASE_URL;
var SB_KEY = SUPABASE_ANON_KEY;
var sb = supabase;

export async function checkAdmin(){
  var{data:{session}}=await sb.auth.getSession();
  if(!session){window.location.href='auth.html';return;}
  var{data:profile}=await sb.from('shared_profiles').select('role, permissions').eq('id',session.user.id).single();
  var swLevel=(profile&&profile.permissions&&profile.permissions.modules&&profile.permissions.modules.salesweb)||'none';
  var legacyAdmin=profile&&profile.role==='admin';
  if(!profile||(swLevel!=='admin'&&swLevel!=='normal'&&!legacyAdmin)){window.location.href='index.html';return;}
  document.getElementById('auth-loading').style.display='none';
  document.getElementById('app').classList.add('show');
  document.getElementById('admin-name').textContent=session.user.user_metadata?.full_name||session.user.email;

  var isAdmin = (swLevel==='admin') || legacyAdmin;
  window.__SW_IS_ADMIN__ = isAdmin;
  window.__SW_USER_ID__  = session.user.id;
  window.__SW_LEVEL__    = swLevel;
  // Per-tab gating lives in permissions.salesweb_tabs as {tabKey:bool}.
  // Missing row = grandfather: admins see everything, normals see
  // everything except User Access (matches the pre-feature behaviour).
  // Reads from salesweb_user_tab_access (owned by salesweb, not gated
  // by the umbrella manage_users meta-permission); legacy fallback
  // reads permissions.salesweb_tabs for profiles written before the
  // dedicated table existed.
  var tabsFromTable = null;
  try {
    var tabRes = await sb.from('salesweb_user_tab_access')
      .select('tabs').eq('user_id', session.user.id).maybeSingle();
    if (tabRes && tabRes.data && tabRes.data.tabs) tabsFromTable = tabRes.data.tabs;
  } catch(e) { /* table may not exist yet pre-migration */ }
  window.__SW_TABS__ = tabsFromTable
    || (profile && profile.permissions && profile.permissions.salesweb_tabs)
    || null;
  applyTabVisibility();

  window.loadOrders();
}

// Set of tabs that exist in the salesweb admin. Update both sides if you
// add a new tab — the sidebar id pattern is sb-<key>-item.
var SALESWEB_TAB_KEYS = ['orders','reports','customers','products','payments','promos','coupons','webdesign','settings','users'];

export function canSeeTab(key){
  if (key === 'users') return !!window.__SW_IS_ADMIN__;     // User Access is admin-locked
  if (window.__SW_IS_ADMIN__) return true;                  // admins see everything else
  var tabs = window.__SW_TABS__;
  if (!tabs) return true;                                   // grandfather: no settings yet → allow all
  return tabs[key] === true;
}

export function applyTabVisibility(){
  SALESWEB_TAB_KEYS.forEach(function(key){
    var elId = key === 'customers' ? 'sb-customers-parent' : 'sb-'+key+'-item';
    var el = document.getElementById(elId);
    if (!el) return;
    el.style.display = canSeeTab(key) ? '' : 'none';
  });
  // If the user can't see Orders (the default boot tab), bounce them to
  // the first allowed tab so the page isn't blank.
  if (!canSeeTab('orders')) {
    var first = SALESWEB_TAB_KEYS.filter(canSeeTab)[0];
    if (first && first !== 'orders') {
      var firstEl = document.getElementById(first === 'customers' ? 'sb-customers-parent' : 'sb-'+first+'-item');
      switchTab(first, firstEl);
    }
  }
}
export async function doLogout(){await sb.auth.signOut();sessionStorage.clear();window.location.href='auth.html';}

// Toggles the mobile off-canvas sidebar. Called by the hamburger
// button, the backdrop tap, and every switchTab() so picking a tab
// from the drawer auto-closes it (matches normal mobile-app UX).
export function toggleSidebar(force){
  var sb=document.querySelector('.sidebar');
  var bd=document.getElementById('sb-backdrop');
  if(!sb||!bd)return;
  var open=(force===true)?true:(force===false?false:!sb.classList.contains('open'));
  sb.classList.toggle('open',open);
  bd.classList.toggle('open',open);
}

export function switchTab(tab,el){
  if(typeof canSeeTab==='function'&&!canSeeTab(tab)){toast('You do not have access to this page','error');return;}
  // Auto-close the drawer on phones so the freshly opened tab is visible.
  if(window.innerWidth<=768)toggleSidebar(false);
  document.querySelectorAll('.tab-content').forEach(function(t){t.classList.remove('active');});
  document.querySelectorAll('.sb-item').forEach(function(s){s.classList.remove('active');});
  document.querySelectorAll('.sb-sub-item').forEach(function(s){s.classList.remove('active');});
  document.getElementById('tab-'+tab).classList.add('active');
  if(el)el.classList.add('active');
  if(tab==='orders')window.loadOrders();
  if(tab==='reports')window.loadReports();
  if(tab==='customers')window.loadCustomers();
  if(tab==='products')window.loadProducts();
  if(tab==='payments')window.loadPayments();
  if(tab==='quotations')window.loadQuotations();
  if(tab==='promos')window.loadPromos();
  if(tab==='coupons')window.loadCoupons();
  if(tab==='webdesign')window.loadWebDesign();
  if(tab==='users')window.loadUsers();
  if(tab==='settings')loadSettings();
}

export function toggleSbSub(name){
  var sub=document.getElementById('sb-sub-'+name);
  var arrow=document.getElementById('sb-cust-arrow');
  if(sub.classList.contains('open')){sub.classList.remove('open');if(arrow)arrow.style.transform='';}
  else{sub.classList.add('open');if(arrow)arrow.style.transform='rotate(180deg)';}
}

export function openModal(id){document.getElementById(id).classList.add('open');}
export function closeModal(id){document.getElementById(id).classList.remove('open');}
export function toast(msg,type,duration){var t=document.getElementById('toast');t.textContent=msg;t.className='toast show'+(type==='error'?' error':'');setTimeout(function(){t.className='toast';},duration||3000);}
export function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
export function fmtDate(d){if(!d)return'—';return new Date(d).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});}
export function statusBadge(s){return{'Pending':'badge-amber','Confirmed':'badge-blue','Processing':'badge-blue','Shipped':'badge-blue','Completed':'badge-green','Cancelled':'badge-red'}[s]||'badge-grey';}

window.adminSettings={productTypes:['Seedling','Merchandise'],collections:['Normal Sales','Promotion'],tags:['Best Seller','New Arrival','Limited']};

export function showSettingsSubTab(tab){
  ['catalog','payments','orders','notifications'].forEach(function(t){
    var panel=document.getElementById('set-panel-'+t);
    var btn=document.getElementById('set-subtab-'+t);
    if(panel) panel.style.display = (t===tab)?'':'none';
    if(btn) btn.className='btn btn-'+(t===tab?'primary':'outline')+' btn-sm';
  });
}

export async function loadSettings(){
  showSettingsSubTab('catalog');
  try{var s=localStorage.getItem('mjm_admin_settings');if(s)window.adminSettings=JSON.parse(s);}catch(e){}
  renderSettingsList('settings-product-types',window.adminSettings.productTypes,'ptype');
  renderSettingsList('settings-collections',window.adminSettings.collections,'coll');
  renderSettingsList('settings-tags',window.adminSettings.tags,'tag');
  loadPaymentDetails();
  loadNotificationConfig();
  loadAutoReleaseConfig();
}

// ═══════════════════════════════════════
//  STOCK AUTO-RELEASE CONFIG
//  Stored in salesweb_app_settings.key='order_auto_release' as JSON:
//    { enabled: true, hours: 48 }
//  Read by the release_abandoned_cash_orders() SQL function.
// ═══════════════════════════════════════
export async function loadAutoReleaseConfig(){
  var dbg=document.getElementById('autorel-debug');
  try{
    var{data}=await sb.from('salesweb_app_settings').select('value').eq('key','order_auto_release').maybeSingle();
    var cfg={enabled:true,hours:48};
    if(data&&data.value){ try{ cfg={...cfg,...(typeof data.value==='string'?JSON.parse(data.value):data.value)}; }catch(e){} }
    document.getElementById('autorel-enabled').checked = cfg.enabled!==false;
    document.getElementById('autorel-hours').value = cfg.hours||48;
    if(dbg){ dbg.textContent = cfg.enabled!==false ? ('Active — releasing after '+(cfg.hours||48)+'h.') : 'Disabled — stock is never auto-released.'; dbg.style.color='var(--ink4)'; }
  }catch(e){ if(dbg){ dbg.textContent='Could not load setting — defaults shown.'; dbg.style.color='var(--red)'; } }
}
export async function saveAutoReleaseConfig(){
  var enabled=document.getElementById('autorel-enabled').checked;
  var hours=parseInt(document.getElementById('autorel-hours').value,10);
  if(isNaN(hours)||hours<1){ toast('Enter a valid number of hours (≥ 1)','error'); return; }
  var btn=document.getElementById('autorel-save-btn'); btn.disabled=true; btn.textContent='Saving…';
  var{error}=await sb.from('salesweb_app_settings').upsert({key:'order_auto_release',value:JSON.stringify({enabled:enabled,hours:hours})},{onConflict:'key'});
  btn.disabled=false; btn.textContent='Save';
  if(error){ toast('Error: '+error.message,'error'); return; }
  toast('Auto-release setting saved');
  loadAutoReleaseConfig();
}

// ═══════════════════════════════════════
//  NOTIFICATION CONFIG (order-paid email)
//  Stored in salesweb_app_settings.key='notification_config' as JSON:
//    { admin_emails: ['a@b.com', ...], from_email, from_name, booking_url }
//  Consumed by the send-order-email edge function (fired from the Billplz
//  webhook on Paid) and by payment-callback.html (for the booking URL link).
// ═══════════════════════════════════════
window.notificationConfig = { admin_emails:[], from_email:'', from_name:'MJM Nursery', booking_url:'https://collect.mjmnursery.com/' };

export async function loadNotificationConfig(){
  var dbg = document.getElementById('notif-debug');
  var loaded = false, errMsg = '';
  try{
    var{data,error}=await sb.from('salesweb_app_settings').select('value').eq('key','notification_config').maybeSingle();
    if(error){ errMsg = 'Query error: '+error.message; }
    else if(data && data.value){
      try{
        var parsed = typeof data.value==='string' ? JSON.parse(data.value) : data.value;
        window.notificationConfig = Object.assign(window.notificationConfig, parsed||{});
        loaded = true;
      }catch(e){ errMsg = 'JSON parse error: '+e.message; }
    } else {
      errMsg = 'No row yet for key=notification_config — defaults shown.';
    }
  }catch(e){ errMsg = 'Exception: '+(e.message||e); }

  document.getElementById('notif-admin-emails').value = (window.notificationConfig.admin_emails||[]).join('\n');
  document.getElementById('notif-from-email').value   = window.notificationConfig.from_email   || '';
  document.getElementById('notif-from-name').value    = window.notificationConfig.from_name    || 'MJM Nursery';
  document.getElementById('notif-booking-url').value  = window.notificationConfig.booking_url  || 'https://collect.mjmnursery.com/';

  if(dbg){
    if(loaded){ dbg.style.color='var(--green)'; dbg.textContent='Loaded saved values from database.'; }
    else      { dbg.style.color='var(--ink4)';  dbg.textContent=errMsg||'Defaults shown.'; }
  }
}

export async function saveNotificationConfig(){
  var btn = document.getElementById('notif-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  // Split textarea by newline or comma; drop blanks; dedupe; lowercase.
  var raw = document.getElementById('notif-admin-emails').value || '';
  var emails = raw.split(/[\n,]+/).map(function(s){return s.trim().toLowerCase();}).filter(Boolean);
  // Cheap sanity check — anything without '@' is almost certainly a typo.
  var bad = emails.filter(function(e){return e.indexOf('@')===-1;});
  if(bad.length){
    btn.disabled = false; btn.textContent = 'Save';
    toast('Looks like a typo: '+bad.join(', '),'error');
    return;
  }
  var seen = {}; emails = emails.filter(function(e){if(seen[e])return false;seen[e]=1;return true;});

  window.notificationConfig.admin_emails = emails;
  window.notificationConfig.from_email   = (document.getElementById('notif-from-email').value || '').trim();
  window.notificationConfig.from_name    = (document.getElementById('notif-from-name').value || 'MJM Nursery').trim();
  window.notificationConfig.booking_url  = (document.getElementById('notif-booking-url').value || 'https://collect.mjmnursery.com/').trim();

  var{error} = await sb.from('salesweb_app_settings').upsert({
    key:'notification_config',
    value:JSON.stringify(window.notificationConfig),
    updated_at:new Date().toISOString()
  },{onConflict:'key'});
  btn.disabled = false; btn.textContent = 'Save';
  if(error){ toast('Save failed: '+error.message,'error'); return; }
  toast('Notification settings saved');
}

// ═══════════════════════════════════════
//  PAYMENT DETAILS (offline bank transfer + DuitNow QR)
//  Stored in salesweb_app_settings.key='payment_details' as JSON:
//    { bank_name, account_name, account_number, duitnow_qr_url }
//  Surfaced to customers on payment-proof.html.
// ═══════════════════════════════════════
window.paymentDetails = { bank_name:'', account_name:'', account_number:'', duitnow_qr_url:'' };

export async function loadPaymentDetails(){
  var dbg = document.getElementById('pay-debug');
  var loadedFromDB = false;
  var errMsg = '';
  try{
    var{data,error}=await sb.from('salesweb_app_settings').select('value').eq('key','payment_details').maybeSingle();
    if(error){ errMsg = 'Query error: '+error.message; }
    else if(data && data.value){
      try{ window.paymentDetails = typeof data.value==='string' ? JSON.parse(data.value) : data.value; loadedFromDB = true; }
      catch(e){ errMsg = 'JSON parse error: '+e.message; }
    } else {
      errMsg = 'No row found for key=payment_details';
    }
  }catch(e){ errMsg = 'Exception: '+(e.message||e); console.warn('payment details load failed:', e); }
  document.getElementById('pay-bank-name').value      = window.paymentDetails.bank_name      || '';
  document.getElementById('pay-account-name').value   = window.paymentDetails.account_name   || '';
  document.getElementById('pay-account-number').value = window.paymentDetails.account_number || '';
  renderPaymentQrPreview();
  if(dbg){
    if(loadedFromDB){
      dbg.style.color='var(--green)';
      dbg.textContent='Loaded saved values from database.';
    } else {
      dbg.style.color='var(--red)';
      dbg.textContent='Could not load saved values — '+errMsg+' (fields stay empty until you Save).';
    }
  }
}

export function renderPaymentQrPreview(){
  var url = window.paymentDetails.duitnow_qr_url || '';
  var status = document.getElementById('pay-qr-status');
  var prev   = document.getElementById('pay-qr-preview');
  var img    = document.getElementById('pay-qr-img');
  if(url){
    status.textContent = 'Current QR image:';
    img.src = url + (url.indexOf('?')<0 ? '?t='+Date.now() : ''); // cache-bust
    prev.style.display = 'block';
  } else {
    status.textContent = 'No QR uploaded yet.';
    prev.style.display = 'none';
  }
}

export async function savePaymentDetails(){
  var btn = document.getElementById('pay-save-btn');
  btn.disabled = true; btn.textContent = 'Saving...';
  window.paymentDetails.bank_name      = document.getElementById('pay-bank-name').value.trim();
  window.paymentDetails.account_name   = document.getElementById('pay-account-name').value.trim();
  window.paymentDetails.account_number = document.getElementById('pay-account-number').value.trim();
  // duitnow_qr_url is set by uploadPaymentQr / removePaymentQr — keep as-is.
  var{error} = await sb.from('salesweb_app_settings').upsert({
    key:'payment_details',
    value:JSON.stringify(window.paymentDetails),
    updated_at:new Date().toISOString()
  },{onConflict:'key'});
  btn.disabled = false; btn.textContent = 'Save';
  if(error){ toast('Save failed: '+error.message,'error'); return; }
  toast('Payment details saved');
}

export async function uploadPaymentQr(){
  var input = document.getElementById('pay-qr-file');
  if(!input.files || !input.files[0]) return;
  var file = input.files[0];
  if(file.size > 2*1024*1024){ toast('QR image must be under 2MB','error'); input.value=''; return; }

  var ext = (file.name.split('.').pop()||'png').toLowerCase();
  var path = 'payment-qr/duitnow_'+Date.now()+'.'+ext;
  toast('Uploading QR...');
  var{error:upErr} = await sb.storage.from('order-attachments').upload(path, file, { contentType:file.type, upsert:true });
  if(upErr){ toast('Upload failed: '+upErr.message,'error'); return; }

  var{data:urlData} = sb.storage.from('order-attachments').getPublicUrl(path);
  window.paymentDetails.duitnow_qr_url = urlData?.publicUrl || '';
  renderPaymentQrPreview();
  input.value = '';

  // Persist immediately so the QR is available even if the admin forgets to
  // click Save afterwards.
  await sb.from('salesweb_app_settings').upsert({
    key:'payment_details',
    value:JSON.stringify(window.paymentDetails),
    updated_at:new Date().toISOString()
  },{onConflict:'key'});
  toast('QR uploaded');
}

export async function removePaymentQr(){
  if(!confirm('Remove the DuitNow QR image?')) return;
  window.paymentDetails.duitnow_qr_url = '';
  renderPaymentQrPreview();
  await sb.from('salesweb_app_settings').upsert({
    key:'payment_details',
    value:JSON.stringify(window.paymentDetails),
    updated_at:new Date().toISOString()
  },{onConflict:'key'});
  toast('QR removed');
}
export function saveSettings(){try{localStorage.setItem('mjm_admin_settings',JSON.stringify(window.adminSettings));}catch(e){}}
export function renderSettingsList(containerId,list,prefix){
  var el=document.getElementById(containerId);
  if(!list.length){el.innerHTML='<div style="font-size:12px;color:var(--ink4);padding:.5rem 0;">No items</div>';return;}
  el.innerHTML=list.map(function(item,i){return '<div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem .6rem;background:var(--bg);border-radius:6px;margin-bottom:.4rem;font-size:13px;font-weight:500;"><span>'+esc(item)+'</span><button class="btn btn-outline btn-sm" onclick="removeSettingsItem(\''+prefix+'\','+i+')" style="color:var(--red);font-size:10px;padding:2px 8px;">Remove</button></div>';}).join('');
}
export function addProductType(){var val=document.getElementById('new-ptype').value.trim();if(!val){toast('Enter a product type name','error');return;}if(window.adminSettings.productTypes.includes(val)){toast('Already exists','error');return;}window.adminSettings.productTypes.push(val);saveSettings();document.getElementById('new-ptype').value='';loadSettings();updateProductFormDropdowns();toast('Product type added');}
export function addCollection(){var val=document.getElementById('new-collection').value.trim();if(!val){toast('Enter a collection name','error');return;}if(window.adminSettings.collections.includes(val)){toast('Already exists','error');return;}window.adminSettings.collections.push(val);saveSettings();document.getElementById('new-collection').value='';loadSettings();updateProductFormDropdowns();toast('Collection added');}
export function addTag(){var val=document.getElementById('new-tag').value.trim();if(!val){toast('Enter a tag name','error');return;}if(window.adminSettings.tags.includes(val)){toast('Already exists','error');return;}window.adminSettings.tags.push(val);saveSettings();document.getElementById('new-tag').value='';loadSettings();updateProductFormDropdowns();toast('Tag added');}
export function removeSettingsItem(prefix,index){if(prefix==='ptype'){if(window.adminSettings.productTypes.length<=1){toast('Need at least one type','error');return;}window.adminSettings.productTypes.splice(index,1);}else if(prefix==='coll'){if(window.adminSettings.collections.length<=1){toast('Need at least one collection','error');return;}window.adminSettings.collections.splice(index,1);}else if(prefix==='tag'){window.adminSettings.tags.splice(index,1);}saveSettings();loadSettings();updateProductFormDropdowns();toast('Removed');}
export function updateProductFormDropdowns(){var typeEl=document.getElementById('mp-type');var collEl=document.getElementById('mp-coll');if(typeEl)typeEl.innerHTML=window.adminSettings.productTypes.map(function(t){return '<option value="'+esc(t)+'">'+esc(t)+'</option>';}).join('');if(collEl)collEl.innerHTML=window.adminSettings.collections.map(function(c){return '<option value="'+esc(c)+'">'+esc(c)+'</option>';}).join('');var tf=document.getElementById('prod-type-filter');var cf=document.getElementById('prod-coll-filter');if(tf)tf.innerHTML='<option value="">All Types</option>'+window.adminSettings.productTypes.map(function(t){return '<option>'+esc(t)+'</option>';}).join('');if(cf)cf.innerHTML='<option value="">All Collections</option>'+window.adminSettings.collections.map(function(c){return '<option>'+esc(c)+'</option>';}).join('');var tagEl=document.getElementById('mp-tags');if(tagEl)tagEl.innerHTML=window.adminSettings.tags.map(function(t){return '<option value="'+esc(t)+'">'+esc(t)+'</option>';}).join('');}
try{var s=localStorage.getItem('mjm_admin_settings');if(s)window.adminSettings=JSON.parse(s);}catch(e){}

// ── Window bridge ────────────────────────────────────────────────────
// Every top-level identifier of the old inline script, assigned onto
// window under the same name, so the nine classic modules (and the
// HTML strings they — and renderSettingsList above — inject with
// inline onclick= attributes) resolve them exactly as before.
Object.assign(window, {
  // supabase client + project config (modules build temp clients and
  // edge-function URLs from these: admin-orders.js, admin-customers.js)
  sb: sb,
  SB_URL: SB_URL,
  SB_KEY: SB_KEY,
  // stand-in for the old CDN global `supabase` — modules only use
  // supabase.createClient(...) to build throw-away clients
  supabase: { createClient: createClient },
  // auth / tab gating
  checkAdmin, canSeeTab, applyTabVisibility, SALESWEB_TAB_KEYS, doLogout,
  // navigation + generic UI helpers used across all nine modules
  toggleSidebar, switchTab, toggleSbSub,
  openModal, closeModal, toast, esc, fmtDate, statusBadge,
  // settings tab (adminSettings / notificationConfig / paymentDetails
  // are already window-owned above)
  showSettingsSubTab, loadSettings,
  loadAutoReleaseConfig, saveAutoReleaseConfig,
  loadNotificationConfig, saveNotificationConfig,
  loadPaymentDetails, renderPaymentQrPreview, savePaymentDetails,
  uploadPaymentQr, removePaymentQr,
  saveSettings, renderSettingsList,
  addProductType, addCollection, addTag, removeSettingsItem,
  updateProductFormDropdowns,
});

// ── Classic module loading ───────────────────────────────────────────
// Same files, same order, same cache-busting query strings as the old
// <script src> tags at the bottom of public/admin.html. They stay in
// public/ (still frozen in legacy_urls.txt, still minified by
// scripts/clean_static.mjs) until each is migrated in its own PR.
var MODULE_SRCS = [
  '/admin-orders.js?v=2026-06-16-drop-monthly',
  '/admin-reports.js?v=2026-06-15-charts',
  '/admin-customers.js?v=2026-08-13-points-ledger',
  '/admin-products.js?v=2026-08-13-inv-history',
  '/admin-payments.js?v=2026-05-20-payment-verification',
  '/admin-quotations.js?v=2026-08-13-drop-highlight',
  '/admin-users.js?v=2026-05-21-tab-access-table',
  '/admin-promotions.js?v=2026-05-18-points-ledger',
  '/admin-coupons.js?v=2026-05-28-coupon-groups',
  '/admin-web-design.js?v=2026-05-20-port-from-umbrella',
];

function loadClassicScript(src){
  return new Promise(function(resolve){
    var s=document.createElement('script');
    s.src=src;               // no type=module — top-level decls must be globals
    s.async=false;           // preserve execution order
    s.onload=resolve;
    // A failed module never blocked the old page's DOMContentLoaded
    // handler; keep that behaviour.
    s.onerror=function(){console.error('Failed to load '+src);resolve();};
    document.body.appendChild(s);
  });
}

var booted=false;

// boot() = what the old page did between "inline script parsed" and
// "DOMContentLoaded fired": execute the nine modules in order, then run
// the DOMContentLoaded work.
export async function boot(){
  if(booted)return;          // guard against double-mount
  booted=true;
  for(var i=0;i<MODULE_SRCS.length;i++){
    await loadClassicScript(MODULE_SRCS[i]);
  }
  // The modules were classic scripts that ran before DOMContentLoaded;
  // admin-customers.js registers a DOMContentLoaded listener (it wires
  // the points-settings inputs to updatePointsSummary). We inject them
  // long after the real event, so replay it for them.
  document.dispatchEvent(new Event('DOMContentLoaded',{bubbles:true}));
  // Old page: DOMContentLoaded → checkAdmin(). (Admin modals never close
  // on a stray backdrop click — admins lose in-progress data too easily
  // that way. Each modal must be dismissed via its X button, Cancel, or
  // the action button — there is deliberately no overlay-click handler.)
  checkAdmin();
}
