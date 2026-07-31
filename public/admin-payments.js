/* ═══════════════════════════════════════════════════════════════════
   admin-payments.js
   Accountant-facing workspace. Two tabs share the same shell:

     1. Awaiting Verification  — orders with status = 'Pending Payment'.
        Modal shows Customer + Order + Payment Tracking + a Credit —
        Monthly Invoice Breakdown link (jumps to viewOrder). Docs
        uploaded here land in salesweb_order_attachments so they show
        up under the order's Attached Documents.

     2. E-Invoice Requests    — orders where the customer clicked
        "Request E-Invoice" (einvoice_requested_at IS NOT NULL) but the
        E-Invoice hasn't been uploaded yet (einvoice_uploaded_at IS
        NULL). Uploading marks the request done via
        mark_einvoice_uploaded RPC; the file is also mirrored into
        salesweb_order_attachments so the customer sees it on their
        Active Order card and admin sees it in the Attached Documents
        strip.

   SHARED helpers: sb, toast, esc, fmtDate, closeModal, viewOrder
   (from admin-orders.js), openEInvoiceUpload (from admin-orders.js).
   ═══════════════════════════════════════════════════════════════════ */

var PAYMENTS_VIEW = 'awaiting';   // 'awaiting' | 'partial' | 'credit' | 'einvoice'

function setPaymentView(view){
  PAYMENTS_VIEW = ['awaiting','partial','credit','einvoice'].indexOf(view) >= 0 ? view : 'awaiting';
  document.querySelectorAll('[data-payment-view]').forEach(function(el){
    el.classList.toggle('active', el.getAttribute('data-payment-view') === PAYMENTS_VIEW);
  });
  loadPayments();
}
window.setPaymentView = setPaymentView;

// ═══════════════════════════════════════
//  LOAD PAYMENTS — DASHBOARD
// ═══════════════════════════════════════
async function loadPayments(){
  var q = (document.getElementById('payment-search')?.value || '').trim().toLowerCase();

  var query = sb.from('salesweb_customer_orders').select('*').order('created_at', {ascending:false});
  if (PAYMENTS_VIEW === 'einvoice'){
    // E-Invoice tab: customer has requested but accounts hasn't uploaded yet.
    query = query.not('einvoice_requested_at','is',null).is('einvoice_uploaded_at', null);
  } else if (PAYMENTS_VIEW === 'partial'){
    // Partially Paid tab: filtered client-side after we sum
    // salesweb_order_payments per order (amount_paid is a snapshot that
    // can lag when payments are edited per-invoice). Exclude cancelled
    // and refunded orders — those aren't outstanding work.
    query = query.not('status','in','("Cancelled","Refunded")');
  } else if (PAYMENTS_VIEW === 'credit'){
    // Credit Note tab: three visibility rules OR'd, minus already-issued.
    //   - Refunded orders
    //   - Cancelled orders that received payment (client-side check)
    //   - Manually flagged (credit_note_flagged_at IS NOT NULL)
    // Filter by status here + client-side dedup/finalise after payments
    // are summed. `credit_note_issued_at IS NULL` is applied client-side
    // so a stale schema cache doesn't block the query.
    // (No `.in('status',...)` because we also need flagged rows outside
    // Refunded/Cancelled — we filter client-side.)
  } else {
    query = query.eq('status', 'Pending Payment');
  }

  var { data, error } = await query;
  if (error) {
    // The E-Invoice tab hard-depends on 4 columns from
    // supabase/migrations/einvoice_requests.sql. When that migration
    // hasn't been applied yet the query 500s with a "column does not
    // exist" error. Show an actionable note instead of a raw toast so
    // the admin knows what to do without pinging support.
    if (PAYMENTS_VIEW === 'einvoice' && /einvoice_requested_at|does not exist/i.test(error.message||'')){
      document.getElementById('payments-table').innerHTML =
        '<div style="padding:1.2rem;border:1px solid #f5c078;background:#fff8ec;border-radius:10px;color:#78350f;font-size:13px;line-height:1.6;">'+
          '<div style="font-weight:600;margin-bottom:.3rem;">E-Invoice tracking not installed yet</div>'+
          '<div>Run <code>supabase/migrations/einvoice_requests.sql</code> in the SQL Editor, then run <code>NOTIFY pgrst, \'reload schema\';</code>. Refresh this page to enable the E-Invoice Requests tab.</div>'+
        '</div>';
      return;
    }
    toast('Error loading payments: '+error.message,'error');
    return;
  }
  var orders = data || [];

  if (q) {
    orders = orders.filter(function(o){
      return (o.order_number||'').toLowerCase().includes(q)
          || (o.id||'').toLowerCase().includes(q)
          || (o.customer_name||'').toLowerCase().includes(q)
          || (o.customer_email||'').toLowerCase().includes(q)
          || (o.billing_name||'').toLowerCase().includes(q);
    });
  }

  renderPaymentStats();
  if (PAYMENTS_VIEW === 'credit') {
    // Sum payments per order so we can bucket "Cancelled + received
    // payment" rows client-side, then apply the three OR'd rules and
    // hide already-issued rows.
    var candidateIds = orders.map(function(o){ return o.id; });
    var paidById = {};
    if (candidateIds.length){
      for (var i = 0; i < candidateIds.length; i += 500){
        var slice = candidateIds.slice(i, i+500);
        var { data: pays } = await sb.from('salesweb_order_payments')
          .select('order_id, amount').in('order_id', slice);
        (pays||[]).forEach(function(p){
          paidById[p.order_id] = (paidById[p.order_id]||0) + (Number(p.amount)||0);
        });
      }
    }
    var creditRows = orders.filter(function(o){
      if (o.credit_note_issued_at) return false;
      var paid = paidById[o.id] != null ? paidById[o.id] : (Number(o.amount_paid)||0);
      if (o.status === 'Refunded') return true;
      if (o.status === 'Cancelled' && paid > 0) return true;
      if (o.credit_note_flagged_at) return true;
      return false;
    }).map(function(o){
      var paid = paidById[o.id] != null ? paidById[o.id] : (Number(o.amount_paid)||0);
      o._paidSoFar = paid;
      o._creditReason = o.status === 'Refunded' ? 'refunded'
                     : (o.status === 'Cancelled' && paid > 0) ? 'cancelled-with-payment'
                     : 'flagged';
      return o;
    });
    renderCreditNoteTable(creditRows);
  } else if (PAYMENTS_VIEW === 'einvoice') {
    renderEInvoiceTable(orders);
  } else if (PAYMENTS_VIEW === 'partial') {
    // Sum salesweb_order_payments per order — one query, then bucket
    // client-side. amount_paid is used only as a fallback for rows
    // that predate the per-payment ledger.
    var ids = orders.map(function(o){ return o.id; });
    var paidById = {};
    if (ids.length){
      var { data: pays } = await sb.from('salesweb_order_payments')
        .select('order_id, amount').in('order_id', ids);
      (pays||[]).forEach(function(p){
        paidById[p.order_id] = (paidById[p.order_id]||0) + (Number(p.amount)||0);
      });
    }
    var partial = orders.filter(function(o){
      var tot  = Number(o.total)||0;
      var paid = paidById[o.id];
      if (paid == null) paid = Number(o.amount_paid)||0;
      return tot > 0 && paid > 0 && paid < tot - 0.005;   // 0.5-sen tolerance
    }).map(function(o){
      o._paidSoFar = paidById[o.id] != null ? paidById[o.id] : (Number(o.amount_paid)||0);
      return o;
    });
    renderPartialTable(partial);
  } else {
    renderAwaitingTable(orders);
  }
}
window.loadPayments = loadPayments;

// Stats are always sourced from a fresh query so counts don't drift
// when the accountant switches tabs (each tab shows the SAME set of
// KPIs — the workload at a glance).
async function renderPaymentStats(){
  // Try the widest projection first; fall back through narrower ones
  // if newer migrations (einvoice_requests.sql, order_credit_note.sql)
  // haven't been applied yet, so the KPI grid keeps rendering.
  var res = await sb.from('salesweb_customer_orders')
    .select('id,status,total,amount_paid,updated_at,einvoice_requested_at,einvoice_uploaded_at,credit_note_flagged_at,credit_note_issued_at');
  if (res.error && /credit_note_|does not exist/i.test(res.error.message||'')){
    res = await sb.from('salesweb_customer_orders')
      .select('id,status,total,amount_paid,updated_at,einvoice_requested_at,einvoice_uploaded_at');
  }
  if (res.error && /einvoice_requested_at|does not exist/i.test(res.error.message||'')){
    res = await sb.from('salesweb_customer_orders').select('id,status,total,amount_paid,updated_at');
  }
  var all = res.data || [];

  var awaiting = all.filter(function(o){ return o.status==='Pending Payment'; });
  var einvReqs = all.filter(function(o){ return o.einvoice_requested_at && !o.einvoice_uploaded_at; });
  var paidNow  = all.filter(function(o){ return ['Paid','Ready for Collection','Completed'].indexOf(o.status) >= 0; });

  // Partially Paid — sum the per-order payments ledger so cases where
  // amount_paid lags behind the credit-bill payments still surface.
  var activeIds = all
    .filter(function(o){ return o.status !== 'Cancelled' && o.status !== 'Refunded'; })
    .map(function(o){ return o.id; });
  var paidById = {};
  if (activeIds.length){
    // Chunk to keep the .in() list under PostgREST's URL-length limit.
    for (var i = 0; i < activeIds.length; i += 500){
      var slice = activeIds.slice(i, i+500);
      var { data: pays } = await sb.from('salesweb_order_payments')
        .select('order_id, amount').in('order_id', slice);
      (pays||[]).forEach(function(p){
        paidById[p.order_id] = (paidById[p.order_id]||0) + (Number(p.amount)||0);
      });
    }
  }
  var partial = all.filter(function(o){
    if (o.status === 'Cancelled' || o.status === 'Refunded') return false;
    var tot = Number(o.total)||0;
    var paid = paidById[o.id] != null ? paidById[o.id] : (Number(o.amount_paid)||0);
    return tot > 0 && paid > 0 && paid < tot - 0.005;
  });
  var sumPartial = partial.reduce(function(s,o){
    var tot = Number(o.total)||0;
    var paid = paidById[o.id] != null ? paidById[o.id] : (Number(o.amount_paid)||0);
    return s + Math.max(0, tot - paid);
  }, 0);

  var monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  var paidMonth = paidNow.filter(function(o){
    var t = o.updated_at ? new Date(o.updated_at) : null;
    return t && t >= monthStart;
  });
  var einvIssuedMonth = all.filter(function(o){
    if (!o.einvoice_uploaded_at) return false;
    return new Date(o.einvoice_uploaded_at) >= monthStart;
  });

  // Credit-note open queue: refunded OR (cancelled + paid>0) OR flagged,
  // minus already-issued. Uses the same paidById we already built for
  // Partially Paid, plus explicit lookups for cancelled/refunded rows.
  var extraIds = all
    .filter(function(o){ return (o.status==='Cancelled'||o.status==='Refunded') && paidById[o.id]==null; })
    .map(function(o){ return o.id; });
  if (extraIds.length){
    for (var j = 0; j < extraIds.length; j += 500){
      var slice2 = extraIds.slice(j, j+500);
      var { data: pays2 } = await sb.from('salesweb_order_payments')
        .select('order_id, amount').in('order_id', slice2);
      (pays2||[]).forEach(function(p){
        paidById[p.order_id] = (paidById[p.order_id]||0) + (Number(p.amount)||0);
      });
    }
  }
  var creditOpen = all.filter(function(o){
    if (o.credit_note_issued_at) return false;
    var paid = paidById[o.id] != null ? paidById[o.id] : (Number(o.amount_paid)||0);
    return o.status === 'Refunded'
        || (o.status === 'Cancelled' && paid > 0)
        || !!o.credit_note_flagged_at;
  });

  var sumAwait = awaiting.reduce(function(s,o){ return s + (o.total||0); }, 0);
  var sumPaid  = paidMonth.reduce(function(s,o){ return s + (o.total||0); }, 0);

  document.getElementById('payment-stats').innerHTML =
    '<div class="stat-box"><div class="stat-label">Awaiting Verification</div><div class="stat-val" style="color:var(--amber)">'+awaiting.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Awaiting Value</div><div class="stat-val" style="color:var(--amber)">RM '+sumAwait.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Partially Paid</div><div class="stat-val" style="color:#1d4ed8;">'+partial.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Outstanding Value</div><div class="stat-val" style="color:#1d4ed8;">RM '+sumPartial.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Credit Note Pending</div><div class="stat-val" style="color:#b45309;">'+creditOpen.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">E-Invoice Requests</div><div class="stat-val" style="color:#7c5cbf;">'+einvReqs.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Verified This Month</div><div class="stat-val green">'+paidMonth.length+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">Verified Value (MTD)</div><div class="stat-val green">RM '+sumPaid.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
    '<div class="stat-box"><div class="stat-label">E-Invoices Issued (MTD)</div><div class="stat-val green">'+einvIssuedMonth.length+'</div></div>';
}

// ═══════════════════════════════════════
//  TAB TABLES
// ═══════════════════════════════════════
function renderAwaitingTable(orders){
  if (!orders.length){
    document.getElementById('payments-table').innerHTML =
      '<div class="loading">No orders awaiting verification.</div>';
    return;
  }
  var badge = (typeof orderBadgeCls === 'function') ? orderBadgeCls : function(){ return 'badge-amber'; };
  var html = '<table class="data-table"><thead><tr>'+
    '<th>Order</th><th>Customer</th><th>Placed</th><th>Method</th><th>Total</th><th>Status</th><th>Action</th>'+
    '</tr></thead><tbody>';
  orders.forEach(function(o){
    var shortId = o.order_number || (o.id||'').substring(0,8).toUpperCase();
    var idJs    = String(o.id||'').replace(/[\\'"<>]/g,'');
    var method  = o.payment_terms === 'credit'
      ? '<span class="badge badge-blue">📅 Credit</span>'
      : '<span class="badge badge-grey">💵 Cash / Transfer</span>';
    html += '<tr style="cursor:pointer;" onclick="openPaymentDetail(\''+idJs+'\')">'+
      '<td><strong>'+esc(shortId)+'</strong></td>'+
      '<td>'+esc(o.customer_name||o.billing_name||'—')+'<div style="font-size:11px;color:var(--ink4);">'+esc(o.customer_email||'')+'</div></td>'+
      '<td>'+fmtDate(o.created_at)+'</td>'+
      '<td>'+method+'</td>'+
      '<td><strong>RM '+(o.total||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</strong></td>'+
      '<td><span class="badge '+badge(o.status)+'">'+esc(o.status||'—')+'</span></td>'+
      '<td>'+
        '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openPaymentDetail(\''+idJs+'\')">Review</button> '+
        '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();markPayment(\''+idJs+'\',\'Paid\')">✓ Mark Paid</button>'+
      '</td>'+
    '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('payments-table').innerHTML = html;
}

// Partially Paid — some payment received but the order isn't fully
// settled. Columns spotlight Paid / Total / Outstanding so the
// accountant sees the gap at a glance without opening the row.
function renderPartialTable(orders){
  if (!orders.length){
    document.getElementById('payments-table').innerHTML =
      '<div class="loading">No partially-paid orders.</div>';
    return;
  }
  var badge = (typeof orderBadgeCls === 'function') ? orderBadgeCls : function(){ return 'badge-blue'; };
  var html = '<table class="data-table"><thead><tr>'+
    '<th>Order</th><th>Customer</th><th>Placed</th><th>Method</th>'+
    '<th style="text-align:right;">Paid</th><th style="text-align:right;">Total</th><th style="text-align:right;">Outstanding</th>'+
    '<th>Status</th><th>Action</th>'+
    '</tr></thead><tbody>';
  orders.forEach(function(o){
    var shortId = o.order_number || (o.id||'').substring(0,8).toUpperCase();
    var idJs    = String(o.id||'').replace(/[\\'"<>]/g,'');
    var method  = o.payment_terms === 'credit'
      ? '<span class="badge badge-blue">📅 Credit</span>'
      : '<span class="badge badge-grey">💵 Cash / Transfer</span>';
    var tot   = Number(o.total)||0;
    var paid  = Number(o._paidSoFar)||0;
    var outst = Math.max(0, tot - paid);
    var pct   = tot > 0 ? Math.min(100, Math.round((paid/tot)*100)) : 0;
    var paidCell =
      '<div style="font-weight:600;color:#047857;">RM '+paid.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div>'+
      '<div style="height:4px;background:#e5e7eb;border-radius:99px;margin-top:3px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:#1d4ed8;"></div></div>'+
      '<div style="font-size:10px;color:var(--ink4);margin-top:2px;">'+pct+'% paid</div>';
    html += '<tr style="cursor:pointer;" onclick="openPaymentDetail(\''+idJs+'\')">'+
      '<td><strong>'+esc(shortId)+'</strong></td>'+
      '<td>'+esc(o.customer_name||o.billing_name||'—')+'<div style="font-size:11px;color:var(--ink4);">'+esc(o.customer_email||'')+'</div></td>'+
      '<td>'+fmtDate(o.created_at)+'</td>'+
      '<td>'+method+'</td>'+
      '<td style="text-align:right;min-width:110px;">'+paidCell+'</td>'+
      '<td style="text-align:right;">RM '+tot.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
      '<td style="text-align:right;font-weight:600;color:#b91c1c;">RM '+outst.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
      '<td><span class="badge '+badge(o.status)+'">'+esc(o.status||'—')+'</span></td>'+
      '<td>'+
        '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openPaymentDetail(\''+idJs+'\')">Review</button>'+
      '</td>'+
    '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('payments-table').innerHTML = html;
}

// Credit Note tab — three surfaced buckets share this table:
//   refunded (auto), cancelled-with-payment (auto), flagged (manual).
// Each row shows the reason as an amber chip so the accountant knows
// why it's here before opening the modal.
function renderCreditNoteTable(orders){
  if (!orders.length){
    document.getElementById('payments-table').innerHTML =
      '<div class="loading">No credit notes pending.</div>';
    return;
  }
  var reasonChip = function(r){
    if (r === 'refunded')                return '<span class="badge" style="background:#fee2e2;color:#991b1b;border:1px solid #fecaca;">Refunded</span>';
    if (r === 'cancelled-with-payment')  return '<span class="badge" style="background:#fef3c7;color:#78350f;border:1px solid #fde68a;">Cancelled · Paid</span>';
    return '<span class="badge" style="background:#f5e6ff;color:#5b21b6;border:1px solid #ddd0f5;">Flagged</span>';
  };
  var html = '<table class="data-table"><thead><tr>'+
    '<th>Order</th><th>Customer</th><th>Reason</th>'+
    '<th style="text-align:right;">Order Amount</th><th style="text-align:right;">Received</th>'+
    '<th>Status</th><th>Action</th>'+
    '</tr></thead><tbody>';
  orders.forEach(function(o){
    var shortId = o.order_number || (o.id||'').substring(0,8).toUpperCase();
    var idJs    = String(o.id||'').replace(/[\\'"<>]/g,'');
    var tot     = Number(o.total)||0;
    var paid    = Number(o._paidSoFar)||0;
    var statusBadge = (typeof orderBadgeCls === 'function')
      ? '<span class="badge '+orderBadgeCls(o.status)+'">'+esc(o.status||'—')+'</span>'
      : '<span class="badge badge-grey">'+esc(o.status||'—')+'</span>';
    html += '<tr style="cursor:pointer;" onclick="openPaymentDetail(\''+idJs+'\')">'+
      '<td><strong>'+esc(shortId)+'</strong><div style="font-size:11px;color:var(--ink4);">'+fmtDate(o.created_at)+'</div></td>'+
      '<td>'+esc(o.customer_name||o.billing_name||'—')+'<div style="font-size:11px;color:var(--ink4);">'+esc(o.customer_email||'')+'</div></td>'+
      '<td>'+reasonChip(o._creditReason)+'</td>'+
      '<td style="text-align:right;">RM '+tot.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
      '<td style="text-align:right;font-weight:600;color:#047857;">RM '+paid.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
      '<td>'+statusBadge+'</td>'+
      '<td>'+
        '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openPaymentDetail(\''+idJs+'\')">Review</button> '+
        '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();markCreditNoteIssued(\''+idJs+'\')">✓ Mark Issued</button>'+
      '</td>'+
    '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('payments-table').innerHTML = html;
}

function renderEInvoiceTable(orders){
  if (!orders.length){
    document.getElementById('payments-table').innerHTML =
      '<div class="loading">No E-Invoice requests waiting.</div>';
    return;
  }
  var html = '<table class="data-table"><thead><tr>'+
    '<th>Order</th><th>Billing Name</th><th>TIN</th><th>Requested</th><th>Total</th><th>Days Left</th><th>Action</th>'+
    '</tr></thead><tbody>';
  var now = Date.now();
  orders.forEach(function(o){
    var shortId = o.order_number || (o.id||'').substring(0,8).toUpperCase();
    var idJs    = String(o.id||'').replace(/[\\'"<>]/g,'');
    // 5-day request window is per-customer policy; here we surface how
    // long the accountant has left before the request is considered
    // stale (informational — nothing enforces it server-side yet).
    var reqTs   = o.einvoice_requested_at ? new Date(o.einvoice_requested_at).getTime() : now;
    var msLeft  = (reqTs + 5*24*60*60*1000) - now;
    var days    = Math.ceil(msLeft / (24*60*60*1000));
    var daysCls = days <= 1 ? 'color:#b91c1c;font-weight:600;' : (days <= 2 ? 'color:#b45309;font-weight:600;' : 'color:var(--ink3);');
    html += '<tr style="cursor:pointer;" onclick="openEInvoiceReview(\''+idJs+'\')">'+
      '<td><strong>'+esc(shortId)+'</strong></td>'+
      '<td>'+esc(o.billing_name||o.customer_name||'—')+'</td>'+
      '<td>'+esc(o.billing_tax_id||'—')+'</td>'+
      '<td>'+fmtDate(o.einvoice_requested_at)+'</td>'+
      '<td><strong>RM '+(o.total||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</strong></td>'+
      '<td style="'+daysCls+'">'+(days>0?(days+' day'+(days===1?'':'s')):'expired')+'</td>'+
      '<td>'+
        '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openEInvoiceReview(\''+idJs+'\')">Open</button> '+
        '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();uploadEInvoiceFromPayments(\''+idJs+'\')">📤 Upload E-Invoice</button>'+
      '</td>'+
    '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('payments-table').innerHTML = html;
}

// ═══════════════════════════════════════
//  PAYMENT REVIEW MODAL (Awaiting tab)
// ═══════════════════════════════════════
async function openPaymentDetail(orderId){
  var modal = document.getElementById('modal-payment');
  if (!modal) { toast('Payment modal not initialised','error'); return; }
  modal.classList.add('open');
  var body = document.getElementById('payment-detail-body');
  body.innerHTML = '<div class="loading">Loading…</div>';
  body.setAttribute('data-order-id', orderId);

  var [{data: order}, {data: items}, {data: attachments}, {data: timeline}, {data: bills}, {data: payments}] = await Promise.all([
    sb.from('salesweb_customer_orders').select('*').eq('id', orderId).single(),
    sb.from('salesweb_order_items').select('*').eq('order_id', orderId),
    sb.from('salesweb_order_attachments').select('*').eq('order_id', orderId).order('created_at', {ascending: false}),
    sb.from('salesweb_order_timeline').select('*').eq('order_id', orderId).order('created_at', {ascending: false}),
    sb.from('salesweb_credit_bills').select('*').eq('order_id', orderId).order('bill_date', {ascending: true}),
    sb.from('salesweb_order_payments').select('*').eq('order_id', orderId)
  ]);

  if (!order){ body.innerHTML = '<div class="loading">Order not found.</div>'; return; }

  body.innerHTML = renderPaymentReview(order, items||[], attachments||[], timeline||[], bills||[], payments||[]);
}
window.openPaymentDetail = openPaymentDetail;

// E-Invoice review reuses the same modal — just adds an emphasised
// Upload E-Invoice button (calls openEInvoiceUpload from admin-orders.js).
async function openEInvoiceReview(orderId){
  await openPaymentDetail(orderId);
  var body = document.getElementById('payment-detail-body');
  if (!body) return;
  var banner = document.createElement('div');
  banner.style.cssText = 'margin-bottom:1rem;padding:.7rem 1rem;background:#f5f0ff;border:1px solid #d5c5f5;border-left:4px solid #7c5cbf;border-radius:8px;color:#4c1d95;font-size:13px;';
  banner.innerHTML = '<strong>E-Invoice requested by customer.</strong> Upload the LHDN-compliant E-Invoice PDF below to mark this request done.';
  body.insertBefore(banner, body.firstChild);
}
window.openEInvoiceReview = openEInvoiceReview;

function renderPaymentReview(order, items, attachments, timeline, bills, payments){
  var badge   = (typeof orderBadgeCls === 'function') ? orderBadgeCls : function(){ return 'badge-grey'; };
  var shortId = order.order_number || order.id.substring(0,8).toUpperCase();
  var method  = order.payment_terms === 'credit' ? 'Credit Terms' : 'Cash / Bank Transfer';
  var idJs    = String(order.id||'').replace(/[\\'"<>]/g,'');
  var isCredit = order.payment_terms === 'credit';

  // ── Payment Tracking totals ──
  var tot  = Number(order.total)||0;
  var paid = (payments||[]).reduce(function(s,p){ return s + (Number(p.amount)||0); }, 0);
  if (!paid) paid = Number(order.amount_paid)||0;
  var outstanding = Math.max(0, tot - paid);
  var paidPct = tot > 0 ? Math.min(100, Math.round((paid/tot)*100)) : 0;
  var payBadge = paid >= tot && tot > 0 ? '<span class="badge badge-green">PAID</span>'
               : paid > 0 ? '<span class="badge badge-blue">PARTIAL</span>'
               : '<span class="badge badge-amber">UNPAID</span>';

  // ── Customer block ──
  var custHtml = ''+
    '<div><strong>'+esc(order.customer_name||order.billing_name||'—')+'</strong></div>'+
    (order.billing_name && order.billing_name!==order.customer_name ? '<div style="color:var(--ink3);font-size:12px;">Billing: '+esc(order.billing_name)+'</div>' : '')+
    (order.customer_email ? '<div style="color:var(--ink3);font-size:12px;">'+esc(order.customer_email)+'</div>' : '')+
    (order.billing_tax_id ? '<div style="color:var(--ink3);font-size:12px;">TIN: '+esc(order.billing_tax_id)+'</div>' : '')+
    (order.shipping_address ? '<div style="color:var(--ink3);font-size:12px;margin-top:.3rem;">'+esc(order.shipping_address)+'</div>' : '');

  // ── Order items table ──
  var itemsHtml;
  if (items.length){
    var subtotal = items.reduce(function(s,it){ return s + (Number(it.subtotal)||0); }, 0);
    var discount = (Number(order.discount_amount)||0) + (Number(order.coupon_discount)||0) + (Number(order.points_discount_rm)||0);
    itemsHtml =
      '<table class="data-table" style="font-size:12px;">'+
        '<thead><tr><th>Product</th><th style="text-align:right;">Price</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Subtotal</th></tr></thead>'+
        '<tbody>'+ items.map(function(it){
          return '<tr>'+
            '<td>'+esc(it.product_name||'—')+'</td>'+
            '<td style="text-align:right;">RM '+(Number(it.unit_price)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
            '<td style="text-align:right;">'+(Number(it.quantity)||0).toLocaleString('en-MY')+'</td>'+
            '<td style="text-align:right;">RM '+(Number(it.subtotal)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
          '</tr>';
        }).join('') +'</tbody>'+
        '<tfoot>'+
          '<tr><td colspan="3" style="text-align:right;">Subtotal</td><td style="text-align:right;">RM '+subtotal.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td></tr>'+
          (discount>0 ? '<tr><td colspan="3" style="text-align:right;color:#b91c1c;">Discount</td><td style="text-align:right;color:#b91c1c;">-RM '+discount.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td></tr>' : '')+
          '<tr><td colspan="3" style="text-align:right;"><strong>Total</strong></td><td style="text-align:right;"><strong>RM '+tot.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</strong></td></tr>'+
        '</tfoot>'+
      '</table>';
  } else {
    itemsHtml = '<div style="color:var(--ink4);font-size:12px;">No items on this order.</div>';
  }

  // ── Credit — Monthly Invoice Breakdown (fully functional) ──
  // Mirrors the block in admin-orders.js so the accountant never has
  // to leave Payments to key in invoice numbers, add per-bill
  // payments, edit, or delete. Buttons call the same window-scoped
  // handlers (openCreditBillModal / openAddPaymentModal /
  // deleteCreditBill / deletePaymentEntry) which refreshOrderContext()
  // now re-renders THIS modal on completion instead of viewOrder.
  var creditHtml = '';
  if (isCredit){
    var billedSum = bills.reduce(function(s,b){ return s + (Number(b.amount)||0); }, 0);
    var billedRem = Math.max(0, tot - billedSum);
    // Bucket the payment ledger by bill_id so each bill shows its own
    // paid amount, fully-paid pill, and nested payment rows.
    var paysByBill = {};
    var unlinkedPays = [];
    payments.forEach(function(p){
      if (p.bill_id){ (paysByBill[p.bill_id] = paysByBill[p.bill_id] || []).push(p); }
      else { unlinkedPays.push(p); }
    });

    var addBillBtn = tot > 0 && billedSum < tot
      ? '<button class="btn btn-primary btn-sm" onclick="openCreditBillModal(\''+idJs+'\','+billedRem.toFixed(2)+')" style="font-size:11px;padding:5px 10px;">+ Add Bill</button>'
      : '<span class="badge" style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;font-size:10px;">Fully Billed</span>';

    var billsRowsHtml = '';
    if (bills.length){
      billsRowsHtml += '<table class="data-table" style="font-size:12px;"><thead><tr>'+
        '<th>Date</th><th>Invoice No.</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Amount</th><th style="text-align:right;">Paid</th><th style="text-align:right;">Action</th>'+
      '</tr></thead><tbody>';
      bills.forEach(function(b){
        var bidJs   = String(b.id||'').replace(/[\\'"<>]/g,'');
        var billPays= paysByBill[b.id] || [];
        var billPaid= billPays.reduce(function(s,p){ return s + (Number(p.amount)||0); }, 0);
        var billAmt = Number(b.amount)||0;
        var billBal = Math.max(0, billAmt - billPaid);
        var fullyPaid = billAmt > 0 && billPaid >= billAmt - 0.005;   // 0.5-sen tolerance
        var actionCell = fullyPaid
          ? '<span class="badge" style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;font-size:10px;padding:3px 8px;">✓ Fully Paid</span>'
          : ('<button class="btn btn-primary btn-sm" onclick="openAddPaymentModal(\''+idJs+'\','+billBal.toFixed(2)+',\''+bidJs+'\')" style="font-size:10px;padding:2px 8px;margin-right:.2rem;">+ Add Payment</button>'+
             '<button class="btn btn-outline btn-sm" onclick="openCreditBillModal(\''+idJs+'\',null,\''+bidJs+'\')" style="font-size:10px;padding:2px 6px;margin-right:.2rem;">Edit</button>'+
             '<button class="btn btn-outline btn-sm" style="font-size:10px;padding:2px 6px;color:var(--red);border-color:var(--red);" onclick="deleteCreditBill(\''+bidJs+'\',\''+idJs+'\')">✕</button>');
        billsRowsHtml += '<tr>'+
          '<td>'+esc(String(b.bill_date||'').substring(0,10))+'</td>'+
          '<td>'+esc(b.invoice_no||'—')+'</td>'+
          '<td style="text-align:right;">'+(Number(b.qty)||0).toLocaleString()+'</td>'+
          '<td style="text-align:right;font-weight:600;">RM '+(billAmt).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
          '<td style="text-align:right;color:'+(billPaid>0?'var(--green)':'var(--ink4)')+';font-weight:600;">RM '+(billPaid).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
          '<td style="text-align:right;white-space:nowrap;">'+actionCell+'</td>'+
        '</tr>';
        // Nested payment rows for this bill
        billPays.forEach(function(p){
          var rid = String(p.id||'').replace(/[\\'"<>]/g,'');
          var hasAtt = !!p.attachment_url;
          var attCell = '<span style="color:var(--ink4);">—</span>';
          var rowClick = '', rowStyle = 'background:#fafafa;';
          if (hasAtt){
            var u = String(p.attachment_url).replace(/'/g,'%27');
            var n = String(p.attachment_name||'document').replace(/'/g,'\\\'');
            attCell = '<span style="color:var(--green);">📎 '+esc(p.attachment_name||'document')+'</span>';
            rowClick = ' onclick="openAttachmentPreview(\''+u+'\',\''+n+'\',\'\');"';
            rowStyle += 'cursor:pointer;';
          }
          billsRowsHtml += '<tr style="'+rowStyle+'"'+rowClick+'>'+
            '<td colspan="2" style="padding-left:1.5rem;font-size:11px;color:var(--ink3);">↳ '+esc(fmtDate(p.paid_at))+'</td>'+
            '<td colspan="2" style="font-size:11px;">'+attCell+'</td>'+
            '<td style="text-align:right;font-size:11px;font-weight:600;color:var(--green);">RM '+(Number(p.amount)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
            '<td style="text-align:right;">'+
              '<button class="btn btn-outline btn-sm" style="font-size:10px;padding:2px 6px;color:var(--red);border-color:var(--red);" onclick="event.stopPropagation();deletePaymentEntry(\''+rid+'\',\''+idJs+'\')">✕</button>'+
            '</td>'+
          '</tr>';
        });
      });
      // Legacy unlinked payments (recorded before per-bill link existed).
      if (unlinkedPays.length){
        billsRowsHtml += '<tr style="background:#fff7ed;"><td colspan="6" style="font-size:11px;font-weight:600;color:#9a3412;padding-top:.4rem;">Unlinked payments (not tied to a specific invoice)</td></tr>';
        unlinkedPays.forEach(function(p){
          var rid = String(p.id||'').replace(/[\\'"<>]/g,'');
          var hasAtt = !!p.attachment_url;
          var attCell = '<span style="color:var(--ink4);">—</span>';
          var rowClick = '', rowStyle = 'background:#fff7ed;';
          if (hasAtt){
            var u = String(p.attachment_url).replace(/'/g,'%27');
            var n = String(p.attachment_name||'document').replace(/'/g,'\\\'');
            attCell = '<span style="color:var(--green);">📎 '+esc(p.attachment_name||'document')+'</span>';
            rowClick = ' onclick="openAttachmentPreview(\''+u+'\',\''+n+'\',\'\');"';
            rowStyle += 'cursor:pointer;';
          }
          billsRowsHtml += '<tr style="'+rowStyle+'"'+rowClick+'>'+
            '<td colspan="2" style="font-size:11px;color:var(--ink3);">'+esc(fmtDate(p.paid_at))+'</td>'+
            '<td colspan="2" style="font-size:11px;">'+attCell+'</td>'+
            '<td style="text-align:right;font-weight:600;color:var(--green);">RM '+(Number(p.amount)||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</td>'+
            '<td style="text-align:right;"><button class="btn btn-outline btn-sm" style="font-size:10px;padding:2px 6px;color:var(--red);border-color:var(--red);" onclick="event.stopPropagation();deletePaymentEntry(\''+rid+'\',\''+idJs+'\')">✕</button></td>'+
          '</tr>';
        });
      }
      billsRowsHtml += '</tbody></table>';
    } else {
      billsRowsHtml = '<div style="font-size:12px;color:var(--ink4);padding:.3rem 0;">No bills yet. Click <strong>+ Add Bill</strong> to log the first one.</div>';
    }

    creditHtml =
      '<div style="margin-top:1.2rem;padding:.9rem 1rem;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">'+
          '<div style="font-weight:600;color:#1d4ed8;font-size:13px;">Credit — Monthly Invoice Breakdown</div>'+
          '<span style="font-size:11px;color:var(--ink3);">Order placed '+fmtDate(order.created_at)+'</span>'+
        '</div>'+
        '<div style="background:#fff;border:1px solid #dbeafe;border-radius:8px;padding:.6rem .8rem;">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem;">'+
            '<div style="font-size:12px;font-weight:600;">Billings ('+bills.length+' entr'+(bills.length===1?'y':'ies')+')</div>'+
            addBillBtn+
          '</div>'+
          billsRowsHtml+
        '</div>'+
      '</div>';
  }

  // ── Attached documents (bidirectional with order detail) ──
  var attHtml = attachments.length
    ? attachments.map(function(a){
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .6rem;border:1px solid var(--border);border-radius:8px;margin-bottom:.3rem;font-size:12px;">'+
                 '<a href="'+esc(a.file_url)+'" target="_blank" rel="noopener" style="color:var(--ink2);text-decoration:none;">📎 '+esc(a.file_name||'file')+'</a>'+
                 '<span style="color:var(--ink4);font-size:11px;">'+fmtDate(a.created_at)+'</span>'+
               '</div>';
      }).join('')
    : '<div style="color:var(--ink4);font-size:12px;">No documents uploaded yet.</div>';

  // ── E-Invoice status inside the modal ──
  var einvHtml = '';
  if (order.einvoice_uploaded_at && order.einvoice_url){
    einvHtml = '<div style="margin-top:.3rem;color:#15803d;font-size:12px;">✓ E-Invoice issued — <a href="'+esc(order.einvoice_url)+'" target="_blank" rel="noopener" style="color:#15803d;text-decoration:underline;">View</a></div>';
  } else if (order.einvoice_requested_at){
    einvHtml = '<div style="margin-top:.3rem;color:#b45309;font-size:12px;">⏳ E-Invoice requested — awaiting upload.</div>';
  }

  var timelineHtml = timeline.length
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
  // Credit-note actions — visible on every open order:
  //   - Flag / Unflag (manual "needs credit note" toggle for orders
  //     that aren't Refunded/Cancelled but still need one).
  //   - Mark Credit Note Issued (only when the row is currently in
  //     the Credit Note tab's open queue; hides the row afterwards).
  var isCnIssued  = !!order.credit_note_issued_at;
  var isCnFlagged = !!order.credit_note_flagged_at;
  var paidTotal   = (payments||[]).reduce(function(s,p){ return s+(Number(p.amount)||0); }, 0)
                   || Number(order.amount_paid)||0;
  var inCnQueue   = !isCnIssued && (order.status==='Refunded'
                                 || (order.status==='Cancelled' && paidTotal>0)
                                 || isCnFlagged);

  return ''+
    // Row 1 — Customer + Order + Payment
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1rem;">'+
      '<div>'+
        '<div class="mp-section-title">Customer</div>'+
        '<div style="font-size:13px;line-height:1.7;">'+custHtml+'</div>'+
      '</div>'+
      '<div>'+
        '<div class="mp-section-title">Order</div>'+
        '<div style="font-size:13px;line-height:1.7;">'+
          '<div><strong>'+esc(shortId)+'</strong> <span class="badge '+badge(order.status)+'" style="margin-left:.4rem;">'+esc(order.status||'—')+'</span></div>'+
          '<div style="color:var(--ink3);">Placed '+fmtDate(order.created_at)+'</div>'+
          '<div style="color:var(--ink3);">Method: <strong>'+esc(method)+'</strong></div>'+
          einvHtml+
        '</div>'+
      '</div>'+
    '</div>'+

    // Row 2 — Payment Tracking box
    '<div style="margin-bottom:1rem;padding:.9rem 1rem;background:#faf6ff;border:1px solid #ecd9f5;border-radius:10px;">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;">'+
        '<div style="font-weight:600;font-size:13px;">Payment Tracking</div>'+
        payBadge+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.8rem;font-size:12px;">'+
        '<div><div style="color:var(--ink4);text-transform:uppercase;font-size:10px;letter-spacing:.05em;">Order Amount</div><div style="font-weight:600;font-size:14px;">RM '+tot.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
        '<div><div style="color:var(--ink4);text-transform:uppercase;font-size:10px;letter-spacing:.05em;">Amount Paid</div><div style="font-weight:600;font-size:14px;color:#047857;">RM '+paid.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
        '<div><div style="color:var(--ink4);text-transform:uppercase;font-size:10px;letter-spacing:.05em;">Outstanding</div><div style="font-weight:600;font-size:14px;color:'+(outstanding>0?'#b91c1c':'#047857')+';">RM '+outstanding.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>'+
      '</div>'+
      '<div style="margin-top:.6rem;height:6px;background:#f0e6f7;border-radius:999px;overflow:hidden;">'+
        '<div style="height:100%;width:'+paidPct+'%;background:linear-gradient(90deg,#7c5cbf,#a680d4);"></div>'+
      '</div>'+
    '</div>'+

    // Row 3 — Order items
    '<div style="margin-bottom:1rem;">'+
      '<div class="mp-section-title">Order Items</div>'+
      itemsHtml+
    '</div>'+

    // Row 4 — Credit bills (credit only)
    creditHtml +

    // Row 5 — Documents (bidirectional with order Attached Documents)
    '<div style="margin-top:1.2rem;">'+
      '<div class="mp-section-title">Documents</div>'+
      '<div id="pay-attach-list">'+attHtml+'</div>'+
      '<div style="margin-top:.6rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;">'+
        '<input type="file" id="pay-attach-input" multiple style="font-size:12px;">'+
        '<button class="btn btn-primary btn-sm" onclick="uploadPaymentAttachments(\''+idJs+'\')">📤 Upload</button>'+
        ((order.einvoice_requested_at && !order.einvoice_uploaded_at) ?
          '<button class="btn btn-outline btn-sm" style="border-color:#7c5cbf;color:#7c5cbf;" onclick="uploadEInvoiceFromPayments(\''+idJs+'\')">📄 Upload E-Invoice (mark done)</button>' : '')+
      '</div>'+
      '<div style="font-size:11px;color:var(--ink4);margin-top:.4rem;">Uploads are attached to the customer order and shown under Attached Documents.</div>'+
    '</div>'+

    // Row 6 — Internal notes
    '<div style="margin-top:1.2rem;">'+
      '<div class="mp-section-title">Internal Notes</div>'+
      '<textarea id="payment-internal-note" class="form-input" style="width:100%;min-height:70px;font-family:inherit;font-size:13px;" placeholder="Accountant notes (not visible to customer)">'+esc(order.internal_notes||'')+'</textarea>'+
      '<button class="btn btn-outline btn-sm" style="margin-top:.4rem;" onclick="savePaymentNote()">Save Note</button>'+
    '</div>'+

    // Row 7 — Timeline
    '<div style="margin-top:1.2rem;">'+
      '<div class="mp-section-title">Recent Timeline</div>'+
      timelineHtml+
    '</div>'+

    // Row 8 — Actions
    '<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;">'+
      (canPaid   ? '<button class="btn btn-outline btn-sm" style="background:var(--green);color:#fff;border-color:var(--green);" onclick="markPayment(\''+idJs+'\',\'Paid\',true)">✓ Mark as Paid</button>' : '')+
      (canUnpaid ? '<button class="btn btn-outline btn-sm" onclick="markPayment(\''+idJs+'\',\'Pending Payment\',true)">Revert to Unpaid</button>' : '')+
      (isCnIssued
        ? '<span class="badge" style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;padding:.35rem .6rem;">✓ Credit Note Issued '+esc(fmtDate(order.credit_note_issued_at))+'</span>'
        : ((isCnFlagged
             ? '<button class="btn btn-outline btn-sm" onclick="toggleCreditNoteFlag(\''+idJs+'\',false)">Unflag Credit Note</button>'
             : '<button class="btn btn-outline btn-sm" style="border-color:#b45309;color:#b45309;" onclick="toggleCreditNoteFlag(\''+idJs+'\',true)">Flag for Credit Note</button>')
          + (inCnQueue
              ? ' <button class="btn btn-outline btn-sm" style="background:#b45309;color:#fff;border-color:#b45309;" onclick="markCreditNoteIssued(\''+idJs+'\',true)">✓ Mark Credit Note Issued</button>'
              : ''))+
      '<button class="btn btn-outline btn-sm" onclick="closeModal(\'modal-payment\')">Close</button>'+
    '</div>';
}

// ═══════════════════════════════════════
//  UPLOADS
// ═══════════════════════════════════════
// Payment-tab uploads land in salesweb_order_attachments so they appear
// in the order detail's Attached Documents strip (same table admin-orders.js
// uploads to — one source of truth).
async function uploadPaymentAttachments(orderId){
  var input = document.getElementById('pay-attach-input');
  var files = input && input.files;
  if (!files || !files.length){ toast('Choose one or more files first','error'); return; }
  toast('Uploading '+files.length+' file'+(files.length===1?'':'s')+'…');

  var session = await sb.auth.getSession();
  var user = session?.data?.session?.user?.email || 'accountant';
  var rows = [], ok = 0, failed = [];
  for (var i = 0; i < files.length; i++){
    var file = files[i];
    var ext  = (file.name.split('.').pop()||'bin').toLowerCase();
    var tag  = Math.random().toString(36).slice(2,5);
    var key  = 'payment_'+orderId.substring(0,8)+'_'+Date.now()+'_'+i+'_'+tag+'.'+ext;
    var up = await sb.storage.from('order-attachments').upload(key, file, { contentType:file.type, upsert:true });
    if (up.error){ failed.push(file.name); continue; }
    var pub = sb.storage.from('order-attachments').getPublicUrl(key);
    var url = pub && pub.data && pub.data.publicUrl;
    rows.push({order_id:orderId, file_name:file.name, file_url:url||'', file_type:file.type, uploaded_by:user});
    ok++;
  }
  if (rows.length){
    var ins = await sb.from('salesweb_order_attachments').insert(rows);
    if (ins.error){ toast('DB insert failed: '+ins.error.message,'error'); return; }
  }
  input.value = '';
  if (ok && !failed.length) toast(ok===1 ? 'File uploaded' : ok+' files uploaded');
  else if (ok && failed.length) toast(ok+' uploaded · '+failed.length+' failed','error');
  else toast('Upload failed','error');

  // Re-open the same modal so the fresh attachments list renders.
  openPaymentDetail(orderId);
}
window.uploadPaymentAttachments = uploadPaymentAttachments;

// One-click E-Invoice upload from the Payments workspace. Reuses the
// existing openEInvoiceUpload helper on admin-orders.js which:
//   1. Uploads the PDF to storage
//   2. Calls mark_einvoice_uploaded RPC (stamps einvoice_uploaded_at
//      + einvoice_url + einvoice_name on the order row)
// After it returns we also drop a row into salesweb_order_attachments
// so the customer sees the E-Invoice in their Attached Documents list.
async function uploadEInvoiceFromPayments(orderId){
  if (typeof window.openEInvoiceUpload !== 'function'){
    toast('E-Invoice uploader not available on this page','error');
    return;
  }
  // openEInvoiceUpload opens a file picker + updates the order row.
  // When it finishes, refresh the payment list + re-open the modal.
  var beforeUp = Date.now();
  window.openEInvoiceUpload(orderId);
  // Poll for the row change so we can mirror it into attachments +
  // refresh the UI once the upload lands. Timeout after 90s.
  var deadline = Date.now() + 90000;
  var mirrored = false;
  var interval = setInterval(async function(){
    if (Date.now() > deadline){ clearInterval(interval); return; }
    var { data: fresh } = await sb.from('salesweb_customer_orders')
      .select('einvoice_url,einvoice_name,einvoice_uploaded_at')
      .eq('id', orderId).maybeSingle();
    if (!fresh || !fresh.einvoice_uploaded_at) return;
    var ts = new Date(fresh.einvoice_uploaded_at).getTime();
    if (ts < beforeUp) return;   // pre-existing upload; not the one we just kicked off
    clearInterval(interval);
    if (!mirrored){
      mirrored = true;
      var session = await sb.auth.getSession();
      var user = session?.data?.session?.user?.email || 'accountant';
      // Best-effort mirror. Ignore duplicate errors — the E-Invoice row
      // already lives on the order via einvoice_url so this is only a
      // convenience for the Attached Documents strip.
      try {
        await sb.from('salesweb_order_attachments').insert([{
          order_id: orderId,
          file_name: fresh.einvoice_name || 'E-Invoice.pdf',
          file_url:  fresh.einvoice_url,
          file_type: 'application/pdf',
          uploaded_by: user
        }]);
      } catch(_){ /* ignore */ }
    }
    loadPayments();
    openPaymentDetail(orderId);
  }, 1500);
}
window.uploadEInvoiceFromPayments = uploadEInvoiceFromPayments;

// ═══════════════════════════════════════
//  MUTATIONS — mark paid / unpaid
// ═══════════════════════════════════════
async function markPayment(orderId, newStatus, fromModal){
  var verb = newStatus === 'Paid' ? 'verify payment for' : 'revert to unpaid';
  if (!confirm('Are you sure you want to '+verb+' this order?')) return;

  var nowIso = new Date().toISOString();
  var { error } = await sb.from('salesweb_customer_orders')
    .update({ status: newStatus, updated_at: nowIso })
    .eq('id', orderId);
  if (error) { toast('Update failed: '+error.message, 'error'); return; }

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
window.markPayment = markPayment;

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
window.savePaymentNote = savePaymentNote;

// ═══════════════════════════════════════
//  CREDIT NOTE — flag / mark issued
// ═══════════════════════════════════════
// Both write directly to timestamp columns added in
// supabase/migrations/order_credit_note.sql. On error we surface the
// missing-migration case with an actionable toast so the accountant
// knows the fix instead of chasing a raw column error.
async function toggleCreditNoteFlag(orderId, on){
  var patch = on ? { credit_note_flagged_at: new Date().toISOString() }
                 : { credit_note_flagged_at: null };
  patch.updated_at = new Date().toISOString();
  var { error } = await sb.from('salesweb_customer_orders').update(patch).eq('id', orderId);
  if (error){
    if (/credit_note_|does not exist/i.test(error.message||'')){
      toast('Credit Note tracking not installed yet — run order_credit_note.sql then NOTIFY pgrst','error');
    } else {
      toast('Flag failed: '+error.message,'error');
    }
    return;
  }
  toast(on ? 'Flagged for Credit Note' : 'Credit Note flag cleared');
  openPaymentDetail(orderId);
  loadPayments();
}
window.toggleCreditNoteFlag = toggleCreditNoteFlag;

async function markCreditNoteIssued(orderId, fromModal){
  if (!confirm('Mark this order\'s Credit Note as issued? The row will move out of the Credit Note tab.')) return;
  var nowIso = new Date().toISOString();
  var { error } = await sb.from('salesweb_customer_orders')
    .update({ credit_note_issued_at: nowIso, updated_at: nowIso })
    .eq('id', orderId);
  if (error){
    if (/credit_note_|does not exist/i.test(error.message||'')){
      toast('Credit Note tracking not installed yet — run order_credit_note.sql then NOTIFY pgrst','error');
    } else {
      toast('Save failed: '+error.message,'error');
    }
    return;
  }
  // Audit trail — best-effort.
  try{
    var session = await sb.auth.getSession();
    var actor   = session?.data?.session?.user?.email || 'accountant';
    await sb.from('salesweb_order_timeline').insert([{
      order_id: orderId,
      status:   'Credit Note Issued',
      note:     'Credit Note marked issued by ' + actor,
      changed_by: actor
    }]);
  }catch(_){ /* non-fatal */ }
  toast('✓ Credit Note marked issued');
  if (fromModal) closeModal('modal-payment');
  loadPayments();
}
window.markCreditNoteIssued = markCreditNoteIssued;
