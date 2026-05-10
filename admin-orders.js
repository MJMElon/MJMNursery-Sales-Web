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
═══════════════════════════════════════════════════
*/

var ORDER_STATUSES = ['Pending Payment','Paid','Ready for Collection','Completed','Cancelled','Refunded'];

// ═══════════════════════════════════════
//  LOAD ORDERS — DASHBOARD
// ═══════════════════════════════════════
async function loadOrders(){
  var q=document.getElementById('order-search').value.trim().toLowerCase();
  var status=document.getElementById('order-filter').value;
  var query=sb.from('salesweb_customer_orders').select('*').order('created_at',{ascending:false});
  if(status)query=query.eq('status',status);
  var{data,error}=await query;
  if(error){toast('Error: '+error.message,'error');return;}
  var orders=data||[];
  if(q)orders=orders.filter(function(o){return(o.order_number||'').toLowerCase().includes(q)||(o.id||'').toLowerCase().includes(q)||(o.customer_name||'').toLowerCase().includes(q)||(o.customer_email||'').toLowerCase().includes(q);});

  // Stats
  var all=data||[];
  var pending=all.filter(function(o){return o.status==='Pending Payment';}).length;
  var paid=all.filter(function(o){return o.status==='Paid';}).length;
  var completed=all.filter(function(o){return o.status==='Completed';}).length;
  var revenue=all.filter(function(o){return o.status!=='Cancelled';}).reduce(function(s,o){return s+(o.total||0);},0);
  var creditOutstanding=all.filter(function(o){return o.payment_terms==='credit'&&!o.credit_billed_at&&o.status!=='Cancelled';}).reduce(function(s,o){return s+(o.total||0);},0);
  document.getElementById('order-stats').innerHTML=
    '<div class="stat-box"><div class="stat-label">Total Orders</div><div class="stat-val">'+all.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Pending Payment</div><div class="stat-val" style="color:var(--amber)">'+pending+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Paid</div><div class="stat-val" style="color:var(--blue)">'+paid+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Completed</div><div class="stat-val green">'+completed+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Credit Outstanding</div><div class="stat-val" style="color:#a16207;">RM '+creditOutstanding.toLocaleString('en-MY',{minimumFractionDigits:2})+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Revenue</div><div class="stat-val">RM '+revenue.toLocaleString('en-MY',{minimumFractionDigits:2})+'</div></div>';

  if(!orders.length){document.getElementById('orders-table').innerHTML='<div class="loading">No orders found</div>';return;}
  var html='<table class="data-table"><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Terms</th><th>Items</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>';
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
    html+='<tr onclick="viewOrder(\''+idJs+'\')" style="cursor:pointer;">'+
      '<td style="font-weight:600;">#'+esc(shortId)+'</td>'+
      '<td>'+esc(o.customer_name||'—')+'<div style="font-size:11px;color:var(--ink4);">'+esc(o.customer_email||'')+'</div></td>'+
      '<td style="font-size:12px;">'+fmtDate(o.created_at)+'</td>'+
      '<td>'+termsBadge+'</td>'+
      '<td style="text-align:center;">—</td>'+
      '<td style="font-weight:600;">RM '+(o.total||0).toFixed(2)+'</td>'+
      '<td><span class="badge '+statusCls+'">'+esc(o.status)+'</span></td>'+
      '<td><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();viewOrder(\''+idJs+'\')">View</button></td>'+
    '</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('orders-table').innerHTML=html;
}

function orderBadgeCls(s){
  return{'Pending Payment':'badge-amber','Paid':'badge-blue','Ready for Collection':'badge-green','Completed':'badge-grey','Cancelled':'badge-red','Refunded':'badge-red'}[s]||'badge-grey';
}

// ═══════════════════════════════════════
//  VIEW ORDER — FULL DETAIL
// ═══════════════════════════════════════
async function viewOrder(id){
  var{data:order}=await sb.from('salesweb_customer_orders').select('*').eq('id',id).single();
  if(!order){toast('Order not found','error');return;}
  var{data:items}=await sb.from('salesweb_order_items').select('*').eq('order_id',id);
  items=items||[];

  var shortId=order.order_number||order.id.substring(0,8).toUpperCase();
  document.getElementById('mo-title').textContent='Order #'+shortId;

  var html='';

  // ── Status bar ──
  html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:.8rem 1rem;background:var(--bg);border-radius:10px;margin-bottom:1rem;">';
  html+='<div><span class="badge '+orderBadgeCls(order.status)+'" style="font-size:12px;padding:5px 12px;">'+order.status+'</span></div>';
  html+='<div style="display:flex;align-items:center;gap:.5rem;"><label style="font-size:12px;font-weight:600;color:var(--ink3);">Change to:</label><select id="mo-status-select" class="form-input" style="width:auto;font-size:12px;padding:6px 10px;">';
  ORDER_STATUSES.forEach(function(s){html+='<option'+(s===order.status?' selected':'')+'>'+s+'</option>';});
  html+='</select><button class="btn btn-primary btn-sm" onclick="updateOrderStatus(\''+id+'\')">Update</button></div></div>';

  // ── Customer info ──
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">';
  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.5rem;">Customer</div>';
  html+='<div style="font-size:13px;"><strong>'+esc(order.customer_name||'—')+'</strong></div>';
  html+='<div style="font-size:12px;color:var(--ink3);">'+esc(order.customer_email||'—')+'</div>';
  if(order.shipping_address)html+='<div style="font-size:12px;color:var(--ink3);margin-top:.3rem;">'+esc(order.shipping_address)+'</div>';
  html+='</div>';
  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.5rem;">Billing / E-Invoice</div>';
  html+='<div style="font-size:12px;color:var(--ink3);">'+esc(order.billing_name||order.customer_name||'—')+'</div>';
  html+='<div style="font-size:12px;color:var(--ink3);">Tax ID: '+esc(order.billing_tax_id||'—')+'</div>';
  html+='<div style="font-size:12px;color:var(--ink3);">Points issued: '+(order.points_issued||0)+'</div>';
  html+='</div></div>';

  // ── Items table ──
  html+='<div style="margin-bottom:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.5rem;">Order Items</div>';
  if(items.length){
    html+='<table class="data-table"><thead><tr><th>Product</th><th style="text-align:right;">Price</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Subtotal</th></tr></thead><tbody>';
    items.forEach(function(it){html+='<tr><td>'+esc(it.product_name||'—')+'</td><td style="text-align:right;">RM '+(it.unit_price||0).toFixed(2)+'</td><td style="text-align:right;">'+it.quantity+'</td><td style="text-align:right;font-weight:600;">RM '+(it.subtotal||0).toFixed(2)+'</td></tr>';});
    html+='</tbody></table>';
  } else html+='<div style="font-size:12px;color:var(--ink4);padding:.5rem 0;">No items</div>';
  html+='</div>';

  // ── Financial summary ──
  var subtotal=items.reduce(function(s,it){return s+(it.subtotal||0);},0);
  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;margin-bottom:1rem;">';
  html+='<div style="font-size:13px;font-weight:600;margin-bottom:.5rem;">Financial Summary</div>';
  html+='<div style="display:flex;justify-content:space-between;padding:.2rem 0;font-size:13px;"><span>Subtotal</span><span>RM '+subtotal.toFixed(2)+'</span></div>';
  if(order.discount_amount>0)html+='<div style="display:flex;justify-content:space-between;padding:.2rem 0;font-size:13px;color:var(--red);"><span>Discount</span><span>-RM '+order.discount_amount.toFixed(2)+'</span></div>';
  if(order.coupon_code)html+='<div style="display:flex;justify-content:space-between;padding:.2rem 0;font-size:13px;color:var(--red);"><span>Coupon ('+esc(order.coupon_code)+')</span><span>-RM '+(order.coupon_discount||0).toFixed(2)+'</span></div>';
  html+='<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-top:1.5px solid var(--border);margin-top:.3rem;font-size:15px;font-weight:700;"><span>Total</span><span>RM '+(order.total||0).toFixed(2)+'</span></div>';

  // Discount + Coupon controls (collapsible)
  html+='<div style="margin-top:.8rem;padding-top:.8rem;border-top:1px solid var(--border);display:flex;gap:.5rem;flex-wrap:wrap;">';
  html+='<button class="btn btn-outline btn-sm" onclick="var el=document.getElementById(\'mo-discount-panel\');el.style.display=el.style.display===\'none\'?\'flex\':\'none\';" style="font-size:11px;">Set Discount</button>';
  html+='<button class="btn btn-outline btn-sm" onclick="var el=document.getElementById(\'mo-coupon-panel\');el.style.display=el.style.display===\'none\'?\'flex\':\'none\';" style="font-size:11px;">Apply Coupon</button>';
  html+='</div>';
  html+='<div id="mo-discount-panel" style="display:none;gap:.5rem;align-items:center;margin-top:.5rem;flex-wrap:wrap;">';
  html+='<input class="form-input" id="mo-discount" type="number" step="0.01" value="'+(order.discount_amount||0)+'" style="width:120px;font-size:12px;padding:6px 10px;" placeholder="Amount (RM)"><button class="btn btn-primary btn-sm" onclick="addDiscount(\''+id+'\')">Apply Discount</button>';
  html+='</div>';
  html+='<div id="mo-coupon-panel" style="display:none;gap:.5rem;align-items:center;margin-top:.5rem;flex-wrap:wrap;">';
  html+='<input class="form-input" id="mo-coupon" type="text" value="'+(order.coupon_code||'')+'" style="width:120px;font-size:12px;padding:6px 10px;text-transform:uppercase;" placeholder="Coupon code"><button class="btn btn-primary btn-sm" onclick="applyCoupon(\''+id+'\')">Apply Coupon</button>';
  html+='</div>';
  html+='</div>';

  // ── Payment Terms (Cash / Credit) ──
  var currentTerms=order.payment_terms==='credit'?'credit':'cash';
  var creditPeriod=order.credit_billing_period||'';
  var billedAt=order.credit_billed_at||'';
  html+='<div style="background:var(--bg);border-radius:10px;padding:1rem;margin-bottom:1rem;">';
  html+='<div style="font-size:13px;font-weight:600;margin-bottom:.5rem;">Payment Terms</div>';
  html+='<div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">';
  html+='<select id="mo-terms-select" class="form-input" style="width:auto;font-size:12px;padding:6px 10px;" onchange="document.getElementById(\'mo-credit-period-row\').style.display=this.value===\'credit\'?\'flex\':\'none\';">';
  html+='<option value="cash"'+(currentTerms==='cash'?' selected':'')+'>💵 Cash</option>';
  html+='<option value="credit"'+(currentTerms==='credit'?' selected':'')+'>💳 Credit</option>';
  html+='</select>';
  html+='<button class="btn btn-primary btn-sm" onclick="updateOrderPaymentTerms(\''+id+'\')">Update Terms</button>';
  html+='</div>';
  html+='<div id="mo-credit-period-row" style="display:'+(currentTerms==='credit'?'flex':'none')+';gap:.5rem;align-items:center;flex-wrap:wrap;margin-top:.6rem;">';
  html+='<label style="font-size:12px;color:var(--ink3);">Billing period:</label>';
  html+='<input class="form-input" id="mo-credit-period" type="text" value="'+esc(creditPeriod)+'" placeholder="e.g. 2026-05" style="width:140px;font-size:12px;padding:6px 10px;">';
  if(billedAt){
    html+='<span class="badge" style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;">Billed '+fmtDate(billedAt)+'</span>';
    html+='<button class="btn btn-outline btn-sm" onclick="setOrderCreditBilled(\''+id+'\',false)" style="font-size:11px;">Mark Unbilled</button>';
  } else {
    html+='<span class="badge badge-amber">Unbilled</span>';
    html+='<button class="btn btn-outline btn-sm" onclick="setOrderCreditBilled(\''+id+'\',true)" style="font-size:11px;">Mark Billed</button>';
  }
  html+='</div></div>';

  // ── Customer Remark ──
  if(order.customer_remark){
    html+='<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;">';
    html+='<div style="font-size:11px;font-weight:600;color:#92400e;margin-bottom:.3rem;">Customer Remark</div>';
    html+='<div style="font-size:13px;color:var(--ink2);">'+esc(order.customer_remark)+'</div></div>';
  }

  // ── Seller Note ──
  html+='<div style="margin-bottom:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.4rem;">Seller Note <span style="font-size:10px;color:var(--ink4);font-weight:400;">(visible to customer)</span></div>';
  html+='<textarea class="form-input" id="mo-seller-note" rows="2" style="font-size:13px;">'+(order.seller_note||'')+'</textarea>';
  html+='<button class="btn btn-outline btn-sm" onclick="saveSellerNote(\''+id+'\')" style="margin-top:.4rem;">Save Note</button></div>';

  // ── Internal Notes ──
  html+='<div style="margin-bottom:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.4rem;">Internal Notes <span style="font-size:10px;color:var(--ink4);font-weight:400;">(admin only)</span></div>';
  html+='<textarea class="form-input" id="mo-notes" rows="2" style="font-size:13px;">'+(order.internal_notes||'')+'</textarea>';
  html+='<button class="btn btn-outline btn-sm" onclick="saveInternalNote(\''+id+'\')" style="margin-top:.4rem;">Save</button></div>';

  // ── Attachments ──
  html+='<div style="margin-bottom:1rem;"><div style="font-size:13px;font-weight:600;margin-bottom:.4rem;">Attachments</div>';
  html+='<div id="mo-attachments"><div style="font-size:12px;color:var(--ink4);">Loading...</div></div>';
  html+='<div style="margin-top:.5rem;display:flex;gap:.5rem;align-items:center;">';
  html+='<input type="file" id="mo-att-file" style="font-size:12px;">';
  html+='<button class="btn btn-outline btn-sm" onclick="uploadOrderAttachment(\''+id+'\')">Upload</button></div></div>';

  // ── Timeline ──
  html+='<div><div style="font-size:13px;font-weight:600;margin-bottom:.5rem;">Order Timeline</div>';
  html+='<div id="mo-timeline"><div style="font-size:12px;color:var(--ink4);">Loading...</div></div></div>';

  document.getElementById('mo-body').innerHTML=html;
  document.getElementById('mo-foot').innerHTML='<button class="btn btn-outline" onclick="closeModal(\'modal-order\');loadOrders();">Close</button>';
  openModal('modal-order');

  // Load async data
  loadAttachments(id);
  loadTimeline(id);
}

// ═══════════════════════════════════════
//  STATUS UPDATE (with side effects)
// ═══════════════════════════════════════
async function updateOrderStatus(orderId){
  var newStatus=document.getElementById('mo-status-select').value;
  var{data:order}=await sb.from('salesweb_customer_orders').select('status,total,customer_name,order_number,customer_email').eq('id',orderId).single();
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
  // Update order
  await sb.from('salesweb_customer_orders').update({status:newStatus,updated_at:new Date().toISOString()}).eq('id',orderId);

  // Log to timeline
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:newStatus,note:'Status changed from '+oldStatus+' to '+newStatus,changed_by:user}]);

  // Side effects
  if(newStatus==='Paid'&&oldStatus!=='Paid'){
    await issuePoints(orderId,order.total||0);
    await createALFromOrder(orderId,order);
    toast('Points issued + AL created + status updated');
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
  viewOrder(orderId);
}

// ═══════════════════════════════════════
//  DISCOUNT & COUPON
// ═══════════════════════════════════════
async function addDiscount(orderId){
  var amt=parseFloat(document.getElementById('mo-discount').value)||0;
  await sb.from('salesweb_customer_orders').update({discount_amount:amt,updated_at:new Date().toISOString()}).eq('id',orderId);
  // Recalc total
  var{data:items}=await sb.from('salesweb_order_items').select('subtotal').eq('order_id',orderId);
  var{data:order}=await sb.from('salesweb_customer_orders').select('coupon_discount').eq('id',orderId).single();
  var subtotal=(items||[]).reduce(function(s,i){return s+(i.subtotal||0);},0);
  var total=Math.max(0,subtotal-amt-(order?.coupon_discount||0));
  await sb.from('salesweb_customer_orders').update({total:total}).eq('id',orderId);
  toast('Discount applied: RM '+amt.toFixed(2));
  viewOrder(orderId);
}

async function applyCoupon(orderId){
  var code=document.getElementById('mo-coupon').value.trim().toUpperCase();
  if(!code){toast('Enter coupon code','error');return;}

  var{data:coupon}=await sb.from('salesweb_coupons').select('*').eq('code',code).eq('is_active',true).single();
  if(!coupon){toast('Invalid or inactive coupon','error');return;}
  if(coupon.expiry_date&&coupon.expiry_date<new Date().toISOString().split('T')[0]){toast('Coupon expired','error');return;}
  if(coupon.usage_limit>0&&coupon.usage_count>=coupon.usage_limit){toast('Coupon usage limit reached','error');return;}

  // Calculate discount
  var{data:items}=await sb.from('salesweb_order_items').select('subtotal').eq('order_id',orderId);
  var subtotal=(items||[]).reduce(function(s,i){return s+(i.subtotal||0);},0);
  var{data:order}=await sb.from('salesweb_customer_orders').select('discount_amount').eq('id',orderId).single();
  var discount=coupon.discount_type==='percentage'?Math.round(subtotal*(coupon.discount_value/100)*100)/100:coupon.discount_value;

  if(coupon.min_order_value>0&&subtotal<coupon.min_order_value){toast('Min order RM '+coupon.min_order_value+' required','error');return;}

  var total=Math.max(0,subtotal-(order?.discount_amount||0)-discount);
  await sb.from('salesweb_customer_orders').update({coupon_code:code,coupon_discount:discount,total:total,updated_at:new Date().toISOString()}).eq('id',orderId);
  await sb.from('salesweb_coupons').update({usage_count:(coupon.usage_count||0)+1}).eq('id',coupon.id);
  toast('Coupon applied: -RM '+discount.toFixed(2));
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
  toast('Payment terms updated');
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
async function loadAttachments(orderId){
  var{data}=await sb.from('salesweb_order_attachments').select('*').eq('order_id',orderId).order('created_at',{ascending:false});
  var el=document.getElementById('mo-attachments');
  if(!data||!data.length){el.innerHTML='<div style="font-size:12px;color:var(--ink4);padding:.3rem 0;">No attachments</div>';return;}
  el.innerHTML=data.map(function(a){
    var dt=fmtDate(a.created_at);
    return '<div style="display:flex;align-items:center;gap:.6rem;padding:.4rem 0;border-bottom:1px solid var(--border);font-size:12px;">'+
      '<span>📎</span><a href="'+esc(a.file_url)+'" target="_blank" style="flex:1;color:var(--ink);font-weight:500;text-decoration:none;">'+esc(a.file_name)+'</a>'+
      '<span style="color:var(--ink4);font-size:10px;">'+dt+'</span>'+
      '<button class="btn btn-outline btn-sm" onclick="deleteAttachment(\''+a.id+'\',\''+orderId+'\')" style="color:var(--red);font-size:10px;padding:2px 6px;">✕</button></div>';
  }).join('');
}

async function uploadOrderAttachment(orderId){
  var input=document.getElementById('mo-att-file');
  if(!input.files||!input.files[0]){toast('Select a file','error');return;}
  var file=input.files[0];
  var fileName='order_'+orderId.substring(0,8)+'_'+Date.now()+'.'+file.name.split('.').pop();

  var{error}=await sb.storage.from('order-attachments').upload(fileName,file,{contentType:file.type,upsert:true});
  if(error){toast('Upload failed','error');return;}
  var{data:urlData}=sb.storage.from('order-attachments').getPublicUrl(fileName);
  var url=urlData?.publicUrl||'';

  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  await sb.from('salesweb_order_attachments').insert([{order_id:orderId,file_name:file.name,file_url:url,file_type:file.type,uploaded_by:user}]);
  input.value='';
  toast('File uploaded');
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

  // Always include "Order Placed" as first entry
  var entries=[{status:'Order Placed',note:'Order created',created_at:null,changed_by:'System'}];

  if(data&&data.length){
    // Use order created_at for first entry
    entries[0].created_at=data[0].created_at;
    data.forEach(function(t){entries.push(t);});
  }

  var html='<div style="position:relative;padding-left:24px;">';
  // Vertical line
  html+='<div style="position:absolute;left:7px;top:4px;bottom:4px;width:2px;background:var(--border);"></div>';

  entries.forEach(function(t,i){
    var isLast=i===entries.length-1;
    var dt=t.created_at?new Date(t.created_at).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
    var dotColor=isLast?'var(--green)':'var(--border2)';
    var dotSize=isLast?'12px':'10px';

    html+='<div style="position:relative;padding-bottom:1rem;margin-bottom:.3rem;">';
    // Dot
    html+='<div style="position:absolute;left:-24px;top:3px;width:'+dotSize+';height:'+dotSize+';border-radius:50%;background:'+dotColor+';border:2px solid #fff;box-shadow:0 0 0 2px '+dotColor+';"></div>';
    // Content
    html+='<div style="font-size:13px;font-weight:600;color:var(--ink);">'+esc(t.status)+'</div>';
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
async function issuePoints(orderId,totalAmount){
  // 1 point per RM 100
  var points=Math.floor(totalAmount/100);
  if(points<=0)return;
  await sb.from('salesweb_customer_orders').update({points_issued:points}).eq('id',orderId);

  // Log
  var session=await sb.auth.getSession();
  var user=session?.data?.session?.user?.email||'admin';
  await sb.from('salesweb_order_timeline').insert([{order_id:orderId,status:'Points Issued',note:points+' loyalty points issued (RM '+totalAmount.toFixed(2)+' @ 1pt/RM100)',changed_by:user}]);
}

// ═══════════════════════════════════════
//  AUTO-CREATE AL (on Paid)
// ═══════════════════════════════════════
async function createALFromOrder(orderId,order){
  var alNumber=order.order_number;
  if(!alNumber)return;

  // Check if AL already exists for this order
  var{data:existingAL}=await sb.from('shared_al_orders').select('id').eq('al_number',alNumber).single();
  if(existingAL)return; // AL already created

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
    customer_name:order.customer_name||'',
    product_name:productNames||'Oil Palm Seedling',
    quantity_ordered:totalQty,
    balance_quantity:totalQty,
    price_per_unit:unitPrice,
    status:'Verified',
    remark:'Auto-generated from Sales Web Order #'+alNumber
  }]);

  if(alErr){
    console.error('AL creation error:',alErr);
    toast('Warning: Could not create AL — '+alErr.message,'error');
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
