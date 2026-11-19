/* ════════════════════════════════════════════════════════════════════════
   WHAT A MONTH CAN SELL — the Monthly Maturity Allocation, as a rule

   The office decides a month's stock on Stock & Sales → Monthly Maturity
   Allocation (operation/operation_stock_sales.js). The Sales Web's
   Publish to Sales Web dialog asked the same question with a rule of its
   own and answered it differently: February 2027 read 29,042 on the
   office table and "only 2,938 available" on the web, with the customer
   allocation at nought. Three things were different, and every one of
   them is the office's rule written down here:

   - THE DATE. A transplant is dated by transaction_date, then the Date:
     in the remark, then created_at (logDate). The web skipped the first.
   - A DO COMES OFF ITS OWN BATCH AND PLOT. The web matched a DO line on
     the PLOT alone, so every sale ever made out of U3 — last year's crop
     included — came off February's U3.
   - THE RESERVATION IS THE CUSTOMER CHIPS. shared_batch_customer_
     allocations, each capped at what its order still owes. The web read
     shared_plot_allocations.reserved_qty, which nothing writes any more.

   SHARED RULE, TWO COPIES: this file and public/month-maturity.js in the
   MJMNursery-Sales-Web repository, word for word.
   tests/the_sales_web_reads_the_maturity_table.cjs here drives this file
   against the REAL office page over one ledger and compares the totals,
   and compares the two copies. Change one, change the other.

   PURE: rows in, figures out. No database, no screen.
   ════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CULL = 0.9;
  var RE_LOG_DATE = /(?:Cull)?Date:\s*(\d{4}-\d{2}-\d{2})/i;

  function logDate(l) {
    if (l.transaction_date) return String(l.transaction_date).slice(0, 10);
    var m = l.remark ? String(l.remark).match(RE_LOG_DATE) : null;
    if (m) return m[1];
    return l.created_at ? String(l.created_at).slice(0, 10) : null;
  }
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function normBatch(v) {
    return String(v == null ? '' : v).trim().toUpperCase()
      .replace(/^BATCH\s*:?\s*/, '').split(/[\s(,\[]/)[0].replace(/[^0-9A-Z]/g, '');
  }
  function normPlot(v) {
    return String(v == null ? '' : v).trim().toUpperCase()
      .replace(/^PLOT\s*:?\s*/, '').split(/[\s(,\[]/)[0].replace(/[^0-9A-Z]/g, '');
  }
  function normOrder(v) { return String(v || '').trim().toUpperCase().replace(/[^0-9A-Z]/g, ''); }
  function cancelledDO(d) {
    return d.status === 'Cancelled' || (d.remark && String(d.remark).indexOf('[CANCELLED]') >= 0);
  }

  /* One row per batch + plot that a 'Transplanted' log put seedlings into,
     dated by its EARLIEST transplant and maturing nine months on. */
  function monthRows(transplants) {
    var groups = {}, order = [];
    (transplants || []).forEach(function (l) {
      var eff = logDate(l);
      var k = (l.batch_name || '') + '||' + (l.plot_name || '');
      if (!groups[k]) { groups[k] = { batch: l.batch_name, plot: l.plot_name, qty: 0, firstDate: eff }; order.push(k); }
      groups[k].qty += (l.quantity_change || 0);
      if (eff < groups[k].firstDate) groups[k].firstDate = eff;
    });
    return order.map(function (k) {
      var g = groups[k];
      var t = new Date(g.firstDate);
      var m = new Date(t); m.setMonth(m.getMonth() + 9);
      return { key: k, batch: g.batch, plot: g.plot, qty: g.qty, afterCulling: Math.round(g.qty * CULL),
        doDeducted: 0, transplantDate: t, matureDate: m, month: monthKey(m) };
    });
  }

  function applyDOs(rows, dos) {
    var byNorm = {}, unmatched = [];
    rows.forEach(function (g) {
      var nk = normBatch(g.batch) + '||' + normPlot(g.plot);
      if (!byNorm[nk] || g.transplantDate < byNorm[nk].transplantDate) byNorm[nk] = g;
    });
    (dos || []).forEach(function (d) {
      if (cancelledDO(d)) return;
      var filled = 0, i;
      for (i = 1; i <= 5; i++) if (normPlot(d['plot_' + i])) filled++;
      for (i = 1; i <= 5; i++) {
        var pk = normPlot(d['plot_' + i]);
        if (!pk) continue;
        var qty = Number(d['qty_' + i] || 0);
        if (!qty && filled === 1) qty = Number(d.total_qty || 0);
        if (!qty) continue;
        var t = byNorm[normBatch(d['batch_' + i]) + '||' + pk];
        if (t) t.doDeducted += qty; else unmatched.push({ do_number: d.do_number, plot: d['plot_' + i], batch: d['batch_' + i], qty: qty });
      }
    });
    return unmatched;
  }

  /* A 3rd culling counts only with a drone qty on it AND signed off —
     the office's gate. A sign-off table that could not be read waives the
     signature half (rowVerOk false), the fail-open the office page has. */
  function applyCulling(rows, cull3, rowVer, tabVer, rowVerOk, transfers) {
    var rowSigned = {}, tabSigned = {}, counted = {}, movedOut = {};
    (rowVer || []).forEach(function (v) {
      var key = String(v.plot_name || '');
      if (key.indexOf('cull_3::') !== 0) return;
      var rest = key.slice(8), bar = rest.indexOf('|');
      var head = (bar < 0 ? rest : rest.slice(0, bar)).trim().toUpperCase();
      if (head) rowSigned[(v.batch_name || '') + '::' + head] = 1;
    });
    (tabVer || []).forEach(function (v) { if (v && v.stage === 'cull_3') tabSigned[v.batch_name || ''] = 1; });
    (cull3 || []).forEach(function (r) {
      if (!/MapQty:\s*\d/i.test(r.remark || '')) return;
      var b = r.batch_name || '', pu = String(r.plot_name || '').trim().toUpperCase();
      var signed = tabSigned[b] || rowSigned[b + '::' + pu];
      if (rowVerOk && !signed) return;
      var k = b + '||' + (r.plot_name || '');
      counted[k] = (counted[k] || 0) + (r.quantity_change || 0);
    });
    var keys = {};
    rows.forEach(function (g) { keys[g.key] = 1; });
    var xferIn = {};
    (transfers || []).forEach(function (r) {
      var m = r.remark ? String(r.remark).match(/From:\s*\[([^|\]]+)\|/) : null;
      if (m && m[1].trim()) {
        var ko = (r.batch_name || '') + '||' + m[1].trim();
        movedOut[ko] = (movedOut[ko] || 0) + (r.quantity_change || 0);
      }
      var ki = (r.batch_name || '') + '||' + (r.plot_name || '');
      if (keys[ki]) xferIn[ki] = (xferIn[ki] || 0) + (r.quantity_change || 0);
    });
    rows.forEach(function (g) {
      g.culledQty = counted[g.key] || 0;
      g.transferredOut = movedOut[g.key] || 0;
      g.transferredIn = xferIn[g.key] || 0;
    });
  }

  /* matRowFigures, month rows. */
  function figures(r) {
    var collected = r.doDeducted || 0;
    var otherDed = (r.culledQty || 0) + (r.transferredOut || 0);
    var fullBalance = r.afterCulling + (r.transferredIn || 0) - collected - otherDed;
    var culled = (r.culledQty || 0) > 0 && fullBalance <= 0;
    var plotBalance = culled ? 0 : r.afterCulling - collected;
    var soldOut = !culled && plotBalance <= 0;
    var left = r.qty - collected;
    var room = soldOut ? Math.max(0, left) : plotBalance;
    return { collected: collected, culled: culled, plotBalance: plotBalance, soldOut: soldOut, left: left, room: room };
  }

  /* What each customer order still owes — the office's Customer Order
     Management balance: the AL's quantity ordered less every DO issued
     against that AL, nought for a cancelled or closed AL, and the web's
     own items less collections where no AL is linked. One order per
     normalised number, the newest row winning, allIds kept. */
  function orderBalances(src) {
    var dos = (src.alDos || []).filter(function (d) { return String(d.status || '').toLowerCase() !== 'cancelled'; });
    var doByAl = {};
    dos.forEach(function (d) {
      if (!d.al_number || /^CAL-/i.test(String(d.do_number || ''))) return;
      doByAl[d.al_number] = (doByAl[d.al_number] || 0) + (Number(d.total_qty) || 0);
    });
    var alBy = {};
    (src.alRows || []).forEach(function (a) {
      var k = normOrder(a.order_number);
      if (!k) return;
      var cur = alBy[k];
      if (!cur || (Number(a.balance_quantity) || 0) > (Number(cur.balance_quantity) || 0)) alBy[k] = a;
    });
    var items = {};
    (src.items || []).forEach(function (it) { items[it.order_id] = (items[it.order_id] || 0) + (it.quantity || 0); });
    var coll = {}, haveColl = src.collections && src.collections.length;
    if (haveColl) src.collections.forEach(function (c) {
      if (!c.collected_at) return;
      coll[c.order_id] = (coll[c.order_id] || 0) + (c.collected_qty || 0);
    });
    var list = (src.orders || []).map(function (o) {
      var collected = haveColl ? (coll[o.id] || 0) : ((o.collected_qty && o.collected_at) ? o.collected_qty : 0);
      var balance = (items[o.id] || 0) - collected;
      var al = alBy[normOrder(o.order_number)];
      if (al) {
        var cancelled = al.status === 'Cancelled' || /\[CANCELLED\]/i.test(String(al.remark || ''));
        var closed = !cancelled && (al.status === 'Closed' || /\[CLOSED\]/i.test(String(al.remark || '')));
        var q = Number(al.quantity_ordered);
        balance = (isNaN(q) ? (items[o.id] || 0) : q) - (doByAl[al.al_number] || 0);
        if (cancelled || closed) balance = 0;
      }
      return { id: o.id, orderNumber: o.order_number, created: o.created_at ? new Date(o.created_at).getTime() : 0, balance: balance };
    });
    var byNorm = {};
    list.forEach(function (o) { var k = normOrder(o.orderNumber) || ('id:' + o.id); (byNorm[k] = byNorm[k] || []).push(o); });
    return Object.keys(byNorm).map(function (k) {
      var g = byNorm[k].sort(function (a, b) { return b.created - a.created; });
      var keep = g[0]; keep.allIds = g.map(function (x) { return x.id; });
      return keep;
    });
  }

  function reservations(src) {
    var orders = orderBalances(src);
    function orderFor(a) {
      if (a.order_id) {
        var hit = orders.filter(function (o) { return o.allIds.indexOf(a.order_id) >= 0; })[0];
        if (hit) return hit;
      }
      var k = normOrder(a.order_number);
      if (!k) return null;
      return orders.filter(function (o) { return normOrder(o.orderNumber) === k; })[0] || null;
    }
    var byKey = {};
    (src.allocations || []).forEach(function (a) {
      var o = orderFor(a), stored = Number(a.allocated_qty) || 0;
      if (o && (Number(o.balance) || 0) <= 0) return;   // spent
      var live = o ? Math.min(stored, Math.max(0, Number(o.balance) || 0)) : stored;
      var k = (a.batch_name || '') + '||' + (a.plot_name || '');
      byKey[k] = (byKey[k] || 0) + live;
    });
    return byKey;
  }

  /* Everything, for every month: rows carrying their figures, and a
     total per month that is the office table's foot. */
  function build(src) {
    var rows = monthRows(src.transplants);
    var unmatched = applyDOs(rows, src.dos);
    applyCulling(rows, src.cull3, src.rowVer, src.tabVer, src.rowVerOk !== false, src.transfers);
    var res = reservations(src);
    var months = {};
    rows.forEach(function (r) {
      var f = figures(r);
      r.figures = f;
      r.reserved = res[r.key] || 0;
      r.afterDeductReserve = f.room - r.reserved;
      var t = months[r.month] || (months[r.month] = { rows: 0, qty: 0, afterCulling: 0, doDeducted: 0, plotBalance: 0, reserved: 0, afterDeductReserve: 0 });
      t.rows++; t.qty += r.qty; t.afterCulling += r.afterCulling; t.doDeducted += f.collected;
      t.plotBalance += f.plotBalance; t.reserved += r.reserved; t.afterDeductReserve += r.afterDeductReserve;
    });
    return { rows: rows, months: months, unmatched: unmatched };
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /* "February", 2027 → "2027-02". */
  function keyOf(monthName, year) {
    var i = MONTHS.indexOf(String(monthName || ''));
    return i < 0 || !year ? null : year + '-' + String(i + 1).padStart(2, '0');
  }

  global.MJMMonthMaturity = {
    logDate: logDate, normBatch: normBatch, normPlot: normPlot,
    monthRows: monthRows, figures: figures, build: build, keyOf: keyOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
