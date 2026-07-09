/* ═══════════════════════════════════════════════════════════════════
   admin-payments.js
   Accountant-facing payment verification workspace. Drives the inline
   Payments tab in admin.html.

   Reuses the existing order status field rather than introducing a new
   payment_status column — the storefront workflow already encodes payment
   state via:
     Pending Payment  → customer hasn't paid yet
     Paid             → payment verified, order can proceed
     Refunded         → money returned

   Accountant flow:
     1. See orders awaiting verification (default filter).
     2. Click a row to open the payment detail modal.
     3. Review the proof attachment + payment timeline.
     4. Click "Mark as Paid" / "Mark as Unpaid" / "Mark as Refunded".
     5. Optionally add an internal note (writes to internal_notes column).

   SHARED helpers from admin.html: sb, toast, esc, fmtDate, openModal,
   closeModal. Reuses orderBadgeCls() from admin-orders.js for status pill
   colours so the two views stay visually aligned.

   TABLES TOUCHED: salesweb_customer_orders, salesweb_order_timeline,
   salesweb_order_attachments.
   ═══════════════════════════════════════════════════════════════════ */

// Maps the dropdown filter values to the underlying status set.
var PAYMENT_FILTER_MAP = {
  awaiting: ['Pending Payment'],
  paid:     ['Paid','Ready for Collection','Completed'],  // anything post-verification
  refunded: ['Refunded']
};

// ═══════════════════════════════════════
//  LOAD PAYMENTS — DASHBOARD
// ═══════════════════════════════════════
async function loadPayments(){
  var q       = (document.getElementById('payment-search')?.value || '').trim().toLowerCase();
  var filter  = document.getElementById('payment-filter')?.value || 'awaiting';
  var method  = document.getElementById('payment-method-filter')?.value || '';

  var query = sb.from('salesweb_customer_orders').select('*').order('created_at',{ascending:false});
  var statuses = PAYMENT_FILTER_MAP[filter];
  if (statuses) query = query.in('status', statuses);
  if (method === 'credit') query = query.eq('payment_terms', 'credit');
  if (method === 'cash')   query = query.neq('payment_terms', 'credit'); // null + 'cash' both bucket as cash

  var { data, error } = await query;
  if (error) { toast('Error loading payments: '+error.message,'error'); return; }
  var orders = data || [];

  if (q) {
    orders = orders.filter(function(o){
      return (o.order_number||'').toLowerCase().includes(q)
          || (o.id||'').toLowerCase().includes(q)
          || (o.customer_name||'').toLowerCase().includes(q)
          || (o.customer_email||'').toLowerCase().includes(q);
    });
  }

  renderPaymentStats(data || []);
  renderPaymentsTable(orders);
}

function renderPaymentStats(all){
  var awaiting = all.filter(function(o){ return o.status==='Pending Payment'; });
  var paidNow  = all.filter(function(o){ return ['Paid','Ready for Collection','Completed'].indexOf(o.status) >= 0; });
  var refunded = all.filter(function(o){ return o.status==='Refunded'; });

  // "This month" — verified_at column doesn't exist, so we fall back to
  // updated_at as the closest proxy for when status flipped.
  var monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  var paidMonth = paidNow.filter(function(o){
    var t = o.updated_at ? new Date(o.updated_at) : null;
    return t && t >= monthStart;
  });

  var sumAwait = awaiting.reduce(function(s,o){ return s + (o.total||0); }, 0);
  var sumPaid  = paidMonth.reduce(function(s,o){ return s + (o.total||0); }, 0);

  document.getElementById('payment-stats').innerHTML =
    '<div class="stat-box"><div class="stat-label">Awaiting Verification</div><div class="stat-val" style="color:var(--amber)">'+awaiting.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Awaiting Value</div><div class="stat-val" style="color:var(--amber)">RM '+sumAwait.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Verified This Month</div><div class="stat-val green">'+paidMonth.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Verified Value (MTD)</div><div class="stat-val green">RM '+sumPaid.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Refunded</div><div class="stat-val" style="color:#b91c1c;">'+refunded.length+'</div></div>';
}

function renderPaymentsTable(orders){
  if (!orders.length) {
    document.getElementById('payments-table').innerHTML = '<div class="loading">No payments match the current filter.</div>';
    return;
  }

  // Reuse orderBadgeCls() from admin-orders.js (loaded earlier in the
  // <script> chain) so status pills look identical across views.
  var badge = (typeof orderBadgeCls === 'function') ? orderBadgeCls : function(){ return 'badge-grey'; };

  var html = '<table class="data-table">'+
    '<thead><tr>'+
      '<th>Order</th><th>Customer</th><th>Date</th><th>Method</th><th>Total</th><th>Status</th><th>Action</th>'+
    '</tr></thead><tbody>';

  orders.forEach(function(o){
    var shortId = o.order_number || (o.id||'').substring(0,8).toUpperCase();
    var idJs    = String(o.id||'').replace(/[\\'"<>]/g,'');
    var methodLabel = o.payment_terms === 'credit'
      ? '<span class="badge badge-blue">📅 Credit</span>'
      : '<span class="badge badge-grey">💵 Cash / Transfer</span>';
    var canPaid     = o.status === 'Pending Payment';
    var canUnpaid   = ['Paid','Ready for Collection'].indexOf(o.status) >= 0;
    var canRefunded = ['Paid','Ready for Collection','Completed','Cancelled'].indexOf(o.status) >= 0;
    var actions = '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openPaymentDetail(\''+idJs+'\')">Review</button>';
    if (canPaid)     actions += ' <button class="btn btn-outline btn-sm" style="background:var(--green);color:#fff;border-color:var(--green);" onclick="event.stopPropagation();markPayment(\''+idJs+'\',\'Paid\')">✓ Mark Paid</button>';
    if (canUnpaid)   actions += ' <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();markPayment(\''+idJs+'\',\'Pending Payment\')">Mark Unpaid</button>';
    if (canRefunded) actions += ' <button class="btn btn-outline btn-sm" style="color:#b91c1c;border-color:#b91c1c;" onclick="event.stopPropagation();markPayment(\''+idJs+'\',\'Refunded\')">Refund</button>';

    html += '<tr style="cursor:pointer;" onclick="openPaymentDetail(\''+idJs+'\')">'+
      '<td><strong>'+esc(shortId)+'</strong></td>'+
      '<td>'+esc(o.customer_name||'—')+'<div style="font-size:11px;color:var(--ink4);">'+esc(o.customer_email||'')+'</div></td>'+
      '<td>'+fmtDate(o.created_at)+'</td>'+
      '<td>'+methodLabel+'</td>'+
      '<td><strong>RM '+(o.total||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</strong></td>'+
      '<td><span class="badge '+badge(o.status)+'">'+esc(o.status||'—')+'</span></td>'+
      '<td>'+actions+'</td>'+
    '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('payments-table').innerHTML = html;
}

// ═══════════════════════════════════════
//  PAYMENT DETAIL MODAL
// ═══════════════════════════════════════
// One ad-hoc modal lives at the bottom of admin.html (#modal-payment).
// We populate it on open rather than building it inline so the markup
// stays inspectable in DevTools.
async function openPaymentDetail(orderId){
  var modal = document.getElementById('modal-payment');
  if (!modal) { toast('Payment modal not initialised','error'); return; }
  modal.classList.add('open');
  document.getElementById('payment-detail-body').innerHTML = '<div class="loading">Loading…</div>';
  document.getElementById('payment-detail-body').setAttribute('data-order-id', orderId);

  var [{data: order}, {data: attachments}, {data: timeline}] = await Promise.all([
    sb.from('salesweb_customer_orders').select('*').eq('id', orderId).single(),
    sb.from('salesweb_order_attachments').select('*').eq('order_id', orderId).order('created_at', {ascending: false}),
    sb.from('salesweb_order_timeline').select('*').eq('order_id', orderId).order('created_at', {ascending: false})
  ]);

  if (!order) {
    document.getElementById('payment-detail-body').innerHTML = '<div class="loading">Order not found.</div>';
    return;
  }

  var badge   = (typeof orderBadgeCls === 'function') ? orderBadgeCls : function(){ return 'badge-grey'; };
  var shortId = order.order_number || order.id.substring(0,8).toUpperCase();
  var method  = order.payment_terms === 'credit' ? 'Credit Terms' : 'Cash / Bank Transfer';

  // Pull proof URLs out of timeline notes (customer-uploaded proofs are
  // logged as "Customer uploaded payment proof — <url>") AND from
  // the attachments table (admin-side uploads). Either source counts.
  var proofs = (attachments || []).slice();
  (timeline || []).forEach(function(t){
    var m = (t.note || '').match(/https?:\/\/\S+/);
    if (m && /proof|payment/i.test(t.note || '')) {
      proofs.push({ file_name: 'Customer proof', file_url: m[0], created_at: t.created_at });
    }
  });

  var proofHtml = proofs.length
    ? proofs.map(function(p){
        return '<a href="'+esc(p.file_url)+'" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="margin:.2rem .3rem .2rem 0;text-decoration:none;display:inline-block;">'+
                 '🧾 '+esc(p.file_name || 'Attachment')+' · '+fmtDate(p.created_at)+
               '</a>';
      }).join('')
    : '<span style="color:var(--ink4);font-size:12px;">No proof uploaded yet.</span>';

  var timelineHtml = (timeline && timeline.length)
    ? timeline.slice(0,8).map(function(t){
        return '<div style="padding:.5rem .8rem;border-left:3px solid var(--border);margin-bottom:.4rem;font-size:12px;">'+
                 '<div style="font-weight:600;color:var(--ink2);">'+esc(t.status || 'Update')+'</div>'+
                 '<div style="color:var(--ink3);">'+esc(t.note || '')+'</div>'+
                 '<div style="font-size:10px;color:var(--ink4);margin-top:.2rem;">'+fmtDate(t.created_at)+'</div>'+
               '</div>';
      }).join('')
    : '<div style="color:var(--ink4);font-size:12px;">No timeline entries yet.</div>';

  var canPaid     = order.status === 'Pending Payment';
  var canUnpaid   = ['Paid','Ready for Collection'].indexOf(order.status) >= 0;
  var canRefunded = ['Paid','Ready for Collection','Completed','Cancelled'].indexOf(order.status) >= 0;

  document.getElementById('payment-detail-body').innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">'+
      '<div>'+
        '<div class="mp-section-title">Order</div>'+
        '<div style="font-size:14px;line-height:1.8;">'+
          '<div><strong>'+esc(shortId)+'</strong> <span class="badge '+badge(order.status)+'" style="margin-left:.5rem;">'+esc(order.status||'—')+'</span></div>'+
          '<div style="color:var(--ink3);">'+esc(order.customer_name||'—')+'</div>'+
          '<div style="color:var(--ink3);font-size:12px;">'+esc(order.customer_email||'')+'</div>'+
          '<div style="margin-top:.5rem;color:var(--ink3);font-size:12px;">Placed '+fmtDate(order.created_at)+'</div>'+
        '</div>'+
      '</div>'+
      '<div>'+
        '<div class="mp-section-title">Payment</div>'+
        '<div style="font-size:14px;line-height:1.8;">'+
          '<div>Method: <strong>'+esc(method)+'</strong></div>'+
          '<div>Total: <strong>RM '+(order.total||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</strong></div>'+
          (order.discount_amount ? '<div>Discount: -RM '+(order.discount_amount||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div>' : '')+
          (order.coupon_code ? '<div>Coupon: <code>'+esc(order.coupon_code)+'</code></div>' : '')+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div style="margin-top:1.2rem;">'+
      '<div class="mp-section-title">Payment Proof</div>'+
      '<div>'+proofHtml+'</div>'+
    '</div>'+
    '<div style="margin-top:1.2rem;">'+
      '<div class="mp-section-title">Internal Notes</div>'+
      '<textarea id="payment-internal-note" class="form-input" style="width:100%;min-height:80px;font-family:inherit;font-size:13px;" placeholder="Accountant notes (not visible to customer)">'+esc(order.internal_notes||'')+'</textarea>'+
      '<button class="btn btn-outline btn-sm" style="margin-top:.5rem;" onclick="savePaymentNote()">Save Note</button>'+
    '</div>'+
    '<div style="margin-top:1.2rem;">'+
      '<div class="mp-section-title">Recent Timeline</div>'+
      timelineHtml+
    '</div>'+
    '<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;">'+
      (canPaid     ? '<button class="btn btn-outline btn-sm" style="background:var(--green);color:#fff;border-color:var(--green);" onclick="markPayment(\''+orderId+'\',\'Paid\',true)">✓ Mark as Paid</button>' : '')+
      (canUnpaid   ? '<button class="btn btn-outline btn-sm" onclick="markPayment(\''+orderId+'\',\'Pending Payment\',true)">Revert to Unpaid</button>' : '')+
      (canRefunded ? '<button class="btn btn-outline btn-sm" style="color:#b91c1c;border-color:#b91c1c;" onclick="markPayment(\''+orderId+'\',\'Refunded\',true)">Mark as Refunded</button>' : '')+
      '<button class="btn btn-outline btn-sm" onclick="closeModal(\'modal-payment\')">Close</button>'+
    '</div>';
}

// ═══════════════════════════════════════
//  MUTATIONS — mark paid / unpaid / refunded
// ═══════════════════════════════════════
async function markPayment(orderId, newStatus, fromModal){
  var verb = newStatus === 'Paid' ? 'verify payment for'
           : newStatus === 'Refunded' ? 'mark as refunded'
           : 'revert to unpaid';
  if (!confirm('Are you sure you want to '+verb+' this order?')) return;

  var nowIso = new Date().toISOString();
  var { error } = await sb.from('salesweb_customer_orders')
    .update({ status: newStatus, updated_at: nowIso })
    .eq('id', orderId);
  if (error) { toast('Update failed: '+error.message, 'error'); return; }

  // Audit trail: drop a timeline row noting which accountant flipped it.
  // Column convention matches admin-orders.js (status / note / changed_by).
  var session = await sb.auth.getSession();
  var actor   = session?.data?.session?.user?.email || 'accountant';
  await sb.from('salesweb_order_timeline').insert([{
    order_id:   orderId,
    status:     newStatus,
    note:       'Payment status set to "' + newStatus + '" by ' + actor,
    changed_by: actor
  }]);

  toast('Payment status updated to "' + newStatus + '"');
  if (fromModal) closeModal('modal-payment');
  loadPayments();
}

async function savePaymentNote(){
  var body  = document.getElementById('payment-detail-body');
  var orderId = body?.getAttribute('data-order-id');
  var note  = (document.getElementById('payment-internal-note')?.value || '').trim();
  if (!orderId) { toast('No order in context','error'); return; }

  var { error } = await sb.from('salesweb_customer_orders')
    .update({ internal_notes: note, updated_at: new Date().toISOString() })
    .eq('id', orderId);
  if (error) { toast('Save failed: '+error.message,'error'); return; }
  toast('Note saved');
}
