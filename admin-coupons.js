/*
═══════════════════════════════════════════════════
  ADMIN — COUPONS MANAGEMENT
  ⚠️ AI: Coupon CRUD + filter chips + stats + bulk generate.
  Depends on: sb, toast(), esc(), openModal(), closeModal()

  PUBLIC FUNCTIONS:
    loadCoupons()           — list, filter, render + stats
    setCouponFilter(s)      — chip click handler
    openCouponForm(c)       — open create/edit modal
    saveCoupon()            — insert or update
    editCoupon(id)          — fetch + open form
    duplicateCoupon(id)     — clone an existing coupon
    toggleCoupon(id,active) — activate/deactivate
    deleteCoupon(id)        — hard delete (only if never used)
    randomizeCouponCode()   — fill form code with random 8-char
    toggleCouponScopeFields() / togglePctDiscountFields()
    openCouponBulkForm()    — open bulk generator
    bulkGenerateCoupons()   — create N codes + download CSV
═══════════════════════════════════════════════════
*/

var couponFilterStatus='';
var couponProductsCache=null;

function setCouponFilter(s){
  couponFilterStatus=s;
  document.querySelectorAll('[data-coupon-status]').forEach(function(el){
    el.classList.toggle('active',el.getAttribute('data-coupon-status')===s);
  });
  loadCoupons();
}

function couponStatusOf(c,today){
  if(!c.is_active) return 'inactive';
  if(c.expiry_date && c.expiry_date < today) return 'expired';
  if(c.start_date && c.start_date > today) return 'scheduled';
  if(c.usage_limit > 0 && (c.usage_count||0) >= c.usage_limit) return 'exhausted';
  return 'active';
}

function fmtCouponDiscount(c){
  if(c.discount_type==='percentage') return (c.discount_value||0)+'%';
  if(c.discount_type==='free_shipping') return 'Free Ship';
  return 'RM '+(c.discount_value||0);
}

async function loadCoupons(){
  var q=(document.getElementById('coupon-search').value||'').trim().toLowerCase();
  var{data,error}=await sb.from('salesweb_coupons').select('*').order('created_at',{ascending:false});
  if(error){toast('Error: '+error.message,'error');return;}
  var coupons=data||[];
  var today=new Date().toISOString().split('T')[0];

  // Annotate with computed status
  coupons.forEach(function(c){c._status=couponStatusOf(c,today);});

  // Stats (always computed against unfiltered set)
  renderCouponStats(coupons);

  // Search + status filter
  if(q){coupons=coupons.filter(function(c){
    return (c.code||'').toLowerCase().includes(q) || (c.name||'').toLowerCase().includes(q);
  });}
  if(couponFilterStatus){coupons=coupons.filter(function(c){return c._status===couponFilterStatus;});}

  if(!coupons.length){
    document.getElementById('coupons-table').innerHTML='<div class="loading">No coupons match this filter</div>';
    return;
  }

  var html='<table class="data-table"><thead><tr>'
    +'<th>Code</th><th>Name</th><th>Discount</th><th>Scope</th>'
    +'<th>Min Order</th><th>Usage</th><th>Period</th><th>Status</th><th>Actions</th>'
    +'</tr></thead><tbody>';
  coupons.forEach(function(c){
    var st=c._status;
    var bdg={active:'badge-green',scheduled:'badge-blue',expired:'badge-red',exhausted:'badge-amber',inactive:'badge-grey'}[st]||'badge-grey';
    var stLabel=st.charAt(0).toUpperCase()+st.slice(1);
    var period=(c.start_date||'—')+' → '+(c.expiry_date||'No expiry');
    var scope=c.scope==='product'?'Products ('+(c.scope_ids||[]).length+')'
            :c.scope==='category'?'Cats: '+(c.scope_categories||[]).join(', ')
            :'All';
    html+='<tr>'
      +'<td style="font-weight:700;font-family:monospace;letter-spacing:.05em;">'+esc(c.code||'')
      +(c.auto_apply?' <span class="badge badge-blue" style="margin-left:.3rem;">Auto</span>':'')
      +(c.first_order_only?' <span class="badge badge-amber" style="margin-left:.3rem;">First</span>':'')
      +'</td>'
      +'<td style="font-size:12px;">'+esc(c.name||'—')+'</td>'
      +'<td>'+fmtCouponDiscount(c)
      +(c.max_discount?'<div style="font-size:10px;color:var(--ink4);">max RM '+c.max_discount+'</div>':'')
      +'</td>'
      +'<td style="font-size:11px;">'+esc(scope)+'</td>'
      +'<td>RM '+(c.min_order_value||0).toFixed(2)+'</td>'
      +'<td>'+(c.usage_count||0)+'/'+(c.usage_limit||'∞')+'</td>'
      +'<td style="font-size:11px;">'+esc(period)+'</td>'
      +'<td><span class="badge '+bdg+'">'+stLabel+'</span></td>'
      +'<td><button class="btn btn-outline btn-sm" onclick="editCoupon(\''+c.id+'\')">Edit</button> '
      +'<button class="btn btn-outline btn-sm" onclick="duplicateCoupon(\''+c.id+'\')">Copy</button> '
      +'<button class="btn btn-outline btn-sm" onclick="toggleCoupon(\''+c.id+'\','+!c.is_active+')" style="color:'+(c.is_active?'var(--red)':'var(--green)')+';">'+(c.is_active?'Off':'On')+'</button>'
      +'</td></tr>';
  });
  html+='</tbody></table>';
  document.getElementById('coupons-table').innerHTML=html;
}

async function renderCouponStats(coupons){
  var box=document.getElementById('coupon-stats');
  if(!box) return;
  var active=coupons.filter(function(c){return c._status==='active';}).length;
  var totalRedemptions=coupons.reduce(function(s,c){return s+(c.usage_count||0);},0);

  // Pull total discount given via redemptions ledger (if migration applied).
  var totalDiscount=0;
  try{
    var{data:reds}=await sb.from('salesweb_coupon_redemptions').select('discount_amount');
    totalDiscount=(reds||[]).reduce(function(s,r){return s+Number(r.discount_amount||0);},0);
  }catch(e){/* ledger table may not exist yet */}

  box.innerHTML=
    '<div class="stat-box"><div class="stat-label">Active</div><div class="stat-val green">'+active+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Total Coupons</div><div class="stat-val">'+coupons.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Redemptions</div><div class="stat-val">'+totalRedemptions+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Discount Given</div><div class="stat-val">RM '+totalDiscount.toFixed(2)+'</div></div>';
}

async function loadCouponProductsCache(){
  if(couponProductsCache) return couponProductsCache;
  var{data}=await sb.from('salesweb_products').select('id,name').order('name');
  couponProductsCache=data||[];
  return couponProductsCache;
}

function toggleCouponScopeFields(){
  var v=document.getElementById('mc-scope').value;
  document.getElementById('mc-scope-cats').style.display=v==='category'?'block':'none';
  document.getElementById('mc-scope-prods').style.display=v==='product'?'block':'none';
}

function togglePctDiscountFields(){
  var t=document.getElementById('mc-dtype').value;
  document.getElementById('mc-row-pct').style.display=t==='percentage'?'grid':'none';
}

function randomizeCouponCode(){
  var alpha='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1
  var c=''; for(var i=0;i<8;i++) c+=alpha[Math.floor(Math.random()*alpha.length)];
  document.getElementById('mc-code').value=c;
}

// Cached list of customers + configured membership tiers so the
// eligibility pickers don't re-query on every modal open.
var _couponCustCache=null, _couponTiersCache=null;
async function loadCouponCustomersCache(){
  if(_couponCustCache) return _couponCustCache;
  var{data}=await sb.from('shared_profiles').select('id, full_name, email').or('user_type.eq.customer,role.eq.customer').order('full_name',{ascending:true});
  _couponCustCache = data || [];
  return _couponCustCache;
}
async function loadCouponTiersCache(){
  if(_couponTiersCache) return _couponTiersCache;
  var tiers=[{name:'Basic Member'}];
  try{
    var{data}=await sb.from('salesweb_app_settings').select('value').eq('key','member_tiers').maybeSingle();
    if(data && data.value){ var parsed=typeof data.value==='string'?JSON.parse(data.value):data.value; if(parsed && parsed.length) tiers=parsed; }
  }catch(e){}
  _couponTiersCache = tiers;
  return tiers;
}
var _couponGroupsCache=null;
async function loadCouponGroupsCache(){
  if(_couponGroupsCache) return _couponGroupsCache;
  try{
    var{data}=await sb.from('salesweb_customer_groups').select('id, name, color').order('name',{ascending:true});
    _couponGroupsCache = data || [];
  }catch(e){ _couponGroupsCache = []; }
  return _couponGroupsCache;
}

function onCouponEligChange(){
  var t=document.getElementById('mc-elig-type').value;
  document.getElementById('mc-elig-customers-wrap').style.display = (t==='customers')?'':'none';
  document.getElementById('mc-elig-tiers-wrap').style.display     = (t==='tiers')?'':'none';
  document.getElementById('mc-elig-groups-wrap').style.display    = (t==='groups')?'':'none';
}

async function openCouponForm(c){
  var prods=await loadCouponProductsCache();
  var sel=document.getElementById('mc-prods');
  sel.innerHTML=prods.map(function(p){return '<option value="'+p.id+'">'+esc(p.name)+'</option>';}).join('');

  // Populate the customer + tier pickers for the Discount usage section.
  var custs = await loadCouponCustomersCache();
  var custSel=document.getElementById('mc-elig-customers');
  custSel.innerHTML=custs.map(function(u){
    var label=(u.full_name||u.email||'—');
    if(u.email && /@admin\.mjmnursery\.local$/i.test(u.email)) label += ' (walk-in)';
    else if(u.email) label += ' · '+u.email;
    return '<option value="'+esc(u.id)+'">'+esc(label)+'</option>';
  }).join('');
  var tiers = await loadCouponTiersCache();
  var existingTiers = (c && c.eligibility && Array.isArray(c.eligibility.tier_names)) ? c.eligibility.tier_names : [];
  document.getElementById('mc-elig-tiers').innerHTML = tiers.map(function(t){
    var checked = existingTiers.indexOf(t.name) !== -1 ? ' checked' : '';
    return '<label class="form-toggle" style="font-size:12px;background:var(--white);border:1px solid var(--border);padding:.35rem .6rem;border-radius:6px;"><input type="checkbox" class="mc-elig-tier" value="'+esc(t.name)+'"'+checked+'><span>'+esc(t.name)+'</span></label>';
  }).join('');

  // Customer group picker — render the configured groups (or a hint if none).
  var groups = await loadCouponGroupsCache();
  var existingGroups = (c && c.eligibility && Array.isArray(c.eligibility.group_ids)) ? c.eligibility.group_ids : [];
  var groupsWrap = document.getElementById('mc-elig-groups-wrap');
  if(!groups.length){
    groupsWrap.innerHTML = '<label class="form-label">Selected customer group(s)</label>'
      + '<div style="font-size:11px;color:var(--ink4);padding:.4rem .6rem;background:var(--bg);border-radius:6px;">No groups yet — create one under <strong>Customers → Groups</strong>.</div>';
  } else {
    groupsWrap.innerHTML = '<label class="form-label">Selected customer group(s)</label>'
      + '<div id="mc-elig-groups" style="display:flex;flex-wrap:wrap;gap:.5rem;font-size:12px;">'
      + groups.map(function(g){
          var checked = existingGroups.indexOf(g.id) !== -1 ? ' checked' : '';
          var dot = g.color ? '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:'+esc(g.color)+';margin-right:.35rem;"></span>' : '';
          return '<label class="form-toggle" style="font-size:12px;background:var(--white);border:1px solid var(--border);padding:.35rem .6rem;border-radius:6px;"><input type="checkbox" class="mc-elig-group" value="'+esc(g.id)+'"'+checked+'>'+dot+'<span>'+esc(g.name)+'</span></label>';
        }).join('')
      + '</div>';
  }

  var elig = (c && c.eligibility) || {type:'all_members'};
  document.getElementById('mc-elig-type').value = elig.type || 'all_members';
  if(elig.type==='customers' && Array.isArray(elig.customer_ids)){
    Array.from(custSel.options).forEach(function(o){ o.selected = elig.customer_ids.indexOf(o.value) >= 0; });
  } else {
    Array.from(custSel.options).forEach(function(o){ o.selected = false; });
  }
  onCouponEligChange();

  document.getElementById('mc-title').textContent=c?'Edit Coupon':'New Coupon';
  document.getElementById('mc-id').value=c?c.id:'';
  document.getElementById('mc-code').value=c?c.code:'';
  document.getElementById('mc-name').value=c&&c.name?c.name:'';
  document.getElementById('mc-desc').value=c&&c.description?c.description:'';
  document.getElementById('mc-dtype').value=c?c.discount_type:'percentage';
  document.getElementById('mc-dval').value=c?c.discount_value:'';
  document.getElementById('mc-maxdisc').value=c&&c.max_discount?c.max_discount:0;
  document.getElementById('mc-min').value=c?c.min_order_value:0;
  document.getElementById('mc-limit').value=c?c.usage_limit:0;
  document.getElementById('mc-percust').value=c&&c.per_customer_limit?c.per_customer_limit:0;
  document.getElementById('mc-start').value=c&&c.start_date?c.start_date:'';
  document.getElementById('mc-expiry').value=c?c.expiry_date||'':'';
  document.getElementById('mc-scope').value=c&&c.scope?c.scope:'all';
  document.getElementById('mc-cats').value=c&&c.scope_categories?(c.scope_categories||[]).join(', '):'';
  Array.from(sel.options).forEach(function(o){
    o.selected=c&&c.scope_ids?c.scope_ids.indexOf(o.value)>=0:false;
  });
  document.getElementById('mc-active').checked=c?c.is_active:true;
  document.getElementById('mc-firstorder').checked=c?!!c.first_order_only:false;
  document.getElementById('mc-stack').checked=c?c.stackable_with_promo!==false:true;
  document.getElementById('mc-autoapply').checked=c?!!c.auto_apply:false;
  toggleCouponScopeFields();
  togglePctDiscountFields();
  openModal('modal-coupon');
}

async function editCoupon(id){
  var{data}=await sb.from('salesweb_coupons').select('*').eq('id',id).single();
  if(data) openCouponForm(data);
}

async function duplicateCoupon(id){
  var{data}=await sb.from('salesweb_coupons').select('*').eq('id',id).single();
  if(!data){toast('Could not load coupon','error');return;}
  // Strip identity fields, suggest a new code
  var clone=Object.assign({},data);
  delete clone.id;delete clone.created_at;delete clone.updated_at;
  clone.code=(data.code||'COPY')+'-'+Math.floor(Math.random()*1000);
  clone.usage_count=0;
  openCouponForm(clone);
  toast('Editing copy — adjust the code before saving');
}

async function saveCoupon(){
  var id=document.getElementById('mc-id').value;
  var scope=document.getElementById('mc-scope').value;
  var sel=document.getElementById('mc-prods');
  var scopeIds=Array.from(sel.selectedOptions).map(function(o){return o.value;});
  var cats=(document.getElementById('mc-cats').value||'').split(',').map(function(s){return s.trim();}).filter(Boolean);

  // Build the eligibility object (Discount usage section).
  var eligType=document.getElementById('mc-elig-type').value;
  var eligibility={type:eligType};
  if(eligType==='customers'){
    var custSel=document.getElementById('mc-elig-customers');
    eligibility.customer_ids=Array.from(custSel.selectedOptions).map(function(o){return o.value;});
  } else if(eligType==='tiers'){
    eligibility.tier_names=[];
    document.querySelectorAll('.mc-elig-tier:checked').forEach(function(cb){ eligibility.tier_names.push(cb.value); });
  } else if(eligType==='groups'){
    eligibility.group_ids=[];
    document.querySelectorAll('.mc-elig-group:checked').forEach(function(cb){ eligibility.group_ids.push(cb.value); });
  }
  // For 'public' / 'all_members' we keep just the type.

  var row={
    code:document.getElementById('mc-code').value.trim().toUpperCase(),
    name:document.getElementById('mc-name').value.trim()||null,
    description:document.getElementById('mc-desc').value.trim()||null,
    discount_type:document.getElementById('mc-dtype').value,
    discount_value:parseFloat(document.getElementById('mc-dval').value)||0,
    max_discount:parseFloat(document.getElementById('mc-maxdisc').value)||0,
    min_order_value:parseFloat(document.getElementById('mc-min').value)||0,
    usage_limit:parseInt(document.getElementById('mc-limit').value)||0,
    per_customer_limit:parseInt(document.getElementById('mc-percust').value)||0,
    start_date:document.getElementById('mc-start').value||null,
    expiry_date:document.getElementById('mc-expiry').value||null,
    scope:scope,
    scope_ids:scope==='product'?scopeIds:[],
    scope_categories:scope==='category'?cats:[],
    is_active:document.getElementById('mc-active').checked,
    first_order_only:document.getElementById('mc-firstorder').checked,
    stackable_with_promo:document.getElementById('mc-stack').checked,
    auto_apply:document.getElementById('mc-autoapply').checked,
    eligibility:eligibility
  };
  if(!row.code){toast('Coupon code required','error');return;}

  // Try the full row first; if migration not applied, retry with legacy columns.
  var legacyRow={
    code:row.code,discount_type:row.discount_type,discount_value:row.discount_value,
    min_order_value:row.min_order_value,usage_limit:row.usage_limit,
    expiry_date:row.expiry_date,is_active:row.is_active
  };

  var{error}=id?await sb.from('salesweb_coupons').update(row).eq('id',id)
                :await sb.from('salesweb_coupons').insert([row]);
  if(error&&/column .* does not exist|schema cache/i.test(error.message||'')){
    // Migration not applied yet — degrade gracefully
    console.warn('Falling back to legacy coupon columns:',error.message);
    var r2=id?await sb.from('salesweb_coupons').update(legacyRow).eq('id',id)
              :await sb.from('salesweb_coupons').insert([legacyRow]);
    if(r2.error){toast('Error: '+r2.error.message,'error');return;}
    toast((id?'Updated':'Created')+' (run SQL migration to enable new fields)','error');
  } else if(error){
    toast('Error: '+error.message,'error');return;
  } else {
    toast(id?'Coupon updated':'Coupon created');
  }
  closeModal('modal-coupon');loadCoupons();
}

async function toggleCoupon(id,active){
  await sb.from('salesweb_coupons').update({is_active:active}).eq('id',id);
  toast(active?'Coupon activated':'Coupon deactivated');loadCoupons();
}

// ── BULK GENERATE ──
function openCouponBulkForm(){
  document.getElementById('mcb-qty').value=50;
  document.getElementById('mcb-prefix').value='';
  document.getElementById('mcb-dtype').value='percentage';
  document.getElementById('mcb-dval').value=10;
  document.getElementById('mcb-min').value=0;
  document.getElementById('mcb-expiry').value='';
  openModal('modal-coupon-bulk');
}

async function bulkGenerateCoupons(){
  var qty=parseInt(document.getElementById('mcb-qty').value)||0;
  if(qty<1||qty>2000){toast('Quantity must be 1–2000','error');return;}
  var prefix=(document.getElementById('mcb-prefix').value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  var dtype=document.getElementById('mcb-dtype').value;
  var dval=parseFloat(document.getElementById('mcb-dval').value)||0;
  var minOrder=parseFloat(document.getElementById('mcb-min').value)||0;
  var expiry=document.getElementById('mcb-expiry').value||null;

  var btn=document.getElementById('mcb-go');
  btn.disabled=true;btn.textContent='Generating...';

  // Generate a batch UUID client-side
  var batchId='bulk-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  var alpha='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var rows=[];var seen={};
  for(var i=0;i<qty;i++){
    var code='';for(var j=0;j<8;j++) code+=alpha[Math.floor(Math.random()*alpha.length)];
    code=(prefix?prefix+'-':'')+code;
    if(seen[code]){i--;continue;} // very unlikely collision
    seen[code]=1;
    rows.push({
      code:code,name:'Bulk batch '+batchId,
      discount_type:dtype,discount_value:dval,
      min_order_value:minOrder,usage_limit:1,
      expiry_date:expiry,is_active:true,
      scope:'all',generated_by:'bulk',bulk_batch_id:null /* set below if column exists */
    });
  }

  // Try with bulk_batch_id; fall back without if column missing
  var rowsWithBatch=rows.map(function(r){return Object.assign({},r,{bulk_batch_id:null});});
  // Supabase doesn't accept arbitrary text in a uuid column, so we emit NULL for bulk_batch_id
  // and rely on `name` to group them. (Set bulk_batch_id manually post-migration if needed.)

  // Insert in chunks of 200
  var inserted=0;
  for(var k=0;k<rows.length;k+=200){
    var chunk=rows.slice(k,k+200);
    var{error}=await sb.from('salesweb_coupons').insert(chunk);
    if(error){
      // Fallback: drop the new columns and retry
      if(/column .* does not exist|schema cache/i.test(error.message||'')){
        var legacy=chunk.map(function(r){return{
          code:r.code,discount_type:r.discount_type,discount_value:r.discount_value,
          min_order_value:r.min_order_value,usage_limit:r.usage_limit,
          expiry_date:r.expiry_date,is_active:r.is_active
        };});
        var r2=await sb.from('salesweb_coupons').insert(legacy);
        if(r2.error){toast('Error: '+r2.error.message,'error');btn.disabled=false;btn.textContent='Generate & Download CSV';return;}
      } else {
        toast('Error: '+error.message,'error');btn.disabled=false;btn.textContent='Generate & Download CSV';return;
      }
    }
    inserted+=chunk.length;
  }

  // Build CSV
  var csv='code,discount_type,discount_value,min_order_value,expiry_date\n'
    +rows.map(function(r){return [r.code,r.discount_type,r.discount_value,r.min_order_value,r.expiry_date||''].join(',');}).join('\n');
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');
  a.href=url;a.download='coupons-'+batchId+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(url);

  btn.disabled=false;btn.textContent='Generate & Download CSV';
  toast('Generated '+inserted+' coupons');
  closeModal('modal-coupon-bulk');loadCoupons();
}
