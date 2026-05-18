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

  // First, get the set of customer_ids that have ever placed a sales-web order.
  // We need this both to filter the profile list and to show a per-row badge.
  var{data:orderRows}=await sb.from('salesweb_customer_orders')
    .select('customer_id').not('customer_id','is',null);
  var hasOrder={};
  (orderRows||[]).forEach(function(r){hasOrder[r.customer_id]=true;});
  var orderedIds=Object.keys(hasOrder);

  // A "customer" = profile that EITHER signed up via the storefront
  // (user_type='customer') OR has actually placed a sales-web order.
  // This excludes operation/nursery staff accounts.
  var query=sb.from('shared_profiles').select('*').order('created_at',{ascending:false});
  if(orderedIds.length){
    query=query.or('user_type.eq.customer,id.in.('+orderedIds.join(',')+')');
  } else {
    query=query.eq('user_type','customer');
  }
  var{data,error}=await query;
  if(error){toast('Error: '+error.message,'error');return;}
  var custs=data||[];
  if(q)custs=custs.filter(function(c){return(c.full_name||'').toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q);});

  var withOrders=custs.filter(function(c){return hasOrder[c.id];}).length;
  var creditCount=custs.filter(function(c){return c.payment_terms==='credit';}).length;
  document.getElementById('cust-stats').innerHTML=
    '<div class="stat-box"><div class="stat-label">Total Customers</div><div class="stat-val">'+custs.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">With Orders</div><div class="stat-val green">'+withOrders+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Credit Customers</div><div class="stat-val" style="color:#a16207;">'+creditCount+'</div></div>';

  if(!custs.length){document.getElementById('customers-table').innerHTML='<div class="loading">No customers found</div>';return;}
  var html='<table class="data-table"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Orders</th><th>Terms</th><th>Joined</th><th>Action</th></tr></thead><tbody>';
  custs.forEach(function(c){
    var terms=c.payment_terms==='credit'?'credit':'cash';
    var termsBadge=terms==='credit'
      ? '<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;">💳 Credit</span>'
      : '<span class="badge badge-grey">💵 Cash</span>';
    var ordersBadge=hasOrder[c.id]
      ? '<span class="badge badge-green">Yes</span>'
      : '<span class="badge badge-grey">No</span>';
    html+='<tr><td style="font-weight:600;">'+esc(c.full_name||'—')+'</td><td>'+esc(c.email||'—')+'</td><td>'+esc(c.phone||'—')+'</td><td>'+ordersBadge+'</td><td>'+termsBadge+'</td><td>'+fmtDate(c.created_at)+'</td><td><button class="btn btn-outline btn-sm" onclick="viewCustomer(\''+c.id+'\')">View</button></td></tr>';
  });
  html+='</tbody></table>';
  document.getElementById('customers-table').innerHTML=html;
}

// (rest of file unchanged — only loadCustomers was modified)
