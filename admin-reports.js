// ═══════════════════════════════════════════════════════════════════
//  ADMIN — REPORTS TAB
// ═══════════════════════════════════════════════════════════════════
// Sales report dashboard. All metrics are read live from
// salesweb_customer_orders + salesweb_order_items inside the chosen date
// range (defaults: this month). Cancelled orders are excluded from every
// money/quantity total — they reflect orders the business didn't fulfil.
//
// Sections, matching the EasyStore-style report:
//   • Headline tiles (Gross/Net sales, Orders, Avg Order Value, Units,
//     Unique Customers, Avg Selling Price)
//   • Sales by Channel
//   • Sales by Payment Terms
//   • Sales by Payment Status
//   • New vs Repeat Customer split
//   • Top Products by Revenue / by Units Sold
//   • Top Customers
//   • Monthly Breakdown — orders / revenue / units / Avg Selling Price
//
// The date-range filter has presets (Today, 7d, 30d, This Month, This
// Year, All time) and From/To inputs. Export CSV writes the monthly
// breakdown to a downloadable CSV.

var _rpt = {
  from: null,
  to:   null,
  preset: 'this_month',
  orders: [],
  items: [],
  productsById: {},
  customerLifetime: {}   // customer_id → earliest paid order date
};

function _rptFmtMYR(n){
  return (Number(n)||0).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function _rptFmtInt(n){
  return (Number(n)||0).toLocaleString('en-MY');
}
function _rptYmd(d){
  if(!d) return '';
  var pad=function(x){return ('0'+x).slice(-2);};
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
}
function _rptParseYmd(s){
  if(!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m) return null;
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), 0, 0, 0, 0);
}

// Compute the From/To pair for a preset key. End-of-day for `to` so the
// filter is inclusive of orders placed late on the chosen day.
function _rptPresetRange(key){
  var now = new Date();
  var startOfDay = function(d){ d.setHours(0,0,0,0); return d; };
  var endOfDay   = function(d){ d.setHours(23,59,59,999); return d; };
  var from, to = endOfDay(new Date(now));
  switch(key){
    case 'today':
      from = startOfDay(new Date(now));
      break;
    case 'last_7':
      from = startOfDay(new Date(now.getTime() - 6*86400000));
      break;
    case 'last_30':
      from = startOfDay(new Date(now.getTime() - 29*86400000));
      break;
    case 'this_month':
      from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      break;
    case 'last_month':
      from = startOfDay(new Date(now.getFullYear(), now.getMonth()-1, 1));
      to   = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      break;
    case 'this_year':
      from = startOfDay(new Date(now.getFullYear(), 0, 1));
      break;
    case 'all_time':
      from = new Date(2020, 0, 1);
      break;
    default:
      from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  return {from:from, to:to};
}

// Entry point — wires the preset to the date inputs and loads data.
async function loadReports(){
  if(!_rpt.from){
    var r = _rptPresetRange(_rpt.preset);
    _rpt.from = r.from; _rpt.to = r.to;
  }
  var fromInp = document.getElementById('rpt-from');
  var toInp   = document.getElementById('rpt-to');
  if(fromInp) fromInp.value = _rptYmd(_rpt.from);
  if(toInp)   toInp.value   = _rptYmd(_rpt.to);
  _rptHighlightPreset();
  await _rptFetchData();
  _rptRender();
}

function _rptHighlightPreset(){
  ['today','last_7','last_30','this_month','last_month','this_year','all_time'].forEach(function(k){
    var btn = document.getElementById('rpt-preset-'+k);
    if(btn){
      btn.style.background = (_rpt.preset===k) ? 'var(--ink2)' : '#fff';
      btn.style.color      = (_rpt.preset===k) ? '#fff' : 'var(--ink2)';
    }
  });
}

function applyReportPreset(key){
  _rpt.preset = key;
  var r = _rptPresetRange(key);
  _rpt.from = r.from; _rpt.to = r.to;
  loadReports();
}

// Custom From/To handler — clicks "Apply" after typing custom dates.
function applyReportRange(){
  var f = _rptParseYmd(document.getElementById('rpt-from').value);
  var t = _rptParseYmd(document.getElementById('rpt-to').value);
  if(!f || !t){ toast('Pick both a From and a To date','error'); return; }
  if(f > t){ toast('From must be on or before To','error'); return; }
  t.setHours(23,59,59,999);
  _rpt.from = f; _rpt.to = t; _rpt.preset = 'custom';
  _rptHighlightPreset();
  _rptFetchData().then(_rptRender);
}

async function _rptFetchData(){
  var box = document.getElementById('reports-body');
  if(box) box.innerHTML = '<div class="loading">Loading report…</div>';

  var fromIso = _rpt.from.toISOString();
  var toIso   = _rpt.to.toISOString();

  // Orders in range — exclude cancelled at query time (the SQL is small,
  // the JS aggregation stays linear).
  var{data:orders, error:oErr} = await sb.from('salesweb_customer_orders')
    .select('id,order_number,customer_id,customer_name,customer_email,total,channel,payment_terms,status,discount_amount,coupon_discount,coupon_code,points_discount_rm,amount_paid,created_at')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', {ascending:false});
  if(oErr){ if(box) box.innerHTML = '<div class="loading">Failed to load orders: '+oErr.message+'</div>'; return; }
  orders = (orders||[]).filter(function(o){ return o.status !== 'Cancelled'; });
  _rpt.orders = orders;

  // Items belonging to those orders.
  var ids = orders.map(function(o){return o.id;});
  var items = [];
  if(ids.length){
    var CHUNK = 200;
    for(var i=0;i<ids.length;i+=CHUNK){
      var slice = ids.slice(i, i+CHUNK);
      var{data:rows} = await sb.from('salesweb_order_items')
        .select('order_id,product_id,product_name,quantity,unit_price,subtotal')
        .in('order_id', slice);
      if(rows) items = items.concat(rows);
    }
  }
  _rpt.items = items;

  // New vs Repeat customer split — look at each customer's earliest
  // non-cancelled order ever; if that earliest order falls inside the
  // range, this is a "new" customer; otherwise repeat. Guest orders
  // (no customer_id) bucket into "new".
  var custIds = Array.from(new Set(orders.map(function(o){return o.customer_id;}).filter(Boolean)));
  _rpt.customerLifetime = {};
  if(custIds.length){
    var CHUNK2 = 200;
    for(var j=0;j<custIds.length;j+=CHUNK2){
      var slice2 = custIds.slice(j, j+CHUNK2);
      var{data:firstOrders} = await sb.from('salesweb_customer_orders')
        .select('customer_id,created_at')
        .in('customer_id', slice2)
        .neq('status','Cancelled')
        .order('created_at',{ascending:true});
      (firstOrders||[]).forEach(function(r){
        var cur = _rpt.customerLifetime[r.customer_id];
        if(!cur || new Date(r.created_at) < new Date(cur)) _rpt.customerLifetime[r.customer_id] = r.created_at;
      });
    }
  }
}

function _rptRender(){
  var box = document.getElementById('reports-body');
  if(!box) return;
  var orders = _rpt.orders, items = _rpt.items;

  var gross = orders.reduce(function(s,o){return s+(Number(o.total)||0);},0);
  var totalDiscounts = orders.reduce(function(s,o){
    return s+(Number(o.discount_amount)||0)+(Number(o.coupon_discount)||0)+(Number(o.points_discount_rm)||0);
  },0);
  var itemsRevenue = items.reduce(function(s,i){return s+(Number(i.subtotal)||0);},0);
  var unitsSold = items.reduce(function(s,i){return s+(Number(i.quantity)||0);},0);
  var orderCount = orders.length;
  var aov = orderCount ? (gross/orderCount) : 0;
  var avgSell = unitsSold ? (gross/unitsSold) : 0;
  var uniqueCustomers = new Set(orders.map(function(o){return o.customer_id||('guest:'+o.customer_email||o.id);})).size;

  // Tile row
  var tile = function(label, val, sub){
    return '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.9rem 1rem;">'+
             '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink4);font-weight:700;">'+label+'</div>'+
             '<div style="font-size:18px;font-weight:800;margin-top:.25rem;color:var(--ink);">'+val+'</div>'+
             (sub?'<div style="font-size:11px;color:var(--ink3);margin-top:.15rem;">'+sub+'</div>':'')+
           '</div>';
  };

  var html = '';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.7rem;margin-bottom:1rem;">';
  html += tile('Gross Sales',  'RM '+_rptFmtMYR(gross), 'Cancelled orders excluded');
  html += tile('Net Sales',    'RM '+_rptFmtMYR(gross), 'Same as Gross — orders sold at displayed total');
  html += tile('Total Discounts','RM '+_rptFmtMYR(totalDiscounts), 'Manual + coupon + points');
  html += tile('Total Orders', _rptFmtInt(orderCount));
  html += tile('Avg Order Value', 'RM '+_rptFmtMYR(aov));
  html += tile('Units Sold', _rptFmtInt(unitsSold)+' palms');
  html += tile('Unique Customers', _rptFmtInt(uniqueCustomers));
  html += tile('Avg Selling Price', 'RM '+_rptFmtMYR(avgSell), 'Gross Sales ÷ Units Sold');
  html += '</div>';

  // Sales by Channel
  html += _rptBreakdownTable('Sales by Channel', _rptGroupBy(orders, function(o){
    return _rptChannelLabel(o.channel);
  }, function(o){return Number(o.total)||0;}), 'Channel');

  // Sales by Payment Terms
  html += _rptBreakdownTable('Sales by Payment Terms', _rptGroupBy(orders, function(o){
    return o.payment_terms==='credit' ? 'Credit' : 'Cash';
  }, function(o){return Number(o.total)||0;}), 'Term');

  // Sales by Payment Status (Paid / Pending / Partially Paid / etc.)
  html += _rptBreakdownTable('Sales by Payment Status', _rptGroupBy(orders, function(o){
    return o.status || '—';
  }, function(o){return Number(o.total)||0;}), 'Status');

  // New vs Repeat customer
  var newRevenue=0, repeatRevenue=0, guestRevenue=0, newOrders=0, repeatOrders=0, guestOrders=0;
  orders.forEach(function(o){
    var v = Number(o.total)||0;
    if(!o.customer_id){ guestRevenue += v; guestOrders++; return; }
    var earliest = _rpt.customerLifetime[o.customer_id];
    if(earliest && new Date(earliest) >= _rpt.from){ newRevenue += v; newOrders++; }
    else { repeatRevenue += v; repeatOrders++; }
  });
  var totalRev = newRevenue+repeatRevenue+guestRevenue;
  var pct = function(v){ return totalRev>0 ? ((v/totalRev)*100).toFixed(2)+'%' : '0.00%'; };
  html += '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;">';
  html += '<div style="font-weight:700;margin-bottom:.5rem;">Customer Type</div>';
  html += '<table class="data-table" style="font-size:12px;"><thead><tr><th>Customer type</th><th style="text-align:right;">Orders</th><th style="text-align:right;">Total sales</th><th style="text-align:right;">Percentage</th></tr></thead><tbody>';
  html += '<tr><td>Repeat customer</td><td style="text-align:right;">'+_rptFmtInt(repeatOrders)+'</td><td style="text-align:right;">RM '+_rptFmtMYR(repeatRevenue)+'</td><td style="text-align:right;">'+pct(repeatRevenue)+'</td></tr>';
  html += '<tr><td>New customer</td><td style="text-align:right;">'+_rptFmtInt(newOrders)+'</td><td style="text-align:right;">RM '+_rptFmtMYR(newRevenue)+'</td><td style="text-align:right;">'+pct(newRevenue)+'</td></tr>';
  html += '<tr><td>Guest</td><td style="text-align:right;">'+_rptFmtInt(guestOrders)+'</td><td style="text-align:right;">RM '+_rptFmtMYR(guestRevenue)+'</td><td style="text-align:right;">'+pct(guestRevenue)+'</td></tr>';
  html += '</tbody></table></div>';

  // Top Products by Revenue
  var byProduct = {};
  items.forEach(function(it){
    var key = it.product_name || '—';
    var b = byProduct[key] || {name:key, revenue:0, units:0};
    b.revenue += Number(it.subtotal)||0;
    b.units   += Number(it.quantity)||0;
    byProduct[key] = b;
  });
  var prodList = Object.values(byProduct);
  var byRevenue = prodList.slice().sort(function(a,b){return b.revenue-a.revenue;}).slice(0,10);
  var byUnits   = prodList.slice().sort(function(a,b){return b.units-a.units;}).slice(0,10);

  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">';
  html += '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;">';
  html += '<div style="font-weight:700;margin-bottom:.5rem;">Top Products — by Revenue</div>';
  html += '<table class="data-table" style="font-size:12px;"><thead><tr><th>#</th><th>Product</th><th style="text-align:right;">Total sales</th></tr></thead><tbody>';
  if(!byRevenue.length) html += '<tr><td colspan="3" style="color:var(--ink4);text-align:center;padding:.6rem;">No data in this range</td></tr>';
  byRevenue.forEach(function(p,i){
    html += '<tr><td>'+(i+1)+'.</td><td>'+esc(p.name)+'</td><td style="text-align:right;font-weight:600;">RM '+_rptFmtMYR(p.revenue)+'</td></tr>';
  });
  html += '</tbody></table></div>';

  html += '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;">';
  html += '<div style="font-weight:700;margin-bottom:.5rem;">Top Products — by Units Sold</div>';
  html += '<table class="data-table" style="font-size:12px;"><thead><tr><th>#</th><th>Product</th><th style="text-align:right;">Units</th></tr></thead><tbody>';
  if(!byUnits.length) html += '<tr><td colspan="3" style="color:var(--ink4);text-align:center;padding:.6rem;">No data in this range</td></tr>';
  byUnits.forEach(function(p,i){
    html += '<tr><td>'+(i+1)+'.</td><td>'+esc(p.name)+'</td><td style="text-align:right;font-weight:600;">'+_rptFmtInt(p.units)+'</td></tr>';
  });
  html += '</tbody></table></div>';
  html += '</div>';

  // Top Customers
  var byCust = {};
  orders.forEach(function(o){
    var key = o.customer_id || ('guest:'+(o.customer_email||o.order_number));
    var b = byCust[key] || {name: o.customer_name || 'Guest', email: o.customer_email || '—', revenue:0, orders:0};
    b.revenue += Number(o.total)||0;
    b.orders++;
    byCust[key] = b;
  });
  var custList = Object.values(byCust).sort(function(a,b){return b.revenue-a.revenue;}).slice(0,15);
  html += '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;">';
  html += '<div style="font-weight:700;margin-bottom:.5rem;">Top Customers</div>';
  html += '<table class="data-table" style="font-size:12px;"><thead><tr><th>#</th><th>Customer</th><th>Contact</th><th style="text-align:right;">Orders</th><th style="text-align:right;">Total sales</th></tr></thead><tbody>';
  if(!custList.length) html += '<tr><td colspan="5" style="color:var(--ink4);text-align:center;padding:.6rem;">No data in this range</td></tr>';
  custList.forEach(function(c,i){
    html += '<tr><td>'+(i+1)+'.</td><td>'+esc(c.name)+'</td><td style="color:var(--ink3);">'+esc(c.email)+'</td><td style="text-align:right;">'+_rptFmtInt(c.orders)+'</td><td style="text-align:right;font-weight:600;">RM '+_rptFmtMYR(c.revenue)+'</td></tr>';
  });
  html += '</tbody></table></div>';

  // Monthly Breakdown — Orders / Revenue / Units / Avg Selling Price
  html += _rptMonthlyBreakdown(orders, items);

  box.innerHTML = html;
}

function _rptChannelLabel(c){
  return ({
    'online_store':'Online Store',
    'admin_panel': 'Admin Panel (Manual)',
    'whatsapp':    'WhatsApp',
    'google':      'Google'
  })[c] || (c || 'Online Store');
}

// Group orders by `keyFn`, total via `valFn`, return sorted descending.
function _rptGroupBy(orders, keyFn, valFn){
  var by = {};
  orders.forEach(function(o){
    var k = keyFn(o);
    var b = by[k] || {key:k, total:0, count:0};
    b.total += valFn(o);
    b.count++;
    by[k] = b;
  });
  return Object.values(by).sort(function(a,b){return b.total-a.total;});
}

function _rptBreakdownTable(title, rows, keyHeader){
  var sumAll = rows.reduce(function(s,r){return s+r.total;},0);
  var pct = function(v){ return sumAll>0 ? ((v/sumAll)*100).toFixed(2)+'%' : '0.00%'; };
  var html = '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;">';
  html += '<div style="font-weight:700;margin-bottom:.5rem;">'+title+'</div>';
  html += '<table class="data-table" style="font-size:12px;"><thead><tr><th>'+keyHeader+'</th><th style="text-align:right;">Orders</th><th style="text-align:right;">Total sales</th><th style="text-align:right;">Percentage</th></tr></thead><tbody>';
  if(!rows.length) html += '<tr><td colspan="4" style="color:var(--ink4);text-align:center;padding:.6rem;">No data in this range</td></tr>';
  rows.forEach(function(r){
    html += '<tr><td>'+esc(r.key)+'</td><td style="text-align:right;">'+_rptFmtInt(r.count)+'</td><td style="text-align:right;font-weight:600;">RM '+_rptFmtMYR(r.total)+'</td><td style="text-align:right;">'+pct(r.total)+'</td></tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

function _rptMonthlyBreakdown(orders, items){
  var byMonth = {};
  var key = function(d){
    return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2);
  };
  orders.forEach(function(o){
    var d = new Date(o.created_at);
    var k = key(d);
    var b = byMonth[k] || {key:k, label:d.toLocaleDateString('en-GB',{month:'short',year:'numeric'}), orders:0, revenue:0, units:0};
    b.orders++;
    b.revenue += Number(o.total)||0;
    byMonth[k] = b;
  });
  // Items contribute units to whichever month the parent order belongs in.
  var orderMonth = {};
  orders.forEach(function(o){
    orderMonth[o.id] = key(new Date(o.created_at));
  });
  items.forEach(function(it){
    var k = orderMonth[it.order_id]; if(!k) return;
    var b = byMonth[k]; if(!b) return;
    b.units += Number(it.quantity)||0;
  });
  var rows = Object.values(byMonth).sort(function(a,b){return a.key<b.key?1:-1;});

  var html = '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;margin-bottom:1rem;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">';
  html += '<div style="font-weight:700;">Monthly Breakdown</div>';
  html += '<button class="btn btn-outline btn-sm" onclick="exportReportCSV()" style="font-size:11px;">Export CSV</button>';
  html += '</div>';
  html += '<table class="data-table" style="font-size:12px;"><thead><tr><th>Month</th><th style="text-align:right;">Orders</th><th style="text-align:right;">Revenue</th><th style="text-align:right;">Units Sold</th><th style="text-align:right;">Avg Selling Price</th></tr></thead><tbody>';
  if(!rows.length) html += '<tr><td colspan="5" style="color:var(--ink4);text-align:center;padding:.6rem;">No data in this range</td></tr>';
  rows.forEach(function(r){
    var asp = r.units>0 ? (r.revenue/r.units) : 0;
    html += '<tr><td style="font-weight:600;">'+esc(r.label)+'</td>'+
              '<td style="text-align:right;">'+_rptFmtInt(r.orders)+'</td>'+
              '<td style="text-align:right;">RM '+_rptFmtMYR(r.revenue)+'</td>'+
              '<td style="text-align:right;">'+_rptFmtInt(r.units)+'</td>'+
              '<td style="text-align:right;font-weight:600;">RM '+_rptFmtMYR(asp)+'</td>'+
            '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}

// Spit the monthly breakdown out as a CSV download — easy lift into a
// spreadsheet for the user to share with shareholders / book-keeping.
function exportReportCSV(){
  var orders = _rpt.orders, items = _rpt.items;
  var byMonth = {};
  var key = function(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2);};
  orders.forEach(function(o){
    var d = new Date(o.created_at);
    var k = key(d);
    var b = byMonth[k] || {label:d.toLocaleDateString('en-GB',{month:'short',year:'numeric'}), orders:0, revenue:0, units:0};
    b.orders++;
    b.revenue += Number(o.total)||0;
    byMonth[k] = b;
  });
  var orderMonth = {};
  orders.forEach(function(o){ orderMonth[o.id] = key(new Date(o.created_at)); });
  items.forEach(function(it){
    var k = orderMonth[it.order_id]; if(!k) return;
    var b = byMonth[k]; if(!b) return;
    b.units += Number(it.quantity)||0;
  });
  var rows = Object.entries(byMonth).sort(function(a,b){return a[0]<b[0]?1:-1;}).map(function(e){return e[1];});
  var csv = 'Month,Orders,Revenue (RM),Units Sold,Avg Selling Price (RM)\n';
  rows.forEach(function(r){
    var asp = r.units>0 ? (r.revenue/r.units) : 0;
    csv += '"'+r.label+'",'+r.orders+','+r.revenue.toFixed(2)+','+r.units+','+asp.toFixed(2)+'\n';
  });
  var fromS = _rptYmd(_rpt.from), toS = _rptYmd(_rpt.to);
  var blob = new Blob([csv], {type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'mjm-monthly-report-'+fromS+'-to-'+toS+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
