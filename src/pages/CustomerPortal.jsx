import React, { useEffect, useRef, useState } from 'react';
import { loadOrdersFromDB } from '../lib/portalOrders.js';
import '../styles/customer-portal.css';

// Customer Portal — React port of customer-portal.html +
// customer-portal-script.js. Behaviour, texts, class names and the mixed
// data model (real Supabase orders + demo points/vouchers) are kept 1:1.

const MJM_BANK = {
  bank: 'Maybank Berhad', accountName: 'MJM Nursery Sdn Bhd',
  accountNo: '5120 1234 5678', swift: 'MBBEMYKL',
};

const POINTS_INIT = {
  balance: 3450, tier: 'Gold', totalEarned: 5200, redeemed: 1200, expiringSoon: 200,
  nextTier: { name: 'Platinum', threshold: 5000 },
  history: [
    { type: 'earn', desc: 'Order ORD-001 — 2,000 seedlings', pts: 440, date: '15 Nov 2024' },
    { type: 'earn', desc: 'Order ORD-002 — 1,500 seedlings', pts: 330, date: '01 Dec 2024' },
    { type: 'earn', desc: 'Order ORD-003 — 3,000 seedlings', pts: 660, date: '20 Oct 2024' },
    { type: 'redeem', desc: 'Voucher SAVE10 redeemed', pts: -200, date: '05 Dec 2024' },
    { type: 'earn', desc: 'Order ORD-004 — 1,000 seedlings', pts: 220, date: '05 Aug 2024' },
    { type: 'expire', desc: 'Points expired (Q1 2024)', pts: -200, date: '31 Mar 2024' },
  ],
};

const VOUCHERS = {
  active: [
    { code: 'MJMGOLD10', type: 'Gold Member Reward', discount: '10% OFF', desc: '10% off your next order.', minSpend: 'RM 10,000', expiry: '30 Jun 2025', points: null },
    { code: 'FIRSTCOLL', type: 'Collection Bonus', discount: 'RM 500 OFF', desc: 'RM 500 rebate on transport costs.', minSpend: 'RM 20,000', expiry: '31 May 2025', points: null },
  ],
  shop: [
    { code: 'BULKDEAL5', type: 'Shop Voucher', discount: '5% OFF', desc: '5% off on orders above 2,000 seedlings.', minSpend: 'RM 40,000', expiry: '31 Aug 2025', points: null },
    { code: 'SAVE200', type: 'Points Redemption', discount: 'RM 200 OFF', desc: 'Redeem 200 points for RM 200 off.', minSpend: 'RM 5,000', expiry: '31 Dec 2025', points: 200 },
    { code: 'NURSERY15', type: 'Seasonal Promo', discount: '15% OFF', desc: 'Seasonal discount — Oct–Dec 2025.', minSpend: 'RM 30,000', expiry: '31 Dec 2025', points: null },
  ],
  past: [
    { code: 'SAVE10OLD', type: 'Redeemed', discount: 'RM 200 OFF', desc: 'Used on ORD-004.', status: 'Used', usedOn: '05 Aug 2024' },
    { code: 'NEWYEAR24', type: 'Expired', discount: '5% OFF', desc: 'New Year 2024 promotion.', status: 'Expired', usedOn: '—' },
  ],
};

const MAX_PER_SLOT = 3;
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16];
const fmtHour = h => ({ main: (h > 12 ? h - 12 : h) + ':00', ampm: h < 12 ? 'AM' : 'PM' });
const slotKey = (date, hour) => date + '|' + hour;

const STEP_KEYS = ['order_placed', 'confirmed', 'preparing', 'ready_to_collect', 'collecting', 'order_completed'];
const STEP_LABELS = { order_placed: 'Order Placed', confirmed: 'Confirmed', preparing: 'Preparing', ready_to_collect: 'Ready-to-Collect', collecting: 'Collecting', order_completed: 'Order Completed' };
const STATUS_STEPS = { 'Pending Payment': 1, 'Order Confirmed': 2, 'Preparing': 3, 'Ready-to-Collect': 4, 'Collecting': 5, 'Order Completed': 6, 'Cancelled': 0, 'Refunded': 0 };

const badgeClass = s => ({ 'Order Confirmed': 'badge-green', 'Pending Payment': 'badge-amber', 'Ready-to-Collect': 'badge-teal', 'Collecting': 'badge-orange', 'Order Completed': 'badge-grey', 'Cancelled': 'badge-red', 'Refunded': 'badge-red' }[s] || 'badge-grey');
const isOrderDone = o => o.status === 'Order Completed' || o.status === 'Cancelled' || o.status === 'Refunded';

export default function CustomerPortal() {
  const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('orders');
  const [detailId, setDetailId] = useState(null);
  const [points, setPoints] = useState(POINTS_INIT);
  const [vtab, setVtab] = useState('active');
  const [slotBookings, setSlotBookings] = useState({});
  const [consentSigned, setConsentSigned] = useState({});
  const [orderRatings, setOrderRatings] = useState({});
  const [orderNextBooking, setOrderNextBooking] = useState({});
  const [consentModal, setConsentModal] = useState(null); // {orderId}
  const [attModal, setAttModal] = useState(null); // {orderId, stepKey}
  const [ratingModal, setRatingModal] = useState(null); // {orderId}
  const [toast, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  const userName = sessionStorage.getItem('mjm_user_name') || 'Customer';
  const userEmail = sessionStorage.getItem('mjm_user_email') || '';
  const [profile, setProfile] = useState({
    name: userName, company: '', email: userEmail, phone: '', state: 'Sarawak',
    since: 'January 2024', addr1: '', addr2: '', city: 'Miri', post: '98000',
    bstate: 'Sarawak', country: 'Malaysia',
  });

  useEffect(() => {
    // Render immediately with empty state, then fill with real orders.
    loadOrdersFromDB().then(setOrders);
    return () => clearTimeout(toastTimer.current);
  }, []);

  function showToast(msg) {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500);
  }

  function doLogout() {
    sessionStorage.clear();
    window.location.href = 'auth.html';
  }

  // ── Overdue logic (ported) ──
  function isOverdueReminder(o) {
    if (['Order Completed', 'Cancelled', 'Pending Payment', 'Order Confirmed', 'Preparing'].includes(o.status)) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const nextBooking = orderNextBooking[o.id];
    if (o.status === 'Ready-to-Collect' || o.status === 'Collecting') {
      if (nextBooking) { const bd = new Date(nextBooking); bd.setHours(0, 0, 0, 0); return today > bd; }
      const refDate = o.readyDate || o.collDate;
      if (!refDate) return false;
      const rd = new Date(refDate); rd.setHours(0, 0, 0, 0);
      return Math.round((today - rd) / 864e5) >= 14;
    }
    return false;
  }
  function overdueReminderText(o) {
    if (orderNextBooking[o.id]) return 'Booking was scheduled but collection has not been completed. Please contact MJM Nursery.';
    return 'No collection booking has been made. Please book your collection slot immediately.';
  }

  function redeemPts(pts, code, e) {
    e.stopPropagation();
    if (points.balance < pts) { showToast('⚠ Not enough points.'); return; }
    setPoints(p => ({ ...p, balance: p.balance - pts, redeemed: p.redeemed + pts }));
    showToast('✅ ' + code + ' unlocked!');
  }
  function copyCode(code, e) {
    e.stopPropagation();
    navigator.clipboard?.writeText(code);
    showToast('📋 "' + code + '" copied!');
  }

  const detailOrder = detailId ? orders.find(x => x.id === detailId) : null;

  // ══════════ RENDER ══════════
  return (
    <>
      <div id="page-portal" className="page active dot-bg">
        <nav className="portal-nav">
          <div className="pn-left">
            <div className="pn-brand-chip">🌿 MJM Nursery</div>
            <div className="pn-title">Customer Portal</div>
          </div>
          <div className="pn-right">
            <div className="pn-welcome">Welcome, <strong id="pn-user-name">{userName}</strong></div>
            <a href="index.html" style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--green)', textDecoration: 'none', padding: '.38rem 1rem', border: '1.5px solid var(--green)', borderRadius: 20, transition: 'all .15s' }}>Shop</a>
            <button className="btn-signout" onClick={doLogout}>Sign Out</button>
          </div>
        </nav>

        <div className="portal-body">
          <div className="section-label">Overview</div>
          <StatsRow orders={orders} points={points} setActiveTab={setActiveTab} />

          <div className="section-label">Modules</div>
          <div className="portal-tabs">
            {[['orders', '📦 My Orders'], ['collection', '📅 Collection'], ['points', '⭐ My Points'], ['vouchers', '🏷️ Vouchers'], ['profile', '👤 Profile']].map(([key, label]) => (
              <button key={key} className={'ptab' + (activeTab === key ? ' active' : '')} onClick={() => setActiveTab(key)}>{label}</button>
            ))}
          </div>

          <div className={'ptab-panel' + (activeTab === 'orders' ? ' active' : '')} id="ptab-orders">
            <div id="orders-list">
              {detailOrder ? (
                <OrderDetail
                  o={detailOrder}
                  onBack={() => setDetailId(null)}
                  consentSigned={consentSigned}
                  isOverdueReminder={isOverdueReminder}
                  overdueReminderText={overdueReminderText}
                  openConsentModal={id => setConsentModal({ orderId: id })}
                  openAttModal={(id, stepKey) => setAttModal({ orderId: id, stepKey })}
                  slotBookings={slotBookings}
                  onBookingSubmit={(id, date, hour) => {
                    setSlotBookings(sb => ({ ...sb, [slotKey(date, hour)]: (sb[slotKey(date, hour)] || 0) + 1 }));
                    setOrderNextBooking(m => ({ ...m, [id]: date }));
                    const f = fmtHour(hour);
                    showToast('✅ Booking confirmed for ' + date + ' at ' + f.main + ' ' + f.ampm);
                  }}
                  showToast={showToast}
                />
              ) : (
                <OrdersList orders={orders} orderRatings={orderRatings} onDetail={setDetailId} onRate={id => setRatingModal({ orderId: id })} showToast={showToast} />
              )}
            </div>
          </div>

          <div className={'ptab-panel' + (activeTab === 'collection' ? ' active' : '')} id="ptab-collection">
            <div id="coll-view">
              <CollectionView orders={orders} isOverdueReminder={isOverdueReminder} overdueReminderText={overdueReminderText} />
            </div>
          </div>

          <div className={'ptab-panel' + (activeTab === 'points' ? ' active' : '')} id="ptab-points">
            <div id="points-view"><PointsView p={points} /></div>
          </div>

          <div className={'ptab-panel' + (activeTab === 'vouchers' ? ' active' : '')} id="ptab-vouchers">
            <div id="vouchers-view">
              <VouchersView vtab={vtab} setVtab={setVtab} redeemPts={redeemPts} copyCode={copyCode} />
            </div>
          </div>

          <div className={'ptab-panel' + (activeTab === 'profile' ? ' active' : '')} id="ptab-profile">
            <ProfileTab profile={profile} setProfile={setProfile} onSave={() => showToast('Profile updated ✅')} />
          </div>
        </div>
      </div>

      {consentModal && (
        <ConsentModal
          onClose={() => setConsentModal(null)}
          onSubmit={() => {
            setConsentSigned(m => ({ ...m, [consentModal.orderId]: { signed: true, signedAt: new Date().toLocaleString('en-MY') } }));
            setConsentModal(null);
            showToast('✅ Consent signed!');
          }}
        />
      )}

      {attModal && (
        <AttachmentModal
          o={orders.find(x => x.id === attModal.orderId)}
          stepKey={attModal.stepKey}
          onClose={() => setAttModal(null)}
          showToast={showToast}
        />
      )}

      {ratingModal && (
        <RatingModal
          o={orders.find(x => x.id === ratingModal.orderId)}
          onClose={() => setRatingModal(null)}
          onSubmit={(rating, comment) => {
            setOrderRatings(m => ({ ...m, [ratingModal.orderId]: { rating, comment } }));
            setRatingModal(null);
            showToast('⭐'.repeat(rating) + ' Thank you for your feedback!');
          }}
        />
      )}

      <div className={'toast' + (toast ? ' show' : '')} id="toast">{toast}</div>
    </>
  );
}

function StatsRow({ orders, points, setActiveTab }) {
  const active = orders.filter(o => !['Order Completed', 'Cancelled'].includes(o.status)).length;
  const ready = orders.filter(o => o.status === 'Ready-to-Collect').length;
  return (
    <div className="stats-row" id="stats-row">
      <div className="stat-card" onClick={() => setActiveTab('orders')}>
        <div className="sc-status sc-status-default">ACTIVE</div><span className="sc-icon">📦</span>
        <div className="sc-label">Total Orders</div><div className="sc-val">{orders.length}</div>
      </div>
      <div className="stat-card accent-amber" onClick={() => setActiveTab('collection')}>
        <div className="sc-status">PENDING</div><span className="sc-icon">🚛</span>
        <div className="sc-label">Awaiting Collection</div><div className="sc-val">{active}</div>
      </div>
      <div className="stat-card accent-blue" onClick={() => setActiveTab('collection')}>
        <div className="sc-status" style={{ color: 'var(--blue)' }}>HEALTHY</div><span className="sc-icon">🌱</span>
        <div className="sc-label">Ready-to-Collect</div><div className="sc-val">{ready}</div>
      </div>
      <div className="stat-card accent-green" onClick={() => setActiveTab('points')}>
        <div className="sc-status">POINTS</div><span className="sc-icon">⭐</span>
        <div className="sc-label">My Points Balance</div><div className="sc-val">{points.balance.toLocaleString()}</div>
      </div>
    </div>
  );
}

function OrdersList({ orders, orderRatings, onDetail, onRate, showToast }) {
  const active = orders.filter(o => !isOrderDone(o));
  const history = orders.filter(isOrderDone);
  if (!active.length && !history.length) {
    return (
      <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--ink3)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>📦</div>
        <div style={{ fontWeight: 600, color: 'var(--ink2)' }}>No orders yet</div>
        <div style={{ fontSize: '.85rem', marginTop: '.3rem' }}>Browse the shop to place your first order.</div>
      </div>
    );
  }
  return (
    <>
      {active.length > 0 && (
        <>
          <div className="orders-section-label">📦 Active Orders ({active.length})</div>
          <div className="orders-grid">{active.map(o => <OrderCard key={o.id} o={o} orderRatings={orderRatings} onDetail={onDetail} onRate={onRate} showToast={showToast} />)}</div>
        </>
      )}
      {history.length > 0 && (
        <>
          <div className="orders-section-label">🗂️ Order History ({history.length})</div>
          <div className="orders-grid">{history.map(o => <OrderCard key={o.id} o={o} orderRatings={orderRatings} onDetail={onDetail} onRate={onRate} showToast={showToast} />)}</div>
        </>
      )}
    </>
  );
}

function OrderCard({ o, orderRatings, onDetail, onRate, showToast }) {
  const isCompleted = o.status === 'Order Completed';
  const isCancelled = o.status === 'Cancelled';
  let dateDisplay = <>—</>;
  if (isCompleted) {
    dateDisplay = <span style={{ color: 'var(--green)', fontWeight: 600 }}>{o.completedDate || o.collDate || '—'}</span>;
  } else if (isCancelled) {
    dateDisplay = <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>{o.cancelledDate || o.collDate || '—'}</span>;
  } else if (o.collDate) {
    const d = Math.round((new Date(o.collDate) - new Date()) / 864e5);
    dateDisplay = d < 0 ? <span style={{ color: 'var(--red)', fontWeight: 700 }}>Overdue</span>
      : d === 0 ? <span style={{ color: 'var(--amber)', fontWeight: 700 }}>Today!</span>
      : <>{o.collDate} <span style={{ fontSize: '.72rem', color: d <= 14 ? 'var(--amber)' : 'var(--ink3)' }}>({d}d)</span></>;
  }
  const dateLabel = isCompleted ? 'Completed Date' : isCancelled ? 'Cancelled Date' : 'Collection Date';
  const rated = orderRatings[o.id];
  return (
    <div className="order-card">
      <div className="oc-header">
        <div><div className="oc-id">{o.id}</div><div className="oc-date">Ordered {o.orderDate}</div></div>
        <span className={'badge ' + badgeClass(o.status)}>{o.status}</span>
      </div>
      <div className="oc-body">
        <div className="oc-row"><span className="oc-row-label">Seedling Batch</span><span className="oc-row-val">{o.variety}</span></div>
        <div className="oc-row"><span className="oc-row-label">Quantity</span><span className="oc-row-val">{o.qty.toLocaleString()} seedlings</span></div>
        <div className="oc-row"><span className="oc-row-label">Unit Price</span><span className="oc-row-val">RM {o.price.toFixed(2)}</span></div>
        <div className="oc-row"><span className="oc-row-label">{dateLabel}</span><span className="oc-row-val">{dateDisplay}</span></div>
        {o.status === 'Collecting' && o.collectedQty ? (
          <div className="oc-row"><span className="oc-row-label">Collected So Far</span><span className="oc-row-val" style={{ color: 'var(--teal)', fontWeight: 700 }}>{o.collectedQty.toLocaleString()} / {o.qty.toLocaleString()} seedlings</span></div>
        ) : null}
      </div>
      <div className="oc-footer">
        <div>
          <div className="oc-total-label">Order Total</div>
          <div className="oc-total-val">RM {o.total.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</div>
          {rated
            ? <div className="rating-done-badge">{'⭐'.repeat(rated.rating)} Reviewed</div>
            : (isCompleted ? <button className="btn-outline" style={{ marginTop: '.4rem', fontSize: '.74rem' }} onClick={() => onRate(o.id)}>⭐ Leave a Review</button> : null)}
        </div>
        <div className="oc-actions">
          <button className="btn-outline" onClick={() => onDetail(o.id)}>View Details</button>
          {o.status === 'Pending Payment' && <button className="btn-outline danger" onClick={() => showToast('Please contact MJM Nursery to cancel.')}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}

function OrderDetail({ o, onBack, consentSigned, isOverdueReminder, overdueReminderText, openConsentModal, openAttModal, slotBookings, onBookingSubmit, showToast }) {
  const stepsDone = STATUS_STEPS[o.status] || 0;
  const pct = Math.max(0, Math.min(100, ((stepsDone - 0.5) / STEP_KEYS.length) * 100));
  const isCompleted = o.status === 'Order Completed';

  let alertEl = null;
  if (!['Order Completed', 'Cancelled'].includes(o.status)) {
    if (isOverdueReminder(o)) {
      alertEl = <div className="coll-alert overdue"><span className="ca-icon">⚠️</span><div className="ca-text"><strong>Collection Overdue</strong><span>{overdueReminderText(o)}</span></div></div>;
    } else if (o.status === 'Ready-to-Collect') {
      alertEl = <div className="coll-alert ready"><span className="ca-icon">✅</span><div className="ca-text"><strong>Your order is Ready-to-Collect!</strong><span>Please sign the consent form and book your collection date.</span></div></div>;
    } else if (o.status === 'Collecting') {
      const rem = o.qty - (o.collectedQty || 0);
      alertEl = <div className="coll-alert soon"><span className="ca-icon">🚛</span><div className="ca-text"><strong>Collection In Progress</strong><span>{(o.collectedQty || 0).toLocaleString()} of {o.qty.toLocaleString()} collected. {rem.toLocaleString()} remaining.</span></div></div>;
    }
  }

  return (
    <>
      <button className="detail-back" onClick={onBack}>← Back to Orders</button>
      <div className="detail-header">
        <div className="dh-top"><div className="dh-id">{o.id}</div><span className={'badge ' + badgeClass(o.status)}>{o.status}</span></div>
        <div className="dh-meta">
          <div className="dh-meta-item"><span>Batch</span><strong>{o.variety}</strong></div>
          <div className="dh-meta-item"><span>Quantity</span><strong>{o.qty.toLocaleString()} seedlings</strong></div>
          <div className="dh-meta-item"><span>Total</span><strong>RM {o.total.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</strong></div>
        </div>
      </div>
      {alertEl}
      <div className="card">
        <h3>📍 Order Progress</h3>
        <div className="h-timeline-wrap">
          <div className="h-timeline">
            <div className="h-timeline-progress" style={{ width: pct + '%' }}></div>
            {STEP_KEYS.map((key, i) => {
              const isDone = i < stepsDone, isActive = i === stepsDone && !isCompleted && o.status !== 'Cancelled';
              const cls = isDone ? 'done' : isActive ? 'active' : '';
              const atts = (o.attachments && o.attachments[key]) || [];
              return (
                <div key={key} className={'h-step ' + cls}>
                  <div className="h-step-dot"></div>
                  <div className="h-step-label">{STEP_LABELS[key]}</div>
                  {atts.length
                    ? <div className="h-step-attach" onClick={e => { e.stopPropagation(); openAttModal(o.id, key); }}>📎 {atts.length} Doc{atts.length !== 1 ? 's' : ''}</div>
                    : <div style={{ height: '1.2rem' }}></div>}
                </div>
              );
            })}
          </div>
        </div>
        {o.booking && <BookedSlotPanel o={o} />}
        {o.status === 'Ready-to-Collect' && !o.booking && (
          consentSigned[o.id]
            ? <BookingForm o={o} slotBookings={slotBookings} onSubmit={onBookingSubmit} showToast={showToast} />
            : (
              <div className="booking-section">
                <h4>📅 Book Collection</h4>
                <p>Before booking, please sign our collection consent form.</p>
                <div className="booking-locked">
                  <div className="booking-locked-icon">🔒</div>
                  <div className="booking-locked-text"><strong>Consent Required</strong>You must agree to our collection terms before proceeding.</div>
                  <button className="btn-primary" style={{ marginLeft: 'auto', flexShrink: 0 }} onClick={() => openConsentModal(o.id)}>Sign Consent →</button>
                </div>
              </div>
            )
        )}
        {o.status === 'Pending Payment' && <PaymentUploadSection o={o} showToast={showToast} />}
      </div>
    </>
  );
}

function BookedSlotPanel({ o }) {
  const b = o.booking;
  if (!b) return null;
  let dateLabel;
  try {
    dateLabel = new Date(b.date + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  } catch { dateLabel = b.date || '—'; }
  const timeLabel = (b.startTime || '').slice(0, 5) + (b.endTime ? ' – ' + (b.endTime || '').slice(0, 5) : '');
  const qtyLabel = b.qty ? b.qty.toLocaleString() + ' seedlings' : '—';
  // Deep link: ?search=<orderNo>&edit=<bookingId> tells the booking page to
  // auto-search and pop the change modal for this booking.
  const changeUrl = 'https://collect.mjmnursery.com/?search=' + encodeURIComponent(o._orderNo || '') + '&edit=' + encodeURIComponent(b.id || '');
  return (
    <div className="booked-slot-card">
      <div className="bsc-head"><span className="bsc-icon">📅</span><h4>Booked Collection Slot</h4></div>
      <div className="bsc-grid">
        <div className="bsc-row"><span className="bsc-label">Date</span><span className="bsc-val">{dateLabel}</span></div>
        <div className="bsc-row"><span className="bsc-label">Time</span><span className="bsc-val">{timeLabel || '—'}</span></div>
        <div className="bsc-row"><span className="bsc-label">Quantity</span><span className="bsc-val">{qtyLabel}</span></div>
        {b.notes ? <div className="bsc-row"><span className="bsc-label">Notes</span><span className="bsc-val">{b.notes}</span></div> : null}
      </div>
      <div className="bsc-actions">
        <a className="btn-primary bsc-edit-btn" href={changeUrl} target="_blank" rel="noopener noreferrer">✏️ Change Booking</a>
      </div>
    </div>
  );
}

function PaymentUploadSection({ o, showToast }) {
  const [fileName, setFileName] = useState(null);
  const fileRef = useRef(null);
  return (
    <div className="payment-section">
      <h4>💳 Complete Your Payment</h4>
      <p>Transfer the full amount and upload your payment proof.</p>
      <div className="bank-details-box">
        <div className="bank-details-title">🏦 MJM Nursery Bank Account</div>
        <div className="bank-row"><span className="bank-label">Bank</span><span className="bank-val">{MJM_BANK.bank}</span></div>
        <div className="bank-row"><span className="bank-label">Account Name</span><span className="bank-val">{MJM_BANK.accountName}</span></div>
        <div className="bank-row"><span className="bank-label">Account No.</span><span className="bank-val bank-acc">{MJM_BANK.accountNo} <button className="copy-acc-btn" onClick={e => { e.stopPropagation(); navigator.clipboard?.writeText(MJM_BANK.accountNo.replace(/\s/g, '')); showToast('📋 Account number copied!'); }}>Copy</button></span></div>
        <div className="bank-amount-row"><span>Amount Due</span><span className="bank-amount">RM {o.total.toLocaleString('en-MY', { minimumFractionDigits: 2 })}</span></div>
      </div>
      <div className="upload-box" style={{ display: fileName ? 'none' : undefined }}>
        <div className="upload-icon">📎</div>
        <div className="upload-label">Upload Payment Proof</div>
        <div className="upload-hint">Click to select (JPG, PNG, PDF)</div>
        <input type="file" ref={fileRef} accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => { if (e.target.files && e.target.files[0]) setFileName(e.target.files[0].name); }} />
        <button className="upload-btn" onClick={() => fileRef.current?.click()}>Select File</button>
      </div>
      {fileName && (
        <div className="upload-preview" style={{ display: 'flex' }}>
          <span className="upload-preview-icon">✅</span>
          <span className="upload-preview-name">{fileName}</span>
          <button className="upload-remove-btn" onClick={() => { if (fileRef.current) fileRef.current.value = ''; setFileName(null); }}>✕ Remove</button>
        </div>
      )}
      <button className="btn-primary" style={{ marginTop: '1rem', width: '100%' }} onClick={() => {
        if (!fileName) { showToast('⚠ Please select a file first.'); return; }
        showToast('✅ Payment proof submitted!');
      }}>📤 Submit Payment Proof</button>
    </div>
  );
}

function BookingForm({ o, slotBookings, onSubmit, showToast }) {
  const [date, setDate] = useState('');
  const [hour, setHour] = useState(null);
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const maxQ = o.qty;
  const slotCount = h => slotBookings[slotKey(date, h)] || 0;
  return (
    <div className="booking-section-inner">
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '1rem', padding: '.45rem .8rem', background: 'var(--green-light)', borderRadius: 8, width: 'fit-content' }}>
        <span>✅</span><span style={{ fontSize: '.77rem', fontWeight: 700, color: '#15803d' }}>Consent on record</span>
      </div>
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 700, color: 'var(--ink2)', letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: '.4rem' }}>Select Date</label>
        <input type="date" min={today} value={date} style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '.6rem .9rem', fontSize: '.86rem', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit', width: 220 }} onChange={e => { setDate(e.target.value); setHour(null); }} />
      </div>
      <div className="time-picker-section">
        <label>Select Time Slot</label>
        <div className="time-wheel-grid">
          {!date
            ? <p style={{ fontSize: '.8rem', color: 'var(--ink3)' }}>Please select a date first.</p>
            : HOURS.map(h => {
              const count = slotCount(h);
              const full = count >= MAX_PER_SLOT;
              const f = fmtHour(h);
              const rem = MAX_PER_SLOT - count;
              return (
                <div key={h} className={'time-slot ' + (full ? 'full ' : '') + (hour === h ? 'selected' : '')} onClick={() => {
                  if (full) { showToast('⚠ This slot is full.'); return; }
                  setHour(h);
                }}>
                  <div className="ts-time">{f.main}</div>
                  <div className="ts-ampm">{f.ampm}</div>
                  <div className={'ts-slots ' + (full ? 'full-label' : '')}>{full ? 'FULL' : rem + ' left'}</div>
                </div>
              );
            })}
        </div>
      </div>
      <div className="booking-form-grid">
        <div>
          <label>Collection Quantity</label>
          <input type="number" placeholder="e.g. 2000" min={1} max={maxQ} value={qty} onChange={e => setQty(e.target.value)} style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '.6rem .9rem', fontSize: '.86rem', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit', width: '100%' }} />
          <div style={{ fontSize: '.7rem', color: 'var(--ink3)', marginTop: '.3rem' }}>Max: {maxQ.toLocaleString()}</div>
        </div>
        <div>
          <label>Vehicle / Notes</label>
          <input type="text" placeholder="e.g. 10-tonne lorry" value={notes} onChange={e => setNotes(e.target.value)} style={{ background: 'var(--surface2)', border: '1.5px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '.6rem .9rem', fontSize: '.86rem', color: 'var(--ink)', outline: 'none', fontFamily: 'inherit', width: '100%' }} />
        </div>
      </div>
      <button className="btn-primary" style={{ marginTop: '.8rem' }} onClick={() => {
        if (!date) { showToast('⚠ Please select a date.'); return; }
        if (hour === null) { showToast('⚠ Please select a time.'); return; }
        if (!qty || Number(qty) < 1) { showToast('⚠ Please enter quantity.'); return; }
        if (Number(qty) > Number(maxQ)) { showToast('⚠ Quantity exceeds maximum.'); return; }
        onSubmit(o.id, date, hour);
        setDate(''); setHour(null); setQty(''); setNotes('');
      }}>📅 Confirm Booking Request</button>
    </div>
  );
}

function ConsentModal({ onClose, onSubmit }) {
  const [checked, setChecked] = useState(false);
  const [hasMark, setHasMark] = useState(false);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    // Signature pad — ported from initCanvas() in the original script.
    const t = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const getPos = e => {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return { x: src.clientX - r.left, y: src.clientY - r.top };
      };
      canvas.onmousedown = canvas.ontouchstart = e => { e.preventDefault(); drawingRef.current = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
      canvas.onmousemove = canvas.ontouchmove = e => { e.preventDefault(); if (!drawingRef.current) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasMark(true); };
      canvas.onmouseup = canvas.ontouchend = () => { drawingRef.current = false; };
      canvas.onmouseleave = () => { drawingRef.current = false; };
    }, 100);
    return () => clearTimeout(t);
  }, []);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasMark(false);
  };

  return (
    <div className="modal-overlay open" id="consent-modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>📋 Collection Consent Form</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <p style={{ fontSize: '.82rem', color: 'var(--ink2)', marginBottom: '1rem', lineHeight: 1.6 }}>Please read and sign the consent form below before proceeding to book your collection date.</p>
        <div className="consent-body">
          <h4>MJM Nursery — Collection Terms &amp; Conditions</h4>
          <p><strong>1. Collection Responsibility.</strong> The customer is solely responsible for arranging adequate transportation to collect the seedlings from MJM Nursery on the booked date and time.</p>
          <p><strong>2. Seedling Condition.</strong> MJM Nursery guarantees seedlings are in healthy condition at time of collection.</p>
          <p><strong>3. Quantity Verification.</strong> The customer must verify the quantity received at the time of collection and sign the delivery order (DO).</p>
          <p><strong>4. Changes &amp; Cancellations.</strong> Booking date changes require a minimum of 48 hours&apos; notice.</p>
          <p><strong>5. Access &amp; Safety.</strong> The customer&apos;s driver and staff must adhere to nursery safety guidelines while on premises.</p>
          <p><strong>6. Force Majeure.</strong> MJM Nursery reserves the right to reschedule collections in the event of extreme weather or other circumstances beyond our control.</p>
        </div>
        <label className="consent-check">
          <input type="checkbox" id="consent-chk" checked={checked} onChange={e => setChecked(e.target.checked)} />
          <span className="consent-check-label">I have read and agree to the MJM Nursery Collection Terms &amp; Conditions stated above.</span>
        </label>
        <div className="consent-sign-area">
          <label>Your Signature</label>
          <div className="sign-canvas-wrap">
            <canvas id="sign-canvas" ref={canvasRef}></canvas>
            <button className="sign-clear" onClick={clearSignature}>Clear</button>
          </div>
          <p style={{ fontSize: '.7rem', color: 'var(--ink4)', marginTop: '.35rem' }}>Draw your signature above using mouse or touch.</p>
        </div>
        <button className="btn-primary" id="consent-submit-btn" disabled={!(checked && hasMark)} style={{ width: '100%' }} onClick={onSubmit}>✍️ Sign &amp; Proceed to Booking</button>
      </div>
    </div>
  );
}

function AttachmentModal({ o, stepKey, onClose, showToast }) {
  const files = (o && o.attachments && o.attachments[stepKey]) || [];
  const label = STEP_LABELS[stepKey] || stepKey;
  return (
    <div className="modal-overlay open" id="att-modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3 id="att-modal-title">{label} — Documents</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div id="att-modal-body">
          {files.length ? files.map((f, i) => (
            <div key={i} className="att-file" onClick={() => {
              if (f && f.url) { window.open(f.url, '_blank', 'noopener'); showToast('📥 Opening ' + f.name + '…'); }
              else showToast('⚠️ File unavailable');
            }}>
              <div className="att-file-icon">{f.icon}</div>
              <div className="att-file-info"><strong>{f.name}</strong><span>{f.type} · {f.size}</span></div>
              <div className="att-file-dl">⬇ Download</div>
            </div>
          )) : <p style={{ fontSize: '.84rem', color: 'var(--ink3)', textAlign: 'center', padding: '1.5rem 0' }}>No documents for this stage.</p>}
        </div>
      </div>
    </div>
  );
}

function RatingModal({ o, onClose, onSubmit }) {
  const [val, setVal] = useState(0);
  const [comment, setComment] = useState('');
  const labels = ['', '😐 Poor', '🙂 Fair', '😊 Good', '😄 Great', '🤩 Excellent!'];
  return (
    <div className="modal-overlay open" id="rating-modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 460, textAlign: 'center' }}>
        <div className="modal-header" style={{ justifyContent: 'center', position: 'relative' }}>
          <h3>🌟 Rate Your Experience</h3>
          <button className="modal-close" style={{ position: 'absolute', right: 0, top: 0 }} onClick={onClose}>✕</button>
        </div>
        <div id="rating-order-info" style={{ fontSize: '.82rem', color: 'var(--ink3)', marginBottom: '1.2rem' }}>
          {o ? <><strong>{o.id}</strong> — {o.variety}</> : null}
        </div>
        <p style={{ fontSize: '.88rem', color: 'var(--ink2)', marginBottom: '1.4rem', lineHeight: 1.6 }}>How would you rate our <strong>products &amp; services</strong> for this order?</p>
        <div className="star-row" id="star-row">
          {[1, 2, 3, 4, 5].map(v => (
            <span key={v} className={'star' + (v <= val ? ' active' : '')} data-val={v} onClick={() => setVal(v)}>☆</span>
          ))}
        </div>
        <div className="star-label" id="star-label">{val ? labels[val] : 'Tap a star to rate'}</div>
        <textarea className="rating-textarea" placeholder="Leave a comment (optional)…" value={comment} onChange={e => setComment(e.target.value)}></textarea>
        <button className="btn-primary" id="rating-submit-btn" disabled={!val} style={{ width: '100%', marginTop: '.8rem' }} onClick={() => val && onSubmit(val, comment.trim())}>Submit Review</button>
        <button style={{ background: 'none', border: 'none', color: 'var(--ink3)', fontSize: '.8rem', cursor: 'pointer', marginTop: '.6rem', display: 'block', width: '100%' }} onClick={onClose}>Skip for now</button>
      </div>
    </div>
  );
}

function CollectionView({ orders, isOverdueReminder, overdueReminderText }) {
  const upcoming = orders.filter(o => !['Order Completed', 'Cancelled'].includes(o.status) && o.collDate).sort((a, b) => new Date(a.collDate) - new Date(b.collDate));
  const past = orders.filter(o => o.status === 'Order Completed');
  if (!upcoming.length && !past.length) {
    return <div className="empty-state"><div className="es-icon">📅</div><div className="es-title">No collections yet</div><div className="es-desc">Upcoming schedules will appear here.</div></div>;
  }
  return (
    <>
      {upcoming.map(o => {
        if (isOverdueReminder(o)) return <div key={o.id} className="coll-alert overdue"><span className="ca-icon">⚠️</span><div className="ca-text"><strong>{o.id} — Collection Overdue</strong><span>{overdueReminderText(o)}</span></div></div>;
        if (o.status === 'Ready-to-Collect') return <div key={o.id} className="coll-alert ready"><span className="ca-icon">✅</span><div className="ca-text"><strong>{o.id} — Ready-to-Collect!</strong><span>Go to order details to sign consent and book.</span></div></div>;
        return null;
      })}
      {upcoming.length > 0 && (
        <div className="card">
          <h3>📅 Upcoming Collections</h3>
          {upcoming.map(o => (
            <div key={o.id} className="oc-row" style={{ flexWrap: 'wrap', gap: '.5rem', padding: '.7rem 0' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '.87rem' }}>{o.id}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--ink3)' }}>{o.variety}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.7rem' }}>
                <div style={{ textAlign: 'right' }}><div style={{ fontSize: '.74rem', color: 'var(--ink3)' }}>{o.collDate}</div></div>
                <span className={'badge ' + badgeClass(o.status)}>{o.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function PointsView({ p }) {
  const pct = Math.min(100, Math.round((p.balance / p.nextTier.threshold) * 100));
  return (
    <>
      <div className="points-hero">
        <div className="ph-inner" style={{ position: 'relative', zIndex: 2 }}>
          <div>
            <div className="ph-label">Available Points</div>
            <div className="ph-val">{p.balance.toLocaleString()}<span>pts</span></div>
            <span className="tier-badge tier-gold">🏆 {p.tier} Member</span>
          </div>
          <div className="ph-progress-card">
            <label>Progress to {p.nextTier.name}</label>
            <div className="ph-bar-bg"><div className="ph-bar" style={{ width: pct + '%' }}></div></div>
            <div className="ph-bar-text">{p.balance.toLocaleString()} / {p.nextTier.threshold.toLocaleString()} pts ({pct}%)</div>
          </div>
        </div>
      </div>
      <div className="points-stats">
        <div className="pts-card hi"><div className="v">{p.balance.toLocaleString()}</div><div className="l">Available</div></div>
        <div className="pts-card"><div className="v">{p.totalEarned.toLocaleString()}</div><div className="l">Total Earned</div></div>
        <div className="pts-card"><div className="v">{p.redeemed.toLocaleString()}</div><div className="l">Redeemed</div></div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: '1.5px solid var(--border)' }}>
          <h3 style={{ border: 'none', padding: 0, margin: 0 }}>Points History</h3>
        </div>
        {p.history.map((h, i) => (
          <div key={i} className="pts-row">
            <div className={'pts-icon ' + h.type}>{h.type === 'earn' ? '🌱' : h.type === 'redeem' ? '🏷️' : '⏳'}</div>
            <div className="pts-info"><strong>{h.desc}</strong><span>{h.date}</span></div>
            <div className={'pts-amount ' + h.type}>{h.pts > 0 ? '+' : ''}{h.pts.toLocaleString()} pts</div>
          </div>
        ))}
      </div>
    </>
  );
}

function VouchersView({ vtab, setVtab, redeemPts, copyCode }) {
  const list = VOUCHERS[vtab];
  return (
    <>
      <div className="vtabs">
        <button className={'vtab' + (vtab === 'active' ? ' active' : '')} onClick={() => setVtab('active')}>✅ Active ({VOUCHERS.active.length})</button>
        <button className={'vtab' + (vtab === 'shop' ? ' active' : '')} onClick={() => setVtab('shop')}>🛒 Shop ({VOUCHERS.shop.length})</button>
        <button className={'vtab' + (vtab === 'past' ? ' active' : '')} onClick={() => setVtab('past')}>📁 Past ({VOUCHERS.past.length})</button>
      </div>
      {list.length ? (
        <div className="voucher-grid">
          {list.map(v => {
            const cls = vtab === 'active' ? 'vc-green' : vtab === 'shop' ? 'vc-amber' : 'vc-grey';
            return (
              <div key={v.code} className={'vc ' + cls}>
                <div className="vc-inner">
                  <div className="vc-type">{v.type}</div>
                  <div className="vc-discount">{v.discount}</div>
                  <div className="vc-desc">{v.desc}</div>
                  <div className="vc-min">Min. spend: {v.minSpend}</div>
                  <div className="vc-code-row">
                    <span className="vc-code">{v.code}</span>
                    {vtab !== 'past' && (v.points
                      ? <button className="vc-copy" onClick={e => redeemPts(v.points, v.code, e)}>Redeem</button>
                      : <button className="vc-copy" onClick={e => copyCode(v.code, e)}>Copy</button>)}
                  </div>
                  <div className="vc-foot">
                    {vtab === 'past'
                      ? <span>{v.status === 'Used' ? 'Used ' + v.usedOn : 'Expired'}</span>
                      : <span>Expires {v.expiry}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="empty-state"><div className="es-icon">🏷️</div><div className="es-title">No vouchers here</div></div>}
    </>
  );
}

function ProfileTab({ profile, setProfile, onSave }) {
  const set = k => e => setProfile(p => ({ ...p, [k]: e.target.value }));
  return (
    <>
      <div className="card">
        <h3>Account Details</h3>
        <div className="profile-grid">
          <div className="pg-item"><label>Full Name</label><input type="text" id="pf-name" value={profile.name} onChange={set('name')} /></div>
          <div className="pg-item"><label>Company / Estate</label><input type="text" id="pf-company" value={profile.company} onChange={set('company')} /></div>
          <div className="pg-item"><label>Email</label><input type="email" id="pf-email" readOnly value={profile.email} /></div>
          <div className="pg-item"><label>Phone</label><input type="tel" id="pf-phone" value={profile.phone} onChange={set('phone')} /></div>
          <div className="pg-item"><label>State</label><input type="text" id="pf-state" value={profile.state} onChange={set('state')} /></div>
          <div className="pg-item"><label>Member Since</label><input type="text" id="pf-since" readOnly value={profile.since} /></div>
        </div>
      </div>
      <div className="card">
        <h3>Billing Address</h3>
        <div className="profile-grid">
          <div className="pg-item" style={{ gridColumn: '1/-1' }}><label>Address Line 1</label><input type="text" id="pf-addr1" value={profile.addr1} onChange={set('addr1')} /></div>
          <div className="pg-item" style={{ gridColumn: '1/-1' }}><label>Address Line 2</label><input type="text" id="pf-addr2" value={profile.addr2} onChange={set('addr2')} /></div>
          <div className="pg-item"><label>City</label><input type="text" id="pf-city" value={profile.city} onChange={set('city')} /></div>
          <div className="pg-item"><label>Postcode</label><input type="text" id="pf-post" value={profile.post} onChange={set('post')} /></div>
          <div className="pg-item"><label>State</label><input type="text" id="pf-bstate" value={profile.bstate} onChange={set('bstate')} /></div>
          <div className="pg-item"><label>Country</label><input type="text" id="pf-country" value={profile.country} onChange={set('country')} /></div>
        </div>
      </div>
      <div className="card">
        <h3>Change Password</h3>
        <div className="profile-grid">
          <div className="pg-item"><label>Current Password</label><input type="password" placeholder="Current password" /></div>
          <div className="pg-item"><label>New Password</label><input type="password" placeholder="New password" /></div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '.5rem' }}>
        <button className="btn-primary" onClick={onSave}>💾 Save Changes</button>
      </div>
    </>
  );
}
