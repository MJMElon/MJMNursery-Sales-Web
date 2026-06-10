/*
═══════════════════════════════════════════════════
  ADMIN — ORDERS MANAGEMENT (v2)
  ⚠️ AI: Full order lifecycle with timeline, attachments, discounts.

  TABLES: salesweb_customer_orders, salesweb_order_items, salesweb_order_timeline, salesweb_order_attachments, salesweb_coupons, salesweb_products
  STORAGE: order-attachments bucket

  STATUS FLOW: Pending Payment → Paid → Processing → Ready for Collection → Completed
  On "Paid": issue loyalty points + deduct product stock

  LINE MAP:
  25    loadOrders() — dashboard + queue
  90    viewOrder() — full detail page
  200   updateOrderStatus() — with side effects (points, stock)
  240   addDiscount() / applyCoupon()
  270   saveSellerNote()
  280   uploadOrderAttachment() / loadAttachments()
  310   loadTimeline() — render vertical timeline
  340   issuePoints() — loyalty calculation
  350   deductStock() — reduce product stock on paid
  ---   EDIT CUSTOMER / BILLING / ITEMS appended at bottom
═══════════════════════════════════════════════════
*/

var ORDER_STATUSES = ['Pending Payment','Partially Paid','Paid','Ready for Collection','Completed','Cancelled','Refunded'];

// RM formatter with en-MY thousands separators, always 2 decimals.
function fmtMYR(n){ return (Number(n)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}); }
// Date + time formatter for timestamps (e.g. payment received).
function fmtDateTime(d){ if(!d) return '—'; try{ return new Date(d).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return '—'; } }
// Channel icon shown next to the order number so admins can spot the source
// (online store / admin entry / Google enquiry / WhatsApp enquiry) at a glance.
function channelIcon(ch){
  switch(ch){
    case 'online_store': return '<span class="ch-ico ch-online" title="Online Store">🏪</span>';
    case 'admin_panel':  return '<span class="ch-ico ch-admin" title="Admin Panel">🛠️</span>';
    case 'google':       return '<span class="ch-ico ch-google" title="Google">G</span>';
    case 'whatsapp':     return '<span class="ch-ico ch-whatsapp" title="WhatsApp">💬</span>';
    default:             return '<span class="ch-ico ch-unknown" title="Unknown">·</span>';
  }
}
// Statuses that mean the order is fully settled — no outstanding balance is
// shown regardless of the recorded amount_paid (marking an order Paid means
// the amount has been settled).
var SETTLED_STATUSES = { 'Paid':1, 'Ready for Collection':1, 'Completed':1 };
function orderFullyPaid(o){
  var tot=Number(o.total)||0, paid=Number(o.amount_paid)||0;
  return !!SETTLED_STATUSES[o.status] || (tot>0 && paid>=tot);
}

// ═══════════════════════════════════════
//  ADVANCED FILTER DRAWER (right sidebar)
//  Persists the active filter state across re-renders. UI lives in
//  admin.html (#orderFilterDrawer). loadOrders() reads from this state.
// ═══════════════════════════════════════
var ORDER_FILTERS = { dateFrom:'', dateTo:'', statuses:[], payments:[], channels:[], product:'' };

function openOrderFilterDrawer(){
  // Sync UI inputs from current state before opening
  document.getElementById('fd-date-from').value = ORDER_FILTERS.dateFrom || '';
  document.getElementById('fd-date-to').value = ORDER_FILTERS.dateTo || '';
  document.querySelectorAll('.fd-status').forEach(function(cb){ cb.checked = ORDER_FILTERS.statuses.indexOf(cb.value) !== -1; });
  document.querySelectorAll('.fd-pay').forEach(function(cb){ cb.checked = ORDER_FILTERS.payments.indexOf(cb.value) !== -1; });
  document.querySelectorAll('.fd-channel').forEach(function(cb){ cb.checked = ORDER_FILTERS.channels.indexOf(cb.value) !== -1; });
  document.getElementById('fd-product').value = ORDER_FILTERS.product || '';
  document.getElementById('orderFilterOverlay').classList.add('open');
  document.getElementById('orderFilterDrawer').classList.add('open');
  document.getElementById('orderFilterDrawer').setAttribute('aria-hidden','false');
}
function closeOrderFilterDrawer(){
  document.getElementById('orderFilterOverlay').classList.remove('open');
  document.getElementById('orderFilterDrawer').classList.remove('open');
  document.getElementById('orderFilterDrawer').setAttribute('aria-hidden','true');
}
function readCheckedValues(selector){
  var out = [];
  document.querySelectorAll(selector).forEach(function(cb){ if(cb.checked) out.push(cb.value); });
  return out;
}
function applyOrderFilters(){
  ORDER_FILTERS.dateFrom = document.getElementById('fd-date-from').value || '';
  ORDER_FILTERS.dateTo   = document.getElementById('fd-date-to').value || '';
  ORDER_FILTERS.statuses = readCheckedValues('.fd-status');
  ORDER_FILTERS.payments = readCheckedValues('.fd-pay');
  ORDER_FILTERS.channels = readCheckedValues('.fd-channel');
  ORDER_FILTERS.product  = (document.getElementById('fd-product').value || '').trim();
  updateOrderFilterBadge();
  closeOrderFilterDrawer();
  loadOrders();
}
function clearOrderFilters(){
  ORDER_FILTERS = { dateFrom:'', dateTo:'', statuses:[], payments:[], channels:[], product:'' };
  document.getElementById('fd-date-from').value = '';
  document.getElementById('fd-date-to').value = '';
  document.querySelectorAll('.fd-status, .fd-pay, .fd-channel').forEach(function(cb){ cb.checked = false; });
  document.getElementById('fd-product').value = '';
  updateOrderFilterBadge();
  loadOrders();
}
function countActiveOrderFilters(){
  var c = 0;
  if(ORDER_FILTERS.dateFrom || ORDER_FILTERS.dateTo) c++;
  if(ORDER_FILTERS.statuses.length) c++;
  if(ORDER_FILTERS.payments.length) c++;
  if(ORDER_FILTERS.channels.length) c++;
  if(ORDER_FILTERS.product) c++;
  return c;
}
function updateOrderFilterBadge(){
  var n = countActiveOrderFilters();
  var btn = document.getElementById('orders-filter-btn');
  var badge = document.getElementById('orders-filter-count');
  if(!btn || !badge) return;
  if(n > 0){ btn.classList.add('has-active'); badge.style.display = 'inline-flex'; badge.textContent = String(n); }
  else { btn.classList.remove('has-active'); badge.style.display = 'none'; }
}

// ═══════════════════════════════════════
//  BULK SELECT + DELETE
//  Row checkboxes + a select-all in the header. The bulk bar appears
//  when ≥1 order is ticked and soft-deletes them all at once (same
//  deleted_at mechanism as the single-order Delete button).
// ═══════════════════════════════════════
function getSelectedOrderIds(){
  var ids = [];
  document.querySelectorAll('.order-select:checked').forEach(function(cb){ ids.push(cb.value); });
  return ids;
}
function onOrderSelectChange(){
  var boxes = document.querySelectorAll('.order-select');
  var checked = getSelectedOrderIds();
  var bar = document.getElementById('orders-bulk-bar');
  var count = document.getElementById('orders-bulk-count');
  if(count) count.textContent = checked.length + ' selected';
  if(bar) bar.style.display = checked.length ? 'flex' : 'none';
  // Keep the header "select all" box in sync (checked / unchecked / indeterminate).
  var master = document.getElementById('order-select-all');
  if(master){
    master.checked = boxes.length > 0 && checked.length === boxes.length;
    master.indeterminate = checked.length > 0 && checked.length < boxes.length;
  }
}
function toggleSelectAllOrders(master){
  document.querySelectorAll('.order-select').forEach(function(cb){ cb.checked = master.checked; });
  onOrderSelectChange();
}
function clearOrderSelection(){
  document.querySelectorAll('.order-select').forEach(function(cb){ cb.checked = false; });
  var master = document.getElementById('order-select-all');
  if(master){ master.checked = false; master.indeterminate = false; }
  onOrderSelectChange();
}
async function bulkDeleteOrders(){
  var ids = getSelectedOrderIds();
  if(!ids.length){ toast('No orders selected','error'); return; }
  if(!confirm('Cancel '+ids.length+' selected order'+(ids.length>1?'s':'')+'?\n\nEach order\'s status will be set to Cancelled. They stay in the list (badged Cancelled) and surface under the "Cancelled" filter.')) return;
  // Only set status — no soft-delete — so the orders remain visible under
  // the Cancelled filter (default visibility hides soft-deleted rows).
  var{error}=await sb.from('salesweb_customer_orders').update({status:'Cancelled'}).in('id',ids);
  if(error){toast('Error: '+error.message,'error');return;}
  // Audit trail per order — best-effort, doesn't block the toast.
  var who='admin';
  try{
    var sess=await sb.auth.getSession();
    who=(sess&&sess.data&&sess.data.session&&sess.data.session.user&&sess.data.session.user.email)||'admin';
    var rows=ids.map(function(id){ return {order_id:id, status:'Cancelled', note:'Bulk cancel via admin Orders', changed_by:who}; });
    await sb.from('salesweb_order_timeline').insert(rows);
  }catch(e){ /* timeline insert is best-effort */ }

  // Sync each cancelled order to its linked AL (cancel-AL when nothing
  // collected, or stamp the uncollected qty when there's partial collection).
  // Best-effort per order — one failure doesn't block the rest.
  for(var k=0;k<ids.length;k++){
    try{ await _propagateOrderCancelToAL(ids[k], who); }
    catch(propErr){ console.warn('AL-link propagation failed for', ids[k], propErr); }
  }
  toast(ids.length+' order'+(ids.length>1?'s':'')+' cancelled');
  clearOrderSelection();
  loadOrders();
}

// ═══════════════════════════════════════
//  LOAD ORDERS — DASHBOARD
// ═══════════════════════════════════════
async function loadOrders(){
  // Opportunistic cleanup: release stock + cancel cash-term orders that have
  // been unpaid for 48h (credit orders are never touched). Best-effort — if
  // the DB function isn't installed yet this just no-ops. A pg_cron schedule
  // (see supabase/migrations/auto_release_abandoned_cash_orders.sql) covers
  // the case where no admin opens this page.
  try{ await sb.rpc('release_abandoned_cash_orders'); }catch(e){ /* function not installed / no-op */ }
  var q=document.getElementById('order-search').value.trim().toLowerCase();
  var status=document.getElementById('order-filter').value;
  var f = ORDER_FILTERS || {};
  var sideStatuses = f.statuses || [];
  var query=sb.from('salesweb_customer_orders').select('*').order('created_at',{ascending:false});
  if(status)query=query.eq('status',status);
  // Date range: created_at is a timestamp; use start-of-day to next-day midnight.
  if(f.dateFrom) query = query.gte('created_at', f.dateFrom + 'T00:00:00');
  if(f.dateTo)   query = query.lte('created_at', f.dateTo   + 'T23:59:59');
  var{data,error}=await query;
  if(error){toast('Error: '+error.message,'error');return;}
  var orders=data||[];
  if(q)orders=orders.filter(function(o){return(o.order_number||'').toLowerCase().includes(q)||(o.id||'').toLowerCase().includes(q)||(o.customer_name||'').toLowerCase().includes(q)||(o.customer_email||'').toLowerCase().includes(q);});

  // Visibility of soft-flagged rows: hide deleted & archived orders unless the
  // sidebar Status filter explicitly ticks "Deleted" (no Archived option now).
  var wantDeleted  = sideStatuses.indexOf('Deleted')  !== -1;
  var wantArchived = sideStatuses.indexOf('Archived') !== -1;
  if(!wantDeleted)  orders = orders.filter(function(o){ return !o.deleted_at; });
  if(!wantArchived) orders = orders.filter(function(o){ return !o.archived_at; });

  // ── Sidebar Status filter (multi-select, OR within the group) ──
  //   Open                 → an active order (not cancelled/refunded/completed,
  //                          not archived/deleted)
  //   Cancelled            → status = 'Cancelled'
  //   Ready for Collection → status = 'Ready for Collection'
  //   Completed            → status = 'Completed'
  //   Deleted              → deleted_at IS NOT NULL
  if(sideStatuses.length){
    orders = orders.filter(function(o){
      var ok = false;
      if(sideStatuses.indexOf('Open') !== -1 && o.status!=='Cancelled' && o.status!=='Refunded' && o.status!=='Completed' && !o.archived_at && !o.deleted_at) ok = true;
      if(sideStatuses.indexOf('Pending Payment') !== -1 && o.status==='Pending Payment' && !o.deleted_at && !o.archived_at) ok = true;
      if(sideStatuses.indexOf('Cancelled') !== -1 && o.status==='Cancelled' && !o.deleted_at && !o.archived_at) ok = true;
      if(sideStatuses.indexOf('Ready for Collection') !== -1 && o.status==='Ready for Collection' && !o.deleted_at && !o.archived_at) ok = true;
      if(sideStatuses.indexOf('Completed') !== -1 && o.status==='Completed' && !o.deleted_at && !o.archived_at) ok = true;
      if(sideStatuses.indexOf('Deleted') !== -1 && !!o.deleted_at) ok = true;
      return ok;
    });
  }

  // ── Payment filter ── (uses amount_paid as the source of truth, with a
  // fallback to status for legacy rows that pre-date the amount_paid column)
  if(f.payments && f.payments.length){
    orders = orders.filter(function(o){
      var s = o.status;
      var tot = Number(o.total||0);
      var paid = Number(o.amount_paid||0);
      var fullyPaid = (tot > 0 && paid >= tot) || s === 'Paid' || s === 'Ready for Collection' || s === 'Completed';
      var partiallyPaid = paid > 0 && paid < tot;
      var unpaid = paid <= 0 && s === 'Pending Payment';
      var ok = false;
      if(f.payments.indexOf('Unpaid')         !== -1 && unpaid)        ok = true;
      if(f.payments.indexOf('Partially Paid') !== -1 && partiallyPaid) ok = true;
      if(f.payments.indexOf('Paid')           !== -1 && fullyPaid && !partiallyPaid) ok = true;
      if(f.payments.indexOf('Refunded')       !== -1 && s === 'Refunded') ok = true;
      return ok;
    });
  }
  // ── Channel filter ── (channel captured at order creation: 'online_store',
  // 'admin_panel'. Reserved values: 'shopping_app', 'google', 'whatsapp'.)
  if(f.channels && f.channels.length){
    orders = orders.filter(function(o){ return o.channel && f.channels.indexOf(o.channel) !== -1; });
  }
  // Product filter: query order_items separately, get matching order_ids.
  if(f.product){
    var{data:items}=await sb.from('salesweb_order_items').select('order_id').ilike('product_name','%'+f.product+'%');
    var ids = {};
    (items||[]).forEach(function(it){ ids[it.order_id] = true; });
    orders = orders.filter(function(o){ return ids[o.id]; });
  }

  // Stats
  var all=data||[];
  var pending=all.filter(function(o){return o.status==='Pending Payment';}).length;
  var paid=all.filter(function(o){return o.status==='Paid';}).length;
  var completed=all.filter(function(o){return o.status==='Completed';}).length;
  var revenue=all.filter(function(o){return o.status!=='Cancelled';}).reduce(function(s,o){return s+(o.total||0);},0);
  var creditOutstanding=all.filter(function(o){return o.payment_terms==='credit'&&!o.credit_billed_at&&o.status!=='Cancelled';}).reduce(function(s,o){return s+(o.total||0);},0);
  document.getElementById('order-stats').innerHTML=
    '<div class="stat-box stat-orders" title="All orders"><div class="stat-icon">📦</div><div class="stat-body"><div class="stat-label">Total Orders</div><div class="stat-val">'+all.length+'</div></div></div>'+
    '<div class="stat-box stat-pending" title="Pending Payment"><div class="stat-icon">⏳</div><div class="stat-body"><div class="stat-label">Pending Payment</div><div class="stat-val" style="color:var(--amber);">'+pending+'</div></div></div>'+
    '<div class="stat-box stat-paid" title="Paid"><div class="stat-icon">💵</div><div class="stat-body"><div class="stat-label">Paid</div><div class="stat-val" style="color:var(--blue);">'+paid+'</div></div></div>'+
    '<div class="stat-box stat-completed" title="Completed"><div class="stat-icon">✅</div><div class="stat-body"><div class="stat-label">Completed</div><div class="stat-val green">'+completed+'</div></div></div>'+
    '<div class="stat-box stat-credit" title="Credit Outstanding"><div class="stat-icon">💳</div><div class="stat-body"><div class="stat-label">Credit Outstanding</div><div class="stat-val" style="color:#a16207;">RM '+fmtMYR(creditOutstanding)+'</div></div></div>'+
    '<div class="stat-box stat-revenue" title="Revenue"><div class="stat-icon">📈</div><div class="stat-body"><div class="stat-label">Revenue</div><div class="stat-val" style="color:#047857;">RM '+fmtMYR(revenue)+'</div></div></div>';

  // Count indicator above the table — shows how many orders match the
  // current search/filter and the total in the DB. Filter button badge
  // already carries the active-filter count; this surfaces the match count.
  var countEl = document.getElementById('orders-count');
  if(countEl){
    var totalAll = (data||[]).length;
    var matched  = orders.length;
    var isFiltered = !!q || !!status || (countActiveOrderFilters && countActiveOrderFilters() > 0);
    countEl.innerHTML = isFiltered
      ? '<span><strong style="color:var(--ink);">'+matched.toLocaleString()+'</strong> order'+(matched===1?'':'s')+' match — out of '+totalAll.toLocaleString()+' total</span>'
      : '<span><strong style="color:var(--ink);">'+matched.toLocaleString()+'</strong> order'+(matched===1?'':'s')+'</span>';
  }

  if(!orders.length){document.getElementById('orders-table').innerHTML='<div class="loading">No orders found</div>';clearOrderSelection();return;}
  var html='<table class="data-table"><thead><tr><th style="width:34px;text-align:center;"><input type="checkbox" id="order-select-all" onclick="toggleSelectAllOrders(this)" title="Select all"></th><th>Order</th><th>Date</th><th>Customer</th><th>Terms</th><th>Status</th><th>Total</th><th>Action</th></tr></thead><tbody>';
  orders.forEach(function(o){
    var statusCls=orderBadgeCls(o.status);
    var shortId=o.order_number||o.id.substring(0,8).toUpperCase();
    var idJs=String(o.id||'').replace(/[\\'"<>]/g,'');
    var termsBadge;
    if(o.payment_terms==='credit'){
      var billed=o.credit_billed_at?' · billed':' · unbilled';
      termsBadge='<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;" title="'+esc(o.credit_billing_period||'')+billed+'">💳 Credit</span>';
    } else {
      termsBadge='<span class="badge badge-grey">💵 Cash</span>';
    }
    var totalRM = Number(o.total||0);
    var paidRM = Number(o.amount_paid||0);
    var balRM = Math.max(0, totalRM - paidRM);
    // Cancelled orders carry a red, struck-through total so the row reads
    // as voided at a glance — matching the red status badge.
    var isCancelled = (o.status === 'Cancelled');
    var totalCell;
    if(isCancelled){
      totalCell = '<span style="color:var(--red);text-decoration:line-through;">RM '+fmtMYR(totalRM)+'</span>';
    } else {
      totalCell = 'RM ' + fmtMYR(totalRM);
      if(orderFullyPaid(o)){
        if(totalRM > 0) totalCell += '<div style="font-size:10px;color:var(--green);font-weight:600;margin-top:2px;">Paid in full</div>';
      } else if(paidRM > 0 && paidRM < totalRM){
        totalCell += '<div style="font-size:10px;color:#a16207;font-weight:600;margin-top:2px;">Paid RM '+fmtMYR(paidRM)+' · Bal RM '+fmtMYR(balRM)+'</div>';
      }
    }
    var custIdJs=String(o.customer_id||'').replace(/[\\'"<>]/g,'');
    // Customer name links to the profile modal when the order is tied to a
    // registered customer; falls back to plain text for guest/manual orders.
    var custName=esc(o.customer_name||'—');
    var custNameCell = custIdJs
      ? '<a onclick="event.stopPropagation();viewCustomer(\''+custIdJs+'\')" style="cursor:pointer;color:var(--green-dark);font-weight:600;text-decoration:none;" onmouseover="this.style.textDecoration=\'underline\'" onmouseout="this.style.textDecoration=\'none\'">'+custName+'</a>'
      : custName;
    // Secondary line under the customer name shows the billing name (only when
    // it differs from the customer name — otherwise the row reads redundantly).
    var billingLine = '';
    if(o.billing_name && o.billing_name !== o.customer_name){
      billingLine = '<div style="font-size:11px;color:var(--ink4);">'+esc(o.billing_name)+'</div>';
    }
    var orderIdStyle = 'font-weight:600;white-space:nowrap;' + (isCancelled ? 'color:var(--red);' : '');
    html+='<tr onclick="viewOrder(\''+idJs+'\')" style="cursor:pointer;">'+
      '<td style="text-align:center;" onclick="event.stopPropagation();"><input type="checkbox" class="order-select" value="'+idJs+'" onclick="event.stopPropagation();onOrderSelectChange();"></td>'+
      '<td style="'+orderIdStyle+'">'+channelIcon(o.channel)+'#'+esc(shortId)+'</td>'+
      '<td style="font-size:12px;">'+fmtDate(o.created_at)+'</td>'+
      '<td>'+custNameCell+billingLine+'</td>'+
      '<td>'+termsBadge+'</td>'+
      '<td><span class="badge '+statusCls+'">'+esc(o.status)+'</span></td>'+
      '<td style="font-weight:600;">'+totalCell+'</td>'+
      '<td><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();viewOrder(\''+idJs+'\')">View</button></td>'+
    '</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('orders-table').innerHTML=html;
}

function orderBadgeCls(s){
  return{'Pending Payment':'badge-amber','Partially Paid':'badge-amber','Paid':'badge-blue','Ready for Collection':'badge-green','Completed':'badge-grey','Cancelled':'badge-red','Refunded':'badge-red'}[s]||'badge-grey';
}

// ═══════════════════════════════════════
//  VIEW ORDER — FULL DETAIL
// ═══════════════════════════════════════
async function viewOrder(id){
  var{data:order}=await sb.from('salesweb_customer_orders').select('*').eq('id',id).single();
  if(!order){toast('Order not found','error');return;}
  var{data:items}=await sb.from('salesweb_order_items').select('*').eq('order_id',id);
  items=items||[];
  // Stacked admin-added discounts / coupons. Graceful empty array if the
  // migration hasn't been applied yet so the modal still renders.
  var adjustments=[];
  try{
    var{data:adjs}=await sb.from('salesweb_order_adjustments').select('*').eq('order_id',id).order('created_at',{ascending:true});
    adjustments=adjs||[];
  }catch(e){ adjustments=[]; }

  // Parse the structured pieces out of customer_remark so they can be shown
  // in the right place — billing fields in the Billing/E-Invoice card, the
  // user's actual free-text remark in the Customer Remark section, and the
  // bookkeeping prefixes (Phone, Payment, Voucher, Points) hidden.
  var _parsed={ billAddr:'', billIc:'', billReg:'', billMpob:'', userRemark:'' };
  if(order.customer_remark){
    String(order.customer_remark).split(' | ').forEach(function(p){
      p = p.trim();
      if(!p) return;
      if      (p.indexOf('Billing Addr: ')===0) _parsed.billAddr = p.substring(14);
      else if (p.indexOf('IC: ')===0)            _parsed.billIc   = p.substring(4);
      else if (p.indexOf('Reg: ')===0)           _parsed.billReg  = p.substring(5);
      else if (p.indexOf('MPOB: ')===0)          _parsed.billMpob = p.substring(6);
      else if (p.indexOf('Phone: ')===0)         { /* hidden — shown in Customer card */ }
      else if (p.indexOf('Payment: ')===0)       { /* hidden — internal bookkeeping */ }
      else if (p.indexOf('Voucher: ')===0)       { /* hidden — recorded in totals */ }
      else if (p.indexOf('Points: ')===0)        { /* hidden — recorded as redemption */ }
      else if (p !== 'Admin-created order')      { _parsed.userRemark = (_parsed.userRemark ? _parsed.userRemark+' | ' : '') + p; }
    });
  }

  // Billplz payment outcome — read the most recent payment-related timeline
  // event. If the latest event is "Payment Failed" and the order has not
  // since been settled, surface a red banner in the payment tracking card.
  // Webhook writes "Payment Failed" when Billplz reports paid=false (see
  // supabase/functions/billplz-webhook/index.ts).
  var billplzFailed = false;
  try {
    var{data:tlRows} = await sb.from('salesweb_order_timeline')
      .select('status,note,changed_by,created_at')
      .eq('order_id', id)
      .or('status.eq.Payment Failed,status.eq.Paid')
      .order('created_at', { ascending: false })
      .limit(1);
    if (tlRows && tlRows.length && tlRows[0].status === 'Payment Failed' && !orderFullyPaid(order)) {
      billplzFailed = true;
    }
  } catch(e) { /* non-fatal — banner just won't show */ }

  // Payment ledger — one row per partial payment received. amount_paid on
  // the order row is kept in sync via the salesweb_recalc_order_amount_paid
  // trigger, so the order's amount_paid number always matches SUM(rows).
  var paymentRows = [];
  try {
    var{data:pmRows} = await sb.from('salesweb_order_payments')
      .select('id, paid_at, amount, note, attachment_url, attachment_name, created_by')
      .eq('order_id', id)
      .order('paid_at', { ascending: false });
    paymentRows = pmRows || [];
  } catch(e) { /* ledger table may not exist yet on a stale DB; fall back to empty */ }

  // For credit orders, fetch per-collection events + all of this customer's
  // monthly invoices so the per-month breakdown table can render.
  var creditCollections=[];
  var creditInvoicesByPeriod={};
  if(order.payment_terms==='credit'){
    try{
      var{data:collRows}=await sb.from('salesweb_order_collections').select('collected_qty,collected_at,al_number').eq('order_id',id);
      creditCollections=collRows||[];
    }catch(e){creditCollections=[];}
    if(order.customer_id){
      var{data:invRows}=await sb.from('salesweb_credit_invoices').select('id,invoice_number,billing_period,total_qty,total_amount,status,invoice_file_url,payment_proof_url,issued_at,due_date,paid_at').eq('customer_id',order.customer_id);
      (invRows||[]).forEach(function(inv){creditInvoicesByPeriod[inv.billing_period]=inv;});
    }
  }

  var shortId=order.order_number||order.id.substring(0,8).toUpperCase();
  // order_number sometimes already contains a leading '#' — avoid "Order ##10539".
  var titleId=String(shortId);if(titleId.charAt(0)!=='#')titleId='#'+titleId;
  // The modal heading now carries both the order number and the
  // human-readable created-at timestamp so admins can see when the
  // order was placed without scrolling to the timeline.
  document.getElementById('mo-title').innerHTML='Order '+esc(titleId)+
    '<div style="font-size:11px;font-weight:500;color:var(--ink4);margin-top:.15rem;letter-spacing:0;">Placed '+esc(fmtDateTime(order.created_at))+'</div>';

  var html='';

  // ── 0. Proforma Invoice (admin can email a pre-payment quote to customer) ──
  html+='<div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:.6rem .8rem;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;">';
  html+='<div style="font-size:12px;color:#3730a3;"><strong>Proforma Invoice</strong> &mdash; send a pre-payment quote to the customer on request.</div>';
  html+='<button class="btn btn-primary btn-sm" onclick="openProformaInvoice(\''+id+'\')" style="font-size:11px;padding:6px 12px;">Send Proforma Invoice</button>';
  html+='</div>';

  // ── 1. Status + Payment Terms (top, side-by-side) ──
  var currentTerms=order.payment_terms==='credit'?'credit':'cash';
  var creditPeriod=order.credit_billing_period||'';
  var billedAt=order.credit_billed_at||'';

  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">';

  // Status card
  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">';
  html+='<div style="font-size:13px;font-weight:600;">Order Status</div>';
  html+='<span class="badge '+orderBadgeCls(order.status)+'" style="font-size:11px;padding:4px 10px;">'+order.status+'</span>';
  html+='</div>';
  html+='<div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;">';
  html+='<select id="mo-status-select" class="form-input" style="flex:1;min-width:140px;font-size:12px;padding:6px 10px;">';
  ORDER_STATUSES.forEach(function(s){html+='<option'+(s===order.status?' selected':'')+'>'+s+'</option>';});
  html+='</select>';
  html+='<button class="btn btn-primary btn-sm" onclick="updateOrderStatus(\''+id+'\')">Update</button>';
  html+='</div></div>';

  // Payment Terms card
  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">';
  html+='<div style="font-size:13px;font-weight:600;">Payment Terms</div>';
  html+='<span class="badge" style="font-size:11px;padding:4px 10px;'+(currentTerms==='credit'?'background:#fef3c7;color:#92400e;border:1px solid #fde68a;':'background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;')+'">'+(currentTerms==='credit'?'💳 Credit':'💵 Cash')+'</span>';
  html+='</div>';
  html+='<div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;">';
  html+='<select id="mo-terms-select" class="form-input" style="flex:1;min-width:120px;font-size:12px;padding:6px 10px;" onchange="document.getElementById(\'mo-credit-period-row\').style.display=this.value===\'credit\'?\'flex\':\'none\';">';
  html+='<option value="cash"'+(currentTerms==='cash'?' selected':'')+'>💵 Cash</option>';
  html+='<option value="credit"'+(currentTerms==='credit'?' selected':'')+'>💳 Credit</option>';
  html+='</select>';
  html+='<button class="btn btn-primary btn-sm" onclick="updateOrderPaymentTerms(\''+id+'\')">Update</button>';
  html+='</div>';
  html+='<div id="mo-credit-period-row" style="display:'+(currentTerms==='credit'?'flex':'none')+';gap:.4rem;align-items:center;flex-wrap:wrap;margin-top:.5rem;">';
  html+='<label style="font-size:11px;color:var(--ink3);">Billing period:</label>';
  html+='<input class="form-input" id="mo-credit-period" type="text" value="'+esc(creditPeriod)+'" placeholder="2026-05" style="width:110px;font-size:12px;padding:6px 10px;">';
  if(billedAt){
    html+='<span class="badge" style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;font-size:10px;">Billed '+fmtDate(billedAt)+'</span>';
    html+='<button class="btn btn-outline btn-sm" onclick="setOrderCreditBilled(\''+id+'\',false)" style="font-size:10px;">Mark Unbilled</button>';
  } else {
    html+='<span class="badge badge-amber" style="font-size:10px;">Unbilled</span>';
    html+='<button class="btn btn-outline btn-sm" onclick="setOrderCreditBilled(\''+id+'\',true)" style="font-size:10px;">Mark Billed</button>';
  }
  html+='</div></div>';

  html+='</div>'; // /grid

  // ── 2. Customer + Billing ──
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">';

  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">';
  html+='<div style="font-size:13px;font-weight:600;">Customer</div>';
  html+='<button class="btn btn-outline btn-sm" onclick="toggleEditCustomer()" style="font-size:11px;padding:2px 8px;">✏️ Edit</button>';
  html+='</div>';
  html+='<div id="mo-customer-view">';
  html+='<div style="font-size:13px;"><strong>'+esc(order.customer_name||'—')+'</strong></div>';
  html+='<div style="font-size:12px;color:var(--ink3);">'+esc(order.customer_email||'—')+'</div>';
  if(order.shipping_address)html+='<div style="font-size:12px;color:var(--ink3);margin-top:.3rem;white-space:pre-wrap;">'+esc(order.shipping_address)+'</div>';
  html+='</div>';
  html+='<div id="mo-customer-edit" style="display:none;">';
  html+='<input class="form-input" id="mo-cust-name" placeholder="Customer name" value="'+esc(order.customer_name||'')+'" style="font-size:12px;padding:6px 10px;margin-bottom:.3rem;">';
  html+='<input class="form-input" id="mo-cust-email" placeholder="Email" value="'+esc(order.customer_email||'')+'" style="font-size:12px;padding:6px 10px;margin-bottom:.3rem;">';
  html+='<textarea class="form-input" id="mo-cust-address" placeholder="Shipping address" rows="2" style="font-size:12px;padding:6px 10px;margin-bottom:.3rem;">'+esc(order.shipping_address||'')+'</textarea>';
  html+='<div style="display:flex;gap:.4rem;"><button class="btn btn-primary btn-sm" onclick="saveCustomerDetails(\''+id+'\')">Save</button><button class="btn btn-outline btn-sm" onclick="toggleEditCustomer()">Cancel</button></div>';
  html+='</div></div>';

  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">';
  html+='<div style="font-size:13px;font-weight:600;">Billing / E-Invoice</div>';
  html+='<button class="btn btn-outline btn-sm" onclick="toggleEditBilling()" style="font-size:11px;padding:2px 8px;">✏️ Edit</button>';
  html+='</div>';
  html+='<div id="mo-billing-view">';
  html+='<div style="font-size:12px;color:var(--ink3);font-weight:600;">'+esc(order.billing_name||order.customer_name||'—')+'</div>';
  if(_parsed.billReg)  html+='<div style="font-size:12px;color:var(--ink3);">Reg No: '+esc(_parsed.billReg)+'</div>';
  if(_parsed.billIc)   html+='<div style="font-size:12px;color:var(--ink3);">I/C: '+esc(_parsed.billIc)+'</div>';
  html+='<div style="font-size:12px;color:var(--ink3);">Tax ID (TIN): '+esc(order.billing_tax_id||'—')+'</div>';
  if(_parsed.billMpob) html+='<div style="font-size:12px;color:var(--ink3);">MPOB License: '+esc(_parsed.billMpob)+'</div>';
  // Always show a Billing Address row. The storefront only persists the
  // billing address inside customer_remark ("Billing Addr: …"), so when
  // that's missing — typical for self-collection orders without e-Invoice
  // details — fall back to the shipping address.
  var billAddrShown = _parsed.billAddr || order.shipping_address || '';
  var billAddrLabel = _parsed.billAddr ? 'Billing Address' : (order.shipping_address ? 'Address (Shipping)' : 'Billing Address');
  html+='<div style="font-size:12px;color:var(--ink3);margin-top:.3rem;">'+billAddrLabel+':</div>';
  html+='<div style="font-size:12px;color:var(--ink3);white-space:pre-wrap;">'+(billAddrShown?esc(billAddrShown):'<span style="color:var(--ink4);">—</span>')+'</div>';
  html+='<div style="font-size:12px;color:var(--ink3);margin-top:.3rem;">Points issued: '+(order.points_issued||0)+'</div>';
  html+='</div>';
  html+='<div id="mo-billing-edit" style="display:none;">';
  html+='<input class="form-input" id="mo-bill-name" placeholder="Billing name" value="'+esc(order.billing_name||'')+'" style="font-size:12px;padding:6px 10px;margin-bottom:.3rem;">';
  html+='<input class="form-input" id="mo-bill-tax" placeholder="Tax ID" value="'+esc(order.billing_tax_id||'')+'" style="font-size:12px;padding:6px 10px;margin-bottom:.3rem;">';
  html+='<div style="display:flex;gap:.4rem;"><button class="btn btn-primary btn-sm" onclick="saveBillingDetails(\''+id+'\')">Save</button><button class="btn btn-outline btn-sm" onclick="toggleEditBilling()">Cancel</button></div>';
  html+='</div></div>';

  html+='</div>'; // /grid

  // ── 3. Order Items + totals (single merged section) ──
  var subtotal=items.reduce(function(s,it){return s+(it.subtotal||0);},0);
  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;margin-bottom:1rem;">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">';
  html+='<div style="font-size:13px;font-weight:600;">Order Items</div>';
  html+='<button class="btn btn-outline btn-sm" onclick="renderItemsEditMode(\''+id+'\')" style="font-size:11px;padding:2px 8px;">✏️ Edit Items</button>';
  html+='</div>';
  html+='<div id="mo-items-container">';
  if(items.length){
    html+='<table class="data-table"><thead><tr><th>Product</th><th style="text-align:right;">Price</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Subtotal</th></tr></thead><tbody>';
    items.forEach(function(it){html+='<tr><td>'+esc(it.product_name||'—')+'</td><td style="text-align:right;">RM '+fmtMYR(it.unit_price)+'</td><td style="text-align:right;">'+it.quantity+'</td><td style="text-align:right;font-weight:600;">RM '+fmtMYR(it.subtotal)+'</td></tr>';});
    html+='</tbody></table>';
  } else html+='<div style="font-size:12px;color:var(--ink4);padding:.5rem 0;">No items</div>';
  html+='</div>';

  // Totals breakdown stays in the same card
  html+='<div style="margin-top:.8rem;padding-top:.8rem;border-top:1px solid var(--border);">';
  html+='<div style="display:flex;justify-content:space-between;padding:.2rem 0;font-size:13px;"><span>Subtotal</span><span>RM '+fmtMYR(subtotal)+'</span></div>';
  if(order.discount_amount>0){
    var discLabel = 'Discount';
    if(order.discount_note) discLabel += ' <span style="color:var(--ink3);font-weight:400;font-style:italic;">('+esc(order.discount_note)+')</span>';
    html+='<div style="display:flex;justify-content:space-between;padding:.2rem 0;font-size:13px;color:var(--red);gap:.5rem;"><span style="min-width:0;">'+discLabel+'</span><span style="white-space:nowrap;">-RM '+fmtMYR(order.discount_amount)+'</span></div>';
  }
  if(order.coupon_code)html+='<div style="display:flex;justify-content:space-between;padding:.2rem 0;font-size:13px;color:var(--red);"><span>Coupon ('+esc(order.coupon_code)+')</span><span>-RM '+fmtMYR(order.coupon_discount)+'</span></div>';
  html+='<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-top:1.5px solid var(--border);margin-top:.3rem;font-size:15px;font-weight:700;"><span>Total</span><span>RM '+fmtMYR(order.total)+'</span></div>';
  html+='</div>';
  html+='</div>'; // /Order Items card

  // Compute payment state once — used by both the discount/coupon block and
  // the dedicated payment tracking card below.
  var paidNow = Number(order.amount_paid||0);
  var totalNow = Number(order.total||0);
  // A settled status (Paid / Ready for Collection / Completed) means the
  // amount is fully settled — show no outstanding balance even if the
  // recorded amount_paid is lower (e.g. a legacy partial-paid then marked Paid).
  var settled = orderFullyPaid(order);
  var paidDisplay = settled ? totalNow : paidNow;
  var balanceNow = settled ? 0 : Math.max(0, totalNow - paidNow);
  var payState = settled ? 'paid' : (paidNow <= 0 ? 'unpaid' : 'partial');

  // ── Adjustments (Set Discount / Apply Coupon) — placed ABOVE Payment
  //    Tracking. Discounts can be entered as either an RM amount OR a
  //    percentage (toggled via the RM/% buttons). Existing discounts and
  //    coupons each get an inline ✕ that removes them outright. ──
  html+='<div style="background:var(--bg);border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;">';
  html+='<div style="font-size:13px;font-weight:600;margin-bottom:.5rem;">Adjustments</div>';

  // Stack each adjustment as its own row. The single discount_amount /
  // coupon_code columns on the order row capture the FIRST discount /
  // coupon (set by checkout or the legacy single-slot admin flow); every
  // additional one the admin stacks goes into salesweb_order_adjustments.
  if(Number(order.discount_amount||0) > 0){
    html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;padding:.4rem .6rem;background:#fff;border:1px solid var(--border);border-radius:6px;margin-bottom:.4rem;font-size:12px;">';
    html+='<div style="min-width:0;flex:1;">';
    html+='<div><strong>Discount applied:</strong> -RM '+fmtMYR(order.discount_amount)+'</div>';
    if(order.discount_note){
      html+='<div style="margin-top:.2rem;color:var(--ink3);font-size:11px;"><em>Remarks: '+esc(order.discount_note)+'</em></div>';
    }
    html+='</div>';
    html+='<button class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 8px;color:var(--red);border-color:var(--red);flex:none;" onclick="removeDiscount(\''+id+'\')">✕ Remove</button>';
    html+='</div>';
  }
  if(order.coupon_code){
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .6rem;background:#fff;border:1px solid var(--border);border-radius:6px;margin-bottom:.4rem;font-size:12px;">';
    html+='<span><strong>Coupon '+esc(order.coupon_code)+':</strong> -RM '+fmtMYR(order.coupon_discount)+'</span>';
    html+='<button class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 8px;color:var(--red);border-color:var(--red);" onclick="removeCoupon(\''+id+'\')">✕ Remove</button>';
    html+='</div>';
  }
  adjustments.forEach(function(adj){
    var aid=String(adj.id||'').replace(/[\\'"<>]/g,'');
    if(adj.kind==='discount'){
      html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;padding:.4rem .6rem;background:#fff;border:1px solid var(--border);border-radius:6px;margin-bottom:.4rem;font-size:12px;">';
      html+='<div style="min-width:0;flex:1;">';
      html+='<div><strong>Discount applied:</strong> -RM '+fmtMYR(adj.amount)+'</div>';
      if(adj.note){
        html+='<div style="margin-top:.2rem;color:var(--ink3);font-size:11px;"><em>Remarks: '+esc(adj.note)+'</em></div>';
      }
      html+='</div>';
      html+='<button class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 8px;color:var(--red);border-color:var(--red);flex:none;" onclick="removeAdjustment(\''+aid+'\',\''+id+'\')">✕ Remove</button>';
      html+='</div>';
    } else if(adj.kind==='coupon'){
      html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .6rem;background:#fff;border:1px solid var(--border);border-radius:6px;margin-bottom:.4rem;font-size:12px;">';
      html+='<span><strong>Coupon '+esc(adj.coupon_code||'')+':</strong> -RM '+fmtMYR(adj.amount)+'</span>';
      html+='<button class="btn btn-outline btn-sm" style="font-size:11px;padding:2px 8px;color:var(--red);border-color:var(--red);" onclick="removeAdjustment(\''+aid+'\',\''+id+'\')">✕ Remove</button>';
      html+='</div>';
    }
  });

  html+='<div style="display:flex;gap:.5rem;flex-wrap:wrap;">';
  html+='<button class="btn btn-outline btn-sm" onclick="var el=document.getElementById(\'mo-discount-panel\');el.style.display=el.style.display===\'none\'?\'flex\':\'none\';" style="font-size:11px;">+ Add Discount</button>';
  html+='<button class="btn btn-outline btn-sm" onclick="var el=document.getElementById(\'mo-coupon-panel\');el.style.display=el.style.display===\'none\'?\'flex\':\'none\';" style="font-size:11px;">+ Add Coupon</button>';
  html+='</div>';

  // Discount panel — RM/% toggle determines how the typed value is
  // interpreted before being saved as a flat RM amount on the order.
  // The remarks field below is the human reason the discount was given.
  html+='<div id="mo-discount-panel" style="display:none;gap:.5rem;align-items:center;margin-top:.5rem;flex-wrap:wrap;">';
  html+='<input class="form-input" id="mo-discount" type="number" step="0.01" min="0" value="'+(order.discount_amount||0)+'" style="width:110px;font-size:12px;padding:6px 10px;" placeholder="Value">';
  html+='<div role="group" style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;">';
  html+='<button id="mo-discount-mode-rm" type="button" class="btn btn-sm" data-mode="rm" onclick="setDiscountMode(\'rm\')" style="font-size:11px;padding:5px 10px;border:0;background:var(--ink2);color:#fff;">RM</button>';
  html+='<button id="mo-discount-mode-pct" type="button" class="btn btn-sm" data-mode="pct" onclick="setDiscountMode(\'pct\')" style="font-size:11px;padding:5px 10px;border:0;background:transparent;color:var(--ink2);">%</button>';
  html+='</div>';
  html+='<input class="form-input" id="mo-discount-note" type="text" value="'+esc(order.discount_note||'')+'" style="flex:1;min-width:180px;font-size:12px;padding:6px 10px;" placeholder="Remarks (e.g. damaged item, loyalty top-up)" maxlength="200">';
  html+='<button class="btn btn-primary btn-sm" onclick="addDiscount(\''+id+'\','+subtotal+')">Apply Discount</button>';
  html+='</div>';

  html+='<div id="mo-coupon-panel" style="display:none;gap:.5rem;align-items:center;margin-top:.5rem;flex-wrap:wrap;">';
  html+='<input class="form-input" id="mo-coupon" type="text" value="'+esc(order.coupon_code||'')+'" style="width:120px;font-size:12px;padding:6px 10px;text-transform:uppercase;" placeholder="Coupon code"><button class="btn btn-primary btn-sm" onclick="applyCoupon(\''+id+'\')">Apply Coupon</button>';
  html+='</div>';
  html+='</div>';

  // ── Payment Tracking — one section to monitor everything about money:
  //    order amount, amount paid/received, outstanding balance, plus
  //    a Billplz-failed banner when the last payment event was a failure.
  //    'Amount Paid' is the SUM of the salesweb_order_payments ledger
  //    rendered just below; admins add a row for every payment received. ──
  html+='<div style="background:var(--bg);border:1.5px solid var(--border);border-radius:10px;padding:1rem;margin-bottom:1rem;">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;">';
  html+='<div style="font-size:13px;font-weight:700;">Payment Tracking</div>';
  var payBadge = payState === 'paid'    ? '<span class="badge badge-blue"  style="font-size:11px;padding:4px 10px;">Fully Paid</span>'
               : payState === 'partial' ? '<span class="badge badge-amber" style="font-size:11px;padding:4px 10px;">Partially Paid</span>'
                                        : '<span class="badge badge-grey"  style="font-size:11px;padding:4px 10px;">Unpaid</span>';
  html+=payBadge+'</div>';

  // Billplz failure banner — only when timeline confirms a failed Billplz
  // attempt that hasn't been superseded by a successful payment.
  if(billplzFailed){
    html+='<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.5rem .75rem;margin-bottom:.6rem;display:flex;align-items:center;gap:.5rem;font-size:12px;color:#991b1b;">';
    html+='<strong>Billplz payment failed.</strong>';
    html+='<span style="color:#7f1d1d;">Customer initiated an online payment but it did not complete. They may retry from their order page.</span>';
    html+='</div>';
  }

  // Three-up summary tiles: Order Amount / Amount Paid / Outstanding Balance.
  html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:.6rem;">';
  html+='<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:.6rem;">';
  html+='<div style="font-size:10px;color:var(--ink4);text-transform:uppercase;letter-spacing:.04em;font-weight:600;">Order Amount</div>';
  html+='<div style="font-size:16px;font-weight:700;margin-top:.15rem;">RM '+fmtMYR(totalNow)+'</div>';
  html+='</div>';
  html+='<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:.6rem;">';
  html+='<div style="font-size:10px;color:var(--ink4);text-transform:uppercase;letter-spacing:.04em;font-weight:600;">Amount Paid</div>';
  html+='<div style="font-size:16px;font-weight:700;margin-top:.15rem;color:'+(paidDisplay>0?'var(--green)':'var(--ink3)')+';">RM '+fmtMYR(paidDisplay)+'</div>';
  html+='</div>';
  html+='<div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:.6rem;">';
  html+='<div style="font-size:10px;color:var(--ink4);text-transform:uppercase;letter-spacing:.04em;font-weight:600;">Outstanding</div>';
  html+='<div style="font-size:16px;font-weight:700;margin-top:.15rem;color:'+(balanceNow>0?'var(--red)':'var(--green)')+';">RM '+fmtMYR(balanceNow)+'</div>';
  html+='</div>';
  html+='</div>';

  // Payment ledger — one row per payment received. Sum of `amount` here is
  // what feeds the "Amount Paid" tile above (kept in sync by the
  // salesweb_recalc_order_amount_paid trigger).
  html+='<div style="padding-top:.5rem;border-top:1px solid var(--border);">';
  html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem;">';
  html+='<div style="font-size:11px;font-weight:600;color:var(--ink3);text-transform:uppercase;letter-spacing:.04em;">Payment Entries</div>';
  html+='<button class="btn btn-primary btn-sm" onclick="openAddPaymentModal(\''+id+'\','+balanceNow.toFixed(2)+')" style="font-size:11px;padding:5px 10px;">+ Add Payment</button>';
  html+='</div>';
  if(paymentRows.length){
    html+='<table class="data-table" style="font-size:12px;"><thead><tr>'+
      '<th>Date</th><th style="text-align:right;">Amount</th><th>Note</th><th>Document</th><th style="text-align:right;">Action</th>'+
      '</tr></thead><tbody>';
    paymentRows.forEach(function(p){
      var rid = String(p.id||'').replace(/[\\'"<>]/g,'');
      var docCell = '—';
      if(p.attachment_url){
        var u = String(p.attachment_url).replace(/'/g,'%27');
        var n = String(p.attachment_name||'document').replace(/'/g,'\\\'');
        docCell = '<a href="#" onclick="event.preventDefault();openAttachmentPreview(\''+u+'\',\''+n+'\',\'\');" style="font-size:11px;color:var(--green);text-decoration:underline;">View</a>';
      }
      html+='<tr>'+
        '<td>'+esc(fmtDate(p.paid_at))+'</td>'+
        '<td style="text-align:right;font-weight:600;">RM '+fmtMYR(p.amount)+'</td>'+
        '<td style="color:var(--ink3);">'+esc(p.note||'—')+'</td>'+
        '<td>'+docCell+'</td>'+
        '<td style="text-align:right;"><button class="btn btn-outline btn-sm" style="font-size:10px;padding:2px 8px;color:var(--red);border-color:var(--red);" onclick="deletePaymentEntry(\''+rid+'\',\''+id+'\')">✕</button></td>'+
      '</tr>';
    });
    html+='</tbody></table>';
  } else {
    html+='<div style="font-size:12px;color:var(--ink4);padding:.4rem 0;">No payments recorded yet. Click <strong>+ Add Payment</strong> above to log the first one.</div>';
  }
  html+='</div>';
  html+='</div>';

  // ── 4. Customer Remark ──
  // Only the user's actual free-text remark is shown here; billing fields and
  // bookkeeping prefixes (Phone / Payment / Voucher / Points) are surfaced in
  // their proper cards instead.
  if(_parsed.userRemark){
    html+='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;">';
    html+='<div style="font-size:11px;font-weight:600;color:#92400e;margin-bottom:.3rem;">Customer Remark</div>';
    html+='<div style="font-size:13px;color:var(--ink2);">'+esc(_parsed.userRemark)+'</div></div>';
  }

  // ── 4b. Credit Monthly Breakdown (only for credit-term orders) ──
  if(order.payment_terms==='credit'){
    // Group collections by 'YYYY-MM'
    var qtyByPeriod={};
    creditCollections.forEach(function(c){
      if(!c.collected_at)return;
      var p=String(c.collected_at).slice(0,7);
      qtyByPeriod[p]=(qtyByPeriod[p]||0)+(c.collected_qty||0);
    });
    // Fallback: if no per-event collections recorded but the order itself has a
    // single collected_at/collected_qty (legacy data), use that as one entry.
    if(!creditCollections.length&&order.collected_at&&order.collected_qty){
      qtyByPeriod[String(order.collected_at).slice(0,7)]=order.collected_qty;
    }

    // Generate every month from order created_at through current month
    function periodKey(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
    function periodLabel(p){var parts=p.split('-');return new Date(+parts[0],+parts[1]-1,1).toLocaleString('en-MY',{month:'short',year:'numeric'});}
    var startDate=new Date(order.created_at);startDate.setDate(1);
    var cursor=new Date(startDate.getFullYear(),startDate.getMonth(),1);
    var endCursor=new Date();endCursor=new Date(endCursor.getFullYear(),endCursor.getMonth(),1);
    var periods=[];
    while(cursor<=endCursor){periods.push(periodKey(cursor));cursor.setMonth(cursor.getMonth()+1);}

    html+='<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;">';
    html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">';
    html+='<div style="font-size:13px;font-weight:600;color:#1d4ed8;">Credit — Monthly Invoice Breakdown</div>';
    html+='<span style="font-size:11px;color:var(--ink3);">Order placed '+fmtDate(order.created_at)+'</span>';
    html+='</div>';
    html+='<table class="data-table" style="font-size:12px;"><thead><tr><th>Month</th><th style="text-align:right;">Qty Collected</th><th>Invoice</th><th style="text-align:right;">Action</th></tr></thead><tbody>';
    periods.forEach(function(p){
      var qty=qtyByPeriod[p]||0;
      var inv=creditInvoicesByPeriod[p]||null;
      var isLinked=inv&&order.credit_invoice_id===inv.id;
      html+='<tr>';
      html+='<td style="font-weight:600;">'+esc(periodLabel(p))+'</td>';
      html+='<td style="text-align:right;'+(qty>0?'font-weight:600;':'color:var(--ink4);')+'">'+(qty>0?qty.toLocaleString():'—')+'</td>';
      // Invoice column
      html+='<td>';
      if(inv){
        var st=inv.status||'issued';
        var stColor=st==='paid'?'background:#dcfce7;color:#166534;border:1px solid #bbf7d0;':st==='overdue'?'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;':'background:#fef3c7;color:#92400e;border:1px solid #fde68a;';
        html+='<span style="font-weight:600;">'+esc(inv.invoice_number||'—')+'</span>';
        html+=' <span class="badge" style="font-size:10px;padding:2px 6px;'+stColor+'">'+st.toUpperCase()+'</span>';
        if(!isLinked&&qty>0)html+=' <span style="font-size:10px;color:#92400e;">(not linked to this order)</span>';
        if(inv.invoice_file_url)html+=' <a href="'+esc(inv.invoice_file_url)+'" target="_blank" rel="noopener" style="margin-left:.3rem;text-decoration:none;" title="View invoice PDF">📄</a>';
        if(inv.payment_proof_url)html+='<a href="'+esc(inv.payment_proof_url)+'" target="_blank" rel="noopener" style="margin-left:.2rem;text-decoration:none;" title="View payment proof">🧾</a>';
      } else if(qty>0){
        html+='<span style="font-size:11px;color:#92400e;">Not issued</span>';
      } else {
        html+='<span style="font-size:11px;color:var(--ink4);">—</span>';
      }
      html+='</td>';
      // Action column
      html+='<td style="text-align:right;">';
      if(inv&&inv.status!=='paid'){
        html+='<button class="btn btn-outline btn-sm" onclick="markCreditInvoicePaid(\''+esc(inv.id)+'\',\''+id+'\')" style="font-size:10px;padding:2px 8px;">✓ Mark Paid</button>';
      } else if(!inv&&qty>0){
        html+='<button class="btn btn-primary btn-sm" onclick="openInvoiceUploadModalForMonth(\''+id+'\',\''+p+'\')" style="font-size:10px;padding:2px 8px;">📤 Upload</button>';
      }
      html+='</td>';
      html+='</tr>';
    });
    html+='</tbody></table>';
    if(!order.customer_id){
      html+='<div style="font-size:11px;color:#92400e;margin-top:.5rem;">⚠ This order has no <code>customer_id</code>, so it cannot be tied to a customer invoice. Edit the customer record first.</div>';
    }
    html+='</div>';
  }

  // ── Seller Note ──
  html+='<div style="margin-bottom:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.4rem;">Seller Note <span style="font-size:10px;color:var(--ink4);font-weight:400;">(visible to customer)</span></div>';
  html+='<textarea class="form-input" id="mo-seller-note" rows="2" style="font-size:13px;">'+(order.seller_note||'')+'</textarea>';
  html+='<button class="btn btn-outline btn-sm" onclick="saveSellerNote(\''+id+'\')" style="margin-top:.4rem;">Save Note</button></div>';

  // ── Internal Notes ──
  html+='<div style="margin-bottom:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.4rem;">Internal Notes <span style="font-size:10px;color:var(--ink4);font-weight:400;">(admin only)</span></div>';
  html+='<textarea class="form-input" id="mo-notes" rows="2" style="font-size:13px;">'+(order.internal_notes||'')+'</textarea>';
  html+='<button class="btn btn-outline btn-sm" onclick="saveInternalNote(\''+id+'\')" style="margin-top:.4rem;">Save</button></div>';

  // ── Documents ──
  // Section heading matches the customer portal modal title style
  // ("Documents") so an admin reviewing an order sees the same label
  // the customer sees when they tap an attachment chip in their portal.
  html+='<div style="margin-bottom:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.4rem;">Documents</div>';
  html+='<div id="mo-attachments"><div style="font-size:12px;color:var(--ink4);">Loading...</div></div>';
  html+='<div style="margin-top:.5rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">';
  html+='<input type="file" id="mo-att-file" multiple style="font-size:12px;">';
  html+='<button class="btn btn-outline btn-sm" onclick="uploadOrderAttachment(\''+id+'\')">Upload</button></div>';
  html+='<div style="font-size:10.5px;color:var(--ink4);margin-top:.3rem;">Hold Ctrl/⌘ or Shift to pick multiple files.</div></div>';

  // ── Timeline ──
  html+='<div><div style="font-size:13px;font-weight:600;margin-bottom:.5rem;">Order Timeline</div>';
  html+='<div id="mo-timeline"><div style="font-size:12px;color:var(--ink4);">Loading...</div></div></div>';

  document.getElementById('mo-body').innerHTML=html;
  // Footer: archive / unarchive / delete-or-restore actions + Close.
  var archiveBtn = order.archived_at
    ? '<button class="btn btn-outline" onclick="unarchiveOrder(\''+id+'\')">Unarchive</button>'
    : '<button class="btn btn-outline" onclick="archiveOrder(\''+id+'\')">Archive</button>';
  var deleteBtn = order.deleted_at
    ? '<button class="btn btn-outline" style="color:var(--green);border-color:var(--green);" onclick="restoreOrder(\''+id+'\')">Restore</button>'
    : '<button class="btn btn-outline" style="color:var(--red);border-color:var(--red);" onclick="deleteOrder(\''+id+'\')">Delete</button>';
  document.getElementById('mo-foot').innerHTML=
    archiveBtn + deleteBtn +
    '<button class="btn btn-outline" onclick="closeModal(\'modal-order\');loadOrders();">Close</button>';
  openModal('modal-order');

  // Load async data
  loadAttachments(id);
  loadTimeline(id);
}

// ═══════════════════════════════════════
//  ARCHIVE / DELETE (soft) — wired to the Archived / Deleted filter
//  checkboxes. Archived orders are hidden from the default list but
//  remain accessible via the filter. Deleted orders are hidden
//  everywhere unless the Deleted filter is explicitly selected.
// ═══════════════════════════════════════
async function archiveOrder(orderId){
  var{error}=await sb.from('salesweb_customer_orders').update({archived_at:new Date().toISOString()}).eq('id',orderId);
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Order archived');
  closeModal('modal-order'); loadOrders();
}
async function unarchiveOrder(orderId){
  var{error}=await sb.from('salesweb_customer_orders').update({archived_at:null}).eq('id',orderId);
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Order unarchived');
  closeModal('modal-order'); loadOrders();
}
async function deleteOrder(orderId){
  if(!confirm('Delete this order? It will be hidden from the default list but kept for audit. You can restore it later via the "Deleted" filter.'))return;
  var{error}=await sb.from('salesweb_customer_orders').update({deleted_at:new Date().toISOString()}).eq('id',orderId);
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Order deleted');
  closeModal('modal-order'); loadOrders();
}
async function restoreOrder(orderId){
  var{error}=await sb.from('salesweb_customer_orders').update({deleted_at:null}).eq('id',orderId);
  if(error){toast('Error: '+error.message,'error');return;}
  toast('Order restored');
  closeModal('modal-order'); loadOrders();
}

// Record a partial / full payment against the order. The number the
// admin types in is treated as the cumulative amount received — not
// an increment — so they can correct typos without compounding.
async function updateOrderAmountPaid(orderId, totalAmount){
  var raw = document.getElementById('mo-amount-paid').value;
  var amt = Number(raw);
  if(isNaN(amt) || amt < 0){ toast('Enter a valid amount (≥ 0)','error'); return; }
  // Round to 2dp to avoid floating-point dust in DB.
  amt = Math.round(amt * 100) / 100;
  // Previous value so we only log a timeline entry when it actually changes.
  var{data:cur}=await sb.from('salesweb_customer_orders').select('amount_paid').eq('id',orderId).maybeSingle();
  var prev = Number(cur && cur.amount_paid) || 0;
  var nowIso = new Date().toISOString();
  var{error}=await sb.from('salesweb_customer_orders').update({amount_paid:amt, amount_paid_at:nowIso}).eq('id',orderId);
  if(error){
    // amount_paid_at column may not exist yet — retry recording just the amount.
    var r2=await sb.from('salesweb_customer_orders').update({amount_paid:amt}).eq('id',orderId);
    if(r2.error){toast('Error: '+r2.error.message,'error');return;}
  }
  var tot = Number(totalAmount)||0;
  var bal = Math.max(0, tot-amt);
  // Record a dated entry on the order timeline so there's a payment-received date.
  if(amt !== prev){
    var sess=await sb.auth.getSession();
    var who=(sess&&sess.data&&sess.data.session&&sess.data.session.user&&sess.data.session.user.email)||'admin';
    var label=(amt>=tot && tot>0) ? 'Payment Received (Full)' : 'Partial Payment Received';
    try{
      await sb.from('salesweb_order_timeline').insert([{
        order_id:orderId,
        status:label,
        note:'Amount paid recorded: RM '+fmtMYR(amt)+' · Balance RM '+fmtMYR(bal),
        changed_by:who
      }]);
    }catch(e){ /* timeline is best-effort */ }
  }
  // Helpful nudge — but don't auto-change status, leave that to the admin.
  if(amt >= tot && tot > 0) toast('Payment received in full. Remember to set status to Paid if needed.');
  else if(amt > 0 && amt < tot) toast('Partial payment saved · Balance RM '+fmtMYR(bal));
  else toast('Amount paid updated');
  viewOrder(orderId); // re-render the modal with the new figures
}

// ═══════════════════════════════════════
//  STATUS UPDATE (with side effects)
// ═══════════════════════════════════════
async function updateOrderStatus(orderId){
  var newStatus=document.getElementById('mo-status-select').value;
  var{data:order}=await sb.from('salesweb_customer_orders').select('status,total,amount_paid,customer_name,billing_name,order_number,customer_email').eq('id',orderId).single();
  if(!order)return;
  var oldStatus=order.status;
  if(newStatus===oldStatus){toast('Status unchanged');return;}

  // If cancelling, show stock restore popup first
  if(newStatus==='Cancelled'&&oldStatus!=='Cancelled'){
    showCancelStockRestore(orderId,oldStatus);
    return;
  }

  await executeCancelOrStatusUpdate(orderId,oldStatus,newStatus,order);
}

async function executeCancelOrStatusUpdate(orderId,oldStatus,newStatus,order){
  // Primary: change the status. This must succeed before any side effects,
  // and its error is surfaced (a silent failure here previously made
  // "Update" appear to do nothing).
  var stRes=await sb.from('salesweb_customer_orders').update({status:newStatus,updated_at:new Date().toISOString()}).eq('id',orderId);
  if(stRes.error){ toast('Could not update status: '+stRes.error.message,'error'); return; }

  // Best-effort: when moving to a settled status (Paid / Ready for Collection /
  // Completed), sync amount_paid to total + stamp the date so no phantom
  // balance remains. Done as a SEPARATE update with a fallback so a missing
  // amount_paid_at column can never block the status change above.
  if(SETTLED_STATUSES[newStatus] && (Number(order.amount_paid)||0) < (Number(order.total)||0)){
    var _tot=Number(order.total)||0, _now=new Date().toISOString();
    var setRes=await sb.from('salesweb_customer_orders').update({amount_paid:_tot, amount_paid_at:_now}).eq('id',orderId);
    if(setRes.error){ await sb.from('salesweb_customer_orders').update({amount_paid:_tot}).eq('id',orderId); }
  }

  // Log to timeline
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:newStatus,note:'Status changed from '+oldStatus+' to '+newStatus,changed_by:user}]);

  // Side effects
  if(newStatus==='Paid'&&oldStatus!=='Paid'){
    await issuePoints(orderId,order.total||0);
    await createALFromOrder(orderId,order);

    // Fire the same "Payment confirmed" email the Billplz webhook fires for
    // online payments. send-order-email is idempotent via email_sent_at on
    // the order, so flipping Pending → Paid → some other status → Paid won't
    // double-send. Run it in the background so a Resend hiccup doesn't block
    // the toast / view refresh; surface any error in the console for triage.
    sb.functions.invoke('send-order-email', { body: { order_id: orderId } })
      .then(function(res){
        if(res && res.error){ console.error('[email] invoke error:', res.error); }
        else if(res && res.data && res.data.error){ console.error('[email] function error:', res.data); }
      })
      .catch(function(err){ console.error('[email] invoke threw:', err); });

    toast('Points issued + AL created + confirmation email sent');
  } else {
    toast('Status updated to '+newStatus);
  }

  viewOrder(orderId);
}

// ═══════════════════════════════════════
//  CANCEL ORDER — STOCK RESTORE POPUP
// ═══════════════════════════════════════
async function showCancelStockRestore(orderId,oldStatus){
  var{data:items}=await sb.from('salesweb_order_items').select('*').eq('order_id',orderId);
  items=items||[];
  // Load all products for the "restore to" dropdown
  var{data:allProducts}=await sb.from('salesweb_products').select('id,name,stock_qty').order('name');
  allProducts=allProducts||[];

  var html='<p style="font-size:13px;color:var(--ink3);margin-bottom:1rem;">This order has <strong>'+items.length+' item(s)</strong>. Stock was held when the order was placed. Choose where to restore the stock for each item:</p>';

  if(!items.length){
    html+='<p style="font-size:13px;color:var(--ink4);">No items to restore.</p>';
  } else {
    html+='<div style="display:flex;flex-direction:column;gap:.8rem;">';
    items.forEach(function(it,idx){
      html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;border:1px solid var(--border);">';
      html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;">';
      html+='<div><strong style="font-size:13px;">'+esc(it.product_name||'Unknown')+'</strong><div style="font-size:12px;color:var(--ink4);">Qty ordered: <strong>'+it.quantity+'</strong></div></div>';
      html+='<label style="display:flex;align-items:center;gap:.4rem;font-size:12px;font-weight:600;cursor:pointer;"><input type="checkbox" id="restore-check-'+idx+'" checked onchange="toggleRestoreRow('+idx+')"> Restore stock</label>';
      html+='</div>';
      html+='<div id="restore-row-'+idx+'">';
      html+='<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">';
      html+='<label style="font-size:12px;color:var(--ink3);white-space:nowrap;">Restore to:</label>';
      html+='<select id="restore-target-'+idx+'" class="form-input" style="flex:1;font-size:12px;padding:6px 10px;min-width:200px;">';
      // Default: original product
      allProducts.forEach(function(p){
        var selected=p.id===it.product_id?' selected':'';
        html+='<option value="'+p.id+'"'+selected+'>'+esc(p.name)+' (stock: '+p.stock_qty+')</option>';
      });
      html+='</select>';
      html+='<label style="font-size:12px;color:var(--ink3);white-space:nowrap;">Qty:</label>';
      html+='<input type="number" id="restore-qty-'+idx+'" class="form-input" style="width:80px;font-size:12px;padding:6px 10px;" value="'+it.quantity+'" min="0" max="'+it.quantity+'">';
      html+='</div></div></div>';
    });
    html+='</div>';
  }

  document.getElementById('cancel-stock-body').innerHTML=html;
  document.getElementById('cancel-stock-foot').innerHTML=
    '<button class="btn btn-outline" onclick="closeModal(\'modal-cancel-stock\')">Go Back</button>'+
    '<button class="btn btn-primary" style="background:#dc2626;border-color:#dc2626;" onclick="confirmCancelWithRestore(\''+orderId+'\',\''+oldStatus+'\','+items.length+')">Confirm Cancel & Restore</button>';

  // Store items data for the confirm function
  window._cancelItems=items;
  openModal('modal-cancel-stock');
}

function toggleRestoreRow(idx){
  var checked=document.getElementById('restore-check-'+idx).checked;
  document.getElementById('restore-row-'+idx).style.display=checked?'':'none';
}

async function confirmCancelWithRestore(orderId,oldStatus,itemCount){
  var btn=document.querySelector('#cancel-stock-foot .btn-primary');
  btn.disabled=true;btn.textContent='Processing...';

  var items=window._cancelItems||[];
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  var restoreNotes=[];

  // Restore stock for each checked item
  for(var i=0;i<items.length;i++){
    var checked=document.getElementById('restore-check-'+i);
    if(!checked||!checked.checked)continue;
    var targetId=document.getElementById('restore-target-'+i).value;
    var qty=parseInt(document.getElementById('restore-qty-'+i).value)||0;
    if(!targetId||qty<=0)continue;

    // Add stock back to target product
    var{data:prod}=await sb.from('salesweb_products').select('stock_qty,name').eq('id',targetId).single();
    if(prod){
      var newQty=(prod.stock_qty||0)+qty;
      await sb.from('salesweb_products').update({stock_qty:newQty,updated_at:new Date().toISOString()}).eq('id',targetId);
      restoreNotes.push(qty+' restored to '+prod.name);
    }
  }

  // Update order status
  await sb.from('salesweb_customer_orders').update({status:'Cancelled',updated_at:new Date().toISOString()}).eq('id',orderId);

  // Log to timeline
  var note='Status changed from '+oldStatus+' to Cancelled';
  if(restoreNotes.length)note+='. Stock restored: '+restoreNotes.join('; ');
  await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:'Cancelled',note:note,changed_by:user}]);

  closeModal('modal-cancel-stock');
  toast('Order cancelled'+(restoreNotes.length?' — stock restored':''));

  // Sync the cancellation to the linked AL in the AI system. Full cancel
  // (nothing collected yet) → cancel the AL too. Partial collection →
  // leave the AL alone but stamp the order with the uncollected qty.
  // Best-effort: any failure here is logged but doesn't break the cancel.
  try { await _propagateOrderCancelToAL(orderId, user); }
  catch(propErr) { console.warn('AL-link propagation failed:', propErr); }

  viewOrder(orderId);
}

// Shared helper: when a sales-web order is cancelled, sync to its linked
// AL in the AI system. Looks up the AL by al_number = order_number.
//   - If nothing has been collected against the AL yet (qty_ordered === balance)
//     → cancel the AL too so the AI system / Mobile flows hide it.
//   - If there's already been partial collection → leave the AL active
//     (the customer may still come back for what they did collect) but
//     stamp the order with "Cancelled order uncollected seedlings : N" so
//     the uncollected qty is on the record for traceability.
async function _propagateOrderCancelToAL(orderId, user){
  var{data:orderRow}=await sb.from('salesweb_customer_orders')
    .select('order_number, customer_remark')
    .eq('id', orderId).maybeSingle();
  if(!orderRow || !orderRow.order_number) return;

  var{data:alRow}=await sb.from('shared_al_orders')
    .select('id, al_number, quantity_ordered, balance_quantity, status, remark')
    .eq('al_number', orderRow.order_number).maybeSingle();
  if(!alRow || alRow.status === 'Cancelled') return;

  var qtyOrd  = Number(alRow.quantity_ordered) || 0;
  var balance = Number(alRow.balance_quantity) || 0;
  var collected = Math.max(0, qtyOrd - balance);
  var nowIso = new Date().toISOString();

  if(collected === 0){
    await sb.from('shared_al_orders').update({
      status: 'Cancelled',
      remark: '[CANCELLED] Auto-cancelled when Sales Web Order ' + orderRow.order_number + ' was cancelled'
    }).eq('id', alRow.id);
    try {
      await sb.from('salesweb_order_timeline').insert([{
        order_id: orderId, status: 'Cancelled',
        note: 'Linked AL ' + alRow.al_number + ' also auto-cancelled (no collections recorded).',
        changed_by: user
      }]);
    } catch(e){}
  } else {
    var stamp = 'Cancelled order uncollected seedlings : ' + balance.toLocaleString();
    var newRemark = (orderRow.customer_remark ? orderRow.customer_remark + ' | ' : '') + stamp;
    await sb.from('salesweb_customer_orders').update({
      customer_remark: newRemark, updated_at: nowIso
    }).eq('id', orderId);
    try {
      await sb.from('salesweb_order_timeline').insert([{
        order_id: orderId, status: 'Cancelled',
        note: stamp + ' (AL ' + alRow.al_number + ' kept active — ' + collected.toLocaleString() + ' already collected, ' + balance.toLocaleString() + ' uncollected at cancel time).',
        changed_by: user
      }]);
    } catch(e){}
  }
}

// ═══════════════════════════════════════
//  DISCOUNT & COUPON
// ═══════════════════════════════════════
// Discount mode is held in module-local state; the panel buttons flip the
// styling and this var toggles whether the typed value is treated as a flat
// RM amount or as a % of subtotal before being persisted (always as RM).
var _moDiscountMode = 'rm';
function setDiscountMode(mode){
  _moDiscountMode = (mode === 'pct') ? 'pct' : 'rm';
  var rmBtn  = document.getElementById('mo-discount-mode-rm');
  var pctBtn = document.getElementById('mo-discount-mode-pct');
  if(rmBtn && pctBtn){
    var on  = 'background:var(--ink2);color:#fff;';
    var off = 'background:transparent;color:var(--ink2);';
    rmBtn.style.cssText  = 'font-size:11px;padding:5px 10px;border:0;' + (_moDiscountMode==='rm'  ? on : off);
    pctBtn.style.cssText = 'font-size:11px;padding:5px 10px;border:0;' + (_moDiscountMode==='pct' ? on : off);
  }
  var inp = document.getElementById('mo-discount');
  if(inp){ inp.placeholder = (_moDiscountMode === 'pct') ? '% off subtotal' : 'Amount (RM)'; }
}

// Single source of truth for "what is this order's total?". Reads items
// subtotal + every known discount source (single discount_amount, single
// coupon_discount, stacked salesweb_order_adjustments rows, points
// redemption) and persists the result back to salesweb_customer_orders.
async function _recomputeOrderTotal(orderId){
  var{data:items}=await sb.from('salesweb_order_items').select('subtotal').eq('order_id',orderId);
  var subtotal=(items||[]).reduce(function(s,i){return s+(Number(i.subtotal)||0);},0);
  var{data:order}=await sb.from('salesweb_customer_orders').select('discount_amount,coupon_discount,points_discount_rm').eq('id',orderId).single();
  var stacked=0;
  try{
    var{data:adjs}=await sb.from('salesweb_order_adjustments').select('amount').eq('order_id',orderId);
    stacked=(adjs||[]).reduce(function(s,a){return s+(Number(a.amount)||0);},0);
  }catch(e){ /* migration not applied yet → treat as no stacked adjustments */ }
  var total=Math.max(0, subtotal
    - (order&&order.discount_amount||0)
    - (order&&order.coupon_discount||0)
    - stacked
    - (order&&order.points_discount_rm||0));
  total=Math.round(total*100)/100;
  await sb.from('salesweb_customer_orders').update({total:total,updated_at:new Date().toISOString()}).eq('id',orderId);
  return total;
}

async function addDiscount(orderId, subtotalHint){
  var raw = parseFloat(document.getElementById('mo-discount').value) || 0;
  if(raw < 0){ toast('Discount must be ≥ 0','error'); return; }
  var noteEl = document.getElementById('mo-discount-note');
  var note = noteEl ? (noteEl.value || '').trim().slice(0,200) : '';
  // % is interpreted against the items subtotal and saved as a flat RM
  // amount so all downstream consumers (totals breakdown, customer portal,
  // proforma email) keep reading a single source of truth.
  var amt = raw;
  if(_moDiscountMode === 'pct'){
    if(raw > 100){ toast('Percentage must be ≤ 100','error'); return; }
    var subtotal = Number(subtotalHint || 0);
    if(!subtotal){
      var{data:items}=await sb.from('salesweb_order_items').select('subtotal').eq('order_id',orderId);
      subtotal = (items||[]).reduce(function(s,i){return s+(i.subtotal||0);},0);
    }
    amt = Math.round(subtotal * raw) / 100;
  }
  if(amt <= 0){ toast('Discount must be > 0','error'); return; }
  // First discount fills the single discount_amount/discount_note slot on
  // the order row (back-compat with the legacy single-slot UI). Every
  // additional one stacks into salesweb_order_adjustments.
  var{data:cur}=await sb.from('salesweb_customer_orders').select('discount_amount').eq('id',orderId).maybeSingle();
  var hasFirst = Number(cur&&cur.discount_amount||0) > 0;
  if(!hasFirst){
    var upd = {discount_amount:amt, discount_note: note || null, updated_at:new Date().toISOString()};
    var r = await sb.from('salesweb_customer_orders').update(upd).eq('id',orderId);
    if(r && r.error && /discount_note/i.test(r.error.message||'')){
      await sb.from('salesweb_customer_orders').update({discount_amount:amt,updated_at:new Date().toISOString()}).eq('id',orderId);
    }
  } else {
    var{error:insErr}=await sb.from('salesweb_order_adjustments').insert([{order_id:orderId, kind:'discount', amount:amt, note: note || null}]);
    if(insErr){
      if(/relation .* does not exist|salesweb_order_adjustments/i.test(insErr.message||'')){
        toast('Run the order_adjustments.sql migration to stack more discounts','error');
      } else {
        toast('Failed to add discount: '+insErr.message,'error');
      }
      return;
    }
  }
  await _recomputeOrderTotal(orderId);
  toast('Discount applied: RM '+fmtMYR(amt) + (_moDiscountMode==='pct' ? ' ('+raw+'%)' : ''));
  viewOrder(orderId);
}

// Removes whatever discount is currently on the order, even when a coupon is
// also applied. Keeps the coupon untouched and recomputes the total.
async function removeDiscount(orderId){
  if(!confirm('Remove the discount from this order?')) return;
  var r = await sb.from('salesweb_customer_orders').update({discount_amount:0, discount_note:null, updated_at:new Date().toISOString()}).eq('id',orderId);
  if(r && r.error && /discount_note/i.test(r.error.message||'')){
    await sb.from('salesweb_customer_orders').update({discount_amount:0,updated_at:new Date().toISOString()}).eq('id',orderId);
  }
  await _recomputeOrderTotal(orderId);
  toast('Discount removed');
  viewOrder(orderId);
}

// Removes an applied coupon, clearing both the code and the recorded
// coupon_discount. Recomputes total against whatever else remains.
async function removeCoupon(orderId){
  if(!confirm('Remove the coupon from this order?')) return;
  await sb.from('salesweb_customer_orders')
    .update({coupon_code:null, coupon_discount:0, updated_at:new Date().toISOString()})
    .eq('id',orderId);
  await _recomputeOrderTotal(orderId);
  toast('Coupon removed');
  viewOrder(orderId);
}

// Removes a stacked adjustment row (additional discount/coupon).
async function removeAdjustment(adjId, orderId){
  if(!adjId) return;
  if(!confirm('Remove this adjustment from the order?')) return;
  var{error}=await sb.from('salesweb_order_adjustments').delete().eq('id',adjId);
  if(error){ toast('Remove failed: '+error.message,'error'); return; }
  await _recomputeOrderTotal(orderId);
  toast('Adjustment removed');
  viewOrder(orderId);
}

async function applyCoupon(orderId){
  var code=document.getElementById('mo-coupon').value.trim().toUpperCase();
  if(!code){toast('Enter coupon code','error');return;}

  // Pull order + items + product categories so the RPC can evaluate scope.
  var{data:items}=await sb.from('salesweb_order_items').select('product_id,quantity,unit_price,subtotal').eq('order_id',orderId);
  var{data:order}=await sb.from('salesweb_customer_orders').select('customer_id,customer_email,discount_amount,points_discount_rm').eq('id',orderId).single();
  var subtotal=(items||[]).reduce(function(s,i){return s+(i.subtotal||0);},0);

  var prodIds=(items||[]).map(function(i){return i.product_id;}).filter(Boolean);
  var byId={};
  if(prodIds.length){
    var{data:prods}=await sb.from('salesweb_products').select('id,category,product_type').in('id',prodIds);
    (prods||[]).forEach(function(p){byId[p.id]={category:p.category||p.product_type||null};});
  }
  var rpcItems=(items||[]).map(function(i){
    var meta=byId[i.product_id]||{};
    return{product_id:i.product_id,category:meta.category,qty:i.quantity,price:i.unit_price};
  });

  // Single source of truth: redeem_coupon writes the redemption row + bumps
  // usage_count atomically, and re-validates against the live cart.
  var{data:res,error}=await sb.rpc('redeem_coupon',{
    p_code:code,
    p_customer_id:order&&order.customer_id||null,
    p_customer_email:order&&order.customer_email||null,
    p_order_id:orderId,
    p_subtotal:subtotal,
    p_items:rpcItems
  });
  if(error){toast('Coupon error: '+error.message,'error');return;}
  if(!res||res.ok===false){toast(res&&res.reason?res.reason:'Coupon rejected','error');return;}

  var discount=Number(res.discount||0);
  // First coupon fills the single coupon_code/coupon_discount slot on the
  // order row (back-compat with the legacy single-slot UI). Every
  // additional one stacks into salesweb_order_adjustments.
  var{data:cur}=await sb.from('salesweb_customer_orders').select('coupon_code').eq('id',orderId).maybeSingle();
  var hasFirst = !!(cur && cur.coupon_code);
  if(!hasFirst){
    await sb.from('salesweb_customer_orders').update({coupon_code:code,coupon_discount:discount,updated_at:new Date().toISOString()}).eq('id',orderId);
  } else {
    var{error:insErr}=await sb.from('salesweb_order_adjustments').insert([{order_id:orderId, kind:'coupon', amount:discount, coupon_code:code}]);
    if(insErr){
      if(/relation .* does not exist|salesweb_order_adjustments/i.test(insErr.message||'')){
        toast('Run the order_adjustments.sql migration to stack more coupons','error');
      } else {
        toast('Failed to add coupon: '+insErr.message,'error');
      }
      return;
    }
  }
  await _recomputeOrderTotal(orderId);
  toast('Coupon applied: -RM '+fmtMYR(discount));
  viewOrder(orderId);
}

// ═══════════════════════════════════════
//  NOTES
// ═══════════════════════════════════════
async function saveSellerNote(orderId){
  var note=document.getElementById('mo-seller-note').value;
  await sb.from('salesweb_customer_orders').update({seller_note:note,updated_at:new Date().toISOString()}).eq('id',orderId);
  toast('Seller note saved');
}

async function saveInternalNote(orderId){
  var note=document.getElementById('mo-notes').value;
  await sb.from('salesweb_customer_orders').update({internal_notes:note,updated_at:new Date().toISOString()}).eq('id',orderId);
  toast('Internal note saved');
}

// ═══════════════════════════════════════
//  CREDIT INVOICE — mark paid from admin order modal
// ═══════════════════════════════════════
async function markCreditInvoicePaid(invoiceId,orderId){
  if(!confirm('Mark this invoice as paid?'))return;
  var{error}=await sb.from('salesweb_credit_invoices').update({status:'paid',paid_at:new Date().toISOString()}).eq('id',invoiceId);
  if(error){toast('Failed: '+error.message,'error');return;}
  // The credit customer has now actually paid — credit loyalty points
  // (idempotent: issuePoints exits if points_issued is already set).
  var pointsNote = '';
  try{
    var{data:o}=await sb.from('salesweb_customer_orders').select('total,points_issued').eq('id',orderId).maybeSingle();
    if(o && !o.points_issued){ await issuePoints(orderId, Number(o.total)||0); pointsNote = ' · loyalty points credited'; }
  }catch(e){ console.warn('[Credit paid] issuePoints failed:', e); }
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:'Invoice Paid',note:'Credit invoice marked as paid'+pointsNote,changed_by:user}]);
  toast('Invoice marked as paid'+pointsNote);
  viewOrder(orderId);
}

// ═══════════════════════════════════════
//  PAYMENT TERMS (cash / credit)
// ═══════════════════════════════════════
async function updateOrderPaymentTerms(orderId){
  var newTerms=document.getElementById('mo-terms-select').value;
  var period=(document.getElementById('mo-credit-period')||{}).value||'';
  period=period.trim();
  var{data:order}=await sb.from('salesweb_customer_orders').select('payment_terms,credit_billing_period,status').eq('id',orderId).single();
  if(!order){toast('Order not found','error');return;}
  var oldTerms=order.payment_terms==='credit'?'credit':'cash';
  if(newTerms===oldTerms&&period===(order.credit_billing_period||'')){toast('No changes');return;}
  if(newTerms==='credit'&&oldTerms!=='credit'){
    if(!confirm('Switch this order to CREDIT terms?\n\nThe total will count toward credit outstanding until billed.'))return;
  }
  var update={payment_terms:newTerms,updated_at:new Date().toISOString()};
  if(newTerms==='credit')update.credit_billing_period=period||null;
  else{update.credit_billing_period=null;update.credit_billed_at=null;}
  var{error}=await sb.from('salesweb_customer_orders').update(update).eq('id',orderId);
  if(error){toast('Error: '+error.message,'error');return;}
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  var note='Payment terms changed from '+oldTerms.toUpperCase()+' to '+newTerms.toUpperCase();
  if(newTerms==='credit'&&period)note+=' (period: '+period+')';
  await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:order.status,note:note,changed_by:user}]);

  // Newly-credit orders proceed straight to collection (billed monthly),
  // so fire the same paid-side-effects: issue points + create AL + send
  // confirmation email. All three are idempotent.
  // Switching Cash → Credit: customer can collect (AL + confirmation email)
  // but NO points yet — points are credited when the monthly invoice is paid.
  var creditSideEffects = '';
  if(newTerms==='credit' && oldTerms!=='credit'){
    try{
      var{data:fullOrder}=await sb.from('salesweb_customer_orders').select('order_number,total,customer_name,billing_name,customer_email').eq('id',orderId).single();
      if(fullOrder){
        await createALFromOrder(orderId, fullOrder);
        sb.functions.invoke('send-order-email', { body: { order_id: orderId } })
          .catch(function(err){ console.error('[email] invoke threw:', err); });
        creditSideEffects = ' · AL issued for credit collection';
      }
    }catch(e){ console.warn('[Terms change] credit side effects failed:', e); }
  }
  toast('Payment terms updated'+creditSideEffects);
  viewOrder(orderId);
}

async function setOrderCreditBilled(orderId,billed){
  var{data:order}=await sb.from('salesweb_customer_orders').select('payment_terms,status').eq('id',orderId).single();
  if(!order){toast('Order not found','error');return;}
  if(order.payment_terms!=='credit'){toast('Order is not on credit terms','error');return;}
  var update={credit_billed_at:billed?new Date().toISOString():null,updated_at:new Date().toISOString()};
  var{error}=await sb.from('salesweb_customer_orders').update(update).eq('id',orderId);
  if(error){toast('Error: '+error.message,'error');return;}
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:order.status,note:billed?'Credit marked as Billed':'Credit marked as Unbilled',changed_by:user}]);
  toast(billed?'Marked as Billed':'Marked as Unbilled');
  viewOrder(orderId);
}

// ═══════════════════════════════════════
//  ATTACHMENTS
// ═══════════════════════════════════════
// Plain-text type label (no emoji) shown in each attachment row. The
// 3-letter tag keeps rows scan-able without leaning on emoji glyphs
// that render inconsistently across browsers/OSes.
function attIcon(fileType, fileName){
  var t=(fileType||'').toLowerCase();
  var ext=((fileName||'').split('.').pop()||'').toLowerCase();
  if(t.indexOf('image/')===0||['jpg','jpeg','png','gif','webp','heic'].indexOf(ext)>=0) return 'IMG';
  if(t.indexOf('pdf')>=0||ext==='pdf') return 'PDF';
  if(t.indexOf('word')>=0||['doc','docx'].indexOf(ext)>=0) return 'DOC';
  if(t.indexOf('sheet')>=0||t.indexOf('excel')>=0||['xls','xlsx','csv'].indexOf(ext)>=0) return 'XLS';
  return 'FILE';
}

function fmtFileSize(bytes){
  if(!bytes||isNaN(bytes)) return '';
  var kb=bytes/1024;
  if(kb<1) return bytes+' B';
  if(kb<1024) return kb.toFixed(1)+' KB';
  return (kb/1024).toFixed(1)+' MB';
}

async function loadAttachments(orderId){
  var{data}=await sb.from('salesweb_order_attachments').select('*').eq('order_id',orderId).order('created_at',{ascending:false});
  var el=document.getElementById('mo-attachments');
  if(!data||!data.length){el.innerHTML='<div style="font-size:12px;color:var(--ink4);padding:.3rem 0;">No documents uploaded yet.</div>';return;}
  // Card-style row matches customer-portal .att-file: type tag, filename +
  // meta line, then a "View" button that opens the file inside a floating
  // preview modal (PDF/image inline iframe) instead of jumping the admin
  // away to a new tab, followed by the destructive delete affordance.
  el.innerHTML=data.map(function(a){
    var dt=fmtDate(a.created_at);
    var meta=[a.file_type||'File',fmtFileSize(a.file_size),dt,a.uploaded_by].filter(Boolean).join(' · ');
    var idJs=String(a.id||'').replace(/[\\'"<>]/g,'');
    var urlJs=String(a.file_url||'').replace(/'/g,'%27');
    var nameJs=String(a.file_name||'').replace(/'/g,'\\\'');
    var typeJs=String(a.file_type||'').replace(/'/g,'\\\'');
    return '<div class="mo-att-row">'+
      '<div class="mo-att-icon">'+attIcon(a.file_type,a.file_name)+'</div>'+
      '<div class="mo-att-info"><strong>'+esc(a.file_name||'Untitled document')+'</strong><span>'+esc(meta)+'</span></div>'+
      '<button class="btn btn-outline btn-sm mo-att-view" onclick="openAttachmentPreview(\''+urlJs+'\',\''+nameJs+'\',\''+typeJs+'\')">View</button>'+
      '<button class="btn btn-outline btn-sm mo-att-del" onclick="deleteAttachment(\''+idJs+'\',\''+orderId+'\')">✕</button>'+
    '</div>';
  }).join('');
}

// ─── Floating attachment preview ────────────────────────────────
// Renders the file inline inside #modal-att-preview so admins can review
// without leaving the order modal. Images render in an <img>, PDFs in an
// <iframe>; anything else falls back to a "Download" link. The current
// document is stashed in _attPreviewState so the modal's Print button
// can spawn a new window pointing at the same file.

var _attPreviewState = { url:'', name:'', isImg:false, isPdf:false };

function openAttachmentPreview(fileUrl, fileName, fileType){
  var url=String(fileUrl||'');
  var name=String(fileName||'Document');
  var t=(fileType||'').toLowerCase();
  var ext=((name).split('.').pop()||'').toLowerCase();
  var isImg = t.indexOf('image/')===0 || ['jpg','jpeg','png','gif','webp','heic'].indexOf(ext)>=0;
  var isPdf = t.indexOf('pdf')>=0 || ext==='pdf';
  _attPreviewState = { url:url, name:name, isImg:isImg, isPdf:isPdf };

  document.getElementById('att-preview-title').textContent=name;
  var body=document.getElementById('att-preview-body');
  if(isImg){
    body.innerHTML='<img src="'+esc(url)+'" alt="'+esc(name)+'" style="max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:6px;">';
  } else if(isPdf){
    body.innerHTML='<iframe src="'+esc(url)+'" style="width:100%;height:70vh;border:0;border-radius:6px;background:#fff;"></iframe>';
  } else {
    body.innerHTML='<div style="padding:1.5rem;text-align:center;color:var(--ink3);font-size:13px;">'+
      'Inline preview is not supported for this file type.<br><br>'+
      '<a href="'+esc(url)+'" download class="btn btn-primary btn-sm">Download</a>'+
    '</div>';
  }
  openModal('modal-att-preview');
}

// Opens the current attachment in a new window and triggers the print
// dialog as soon as it loads. Works for images (printed as a sized image)
// and PDFs (browser's native PDF print). Unsupported types just open in
// the new window for the user to print manually.
function printAttachment(){
  var s = _attPreviewState || {};
  if(!s.url){ toast('Nothing to print','error'); return; }
  var w = window.open('', '_blank');
  if(!w){ toast('Allow pop-ups to print','error'); return; }
  if(s.isPdf){
    // PDFs need a same-tab navigation so the browser print can include them.
    w.location.href = s.url;
    setTimeout(function(){ try{ w.print(); }catch(e){} }, 800);
  } else if(s.isImg){
    w.document.write(
      '<html><head><title>'+esc(s.name)+'</title>'+
      '<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;}img{max-width:100%;max-height:100vh;}</style>'+
      '</head><body><img src="'+esc(s.url)+'" alt="'+esc(s.name)+'" onload="setTimeout(function(){window.print();},150);"></body></html>'
    );
    w.document.close();
  } else {
    w.location.href = s.url;
  }
}

async function uploadOrderAttachment(orderId){
  var input=document.getElementById('mo-att-file');
  if(!input.files||!input.files.length){toast('Select at least one file','error');return;}
  var files=Array.prototype.slice.call(input.files);
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  var ok=0, failed=[];
  var rows=[];
  for(var i=0;i<files.length;i++){
    var file=files[i];
    // Suffix the index + a 3-char random tag to avoid collisions when several
    // files arrive in the same millisecond.
    var ext=(file.name.split('.').pop()||'bin').toLowerCase();
    var tag=Math.random().toString(36).slice(2,5);
    var fileName='order_'+orderId.substring(0,8)+'_'+Date.now()+'_'+i+'_'+tag+'.'+ext;
    var up=await sb.storage.from('order-attachments').upload(fileName,file,{contentType:file.type,upsert:true});
    if(up.error){ failed.push(file.name); continue; }
    var{data:urlData}=sb.storage.from('order-attachments').getPublicUrl(fileName);
    rows.push({order_id:orderId, file_name:file.name, file_url:(urlData&&urlData.publicUrl)||'', file_type:file.type, uploaded_by:user});
    ok++;
  }
  if(rows.length){
    var ins=await sb.from('salesweb_order_attachments').insert(rows);
    if(ins.error){ toast('DB insert failed: '+ins.error.message,'error'); return; }
  }
  input.value='';
  if(ok && !failed.length) toast(ok===1 ? 'File uploaded' : ok+' files uploaded');
  else if(ok && failed.length) toast(ok+' uploaded · '+failed.length+' failed','error');
  else toast('Upload failed','error');
  loadAttachments(orderId);
}

async function deleteAttachment(attId,orderId){
  if(!confirm('Delete this attachment?'))return;
  await sb.from('salesweb_order_attachments').delete().eq('id',attId);
  toast('Attachment deleted');
  loadAttachments(orderId);
}

// ═══════════════════════════════════════
//  TIMELINE
// ═══════════════════════════════════════
async function loadTimeline(orderId){
  var{data}=await sb.from('salesweb_order_timeline').select('*').eq('order_id',orderId).order('created_at',{ascending:true});
  var el=document.getElementById('mo-timeline');

  // The checkout page (payment.html) writes a real "Order Placed" row at
  // order creation. We used to ALWAYS prepend a synthetic "Order Placed"
  // anchor on top of the DB rows, which produced two of them. Only
  // synthesize the anchor when no DB row carries that status — keeps
  // older orders (which predate the real row) rendering correctly.
  var hasOrderPlaced=(data||[]).some(function(t){return(t.status||'').toLowerCase()==='order placed';});
  var entries=hasOrderPlaced?[]:[{status:'Order Placed',note:'Order created',created_at:null,changed_by:'System'}];
  (data||[]).forEach(function(t){entries.push(t);});
  if(entries.length&&entries[0].created_at===null&&(data||[]).length){
    entries[0].created_at=data[0].created_at;
  }
  entries.reverse();

  var html='<div style="position:relative;padding-left:24px;">';
  html+='<div style="position:absolute;left:7px;top:4px;bottom:4px;width:2px;background:var(--border);"></div>';

  entries.forEach(function(t,i){
    var isLatest=i===0;
    var dt=t.created_at?new Date(t.created_at).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
    var dotColor=isLatest?'var(--green)':'var(--border2)';
    var dotSize=isLatest?'12px':'10px';
    var latestBadge=isLatest?' <span style="display:inline-block;font-size:9px;font-weight:700;color:#fff;background:var(--green);padding:1px 6px;border-radius:10px;letter-spacing:.05em;text-transform:uppercase;vertical-align:middle;margin-left:.3rem;">Latest</span>':'';

    html+='<div style="position:relative;padding-bottom:1rem;margin-bottom:.3rem;">';
    html+='<div style="position:absolute;left:-24px;top:3px;width:'+dotSize+';height:'+dotSize+';border-radius:50%;background:'+dotColor+';border:2px solid #fff;box-shadow:0 0 0 2px '+dotColor+';"></div>';
    html+='<div style="font-size:13px;font-weight:'+(isLatest?'700':'600')+';color:var(--ink);">'+esc(t.status)+latestBadge+'</div>';
    if(t.note)html+='<div style="font-size:12px;color:var(--ink3);margin-top:.1rem;">'+esc(t.note)+'</div>';
    html+='<div style="font-size:10px;color:var(--ink4);margin-top:.15rem;">'+dt+(t.changed_by?' · '+esc(t.changed_by):'')+'</div>';
    html+='</div>';
  });
  html+='</div>';
  el.innerHTML=html;
}

// ═══════════════════════════════════════
//  LOYALTY POINTS (on Paid)
// ═══════════════════════════════════════
// Points formula is configurable from admin → Points Settings (stored as
// JSON in salesweb_app_settings.key='points_config'):
//
//   points = floor(total / earn_rm) * earn_pts
//
// The number we save on the order is a SNAPSHOT — later changes to the
// rate won't retroactively recalculate past orders (matches the spec).
async function issuePoints(orderId, totalAmount) {
  // Read configurable earn rate, fall back to RM1=1pt if no row.
  var earnRm = 1, earnPts = 1;
  try {
    var { data } = await sb.from('salesweb_app_settings')
      .select('value').eq('key', 'points_config').maybeSingle();
    if (data && data.value) {
      var cfg = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
      if (cfg && cfg.earn_rm)  earnRm  = Math.max(0.01, Number(cfg.earn_rm)  || 1);
      if (cfg && cfg.earn_pts !== undefined) earnPts = Math.max(0, Number(cfg.earn_pts) || 0);
    }
  } catch (e) { console.warn('[points] config load failed, using defaults:', e); }

  var amt    = Number(totalAmount) || 0;
  var points = Math.floor(amt / earnRm) * earnPts;

  // Pull the order so we know who to credit and whether a redemption was applied.
  var { data: ord } = await sb.from('salesweb_customer_orders')
    .select('customer_id, order_number, points_issued, points_redeemed, points_discount_rm')
    .eq('id', orderId).maybeSingle();
  if (!ord) return;
  if (ord.points_issued) return;   // already processed — idempotent

  var session = await sb.auth.getSession();
  var user = session?.data?.session?.user?.email || 'admin';

  if (points > 0) {
    await sb.from('salesweb_customer_orders')
      .update({ points_issued: points }).eq('id', orderId);

    await sb.from('salesweb_order_timeline').insert([{
      order_id: orderId,
      status: 'Points Issued',
      note: points + ' loyalty points issued (RM ' + amt.toFixed(2) + ' @ ' + earnPts + ' pt per RM ' + earnRm + ')',
      changed_by: user
    }]);
  }

  // Ledger writes — single source of truth for customer balance.
  if (ord.customer_id) {
    var ledgerRows = [];
    if (points > 0) {
      ledgerRows.push({
        user_id: ord.customer_id,
        change: points,
        type: 'Earned',
        order_id: orderId,
        rm_value: amt,
        note: 'Order ' + (ord.order_number || orderId),
        created_by: user
      });
    }
    var redeemed = Number(ord.points_redeemed || 0);
    if (redeemed > 0) {
      ledgerRows.push({
        user_id: ord.customer_id,
        change: -redeemed,
        type: 'Redeemed',
        order_id: orderId,
        rm_value: Number(ord.points_discount_rm || 0),
        note: 'Redeemed on order ' + (ord.order_number || orderId),
        created_by: user
      });
    }
    if (ledgerRows.length) {
      var { error: ledgerErr } = await sb.from('salesweb_points_ledger').insert(ledgerRows);
      if (ledgerErr) console.error('[points] ledger insert failed:', ledgerErr);
    }
  }
}

// ═══════════════════════════════════════
//  AUTO-CREATE AL (on Paid)
// ═══════════════════════════════════════
async function createALFromOrder(orderId,order){
  var alNumber=order.order_number;
  if(!alNumber)return;

  // Check if AL already exists for this order. maybeSingle so the missing-row
  // case is data:null,error:null rather than data:null,error:PGRST116.
  var existingRes=await sb.from('shared_al_orders').select('id').eq('al_number',alNumber).maybeSingle();
  if(existingRes.error){
    console.error('AL existence check failed:',existingRes.error);
    toast('AL check failed — '+existingRes.error.message+' (open DevTools console for details)','error',15000);
    return;
  }
  if(existingRes.data)return; // AL already created

  // Get order items to build AL
  var{data:items}=await sb.from('salesweb_order_items').select('*').eq('order_id',orderId);
  items=items||[];

  var totalQty=items.reduce(function(s,it){return s+(it.quantity||0);},0);
  var productNames=items.map(function(it){return it.product_name;}).join(', ');
  // Calculate unit price from total / qty
  var unitPrice=totalQty>0?Math.round(((order.total||0)/totalQty)*100)/100:0;

  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';

  // Insert AL record
  var{error:alErr}=await sb.from('shared_al_orders').insert([{
    al_number:alNumber,
    order_number:alNumber,
    order_date:new Date().toISOString(),
    customer_name:order.billing_name||order.customer_name||'',
    product_name:productNames||'Oil Palm Seedling',
    quantity_ordered:totalQty,
    balance_quantity:totalQty,
    price_per_unit:unitPrice,
    status:'Verified',
    remark:'Auto-generated from Sales Web Order #'+alNumber
  }]);

  if(alErr){
    // RLS / schema / connectivity failure here means the order is paid but
    // the nursery system never sees an AL — silent here would be invisible
    // for days, so surface the error loudly (console + 15s persistent toast)
    // and log it to the order timeline so the regression is auditable.
    console.error('AL creation error:',alErr);
    toast('⚠️ AL NOT CREATED for order '+alNumber+' — '+alErr.message+' (this is critical; check RLS / table policies)','error',15000);
    try{
      await sb.from('salesweb_order_timeline').insert([{
        order_id:orderId,
        status:'AL Creation Failed',
        note:'Auto-AL insert into shared_al_orders failed: '+alErr.message,
        changed_by:user
      }]);
    }catch(e){ console.error('Could not log AL failure to timeline:',e); }
    return;
  }

  // Log to timeline
  await sb.from('salesweb_order_timeline').insert([{
    order_id:orderId,
    status:'AL Created',
    note:'Acknowledgement Letter '+alNumber+' auto-created in nursery system',
    changed_by:user
  }]);
}

// ═══════════════════════════════════════
//  EDIT — CUSTOMER DETAILS
// ═══════════════════════════════════════
function toggleEditCustomer(){
  var view=document.getElementById('mo-customer-view');
  var edit=document.getElementById('mo-customer-edit');
  if(!view||!edit)return;
  var isEditing=edit.style.display!=='none';
  view.style.display=isEditing?'':'none';
  edit.style.display=isEditing?'none':'';
}

async function saveCustomerDetails(orderId){
  var name=(document.getElementById('mo-cust-name').value||'').trim();
  var email=(document.getElementById('mo-cust-email').value||'').trim();
  var address=(document.getElementById('mo-cust-address').value||'').trim();
  var{data:order}=await sb.from('salesweb_customer_orders').select('customer_name,customer_email,shipping_address,status').eq('id',orderId).single();
  if(!order){toast('Order not found','error');return;}
  var{error}=await sb.from('salesweb_customer_orders').update({customer_name:name,customer_email:email,shipping_address:address,updated_at:new Date().toISOString()}).eq('id',orderId);
  if(error){toast('Error: '+error.message,'error');return;}
  var changes=[];
  if(name!==(order.customer_name||''))changes.push('name');
  if(email!==(order.customer_email||''))changes.push('email');
  if(address!==(order.shipping_address||''))changes.push('shipping address');
  if(changes.length){
    var session=await sb.auth.getSession();
    var user=session?.data?.session?.user?.email||'admin';
    await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:order.status,note:'Customer details updated ('+changes.join(', ')+')',changed_by:user}]);
  }
  toast('Customer details saved');
  viewOrder(orderId);
}

// ═══════════════════════════════════════
//  EDIT — BILLING DETAILS
// ═══════════════════════════════════════
function toggleEditBilling(){
  var view=document.getElementById('mo-billing-view');
  var edit=document.getElementById('mo-billing-edit');
  if(!view||!edit)return;
  var isEditing=edit.style.display!=='none';
  view.style.display=isEditing?'':'none';
  edit.style.display=isEditing?'none':'';
}

async function saveBillingDetails(orderId){
  var name=(document.getElementById('mo-bill-name').value||'').trim();
  var tax=(document.getElementById('mo-bill-tax').value||'').trim();
  var{data:order}=await sb.from('salesweb_customer_orders').select('billing_name,billing_tax_id,status').eq('id',orderId).single();
  if(!order){toast('Order not found','error');return;}
  var{error}=await sb.from('salesweb_customer_orders').update({billing_name:name,billing_tax_id:tax,updated_at:new Date().toISOString()}).eq('id',orderId);
  if(error){toast('Error: '+error.message,'error');return;}
  var changes=[];
  if(name!==(order.billing_name||''))changes.push('billing name');
  if(tax!==(order.billing_tax_id||''))changes.push('tax ID');
  if(changes.length){
    var session=await sb.auth.getSession();
    var user=session?.data?.session?.user?.email||'admin';
    await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:order.status,note:'Billing details updated ('+changes.join(', ')+')',changed_by:user}]);
  }
  toast('Billing details saved');
  viewOrder(orderId);
}

// ═══════════════════════════════════════
//  EDIT — ORDER ITEMS (qty / price / add / delete)
// ═══════════════════════════════════════
async function renderItemsEditMode(orderId){
  var{data:items}=await sb.from('salesweb_order_items').select('*').eq('order_id',orderId).order('id');
  items=items||[];
  window._editItems=items.map(function(it){return{id:it.id,product_id:it.product_id||null,product_name:it.product_name||'',unit_price:Number(it.unit_price)||0,quantity:Number(it.quantity)||0,_action:'keep'};});
  drawItemsEditTable(orderId);
}

function drawItemsEditTable(orderId){
  var all=window._editItems||[];
  var rows=all.filter(function(r){return r._action!=='delete';});
  var subtotalNow=rows.reduce(function(s,r){return s+(Number(r.unit_price)||0)*(Number(r.quantity)||0);},0);
  var html='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:.5rem .7rem;font-size:11px;color:#92400e;margin-bottom:.5rem;">⚠️ Editing items will recalculate the order total (discount and coupon are preserved). Click <strong>Save Changes</strong> when done.</div>';
  html+='<table class="data-table"><thead><tr><th>Product</th><th style="text-align:right;width:110px;">Price (RM)</th><th style="text-align:right;width:80px;">Qty</th><th style="text-align:right;width:100px;">Subtotal</th><th style="width:40px;"></th></tr></thead><tbody>';
  if(!rows.length){
    html+='<tr><td colspan="5" style="text-align:center;font-size:12px;color:var(--ink4);padding:.6rem;">No items — add one below</td></tr>';
  }
  rows.forEach(function(r){
    var idx=all.indexOf(r);
    var rowSub=(Number(r.unit_price)||0)*(Number(r.quantity)||0);
    html+='<tr>';
    html+='<td><input class="form-input" type="text" value="'+esc(r.product_name)+'" oninput="updateEditItem('+idx+',\'product_name\',this.value)" style="font-size:12px;padding:4px 8px;width:100%;"></td>';
    html+='<td style="text-align:right;"><input class="form-input" type="number" step="0.01" min="0" value="'+r.unit_price+'" oninput="updateEditItemNum('+idx+',\'unit_price\',this.value,\''+orderId+'\')" style="font-size:12px;padding:4px 8px;text-align:right;width:100%;"></td>';
    html+='<td style="text-align:right;"><input class="form-input" type="number" min="0" step="1" value="'+r.quantity+'" oninput="updateEditItemNum('+idx+',\'quantity\',this.value,\''+orderId+'\')" style="font-size:12px;padding:4px 8px;text-align:right;width:100%;"></td>';
    html+='<td style="text-align:right;font-weight:600;font-size:12px;">RM '+fmtMYR(rowSub)+'</td>';
    html+='<td style="text-align:center;"><button class="btn btn-outline btn-sm" onclick="removeEditItem('+idx+',\''+orderId+'\')" title="Remove" style="color:var(--red);font-size:11px;padding:2px 6px;">✕</button></td>';
    html+='</tr>';
  });
  html+='</tbody></table>';
  // Add new row
  html+='<div style="display:flex;gap:.4rem;margin-top:.6rem;align-items:center;flex-wrap:wrap;background:var(--bg);padding:.5rem;border-radius:8px;">';
  html+='<input class="form-input" id="mo-new-item-name" placeholder="Product name" style="flex:1;min-width:160px;font-size:12px;padding:6px 10px;">';
  html+='<input class="form-input" id="mo-new-item-price" type="number" step="0.01" min="0" placeholder="Price" style="width:90px;font-size:12px;padding:6px 10px;">';
  html+='<input class="form-input" id="mo-new-item-qty" type="number" min="1" step="1" value="1" style="width:60px;font-size:12px;padding:6px 10px;">';
  html+='<button class="btn btn-outline btn-sm" onclick="addEditItem(\''+orderId+'\')" style="font-size:11px;">+ Add Item</button>';
  html+='</div>';
  // Running subtotal
  html+='<div style="display:flex;justify-content:space-between;margin-top:.6rem;font-size:12px;color:var(--ink3);"><span>New subtotal preview</span><span style="font-weight:600;color:var(--ink);">RM '+fmtMYR(subtotalNow)+'</span></div>';
  // Save / Cancel
  html+='<div style="display:flex;gap:.4rem;margin-top:.8rem;">';
  html+='<button class="btn btn-primary btn-sm" onclick="saveOrderItems(\''+orderId+'\')">Save Changes</button>';
  html+='<button class="btn btn-outline btn-sm" onclick="viewOrder(\''+orderId+'\')">Cancel</button>';
  html+='</div>';
  document.getElementById('mo-items-container').innerHTML=html;
}

function updateEditItem(idx,field,value){
  if(!window._editItems||!window._editItems[idx])return;
  window._editItems[idx][field]=value;
  if(window._editItems[idx]._action==='keep')window._editItems[idx]._action='update';
}

function updateEditItemNum(idx,field,value,orderId){
  if(!window._editItems||!window._editItems[idx])return;
  var num=field==='quantity'?(parseInt(value)||0):(parseFloat(value)||0);
  window._editItems[idx][field]=num;
  if(window._editItems[idx]._action==='keep')window._editItems[idx]._action='update';
  // Update subtotal cells + preview without full redraw
  var rowSub=(Number(window._editItems[idx].unit_price)||0)*(Number(window._editItems[idx].quantity)||0);
  var rows=document.querySelectorAll('#mo-items-container table tbody tr');
  // Match visible row index to underlying idx
  var visible=window._editItems.filter(function(r){return r._action!=='delete';});
  var visibleIdx=visible.indexOf(window._editItems[idx]);
  if(visibleIdx>-1&&rows[visibleIdx]){
    var subCell=rows[visibleIdx].cells[3];
    if(subCell)subCell.textContent='RM '+fmtMYR(rowSub);
  }
  // Recompute total subtotal
  var subtotal=visible.reduce(function(s,r){return s+(Number(r.unit_price)||0)*(Number(r.quantity)||0);},0);
  var spans=document.querySelectorAll('#mo-items-container span');
  if(spans.length>=2){
    spans[spans.length-1].textContent='RM '+fmtMYR(subtotal);
  }
}

function removeEditItem(idx,orderId){
  if(!window._editItems||!window._editItems[idx])return;
  var it=window._editItems[idx];
  if(it._action==='add'){window._editItems.splice(idx,1);}
  else it._action='delete';
  drawItemsEditTable(orderId);
}

function addEditItem(orderId){
  var nameEl=document.getElementById('mo-new-item-name');
  var priceEl=document.getElementById('mo-new-item-price');
  var qtyEl=document.getElementById('mo-new-item-qty');
  var name=(nameEl.value||'').trim();
  var price=parseFloat(priceEl.value)||0;
  var qty=parseInt(qtyEl.value)||0;
  if(!name){toast('Enter product name','error');return;}
  if(qty<=0){toast('Quantity must be > 0','error');return;}
  window._editItems=window._editItems||[];
  window._editItems.push({id:null,product_id:null,product_name:name,unit_price:price,quantity:qty,_action:'add'});
  drawItemsEditTable(orderId);
}

async function saveOrderItems(orderId){
  var items=window._editItems||[];
  // Validate
  for(var k=0;k<items.length;k++){
    var r=items[k];
    if(r._action==='delete')continue;
    if(!r.product_name||!r.product_name.trim()){toast('Each item needs a product name','error');return;}
    if((Number(r.quantity)||0)<=0){toast('Each item needs quantity > 0','error');return;}
    if((Number(r.unit_price)||0)<0){toast('Price cannot be negative','error');return;}
  }
  // Apply DB changes
  for(var i=0;i<items.length;i++){
    var it=items[i];
    var sub=(Number(it.unit_price)||0)*(Number(it.quantity)||0);
    sub=Math.round(sub*100)/100;
    if(it._action==='delete'&&it.id){
      var{error:dErr}=await sb.from('salesweb_order_items').delete().eq('id',it.id);
      if(dErr){toast('Delete failed: '+dErr.message,'error');return;}
    } else if(it._action==='add'){
      var{error:iErr}=await sb.from('salesweb_order_items').insert([{order_id:orderId,product_id:it.product_id||null,product_name:it.product_name,unit_price:Number(it.unit_price)||0,quantity:Number(it.quantity)||0,subtotal:sub}]);
      if(iErr){toast('Insert failed: '+iErr.message,'error');return;}
    } else if(it._action==='update'&&it.id){
      var{error:uErr}=await sb.from('salesweb_order_items').update({product_name:it.product_name,unit_price:Number(it.unit_price)||0,quantity:Number(it.quantity)||0,subtotal:sub}).eq('id',it.id);
      if(uErr){toast('Update failed: '+uErr.message,'error');return;}
    }
  }
  // Recalculate total via the shared helper — preserves the single
  // discount_amount / coupon_discount slots, every stacked adjustment, and
  // points_discount_rm in one place so editing items can never silently
  // wipe a discount.
  var{data:freshItems}=await sb.from('salesweb_order_items').select('subtotal').eq('order_id',orderId);
  var subtotal=(freshItems||[]).reduce(function(s,r){return s+(Number(r.subtotal)||0);},0);
  var{data:order}=await sb.from('salesweb_customer_orders').select('status').eq('id',orderId).single();
  var total=await _recomputeOrderTotal(orderId);
  // Log to timeline
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:order?.status||'Updated',note:'Order items edited — new subtotal RM '+subtotal.toFixed(2)+', new total RM '+total.toFixed(2),changed_by:user}]);
  window._editItems=null;
  toast('Items saved');
  viewOrder(orderId);
}

// ═══════════════════════════════════════
//  CREDIT INVOICE UPLOAD (from order modal monthly breakdown)
// ═══════════════════════════════════════
async function openInvoiceUploadModalForMonth(orderId,period){
  // Pull the trigger order's customer_id + customer_name, then aggregate all
  // of that customer's credit orders with uninvoiced collections in this
  // period so the invoice covers the whole month, not just this one order.
  var{data:trig}=await sb.from('salesweb_customer_orders').select('customer_id,customer_name').eq('id',orderId).single();
  if(!trig||!trig.customer_id){toast('Order has no customer_id','error');return;}

  var{data:custOrders}=await sb.from('salesweb_customer_orders').select('id').eq('customer_id',trig.customer_id).eq('payment_terms','credit').is('credit_invoice_id',null);
  var custOrderIds=(custOrders||[]).map(function(o){return o.id;});
  // Find which of those have collections inside the chosen period
  var matchingIds=[];var totalQty=0;
  if(custOrderIds.length){
    var{data:colls}=await sb.from('salesweb_order_collections').select('order_id,collected_qty,collected_at').in('order_id',custOrderIds);
    (colls||[]).forEach(function(c){
      if(!c.collected_at)return;
      if(String(c.collected_at).slice(0,7)!==period)return;
      if(matchingIds.indexOf(c.order_id)<0)matchingIds.push(c.order_id);
      totalQty+=(c.collected_qty||0);
    });
    // Legacy fallback: orders with single collected_at on the row itself
    if(!colls||!colls.length){
      var{data:legacy}=await sb.from('salesweb_customer_orders').select('id,collected_qty,collected_at').in('id',custOrderIds);
      (legacy||[]).forEach(function(o){
        if(!o.collected_at)return;
        if(String(o.collected_at).slice(0,7)!==period)return;
        if(matchingIds.indexOf(o.id)<0)matchingIds.push(o.id);
        totalQty+=(o.collected_qty||0);
      });
    }
  }
  if(!matchingIds.length){
    // Trigger order itself wasn't matched above (no collections recorded). Fall
    // back to including just it so the admin can still issue something.
    matchingIds=[orderId];
  }

  document.getElementById('miu-customer-id').value=trig.customer_id;
  document.getElementById('miu-period').value=period;
  document.getElementById('miu-trigger-order-id').value=orderId;
  window._miuOrderIds=matchingIds;
  document.getElementById('miu-customer-name').textContent=trig.customer_name||'—';
  var parts=period.split('-');
  document.getElementById('miu-period-label').textContent=new Date(+parts[0],+parts[1]-1,1).toLocaleString('en-MY',{month:'short',year:'numeric'})+' ('+period+')';
  document.getElementById('miu-summary').textContent=matchingIds.length+' order'+(matchingIds.length===1?'':'s')+' · '+totalQty.toLocaleString()+' qty';
  document.getElementById('miu-invoice-no').value='';
  document.getElementById('miu-file').value='';
  document.getElementById('miu-due').value='';
  document.getElementById('miu-notes').value='';
  document.getElementById('miu-error').textContent='';
  openModal('modal-invoice-upload');
}

async function submitInvoiceUpload(){
  var err=document.getElementById('miu-error');err.textContent='';
  var custId=document.getElementById('miu-customer-id').value;
  var period=document.getElementById('miu-period').value;
  var triggerOrderId=document.getElementById('miu-trigger-order-id').value;
  var orderIds=window._miuOrderIds||[];
  var invNo=document.getElementById('miu-invoice-no').value.trim();
  var due=document.getElementById('miu-due').value||null;
  var notes=document.getElementById('miu-notes').value.trim()||null;
  var fileInput=document.getElementById('miu-file');

  if(!invNo){err.textContent='Invoice number is required.';return;}
  if(!fileInput.files||!fileInput.files[0]){err.textContent='Pick a PDF or image.';return;}
  if(!orderIds.length){err.textContent='No orders to invoice.';return;}

  var btn=document.getElementById('miu-submit');btn.disabled=true;btn.textContent='Uploading…';
  try{
    var file=fileInput.files[0];
    var safeInv=invNo.replace(/[^A-Za-z0-9_-]/g,'_');
    var ext=(file.name.split('.').pop()||'pdf').toLowerCase();
    var path='invoices/'+custId.substring(0,8)+'_'+period+'_'+safeInv+'_'+Date.now()+'.'+ext;
    var{error:upErr}=await sb.storage.from('order-attachments').upload(path,file,{contentType:file.type,upsert:true});
    if(upErr)throw upErr;
    var{data:urlData}=sb.storage.from('order-attachments').getPublicUrl(path);
    var fileUrl=urlData?.publicUrl||'';

    var session=await sb.auth.getSession();
    var uid=session?.data?.session?.user?.id||null;
    var uemail=session?.data?.session?.user?.email||'admin';

    // Compute total qty + total amount from the matching collections (used for
    // invoice header — actual line items aren't tracked per invoice here).
    var{data:colls}=await sb.from('salesweb_order_collections').select('order_id,collected_qty,collected_at').in('order_id',orderIds);
    var totalQty=0;
    (colls||[]).forEach(function(c){if(c.collected_at&&String(c.collected_at).slice(0,7)===period)totalQty+=(c.collected_qty||0);});
    // Sum amount from orders' totals (proportional fallback)
    var{data:ords}=await sb.from('salesweb_customer_orders').select('id,total,collected_qty').in('id',orderIds);
    var totalAmt=(ords||[]).reduce(function(s,o){return s+(o.total||0);},0);

    var{data:inv,error:invErr}=await sb.from('salesweb_credit_invoices').insert([{
      customer_id:custId,billing_period:period,invoice_number:invNo,
      total_qty:totalQty,total_amount:Number(totalAmt.toFixed(2)),
      status:'issued',invoice_file_url:fileUrl,due_date:due,
      issued_by:uid,notes:notes
    }]).select().single();
    if(invErr)throw invErr;

    var nowIso=new Date().toISOString();
    await sb.from('salesweb_customer_orders').update({
      credit_invoice_id:inv.id,credit_billed_at:nowIso,credit_billing_period:period,updated_at:nowIso
    }).in('id',orderIds);

    // Fan-out: attachment + timeline per affected order
    var attRows=orderIds.map(function(oid){return{order_id:oid,file_name:'Invoice '+invNo+'.'+ext,file_url:fileUrl,file_type:file.type||'application/pdf',uploaded_by:uemail};});
    await sb.from('salesweb_order_attachments').insert(attRows);
    var tlRows=orderIds.map(function(oid){return{order_id:oid,status:'Invoiced',note:'Invoice '+invNo+' issued for '+period,changed_by:uemail};});
    await sb.from('salesweb_order_timeline').insert(tlRows);

    closeModal('modal-invoice-upload');
    toast('Invoice issued — '+orderIds.length+' order(s) linked');
    viewOrder(triggerOrderId);
  }catch(e){
    console.error('[Invoice upload]',e);
    err.textContent=(e?.message||'Upload failed')+'';
  }finally{
    btn.disabled=false;btn.textContent='Upload & Issue Invoice';
  }
}

// ═══════════════════════════════════════════════════════════════════
//  ADD ORDER (admin-created)
//  ─ Opens a modal, lets the admin pick an existing customer or fill in
//    walk-in details, then add line items either by selecting a
//    published product (price auto-fills) or by typing a custom row.
//  ─ Persists into the same tables as the customer-portal checkout
//    (salesweb_customer_orders + salesweb_order_items + timeline),
//    so the order shows up in the existing dashboard with no special
//    casing downstream.
// ═══════════════════════════════════════════════════════════════════
var _newOrderProducts=[];
var _newOrderItems=[];
var _newOrderSelectedCustomerId=null;   // null = walk-in / create new on save
var _newOrderCustSearchTimer=null;
var _newOrderCustResultsCache={};

function genOrderNumberAdmin(){
  // 5 random alphanumeric chars (no I,O) + 1 random 0–9 digit. Used only
  // as a fallback if next_order_number() RPC fails.
  var chars='ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  var out='';
  for(var i=0;i<5;i++){ out += chars.charAt(Math.floor(Math.random()*chars.length)); }
  return out + Math.floor(Math.random()*10).toString();
}

async function openNewOrder(){
  _newOrderItems=[];
  _newOrderSelectedCustomerId=null;
  _newOrderCustResultsCache={};

  // Reset form fields
  document.getElementById('no-cust-name').value='';
  document.getElementById('no-cust-phone').value='';
  document.getElementById('no-cust-email').value='';
  document.getElementById('no-cust-addr').value='Self Collection — MJM Nursery Office, Niah Land District, Miri, 98000, Sarawak';
  document.getElementById('no-status').value='Pending Payment';
  document.getElementById('no-terms').value='cash';
  document.getElementById('no-internal-note').value='';
  document.getElementById('no-discount').value='0';
  resetNewOrderBilling();
  document.getElementById('no-cust-results').style.display='none';
  document.getElementById('no-cust-status').style.display='none';
  document.getElementById('no-submit').disabled=false;
  document.getElementById('no-submit').textContent='Create Order';
  openModal('modal-new-order');

  // Load published products in the background
  sb.from('salesweb_products').select('id,name,price,stock_qty,sell_month,sell_year').eq('is_published',true).order('name').then(function(r){
    _newOrderProducts=(r&&r.data)||[];
    var statusEl=document.getElementById('no-products-status');
    if(!_newOrderProducts.length){
      statusEl.textContent='⚠️ No published products — use the Custom row option.';
    } else {
      statusEl.textContent=_newOrderProducts.length+' published product'+(_newOrderProducts.length===1?'':'s')+' available · prices auto-fill on select.';
    }
    addNewOrderItem();
  });
}

// ── CUSTOMER NAME SEARCH (debounced) ─────────────────────────────
// Typing in the name field searches shared_profiles for matching
// customers. Picking one links the order. Typing a name that doesn't
// match anything signals that submitNewOrder() should create a new
// customer profile.
function onNewOrderCustNameInput(){
  // Any edit invalidates a previous selection — the admin is either
  // searching for a different customer or typing in a new name.
  _newOrderSelectedCustomerId=null;
  updateNewOrderCustStatus();

  var q=document.getElementById('no-cust-name').value.trim();
  if(_newOrderCustSearchTimer) clearTimeout(_newOrderCustSearchTimer);
  if(q.length<2){
    document.getElementById('no-cust-results').style.display='none';
    return;
  }
  _newOrderCustSearchTimer=setTimeout(function(){ searchCustomersForNewOrder(q); },200);
}

function onNewOrderCustFieldEdit(){
  // Touching the phone/email fields after picking a customer breaks
  // the link — the admin is likely typing new details.
  if(_newOrderSelectedCustomerId){
    _newOrderSelectedCustomerId=null;
  }
  updateNewOrderCustStatus();
}

async function searchCustomersForNewOrder(q){
  // Escape % and _ so the ilike is taken literally.
  var like=q.replace(/[%_\\]/g,function(c){return '\\'+c;});
  var ors=[
    'full_name.ilike.%'+like+'%',
    'email.ilike.%'+like+'%',
    'phone.ilike.%'+like+'%',
  ].join(',');
  var{data}=await sb.from('shared_profiles')
    .select('id,full_name,email,phone,user_type,role')
    .or(ors)
    .limit(25);
  var results=(data||[]).filter(function(c){
    return (c.user_type==='customer' || c.role==='customer')
        && (c.user_type!=='system')
        && !isOperationStaff(c.permissions);
  }).slice(0,8);

  _newOrderCustResultsCache={};
  results.forEach(function(c){ _newOrderCustResultsCache[c.id]=c; });

  var el=document.getElementById('no-cust-results');
  if(!results.length){
    el.innerHTML='<div style="padding:.6rem .8rem;font-size:11px;color:var(--ink4);">No match — a profile will be created on save.</div>';
    el.style.display='block';
    updateNewOrderCustStatus();
    return;
  }
  el.innerHTML=results.map(function(c){
    return '<div onmousedown="selectNewOrderCustomer(\''+esc(c.id)+'\')" style="padding:.5rem .7rem;cursor:pointer;border-bottom:1px solid var(--rule);font-size:12px;" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'#fff\'">'+
      '<div style="font-weight:600;">'+esc(c.full_name||'(no name)')+'</div>'+
      '<div style="color:var(--ink4);font-size:11px;">'+esc(c.email||'')+(c.phone?'  ·  '+esc(c.phone):'')+'</div>'+
    '</div>';
  }).join('');
  el.style.display='block';
}

function selectNewOrderCustomer(id){
  var c=_newOrderCustResultsCache[id];
  if(!c) return;
  _newOrderSelectedCustomerId=id;
  document.getElementById('no-cust-name').value=c.full_name||'';
  document.getElementById('no-cust-email').value=c.email||'';
  document.getElementById('no-cust-phone').value=c.phone||'';
  document.getElementById('no-cust-results').style.display='none';
  updateNewOrderCustStatus();
  prefillNewOrderBilling(id);
}

// Pull the customer's most recent saved billing profile and populate the
// billing fields — mirrors the customer checkout offering saved billing.
// Only name / IC / reg / TIN / MPOB are stored on the profile; address
// fields are per-order and left for the admin to fill.
async function prefillNewOrderBilling(userId){
  try{
    var{data}=await sb.from('salesweb_billing_info').select('*').eq('user_id',userId).order('created_at',{ascending:false}).limit(1);
    if(!data || !data.length) return;
    var b=data[0];
    if(b.type==='company'){
      switchNewOrderBilling('company');
      document.getElementById('no-bill-coname').value=b.name||'';
      document.getElementById('no-bill-coreg').value=b.company_reg||'';
      document.getElementById('no-bill-cotin').value=b.tin||'';
      document.getElementById('no-bill-compob').value=b.mpob_license||'';
    } else {
      switchNewOrderBilling('personal');
      document.getElementById('no-bill-name').value=b.name||'';
      document.getElementById('no-bill-ic').value=b.ic_number||'';
      document.getElementById('no-bill-tin').value=b.tin||'';
      document.getElementById('no-bill-mpob').value=b.mpob_license||'';
    }
  }catch(e){ /* billing prefill is best-effort */ }
}

function hideNewOrderCustResults(){
  document.getElementById('no-cust-results').style.display='none';
}

// Billing tab toggle for the New Order modal (mirrors the customer checkout).
var _newOrderBillingType = 'personal';
function switchNewOrderBilling(type){
  _newOrderBillingType = type;
  var isP = type === 'personal';
  document.getElementById('no-bill-personal').style.display = isP ? 'grid' : 'none';
  document.getElementById('no-bill-company').style.display  = isP ? 'none' : 'grid';
  document.getElementById('no-bill-tab-personal').className = 'btn btn-sm ' + (isP ? 'btn-primary' : 'btn-outline');
  document.getElementById('no-bill-tab-company').className  = 'btn btn-sm ' + (isP ? 'btn-outline' : 'btn-primary');
}
function resetNewOrderBilling(){
  ['no-bill-name','no-bill-ic','no-bill-tin','no-bill-addr','no-bill-city','no-bill-postcode','no-bill-mpob',
   'no-bill-coname','no-bill-coreg','no-bill-cotin','no-bill-coaddr','no-bill-cocity','no-bill-copostcode','no-bill-compob']
    .forEach(function(idv){ var el=document.getElementById(idv); if(el) el.value=''; });
  document.getElementById('no-bill-country').value='Malaysia';
  document.getElementById('no-bill-state').value='Sarawak';
  document.getElementById('no-bill-cocountry').value='Malaysia';
  document.getElementById('no-bill-costate').value='Sarawak';
  switchNewOrderBilling('personal');
}

function updateNewOrderCustStatus(){
  var el=document.getElementById('no-cust-status');
  var name=(document.getElementById('no-cust-name').value||'').trim();
  if(_newOrderSelectedCustomerId){
    el.textContent='✓ Linked to existing customer';
    el.style.color='#065f46';
    el.style.display='block';
  } else if(name.length>=2){
    el.textContent='+ New customer profile will be created on save';
    el.style.color='#92400e';
    el.style.display='block';
  } else {
    el.style.display='none';
  }
}

function addNewOrderItem(){
  _newOrderItems.push({product_id:'',product_name:'',unit_price:0,quantity:1,line_total:0});
  renderNewOrderItems();
}
function removeNewOrderItem(idx){
  _newOrderItems.splice(idx,1);
  if(!_newOrderItems.length) addNewOrderItem();
  renderNewOrderItems();
  recalcNewOrderTotal();
}
function onNewOrderProductSelect(idx,value){
  var it=_newOrderItems[idx];
  if(!it) return;
  if(value==='__custom__'){
    it.product_id='';
    it.product_name='';
  } else if(value){
    var p=_newOrderProducts.find(function(x){return x.id===value;});
    if(p){
      it.product_id=p.id;
      it.product_name=p.name;
      it.unit_price=Number(p.price)||0;
    }
  } else {
    it.product_id='';
    it.product_name='';
  }
  it.line_total=(Number(it.quantity)||0)*(Number(it.unit_price)||0);
  renderNewOrderItems();
  recalcNewOrderTotal();
}
function updateNewOrderItem(idx,field,value){
  var it=_newOrderItems[idx];
  if(!it) return;
  if(field==='quantity')        it.quantity=parseInt(value)||0;
  else if(field==='unit_price') it.unit_price=parseFloat(value)||0;
  else                          it[field]=value;
  it.line_total=(Number(it.quantity)||0)*(Number(it.unit_price)||0);
  // Patch only the line-total cell, keep input focus
  var cell=document.getElementById('no-line-total-'+idx);
  if(cell) cell.textContent='RM '+fmtMYR(it.line_total);
  recalcNewOrderTotal();
}

function renderNewOrderItems(){
  var container=document.getElementById('no-items-container');
  var html='<table class="data-table" style="font-size:12px;"><thead><tr><th style="width:24px;"></th><th style="width:38%;">Product</th><th style="width:90px;text-align:right;">Qty</th><th style="width:100px;text-align:right;">Unit Price (RM)</th><th style="width:100px;text-align:right;">Amount (RM)</th><th style="width:40px;"></th></tr></thead><tbody>';
  _newOrderItems.forEach(function(it,idx){
    // Product cell — dropdown + name field
    var opts='<option value="">— Select product —</option>';
    _newOrderProducts.forEach(function(p){
      var sel=(it.product_id===p.id)?' selected':'';
      var hint=' (RM '+fmtMYR(p.price)+(p.stock_qty!=null?' · '+p.stock_qty+' avail':'')+')';
      opts+='<option value="'+esc(p.id)+'"'+sel+'>'+esc(p.name)+hint+'</option>';
    });
    var isCustom=!it.product_id&&(it.product_name||'').length>0;
    opts+='<option value="__custom__"'+(isCustom?' selected':'')+'>— Custom (free text) —</option>';

    var nameInput=it.product_id
      ? '<input class="form-input" type="text" value="'+esc(it.product_name||'')+'" readonly style="background:#f8fafc;color:#475569;font-size:12px;padding:4px 8px;margin-top:.3rem;">'
      : '<input class="form-input" type="text" value="'+esc(it.product_name||'')+'" placeholder="Item name" oninput="updateNewOrderItem('+idx+',\'product_name\',this.value)" style="font-size:12px;padding:4px 8px;margin-top:.3rem;">';

    // Drag is restricted to the handle cell so the rest of the row remains
    // freely interactive (text selection, focus, etc. inside the inputs).
    // The row is just the drop target.
    html+='<tr ondragover="noDragOver(event)" ondrop="noDrop(event,'+idx+')" data-no-idx="'+idx+'">'+
      '<td draggable="true" ondragstart="noDragStart(event,'+idx+')" ondragend="noDragEnd(event)" style="text-align:center;color:#94a3b8;user-select:none;cursor:grab;width:24px;" title="Drag to reorder">⋮⋮</td>'+
      '<td><select class="form-input" onchange="onNewOrderProductSelect('+idx+',this.value)" style="font-size:12px;padding:4px 8px;">'+opts+'</select>'+nameInput+'</td>'+
      '<td style="text-align:right;"><input class="form-input" type="number" min="0" step="1" value="'+(it.quantity||0)+'" oninput="updateNewOrderItem('+idx+',\'quantity\',this.value)" style="text-align:right;font-size:12px;padding:4px 8px;"></td>'+
      '<td style="text-align:right;"><input class="form-input" type="number" min="0" step="0.01" value="'+(it.unit_price||0)+'" oninput="updateNewOrderItem('+idx+',\'unit_price\',this.value)" style="text-align:right;font-size:12px;padding:4px 8px;"></td>'+
      '<td style="text-align:right;font-weight:600;" id="no-line-total-'+idx+'">RM '+fmtMYR(it.line_total)+'</td>'+
      '<td style="text-align:center;"><button class="btn btn-outline btn-sm" onclick="removeNewOrderItem('+idx+')" style="color:var(--red);font-size:11px;padding:2px 6px;">✕</button></td>'+
    '</tr>';
  });
  html+='</tbody></table>';
  container.innerHTML=html;
}

// ── New Order item rows: drag-to-reorder ──
var _newOrderDragIdx=null;
function noDragStart(e,idx){
  _newOrderDragIdx=idx;
  try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain',String(idx)); }catch(err){}
  var tr=e.currentTarget; if(tr) tr.style.opacity='0.5';
}
function noDragOver(e){
  e.preventDefault();
  try{ e.dataTransfer.dropEffect='move'; }catch(err){}
}
function noDragEnd(e){
  var tr=e.currentTarget; if(tr) tr.style.opacity='';
  _newOrderDragIdx=null;
}
function noDrop(e,toIdx){
  e.preventDefault();
  var from=_newOrderDragIdx;
  if(from==null){ try{ from=parseInt(e.dataTransfer.getData('text/plain'),10); }catch(err){} }
  _newOrderDragIdx=null;
  if(typeof from!=='number'||isNaN(from)||from===toIdx) return;
  if(from<0||from>=_newOrderItems.length||toIdx<0||toIdx>=_newOrderItems.length) return;
  var moved=_newOrderItems.splice(from,1)[0];
  _newOrderItems.splice(toIdx,0,moved);
  renderNewOrderItems();
  recalcNewOrderTotal();
}

function recalcNewOrderTotal(){
  var subtotal=_newOrderItems.reduce(function(s,it){return s+(Number(it.quantity)||0)*(Number(it.unit_price)||0);},0);
  var discount=parseFloat(document.getElementById('no-discount').value)||0;
  var total=Math.max(0,subtotal-discount);
  document.getElementById('no-subtotal').textContent='RM '+fmtMYR(subtotal);
  document.getElementById('no-total').textContent='RM '+fmtMYR(total);
}

async function submitNewOrder(){
  var name=document.getElementById('no-cust-name').value.trim();
  var phone=document.getElementById('no-cust-phone').value.trim();
  var email=document.getElementById('no-cust-email').value.trim();
  var addr=document.getElementById('no-cust-addr').value.trim();
  var custId=_newOrderSelectedCustomerId||null;
  var status=document.getElementById('no-status').value;
  var terms=document.getElementById('no-terms').value;
  // Orders entered through the admin portal are always tagged Admin Panel.
  // Google / WhatsApp tagging happens on the customer-facing storefront
  // via URL utm_source / referrer detection at session start.
  var channel='admin_panel';
  var internalNote=document.getElementById('no-internal-note').value.trim();
  var discount=parseFloat(document.getElementById('no-discount').value)||0;

  // Validation
  if(!name){toast('Customer name is required','error');return;}
  var validItems=_newOrderItems.filter(function(it){
    return (it.product_name||'').trim() && (Number(it.quantity)||0)>0 && (Number(it.unit_price)||0)>=0;
  });
  if(!validItems.length){toast('Add at least one item with quantity > 0','error');return;}

  var subtotal=validItems.reduce(function(s,it){return s+(Number(it.quantity)||0)*(Number(it.unit_price)||0);},0);
  var total=Math.max(0,Math.round((subtotal-discount)*100)/100);

  // Zero-total order = nothing to pay → auto-mark Paid (the existing
  // paid-at-creation branch below fires AL + confirmation email so the
  // customer can still collect; points credit is 0 × rate = 0).
  if(total <= 0) status='Paid';

  // ── Billing / E-Invoice (same shape as the customer checkout) ──
  // billing_name + billing_tax_id are stored as columns; the rest of the
  // billing detail is appended to customer_remark, matching payment.html.
  var billingType = _newOrderBillingType || 'personal';
  var billingName='', billingTin='', billingMpob='', billingIc='', billingReg='', billingAddr='';
  if(billingType === 'personal'){
    billingName = document.getElementById('no-bill-name').value.trim();
    billingIc   = document.getElementById('no-bill-ic').value.trim();
    billingTin  = document.getElementById('no-bill-tin').value.trim();
    billingMpob = document.getElementById('no-bill-mpob').value.trim();
    billingAddr = [document.getElementById('no-bill-addr').value.trim(),document.getElementById('no-bill-city').value.trim(),document.getElementById('no-bill-postcode').value.trim(),document.getElementById('no-bill-state').value.trim(),document.getElementById('no-bill-country').value.trim()].filter(Boolean).join(', ');
  } else {
    billingName = document.getElementById('no-bill-coname').value.trim();
    billingReg  = document.getElementById('no-bill-coreg').value.trim();
    billingTin  = document.getElementById('no-bill-cotin').value.trim();
    billingMpob = document.getElementById('no-bill-compob').value.trim();
    billingAddr = [document.getElementById('no-bill-coaddr').value.trim(),document.getElementById('no-bill-cocity').value.trim(),document.getElementById('no-bill-copostcode').value.trim(),document.getElementById('no-bill-costate').value.trim(),document.getElementById('no-bill-cocountry').value.trim()].filter(Boolean).join(', ');
  }

  var remarkParts=['Admin-created order'];
  if(phone) remarkParts.push('Phone: '+phone);
  if(billingAddr) remarkParts.push('Billing Addr: '+billingAddr);
  if(billingIc)   remarkParts.push('IC: '+billingIc);
  if(billingReg)  remarkParts.push('Reg: '+billingReg);
  if(billingMpob) remarkParts.push('MPOB: '+billingMpob);

  var btn=document.getElementById('no-submit');
  btn.disabled=true; btn.textContent='Creating…';

  // If no existing customer is linked, try to find one by email; if none
  // exists yet, create a new customer profile via auth.signUp so the
  // order is properly linked to a `shared_profiles` row for future
  // lookups / loyalty / credit terms.
  if(!custId){
    if(email){
      var{data:byEmail}=await sb.from('shared_profiles')
        .select('id').ilike('email',email).limit(1);
      if(byEmail && byEmail.length){
        custId=byEmail[0].id;
      }
    }
    if(!custId){
      try {
        // Placeholder email when none is supplied. The customer can
        // never actually log in with this address — it just satisfies
        // the auth.users requirement for shared_profiles.id.
        var signupEmail = email || ('walkin-' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '@admin.mjmnursery.local');
        // Strong random password — customer doesn't need to know it.
        var signupPw = (crypto && crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2))) + '!Aa1';
        // Isolated client so this signUp doesn't clobber the admin's
        // session (persistSession:false + private storageKey).
        var tempSb = supabase.createClient(SB_URL, SB_KEY, {
          auth: { persistSession:false, autoRefreshToken:false, storageKey:'admin-new-order-'+Date.now() }
        });
        var{data:signUpData,error:signUpErr} = await tempSb.auth.signUp({
          email: signupEmail,
          password: signupPw,
          options: { data: { full_name: name, user_type: 'customer' } }
        });
        if(signUpErr){
          if(/already|exists|registered/i.test(signUpErr.message||'')){
            // Existing auth user — look the profile up by email
            var{data:dup}=await sb.from('shared_profiles').select('id').ilike('email',signupEmail).limit(1);
            if(dup && dup.length) custId=dup[0].id;
          }
          if(!custId){
            console.warn('[Add Order] profile creation failed:', signUpErr.message);
          }
        } else if(signUpData && signUpData.user){
          custId = signUpData.user.id;
          // Upsert the profile row with the customer-facing fields the
          // dashboard expects (name, phone, type, role). Store the REAL
          // email — leave it NULL for walk-ins so the customer list shows
          // blank rather than the auth placeholder.
          await sb.from('shared_profiles').upsert({
            id: custId,
            email: email || null,
            full_name: name,
            phone: phone || null,
            user_type: 'customer',
            role: 'customer',
          },{ onConflict:'id' });
        }
      } catch (e) {
        console.warn('[Add Order] signUp threw:', e);
      }
    } else {
      // Found by email — fill in any missing profile fields so the
      // customer view shows the new info too.
      var patch = {};
      if(name)  patch.full_name = name;
      if(phone) patch.phone = phone;
      if(Object.keys(patch).length){
        sb.from('shared_profiles').update(patch).eq('id',custId).then(function(){});
      }
    }
  }

  // Generate order number — sequential year-prefixed (atomic DB function),
  // random fallback if the function isn't installed. Retry guards duplicates.
  var order=null,orderErr=null,orderNum='';
  for(var attempt=0;attempt<5;attempt++){
    try{ var _nr=await sb.rpc('next_order_number'); orderNum=(_nr&&_nr.data)?_nr.data:genOrderNumberAdmin(); }
    catch(e){ orderNum=genOrderNumberAdmin(); }
    var payload={
      order_number:orderNum,
      customer_id:custId||null,
      customer_name:name,
      customer_email:email||null,
      status:status,
      total:total,
      channel:channel,
      shipping_address:addr||null,
      customer_remark:remarkParts.join(' | '),
      billing_name:billingName||name,
      billing_tax_id:billingTin||null,
      payment_terms:terms,
      discount_amount:discount,
      points_redeemed:0,
      points_discount_rm:0,
    };
    if(internalNote) payload.internal_notes=internalNote;
    var r=await sb.from('salesweb_customer_orders').insert([payload]).select().single();
    order=r.data; orderErr=r.error;
    if(!orderErr) break;
    if(orderErr && !/duplicate|unique/i.test(orderErr.message||'')) break;
  }
  if(orderErr || !order){
    toast('Error: '+(orderErr?.message||'Could not create order'),'error');
    btn.disabled=false; btn.textContent='Create Order';
    return;
  }

  // Insert items
  var itemRows=validItems.map(function(it){
    var qty=Number(it.quantity)||0, up=Number(it.unit_price)||0;
    return {
      order_id:order.id,
      product_id:it.product_id||null,
      product_name:it.product_name,
      quantity:qty,
      unit_price:up,
      subtotal:Math.round(qty*up*100)/100,
    };
  });
  var ir=await sb.from('salesweb_order_items').insert(itemRows);
  if(ir.error){
    toast('Items error: '+ir.error.message,'error');
    btn.disabled=false; btn.textContent='Create Order';
    return;
  }

  // Timeline — audit trail
  var{data:{user}}=await sb.auth.getUser();
  var by=user?.email||'admin';
  sb.from('salesweb_order_timeline').insert([{
    order_id:order.id, status:status,
    note:'Order created via admin panel ('+terms+' · RM '+total.toFixed(2)+')',
    changed_by:by
  }]).then(function(){});

  // Credit-term orders can collect immediately (AL issued + confirmation
  // email) but DO NOT earn loyalty points yet — points are credited only
  // when the monthly credit invoice is marked paid (see markCreditInvoicePaid).
  if(terms === 'credit'){
    try{
      await createALFromOrder(order.id, order);
      sb.functions.invoke('send-order-email', { body: { order_id: order.id } })
        .catch(function(err){ console.error('[email] invoke threw:', err); });
    }catch(e){ console.warn('[Add Order] credit side effects failed:', e); }
  }
  // Cash orders created already in a settled state (admin set status to
  // Paid / Ready for Collection / Completed at creation): fire the Paid
  // side effects since no status-change ever runs for these.
  else if(SETTLED_STATUSES[status]){
    try{
      await issuePoints(order.id, total);
      await createALFromOrder(order.id, order);
      sb.functions.invoke('send-order-email', { body: { order_id: order.id } })
        .catch(function(err){ console.error('[email] invoke threw:', err); });
    }catch(e){ console.warn('[Add Order] paid-at-creation side effects failed:', e); }
  }

  closeModal('modal-new-order');
  toast('Order #'+orderNum+' created'+(terms==='credit'?' · AL issued for credit collection':''));
  loadOrders();
}

// ═══════════════════════════════════════
//  PROFORMA INVOICE
// ═══════════════════════════════════════
// Renders a print-ready Proforma Invoice inside #modal-proforma. The admin
// can preview, print to PDF, or email a copy to the customer via the same
// send-order-email edge function the storefront uses. The edge function
// recognises body.type === 'proforma' and switches the template.

async function openProformaInvoice(orderId){
  var{data:order}=await sb.from('salesweb_customer_orders').select('*').eq('id',orderId).single();
  if(!order){toast('Order not found','error');return;}
  var{data:items}=await sb.from('salesweb_order_items').select('*').eq('order_id',orderId);
  items=items||[];

  // Pull bank/payment details out of salesweb_app_settings so they can be
  // rendered as the "Payment Instructions" block at the bottom of the
  // proforma. Same row admin writes from admin.html → Settings → Payment.
  var pd = { bank_name:'', account_name:'', account_number:'', duitnow_qr_url:'' };
  try{
    var{data:pdRow}=await sb.from('salesweb_app_settings').select('value').eq('key','payment_details').maybeSingle();
    if(pdRow && pdRow.value){
      var parsed = typeof pdRow.value === 'string' ? JSON.parse(pdRow.value) : pdRow.value;
      pd = Object.assign(pd, parsed||{});
    }
  }catch(e){ /* leave defaults — bank block just won't render */ }

  // Parse the billing address out of customer_remark — same logic as viewOrder.
  var billAddr='', billReg='', billIc='', billMpob='';
  if(order.customer_remark){
    String(order.customer_remark).split(' | ').forEach(function(p){
      p=p.trim();
      if      (p.indexOf('Billing Addr: ')===0) billAddr=p.substring(14);
      else if (p.indexOf('Reg: ')===0)          billReg =p.substring(5);
      else if (p.indexOf('IC: ')===0)           billIc  =p.substring(4);
      else if (p.indexOf('MPOB: ')===0)         billMpob=p.substring(6);
    });
  }
  var addr = billAddr || order.shipping_address || '';
  var subtotal = items.reduce(function(s,it){return s+(it.subtotal||0);},0);
  var orderNum = order.order_number || ('#'+String(order.id||'').substring(0,8).toUpperCase());
  if(orderNum.charAt(0)!=='#') orderNum='#'+orderNum;

  var html='';
  html+='<div id="proforma-doc" style="background:#fff;padding:1.5rem;border-radius:8px;font-family:system-ui,sans-serif;color:#111;">';
  html+='<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;border-bottom:2px solid #111;padding-bottom:.6rem;">';
  html+='<div><div style="font-size:18px;font-weight:800;">MJM Nursery</div><div style="font-size:12px;color:#333;font-weight:600;">MEGA JUTAMAS SDN BHD</div><div style="font-size:11px;color:#555;">Lot 1180, Bangunan Bei, Krokop 2, Miri, Sarawak, Malaysia</div></div>';
  html+='<div style="text-align:right;"><div style="font-size:20px;font-weight:800;letter-spacing:.04em;">PROFORMA INVOICE</div><div style="font-size:12px;color:#555;margin-top:.2rem;">Order '+esc(orderNum)+'</div><div style="font-size:11px;color:#555;">Date: '+esc(fmtDate(order.created_at))+'</div></div>';
  html+='</div>';

  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;font-size:12px;">';
  html+='<div><div style="font-weight:700;margin-bottom:.2rem;">Bill To</div>';
  html+='<div>'+esc(order.billing_name||order.customer_name||'—')+'</div>';
  if(billReg)  html+='<div>Reg No: '+esc(billReg)+'</div>';
  if(billIc)   html+='<div>IC: '+esc(billIc)+'</div>';
  if(order.billing_tax_id) html+='<div>TIN: '+esc(order.billing_tax_id)+'</div>';
  if(billMpob) html+='<div>MPOB: '+esc(billMpob)+'</div>';
  if(addr)     html+='<div style="white-space:pre-wrap;margin-top:.2rem;">'+esc(addr)+'</div>';
  if(order.customer_email) html+='<div style="margin-top:.2rem;color:#555;">'+esc(order.customer_email)+'</div>';
  html+='</div>';
  html+='<div style="text-align:right;"><div style="font-weight:700;margin-bottom:.2rem;">Payment</div>';
  html+='<div>Terms: '+(order.payment_terms==='credit'?'Credit':'Cash on Collection')+'</div>';
  html+='<div style="color:#555;">This is a proforma quote &mdash; payment is requested before delivery / collection.</div>';
  html+='</div></div>';

  html+='<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:1rem;">';
  html+='<thead><tr style="background:#f4f4f5;"><th style="text-align:left;padding:.5rem;border-bottom:1px solid #111;">Product</th><th style="text-align:right;padding:.5rem;border-bottom:1px solid #111;">Unit Price</th><th style="text-align:right;padding:.5rem;border-bottom:1px solid #111;">Qty</th><th style="text-align:right;padding:.5rem;border-bottom:1px solid #111;">Subtotal</th></tr></thead><tbody>';
  items.forEach(function(it){
    html+='<tr><td style="padding:.4rem .5rem;border-bottom:1px solid #eee;">'+esc(it.product_name||'—')+'</td>'+
      '<td style="text-align:right;padding:.4rem .5rem;border-bottom:1px solid #eee;">RM '+fmtMYR(it.unit_price)+'</td>'+
      '<td style="text-align:right;padding:.4rem .5rem;border-bottom:1px solid #eee;">'+it.quantity+'</td>'+
      '<td style="text-align:right;padding:.4rem .5rem;border-bottom:1px solid #eee;font-weight:600;">RM '+fmtMYR(it.subtotal)+'</td></tr>';
  });
  html+='</tbody></table>';

  html+='<div style="display:flex;justify-content:flex-end;margin-bottom:1rem;"><table style="font-size:12px;min-width:240px;">';
  html+='<tr><td style="padding:.2rem .5rem;">Subtotal</td><td style="padding:.2rem .5rem;text-align:right;">RM '+fmtMYR(subtotal)+'</td></tr>';
  if(order.discount_amount>0) html+='<tr><td style="padding:.2rem .5rem;color:#b91c1c;">Discount</td><td style="padding:.2rem .5rem;text-align:right;color:#b91c1c;">-RM '+fmtMYR(order.discount_amount)+'</td></tr>';
  if(order.coupon_code)       html+='<tr><td style="padding:.2rem .5rem;color:#b91c1c;">Coupon ('+esc(order.coupon_code)+')</td><td style="padding:.2rem .5rem;text-align:right;color:#b91c1c;">-RM '+fmtMYR(order.coupon_discount)+'</td></tr>';
  html+='<tr style="border-top:2px solid #111;"><td style="padding:.4rem .5rem;font-weight:800;font-size:14px;">Total Due</td><td style="padding:.4rem .5rem;text-align:right;font-weight:800;font-size:14px;">RM '+fmtMYR(order.total)+'</td></tr>';
  html+='</table></div>';

  // Bank / payment instructions block (only renders when at least one
  // payment-details field is filled in admin → Settings → Payment).
  var hasBank = pd.bank_name || pd.account_name || pd.account_number || pd.duitnow_qr_url;
  if(hasBank){
    html+='<div style="margin-top:1.25rem;padding:.85rem 1rem;background:#FFF8EB;border:1px solid #F2D58F;border-radius:8px;font-size:12px;color:#5C4308;line-height:1.7;">';
    html+='<div style="font-size:11px;font-weight:700;color:#8A6314;text-transform:uppercase;letter-spacing:.06em;margin-bottom:.4rem;">Payment Instructions</div>';
    if(pd.bank_name)      html+='<div><strong>Bank:</strong> '+esc(pd.bank_name)+'</div>';
    if(pd.account_name)   html+='<div><strong>Account Name:</strong> '+esc(pd.account_name)+'</div>';
    if(pd.account_number) html+='<div><strong>Account Number:</strong> '+esc(pd.account_number)+'</div>';
    if(pd.duitnow_qr_url) html+='<div style="margin-top:.4rem;"><img src="'+esc(pd.duitnow_qr_url)+'" alt="DuitNow QR" style="max-width:140px;border:1px solid #E2C76E;border-radius:6px;background:#fff;padding:4px;"></div>';
    html+='<div style="margin-top:.5rem;padding-top:.4rem;border-top:1px dashed #E2C76E;font-size:11px;">Please use <strong>Order '+esc(orderNum)+'</strong> as your payment reference.</div>';
    html+='</div>';
  }

  html+='<div style="font-size:11px;color:#555;margin-top:1.5rem;border-top:1px solid #ddd;padding-top:.5rem;">This proforma invoice is for quotation only. It does not constitute a tax invoice and no payment has been received. A formal tax invoice will follow once payment is confirmed.</div>';
  html+='</div>'; // /proforma-doc

  document.getElementById('proforma-title').textContent='Proforma Invoice — '+orderNum;
  document.getElementById('proforma-body').innerHTML=html;
  document.getElementById('proforma-send').onclick=function(){ sendProformaInvoice(orderId, order.customer_email||''); };
  document.getElementById('proforma-print').onclick=function(){
    var w=window.open('','_blank');
    if(!w){toast('Allow pop-ups to print','error');return;}
    w.document.write('<html><head><title>Proforma '+esc(orderNum)+'</title></head><body>'+document.getElementById('proforma-doc').outerHTML+'</body></html>');
    w.document.close();
    setTimeout(function(){w.print();}, 250);
  };
  openModal('modal-proforma');
}

async function sendProformaInvoice(orderId, defaultEmail){
  var email = prompt('Send proforma to email address:', defaultEmail||'');
  if(!email) return;
  email = String(email).trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast('Invalid email address','error'); return; }
  try{
    var session = await sb.auth.getSession();
    var token = session?.data?.session?.access_token || '';
    var url = SB_URL + '/functions/v1/send-order-email';
    var r = await fetch(url, {
      method:'POST',
      headers:{
        'Authorization': 'Bearer '+token,
        'Content-Type':'application/json',
      },
      body: JSON.stringify({ order_id: orderId, type:'proforma', to: email }),
    });
    if(!r.ok){
      var t = await r.text();
      toast('Send failed: '+(t||r.status),'error');
      return;
    }
    toast('Proforma invoice emailed to '+email);
  }catch(e){
    toast('Send failed: '+(e.message||'network error'),'error');
  }
}

// ═══════════════════════════════════════
//  PAYMENT LEDGER (multi-row amount_paid)
// ═══════════════════════════════════════
// Each row in salesweb_order_payments is one payment received. The
// trigger on that table keeps salesweb_customer_orders.amount_paid in
// sync as SUM(amount), so every other reader of that column (status
// badges, customer portal, send-order-email, etc.) sees a live value
// without needing any code changes.

function openAddPaymentModal(orderId, outstandingHint){
  document.getElementById('pay-order-id').value = orderId;
  // Default the date to today and pre-fill the amount with the outstanding
  // balance so single-payment-in-full is one click.
  var today = new Date().toISOString().slice(0,10);
  document.getElementById('pay-date').value = today;
  var amt = Number(outstandingHint || 0);
  document.getElementById('pay-amount').value = amt > 0 ? amt.toFixed(2) : '';
  document.getElementById('pay-note').value = '';
  document.getElementById('pay-file').value = '';
  openModal('modal-add-payment');
}

async function savePaymentEntry(){
  var orderId = document.getElementById('pay-order-id').value;
  var dateStr = document.getElementById('pay-date').value;
  var amtRaw  = document.getElementById('pay-amount').value;
  var noteRaw = document.getElementById('pay-note').value;
  var fileInp = document.getElementById('pay-file');

  if(!orderId){ toast('Missing order','error'); return; }
  var amt = parseFloat(amtRaw);
  if(!(amt > 0)){ toast('Amount must be greater than 0','error'); return; }
  // Build a stable ISO timestamp from the picked date — keeps the current
  // time-of-day so back-dated entries still order naturally.
  var paidAt = dateStr
    ? new Date(dateStr + 'T' + new Date().toTimeString().slice(0,8)).toISOString()
    : new Date().toISOString();

  // Optional attachment upload — reuses the existing order-attachments
  // bucket. The file is saved with a payment_<orderid>_<ts>.<ext> name
  // so it's distinguishable from regular order document uploads.
  var attUrl = null, attName = null;
  if(fileInp && fileInp.files && fileInp.files[0]){
    var f = fileInp.files[0];
    var ext = (f.name.split('.').pop()||'bin').toLowerCase();
    var key = 'payment_' + orderId.substring(0,8) + '_' + Date.now() + '.' + ext;
    var{error:upErr} = await sb.storage.from('order-attachments').upload(key, f, { contentType: f.type, upsert: true });
    if(upErr){ toast('Upload failed: '+upErr.message,'error'); return; }
    var{data:urlData} = sb.storage.from('order-attachments').getPublicUrl(key);
    attUrl = urlData && urlData.publicUrl || null;
    attName = f.name;
  }

  var session = await sb.auth.getSession();
  var user = session && session.data && session.data.session && session.data.session.user && session.data.session.user.email || 'admin';

  var{error} = await sb.from('salesweb_order_payments').insert([{
    order_id: orderId,
    paid_at:  paidAt,
    amount:   amt,
    note:     noteRaw ? String(noteRaw).trim() : null,
    attachment_url: attUrl,
    attachment_name: attName,
    created_by: user,
  }]);
  if(error){ toast('Save failed: '+error.message,'error'); return; }

  // Timeline entry so admins reviewing the order history see the payment
  // event in context with status changes.
  try{
    await sb.from('salesweb_order_timeline').insert([{
      order_id: orderId,
      status: 'Payment Recorded',
      note: 'RM '+fmtMYR(amt)+' received'+(noteRaw?(' — '+noteRaw):'')+(attUrl?' (with attachment)':''),
      changed_by: user,
    }]);
  }catch(e){ /* non-fatal */ }

  closeModal('modal-add-payment');
  toast('Payment recorded: RM '+fmtMYR(amt));
  viewOrder(orderId);
}

async function deletePaymentEntry(paymentId, orderId){
  if(!confirm('Delete this payment entry? The order’s Amount Paid total will recalculate automatically.')) return;
  var{error} = await sb.from('salesweb_order_payments').delete().eq('id', paymentId);
  if(error){ toast('Delete failed: '+error.message,'error'); return; }
  toast('Payment entry deleted');
  viewOrder(orderId);
}
