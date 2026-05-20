// ══════════════════════════════════════════════
// XSS-safe escape helper — apply to every user-controlled value before
// concatenating into innerHTML. The demo data below is hardcoded and safe,
// but once Supabase data is wired in, every interpolation MUST use esc().
// ══════════════════════════════════════════════
function esc(s){if(s===undefined||s===null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// ══════════════════════════════════════════════
// DATA (demo — replace with Supabase in production)
// ══════════════════════════════════════════════
const MJM_BANK = {
  bank: 'Maybank Berhad', accountName: 'MJM Nursery Sdn Bhd',
  accountNo: '5120 1234 5678', swift: 'MBBEMYKL'
};

// Real customer orders, populated from Supabase in loadOrdersFromDB() before
// the first render. Status strings here are the customer-facing display
// labels ('Order Confirmed', 'Order Completed', 'Ready-to-Collect'). The
// DB uses the admin canonical labels ('Paid', 'Completed', 'Ready for
// Collection'); see mapDbStatus() below for the translation.
let ORDERS = [];

const SB_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';
const _sb = supabase.createClient(SB_URL, SB_KEY);

// Translate the admin's canonical status strings into the customer-facing
// labels the rendering already knows how to badge / step through.
function mapDbStatus(s){
  return ({
    'Paid':'Order Confirmed',
    'Ready for Collection':'Ready-to-Collect',
    'Completed':'Order Completed'
  })[s] || s;  // 'Pending Payment', 'Cancelled', 'Refunded' pass through
}

function fmtIsoDate(t){ if(!t) return ''; try{ return new Date(t).toISOString().split('T')[0]; }catch(e){ return ''; } }

async function loadOrdersFromDB(){
  var session = await _sb.auth.getSession();
  var uid = session && session.data && session.data.session && session.data.session.user && session.data.session.user.id;
  if (!uid) { ORDERS = []; return; }

  var {data: rows, error} = await _sb.from('salesweb_customer_orders')
    .select('*').eq('customer_id', uid).order('created_at',{ascending:false});
  if (error) { console.error('Load orders failed:', error.message); ORDERS = []; return; }
  if (!rows || !rows.length) { ORDERS = []; return; }

  // Pull line items for every order in one round-trip.
  var ids = rows.map(function(r){ return r.id; });
  var {data: items} = await _sb.from('salesweb_order_items')
    .select('order_id,product_name,quantity,unit_price').in('order_id', ids);
  var itemsByOrder = {};
  (items||[]).forEach(function(it){
    (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
  });

  ORDERS = rows.map(function(o){
    var its = itemsByOrder[o.id] || [];
    var qty = its.reduce(function(s,i){ return s + (i.quantity||0); }, 0);
    var variety = its.length === 0 ? '—'
                : its.length === 1 ? its[0].product_name
                : its[0].product_name + ' + ' + (its.length - 1) + ' more';
    var price = its.length ? (its[0].unit_price || 0) : 0;
    var status = mapDbStatus(o.status);
    return {
      id:          o.order_number ? '#'+o.order_number : (o.id||'').substring(0,8).toUpperCase(),
      _dbId:       o.id,
      variety:     variety,
      qty:         qty,
      price:       price,
      total:       Number(o.total) || 0,
      orderDate:   fmtIsoDate(o.created_at),
      status:      status,
      notes:       o.customer_remark || '',
      billing:     o.billing_name || '',
      // The DB doesn't yet store a collection date or per-stage attachments;
      // these stay undefined / empty and the renderer degrades gracefully.
      collDate:    undefined,
      completedDate: status === 'Order Completed' ? fmtIsoDate(o.updated_at) : undefined,
      cancelledDate: status === 'Cancelled'       ? fmtIsoDate(o.updated_at) : undefined,
      attachments: { order_placed:[], confirmed:[], preparing:[], ready_to_collect:[], collecting:[], order_completed:[] }
    };
  });
}

const POINTS_DATA = { balance:3450, tier:'Gold', totalEarned:5200, redeemed:1200, expiringSoon:200, nextTier:{name:'Platinum',threshold:5000},
  history:[ {type:'earn',desc:'Order ORD-001 — 2,000 seedlings',pts:440,date:'15 Nov 2024'}, {type:'earn',desc:'Order ORD-002 — 1,500 seedlings',pts:330,date:'01 Dec 2024'}, {type:'earn',desc:'Order ORD-003 — 3,000 seedlings',pts:660,date:'20 Oct 2024'}, {type:'redeem',desc:'Voucher SAVE10 redeemed',pts:-200,date:'05 Dec 2024'}, {type:'earn',desc:'Order ORD-004 — 1,000 seedlings',pts:220,date:'05 Aug 2024'}, {type:'expire',desc:'Points expired (Q1 2024)',pts:-200,date:'31 Mar 2024'} ]
};

const VOUCHERS = {
  active:[ {code:'MJMGOLD10',type:'Gold Member Reward',discount:'10% OFF',desc:'10% off your next order.',minSpend:'RM 10,000',expiry:'30 Jun 2025',points:null}, {code:'FIRSTCOLL',type:'Collection Bonus',discount:'RM 500 OFF',desc:'RM 500 rebate on transport costs.',minSpend:'RM 20,000',expiry:'31 May 2025',points:null} ],
  shop:[ {code:'BULKDEAL5',type:'Shop Voucher',discount:'5% OFF',desc:'5% off on orders above 2,000 seedlings.',minSpend:'RM 40,000',expiry:'31 Aug 2025',points:null}, {code:'SAVE200',type:'Points Redemption',discount:'RM 200 OFF',desc:'Redeem 200 points for RM 200 off.',minSpend:'RM 5,000',expiry:'31 Dec 2025',points:200}, {code:'NURSERY15',type:'Seasonal Promo',discount:'15% OFF',desc:'Seasonal discount — Oct–Dec 2025.',minSpend:'RM 30,000',expiry:'31 Dec 2025',points:null} ],
  past:[ {code:'SAVE10OLD',type:'Redeemed',discount:'RM 200 OFF',desc:'Used on ORD-004.',status:'Used',usedOn:'05 Aug 2024'}, {code:'NEWYEAR24',type:'Expired',discount:'5% OFF',desc:'New Year 2024 promotion.',status:'Expired',usedOn:'—'} ]
};

const SLOT_BOOKINGS = {};
const MAX_PER_SLOT = 3;
const consentSigned = {};
const orderRatings = {};
const orderNextBooking = {};

let currentConsentOrderId = null;
let currentUser = null;
let vtab = 'active';
let currentRatingOrderId = null;
let currentRatingVal = 0;
let signDrawing = false, signHasMark = false;

// ══════════════════════════════════════════════
// INIT — auto-show portal (auth.html handles login)
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async function() {
  // Get user info from sessionStorage (set by auth.html)
  var userName = sessionStorage.getItem('mjm_user_name') || 'Customer';
  var userEmail = sessionStorage.getItem('mjm_user_email') || '';

  currentUser = {
    name: userName, company: '', email: userEmail, phone: '', state: 'Sarawak',
    since: 'January 2024', addr1: '', addr2: '', city: 'Miri', postcode: '98000',
    bstate: 'Sarawak', country: 'Malaysia'
  };

  document.getElementById('pn-user-name').textContent = userName;
  ['name','company','email','phone','state','since'].forEach(function(k) {
    var el = document.getElementById('pf-'+k); if (el) el.value = currentUser[k] || '';
  });
  ['addr1','addr2','city','post','bstate','country'].forEach(function(k) {
    var el = document.getElementById('pf-'+k); if (el) el.value = currentUser[k] || '';
  });

  // Render once with empty/demo state so the page isn't blank during the
  // round-trip, then re-render with real orders.
  renderStats(); renderOrders(); renderCollection(); renderPoints(); renderVouchers();
  await loadOrdersFromDB();
  renderStats(); renderOrders(); renderCollection();

  // Modal close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(function(m) {
    m.addEventListener('click', function(e) { if (e.target===m) m.classList.remove('open'); });
  });
});

function doLogout() {
  sessionStorage.clear();
  window.location.href = 'auth.html';
}

// ══════════════════════════════════════════════
// OVERDUE LOGIC
// ══════════════════════════════════════════════
function isOverdueReminder(o) {
  if (['Order Completed','Cancelled','Pending Payment','Order Confirmed','Preparing'].includes(o.status)) return false;
  var today = new Date(); today.setHours(0,0,0,0);
  var nextBooking = orderNextBooking[o.id];
  if (o.status === 'Ready-to-Collect' || o.status === 'Collecting') {
    if (nextBooking) { var bd = new Date(nextBooking); bd.setHours(0,0,0,0); return today > bd; }
    var refDate = o.readyDate || o.collDate;
    if (!refDate) return false;
    var rd = new Date(refDate); rd.setHours(0,0,0,0);
    return Math.round((today - rd) / 864e5) >= 14;
  }
  return false;
}

function overdueReminderText(o) {
  var nextBooking = orderNextBooking[o.id];
  if (nextBooking) return 'Booking was scheduled but collection has not been completed. Please contact MJM Nursery.';
  return 'No collection booking has been made. Please book your collection slot immediately.';
}

// ══════════════════════════════════════════════
// STATUS
// ══════════════════════════════════════════════
function badgeClass(s) {
  return {'Order Confirmed':'badge-green','Pending Payment':'badge-amber','Ready-to-Collect':'badge-teal','Collecting':'badge-orange','Order Completed':'badge-grey','Cancelled':'badge-red','Refunded':'badge-red'}[s] || 'badge-grey';
}

var STEP_KEYS = ['order_placed','confirmed','preparing','ready_to_collect','collecting','order_completed'];
var STEP_LABELS = { order_placed:'Order Placed', confirmed:'Confirmed', preparing:'Preparing', ready_to_collect:'Ready-to-Collect', collecting:'Collecting', order_completed:'Order Completed' };
var STATUS_STEPS = { 'Pending Payment':1, 'Order Confirmed':2, 'Preparing':3, 'Ready-to-Collect':4, 'Collecting':5, 'Order Completed':6, 'Cancelled':0, 'Refunded':0 };

// ══════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════
function switchTab(tab, btn) {
  document.querySelectorAll('.ptab').forEach(function(b){b.classList.remove('active');});
  document.querySelectorAll('.ptab-panel').forEach(function(p){p.classList.remove('active');});
  if (btn) btn.classList.add('active');
  document.getElementById('ptab-'+tab).classList.add('active');
}

// ══════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════
function renderStats() {
  var active = ORDERS.filter(function(o){return !['Order Completed','Cancelled'].includes(o.status);}).length;
  var ready = ORDERS.filter(function(o){return o.status==='Ready-to-Collect';}).length;
  document.getElementById('stats-row').innerHTML =
    '<div class="stat-card" onclick="switchTab(\'orders\',document.querySelectorAll(\'.ptab\')[0])"><div class="sc-status sc-status-default">ACTIVE</div><span class="sc-icon">📦</span><div class="sc-label">Total Orders</div><div class="sc-val">'+ORDERS.length+'</div></div>'+
    '<div class="stat-card accent-amber" onclick="switchTab(\'collection\',document.querySelectorAll(\'.ptab\')[1])"><div class="sc-status">PENDING</div><span class="sc-icon">🚛</span><div class="sc-label">Awaiting Collection</div><div class="sc-val">'+active+'</div></div>'+
    '<div class="stat-card accent-blue" onclick="switchTab(\'collection\',document.querySelectorAll(\'.ptab\')[1])"><div class="sc-status" style="color:var(--blue)">HEALTHY</div><span class="sc-icon">🌱</span><div class="sc-label">Ready-to-Collect</div><div class="sc-val">'+ready+'</div></div>'+
    '<div class="stat-card accent-green" onclick="switchTab(\'points\',document.querySelectorAll(\'.ptab\')[2])"><div class="sc-status">POINTS</div><span class="sc-icon">⭐</span><div class="sc-label">My Points Balance</div><div class="sc-val">'+POINTS_DATA.balance.toLocaleString()+'</div></div>';
}

// ══════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════
// Orders that are no longer in motion — completed, cancelled or refunded.
// These live in the History section; everything else is Active.
function isOrderDone(o){
  return o.status==='Order Completed' || o.status==='Cancelled' || o.status==='Refunded';
}

function renderOrders() {
  var active  = ORDERS.filter(function(o){ return !isOrderDone(o); });
  var history = ORDERS.filter(isOrderDone);
  if (!active.length && !history.length) {
    document.getElementById('orders-list').innerHTML =
      '<div style="text-align:center;padding:2.5rem 1rem;color:var(--ink3);"><div style="font-size:2rem;margin-bottom:.5rem;">📦</div><div style="font-weight:600;color:var(--ink2);">No orders yet</div><div style="font-size:.85rem;margin-top:.3rem;">Browse the shop to place your first order.</div></div>';
    return;
  }
  var html = '';
  if (active.length)  { html += '<div class="orders-section-label">📦 Active Orders ('+active.length+')</div><div class="orders-grid">'+active.map(orderCardHTML).join('')+'</div>'; }
  if (history.length) { html += '<div class="orders-section-label">🗂️ Order History ('+history.length+')</div><div class="orders-grid">'+history.map(orderCardHTML).join('')+'</div>'; }
  document.getElementById('orders-list').innerHTML = html;
}

function orderCardHTML(o) {
  var isCompleted = o.status==='Order Completed';
  var isCancelled = o.status==='Cancelled';
  var dateDisplay = '—';
  if (isCompleted) {
    dateDisplay = '<span style="color:var(--green);font-weight:600">'+(o.completedDate||o.collDate||'—')+'</span>';
  } else if (isCancelled) {
    // No countdown / "overdue" for cancelled — just show when it was cancelled.
    dateDisplay = '<span style="color:var(--ink3);font-weight:600">'+(o.cancelledDate||o.collDate||'—')+'</span>';
  } else if (o.collDate) {
    var d=Math.round((new Date(o.collDate)-new Date())/864e5);
    dateDisplay = d<0?'<span style="color:var(--red);font-weight:700">Overdue</span>':d===0?'<span style="color:var(--amber);font-weight:700">Today!</span>':o.collDate+' <span style="font-size:.72rem;color:'+(d<=14?'var(--amber)':'var(--ink3)')+'">('+d+'d)</span>';
  }
  var dateLabel = isCompleted ? 'Completed Date' : isCancelled ? 'Cancelled Date' : 'Collection Date';
  var collectingNote = o.status==='Collecting'&&o.collectedQty?'<div class="oc-row"><span class="oc-row-label">Collected So Far</span><span class="oc-row-val" style="color:var(--teal);font-weight:700">'+o.collectedQty.toLocaleString()+' / '+o.qty.toLocaleString()+' seedlings</span></div>':'';
  return '<div class="order-card"><div class="oc-header"><div><div class="oc-id">'+o.id+'</div><div class="oc-date">Ordered '+o.orderDate+'</div></div><span class="badge '+badgeClass(o.status)+'">'+o.status+'</span></div><div class="oc-body"><div class="oc-row"><span class="oc-row-label">Seedling Batch</span><span class="oc-row-val">'+o.variety+'</span></div><div class="oc-row"><span class="oc-row-label">Quantity</span><span class="oc-row-val">'+o.qty.toLocaleString()+' seedlings</span></div><div class="oc-row"><span class="oc-row-label">Unit Price</span><span class="oc-row-val">RM '+o.price.toFixed(2)+'</span></div><div class="oc-row"><span class="oc-row-label">'+dateLabel+'</span><span class="oc-row-val">'+dateDisplay+'</span></div>'+collectingNote+'</div><div class="oc-footer"><div><div class="oc-total-label">Order Total</div><div class="oc-total-val">RM '+o.total.toLocaleString('en-MY',{minimumFractionDigits:2})+'</div>'+(orderRatings[o.id]?'<div class="rating-done-badge">'+'⭐'.repeat(orderRatings[o.id].rating)+' Reviewed</div>':(isCompleted?'<button class="btn-outline" style="margin-top:.4rem;font-size:.74rem" onclick="openRatingModal(\''+o.id+'\')">⭐ Leave a Review</button>':''))+'</div><div class="oc-actions"><button class="btn-outline" onclick="viewDetail(\''+o.id+'\')">View Details</button>'+(o.status==='Pending Payment'?'<button class="btn-outline danger" onclick="showToast(\'Please contact MJM Nursery to cancel.\')">Cancel</button>':'')+'</div></div></div>';
}

// ══════════════════════════════════════════════
// ORDER DETAIL (simplified — full version in production)
// ══════════════════════════════════════════════
function viewDetail(id) {
  var o = ORDERS.find(function(x){return x.id===id;}); if(!o) return;
  var stepsDone = STATUS_STEPS[o.status]||0;
  var pct = Math.max(0,Math.min(100,((stepsDone-0.5)/STEP_KEYS.length)*100));
  var isCompleted = o.status==='Order Completed';

  var alertHtml = '';
  if (!['Order Completed','Cancelled'].includes(o.status)) {
    if (isOverdueReminder(o)) alertHtml = '<div class="coll-alert overdue"><span class="ca-icon">⚠️</span><div class="ca-text"><strong>Collection Overdue</strong><span>'+overdueReminderText(o)+'</span></div></div>';
    else if (o.status==='Ready-to-Collect') alertHtml = '<div class="coll-alert ready"><span class="ca-icon">✅</span><div class="ca-text"><strong>Your order is Ready-to-Collect!</strong><span>Please sign the consent form and book your collection date.</span></div></div>';
    else if (o.status==='Collecting') { var rem=o.qty-(o.collectedQty||0); alertHtml = '<div class="coll-alert soon"><span class="ca-icon">🚛</span><div class="ca-text"><strong>Collection In Progress</strong><span>'+(o.collectedQty||0).toLocaleString()+' of '+o.qty.toLocaleString()+' collected. '+rem.toLocaleString()+' remaining.</span></div></div>'; }
  }

  var tlSteps = STEP_KEYS.map(function(key,i) {
    var isDone = i<stepsDone, isActive = (i===stepsDone)&&!isCompleted&&o.status!=='Cancelled';
    var cls = isDone?'done':isActive?'active':'';
    var atts = (o.attachments&&o.attachments[key])||[];
    var attHtml = atts.length?'<div class="h-step-attach" onclick="openAttModal(\''+id+'\',\''+key+'\',event)">📎 '+atts.length+' Doc'+(atts.length!==1?'s':'')+'</div>':'<div style="height:1.2rem"></div>';
    return '<div class="h-step '+cls+'"><div class="h-step-dot"></div><div class="h-step-label">'+STEP_LABELS[key]+'</div>'+attHtml+'</div>';
  }).join('');

  var bookingHtml = '';
  if (o.status==='Ready-to-Collect') {
    bookingHtml = consentSigned[id]?buildBookingForm(id,o):'<div class="booking-section"><h4>📅 Book Collection</h4><p>Before booking, please sign our collection consent form.</p><div class="booking-locked"><div class="booking-locked-icon">🔒</div><div class="booking-locked-text"><strong>Consent Required</strong>You must agree to our collection terms before proceeding.</div><button class="btn-primary" style="margin-left:auto;flex-shrink:0" onclick="openConsentModal(\''+id+'\')">Sign Consent →</button></div></div>';
  } else if (o.status==='Pending Payment') {
    bookingHtml = buildPaymentUploadSection(id,o);
  }

  document.getElementById('orders-list').innerHTML =
    '<button class="detail-back" onclick="renderOrders()">← Back to Orders</button>'+
    '<div class="detail-header"><div class="dh-top"><div class="dh-id">'+o.id+'</div><span class="badge '+badgeClass(o.status)+'">'+o.status+'</span></div><div class="dh-meta"><div class="dh-meta-item"><span>Batch</span><strong>'+o.variety+'</strong></div><div class="dh-meta-item"><span>Quantity</span><strong>'+o.qty.toLocaleString()+' seedlings</strong></div><div class="dh-meta-item"><span>Total</span><strong>RM '+o.total.toLocaleString('en-MY',{minimumFractionDigits:2})+'</strong></div></div></div>'+
    alertHtml+
    '<div class="card"><h3>📍 Order Progress</h3><div class="h-timeline-wrap"><div class="h-timeline"><div class="h-timeline-progress" style="width:'+pct+'%"></div>'+tlSteps+'</div></div>'+bookingHtml+'</div>';
}

// ══════════════════════════════════════════════
// PAYMENT SECTION
// ══════════════════════════════════════════════
function buildPaymentUploadSection(id,o) {
  return '<div class="payment-section"><h4>💳 Complete Your Payment</h4><p>Transfer the full amount and upload your payment proof.</p><div class="bank-details-box"><div class="bank-details-title">🏦 MJM Nursery Bank Account</div><div class="bank-row"><span class="bank-label">Bank</span><span class="bank-val">'+MJM_BANK.bank+'</span></div><div class="bank-row"><span class="bank-label">Account Name</span><span class="bank-val">'+MJM_BANK.accountName+'</span></div><div class="bank-row"><span class="bank-label">Account No.</span><span class="bank-val bank-acc">'+MJM_BANK.accountNo+' <button class="copy-acc-btn" onclick="copyBankAcc(event)">Copy</button></span></div><div class="bank-amount-row"><span>Amount Due</span><span class="bank-amount">RM '+o.total.toLocaleString('en-MY',{minimumFractionDigits:2})+'</span></div></div><div class="upload-box" id="upload-box-'+id+'"><div class="upload-icon">📎</div><div class="upload-label">Upload Payment Proof</div><div class="upload-hint">Click to select (JPG, PNG, PDF)</div><input type="file" id="payment-file-'+id+'" accept="image/*,.pdf" style="display:none" onchange="handlePaymentUpload(\''+id+'\',this)"/><button class="upload-btn" onclick="document.getElementById(\'payment-file-'+id+'\').click()">Select File</button></div><div id="upload-preview-'+id+'" style="display:none" class="upload-preview"><span class="upload-preview-icon">✅</span><span id="upload-preview-name-'+id+'" class="upload-preview-name"></span><button class="upload-remove-btn" onclick="removePaymentFile(\''+id+'\')">✕ Remove</button></div><button class="btn-primary" style="margin-top:1rem;width:100%" onclick="submitPaymentProof(\''+id+'\')">📤 Submit Payment Proof</button></div>';
}

function copyBankAcc(e){e.stopPropagation();navigator.clipboard?.writeText(MJM_BANK.accountNo.replace(/\s/g,''));showToast('📋 Account number copied!');}
function handlePaymentUpload(id,input){if(!input.files||!input.files[0])return;document.getElementById('upload-box-'+id).style.display='none';document.getElementById('upload-preview-name-'+id).textContent=input.files[0].name;document.getElementById('upload-preview-'+id).style.display='flex';}
function removePaymentFile(id){document.getElementById('payment-file-'+id).value='';document.getElementById('upload-box-'+id).style.display='flex';document.getElementById('upload-preview-'+id).style.display='none';}
function submitPaymentProof(id){var input=document.getElementById('payment-file-'+id);if(!input||!input.files||!input.files[0]){showToast('⚠ Please select a file first.');return;}showToast('✅ Payment proof submitted!');}

// ══════════════════════════════════════════════
// BOOKING
// ══════════════════════════════════════════════
var HOURS=[8,9,10,11,12,13,14,15,16];
function fmtHour(h){return{main:(h>12?h-12:h)+':00',ampm:h<12?'AM':'PM'};}
function getSlotKey(date,hour){return date+'|'+hour;}
function getSlotCount(date,hour){return SLOT_BOOKINGS[getSlotKey(date,hour)]||0;}

function buildBookingForm(id,o,maxQtyOverride) {
  var today=new Date().toISOString().split('T')[0];
  var maxQ=maxQtyOverride||o.qty;
  return '<div class="booking-section-inner" id="booking-section-'+id+'"><div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1rem;padding:.45rem .8rem;background:var(--green-light);border-radius:8px;width:fit-content"><span>✅</span><span style="font-size:.77rem;font-weight:700;color:#15803d">Consent on record</span></div><div style="margin-bottom:1rem"><label style="display:block;font-size:.72rem;font-weight:700;color:var(--ink2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:.4rem">Select Date</label><input type="date" id="book-date-'+id+'" min="'+today+'" style="background:var(--surface2);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:.6rem .9rem;font-size:.86rem;color:var(--ink);outline:none;font-family:inherit;width:220px" onchange="renderTimeWheel(\''+id+'\')"/></div><div class="time-picker-section"><label>Select Time Slot</label><div class="time-wheel-grid" id="time-wheel-'+id+'"><p style="font-size:.8rem;color:var(--ink3)">Please select a date first.</p></div></div><div class="booking-form-grid"><div><label>Collection Quantity</label><input type="number" id="book-qty-'+id+'" placeholder="e.g. 2000" min="1" max="'+maxQ+'" style="background:var(--surface2);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:.6rem .9rem;font-size:.86rem;color:var(--ink);outline:none;font-family:inherit;width:100%"/><div style="font-size:.7rem;color:var(--ink3);margin-top:.3rem">Max: '+maxQ.toLocaleString()+'</div></div><div><label>Vehicle / Notes</label><input type="text" id="book-notes-'+id+'" placeholder="e.g. 10-tonne lorry" style="background:var(--surface2);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:.6rem .9rem;font-size:.86rem;color:var(--ink);outline:none;font-family:inherit;width:100%"/></div></div><input type="hidden" id="book-hour-'+id+'" value=""/><button class="btn-primary" style="margin-top:.8rem" onclick="submitBooking(\''+id+'\','+maxQ+')">📅 Confirm Booking Request</button></div>';
}

function renderTimeWheel(orderId){
  var dateInput=document.getElementById('book-date-'+orderId);var date=dateInput?dateInput.value:'';
  var container=document.getElementById('time-wheel-'+orderId);if(!date||!container)return;
  var hourInput=document.getElementById('book-hour-'+orderId);if(hourInput)hourInput.value='';
  var oid=String(orderId||'').replace(/[\\'"<>]/g,'');var dt=String(date||'').replace(/[\\'"<>]/g,'');
  container.innerHTML=HOURS.map(function(h){var count=getSlotCount(date,h);var full=count>=MAX_PER_SLOT;var f=fmtHour(h);var rem=MAX_PER_SLOT-count;return '<div class="time-slot '+(full?'full':'')+'" id="ts-'+esc(oid)+'-'+h+'" onclick="selectHour(\''+oid+'\','+h+',\''+dt+'\')"><div class="ts-time">'+esc(f.main)+'</div><div class="ts-ampm">'+esc(f.ampm)+'</div><div class="ts-slots '+(full?'full-label':'')+'">'+(full?'FULL':rem+' left')+'</div></div>';}).join('');
}

function selectHour(orderId,h,date){
  if(getSlotCount(date,h)>=MAX_PER_SLOT){showToast('⚠ This slot is full.');return;}
  HOURS.forEach(function(hr){var el=document.getElementById('ts-'+orderId+'-'+hr);if(el)el.classList.remove('selected');});
  var el=document.getElementById('ts-'+orderId+'-'+h);if(el)el.classList.add('selected');
  var hi=document.getElementById('book-hour-'+orderId);if(hi)hi.value=h;
}

function submitBooking(id,maxQty){
  var date=document.getElementById('book-date-'+id)?.value;var hour=document.getElementById('book-hour-'+id)?.value;var qty=document.getElementById('book-qty-'+id)?.value;
  if(!date){showToast('⚠ Please select a date.');return;}if(!hour){showToast('⚠ Please select a time.');return;}if(!qty||Number(qty)<1){showToast('⚠ Please enter quantity.');return;}if(Number(qty)>Number(maxQty)){showToast('⚠ Quantity exceeds maximum.');return;}
  SLOT_BOOKINGS[getSlotKey(date,parseInt(hour))]=(SLOT_BOOKINGS[getSlotKey(date,parseInt(hour))]||0)+1;
  orderNextBooking[id]=date;
  var f=fmtHour(parseInt(hour));showToast('✅ Booking confirmed for '+date+' at '+f.main+' '+f.ampm);
  setTimeout(function(){viewDetail(id);},400);
}

// ══════════════════════════════════════════════
// CONSENT
// ══════════════════════════════════════════════
function openConsentModal(orderId){currentConsentOrderId=orderId;document.getElementById('consent-chk').checked=false;document.getElementById('consent-submit-btn').disabled=true;signHasMark=false;clearSignature();document.getElementById('consent-modal').classList.add('open');setTimeout(initCanvas,100);}
function closeConsentModal(){document.getElementById('consent-modal').classList.remove('open');currentConsentOrderId=null;}
function checkConsentReady(){document.getElementById('consent-submit-btn').disabled=!(document.getElementById('consent-chk').checked&&signHasMark);}
function submitConsent(){if(!currentConsentOrderId)return;consentSigned[currentConsentOrderId]={signed:true,signedAt:new Date().toLocaleString('en-MY')};closeConsentModal();showToast('✅ Consent signed!');viewDetail(currentConsentOrderId);}
function initCanvas(){var canvas=document.getElementById('sign-canvas');if(!canvas)return;var dpr=window.devicePixelRatio||1;var rect=canvas.getBoundingClientRect();canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;var ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.strokeStyle='#111827';ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';function getPos(e){var r=canvas.getBoundingClientRect();var src=e.touches?e.touches[0]:e;return{x:src.clientX-r.left,y:src.clientY-r.top};}canvas.onmousedown=canvas.ontouchstart=function(e){e.preventDefault();signDrawing=true;var p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);};canvas.onmousemove=canvas.ontouchmove=function(e){e.preventDefault();if(!signDrawing)return;var p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();signHasMark=true;checkConsentReady();};canvas.onmouseup=canvas.ontouchend=function(){signDrawing=false;};canvas.onmouseleave=function(){signDrawing=false;};}
function clearSignature(){var canvas=document.getElementById('sign-canvas');if(!canvas)return;canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);signHasMark=false;checkConsentReady();}

// ══════════════════════════════════════════════
// ATTACHMENT MODAL
// ══════════════════════════════════════════════
function openAttModal(orderId,stepKey,e){
  if(e)e.stopPropagation();var o=ORDERS.find(function(x){return x.id===orderId;});if(!o)return;
  var files=(o.attachments&&o.attachments[stepKey])||[];
  var label=STEP_LABELS[stepKey]||stepKey;
  document.getElementById('att-modal-title').textContent=label+' — Documents';
  var oid=String(orderId||'').replace(/[\\'"<>]/g,'');
  document.getElementById('att-modal-body').innerHTML=files.length?files.map(function(f){return '<div class="att-file" onclick="downloadFile('+JSON.stringify(f).replace(/"/g,'&quot;')+',\''+oid+'\')"><div class="att-file-icon">'+esc(f.icon)+'</div><div class="att-file-info"><strong>'+esc(f.name)+'</strong><span>'+esc(f.type)+' · '+esc(f.size)+'</span></div><div class="att-file-dl">⬇ Download</div></div>';}).join(''):'<p style="font-size:.84rem;color:var(--ink3);text-align:center;padding:1.5rem 0">No documents for this stage.</p>';
  document.getElementById('att-modal').classList.add('open');
}
function downloadFile(file,orderId){showToast('📥 Downloading '+file.name+'…');}
function closeModal(id){document.getElementById(id).classList.remove('open');}

// ══════════════════════════════════════════════
// COLLECTION
// ══════════════════════════════════════════════
function renderCollection() {
  var upcoming=ORDERS.filter(function(o){return !['Order Completed','Cancelled'].includes(o.status)&&o.collDate;}).sort(function(a,b){return new Date(a.collDate)-new Date(b.collDate);});
  var past=ORDERS.filter(function(o){return o.status==='Order Completed';});
  var html='';
  upcoming.forEach(function(o){
    if(isOverdueReminder(o))html+='<div class="coll-alert overdue"><span class="ca-icon">⚠️</span><div class="ca-text"><strong>'+o.id+' — Collection Overdue</strong><span>'+overdueReminderText(o)+'</span></div></div>';
    else if(o.status==='Ready-to-Collect')html+='<div class="coll-alert ready"><span class="ca-icon">✅</span><div class="ca-text"><strong>'+o.id+' — Ready-to-Collect!</strong><span>Go to order details to sign consent and book.</span></div></div>';
  });
  if(upcoming.length){html+='<div class="card"><h3>📅 Upcoming Collections</h3>'+upcoming.map(function(o){var d=Math.round((new Date(o.collDate)-new Date())/864e5);return '<div class="oc-row" style="flex-wrap:wrap;gap:.5rem;padding:.7rem 0"><div><div style="font-weight:700;font-size:.87rem">'+o.id+'</div><div style="font-size:.75rem;color:var(--ink3)">'+o.variety+'</div></div><div style="margin-left:auto;display:flex;align-items:center;gap:.7rem"><div style="text-align:right"><div style="font-size:.74rem;color:var(--ink3)">'+o.collDate+'</div></div><span class="badge '+badgeClass(o.status)+'">'+o.status+'</span></div></div>';}).join('')+'</div>';}
  if(!upcoming.length&&!past.length)html='<div class="empty-state"><div class="es-icon">📅</div><div class="es-title">No collections yet</div><div class="es-desc">Upcoming schedules will appear here.</div></div>';
  document.getElementById('coll-view').innerHTML=html;
}

// ══════════════════════════════════════════════
// POINTS
// ══════════════════════════════════════════════
function renderPoints() {
  var p=POINTS_DATA;var pct=Math.min(100,Math.round((p.balance/p.nextTier.threshold)*100));
  document.getElementById('points-view').innerHTML=
    '<div class="points-hero"><div class="ph-inner" style="position:relative;z-index:2"><div><div class="ph-label">Available Points</div><div class="ph-val">'+p.balance.toLocaleString()+'<span>pts</span></div><span class="tier-badge tier-gold">🏆 '+p.tier+' Member</span></div><div class="ph-progress-card"><label>Progress to '+p.nextTier.name+'</label><div class="ph-bar-bg"><div class="ph-bar" style="width:'+pct+'%"></div></div><div class="ph-bar-text">'+p.balance.toLocaleString()+' / '+p.nextTier.threshold.toLocaleString()+' pts ('+pct+'%)</div></div></div></div>'+
    '<div class="points-stats"><div class="pts-card hi"><div class="v">'+p.balance.toLocaleString()+'</div><div class="l">Available</div></div><div class="pts-card"><div class="v">'+p.totalEarned.toLocaleString()+'</div><div class="l">Total Earned</div></div><div class="pts-card"><div class="v">'+p.redeemed.toLocaleString()+'</div><div class="l">Redeemed</div></div></div>'+
    '<div class="card" style="padding:0"><div style="padding:1rem 1.5rem;border-bottom:1.5px solid var(--border)"><h3 style="border:none;padding:0;margin:0">Points History</h3></div>'+p.history.map(function(h){return '<div class="pts-row"><div class="pts-icon '+h.type+'">'+(h.type==='earn'?'🌱':h.type==='redeem'?'🏷️':'⏳')+'</div><div class="pts-info"><strong>'+h.desc+'</strong><span>'+h.date+'</span></div><div class="pts-amount '+h.type+'">'+(h.pts>0?'+':'')+h.pts.toLocaleString()+' pts</div></div>';}).join('')+'</div>';
}

// ══════════════════════════════════════════════
// VOUCHERS
// ══════════════════════════════════════════════
function renderVouchers() {
  var tabs='<div class="vtabs"><button class="vtab '+(vtab==='active'?'active':'')+'" onclick="setVtab(\'active\')">✅ Active ('+VOUCHERS.active.length+')</button><button class="vtab '+(vtab==='shop'?'active':'')+'" onclick="setVtab(\'shop\')">🛒 Shop ('+VOUCHERS.shop.length+')</button><button class="vtab '+(vtab==='past'?'active':'')+'" onclick="setVtab(\'past\')">📁 Past ('+VOUCHERS.past.length+')</button></div>';
  var list=VOUCHERS[vtab];
  var cards=list.length?'<div class="voucher-grid">'+list.map(function(v){return vcHTML(v,vtab);}).join('')+'</div>':'<div class="empty-state"><div class="es-icon">🏷️</div><div class="es-title">No vouchers here</div></div>';
  document.getElementById('vouchers-view').innerHTML=tabs+cards;
}
function setVtab(t){vtab=t;renderVouchers();}
function vcHTML(v,type){
  var cls=type==='active'?'vc-green':type==='shop'?'vc-amber':'vc-grey';
  var btn=type==='past'?'':(v.points?'<button class="vc-copy" onclick="redeemPts('+v.points+',\''+v.code+'\',event)">Redeem</button>':'<button class="vc-copy" onclick="copyCode(\''+v.code+'\',event)">Copy</button>');
  var foot=type==='past'?'<span>'+(v.status==='Used'?'Used '+v.usedOn:'Expired')+'</span>':'<span>Expires '+v.expiry+'</span>';
  return '<div class="vc '+cls+'"><div class="vc-inner"><div class="vc-type">'+v.type+'</div><div class="vc-discount">'+v.discount+'</div><div class="vc-desc">'+v.desc+'</div><div class="vc-min">Min. spend: '+v.minSpend+'</div><div class="vc-code-row"><span class="vc-code">'+v.code+'</span>'+btn+'</div><div class="vc-foot">'+foot+'</div></div></div>';
}
function copyCode(code,e){e.stopPropagation();navigator.clipboard?.writeText(code);showToast('📋 "'+code+'" copied!');}
function redeemPts(pts,code,e){e.stopPropagation();if(POINTS_DATA.balance<pts){showToast('⚠ Not enough points.');return;}POINTS_DATA.balance-=pts;POINTS_DATA.redeemed+=pts;showToast('✅ '+code+' unlocked!');renderPoints();renderVouchers();renderStats();}

// ══════════════════════════════════════════════
// PROFILE & RATING
// ══════════════════════════════════════════════
function saveProfile(){showToast('Profile updated ✅');}

function openRatingModal(orderId){
  currentRatingOrderId=orderId;currentRatingVal=0;document.getElementById('rating-comment').value='';document.getElementById('rating-submit-btn').disabled=true;document.getElementById('star-label').textContent='Tap a star to rate';document.querySelectorAll('.star').forEach(function(s){s.classList.remove('active');});
  var o=ORDERS.find(function(x){return x.id===orderId;});document.getElementById('rating-order-info').innerHTML=o?'<strong>'+esc(o.id)+'</strong> — '+esc(o.variety):'';
  document.getElementById('rating-modal').classList.add('open');
}
function setRating(val){currentRatingVal=val;var labels=['','😐 Poor','🙂 Fair','😊 Good','😄 Great','🤩 Excellent!'];document.getElementById('star-label').textContent=labels[val];document.querySelectorAll('.star').forEach(function(s){s.classList.toggle('active',parseInt(s.dataset.val)<=val);});document.getElementById('rating-submit-btn').disabled=false;}
function submitRating(){if(!currentRatingOrderId||!currentRatingVal)return;orderRatings[currentRatingOrderId]={rating:currentRatingVal,comment:document.getElementById('rating-comment').value.trim()};closeModal('rating-modal');showToast('⭐'.repeat(currentRatingVal)+' Thank you for your feedback!');renderOrders();}

// ══════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════
function showToast(msg){var t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},3500);}
