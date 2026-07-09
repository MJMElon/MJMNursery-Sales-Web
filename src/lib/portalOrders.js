import { supabase } from './supabase.js';

// Data layer for the customer portal — ported unchanged from
// customer-portal-script.js (loadOrdersFromDB and its helpers).

// Translate the admin's canonical status strings into the customer-facing
// labels the rendering already knows how to badge / step through.
export function mapDbStatus(s) {
  return ({
    'Paid': 'Order Confirmed',
    'Ready for Collection': 'Ready-to-Collect',
    'Completed': 'Order Completed',
  })[s] || s; // 'Pending Payment', 'Cancelled', 'Refunded' pass through
}

export function fmtIsoDate(t) {
  if (!t) return '';
  try { return new Date(t).toISOString().split('T')[0]; } catch { return ''; }
}

// Which timeline step a document belongs under, inferred from its name:
// Delivery Orders (issued by the barcode counter) appear at Collecting,
// invoices at Order Confirmed, payment proofs at Order Placed; anything
// else defaults to Order Confirmed.
export function attachmentStep(name) {
  const n = String(name || '').toLowerCase();
  if (/^do[-_ ]/.test(n) || n.indexOf('delivery order') !== -1 || n.indexOf('delivery_order') !== -1) return 'collecting';
  if (n.indexOf('invoice') !== -1) return 'confirmed';
  if (n.indexOf('proof') !== -1 || n.indexOf('payment') !== -1 || n.indexOf('receipt') !== -1) return 'order_placed';
  return 'confirmed';
}

export function attIcon(a) {
  const t = String(a.file_type || '').toLowerCase(), n = String(a.file_name || '').toLowerCase();
  if (t.indexOf('pdf') !== -1 || /\.pdf$/.test(n)) return '📄';
  if (t.indexOf('image') === 0 || /\.(png|jpe?g|gif|webp)$/.test(n)) return '🖼️';
  return '📎';
}

export function attTypeLabel(a) {
  const t = String(a.file_type || '').toLowerCase();
  if (t.indexOf('pdf') !== -1) return 'PDF';
  if (t.indexOf('image') === 0) return 'Image';
  return a.file_type || 'File';
}

export function fmtAttSize(bytes) {
  if (!bytes || isNaN(bytes)) return '—';
  const kb = bytes / 1024;
  if (kb < 1) return bytes + ' B';
  if (kb < 1024) return kb.toFixed(1) + ' KB';
  return (kb / 1024).toFixed(1) + ' MB';
}

export async function loadOrdersFromDB() {
  const session = await supabase.auth.getSession();
  const uid = session?.data?.session?.user?.id;
  if (!uid) return [];

  const { data: rows, error } = await supabase.from('salesweb_customer_orders')
    .select('*').eq('customer_id', uid).order('created_at', { ascending: false });
  if (error) { console.error('Load orders failed:', error.message); return []; }
  if (!rows || !rows.length) return [];

  // Pull line items for every order in one round-trip.
  const ids = rows.map(r => r.id);
  const { data: items } = await supabase.from('salesweb_order_items')
    .select('order_id,product_name,quantity,unit_price').in('order_id', ids);
  const itemsByOrder = {};
  (items || []).forEach(it => {
    (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
  });

  const orders = rows.map(o => {
    const its = itemsByOrder[o.id] || [];
    const qty = its.reduce((s, i) => s + (i.quantity || 0), 0);
    const variety = its.length === 0 ? '—'
      : its.length === 1 ? its[0].product_name
      : its[0].product_name + ' + ' + (its.length - 1) + ' more';
    const price = its.length ? (its[0].unit_price || 0) : 0;
    const status = mapDbStatus(o.status);
    return {
      id: o.order_number ? '#' + o.order_number : (o.id || '').substring(0, 8).toUpperCase(),
      _dbId: o.id,
      _orderNo: o.order_number || null,
      variety,
      qty,
      price,
      total: Number(o.total) || 0,
      orderDate: fmtIsoDate(o.created_at),
      status,
      notes: o.customer_remark || '',
      billing: o.billing_name || '',
      // collDate is populated from shared_collection_bookings below if
      // the customer has booked a slot for this order.
      collDate: undefined,
      booking: null,
      completedDate: status === 'Order Completed' ? fmtIsoDate(o.updated_at) : undefined,
      cancelledDate: status === 'Cancelled' ? fmtIsoDate(o.updated_at) : undefined,
      attachments: { order_placed: [], confirmed: [], preparing: [], ready_to_collect: [], collecting: [], order_completed: [] },
    };
  });

  // Pull active collection bookings keyed by the same order_number text
  // the booking page records. Cancelled bookings are excluded so a
  // re-booked slot wins.
  const orderNumbers = orders.map(o => o._orderNo).filter(Boolean);
  if (orderNumbers.length) {
    const { data: bookings } = await supabase.from('shared_collection_bookings')
      .select('id, order_number, booking_date, start_time, end_time, collection_qty, status, notes')
      .in('order_number', orderNumbers)
      .neq('status', 'cancelled')
      .order('booking_date', { ascending: true })
      .order('start_time', { ascending: true });

    // Earliest upcoming booking wins (sorted ASC, take first per order).
    const bookingByOrder = {};
    (bookings || []).forEach(b => {
      if (!bookingByOrder[b.order_number]) bookingByOrder[b.order_number] = b;
    });

    orders.forEach(o => {
      const b = o._orderNo && bookingByOrder[o._orderNo];
      if (!b) return;
      o.booking = {
        id: b.id,
        date: b.booking_date,
        startTime: b.start_time,
        endTime: b.end_time,
        qty: b.collection_qty || 0,
        status: b.status,
        notes: b.notes || '',
      };
      o.collDate = b.booking_date;
    });
  }

  // Pull per-order documents in one round-trip: invoices, DO PDFs pushed
  // by the barcode counter, and admin uploads. RLS limits rows to this
  // customer's own orders.
  const byDbId = {};
  orders.forEach(o => { byDbId[o._dbId] = o; });
  const { data: atts } = await supabase.from('salesweb_order_attachments')
    .select('order_id, file_name, file_url, file_type, file_size, created_at')
    .in('order_id', ids)
    .order('created_at', { ascending: true });
  (atts || []).forEach(a => {
    const o = byDbId[a.order_id];
    if (!o) return;
    o.attachments[attachmentStep(a.file_name)].push({
      name: a.file_name || 'Document',
      type: attTypeLabel(a),
      size: fmtAttSize(a.file_size),
      icon: attIcon(a),
      url: a.file_url || '',
    });
  });

  return orders;
}
