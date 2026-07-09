// ═══════════════════════════════════════════════════════════════════
//  ADMIN — REPORTS TAB
// ═══════════════════════════════════════════════════════════════════
// Sales report dashboard. All metrics are read live from
// salesweb_customer_orders + salesweb_order_items inside the chosen date
// range (defaults: this month). Cancelled orders are excluded from every
// money/quantity total — they reflect orders the business didn't fulfil.
//
// Layout:
//   • Headline tiles (Gross/Net sales, Discounts, Orders, AOV, Units,
//     Unique Customers, Avg Selling Price)
//   • Time-series LINE CHARTS for Gross Sales, Net Sales, Orders, AOV
//   • Horizontal BAR CHARTS for Sales by Channel / Payment Terms /
//     Payment Status / Customer Type
//   • Tables for Top Products (revenue + units), Top Customers,
//     Monthly Breakdown (with Avg Selling Price per month + Export CSV)
//
// Each chart card carries a "View more" button → opens a modal with the
// underlying detail rows (daily breakdown for line charts, per-order
// detail for the categorical bars).

var _rpt = {
  from: null,
  to:   null,
  preset: 'this_month',
  orders: [],
  items: [],
  customerLifetime: {}
};

function _rptFmtMYR(n){
  return (Number(n)||0).toLocaleString('en-MY', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function _rptFmtInt(n){
  return (Number(n)||0).toLocaleString('en-MY');
}
function _rptShortNum(n){
  n = Number(n)||0;
  if(n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/,'')+'M';
  if(n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/,'')+'k';
  return n.toFixed(0);
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

function _rptPresetRange(key){
  var now = new Date();
  var startOfDay = function(d){ d.setHours(0,0,0,0); return d; };
  var endOfDay   = function(d){ d.setHours(23,59,59,999); return d; };
  var from, to = endOfDay(new Date(now));
  switch(key){
    case 'today':       from = startOfDay(new Date(now)); break;
    case 'last_7':      from = startOfDay(new Date(now.getTime() - 6*86400000)); break;
    case 'last_30':     from = startOfDay(new Date(now.getTime() - 29*86400000)); break;
    case 'this_month':  from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)); break;
    case 'last_month':
      from = startOfDay(new Date(now.getFullYear(), now.getMonth()-1, 1));
      to   = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)); break;
    case 'this_year':   from = startOfDay(new Date(now.getFullYear(), 0, 1)); break;
    case 'all_time':    from = new Date(2020, 0, 1); break;
    default:            from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  return {from:from, to:to};
}

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

  var{data:orders, error:oErr} = await sb.from('salesweb_customer_orders')
    .select('id,order_number,customer_id,customer_name,customer_email,total,channel,payment_terms,status,discount_amount,coupon_discount,coupon_code,points_discount_rm,amount_paid,created_at')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .order('created_at', {ascending:false});
  if(oErr){ if(box) box.innerHTML = '<div class="loading">Failed to load orders: '+oErr.message+'</div>'; return; }
  orders = (orders||[]).filter(function(o){ return o.status !== 'Cancelled'; });
  _rpt.orders = orders;

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

// ─── SVG CHART HELPERS ─────────────────────────────────────────────

// Compact line chart. `daily` is [{label, value}] already pre-aggregated.
function _rptSvgLineChart(daily, opts){
  opts = opts || {};
  var w = 460, h = 130;
  var pad = {l: 40, r: 10, t: 10, b: 22};
  if(!daily || !daily.length){
    return '<div style="color:var(--ink4);font-size:12px;text-align:center;padding:1.5rem 0;">No data in this range.</div>';
  }
  var n = daily.length;
  var maxV = Math.max.apply(null, daily.map(function(d){return Number(d.value)||0;}));
  if(maxV <= 0) maxV = 1;
  var pts = daily.map(function(d, i){
    var x = pad.l + (n>1 ? (w - pad.l - pad.r) * i / (n-1) : (w - pad.l - pad.r)/2);
    var y = pad.t + (h - pad.t - pad.b) * (1 - (Number(d.value)||0)/maxV);
    return [x, y];
  });
  var linePath = 'M ' + pts.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' L ');
  var areaPath = 'M '+pts[0][0]+','+(h-pad.b)+' L '+pts.map(function(p){return p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' L ')+' L '+pts[n-1][0]+','+(h-pad.b)+' Z';
  var ticks = '';
  for(var k=0;k<=3;k++){
    var v = maxV * k / 3;
    var y = pad.t + (h - pad.t - pad.b) * (1 - k/3);
    ticks += '<line x1="'+pad.l+'" x2="'+(w-pad.r)+'" y1="'+y.toFixed(1)+'" y2="'+y.toFixed(1)+'" stroke="#eef2f7" stroke-width="1"/>';
    ticks += '<text x="'+(pad.l-6)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" font-size="9" fill="#94a3b8">'+_rptShortNum(v)+'</text>';
  }
  var xlabels = '';
  var labelIdxs = n<=4 ? Array.from({length:n}, function(_,i){return i;}) : [0, Math.floor(n/3), Math.floor(2*n/3), n-1];
  labelIdxs.forEach(function(ii){
    var p = pts[ii]; if(!p) return;
    xlabels += '<text x="'+p[0]+'" y="'+(h-6)+'" text-anchor="middle" font-size="9" fill="#94a3b8">'+esc(daily[ii].label||'')+'</text>';
  });
  var color = opts.color || '#2563eb';
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="xMidYMid meet" style="width:100%;height:'+h+'px;display:block;">'+
    ticks +
    '<path d="'+areaPath+'" fill="'+color+'" fill-opacity="0.08"/>'+
    '<path d="'+linePath+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round"/>'+
    xlabels +
    '</svg>';
}

// Horizontal bar chart — better than a pie when labels are long.
function _rptBarChart(rows, opts){
  opts = opts || {};
  if(!rows || !rows.length){
    return '<div style="color:var(--ink4);font-size:12px;text-align:center;padding:1rem 0;">No data in this range.</div>';
  }
  var maxV = Math.max.apply(null, rows.map(function(r){return Number(r.value)||0;}));
  if(maxV <= 0) maxV = 1;
  var total = rows.reduce(function(s,r){return s+(Number(r.value)||0);},0);
  var color = opts.color || '#2563eb';
  var fmt = opts.formatter || function(v){ return _rptFmtMYR(v); };
  var prefix = opts.prefix || '';
  var html = '<div style="display:flex;flex-direction:column;gap:.55rem;padding:.3rem 0 .1rem;">';
  rows.forEach(function(r){
    var pctBar = (Number(r.value)||0) / maxV * 100;
    var pctTot = total>0 ? ((Number(r.value)||0) / total * 100).toFixed(2) : '0.00';
    html += '<div>';
    html += '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px;gap:.5rem;">';
    html += '<span style="color:var(--ink);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(r.label)+'</span>';
    html += '<span style="color:var(--ink3);font-variant-numeric:tabular-nums;white-space:nowrap;">'+prefix+fmt(r.value)+' · '+pctTot+'%</span>';
    html += '</div>';
    html += '<div style="background:#f1f5f9;border-radius:3px;height:8px;overflow:hidden;">';
    html += '<div style="background:'+color+';width:'+pctBar.toFixed(2)+'%;height:100%;"></div>';
    html += '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// Bucket orders into daily series across [from, to]. Days with no orders
// get a zero value so the line chart shows the flat stretches honestly.
function _rptDailySeries(valueFn){
  var byDay = {};
  _rpt.orders.forEach(function(o){
    var d = new Date(o.created_at);
    var key = d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    if(!byDay[key]) byDay[key] = { orders:0, revenue:0 };
    byDay[key].orders++;
    byDay[key].revenue += Number(o.total)||0;
  });
  var out = [];
  var cur = new Date(_rpt.from.getFullYear(), _rpt.from.getMonth(), _rpt.from.getDate());
  var end = new Date(_rpt.to.getFullYear(),   _rpt.to.getMonth(),   _rpt.to.getDate());
  while(cur <= end){
    var k = cur.getFullYear()+'-'+('0'+(cur.getMonth()+1)).slice(-2)+'-'+('0'+cur.getDate()).slice(-2);
    var slot = byDay[k] || { orders:0, revenue:0 };
    var label = cur.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
    out.push({ key:k, label:label, orders:slot.orders, revenue:slot.revenue, value:valueFn(slot) });
    cur.setDate(cur.getDate()+1);
  }
  return out;
}

// ─── VIEW-MORE MODAL ───────────────────────────────────────────────

function _rptOpenViewMore(title, headers, rows, footerHtml){
  var html = '<table class="data-table" style="font-size:12px;"><thead><tr>';
  headers.forEach(function(h){
    html += '<th'+(h.align?' style="text-align:'+h.align+';"':'')+'>'+esc(h.label)+'</th>';
  });
  html += '</tr></thead><tbody>';
  if(!rows.length) html += '<tr><td colspan="'+headers.length+'" style="color:var(--ink4);text-align:center;padding:.6rem;">No data in this range</td></tr>';
  rows.forEach(function(r){
    html += '<tr>';
    r.forEach(function(cell, i){
      var h = headers[i] || {};
      html += '<td'+(h.align?' style="text-align:'+h.align+';"':'')+'>'+cell+'</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  if(footerHtml) html += '<div style="margin-top:.6rem;font-size:11px;color:var(--ink3);">'+footerHtml+'</div>';
  document.getElementById('rpt-vm-title').textContent = title;
  document.getElementById('rpt-vm-body').innerHTML = html;
  openModal('modal-report-view-more');
}

// View-more handlers — bound to chart "View more" buttons.

function rptViewMoreDaily(metric){
  // metric: 'revenue' | 'orders' | 'aov'
  var daily = _rptDailySeries(function(s){
    if(metric==='orders')  return s.orders;
    if(metric==='aov')     return s.orders ? s.revenue/s.orders : 0;
    return s.revenue;
  });
  var title = metric==='orders' ? 'Total Orders — Daily Breakdown'
            : metric==='aov'    ? 'Average Order Value — Daily Breakdown'
            :                     'Sales — Daily Breakdown';
  var headers = [
    {label:'Date'},
    {label:'Orders', align:'right'},
    {label:'Revenue (RM)', align:'right'},
    {label:'Avg Order Value (RM)', align:'right'}
  ];
  var rows = daily.map(function(d){
    var aov = d.orders ? (d.revenue/d.orders) : 0;
    return [esc(d.label), _rptFmtInt(d.orders), 'RM '+_rptFmtMYR(d.revenue), 'RM '+_rptFmtMYR(aov)];
  });
  _rptOpenViewMore(title, headers, rows);
}

function rptViewMoreCategory(kind){
  // kind: 'channel' | 'terms' | 'status' | 'customer_type'
  var titleMap = {channel:'Sales by Channel — Order Detail',
                  terms:  'Sales by Payment Terms — Order Detail',
                  status: 'Sales by Payment Status — Order Detail',
                  customer_type:'Customer Type — Order Detail'};
  var headers = [
    {label:'Bucket'}, {label:'Order #'}, {label:'Date'}, {label:'Customer'}, {label:'Total (RM)', align:'right'}
  ];
  var bucketFn = {
    channel:        function(o){ return _rptChannelLabel(o.channel); },
    terms:          function(o){ return o.payment_terms==='credit' ? 'Credit' : 'Cash'; },
    status:         function(o){ return o.status || '—'; },
    customer_type:  function(o){
      if(!o.customer_id) return 'Guest';
      var earliest = _rpt.customerLifetime[o.customer_id];
      return (earliest && new Date(earliest) >= _rpt.from) ? 'New customer' : 'Repeat customer';
    }
  }[kind];
  var rows = _rpt.orders.map(function(o){
    var d = new Date(o.created_at);
    return [
      esc(bucketFn(o)),
      esc(o.order_number || (o.id||'').substring(0,8).toUpperCase()),
      d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
      esc(o.customer_name || '—'),
      'RM '+_rptFmtMYR(o.total)
    ];
  });
  // Sort by bucket then date desc
  rows.sort(function(a,b){ return a[0]<b[0]?-1:(a[0]>b[0]?1:0); });
  _rptOpenViewMore(titleMap[kind] || 'Detail', headers, rows);
}

// ─── MAIN RENDER ───────────────────────────────────────────────────

function _rptRender(){
  var box = document.getElementById('reports-body');
  if(!box) return;
  var orders = _rpt.orders, items = _rpt.items;

  var gross = orders.reduce(function(s,o){return s+(Number(o.total)||0);},0);
  var totalDiscounts = orders.reduce(function(s,o){
    return s+(Number(o.discount_amount)||0)+(Number(o.coupon_discount)||0)+(Number(o.points_discount_rm)||0);
  },0);
  var unitsSold = items.reduce(function(s,i){return s+(Number(i.quantity)||0);},0);
  var orderCount = orders.length;
  var aov = orderCount ? (gross/orderCount) : 0;
  var avgSell = unitsSold ? (gross/unitsSold) : 0;
  var uniqueCustomers = new Set(orders.map(function(o){return o.customer_id||('guest:'+o.customer_email||o.id);})).size;

  var tile = function(label, val, sub){
    return '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.9rem 1rem;">'+
             '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink4);font-weight:700;">'+label+'</div>'+
             '<div style="font-size:18px;font-weight:800;margin-top:.25rem;color:var(--ink);">'+val+'</div>'+
             (sub?'<div style="font-size:11px;color:var(--ink3);margin-top:.15rem;">'+sub+'</div>':'')+
           '</div>';
  };

  var html = '';

  // ── Headline tiles ──
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.7rem;margin-bottom:1rem;">';
  html += tile('Gross Sales',  'RM '+_rptFmtMYR(gross), 'Cancelled excluded');
  html += tile('Net Sales',    'RM '+_rptFmtMYR(gross), 'Same as Gross');
  html += tile('Total Discounts','RM '+_rptFmtMYR(totalDiscounts), 'Manual + coupon + points');
  html += tile('Total Orders', _rptFmtInt(orderCount));
  html += tile('Avg Order Value', 'RM '+_rptFmtMYR(aov));
  html += tile('Units Sold', _rptFmtInt(unitsSold)+' palms');
  html += tile('Unique Customers', _rptFmtInt(uniqueCustomers));
  html += tile('Avg Selling Price', 'RM '+_rptFmtMYR(avgSell), 'Gross ÷ Units');
  html += '</div>';

  // ── Time-series line charts (2-col) ──
  var grossDaily = _rptDailySeries(function(s){return s.revenue;});
  var ordersDaily = _rptDailySeries(function(s){return s.orders;});
  var aovDaily = _rptDailySeries(function(s){return s.orders ? s.revenue/s.orders : 0;});
  var chartCard = function(title, headlineVal, subtitle, svg, viewMoreFn){
    return '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.9rem 1rem;">'+
           '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;margin-bottom:.4rem;">'+
             '<div style="min-width:0;">'+
               '<div style="font-size:11px;color:var(--ink3);text-transform:uppercase;letter-spacing:.05em;font-weight:700;border-bottom:1px dashed var(--border);padding-bottom:1px;display:inline-block;">'+title+'</div>'+
               '<div style="font-size:17px;font-weight:800;margin-top:.25rem;">'+headlineVal+'</div>'+
               (subtitle?'<div style="font-size:11px;color:var(--ink3);">'+subtitle+'</div>':'')+
             '</div>'+
             '<a onclick="'+viewMoreFn+'" style="cursor:pointer;font-size:12px;color:#2563eb;font-weight:600;white-space:nowrap;">View more →</a>'+
           '</div>'+ svg +
         '</div>';
  };

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:.7rem;margin-bottom:1rem;">';
  html += chartCard('Gross Sales', 'RM '+_rptFmtMYR(gross), null,
                    _rptSvgLineChart(grossDaily, {color:'#2563eb'}),
                    "rptViewMoreDaily('revenue')");
  html += chartCard('Net Sales', 'RM '+_rptFmtMYR(gross), 'Gross minus refunds (none tracked yet)',
                    _rptSvgLineChart(grossDaily, {color:'#16a34a'}),
                    "rptViewMoreDaily('revenue')");
  html += chartCard('Total Orders', _rptFmtInt(orderCount), null,
                    _rptSvgLineChart(ordersDaily, {color:'#7c3aed'}),
                    "rptViewMoreDaily('orders')");
  html += chartCard('Average Order Value', 'RM '+_rptFmtMYR(aov), null,
                    _rptSvgLineChart(aovDaily, {color:'#ea580c'}),
                    "rptViewMoreDaily('aov')");
  html += '</div>';

  // ── Categorical bar charts (2-col) ──
  var barCard = function(title, barHtml, viewMoreFn){
    return '<div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:.9rem 1rem;">'+
           '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">'+
             '<div style="font-size:13px;font-weight:700;">'+title+'</div>'+
             '<a onclick="'+viewMoreFn+'" style="cursor:pointer;font-size:12px;color:#2563eb;font-weight:600;">View more →</a>'+
           '</div>'+ barHtml +
         '</div>';
  };

  var channelRows = _rptCategoryRows(orders, function(o){return _rptChannelLabel(o.channel);});
  var termsRows   = _rptCategoryRows(orders, function(o){return o.payment_terms==='credit' ? 'Credit' : 'Cash';});
  var statusRows  = _rptCategoryRows(orders, function(o){return o.status || '—';});
  var custTypeRows = _rptCustomerTypeRows(orders);

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:.7rem;margin-bottom:1rem;">';
  html += barCard('Sales by Channel',         _rptBarChart(channelRows, {color:'#2563eb',prefix:'RM '}), "rptViewMoreCategory('channel')");
  html += barCard('Sales by Payment Terms',   _rptBarChart(termsRows,   {color:'#0891b2',prefix:'RM '}), "rptViewMoreCategory('terms')");
  html += barCard('Sales by Payment Status',  _rptBarChart(statusRows,  {color:'#7c3aed',prefix:'RM '}), "rptViewMoreCategory('status')");
  html += barCard('Customer Type',            _rptBarChart(custTypeRows,{color:'#16a34a',prefix:'RM '}), "rptViewMoreCategory('customer_type')");
  html += '</div>';

  // ── Top Products tables (kept text-heavy, twin columns) ──
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

  // ── Top Customers ──
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

  // ── Monthly Breakdown with Avg Selling Price ──
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

function _rptCategoryRows(orders, keyFn){
  var by = {};
  orders.forEach(function(o){
    var k = keyFn(o);
    if(!by[k]) by[k] = {label:k, value:0, count:0};
    by[k].value += Number(o.total)||0;
    by[k].count++;
  });
  return Object.values(by).sort(function(a,b){return b.value-a.value;});
}

function _rptCustomerTypeRows(orders){
  var newR=0, rep=0, guest=0;
  orders.forEach(function(o){
    var v = Number(o.total)||0;
    if(!o.customer_id){ guest += v; return; }
    var earliest = _rpt.customerLifetime[o.customer_id];
    if(earliest && new Date(earliest) >= _rpt.from) newR += v;
    else rep += v;
  });
  return [
    {label:'Repeat customer', value:rep},
    {label:'New customer',    value:newR},
    {label:'Guest',           value:guest}
  ].filter(function(r){return r.value>0;});
}

function _rptMonthlyBreakdown(orders, items){
  var byMonth = {};
  var key = function(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2); };
  orders.forEach(function(o){
    var d = new Date(o.created_at);
    var k = key(d);
    var b = byMonth[k] || {key:k, label:d.toLocaleDateString('en-GB',{month:'short',year:'numeric'}), orders:0, revenue:0, units:0};
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
