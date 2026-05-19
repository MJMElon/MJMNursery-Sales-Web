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

async function loadCustomers(){
  var q=(document.getElementById('cust-search').value||'').trim().toLowerCase();

  // ─── Build the customer set as the union of two groups ──────────────
  //   A) Sales-web signed-up customers
  //      (shared_profiles.user_type='customer' or legacy role='customer').
  //      The sales-web signup flow in index.html / auth.html writes exactly
  //      these markers — staff/operations accounts do not.
  //   B) Anyone (regardless of sign-up source) who has at least one PAID
  //      order. "Paid" = order status NOT IN
  //      ('Pending Payment','Cancelled','Refunded').
  //
  //   The previous version showed every shared_profiles row that had ANY
  //   order, which leaked pending-payment carts and staff accounts.
  //   ───────────────────────────────────────────────────────────────────

  // (B) Customer IDs with a paid order — pull all orders + status, filter
  //     client-side so we don't have to depend on PostgREST IN-not syntax.
  var{data:orderRows}=await sb.from('salesweb_customer_orders')
    .select('customer_id,status').not('customer_id','is',null);
  var NOT_PAID = {'Pending Payment':1,'Cancelled':1,'Refunded':1};
  var paidIds={};
  (orderRows||[]).forEach(function(r){
    if(r.customer_id && !NOT_PAID[r.status]) paidIds[r.customer_id]=true;
  });

  // (A) Sales-web sign-ups.
  var{data:swCusts,error}=await sb.from('shared_profiles')
    .select('*').or('user_type.eq.customer,role.eq.customer');
  if(error){toast('Error: '+error.message,'error');return;}

  var byId={};
  (swCusts||[]).forEach(function(c){byId[c.id]=c;});

  // Pull profiles for paid-order customers that aren't already in (A).
  var missingIds=Object.keys(paidIds).filter(function(id){return !byId[id];});
  if(missingIds.length){
    var{data:extras}=await sb.from('shared_profiles').select('*').in('id',missingIds);
    (extras||[]).forEach(function(c){byId[c.id]=c;});
  }

  var custs=[];
  for(var k in byId)custs.push(byId[k]);
  custs.sort(function(a,b){return new Date(b.created_at||0)-new Date(a.created_at||0);});

  if(q)custs=custs.filter(function(c){return(c.full_name||'').toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q);});

  if(!custs.length){
    document.getElementById('cust-stats').innerHTML=
      '<div class="stat-box"><div class="stat-label">Total Customers</div><div class="stat-val">0</div></div>';
    document.getElementById('customers-table').innerHTML='<div class="loading">No customers yet</div>';
    return;
  }

  var creditCount=custs.filter(function(c){return c.payment_terms==='credit';}).length;
  var paidCount  =custs.filter(function(c){return paidIds[c.id];}).length;
  document.getElementById('cust-stats').innerHTML=
    '<div class="stat-box"><div class="stat-label">Total Customers</div><div class="stat-val">'+custs.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Has Paid Order</div><div class="stat-val" style="color:#059669;">'+paidCount+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Credit Customers</div><div class="stat-val" style="color:#a16207;">'+creditCount+'</div></div>';

  var html='<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Terms</th><th>Joined</th><th>Action</th></tr></thead><tbody>';
  custs.forEach(function(c){
    var terms=c.payment_terms==='credit'?'credit':'cash';
    var termsBadge=terms==='credit'
      ? '<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;">💳 Credit</span>'
      : '<span class="badge badge-grey">💵 Cash</span>';
    html+='<tr><td style="font-weight:600;">'+esc(c.full_name||'—')+'</td><td>'+esc(c.email||'—')+'</td><td>'+esc(c.phone||'—')+'</td><td>'+termsBadge+'</td><td>'+fmtDate(c.created_at)+'</td><td><button class="btn btn-outline btn-sm" onclick="viewCustomer(\''+c.id+'\')">View</button></td></tr>';
  });
  html+='</tbody></table>';
  document.getElementById('customers-table').innerHTML=html;
}

// ═══════════════════════════════════════
//  SUB-TAB SWITCHING
// ═══════════════════════════════════════
function showCustSubTab(tab){
  document.getElementById('cust-panel-list').style.display=tab==='list'?'':'none';
  document.getElementById('cust-panel-points').style.display=tab==='points'?'':'none';
  document.getElementById('cust-subtab-list').className='btn btn-'+(tab==='list'?'primary':'outline')+' btn-sm';
  document.getElementById('cust-subtab-list').style.fontSize='11px';
  document.getElementById('cust-subtab-points').className='btn btn-'+(tab==='points'?'primary':'outline')+' btn-sm';
  document.getElementById('cust-subtab-points').style.fontSize='11px';
  if(tab==='points')loadPointsSettings();
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

  document.getElementById('pts-summary').innerHTML=
    '<strong>Earning:</strong> RM '+earnRm+' spent = '+earnPts+' point(s)<br>'+
    '<strong>Redemption:</strong> '+redeemPts+' points = RM '+redeemRm.toFixed(2)+' discount<br>'+
    '<strong>Point value:</strong> 1 point = RM '+(rmPerPt).toFixed(4)+'<br>'+
    '<strong>Effective cashback:</strong> '+cashbackPct.toFixed(2)+'% '+
      '<span style="color:var(--ink4);font-size:11px;">(every RM 100 spent → RM '+(cashbackPct).toFixed(2)+' redeemable discount)</span>';
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
  html+='<div style="display:flex;gap:.4rem;"><button class="btn btn-outline btn-sm" onclick="resetCustomerPassword(\''+c.email+'\')">Reset Password</button><button class="btn btn-outline btn-sm" onclick="deleteCustomer(\''+id+'\')" style="color:var(--red);">Delete</button></div>';
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
  html+='<div style="color:var(--ink4);">Email</div><div style="font-weight:600;">'+esc(c.email||'—')+'</div>';
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
  var{error}=await sb.auth.resetPasswordForEmail(email);
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
