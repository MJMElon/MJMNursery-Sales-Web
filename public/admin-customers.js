/*
═══════════════════════════════════════════════════
  ADMIN — CUSTOMERS MANAGEMENT
  ⚠️ AI: This file handles customer profiles.
  Depends on: sb, toast(), esc(), fmtDate(), statusBadge(), openModal(), closeModal()

  LINE MAP:
  14      loadCustomers() — fetch + render customer table + stats
  40      viewCustomer() — open customer detail modal with order history
═══════════════════════════════════════════════════
*/

// True if this profile's permissions JSONB grants any operation-system
// access. Customers' permissions are null/empty, all modules='none', or
// carry a customer-level marker like 'customer' that does NOT grant
// staff-level access. Only staff-grade module values are treated as
// operations staff; anything else is a customer.
//
// Earlier versions flagged anyone with a non-'none' module value as
// staff, which was too aggressive — the salesweb signup path appears to
// populate at least one customer-level marker on new profiles (so
// every legit customer was being filtered out and the list rendered
// empty even though shared_profiles read access was working).
var STAFF_MODULE_VALUES = {admin:1, normal:1, view:1, edit:1, manage:1, read:1, write:1, full:1, staff:1};
function isOperationStaff(perms){
  if(!perms || typeof perms !== 'object') return false;
  if(perms.manage_users) return true;
  if(perms.can_verify_operation) return true;
  if(perms.modules && typeof perms.modules === 'object'){
    for(var k in perms.modules){
      var v = perms.modules[k];
      if(v && STAFF_MODULE_VALUES[String(v).toLowerCase()]) return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════
//  CUSTOMER FILTER DRAWER (right sidebar)
//  Reuses the .filter-drawer / .fd-* styles defined for the orders filter.
// ═══════════════════════════════════════
var CUSTOMER_FILTERS = { joinedFrom:'', joinedTo:'', tiers:[], terms:[], paid:'', statuses:[], purchase:[], spendOp:'', spendAmt:'', pointsOp:'', pointsAmt:'', creditOp:'', creditAmt:'' };

// Sidebar "Credit Center" entry-point: apply the Credit-only terms filter,
// reload the Customer List, and scroll to it. This gives the admin a single-
// click "show me only my credit customers" view without them having to open
// the filter drawer and tick the checkbox each time. Terms toggle + credit-
// limit editing still happen inline on each row (existing UI).
window.openCreditCenter = function(){
  CUSTOMER_FILTERS.terms = ['credit'];
  try { updateCustomerFilterBadge(); } catch(e) {}
  try { loadCustomers(); } catch(e) {}
  try {
    var el = document.getElementById('customers-table');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch(e) {}
};

async function openCustomerFilterDrawer(){
  document.getElementById('cf-date-from').value = CUSTOMER_FILTERS.joinedFrom || '';
  document.getElementById('cf-date-to').value = CUSTOMER_FILTERS.joinedTo || '';
  // Populate membership tier checkboxes from the configured tiers.
  var tiers = await getCustTiers();
  var box = document.getElementById('cf-tiers');
  box.innerHTML = tiers.map(function(t){
    var checked = CUSTOMER_FILTERS.tiers.indexOf(t.name) !== -1 ? ' checked' : '';
    return '<label class="fd-check"><input type="checkbox" class="cf-tier" value="'+esc(t.name)+'"'+checked+'> '+esc(t.name)+'</label>';
  }).join('');
  document.querySelectorAll('.cf-status').forEach(function(cb){ cb.checked = CUSTOMER_FILTERS.statuses.indexOf(cb.value) !== -1; });
  document.querySelectorAll('.cf-purchase').forEach(function(cb){ cb.checked = CUSTOMER_FILTERS.purchase.indexOf(cb.value) !== -1; });
  document.querySelectorAll('.cf-term').forEach(function(cb){ cb.checked = CUSTOMER_FILTERS.terms.indexOf(cb.value) !== -1; });
  document.querySelectorAll('.cf-paid').forEach(function(rb){ rb.checked = (CUSTOMER_FILTERS.paid||'') === rb.value; });
  document.getElementById('cf-spend-op').value = CUSTOMER_FILTERS.spendOp || '';
  document.getElementById('cf-spend-amt').value = CUSTOMER_FILTERS.spendAmt || '';
  document.getElementById('cf-points-op').value = CUSTOMER_FILTERS.pointsOp || '';
  document.getElementById('cf-points-amt').value = CUSTOMER_FILTERS.pointsAmt || '';
  document.getElementById('cf-credit-op').value = CUSTOMER_FILTERS.creditOp || '';
  document.getElementById('cf-credit-amt').value = CUSTOMER_FILTERS.creditAmt || '';
  document.getElementById('custFilterOverlay').classList.add('open');
  document.getElementById('custFilterDrawer').classList.add('open');
}
function closeCustomerFilterDrawer(){
  document.getElementById('custFilterOverlay').classList.remove('open');
  document.getElementById('custFilterDrawer').classList.remove('open');
}
function applyCustomerFilters(){
  CUSTOMER_FILTERS.joinedFrom = document.getElementById('cf-date-from').value || '';
  CUSTOMER_FILTERS.joinedTo   = document.getElementById('cf-date-to').value || '';
  CUSTOMER_FILTERS.tiers = []; document.querySelectorAll('.cf-tier:checked').forEach(function(cb){ CUSTOMER_FILTERS.tiers.push(cb.value); });
  CUSTOMER_FILTERS.statuses = []; document.querySelectorAll('.cf-status:checked').forEach(function(cb){ CUSTOMER_FILTERS.statuses.push(cb.value); });
  CUSTOMER_FILTERS.purchase = []; document.querySelectorAll('.cf-purchase:checked').forEach(function(cb){ CUSTOMER_FILTERS.purchase.push(cb.value); });
  CUSTOMER_FILTERS.terms = []; document.querySelectorAll('.cf-term:checked').forEach(function(cb){ CUSTOMER_FILTERS.terms.push(cb.value); });
  var paid=''; document.querySelectorAll('.cf-paid:checked').forEach(function(rb){ paid=rb.value; });
  CUSTOMER_FILTERS.paid = paid;
  CUSTOMER_FILTERS.spendOp = document.getElementById('cf-spend-op').value;
  CUSTOMER_FILTERS.spendAmt = document.getElementById('cf-spend-amt').value.trim();
  CUSTOMER_FILTERS.pointsOp = document.getElementById('cf-points-op').value;
  CUSTOMER_FILTERS.pointsAmt = document.getElementById('cf-points-amt').value.trim();
  CUSTOMER_FILTERS.creditOp = document.getElementById('cf-credit-op').value;
  CUSTOMER_FILTERS.creditAmt = document.getElementById('cf-credit-amt').value.trim();
  updateCustomerFilterBadge();
  closeCustomerFilterDrawer();
  loadCustomers();
}
function clearCustomerFilters(){
  CUSTOMER_FILTERS = { joinedFrom:'', joinedTo:'', tiers:[], terms:[], paid:'', statuses:[], purchase:[], spendOp:'', spendAmt:'', pointsOp:'', pointsAmt:'', creditOp:'', creditAmt:'' };
  document.getElementById('cf-date-from').value='';
  document.getElementById('cf-date-to').value='';
  document.querySelectorAll('.cf-tier, .cf-term, .cf-status, .cf-purchase').forEach(function(cb){ cb.checked=false; });
  document.querySelectorAll('.cf-paid').forEach(function(rb){ rb.checked = rb.value===''; });
  ['cf-spend-op','cf-spend-amt','cf-points-op','cf-points-amt','cf-credit-op','cf-credit-amt'].forEach(function(idv){ document.getElementById(idv).value=''; });
  updateCustomerFilterBadge();
  loadCustomers();
}
function countActiveCustomerFilters(){
  var c=0, F=CUSTOMER_FILTERS;
  if(F.joinedFrom || F.joinedTo) c++;
  if(F.tiers.length) c++;
  if(F.statuses.length) c++;
  if(F.purchase.length) c++;
  if(F.terms.length) c++;
  if(F.paid) c++;
  if(F.spendOp && F.spendAmt!=='') c++;
  if(F.pointsOp && F.pointsAmt!=='') c++;
  if(F.creditOp && F.creditAmt!=='') c++;
  return c;
}
function updateCustomerFilterBadge(){
  var n=countActiveCustomerFilters();
  var btn=document.getElementById('cust-filter-btn');
  var badge=document.getElementById('cust-filter-count');
  if(!btn||!badge) return;
  if(n>0){ btn.classList.add('has-active'); badge.style.display='inline-flex'; badge.textContent=String(n); }
  else { btn.classList.remove('has-active'); badge.style.display='none'; }
}

async function loadCustomers(){
  var q=(document.getElementById('cust-search').value||'').trim().toLowerCase();

  // Show ONLY sales-web sign-ups: shared_profiles rows whose user_type or
  // (legacy) role is 'customer'. The web signup flows in index.html and
  // auth.html write exactly these markers; operation-system / staff accounts
  // never do. We intentionally do NOT union in "anyone who has an order" —
  // that would leak operation-system users who happen to have orders.
  //
  // Extra guard: some legacy rows were marked role='customer' AND later
  // granted operation-system permissions (shared user table). Filter those
  // out by inspecting the permissions JSONB — anyone with any non-'none'
  // module access, manage_users, or can_verify_operation is staff.
  var{data:swCusts,error}=await sb.from('shared_profiles')
    .select('*').or('user_type.eq.customer,role.eq.customer');
  if(error){
    console.error('shared_profiles read failed:',error);
    toast('Error: '+error.message,'error');
    document.getElementById('customers-table').innerHTML='<div class="loading" style="color:#dc2626;">Could not load customers — '+esc(error.message)+'</div>';
    return;
  }
  var rawRowCount = (swCusts||[]).length;
  console.log('[loadCustomers] shared_profiles returned',rawRowCount,'rows before staff filter');
  // Drop staff: either explicitly marked system, or has operation permissions.
  // Log who got rejected so future filter false-positives are obvious.
  var rejected = [];
  swCusts=(swCusts||[]).filter(function(p){
    var keep = (p.user_type !== 'system') && !isOperationStaff(p.permissions);
    if(!keep) rejected.push({email:p.email, role:p.role, user_type:p.user_type, permissions:p.permissions});
    return keep;
  });
  console.log('[loadCustomers]',swCusts.length,'rows after staff filter');
  if(rejected.length) console.log('[loadCustomers] rejected as staff:',rejected);

  // Orders → Has-Paid flag, Total Spent, paid-order COUNT, and outstanding
  // credit per customer (all excluding soft-deleted orders).
  var{data:orderRows}=await sb.from('salesweb_customer_orders')
    .select('customer_id,status,total,deleted_at,payment_terms,credit_billed_at').not('customer_id','is',null);
  var NOT_PAID = {'Pending Payment':1,'Cancelled':1,'Refunded':1};
  var paidIds={}, spentByCust={}, paidCntByCust={}, creditOwedByCust={};
  (orderRows||[]).forEach(function(r){
    if(!r.customer_id || r.deleted_at) return;
    if(!NOT_PAID[r.status]){
      paidIds[r.customer_id]=true;
      spentByCust[r.customer_id]=(spentByCust[r.customer_id]||0)+(r.total||0);
      paidCntByCust[r.customer_id]=(paidCntByCust[r.customer_id]||0)+1;
    }
    if(r.payment_terms==='credit' && !r.credit_billed_at && r.status!=='Cancelled'){
      creditOwedByCust[r.customer_id]=(creditOwedByCust[r.customer_id]||0)+(r.total||0);
    }
  });

  // Points balances → membership tier (lifetime) + current balance per customer.
  var ptsByCust={}, ptsBalByCust={};
  try{
    var{data:bals}=await sb.from('salesweb_customer_points_balance').select('user_id,lifetime_earned,balance');
    (bals||[]).forEach(function(b){ ptsByCust[b.user_id]=Number(b.lifetime_earned)||0; ptsBalByCust[b.user_id]=Number(b.balance)||0; });
  }catch(e){ /* points view optional */ }
  var tiers=await getCustTiers();

  var custs=(swCusts||[]).slice();
  custs.sort(function(a,b){return new Date(b.created_at||0)-new Date(a.created_at||0);});

  if(q)custs=custs.filter(function(c){return(c.full_name||'').toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q);});

  // ── Sidebar filters ──
  var f = CUSTOMER_FILTERS || {};
  if(f.joinedFrom) custs=custs.filter(function(c){ return c.created_at && c.created_at >= f.joinedFrom+'T00:00:00'; });
  if(f.joinedTo)   custs=custs.filter(function(c){ return c.created_at && c.created_at <= f.joinedTo+'T23:59:59'; });
  if(f.terms && f.terms.length) custs=custs.filter(function(c){ return f.terms.indexOf(c.payment_terms==='credit'?'credit':'cash') !== -1; });
  if(f.paid==='yes') custs=custs.filter(function(c){ return paidIds[c.id]; });
  if(f.paid==='no')  custs=custs.filter(function(c){ return !paidIds[c.id]; });
  if(f.tiers && f.tiers.length) custs=custs.filter(function(c){ return f.tiers.indexOf(custTierName(ptsByCust[c.id]||0,tiers)) !== -1; });
  // Status: Blacklisted (blacklisted_at set) / Verified (real email) / Unverified.
  if(f.statuses && f.statuses.length){
    custs=custs.filter(function(c){
      var bl=!!c.blacklisted_at;
      var verified = !bl && custIsVerified(c);
      var ok=false;
      if(f.statuses.indexOf('blacklisted')!==-1 && bl) ok=true;
      if(f.statuses.indexOf('verified')!==-1 && verified) ok=true;
      if(f.statuses.indexOf('unverified')!==-1 && !bl && !verified) ok=true;
      return ok;
    });
  }
  // Purchase: Never (0 paid) / First (exactly 1) / Repeat (2+).
  if(f.purchase && f.purchase.length){
    custs=custs.filter(function(c){
      var cnt=paidCntByCust[c.id]||0;
      var ok=false;
      if(f.purchase.indexOf('never')!==-1 && cnt===0) ok=true;
      if(f.purchase.indexOf('first')!==-1 && cnt===1) ok=true;
      if(f.purchase.indexOf('repeat')!==-1 && cnt>=2) ok=true;
      return ok;
    });
  }
  // Spending / Point Balance / Credit Balance comparators.
  if(f.spendOp && f.spendAmt!=='') custs=custs.filter(function(c){ return cmpAmount(spentByCust[c.id]||0, f.spendOp, Number(f.spendAmt)||0); });
  if(f.pointsOp && f.pointsAmt!=='') custs=custs.filter(function(c){ return cmpAmount(ptsBalByCust[c.id]||0, f.pointsOp, Number(f.pointsAmt)||0); });
  if(f.creditOp && f.creditAmt!=='') custs=custs.filter(function(c){ return cmpAmount(creditOwedByCust[c.id]||0, f.creditOp, Number(f.creditAmt)||0); });

  if(!custs.length){
    document.getElementById('cust-stats').innerHTML=
      '<div class="stat-box"><div class="stat-label">Total Customers</div><div class="stat-val">0</div></div>';
    var emptyMsg;
    if (q || countActiveCustomerFilters()) {
      emptyMsg = 'No customers match your search / filters.';
    } else if (rawRowCount === 0) {
      emptyMsg = 'No customers loaded. The admin account may be missing read access to <code>shared_profiles</code>. Run <code>supabase/migrations/shared_profiles_admin_read.sql</code> in the Supabase SQL editor.';
    } else {
      emptyMsg = 'No customers — all '+rawRowCount+' profiles look like staff. Check sign-up flow is writing role/user_type=customer.';
    }
    document.getElementById('customers-table').innerHTML='<div class="loading">'+emptyMsg+'</div>';
    return;
  }

  var creditCount=custs.filter(function(c){return c.payment_terms==='credit';}).length;
  var paidCount  =custs.filter(function(c){return paidIds[c.id];}).length;
  document.getElementById('cust-stats').innerHTML=
    '<div class="stat-box"><div class="stat-label">Total Customers</div><div class="stat-val">'+custs.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Has Paid Order</div><div class="stat-val" style="color:#059669;">'+paidCount+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Credit Customers</div><div class="stat-val" style="color:#a16207;">'+creditCount+'</div></div>';

  var html='<table class="data-table"><thead><tr><th></th><th>Name</th><th>Email</th><th>Phone</th><th>Membership</th><th style="text-align:right;">Total Spent</th><th>Terms</th><th>Joined</th><th>Action</th></tr></thead><tbody>';
  custs.forEach(function(c){
    var terms=c.payment_terms==='credit'?'credit':'cash';
    var termsBadge=terms==='credit'
      ? '<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;">💳 Credit</span>'
      : '<span class="badge badge-grey">💵 Cash</span>';
    var tierName=custTierName(ptsByCust[c.id]||0,tiers);
    var tierColor=custTierColor(tierName,tiers);
    var tierBadge='<span class="badge" style="background:'+tierColor+'22;color:'+tierColor+';border:1px solid '+tierColor+'55;">'+esc(tierName)+'</span>';
    var spent=spentByCust[c.id]||0;
    var spentCell=spent>0?'RM '+spent.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}):'<span style="color:var(--ink4);">—</span>';
    var blBadge=c.blacklisted_at?' <span class="badge badge-red" title="Blacklisted">Blacklisted</span>':'';
    html+='<tr>'+
      '<td>'+custAvatar(c.full_name||c.email)+'</td>'+
      '<td style="font-weight:600;"><span style="color:var(--green-dark);cursor:pointer;" onclick="viewCustomer(\''+c.id+'\')">'+esc(c.full_name||'—')+'</span>'+blBadge+'</td>'+
      '<td>'+esc(custDisplayEmail(c))+'</td>'+
      '<td>'+esc(c.phone||'—')+'</td>'+
      '<td>'+tierBadge+'</td>'+
      '<td style="text-align:right;font-weight:600;">'+spentCell+'</td>'+
      '<td>'+termsBadge+'</td>'+
      '<td>'+fmtDate(c.created_at)+'</td>'+
      '<td style="white-space:nowrap;"><button class="btn btn-outline btn-sm" onclick="openEditCustomer(\''+c.id+'\')">Edit</button> <button class="btn btn-outline btn-sm" onclick="viewCustomer(\''+c.id+'\')">View</button> <button class="btn btn-outline btn-sm" style="color:#92400e;border-color:#fde68a;" onclick="hideAsStaff(\''+c.id+'\')" title="This is a staff/operation user, not a customer">Hide</button></td>'+
    '</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('customers-table').innerHTML=html;
}

// ── Membership tier helpers ──
var _custTiers=null;
function getCustTiers(){
  if(_custTiers) return Promise.resolve(_custTiers);
  return sb.from('salesweb_app_settings').select('value').eq('key','member_tiers').single().then(function(r){
    var tiers=[{name:'Basic Member',min_points:0,color:'#6b7280'}];
    if(r && r.data && r.data.value){ try{ var parsed=JSON.parse(r.data.value); if(parsed && parsed.length) tiers=parsed; }catch(e){} }
    tiers.sort(function(a,b){ return (b.min_points||0)-(a.min_points||0); }); // highest first
    _custTiers=tiers; return tiers;
  }).catch(function(){ return [{name:'Basic Member',min_points:0,color:'#6b7280'}]; });
}
function custTierName(pts,tiers){
  for(var i=0;i<tiers.length;i++){ if(pts>=(tiers[i].min_points||0)) return tiers[i].name; }
  return tiers.length?tiers[tiers.length-1].name:'—';
}
function custTierColor(name,tiers){
  for(var i=0;i<tiers.length;i++){ if(tiers[i].name===name) return tiers[i].color||'#6b7280'; }
  return '#6b7280';
}
// A customer counts as "verified" when they have a real (non walk-in
// placeholder) email on file. Walk-in/admin-created profiles use a
// @admin.mjmnursery.local placeholder and read as unverified.
function custIsVerified(c){
  return !!c.email && !/@admin\.mjmnursery\.local$/i.test(c.email);
}
// Display the customer's email, or '—' if they have none (or a walk-in
// placeholder email left over from earlier admin-created profiles).
function custDisplayEmail(c){
  if(!c || !c.email) return '—';
  if(/@admin\.mjmnursery\.local$/i.test(c.email)) return '—';
  return c.email;
}
// Numeric comparator for the Spending / Points / Credit filters.
function cmpAmount(value, op, amt){
  if(op==='gt') return value > amt;
  if(op==='lt') return value < amt;
  if(op==='eq') return Math.abs(value - amt) < 0.005;
  return true;
}
async function blacklistCustomer(id){
  if(!confirm('Blacklist this customer? They will be flagged in the customer list and filterable under Status → Blacklisted.'))return;
  var{error}=await sb.from('shared_profiles').update({blacklisted_at:new Date().toISOString()}).eq('id',id);
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Customer blacklisted');
  closeModal('modal-customer'); loadCustomers();
}
async function unblacklistCustomer(id){
  var{error}=await sb.from('shared_profiles').update({blacklisted_at:null}).eq('id',id);
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Customer un-blacklisted');
  closeModal('modal-customer'); loadCustomers();
}
function custAvatar(nameOrEmail){
  var s=(nameOrEmail||'?').trim();
  var parts=s.split(/\s+/).filter(Boolean);
  var initials=(parts.slice(0,2).map(function(w){return w.charAt(0).toUpperCase();}).join(''))||'?';
  var h=0; for(var i=0;i<s.length;i++){ h=s.charCodeAt(i)+((h<<5)-h); }
  var hue=Math.abs(h)%360;
  return '<span style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:hsl('+hue+',42%,52%);color:#fff;font-size:11px;font-weight:700;">'+esc(initials)+'</span>';
}

// ═══════════════════════════════════════
//  ADD CUSTOMER
//  Creates an auth user (isolated client so the admin session isn't
//  clobbered) + a shared_profiles row tagged as a customer. Same pattern
//  as the admin "+ Add Order" walk-in customer creation.
// ═══════════════════════════════════════
function openAddCustomer(){
  document.getElementById('ac-name').value='';
  document.getElementById('ac-email').value='';
  document.getElementById('ac-phone').value='';
  document.getElementById('ac-terms').value='cash';
  var st=document.getElementById('ac-status'); st.style.display='none'; st.textContent='';
  var btn=document.getElementById('ac-submit'); btn.disabled=false; btn.textContent='Create Customer';
  openModal('modal-add-customer');
}
async function submitAddCustomer(){
  var name=document.getElementById('ac-name').value.trim();
  var email=document.getElementById('ac-email').value.trim();
  var phone=document.getElementById('ac-phone').value.trim();
  var terms=document.getElementById('ac-terms').value;
  if(!name){toast('Customer name is required','error');return;}

  var btn=document.getElementById('ac-submit');
  btn.disabled=true; btn.textContent='Creating…';

  // If an email is given, reuse an existing profile rather than duplicating.
  var existingId=null;
  if(email){
    var{data:byEmail}=await sb.from('shared_profiles').select('id').ilike('email',email).limit(1);
    if(byEmail && byEmail.length) existingId=byEmail[0].id;
  }
  if(existingId){
    await sb.from('shared_profiles').update({full_name:name,phone:phone||null,payment_terms:terms,user_type:'customer',role:'customer'}).eq('id',existingId);
    toast('Existing customer updated');
    btn.disabled=false; btn.textContent='Create Customer';
    closeModal('modal-add-customer'); loadCustomers();
    return;
  }

  try{
    var signupEmail = email || ('walkin-'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'@admin.mjmnursery.local');
    var signupPw = (crypto && crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)))+'!Aa1';
    var tempSb = supabase.createClient(SB_URL, SB_KEY, { auth:{ persistSession:false, autoRefreshToken:false, storageKey:'admin-add-customer-'+Date.now() } });
    var{data:signUpData,error:signUpErr} = await tempSb.auth.signUp({ email:signupEmail, password:signupPw, options:{ data:{ full_name:name, user_type:'customer' } } });
    var custId=null;
    if(signUpErr){
      if(/already|exists|registered/i.test(signUpErr.message||'')){
        var{data:dup}=await sb.from('shared_profiles').select('id').ilike('email',signupEmail).limit(1);
        if(dup && dup.length) custId=dup[0].id;
      }
      if(!custId){ throw signUpErr; }
    } else if(signUpData && signUpData.user){
      custId=signUpData.user.id;
    }
    if(!custId){ throw new Error('Could not create customer profile'); }
    // Store the REAL email on the profile; if none was given, leave it NULL
    // (the auth user keeps the placeholder so signup works, but the
    // customer list shows blank instead of "walkin-…@admin.mjmnursery.local").
    await sb.from('shared_profiles').upsert({ id:custId, email:(email||null), full_name:name, phone:phone||null, payment_terms:terms, user_type:'customer', role:'customer' },{ onConflict:'id' });
    toast('Customer created');
    closeModal('modal-add-customer');
    loadCustomers();
  }catch(e){
    toast('Error: '+(e&&e.message?e.message:'Could not create customer'),'error');
  }finally{
    btn.disabled=false; btn.textContent='Create Customer';
  }
}

// ═══════════════════════════════════════
//  EDIT CUSTOMER
//  Lightweight edit (name / email / phone / payment terms) opened from
//  the customer list. Email may be blank — walk-in customers are stored
//  with shared_profiles.email = NULL (the auth user keeps its placeholder).
// ═══════════════════════════════════════
var _editCustomerId = null;
async function openEditCustomer(id){
  _editCustomerId = id;
  var{data:c, error}=await sb.from('shared_profiles').select('*').eq('id',id).maybeSingle();
  if(error || !c){ toast('Customer not found','error'); return; }
  document.getElementById('ec-name').value = c.full_name || '';
  // Hide the walk-in placeholder so the admin sees a true blank.
  document.getElementById('ec-email').value = custDisplayEmail(c) === '—' ? '' : (c.email||'');
  document.getElementById('ec-phone').value = c.phone || '';
  document.getElementById('ec-terms').value = c.payment_terms==='credit' ? 'credit' : 'cash';
  var btn=document.getElementById('ec-submit'); btn.disabled=false; btn.textContent='Save Changes';
  openModal('modal-edit-customer');
}
async function submitEditCustomer(){
  if(!_editCustomerId){ toast('No customer selected','error'); return; }
  var name=document.getElementById('ec-name').value.trim();
  var email=document.getElementById('ec-email').value.trim();
  var phone=document.getElementById('ec-phone').value.trim();
  var terms=document.getElementById('ec-terms').value;
  if(!name){ toast('Name is required','error'); return; }
  var btn=document.getElementById('ec-submit'); btn.disabled=true; btn.textContent='Saving…';
  var{error}=await sb.from('shared_profiles').update({
    full_name: name,
    email: email || null,
    phone: phone || null,
    payment_terms: terms
  }).eq('id', _editCustomerId);
  btn.disabled=false; btn.textContent='Save Changes';
  if(error){ toast('Error: '+error.message,'error'); return; }
  toast('Customer updated');
  closeModal('modal-edit-customer');
  loadCustomers();
}

// ═══════════════════════════════════════
//  SUB-TAB SWITCHING
// ═══════════════════════════════════════
function showCustSubTab(tab){
  ['list','groups','points'].forEach(function(t){
    var panel=document.getElementById('cust-panel-'+t);
    var btn=document.getElementById('cust-subtab-'+t);
    if(panel) panel.style.display = (t===tab)?'':'none';
    if(btn){ btn.className='btn btn-'+(t===tab?'primary':'outline')+' btn-sm'; btn.style.fontSize='11px'; }
  });
  if(tab==='points')loadPointsSettings();
  if(tab==='groups')loadCustomerGroups();
}

// ═══════════════════════════════════════
//  CUSTOMER GROUPS
//  Tables: salesweb_customer_groups + salesweb_customer_group_members
//  (see supabase/migrations/customer_groups.sql)
// ═══════════════════════════════════════
async function loadCustomerGroups(){
  var el=document.getElementById('groups-table'); if(!el) return;
  el.innerHTML='<div class="loading">Loading groups…</div>';
  var{data:groups,error}=await sb.from('salesweb_customer_groups').select('*').order('name',{ascending:true});
  if(error){ el.innerHTML='<div class="loading" style="color:var(--red);">'+esc(error.message)+'</div>'; return; }
  if(!groups || !groups.length){ el.innerHTML='<div class="loading">No groups yet. Click <strong>+ New Group</strong> to create one.</div>'; return; }
  // Get member counts in one round-trip.
  var{data:mems}=await sb.from('salesweb_customer_group_members').select('group_id');
  var countByGroup={};
  (mems||[]).forEach(function(r){ countByGroup[r.group_id]=(countByGroup[r.group_id]||0)+1; });
  var html='<table class="data-table"><thead><tr><th>Group</th><th>Description</th><th style="text-align:right;">Members</th><th>Created</th><th>Action</th></tr></thead><tbody>';
  groups.forEach(function(g){
    var color=g.color||'#7c5cbf';
    html+='<tr>'+
      '<td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+esc(color)+';margin-right:.4rem;vertical-align:middle;"></span><strong>'+esc(g.name)+'</strong></td>'+
      '<td style="font-size:12px;color:var(--ink3);">'+esc(g.description||'—')+'</td>'+
      '<td style="text-align:right;font-weight:600;">'+(countByGroup[g.id]||0)+'</td>'+
      '<td style="font-size:12px;">'+fmtDate(g.created_at)+'</td>'+
      '<td style="white-space:nowrap;">'+
        '<button class="btn btn-outline btn-sm" onclick="openManageGroupMembers(\''+esc(g.id)+'\',\''+esc(g.name).replace(/\'/g,'&#39;')+'\')">Manage Members</button> '+
        '<button class="btn btn-outline btn-sm" onclick="openEditGroup(\''+esc(g.id)+'\')">Edit</button> '+
        '<button class="btn btn-outline btn-sm" style="color:var(--red);border-color:var(--red);" onclick="deleteGroup(\''+esc(g.id)+'\')">Delete</button>'+
      '</td>'+
    '</tr>';
  });
  html+='</tbody></table>';
  el.innerHTML=html;
}

function openCreateGroup(){
  document.getElementById('mg-title').textContent='New Group';
  document.getElementById('mg-id').value='';
  document.getElementById('mg-name').value='';
  document.getElementById('mg-desc').value='';
  document.getElementById('mg-color').value='#7c5cbf';
  openModal('modal-group-edit');
}
async function openEditGroup(id){
  var{data:g}=await sb.from('salesweb_customer_groups').select('*').eq('id',id).maybeSingle();
  if(!g){ toast('Group not found','error'); return; }
  document.getElementById('mg-title').textContent='Edit Group';
  document.getElementById('mg-id').value=g.id;
  document.getElementById('mg-name').value=g.name||'';
  document.getElementById('mg-desc').value=g.description||'';
  document.getElementById('mg-color').value=g.color||'#7c5cbf';
  openModal('modal-group-edit');
}
async function saveGroup(){
  var id=document.getElementById('mg-id').value;
  var name=document.getElementById('mg-name').value.trim();
  var desc=document.getElementById('mg-desc').value.trim();
  var color=document.getElementById('mg-color').value;
  if(!name){ toast('Group name is required','error'); return; }
  var row={name:name, description:desc||null, color:color||null, updated_at:new Date().toISOString()};
  var{error}= id
    ? await sb.from('salesweb_customer_groups').update(row).eq('id',id)
    : await sb.from('salesweb_customer_groups').insert([row]);
  if(error){ toast('Error: '+error.message,'error'); return; }
  toast(id?'Group updated':'Group created');
  closeModal('modal-group-edit');
  loadCustomerGroups();
}
async function deleteGroup(id){
  if(!confirm('Delete this group? Memberships are removed too.'))return;
  var{error}=await sb.from('salesweb_customer_groups').delete().eq('id',id);
  if(error){ toast('Error: '+error.message,'error'); return; }
  toast('Group deleted');
  loadCustomerGroups();
}

// Membership editor — checkbox list of all customers; ticked = in group.
var _mmAllCustomers=[], _mmCurrentMembers={};
async function openManageGroupMembers(groupId, groupName){
  document.getElementById('mm-title').textContent='Members of "'+groupName+'"';
  document.getElementById('mm-group-id').value=groupId;
  document.getElementById('mm-search').value='';
  document.getElementById('mm-list').innerHTML='<div class="loading">Loading…</div>';
  openModal('modal-group-members');
  // Customers + current group memberships.
  if(!_mmAllCustomers.length){
    var{data:custs}=await sb.from('shared_profiles').select('id, full_name, email').or('user_type.eq.customer,role.eq.customer').order('full_name',{ascending:true});
    _mmAllCustomers = custs || [];
  }
  var{data:mems}=await sb.from('salesweb_customer_group_members').select('customer_id').eq('group_id', groupId);
  _mmCurrentMembers = {};
  (mems||[]).forEach(function(r){ _mmCurrentMembers[r.customer_id]=true; });
  renderGroupMembersList();
}
function renderGroupMembersList(){
  var q=(document.getElementById('mm-search').value||'').toLowerCase();
  var rows=_mmAllCustomers.filter(function(c){
    if(!q) return true;
    return (c.full_name||'').toLowerCase().indexOf(q)>=0 || (c.email||'').toLowerCase().indexOf(q)>=0;
  });
  if(!rows.length){ document.getElementById('mm-list').innerHTML='<div style="padding:1rem;font-size:12px;color:var(--ink4);">No customers match.</div>'; return; }
  var html='';
  rows.forEach(function(c){
    var checked = _mmCurrentMembers[c.id] ? ' checked' : '';
    var label = (c.full_name||'—');
    if(c.email && /@admin\.mjmnursery\.local$/i.test(c.email)) label += ' (walk-in)';
    else if(c.email) label += ' · '+c.email;
    html+='<label style="display:flex;align-items:center;gap:.5rem;padding:.45rem .7rem;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer;">'
        +'<input type="checkbox" class="mm-row" data-id="'+esc(c.id)+'"'+checked+' onchange="_mmCurrentMembers[this.dataset.id]=this.checked;">'
        +'<span>'+esc(label)+'</span></label>';
  });
  document.getElementById('mm-list').innerHTML=html;
}
async function saveGroupMembers(){
  var groupId=document.getElementById('mm-group-id').value;
  if(!groupId) return;
  // Diff current vs desired and apply only the changes.
  var{data:before}=await sb.from('salesweb_customer_group_members').select('customer_id').eq('group_id', groupId);
  var beforeSet={}; (before||[]).forEach(function(r){ beforeSet[r.customer_id]=true; });
  var toAdd=[], toRemove=[];
  Object.keys(_mmCurrentMembers).forEach(function(cid){
    if(_mmCurrentMembers[cid] && !beforeSet[cid]) toAdd.push({group_id:groupId, customer_id:cid});
  });
  Object.keys(beforeSet).forEach(function(cid){
    if(!_mmCurrentMembers[cid]) toRemove.push(cid);
  });
  if(toAdd.length){
    var ins=await sb.from('salesweb_customer_group_members').insert(toAdd);
    if(ins.error){ toast('Error adding members: '+ins.error.message,'error'); return; }
  }
  if(toRemove.length){
    var del=await sb.from('salesweb_customer_group_members').delete().eq('group_id', groupId).in('customer_id', toRemove);
    if(del.error){ toast('Error removing members: '+del.error.message,'error'); return; }
  }
  toast('Members updated · +'+toAdd.length+' / −'+toRemove.length);
  closeModal('modal-group-members');
  loadCustomerGroups();
}

// ═══════════════════════════════════════
//  POINTS SETTINGS
// ═══════════════════════════════════════
var pointsConfig={earn_rm:1,earn_pts:1,redeem_pts:100,redeem_rm:1};

async function loadPointsSettings(){
  // Load from Supabase (settings table or use a simple key-value approach)
  var{data}=await sb.from('salesweb_app_settings').select('*').eq('key','points_config').single();
  if(data&&data.value){
    try{pointsConfig=JSON.parse(data.value);}catch(e){}
  }
  // Use the saved value as-is; only fall back when the property is actually missing.
  document.getElementById('pts-earn-rm').value    = pointsConfig.earn_rm    != null ? pointsConfig.earn_rm    : 1;
  document.getElementById('pts-earn-pts').value   = pointsConfig.earn_pts   != null ? pointsConfig.earn_pts   : 1;
  document.getElementById('pts-redeem-pts').value = pointsConfig.redeem_pts != null ? pointsConfig.redeem_pts : 100;
  document.getElementById('pts-redeem-rm').value  = pointsConfig.redeem_rm  != null ? pointsConfig.redeem_rm  : 1;
  updatePointsSummary();
  togglePointsEdit(false);
  // Set default date range to current month
  setPtsDateRange('month');
  loadTiers();
  loadPointsHistory();
}

function togglePointsEdit(editing){
  var inputs=['pts-earn-rm','pts-earn-pts','pts-redeem-pts','pts-redeem-rm'];
  inputs.forEach(function(id){document.getElementById(id).disabled=!editing;});
  document.getElementById('pts-edit-btn').style.display=editing?'none':'';
  document.getElementById('pts-save-btn').style.display=editing?'':'none';
  document.getElementById('pts-cancel-btn').style.display=editing?'':'none';
  if(!editing){
    // Revert to last-saved values (don't clobber a 0 with a fallback).
    document.getElementById('pts-earn-rm').value    = pointsConfig.earn_rm    != null ? pointsConfig.earn_rm    : 1;
    document.getElementById('pts-earn-pts').value   = pointsConfig.earn_pts   != null ? pointsConfig.earn_pts   : 1;
    document.getElementById('pts-redeem-pts').value = pointsConfig.redeem_pts != null ? pointsConfig.redeem_pts : 100;
    document.getElementById('pts-redeem-rm').value  = pointsConfig.redeem_rm  != null ? pointsConfig.redeem_rm  : 1;
    updatePointsSummary();
  }
}

function updatePointsSummary(){
  var earnRm    = Math.max(0.01, parseFloat(document.getElementById('pts-earn-rm').value)    || 1);
  var earnPts   = Math.max(0,    parseInt  (document.getElementById('pts-earn-pts').value)   || 0);
  var redeemPts = Math.max(1,    parseInt  (document.getElementById('pts-redeem-pts').value) || 100);
  var redeemRm  = Math.max(0,    parseFloat(document.getElementById('pts-redeem-rm').value)  || 0);

  // Effective cashback rate = (points-per-RM-spent) * (RM-per-point-redeemed) * 100%.
  // i.e. for every RM 100 a customer spends, what fraction comes back as redeemable discount.
  var ptsPerRm   = earnPts / earnRm;
  var rmPerPt    = redeemRm / redeemPts;
  var cashbackPct = ptsPerRm * rmPerPt * 100;

  // Sample product price: pick the smallest price that earns enough points
  // for one full redemption, so the worked example is whole-number friendly
  // (e.g. earn 1pt/RM, redeem 25pts=RM1 → sample RM 25 product → RM 1 off = 4%).
  var samplePrice = ptsPerRm > 0 ? Math.max(1, Math.ceil(redeemPts / ptsPerRm)) : 0;
  var samplePtsEarned = samplePrice * ptsPerRm;
  var sampleRmOff     = samplePtsEarned * rmPerPt;

  document.getElementById('pts-summary').innerHTML=
    '<strong>Earning:</strong> RM '+earnRm+' spent = '+earnPts+' point(s)<br>'+
    '<strong>Redemption:</strong> '+redeemPts+' points = RM '+redeemRm.toFixed(2)+' discount<br>'+
    '<strong>Point value:</strong> 1 point = RM '+(rmPerPt).toFixed(4)+'<br>'+
    '<strong>Effective cashback:</strong> '+cashbackPct.toFixed(2)+'% '+
      '<span style="color:var(--ink4);font-size:11px;">(every RM 100 spent → RM '+(cashbackPct).toFixed(2)+' redeemable discount)</span><br>'+
    '<strong>Product discount:</strong> '+cashbackPct.toFixed(2)+'% off '+
      (ptsPerRm > 0
        ? '<span style="color:var(--ink4);font-size:11px;">(e.g. RM '+samplePrice+' product → '+samplePtsEarned+' points earned → RM '+sampleRmOff.toFixed(2)+' off ≈ '+cashbackPct.toFixed(2)+'%)</span>'
        : '<span style="color:var(--ink4);font-size:11px;">(no points earned per RM spent)</span>');
}

async function savePointsSettings(){
  // Parse each field; treat blank/NaN as "use what was there before" so the
  // user can't accidentally wipe a value by leaving a field empty.
  function readNum(id, parser, fallback){
    var raw = document.getElementById(id).value;
    if (raw === '' || raw === null || raw === undefined) return fallback;
    var n = parser(raw);
    return isNaN(n) ? fallback : n;
  }
  var config = {
    earn_rm:    readNum('pts-earn-rm',    parseFloat, pointsConfig.earn_rm    != null ? pointsConfig.earn_rm    : 1),
    earn_pts:   readNum('pts-earn-pts',   parseInt,   pointsConfig.earn_pts   != null ? pointsConfig.earn_pts   : 1),
    redeem_pts: readNum('pts-redeem-pts', parseInt,   pointsConfig.redeem_pts != null ? pointsConfig.redeem_pts : 100),
    redeem_rm:  readNum('pts-redeem-rm',  parseFloat, pointsConfig.redeem_rm  != null ? pointsConfig.redeem_rm  : 1)
  };
  // Sanity-clamp to prevent divide-by-zero in the summary math.
  if (config.earn_rm    <= 0) config.earn_rm    = 0.01;
  if (config.redeem_pts <= 0) config.redeem_pts = 1;

  var{error}=await sb.from('salesweb_app_settings').upsert({key:'points_config',value:JSON.stringify(config),updated_at:new Date().toISOString()},{onConflict:'key'});
  if(error){toast('Save failed: '+error.message,'error');return;}

  // Log change to history
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  var oldConfig=pointsConfig;
  var changes=[];
  if(config.earn_rm!==oldConfig.earn_rm||config.earn_pts!==oldConfig.earn_pts)changes.push('Earning: RM'+config.earn_rm+'='+config.earn_pts+'pts (was RM'+oldConfig.earn_rm+'='+oldConfig.earn_pts+'pts)');
  if(config.redeem_pts!==oldConfig.redeem_pts||config.redeem_rm!==oldConfig.redeem_rm)changes.push('Redemption: '+config.redeem_pts+'pts=RM'+config.redeem_rm+' (was '+oldConfig.redeem_pts+'pts=RM'+oldConfig.redeem_rm+')');
  if(changes.length){
    // Load existing history and append
    var{data:histData}=await sb.from('salesweb_app_settings').select('value').eq('key','points_history').single();
    var history=[];
    if(histData&&histData.value){try{history=JSON.parse(histData.value);}catch(e){}}
    history.unshift({date:new Date().toISOString(),by:user,changes:changes.join('; ')});
    if(history.length>20)history=history.slice(0,20); // Keep last 20
    await sb.from('salesweb_app_settings').upsert({key:'points_history',value:JSON.stringify(history)},{onConflict:'key'});
  }

  pointsConfig=config;
  updatePointsSummary();
  togglePointsEdit(false);
  loadPointsHistory();
  toast('Points settings saved');
}

async function loadPointsHistory(){
  var{data}=await sb.from('salesweb_app_settings').select('value').eq('key','points_history').single();
  var el=document.getElementById('pts-history');
  var history=[];
  if(data&&data.value){try{history=JSON.parse(data.value);}catch(e){}}
  if(!history.length){el.innerHTML='<div style="color:var(--ink4);font-size:12px;">No changes recorded yet.</div>';return;}
  el.innerHTML=history.map(function(h){
    var dt=new Date(h.date).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
    return'<div style="padding:.4rem 0;border-bottom:1px solid var(--border);font-size:12px;">'+
      '<div style="display:flex;justify-content:space-between;"><span style="font-weight:600;color:var(--ink2);">'+esc(h.changes)+'</span></div>'+
      '<div style="font-size:10px;color:var(--ink4);margin-top:.15rem;">'+dt+' by '+esc(h.by)+'</div></div>';
  }).join('');
}

function setPtsDateRange(range){
  var now=new Date();
  var from,to;
  if(range==='month'){
    from=new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0];
    to=new Date(now.getFullYear(),now.getMonth()+1,0).toISOString().split('T')[0];
  } else if(range==='year'){
    from=now.getFullYear()+'-01-01';
    to=now.getFullYear()+'-12-31';
  } else {
    from='';to='';
  }
  document.getElementById('pts-date-from').value=from;
  document.getElementById('pts-date-to').value=to;
  loadPointsStats();
}

async function loadPointsStats(){
  var from=document.getElementById('pts-date-from').value;
  var to=document.getElementById('pts-date-to').value;

  // Default to current month if empty on first load
  if(!from&&!to){
    var now=new Date();
    from=new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0];
    to=new Date(now.getFullYear(),now.getMonth()+1,0).toISOString().split('T')[0];
    document.getElementById('pts-date-from').value=from;
    document.getElementById('pts-date-to').value=to;
  }

  var query=sb.from('salesweb_customer_orders').select('points_issued,total,status,created_at').not('status','eq','Cancelled');
  if(from)query=query.gte('created_at',from+'T00:00:00');
  if(to)query=query.lte('created_at',to+'T23:59:59');
  var{data:orders}=await query;
  orders=orders||[];

  var totalIssued=orders.reduce(function(s,o){return s+(o.points_issued||0);},0);

  // Sum redeemed points from the ledger in the same date range. Falls back
  // to 0 if the ledger doesn't exist yet (migration not run).
  var totalRedeemed=0;
  try{
    var ledgerQ=sb.from('salesweb_points_ledger').select('change').eq('type','Redeemed');
    if(from)ledgerQ=ledgerQ.gte('created_at',from+'T00:00:00');
    if(to)ledgerQ=ledgerQ.lte('created_at',to+'T23:59:59');
    var{data:ledRows}=await ledgerQ;
    if(ledRows)totalRedeemed=ledRows.reduce(function(s,r){return s+Math.abs(Number(r.change)||0);},0);
  }catch(e){}

  // Calculate RM value from points config
  var redeemPts=pointsConfig.redeem_pts||100;
  var redeemRm=pointsConfig.redeem_rm||1;
  var issuedRmValue=(totalIssued/redeemPts)*redeemRm;
  var redeemedRmValue=(totalRedeemed/redeemPts)*redeemRm;

  var rangeLabel=from&&to?' ('+from+' to '+to+')':' (All Time)';

  document.getElementById('pts-stats').innerHTML=
    '<div class="stat-box"><div class="stat-label">Points Issued'+rangeLabel+'</div><div class="stat-val">'+totalIssued.toLocaleString()+'</div><div style="font-size:11px;color:var(--ink4);margin-top:.2rem;">= RM '+issuedRmValue.toLocaleString('en-MY',{minimumFractionDigits:2})+' value</div></div>'+
    '<div class="stat-box"><div class="stat-label">Points Redeemed'+rangeLabel+'</div><div class="stat-val">'+totalRedeemed.toLocaleString()+'</div><div style="font-size:11px;color:var(--ink4);margin-top:.2rem;">= RM '+redeemedRmValue.toLocaleString('en-MY',{minimumFractionDigits:2})+' discounted</div></div>';
}

// ═══════════════════════════════════════
//  MEMBER TIERS
// ═══════════════════════════════════════
var tiersData=[];

async function loadTiers(){
  var{data}=await sb.from('salesweb_app_settings').select('*').eq('key','member_tiers').single();
  if(data&&data.value){
    try{tiersData=JSON.parse(data.value);}catch(e){tiersData=[];}
  }
  if(!tiersData.length){
    // Default tiers
    tiersData=[
      {name:'Bronze',min_points:0,color:'#CD7F32'},
      {name:'Silver',min_points:500,color:'#C0C0C0'},
      {name:'Gold',min_points:2000,color:'#FFD700'},
      {name:'Platinum',min_points:5000,color:'#E5E4E2'}
    ];
  }
  renderTiers();
}

function renderTiers(){
  var html='<div style="display:flex;flex-direction:column;gap:.6rem;">';
  tiersData.forEach(function(t,i){
    html+='<div style="display:flex;align-items:center;gap:.6rem;padding:.7rem;background:var(--bg);border-radius:10px;border:1px solid var(--border);">';
    html+='<input type="color" value="'+(t.color||'#C0C0C0')+'" onchange="tiersData['+i+'].color=this.value" style="width:32px;height:32px;border:none;border-radius:6px;cursor:pointer;padding:0;">';
    html+='<input class="form-input" value="'+esc(t.name)+'" onchange="tiersData['+i+'].name=this.value" style="flex:1;font-size:13px;font-weight:600;padding:6px 10px;" placeholder="Tier name">';
    html+='<div style="display:flex;align-items:center;gap:.3rem;"><span style="font-size:11px;color:var(--ink3);white-space:nowrap;">Min pts:</span><input class="form-input" type="number" value="'+(t.min_points||0)+'" onchange="tiersData['+i+'].min_points=parseInt(this.value)||0" style="width:80px;font-size:13px;padding:6px 10px;text-align:center;"></div>';
    html+='<button class="btn btn-outline btn-sm" onclick="tiersData.splice('+i+',1);renderTiers();" style="color:var(--red);font-size:10px;padding:4px 8px;">✕</button>';
    html+='</div>';
  });
  html+='</div>';
  html+='<button class="btn btn-primary btn-sm" onclick="saveTiers()" style="margin-top:.8rem;width:100%;">Save Tiers</button>';
  document.getElementById('tiers-list').innerHTML=html;
}

function addTierRow(){
  tiersData.push({name:'New Tier',min_points:0,color:'#808080'});
  renderTiers();
}

async function saveTiers(){
  // Sort by min_points ascending
  tiersData.sort(function(a,b){return a.min_points-b.min_points;});
  var{error}=await sb.from('salesweb_app_settings').upsert({key:'member_tiers',value:JSON.stringify(tiersData)},{onConflict:'key'});
  if(error){toast('Error: '+error.message,'error');return;}
  renderTiers();
  toast('Member tiers saved');
}

// Listen to settings inputs for live summary update
document.addEventListener('DOMContentLoaded',function(){
  ['pts-earn-rm','pts-earn-pts','pts-redeem-pts','pts-redeem-rm'].forEach(function(id){
    var el=document.getElementById(id);
    if(el)el.addEventListener('input',updatePointsSummary);
  });
});

async function viewCustomer(id){
  var{data:c}=await sb.from('shared_profiles').select('*').eq('id',id).single();
  if(!c){toast('Customer not found','error');return;}
  var{data:orders}=await sb.from('salesweb_customer_orders').select('*').eq('customer_id',id).order('created_at',{ascending:false});
  orders=orders||[];

  // Calculate stats
  var totalSpend=orders.filter(function(o){return o.status!=='Cancelled';}).reduce(function(s,o){return s+(o.total||0);},0);
  var totalPurchases=orders.filter(function(o){return o.status!=='Cancelled';}).length;

  // Pull points totals from the ledger view — this is the single source of
  // truth and reflects both earnings (from orders) and redemptions. Fall back
  // to summing per-order points_issued if the view returns nothing.
  var totalPtsEarned=0, totalPtsRedeemed=0, ptsBalance=0;
  try{
    var{data:bal}=await sb.from('salesweb_customer_points_balance')
      .select('balance,lifetime_earned,lifetime_redeemed')
      .eq('user_id',id).maybeSingle();
    if(bal){
      ptsBalance=Number(bal.balance)||0;
      totalPtsEarned=Number(bal.lifetime_earned)||0;
      totalPtsRedeemed=Number(bal.lifetime_redeemed)||0;
    }
  }catch(e){}
  if(!totalPtsEarned){
    totalPtsEarned=orders.reduce(function(s,o){return s+(o.points_issued||0);},0);
    if(!ptsBalance) ptsBalance=totalPtsEarned-totalPtsRedeemed;
  }
  var activeOrders=orders.filter(function(o){return o.status!=='Completed'&&o.status!=='Cancelled';});
  var historyOrders=orders.filter(function(o){return o.status==='Completed'||o.status==='Cancelled';});

  // Determine tier
  var tiers=[{name:'Bronze',min_points:0,color:'#CD7F32'}];
  try{
    var{data:tiersData}=await sb.from('salesweb_app_settings').select('value').eq('key','member_tiers').single();
    if(tiersData&&tiersData.value)tiers=JSON.parse(tiersData.value);
  }catch(e){}
  tiers.sort(function(a,b){return b.min_points-a.min_points;});
  var currentTier=tiers[tiers.length-1];
  for(var i=0;i<tiers.length;i++){if(totalPtsEarned>=tiers[i].min_points){currentTier=tiers[i];break;}}

  document.getElementById('mcu-title').textContent=esc(c.full_name||c.email||'Customer');

  // Build 2-column layout
  var html='<div style="display:grid;grid-template-columns:1fr 280px;gap:1.5rem;">';

  // ── LEFT COLUMN ──
  html+='<div>';

  // Header with name, joined, actions
  html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.2rem;">';
  html+='<div><div style="font-size:1.2rem;font-weight:800;">'+esc(c.full_name||'—')+'</div><div style="font-size:12px;color:var(--ink4);">Joined '+fmtDate(c.created_at)+'</div></div>';
  var blackBtn=c.blacklisted_at
    ? '<button class="btn btn-outline btn-sm" style="color:var(--green);border-color:var(--green);" onclick="unblacklistCustomer(\''+id+'\')">Un-blacklist</button>'
    : '<button class="btn btn-outline btn-sm" style="color:#92400e;border-color:#fde68a;" onclick="blacklistCustomer(\''+id+'\')">Blacklist</button>';
  html+='<div style="display:flex;gap:.4rem;"><button class="btn btn-outline btn-sm" onclick="resetCustomerPassword(\''+c.email+'\')">Reset Password</button>'+blackBtn+'<button class="btn btn-outline btn-sm" onclick="deleteCustomer(\''+id+'\')" style="color:var(--red);">Delete</button></div>';
  html+='</div>';

  // Stats row
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-bottom:1.2rem;">';
  html+='<div style="background:var(--bg);border-radius:10px;padding:.8rem 1rem;"><div style="font-size:10px;font-weight:700;color:var(--ink4);text-transform:uppercase;letter-spacing:.06em;">Total Spend</div><div style="font-size:1.3rem;font-weight:800;color:var(--ink);">RM '+totalSpend.toLocaleString('en-MY',{minimumFractionDigits:2})+'</div></div>';
  html+='<div style="background:var(--bg);border-radius:10px;padding:.8rem 1rem;"><div style="font-size:10px;font-weight:700;color:var(--ink4);text-transform:uppercase;letter-spacing:.06em;">Total Purchases</div><div style="font-size:1.3rem;font-weight:800;color:var(--ink);">'+totalPurchases+'</div></div>';
  html+='</div>';

  // Contact info
  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;margin-bottom:1.2rem;">';
  html+='<div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.6rem;">Contact Information</div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem .8rem;font-size:13px;">';
  html+='<div style="color:var(--ink4);">Full Name</div><div style="font-weight:600;">'+esc(c.full_name||'—')+'</div>';
  html+='<div style="color:var(--ink4);">Email</div><div style="font-weight:600;">'+esc(custDisplayEmail(c))+'</div>';
  html+='<div style="color:var(--ink4);">Phone</div><div style="font-weight:600;">'+esc(c.phone||'—')+'</div>';
  html+='<div style="color:var(--ink4);">Role</div><div><span class="badge '+(c.role==='admin'?'badge-green':'badge-grey')+'">'+esc(c.role||'customer')+'</span></div>';
  html+='</div></div>';

  // Payment terms — admin-toggleable
  var terms=c.payment_terms==='credit'?'credit':'cash';
  var creditLimit=c.credit_limit==null?'':String(c.credit_limit);
  html+='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:1rem;margin-bottom:1.2rem;">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;">';
  html+='<div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;">Payment Terms</div>';
  html+='<div style="font-size:10px;color:var(--ink4);">Default · Cash &nbsp;|&nbsp; Credit = monthly billed</div>';
  html+='</div>';
  html+='<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">';
  html+='<button class="btn btn-sm '+(terms==='cash'?'btn-primary':'btn-outline')+'" onclick="setCustomerTerms(\''+id+'\',\'cash\')" style="font-size:11px;">💵 Cash (pay before collect)</button>';
  html+='<button class="btn btn-sm '+(terms==='credit'?'btn-primary':'btn-outline')+'" onclick="setCustomerTerms(\''+id+'\',\'credit\')" style="font-size:11px;">💳 Credit (monthly bill)</button>';
  html+='</div>';
  if(terms==='credit'){
    html+='<div style="margin-top:.8rem;display:flex;gap:.4rem;align-items:center;font-size:12px;">';
    html+='<label style="color:var(--ink4);">Monthly credit limit (RM):</label>';
    html+='<input type="number" id="cust-credit-limit" value="'+esc(creditLimit)+'" placeholder="No limit" style="width:120px;padding:.3rem .5rem;border:1px solid var(--border);border-radius:6px;font-size:12px;">';
    html+='<button class="btn btn-outline btn-sm" onclick="setCustomerCreditLimit(\''+id+'\')" style="font-size:11px;">Save</button>';
    html+='</div>';
  }
  html+='</div>';

  // Active Orders
  html+='<div style="margin-bottom:1.2rem;"><div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5rem;">Active Orders ('+activeOrders.length+')</div>';
  if(activeOrders.length){
    html+='<table class="data-table"><thead><tr><th>Order</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>';
    activeOrders.forEach(function(o){
      var sId=o.order_number||o.id.substring(0,8).toUpperCase();
      html+='<tr style="cursor:pointer;" onclick="viewOrderFromProfile(\''+o.id+'\')"><td style="font-weight:600;">#'+sId+'</td><td>'+fmtDate(o.created_at)+'</td><td>RM '+(o.total||0).toFixed(2)+'</td><td><span class="badge '+orderBadgeCls(o.status)+'">'+o.status+'</span></td></tr>';
    });
    html+='</tbody></table>';
  } else html+='<div style="font-size:12px;color:var(--ink4);">No active orders</div>';
  html+='</div>';

  // History Orders
  html+='<div><div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.5rem;">Order History ('+historyOrders.length+')</div>';
  if(historyOrders.length){
    html+='<table class="data-table"><thead><tr><th>Order</th><th>Date</th><th>Total</th><th>Status</th></tr></thead><tbody>';
    historyOrders.forEach(function(o){
      var sId=o.order_number||o.id.substring(0,8).toUpperCase();
      html+='<tr style="cursor:pointer;" onclick="viewOrderFromProfile(\''+o.id+'\')"><td style="font-weight:600;">#'+sId+'</td><td>'+fmtDate(o.created_at)+'</td><td>RM '+(o.total||0).toFixed(2)+'</td><td><span class="badge '+orderBadgeCls(o.status)+'">'+o.status+'</span></td></tr>';
    });
    html+='</tbody></table>';
  } else html+='<div style="font-size:12px;color:var(--ink4);">No completed orders</div>';
  html+='</div>';

  html+='</div>'; // end left

  // ── RIGHT SIDEBAR ──
  html+='<div>';

  // Member card
  html+='<div style="background:linear-gradient(135deg,#3d3555,#5b3fa0);color:#fff;border-radius:12px;padding:1.2rem;margin-bottom:1rem;">';
  html+='<div style="font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.5);">Member Tier</div>';
  html+='<div style="display:flex;align-items:center;gap:.4rem;margin-top:.3rem;"><div style="width:10px;height:10px;border-radius:50%;background:'+(currentTier.color||'#CD7F32')+';"></div><span style="font-size:1.2rem;font-weight:300;">'+esc(currentTier.name)+' Member</span></div>';
  html+='<div style="margin-top:.8rem;font-size:10px;color:rgba(255,255,255,.4);">Member Code</div>';
  html+='<div style="font-size:13px;font-weight:600;font-family:monospace;color:rgba(255,255,255,.8);">'+id.substring(0,12).toUpperCase()+'</div>';
  html+='</div>';

  // Points breakdown
  html+='<div style="background:var(--bg);border-radius:12px;padding:1.2rem;">';
  html+='<div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.8rem;">Points & Rewards</div>';
  var ptsItems=[
    {label:'Available Points',value:ptsBalance.toLocaleString(),bold:true},
    {label:'Total Earned',value:totalPtsEarned.toLocaleString()},
    {label:'Total Redeemed',value:totalPtsRedeemed.toLocaleString()}
  ];
  ptsItems.forEach(function(p){
    html+='<div style="display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--border);font-size:13px;">';
    html+='<span style="color:var(--ink3);">'+p.label+'</span>';
    html+='<span style="font-weight:'+(p.bold?'800':'600')+';color:var(--ink);'+(p.bold?'font-size:15px;':'')+'">'+p.value+'</span>';
    html+='</div>';
  });
  html+='</div>';

  html+='</div>'; // end right
  html+='</div>'; // end grid

  document.getElementById('mcu-body').innerHTML=html;
  openModal('modal-customer');
}

function viewOrderFromProfile(orderId){
  // Open order detail modal on top of customer modal (don't close customer)
  viewOrder(orderId);
}

async function resetCustomerPassword(email){
  if(!confirm('Send password reset email to '+email+'?'))return;
  // Explicit redirectTo so the customer's reset link opens THIS app's recovery
  // page rather than the shared-project Site URL (a different MJM app).
  var{error}=await sb.auth.resetPasswordForEmail(email,{
    redirectTo:window.location.origin+'/auth.html'
  });
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Password reset email sent to '+email);
}

async function deleteCustomer(id){
  if(!confirm('Are you sure you want to delete this customer? This cannot be undone.'))return;
  await sb.from('shared_profiles').delete().eq('id',id);
  toast('Customer deleted');
  closeModal('modal-customer');
  loadCustomers();
}

// Mark a profile as staff/operation — hides it from the customer list without
// touching the auth account. Reversible from operation_user_access.html.
async function hideAsStaff(id){
  if(!confirm('Hide this profile from the customer list?\n\nUse this when the account belongs to an operation-system / staff user, not a real customer. The account itself is not deleted — you can restore it later from the Operation user-access page.'))return;
  var{error}=await sb.from('shared_profiles').update({user_type:'system'}).eq('id',id);
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Hidden from customer list');
  loadCustomers();
}

// ═══════════════════════════════════════
//  PAYMENT TERMS (cash / credit)
// ═══════════════════════════════════════
async function setCustomerTerms(id,terms){
  if(terms!=='cash'&&terms!=='credit')return;
  if(terms==='credit'){
    if(!confirm('Switch this customer to CREDIT terms?\n\nCredit customers can place orders without paying upfront. Their orders are reserved immediately and billed monthly. Make sure you trust this customer before enabling credit.'))return;
  }
  var{error}=await sb.from('shared_profiles').update({payment_terms:terms}).eq('id',id);
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Customer set to '+terms.toUpperCase()+' terms');
  viewCustomer(id);
  loadCustomers();
}

async function setCustomerCreditLimit(id){
  var v=document.getElementById('cust-credit-limit').value;
  var limit=v===''||v==null?null:Number(v);
  if(limit!=null&&(isNaN(limit)||limit<0)){toast('Invalid credit limit','error');return;}
  var{error}=await sb.from('shared_profiles').update({credit_limit:limit}).eq('id',id);
  if(error){toast('Error: '+error.message,'error');return;}
  toast(limit==null?'Credit limit cleared (no cap)':'Credit limit set to RM '+limit.toFixed(2));
  viewCustomer(id);
}
