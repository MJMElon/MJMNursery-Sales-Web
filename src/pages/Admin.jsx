import React, { useEffect } from 'react';
import '../styles/admin.css';
import {
  boot,
  toggleSidebar, switchTab, toggleSbSub, doLogout, closeModal,
  showSettingsSubTab, addProductType, addCollection, addTag,
  savePaymentDetails, uploadPaymentQr, removePaymentQr,
  saveNotificationConfig, saveAutoReleaseConfig,
} from '../lib/adminShell.js';

// MJM NURSERY — ADMIN PORTAL (React shell + settings)
// 1:1 port of public/admin.html's markup. The nine admin-*.js modules are
// still classic scripts in public/ that getElementById/querySelector the
// containers below and inject HTML with inline onclick= handlers, so every
// id / class / DOM structure here is kept byte-identical to the old page.
// This component renders ONCE and never re-renders — after mount the DOM
// belongs to the classic modules, exactly like the old static page.
//
// Handler convention (matches the old inline onclick= attributes):
//   - functions ported into src/lib/adminShell.js are called directly;
//   - functions living in the nine classic modules are window globals,
//     called as window.fnName(...).
export default function Admin() {
  useEffect(() => { boot(); }, []);
  return (
    <>
      <div id="auth-loading" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}><div style={{ textAlign: 'center' }}><div style={{ fontSize: '3rem', fontWeight: '900', color: 'rgba(124,92,191,.15)', letterSpacing: '.05em', marginBottom: '.5rem' }}>MJM</div><div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--ink3)' }}>Loading admin portal...</div></div></div>
            {/* Mobile-only hamburger + backdrop. Sidebar slides in over the
           content on phones; backdrop dismisses it on tap. Hidden on desktop
           via CSS so the layout is unchanged for big screens. */}
            <button className="sb-toggle" id="sb-toggle" aria-label="Open menu" onClick={(e) => { toggleSidebar(); }}>☰</button>
            <div className="sb-backdrop" id="sb-backdrop" onClick={(e) => { toggleSidebar(false); }} />
            <div id="app" className="app">
              <aside className="sidebar">
                <div className="sb-watermark">MJM</div>
                <div className="sb-logo"><div><div className="sb-logo-text">MJM</div><div className="sb-logo-sub">Admin Portal</div></div></div>
                <div className="sb-nav">
                  <div className="sb-item active" id="sb-orders-item" onClick={(e) => { switchTab('orders',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg></span>
                    <span>Orders</span>
                    </div>
                  <div className="sb-item" id="sb-reports-item" onClick={(e) => { switchTab('reports',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="13" width="3" height="5" /><rect x="12" y="9" width="3" height="9" /><rect x="17" y="5" width="3" height="13" /></svg></span>
                    <span>Reports</span>
                    </div>
                  <div className="sb-item" id="sb-customers-parent" onClick={(e) => { toggleSbSub('customers'); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></span>
                    <span>Customers</span>
                    <svg style={{ marginLeft: 'auto', width: '12px', height: '12px', transition: 'transform .2s' }} id="sb-cust-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9" /></svg>
                    </div>
                  <div className="sb-sub" id="sb-sub-customers">
                    <div className="sb-sub-item active" onClick={(e) => { switchTab('customers',document.getElementById('sb-customers-parent'));window.showCustSubTab('list'); }}>Customer List</div>
                    <div className="sb-sub-item" onClick={(e) => { switchTab('customers',document.getElementById('sb-customers-parent'));window.showCustSubTab('points'); }}>Points & Membership</div>
                    </div>
                  <div className="sb-item" id="sb-products-item" onClick={(e) => { switchTab('products',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96c1.4 9.3-3.45 14.5-8.2 16.04Z" /><path d="M2 22c1.59-3.43 3.7-6.45 6.3-9" /></svg></span>
                    <span>Products</span>
                    </div>
                  <div className="sb-item" id="sb-payments-item" onClick={(e) => { switchTab('payments',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg></span>
                    <span>Payments</span>
                    </div>
                  <div className="sb-item" id="sb-promos-item" onClick={(e) => { switchTab('promos',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></svg></span>
                    <span>Promotions</span>
                    </div>
                  <div className="sb-item" id="sb-coupons-item" onClick={(e) => { switchTab('coupons',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" /><line x1="13" y1="5" x2="13" y2="19" /></svg></span>
                    <span>Coupons</span>
                    </div>
                  <div className="sb-item" id="sb-webdesign-item" onClick={(e) => { switchTab('webdesign',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" /></svg></span>
                    <span>Website Design</span>
                    </div>
                  <div className="sb-item" id="sb-settings-item" onClick={(e) => { switchTab('settings',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg></span>
                    <span>Settings</span>
                    </div>
                  <div className="sb-item" id="sb-users-item" style={{ display: 'none' }} onClick={(e) => { switchTab('users',e.currentTarget); }}>
                    <span className="sb-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><circle cx="12" cy="10" r="3" /><path d="M7 20c.7-2.3 2.7-4 5-4s4.3 1.7 5 4" /></svg></span>
                    <span>User Access</span>
                    </div>
                  </div>
                <div className="sb-footer">
                  <div className="sb-user"><strong id="admin-name">Admin</strong></div>
                  <a className="sb-visit-store" href="/index.html" target="_blank" rel="noopener" title="Open MJM Nursery storefront in a new tab">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                    <span>Visit Online Store</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '11px', height: '11px', opacity: '.7' }} aria-hidden="true"><path d="M7 17L17 7" /><polyline points="7 7 17 7 17 17" /></svg>
                  </a>
                  <button className="sb-logout" onClick={(e) => { doLogout(); }}>Sign Out</button>
                  </div>
                </aside>
              <div className="main">
                {/* ORDERS */}
                <div className="tab-content active" id="tab-orders">
                  <div className="main-header"><div className="main-title">Manage Orders</div><button className="btn btn-primary" onClick={(e) => { window.openNewOrder(); }}>+ Add Order</button></div>
                  <div className="stats-grid" id="order-stats" />
                  <div className="card">
                    <div className="filter-bar">
                      <input className="filter-input" id="order-search" placeholder="Search order ID, customer, billing name or email..." onInput={(e) => { window.loadOrders(); }} />
                      <select className="filter-select" id="order-filter" onChange={(e) => { window.loadOrders(); }}>
                        <option value="">All Status</option>
                        <option>Pending Payment</option>
                        <option>Ready for Collection</option>
                        </select>
                      <button className="btn-filter" id="orders-filter-btn" onClick={(e) => { window.openOrderFilterDrawer(); }} title="Advanced filters">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
                  Filter
                  <span className="filter-count" id="orders-filter-count" style={{ display: 'none' }}>0</span>
                        </button>
                      </div>
                    <div id="orders-bulk-bar" style={{ display: 'none', alignItems: 'center', gap: '.8rem', padding: '.6rem .9rem', marginBottom: '.8rem', background: 'var(--green-light)', border: '1px solid var(--border2)', borderRadius: '8px' }}>
                      <span id="orders-bulk-count" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--ink2)' }}>0 selected</span>
                      <button className="btn btn-outline btn-sm" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={(e) => { window.bulkDeleteOrders(); }}>Delete Selected</button>
                      <button className="btn btn-outline btn-sm" onClick={(e) => { window.clearOrderSelection(); }}>Clear</button>
                      </div>
                    <div id="orders-count" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', fontSize: '12px', color: 'var(--ink3)', marginBottom: '.4rem' }} />
                    <div id="orders-table"><div className="loading">Loading orders...</div></div>
                    </div>
                  </div>
                {/* ORDERS FILTER DRAWER */}
                <div className="fd-overlay" id="orderFilterOverlay" onClick={(e) => { window.closeOrderFilterDrawer(); }} />
                <aside className="filter-drawer" id="orderFilterDrawer" aria-hidden="true">
                  <div className="fd-head">
                    <h3>Filter Orders</h3>
                    <button className="modal-close" onClick={(e) => { window.closeOrderFilterDrawer(); }} aria-label="Close">×</button>
                    </div>
                  <div className="fd-body">
                    <div className="fd-section">
                      <div className="fd-title">Date Range</div>
                      <div className="fd-dates">
                        <div>
                          <label className="fd-label" htmlFor="fd-date-from">From</label>
                          <input type="date" id="fd-date-from" className="fd-input" />
                          </div>
                        <div>
                          <label className="fd-label" htmlFor="fd-date-to">To</label>
                          <input type="date" id="fd-date-to" className="fd-input" />
                          </div>
                        </div>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Status</div>
                      <label className="fd-check"><input type="checkbox" className="fd-status" defaultValue="Open" /> Open</label>
                      <label className="fd-check"><input type="checkbox" className="fd-status" defaultValue="Pending Payment" /> Pending Payment</label>
                      <label className="fd-check"><input type="checkbox" className="fd-status" defaultValue="Ready for Collection" /> Ready for Collection</label>
                      <label className="fd-check"><input type="checkbox" className="fd-status" defaultValue="Completed" /> Completed</label>
                      <label className="fd-check"><input type="checkbox" className="fd-status" defaultValue="Cancelled" /> Cancelled</label>
                      <label className="fd-check"><input type="checkbox" className="fd-status" defaultValue="Deleted" /> Deleted</label>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Payment</div>
                      <label className="fd-check"><input type="checkbox" className="fd-pay" defaultValue="Unpaid" /> Unpaid</label>
                      <label className="fd-check"><input type="checkbox" className="fd-pay" defaultValue="Partially Paid" /> Partially Paid</label>
                      <label className="fd-check"><input type="checkbox" className="fd-pay" defaultValue="Paid" /> Paid</label>
                      <label className="fd-check"><input type="checkbox" className="fd-pay" defaultValue="Refunded" /> Refunded</label>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Terms</div>
                      <label className="fd-check"><input type="checkbox" className="fd-term" defaultValue="cash" /> Cash</label>
                      <label className="fd-check"><input type="checkbox" className="fd-term" defaultValue="credit" /> Credit</label>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Channel</div>
                      <label className="fd-check"><input type="checkbox" className="fd-channel" defaultValue="online_store" /> Online Store</label>
                      <label className="fd-check"><input type="checkbox" className="fd-channel" defaultValue="admin_panel" /> Admin Panel</label>
                      <label className="fd-check"><input type="checkbox" className="fd-channel" defaultValue="google" /> Google</label>
                      <label className="fd-check"><input type="checkbox" className="fd-channel" defaultValue="whatsapp" /> WhatsApp</label>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Product</div>
                      <input type="text" id="fd-product" className="fd-input" placeholder="e.g. Oil Palm Seedling" />
                      </div>
                    </div>
                  <div className="fd-foot">
                    <button className="btn btn-outline" onClick={(e) => { window.clearOrderFilters(); }}>Clear All</button>
                    <button className="btn btn-primary" onClick={(e) => { window.applyOrderFilters(); }}>Apply</button>
                    </div>
                  </aside>
                {/* CUSTOMERS FILTER DRAWER */}
                <div className="fd-overlay" id="custFilterOverlay" onClick={(e) => { window.closeCustomerFilterDrawer(); }} />
                <aside className="filter-drawer" id="custFilterDrawer" aria-hidden="true">
                  <div className="fd-head">
                    <h3>Filter Customers</h3>
                    <button className="modal-close" onClick={(e) => { window.closeCustomerFilterDrawer(); }} aria-label="Close">×</button>
                    </div>
                  <div className="fd-body">
                    <div className="fd-section">
                      <div className="fd-title">Joined</div>
                      <div className="fd-dates">
                        <div><label className="fd-label" htmlFor="cf-date-from">From</label><input type="date" id="cf-date-from" className="fd-input" /></div>
                        <div><label className="fd-label" htmlFor="cf-date-to">To</label><input type="date" id="cf-date-to" className="fd-input" /></div>
                        </div>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Status</div>
                      <label className="fd-check"><input type="checkbox" className="cf-status" defaultValue="verified" /> Verified</label>
                      <label className="fd-check"><input type="checkbox" className="cf-status" defaultValue="unverified" /> Unverified</label>
                      <label className="fd-check"><input type="checkbox" className="cf-status" defaultValue="blacklisted" /> Blacklisted</label>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Purchase</div>
                      <label className="fd-check"><input type="checkbox" className="cf-purchase" defaultValue="never" /> Never purchased</label>
                      <label className="fd-check"><input type="checkbox" className="cf-purchase" defaultValue="first" /> First purchase</label>
                      <label className="fd-check"><input type="checkbox" className="cf-purchase" defaultValue="repeat" /> Repeat purchase</label>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Membership</div>
                      <div id="cf-tiers"><div style={{ fontSize: '11px', color: 'var(--ink4)' }}>Loading tiers…</div></div>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Payment Terms</div>
                      <label className="fd-check"><input type="checkbox" className="cf-term" defaultValue="cash" /> Cash</label>
                      <label className="fd-check"><input type="checkbox" className="cf-term" defaultValue="credit" /> Credit</label>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Has Paid Order</div>
                      <label className="fd-check"><input type="radio" name="cf-paid" className="cf-paid" defaultValue="" defaultChecked /> Any</label>
                      <label className="fd-check"><input type="radio" name="cf-paid" className="cf-paid" defaultValue="yes" /> Yes</label>
                      <label className="fd-check"><input type="radio" name="cf-paid" className="cf-paid" defaultValue="no" /> No</label>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Spending (RM)</div>
                      <div style={{ display: 'flex', gap: '.4rem' }}>
                        <select id="cf-spend-op" className="fd-input" style={{ flex: '1' }}><option value="">—</option><option value="gt">More than</option><option value="eq">Equals to</option><option value="lt">Less than</option></select>
                        <input type="number" id="cf-spend-amt" className="fd-input" min="0" step="0.01" placeholder="Amount" style={{ flex: '1' }} />
                        </div>
                      </div>
                    <div className="fd-section">
                      <div className="fd-title">Point Balance</div>
                      <div style={{ display: 'flex', gap: '.4rem' }}>
                        <select id="cf-points-op" className="fd-input" style={{ flex: '1' }}><option value="">—</option><option value="gt">More than</option><option value="lt">Less than</option></select>
                        <input type="number" id="cf-points-amt" className="fd-input" min="0" step="1" placeholder="Points" style={{ flex: '1' }} />
                        </div>
                      </div>
                    <div className="fd-section" style={{ borderBottom: 'none' }}>
                      <div className="fd-title">Credit Balance (RM outstanding)</div>
                      <div style={{ display: 'flex', gap: '.4rem' }}>
                        <select id="cf-credit-op" className="fd-input" style={{ flex: '1' }}><option value="">—</option><option value="gt">More than</option><option value="lt">Less than</option></select>
                        <input type="number" id="cf-credit-amt" className="fd-input" min="0" step="0.01" placeholder="Amount" style={{ flex: '1' }} />
                        </div>
                      </div>
                    </div>
                  <div className="fd-foot">
                    <button className="btn btn-outline" onClick={(e) => { window.clearCustomerFilters(); }}>Clear All</button>
                    <button className="btn btn-primary" onClick={(e) => { window.applyCustomerFilters(); }}>Apply</button>
                    </div>
                  </aside>
                {/* REPORTS */}
                <div className="tab-content" id="tab-reports">
                  <div className="main-header"><div className="main-title">Reports</div></div>
                  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '.9rem 1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.06em', marginRight: '.3rem' }}>Date Range</span>
                      <button className="btn btn-sm" id="rpt-preset-today" onClick={(e) => { window.applyReportPreset('today'); }} style={{ fontSize: '11px', padding: '5px 10px', border: '1px solid var(--border)' }}>Today</button>
                      <button className="btn btn-sm" id="rpt-preset-last_7" onClick={(e) => { window.applyReportPreset('last_7'); }} style={{ fontSize: '11px', padding: '5px 10px', border: '1px solid var(--border)' }}>Last 7 Days</button>
                      <button className="btn btn-sm" id="rpt-preset-last_30" onClick={(e) => { window.applyReportPreset('last_30'); }} style={{ fontSize: '11px', padding: '5px 10px', border: '1px solid var(--border)' }}>Last 30 Days</button>
                      <button className="btn btn-sm" id="rpt-preset-this_month" onClick={(e) => { window.applyReportPreset('this_month'); }} style={{ fontSize: '11px', padding: '5px 10px', border: '1px solid var(--border)' }}>This Month</button>
                      <button className="btn btn-sm" id="rpt-preset-last_month" onClick={(e) => { window.applyReportPreset('last_month'); }} style={{ fontSize: '11px', padding: '5px 10px', border: '1px solid var(--border)' }}>Last Month</button>
                      <button className="btn btn-sm" id="rpt-preset-this_year" onClick={(e) => { window.applyReportPreset('this_year'); }} style={{ fontSize: '11px', padding: '5px 10px', border: '1px solid var(--border)' }}>This Year</button>
                      <button className="btn btn-sm" id="rpt-preset-all_time" onClick={(e) => { window.applyReportPreset('all_time'); }} style={{ fontSize: '11px', padding: '5px 10px', border: '1px solid var(--border)' }}>All Time</button>
                      <span style={{ marginLeft: '.6rem', fontSize: '11px', color: 'var(--ink4)' }}>Custom:</span>
                      <input id="rpt-from" type="date" className="form-input" style={{ fontSize: '12px', padding: '5px 8px', width: '140px' }} />
                      <span style={{ fontSize: '11px', color: 'var(--ink4)' }}>→</span>
                      <input id="rpt-to" type="date" className="form-input" style={{ fontSize: '12px', padding: '5px 8px', width: '140px' }} />
                      <button className="btn btn-primary btn-sm" onClick={(e) => { window.applyReportRange(); }} style={{ fontSize: '11px' }}>Apply</button>
                      </div>
                    </div>
                  <div id="reports-body"><div className="loading">Pick a date range above.</div></div>
                  </div>
                {/* CUSTOMERS */}
                <div className="tab-content" id="tab-customers">
                  <div className="main-header"><div className="main-title">Manage Customers</div><button className="btn btn-primary" onClick={(e) => { window.openAddCustomer(); }}>+ Add Customer</button></div>
                  <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1rem' }}>
                    <button className="btn btn-primary btn-sm" id="cust-subtab-list" onClick={(e) => { window.showCustSubTab('list'); }} style={{ fontSize: '11px' }}>Customer List</button>
                    <button className="btn btn-outline btn-sm" id="cust-subtab-groups" onClick={(e) => { window.showCustSubTab('groups'); }} style={{ fontSize: '11px' }}>Groups</button>
                    <button className="btn btn-outline btn-sm" id="cust-subtab-points" onClick={(e) => { window.showCustSubTab('points'); }} style={{ fontSize: '11px' }}>Points & Membership</button>
                    </div>
                  <div id="cust-panel-list">
                    <div className="stats-grid" id="cust-stats" />
                    <div className="card"><div className="filter-bar"><input className="filter-input" id="cust-search" placeholder="Search name or email..." onInput={(e) => { window.loadCustomers(); }} /><button className="btn-filter" id="cust-filter-btn" onClick={(e) => { window.openCustomerFilterDrawer(); }} title="Filter customers"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg> Filter <span className="filter-count" id="cust-filter-count" style={{ display: 'none' }}>0</span></button></div><div id="customers-table"><div className="loading">Loading customers...</div></div></div>
                    </div>
                  <div id="cust-panel-groups" style={{ display: 'none' }}>
                    <div className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.8rem' }}>
                        <h3 style={{ margin: '0', fontSize: '1rem', fontWeight: '700' }}>Customer Groups</h3>
                        <button className="btn btn-primary btn-sm" onClick={(e) => { window.openCreateGroup(); }}>+ New Group</button>
                        </div>
                      <p style={{ fontSize: '11px', color: 'var(--ink4)', marginBottom: '.8rem' }}>Group customers (e.g. <em>Loyalty VIP</em>, <em>Wholesale</em>, <em>Trade Show 2026</em>) so coupons / promotions can target a specific cohort. Eligibility for a coupon's <strong>Selected customer group(s)</strong> rule reads from these groups.</p>
                      <div id="groups-table"><div className="loading">Loading groups…</div></div>
                      </div>
                    </div>
                  <div id="cust-panel-points" style={{ display: 'none' }}>
                    <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                      <label style={{ fontSize: '11px', fontWeight: '700', color: 'var(--ink3)' }}>Date Range:</label>
                      <input type="date" id="pts-date-from" className="form-input" style={{ width: 'auto', fontSize: '12px', padding: '5px 10px' }} onChange={(e) => { window.loadPointsStats(); }} />
                      <span style={{ fontSize: '12px', color: 'var(--ink4)' }}>to</span>
                      <input type="date" id="pts-date-to" className="form-input" style={{ width: 'auto', fontSize: '12px', padding: '5px 10px' }} onChange={(e) => { window.loadPointsStats(); }} />
                      <button className="btn btn-outline btn-sm" onClick={(e) => { window.setPtsDateRange('month'); }}>This Month</button>
                      <button className="btn btn-outline btn-sm" onClick={(e) => { window.setPtsDateRange('year'); }}>This Year</button>
                      <button className="btn btn-outline btn-sm" onClick={(e) => { window.setPtsDateRange('all'); }}>All Time</button>
                      </div>
                    <div className="stats-grid" id="pts-stats" />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div className="card">
                        <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}><h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Points Settings</h3><div><button className="btn btn-outline btn-sm" id="pts-edit-btn" onClick={(e) => { window.togglePointsEdit(true); }}>Edit</button><button className="btn btn-primary btn-sm" id="pts-save-btn" onClick={(e) => { window.savePointsSettings(); }} style={{ display: 'none' }}>Save Changes</button><button className="btn btn-outline btn-sm" id="pts-cancel-btn" onClick={(e) => { window.togglePointsEdit(false); }} style={{ display: 'none' }}>Cancel</button></div></div>
                        <div style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '1rem' }}>Configure how customers earn and redeem points.</div>
                        <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}><div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.8rem' }}>Earning</div><div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}><span style={{ fontSize: '13px', fontWeight: '600' }}>Every RM</span><input className="form-input" id="pts-earn-rm" type="number" step="1" defaultValue="1" style={{ width: '70px', fontSize: '13px', padding: '6px 10px', textAlign: 'center' }} disabled /><span style={{ fontSize: '13px', fontWeight: '600' }}>spent =</span><input className="form-input" id="pts-earn-pts" type="number" step="1" defaultValue="1" style={{ width: '70px', fontSize: '13px', padding: '6px 10px', textAlign: 'center' }} disabled /><span style={{ fontSize: '13px', fontWeight: '600' }}>point(s)</span></div><div style={{ fontSize: '11px', color: 'var(--ink4)', marginTop: '.5rem' }}>Customers earn points on every purchase after payment is confirmed.</div></div>
                        <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '1rem' }}><div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.8rem' }}>Redemption</div><div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}><input className="form-input" id="pts-redeem-pts" type="number" step="1" defaultValue="100" style={{ width: '70px', fontSize: '13px', padding: '6px 10px', textAlign: 'center' }} disabled /><span style={{ fontSize: '13px', fontWeight: '600' }}>points = RM</span><input className="form-input" id="pts-redeem-rm" type="number" step="0.01" defaultValue="1.00" style={{ width: '70px', fontSize: '13px', padding: '6px 10px', textAlign: 'center' }} disabled /><span style={{ fontSize: '13px', fontWeight: '600' }}>discount</span></div><div style={{ fontSize: '11px', color: 'var(--ink4)', marginTop: '.5rem' }}>Customers can redeem points at checkout to offset their order total.</div></div>
                        <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '1rem', marginTop: '1rem' }}><div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>Summary</div><div id="pts-summary" style={{ fontSize: '13px', color: 'var(--ink2)', lineHeight: '1.8' }} /></div>
                        <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}><div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>Change History</div><div id="pts-history" style={{ fontSize: '12px', color: 'var(--ink4)' }}>Loading...</div></div>
                        </div>
                      <div className="card">
                        <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}><h3 style={{ fontSize: '1rem', fontWeight: '600' }}>Member Tiers</h3><button className="btn btn-primary btn-sm" onClick={(e) => { window.addTierRow(); }}>+ Add Tier</button></div>
                        <div style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '1rem' }}>Define membership tiers based on total points earned. Customers are auto-upgraded.</div>
                        <div id="tiers-list"><div style={{ fontSize: '12px', color: 'var(--ink4)' }}>Loading...</div></div>
                        </div>
                      </div>
                    </div>
                  </div>
                {/* PRODUCTS */}
                <div className="tab-content" id="tab-products">
                  <div className="main-header"><div className="main-title">Manage Products</div><div style={{ display: 'flex', gap: '.5rem' }}><button className="btn btn-outline" onClick={(e) => { window.syncProductsFromBatches(); }}>🔄 Sync from Batches</button><button className="btn btn-primary" onClick={(e) => { window.openProductForm(); }}>+ Add Product</button></div></div>
                  <div className="stats-grid" id="prod-stats" />
                  <div className="card">
                    <div className="filter-bar">
                      <input className="filter-input" id="prod-search" placeholder="Search products..." onInput={(e) => { window.loadProducts(); }} />
                      <select className="filter-select" id="prod-type-filter" onChange={(e) => { window.loadProducts(); }}><option value="">All Types</option><option>Seedling</option><option>Merchandise</option></select>
                      <select className="filter-select" id="prod-coll-filter" onChange={(e) => { window.loadProducts(); }}><option value="">All Collections</option><option>Normal Sales</option><option>Promotion</option></select>
                      <select className="filter-select" id="prod-status-filter" onChange={(e) => { window.loadProducts(); }}><option value="">All Status</option><option value="published">Published</option><option value="unpublished">Unpublished</option></select>
                      </div>
                    <div id="products-table"><div className="loading">Loading products...</div></div>
                    </div>
                  </div>
                {/* PAYMENTS — accountant-facing payment verification view */}
                <div className="tab-content" id="tab-payments">
                  <div className="main-header"><div className="main-title">Payment Verification</div></div>
                  <div className="card">
                    <div className="filter-bar">
                      <input className="filter-input" id="payment-search" placeholder="Search order number or customer..." onInput={(e) => { window.loadPayments(); }} />
                      <button className="filter-chip active" data-payment-view="awaiting" onClick={(e) => { window.setPaymentView('awaiting'); }}>Awaiting Verification <span className="chip-count" id="pv-count-awaiting" data-color="amber"></span></button>
                      <button className="filter-chip" data-payment-view="partial" onClick={(e) => { window.setPaymentView('partial'); }}>Partially Paid <span className="chip-count" id="pv-count-partial" data-color="blue"></span></button>
                      <button className="filter-chip" data-payment-view="credit" onClick={(e) => { window.setPaymentView('credit'); }}>Credit Note <span className="chip-count" id="pv-count-credit" data-color="orange"></span></button>
                      <button className="filter-chip" data-payment-view="einvoice" onClick={(e) => { window.setPaymentView('einvoice'); }}>E-Invoice Requests <span className="chip-count" id="pv-count-einvoice" data-color="purple"></span></button>
                      </div>
                    <div id="payments-table"><div className="loading">Loading payments...</div></div>
                    </div>
                  </div>
                {/* PROMOTIONS */}
                <div className="tab-content" id="tab-promos">
                  <div className="main-header">
                    <div className="main-title">Manage Promotions</div>
                    <div style={{ display: 'flex', gap: '.5rem' }}>
                      <button className="btn btn-primary" onClick={(e) => { window.openPromoAssistant(); }}>✨ AI Builder</button>
                      <button className="btn btn-outline" onClick={(e) => { window.openPromoForm(); }}>+ Manual Entry</button>
                      </div>
                    </div>
                  <div className="filter-bar" style={{ marginBottom: '1rem' }}>
                    <button className="filter-chip active" data-promo-status="" onClick={(e) => { window.setPromoFilter(''); }}>All</button>
                    <button className="filter-chip" data-promo-status="live" onClick={(e) => { window.setPromoFilter('live'); }}>Live</button>
                    <button className="filter-chip" data-promo-status="scheduled" onClick={(e) => { window.setPromoFilter('scheduled'); }}>Scheduled</button>
                    <button className="filter-chip" data-promo-status="draft" onClick={(e) => { window.setPromoFilter('draft'); }}>Drafts</button>
                    <button className="filter-chip" data-promo-status="ended" onClick={(e) => { window.setPromoFilter('ended'); }}>Ended</button>
                    </div>
                  <div className="card"><div id="promos-table"><div className="loading">Loading promotions...</div></div></div>
                  </div>
                {/* COUPONS */}
                <div className="tab-content" id="tab-coupons">
                  <div className="main-header">
                    <div className="main-title">Manage Coupons</div>
                    <div style={{ display: 'flex', gap: '.5rem' }}>
                      <button className="btn btn-outline" onClick={(e) => { window.openCouponBulkForm(); }}>⚡ Bulk Generate</button>
                      <button className="btn btn-primary" onClick={(e) => { window.openCouponForm(); }}>+ New Coupon</button>
                      </div>
                    </div>
                  <div className="stats-grid" id="coupon-stats" />
                  <div className="card">
                    <div className="filter-bar">
                      <input className="filter-input" id="coupon-search" placeholder="Search code or name..." onInput={(e) => { window.loadCoupons(); }} />
                      <button className="filter-chip active" data-coupon-status="" onClick={(e) => { window.setCouponFilter(''); }}>All</button>
                      <button className="filter-chip" data-coupon-status="active" onClick={(e) => { window.setCouponFilter('active'); }}>Active</button>
                      <button className="filter-chip" data-coupon-status="scheduled" onClick={(e) => { window.setCouponFilter('scheduled'); }}>Scheduled</button>
                      <button className="filter-chip" data-coupon-status="expired" onClick={(e) => { window.setCouponFilter('expired'); }}>Expired</button>
                      <button className="filter-chip" data-coupon-status="exhausted" onClick={(e) => { window.setCouponFilter('exhausted'); }}>Exhausted</button>
                      <button className="filter-chip" data-coupon-status="inactive" onClick={(e) => { window.setCouponFilter('inactive'); }}>Inactive</button>
                      </div>
                    <div id="coupons-table"><div className="loading">Loading coupons...</div></div>
                    </div>
                  </div>
                {/* WEBSITE DESIGN */}
                <div className="tab-content" id="tab-webdesign">
                  <div className="main-header"><div className="main-title">Website Design — Our Passion Section</div></div>
                  <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '1rem' }}>Upload images and edit text for the "Our Passion" ecosystem flow on the storefront. Changes appear instantly on the live site.</p>
                  <div className="card" id="webdesign-passion-list"><div className="loading">Loading...</div></div>
                  </div>
                {/* USER ACCESS — admin-only */}
                <div className="tab-content" id="tab-users">
                  <div className="main-header"><div className="main-title">User Access</div></div>
                  <div className="card">
                    <div className="filter-bar">
                      <input className="filter-input" id="user-search" placeholder="Search name or email..." onInput={(e) => { window.loadUsers(); }} />
                      <select className="filter-select" id="user-filter" onChange={(e) => { window.loadUsers(); }}>
                        <option value="">All Access Levels</option>
                        <option value="admin">Admin</option>
                        <option value="normal">Normal</option>
                        <option value="none">No Access</option>
                        </select>
                      </div>
                    <div id="users-table"><div className="loading">Loading users...</div></div>
                    </div>
                  <div className="card" style={{ marginTop: '1rem', background: 'var(--green-light)', borderColor: 'var(--green)' }}>
                    <div style={{ display: 'flex', gap: '.7rem', alignItems: 'flex-start' }}>
                      <div style={{ fontSize: '1.4rem' }}>ⓘ</div>
                      <div style={{ fontSize: '12px', lineHeight: '1.7', color: 'var(--ink2)' }}>
                        <strong>How this list works.</strong>
                  Only users granted salesweb access from the <em>umbrella User Access portal</em> appear here.
                  <span style={{ display: 'inline-block', marginLeft: '.2rem' }}><span className="badge badge-green">admin</span> users always see every page.</span>
                        <span style={{ display: 'inline-block', marginLeft: '.4rem' }}><span className="badge badge-blue">normal</span> users only see pages you tick in <strong>Edit Pages</strong>.</span>
                  Granting / revoking salesweb access itself is still done from the umbrella portal.
                </div>
                      </div>
                    </div>
                  </div>
                {/* SETTINGS */}
                <div className="tab-content" id="tab-settings">
                  <div className="main-header"><div className="main-title">Settings</div></div>
                  <div style={{ display: 'flex', gap: '.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <button className="btn btn-primary btn-sm" id="set-subtab-catalog" onClick={(e) => { showSettingsSubTab('catalog'); }}>Catalog</button>
                    <button className="btn btn-outline btn-sm" id="set-subtab-payments" onClick={(e) => { showSettingsSubTab('payments'); }}>Payments</button>
                    <button className="btn btn-outline btn-sm" id="set-subtab-orders" onClick={(e) => { showSettingsSubTab('orders'); }}>Orders</button>
                    <button className="btn btn-outline btn-sm" id="set-subtab-notifications" onClick={(e) => { showSettingsSubTab('notifications'); }}>Notifications</button>
                    </div>
                  {/* CATALOG: product types / collections / tags */}
                  <div id="set-panel-catalog">
                    <div className="card"><h3>Product Types</h3><div id="settings-product-types" /><div style={{ display: 'flex', gap: '.5rem', marginTop: '.8rem' }}><input className="form-input" id="new-ptype" style={{ maxWidth: '250px' }} placeholder="New product type name" /><button className="btn btn-primary btn-sm" onClick={(e) => { addProductType(); }}>Add</button></div></div>
                    <div className="card"><h3>Collections</h3><div id="settings-collections" /><div style={{ display: 'flex', gap: '.5rem', marginTop: '.8rem' }}><input className="form-input" id="new-collection" style={{ maxWidth: '250px' }} placeholder="New collection name" /><button className="btn btn-primary btn-sm" onClick={(e) => { addCollection(); }}>Add</button></div></div>
                    <div className="card"><h3>Product Tags</h3><div id="settings-tags" /><div style={{ display: 'flex', gap: '.5rem', marginTop: '.8rem' }}><input className="form-input" id="new-tag" style={{ maxWidth: '250px' }} placeholder="New tag name" /><button className="btn btn-primary btn-sm" onClick={(e) => { addTag(); }}>Add</button></div></div>
                    </div>{/* /catalog */}
                  {/* PAYMENTS */}
                  <div id="set-panel-payments" style={{ display: 'none' }}>
                    {/* ─── Payment Details (offline bank transfer + DuitNow QR) ─── */}
                    <div className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
                        <h3 style={{ margin: '0' }}>Payment Details (Bank Transfer / DuitNow QR)</h3>
                        <button className="btn btn-primary btn-sm" id="pay-save-btn" onClick={(e) => { savePaymentDetails(); }}>Save</button>
                        </div>
                      <p style={{ fontSize: '11px', color: 'var(--ink4)', marginBottom: '.4rem' }}>These are shown to customers on the offline-payment screen so they know where to transfer money to.</p>
                      <p id="pay-debug" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '.8rem' }}>Loading saved values…</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.8rem', marginBottom: '.8rem' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Bank Name</label>
                          <input className="form-input" id="pay-bank-name" placeholder="e.g. Maybank" style={{ fontSize: '13px' }} />
                          </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Account Name</label>
                          <input className="form-input" id="pay-account-name" placeholder="e.g. MJM Nursery Sdn Bhd" style={{ fontSize: '13px' }} />
                          </div>
                        </div>
                      <div style={{ marginBottom: '.8rem' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Account Number</label>
                        <input className="form-input" id="pay-account-number" placeholder="e.g. 5121-1234-5678" style={{ fontSize: '13px', fontFamily: 'monospace', letterSpacing: '.05em' }} />
                        </div>
                      <div style={{ marginBottom: '.5rem' }}>
                        <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>DuitNow QR Image</label>
                        <input type="file" id="pay-qr-file" accept="image/*" style={{ fontSize: '12px' }} onChange={(e) => { uploadPaymentQr(); }} />
                        <div id="pay-qr-status" style={{ fontSize: '11px', color: 'var(--ink4)', marginTop: '.3rem' }}>No QR uploaded yet.</div>
                        <div id="pay-qr-preview" style={{ marginTop: '.5rem', display: 'none' }}>
                          <img id="pay-qr-img" style={{ maxWidth: '200px', border: '1px solid var(--border)', borderRadius: '8px', padding: '.4rem', background: '#fff' }} />
                          <div><button className="btn btn-outline btn-sm" onClick={(e) => { removePaymentQr(); }} style={{ color: 'var(--red)', fontSize: '10px', marginTop: '.3rem' }}>Remove QR</button></div>
                          </div>
                        </div>
                      </div>
                    </div>{/* /payments */}
                  {/* NOTIFICATIONS */}
                  <div id="set-panel-notifications" style={{ display: 'none' }}>
                    {/* ─── Notification Config (admin emails + booking URL for post-payment) ─── */}
                    <div className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
                        <h3 style={{ margin: '0' }}>Notifications (Order-Paid Email)</h3>
                        <button className="btn btn-primary btn-sm" id="notif-save-btn" onClick={(e) => { saveNotificationConfig(); }}>Save</button>
                        </div>
                      <p style={{ fontSize: '11px', color: 'var(--ink4)', marginBottom: '.8rem' }}>When an order flips to <b>Paid</b>, the customer gets a confirmation email and these admin addresses are CC'd. The booking URL is used in the email and on the post-payment success page.</p>
                      <p id="notif-debug" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '.8rem' }}>Loading saved values…</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '.8rem' }}>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Admin Notification Emails</label>
                          <textarea className="form-input" id="notif-admin-emails" rows="2" placeholder="one address per line, e.g.
      orders@mjmnursery.com
      elon.mjm@gmail.com" style={{ fontSize: '13px', fontFamily: 'monospace', resize: 'vertical' }} />
                          <div style={{ fontSize: '10.5px', color: 'var(--ink4)', marginTop: '.2rem' }}>One per line. These are CC'd on every customer order-paid email.</div>
                          </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.8rem' }}>
                          <div>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>From Email</label>
                            <input className="form-input" id="notif-from-email" placeholder="orders@mjmnursery.com" style={{ fontSize: '13px', fontFamily: 'monospace' }} />
                            <div style={{ fontSize: '10.5px', color: 'var(--ink4)', marginTop: '.2rem' }}>Must be on a domain verified in Resend.</div>
                            </div>
                          <div>
                            <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>From Name</label>
                            <input className="form-input" id="notif-from-name" placeholder="MJM Nursery" style={{ fontSize: '13px' }} />
                            </div>
                          </div>
                        <div>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Collection Booking URL</label>
                          <input className="form-input" id="notif-booking-url" placeholder="https://collect.mjmnursery.com/" style={{ fontSize: '13px', fontFamily: 'monospace' }} />
                          <div style={{ fontSize: '10.5px', color: 'var(--ink4)', marginTop: '.2rem' }}>Linked from both the customer email and the post-payment success page.</div>
                          </div>
                        </div>
                      </div>
                    </div>{/* /notifications */}
                  {/* ORDERS */}
                  <div id="set-panel-orders" style={{ display: 'none' }}>
                    {/* ─── Stock Auto-Release (unpaid cash orders) ─── */}
                    <div className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
                        <h3 style={{ margin: '0' }}>Stock Auto-Release (Unpaid Cash Orders)</h3>
                        <button className="btn btn-primary btn-sm" id="autorel-save-btn" onClick={(e) => { saveAutoReleaseConfig(); }}>Save</button>
                        </div>
                      <p style={{ fontSize: '11px', color: 'var(--ink4)', marginBottom: '.8rem' }}>A <b>cash-term</b> order left unpaid (Pending Payment) for longer than the window below is automatically cancelled and its held stock returned. <b>Credit-term orders are never auto-released</b> — their stock is always kept.</p>
                      <p id="autorel-debug" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '.8rem' }}>Loading saved values…</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '13px', fontWeight: '600', color: 'var(--ink2)', cursor: 'pointer' }}>
                          <input type="checkbox" id="autorel-enabled" style={{ width: '16px', height: '16px', accentColor: 'var(--green)' }} /> Enable auto-release
                </label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Release after</label>
                          <input className="form-input" id="autorel-hours" type="number" min="1" step="1" defaultValue="48" style={{ width: '90px', fontSize: '13px', textAlign: 'right' }} />
                          <span style={{ fontSize: '12px', color: 'var(--ink3)' }}>hours unpaid</span>
                          </div>
                        </div>
                      <div style={{ fontSize: '10.5px', color: 'var(--ink4)', marginTop: '.6rem' }}>e.g. 48 = release after 2 days, 24 = after 1 day, 72 = after 3 days. Cleanup runs whenever this Orders page is opened, and on the optional pg_cron schedule.</div>
                      </div>
                    </div>{/* /orders */}
                  {/* Visible build stamp so an admin can verify they're on the new
                 version (and not a cached older HTML). Bump when the page changes. */}
                  <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--ink4)', padding: '.5rem 0' }}>Admin build 2026-05-26 · paid-balance + grouped settings</div>
                  </div>
                </div>
              </div>
            {/* ORDER DETAIL MODAL */}
            <div className="modal-overlay" id="modal-order" style={{ zIndex: '250' }}><div className="modal" style={{ maxWidth: '750px' }}><div className="modal-head"><h2 id="mo-title">Order Details</h2><button className="modal-close" onClick={(e) => { closeModal('modal-order'); }}>✕</button></div><div className="modal-body" id="mo-body" style={{ maxHeight: '75vh', overflowY: 'auto' }} /><div className="modal-foot" id="mo-foot" /></div></div>
            {/* ATTACHMENT PREVIEW (floating viewer for order documents — avoids tab-jumping) */}
            <div className="modal-overlay" id="modal-att-preview" style={{ zIndex: '260' }}><div className="modal" style={{ maxWidth: '900px' }}>
                <div className="modal-head">
                  <h2 id="att-preview-title" style={{ fontSize: '1.05rem' }}>Document</h2>
                  <button className="modal-close" onClick={(e) => { closeModal('modal-att-preview'); }}>✕</button>
                  </div>
                <div className="modal-body" id="att-preview-body" style={{ maxHeight: '78vh', overflow: 'auto', background: '#f1f5f9', borderRadius: '8px' }} />
                <div className="modal-foot">
                  <button className="btn btn-outline" onClick={(e) => { window.printAttachment(); }}>Print</button>
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-att-preview'); }}>Close</button>
                  </div>
                </div></div>
            {/* ADD PAYMENT ENTRY (ledger row for salesweb_order_payments) */}
            <div className="modal-overlay" id="modal-add-payment" style={{ zIndex: '265' }}><div className="modal" style={{ maxWidth: '480px' }}>
                <div className="modal-head"><h2 style={{ fontSize: '1.05rem' }}>Record Payment</h2><button className="modal-close" onClick={(e) => { closeModal('modal-add-payment'); }}>✕</button></div>
                <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
                  <input type="hidden" id="pay-order-id" />
                  <div style={{ marginBottom: '.6rem' }}>
                    <label style={{ fontSize: '11px', color: 'var(--ink3)', display: 'block', marginBottom: '.2rem' }}>Date received *</label>
                    <input className="form-input" id="pay-date" type="date" style={{ fontSize: '13px' }} />
                    </div>
                  <div style={{ marginBottom: '.6rem' }}>
                    <label style={{ fontSize: '11px', color: 'var(--ink3)', display: 'block', marginBottom: '.2rem' }}>Amount (RM) *</label>
                    <input className="form-input" id="pay-amount" type="number" step="0.01" min="0" placeholder="0.00" style={{ fontSize: '13px' }} />
                    </div>
                  <div style={{ marginBottom: '.6rem' }}>
                    <label style={{ fontSize: '11px', color: 'var(--ink3)', display: 'block', marginBottom: '.2rem' }}>Note (optional)</label>
                    <input className="form-input" id="pay-note" type="text" placeholder="e.g. Maybank transfer ref 88123" style={{ fontSize: '13px' }} />
                    </div>
                  <div style={{ marginBottom: '.6rem' }}>
                    <label style={{ fontSize: '11px', color: 'var(--ink3)', display: 'block', marginBottom: '.2rem' }}>Attachment (optional)</label>
                    <input className="form-input" id="pay-file" type="file" style={{ fontSize: '12px' }} />
                    <div style={{ fontSize: '10px', color: 'var(--ink4)', marginTop: '.2rem' }}>Payment proof, bank slip, etc. Stored alongside order documents.</div>
                    </div>
                  </div>
                <div className="modal-foot">
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-add-payment'); }}>Cancel</button>
                  <button className="btn btn-primary" onClick={(e) => { window.savePaymentEntry(); }}>Save Payment</button>
                  </div>
                </div></div>
            {/* PROFORMA INVOICE (preview + print + email) */}
            <div className="modal-overlay" id="modal-proforma" style={{ zIndex: '260' }}><div className="modal" style={{ maxWidth: '780px' }}>
                <div className="modal-head">
                  <h2 id="proforma-title" style={{ fontSize: '1.05rem' }}>Proforma Invoice</h2>
                  <button className="modal-close" onClick={(e) => { closeModal('modal-proforma'); }}>✕</button>
                  </div>
                <div className="modal-body" id="proforma-body" style={{ maxHeight: '75vh', overflow: 'auto', background: '#f1f5f9' }} />
                <div className="modal-foot">
                  <button id="proforma-print" className="btn btn-outline">Print / Save PDF</button>
                  <button id="proforma-send" className="btn btn-primary">Email to Customer</button>
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-proforma'); }}>Close</button>
                  </div>
                </div></div>
            {/* ADD-ORDER (admin-created order) */}
            <div className="modal-overlay" id="modal-new-order" style={{ zIndex: '255' }}><div className="modal" style={{ maxWidth: '820px' }}>
                <div className="modal-head"><h2>+ New Order</h2><button className="modal-close" onClick={(e) => { closeModal('modal-new-order'); }}>✕</button></div>
                <div className="modal-body" style={{ padding: '1.2rem', maxHeight: '75vh', overflowY: 'auto' }}>
                  {/* Customer block */}
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--ink4)', letterSpacing: '.05em', marginBottom: '.5rem' }}>Customer</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
                      <div style={{ gridColumn: '1 / -1', position: 'relative' }}>
                        <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Name *  <span style={{ color: 'var(--ink4)', fontWeight: '400' }}>(type to search existing customers — leave new name and submit to create a profile)</span></label>
                        <input className="form-input" id="no-cust-name" onInput={(e) => { window.onNewOrderCustNameInput(); }} onBlur={(e) => { setTimeout(window.hideNewOrderCustResults,180); }} autoComplete="off" style={{ fontSize: '12px', padding: '6px 10px' }} />
                        <div id="no-cust-results" style={{ display: 'none', position: 'absolute', top: '100%', left: '0', right: '0', background: '#fff', border: '1px solid var(--rule)', borderRadius: '8px', zIndex: '10', maxHeight: '220px', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,.12)', marginTop: '2px' }} />
                        <div id="no-cust-status" style={{ fontSize: '11px', marginTop: '.3rem', display: 'none' }} />
                        </div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Phone</label><input className="form-input" id="no-cust-phone" onInput={(e) => { window.onNewOrderCustFieldEdit(); }} style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Email</label><input className="form-input" id="no-cust-email" type="email" onInput={(e) => { window.onNewOrderCustFieldEdit(); }} style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Shipping address</label><input className="form-input" id="no-cust-addr" defaultValue="Self Collection — MJM Nursery Office, Niah Land District, Miri, 98000, Sarawak" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div>
                        <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Order date <span style={{ color: 'var(--ink4)', fontWeight: '400' }}>(backdate if placed offline)</span></label>
                        <input className="form-input" id="no-order-date" type="datetime-local" style={{ fontSize: '12px', padding: '6px 10px' }} />
                        </div>
                      </div>
                    </div>
                  {/* Billing / E-Invoice block (mirrors customer checkout) */}
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--ink4)', letterSpacing: '.05em', marginBottom: '.5rem' }}>Billing / E-Invoice <span style={{ color: 'var(--ink4)', fontWeight: '400', textTransform: 'none', letterSpacing: '0' }}>(optional)</span></div>
                    <div style={{ display: 'flex', gap: '.4rem', marginBottom: '.6rem' }}>
                      <button type="button" className="btn btn-primary btn-sm" id="no-bill-tab-personal" onClick={(e) => { window.switchNewOrderBilling('personal'); }} style={{ fontSize: '11px' }}>Personal</button>
                      <button type="button" className="btn btn-outline btn-sm" id="no-bill-tab-company" onClick={(e) => { window.switchNewOrderBilling('company'); }} style={{ fontSize: '11px' }}>Company</button>
                      </div>
                    {/* Personal billing */}
                    <div id="no-bill-personal" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
                      <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Full Name</label><input className="form-input" id="no-bill-name" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>I/C Number</label><input className="form-input" id="no-bill-ic" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>TIN</label><input className="form-input" id="no-bill-tin" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Billing Address</label><input className="form-input" id="no-bill-addr" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Country</label><input className="form-input" id="no-bill-country" defaultValue="Malaysia" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>State</label><input className="form-input" id="no-bill-state" defaultValue="Sarawak" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>City</label><input className="form-input" id="no-bill-city" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Postcode</label><input className="form-input" id="no-bill-postcode" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>MPOB License No.</label><input className="form-input" id="no-bill-mpob" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      </div>
                    {/* Company billing */}
                    <div id="no-bill-company" style={{ display: 'none', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
                      <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Company Name</label><input className="form-input" id="no-bill-coname" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Registration No.</label><input className="form-input" id="no-bill-coreg" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>TIN</label><input className="form-input" id="no-bill-cotin" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Billing Address</label><input className="form-input" id="no-bill-coaddr" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Country</label><input className="form-input" id="no-bill-cocountry" defaultValue="Malaysia" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>State</label><input className="form-input" id="no-bill-costate" defaultValue="Sarawak" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>City</label><input className="form-input" id="no-bill-cocity" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Postcode</label><input className="form-input" id="no-bill-copostcode" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>MPOB License No.</label><input className="form-input" id="no-bill-compob" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                      </div>
                    </div>
                  {/* Items block */}
                  <div style={{ marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--ink4)', letterSpacing: '.05em' }}>Items</div>
                      <button className="btn btn-outline btn-sm" onClick={(e) => { window.addNewOrderItem(); }} style={{ fontSize: '11px', padding: '4px 10px' }}>+ Add Row</button>
                      </div>
                    <div id="no-items-container" />
                    <div id="no-products-status" style={{ fontSize: '10px', color: 'var(--ink4)', marginTop: '.3rem' }}>Loading products from Sales Web…</div>
                    </div>
                  {/* Order details + totals */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: '1rem', alignItems: 'start' }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--ink4)', letterSpacing: '.05em', marginBottom: '.5rem' }}>Order Details</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
                        <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Status</label><select className="form-input" id="no-status" style={{ fontSize: '12px', padding: '6px 10px' }}><option>Pending Payment</option><option>Paid</option><option>Ready for Collection</option><option>Completed</option></select></div>
                        <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Payment terms</label><select className="form-input" id="no-terms" style={{ fontSize: '12px', padding: '6px 10px' }}><option value="cash">💵 Cash</option><option value="credit">💳 Credit</option></select></div>
                        <div style={{ gridColumn: '1 / -1' }}><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Internal notes (admin-only)</label><textarea className="form-input" id="no-internal-note" rows="2" style={{ fontSize: '12px', padding: '6px 10px', resize: 'vertical' }} /></div>
                        </div>
                      </div>
                    <div style={{ background: 'var(--bg)', borderRadius: '10px', padding: '.8rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--ink3)', marginBottom: '.3rem' }}><span>Subtotal</span><span id="no-subtotal" style={{ fontWeight: '600', color: 'var(--ink)' }}>RM 0.00</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', alignItems: 'center', marginBottom: '.3rem' }}><span>Discount (RM)</span><input className="form-input" id="no-discount" type="number" min="0" step="0.01" defaultValue="0" onInput={(e) => { window.recalcNewOrderTotal(); }} style={{ width: '80px', textAlign: 'right', fontSize: '12px', padding: '4px 8px' }} /></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: '700', borderTop: '1px solid var(--rule)', paddingTop: '.5rem', marginTop: '.4rem' }}><span>TOTAL</span><span id="no-total" style={{ color: '#065f46' }}>RM 0.00</span></div>
                      </div>
                    </div>
                  </div>
                <div className="modal-foot">
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-new-order'); }}>Cancel</button>
                  <button className="btn btn-primary" id="no-submit" onClick={(e) => { window.submitNewOrder(); }}>Create Order</button>
                  </div>
                </div></div>
            {/* CREDIT INVOICE UPLOAD MODAL (opened from credit order monthly breakdown) */}
            <div className="modal-overlay" id="modal-invoice-upload" style={{ zIndex: '260' }}><div className="modal" style={{ maxWidth: '540px' }}>
                <div className="modal-head"><h2>📤 Upload Invoice</h2><button className="modal-close" onClick={(e) => { closeModal('modal-invoice-upload'); }}>✕</button></div>
                <div className="modal-body" style={{ padding: '1.2rem', maxHeight: '70vh', overflowY: 'auto' }}>
                  <input type="hidden" id="miu-customer-id" />
                  <input type="hidden" id="miu-period" />
                  <input type="hidden" id="miu-trigger-order-id" />
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '.6rem .8rem', fontSize: '12px', color: '#334155', marginBottom: '.4rem' }}>Customer: <strong id="miu-customer-name" style={{ color: '#0f172a' }}>—</strong></div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '.6rem .8rem', fontSize: '12px', color: '#334155', marginBottom: '.4rem' }}>Billing period: <strong id="miu-period-label" style={{ color: '#0f172a' }}>—</strong></div>
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '.6rem .8rem', fontSize: '12px', color: '#334155', marginBottom: '1rem' }} id="miu-summary">—</div>
                  <div style={{ marginBottom: '.8rem' }}><label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Invoice Number *</label><input type="text" id="miu-invoice-no" className="form-input" placeholder="e.g. INV-2026-05-014" autoComplete="off" style={{ fontSize: '13px' }} /></div>
                  <div style={{ marginBottom: '.8rem' }}><label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Invoice PDF / Image *</label><input type="file" id="miu-file" className="form-input" accept="application/pdf,image/*" style={{ fontSize: '13px' }} /></div>
                  <div style={{ marginBottom: '.8rem' }}><label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Due Date (optional)</label><input type="date" id="miu-due" className="form-input" style={{ fontSize: '13px' }} /></div>
                  <div style={{ marginBottom: '.8rem' }}><label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.25rem' }}>Notes (optional)</label><textarea id="miu-notes" className="form-input" rows="2" placeholder="Internal notes for this invoice" style={{ fontSize: '13px', resize: 'vertical' }} /></div>
                  <div id="miu-error" style={{ color: 'var(--red)', fontSize: '12px', fontWeight: '600', minHeight: '16px' }} />
                  </div>
                <div className="modal-foot"><button className="btn btn-outline" onClick={(e) => { closeModal('modal-invoice-upload'); }}>Cancel</button><button className="btn btn-primary" id="miu-submit" onClick={(e) => { window.submitInvoiceUpload(); }}>Upload & Issue Invoice</button></div>
                </div></div>
            {/* CREDIT BILL ADD / EDIT MODAL — repeatable per credit order */}
            <div className="modal-overlay" id="modal-credit-bill" style={{ zIndex: '270' }}><div className="modal" style={{ maxWidth: '520px' }}><div className="modal-head"><h2 id="cb-title">Add Bill</h2><button className="modal-close" onClick={(e) => { closeModal('modal-credit-bill'); }}>✕</button></div><div className="modal-body" style={{ padding: '1.2rem' }}>
                  <input type="hidden" id="cb-order-id" />
                  <input type="hidden" id="cb-bill-id" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
                    <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Billing date *</label><input className="form-input" id="cb-date" type="date" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                    <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Invoice No.</label><input className="form-input" id="cb-invoice" type="text" placeholder="e.g. INV-2026-045" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                    <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Billing qty (palm) *</label><input className="form-input" id="cb-qty" type="number" min="0" step="1" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                    <div><label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Billing amount (RM) *</label><input className="form-input" id="cb-amount" type="number" min="0" step="0.01" style={{ fontSize: '12px', padding: '6px 10px' }} /></div>
                    </div>
                  <div id="cb-help" style={{ fontSize: '11px', color: 'var(--ink4)', marginTop: '.6rem' }} />
                  </div><div className="modal-foot"><button className="btn btn-outline" onClick={(e) => { closeModal('modal-credit-bill'); }}>Cancel</button><button className="btn btn-primary" id="cb-submit" onClick={(e) => { window.submitCreditBill(); }}>Save Bill</button></div></div></div>
            {/* REPORTS — VIEW MORE MODAL — chart drill-down list */}
            <div className="modal-overlay" id="modal-report-view-more" style={{ zIndex: '255' }}><div className="modal" style={{ maxWidth: '880px' }}><div className="modal-head"><h2 id="rpt-vm-title">Detail</h2><button className="modal-close" onClick={(e) => { closeModal('modal-report-view-more'); }}>✕</button></div><div className="modal-body" id="rpt-vm-body" style={{ maxHeight: '78vh', overflowY: 'auto' }} /></div></div>
            {/* CANCEL STOCK RESTORE MODAL — opened on top of modal-order (z=250) */}
            <div className="modal-overlay" id="modal-cancel-stock" style={{ zIndex: '270' }}><div className="modal" style={{ maxWidth: '600px' }}><div className="modal-head" style={{ background: '#fef2f2' }}><h2 style={{ fontSize: '1.1rem', color: '#dc2626' }}>Cancel Order — Restore Stock</h2><button className="modal-close" onClick={(e) => { closeModal('modal-cancel-stock'); }}>✕</button></div><div className="modal-body" id="cancel-stock-body" style={{ maxHeight: '65vh', overflowY: 'auto' }} /><div className="modal-foot" id="cancel-stock-foot" /></div></div>
            {/* PAYMENT DETAIL MODAL — populated by openPaymentDetail() in admin-payments.js */}
            <div className="modal-overlay" id="modal-payment" style={{ zIndex: '255' }}><div className="modal" style={{ maxWidth: '960px' }}><div className="modal-head"><h2>Payment Review</h2><button className="modal-close" onClick={(e) => { closeModal('modal-payment'); }}>✕</button></div><div className="modal-body" id="payment-detail-body" style={{ maxHeight: '82vh', overflowY: 'auto' }} /></div></div>
            {/* USER ACCESS MODAL — populated by openUserEdit() in admin-users.js */}
            <div className="modal-overlay" id="modal-user-access" style={{ zIndex: '255' }}><div className="modal" style={{ maxWidth: '520px' }}><div className="modal-head"><h2>Edit User Access</h2><button className="modal-close" onClick={(e) => { closeModal('modal-user-access'); }}>✕</button></div><div className="modal-body" id="user-access-body" style={{ maxHeight: '78vh', overflowY: 'auto' }} /></div></div>
            {/* PRODUCT FORM MODAL */}
            <div className="modal-overlay" id="modal-product"><div className="modal" style={{ maxWidth: '800px' }}>
                <div className="modal-head" style={{ background: 'var(--bg)' }}><h2 id="mp-title" style={{ fontSize: '1.1rem' }}>Add Product</h2><button className="modal-close" onClick={(e) => { closeModal('modal-product'); }}>✕</button></div>
                <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: '1.2rem', padding: '1.2rem' }}>
                  <input type="hidden" id="mp-id" />
                  <div>
                    <div className="mp-section">
                      <div className="mp-section-title">Product Details</div>
                      <div className="form-group"><label className="form-label">Product Name</label><input className="form-input" id="mp-name" /></div>
                      <div className="form-group"><label className="form-label">Description</label><textarea className="form-input" id="mp-desc" rows="2" style={{ resize: 'vertical' }} /></div>
                      <div className="form-group">
                        <label className="form-label">Product Image</label>
                        <div id="mp-img-area" style={{ border: '2px dashed var(--border2)', borderRadius: '8px', padding: '1rem', textAlign: 'center', cursor: 'pointer', background: 'var(--bg)', transition: 'all .15s' }} onClick={(e) => { document.getElementById('mp-img-file').click(); }} onMouseOver={(e) => { e.currentTarget.style.borderColor='var(--green)'; }} onMouseOut={(e) => { e.currentTarget.style.borderColor='var(--border2)'; }}>
                          <div id="mp-img-preview" style={{ display: 'none' }}><img id="mp-img-thumb" src="" style={{ maxHeight: '120px', borderRadius: '6px' }} /></div>
                          <div id="mp-img-placeholder"><div style={{ fontSize: '1.2rem' }}>📷</div><div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--ink3)' }}>Click to upload image</div></div>
                          </div>
                        <input type="file" id="mp-img-file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { window.previewProductImage(e.currentTarget); }} />
                        <div id="mp-img-uploading" style={{ display: 'none', fontSize: '12px', color: 'var(--green)', marginTop: '.3rem' }}>Uploading...</div>
                        <input type="hidden" id="mp-img-url" />
                        </div>
                      <div style={{ borderTop: '1.5px solid var(--border)', paddingTop: '.8rem', marginTop: '.3rem' }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--ink)', marginBottom: '.6rem' }}>Pricing</div>
                        <div className="form-row">
                          <div className="form-group"><label className="form-label">Selling Price (RM)</label><input className="form-input" id="mp-price" type="number" step="0.01" /></div>
                          <div className="form-group"><label className="form-label">Compare at Price (RM)</label><input className="form-input" id="mp-compare" type="number" step="0.01" /><div className="mp-sub-label">Shown as strikethrough on website</div></div>
                          </div>
                        </div>
                      </div>
                    <div className="mp-section" style={{ background: '#f8faf8' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="mp-section-title" style={{ marginBottom: '0', border: 'none', padding: '0' }}>Inventory & Stock</div>
                        <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', color: 'var(--ink3)', fontWeight: '600' }}><input type="checkbox" id="mp-manual-stock" onChange={(e) => { window.toggleManualStock(); }} style={{ accentColor: 'var(--green)', width: '15px', height: '15px' }} />Manual</label>
                        </div>
                      <div style={{ borderBottom: '2px solid var(--border)', margin: '.6rem 0 .8rem' }} />
                      <div className="form-group">
                        <label className="form-label">Current Stock</label>
                        <input className="form-input" id="mp-stock" type="number" readOnly style={{ background: '#fff', cursor: 'not-allowed', fontWeight: '800', fontSize: '1.4rem', color: 'var(--green)', maxWidth: '200px', border: '2px solid var(--green-light)' }} />
                        <div id="mp-stock-hint" className="mp-sub-label">Auto-calculated from batch maturity</div>
                        </div>
                      <div id="mp-stock-source" />
                      <div style={{ borderTop: '2px solid var(--border)', marginTop: '.8rem', paddingTop: '.8rem' }}>
                        <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--ink)', marginBottom: '.3rem' }}>Stock Transfer (b/f from another month)</div>
                        <div className="mp-sub-label" style={{ marginBottom: '.6rem' }}>Pick a source product — its sell month and per-batch plot balance / premium-plot moves are shown so you know which leftover you're carrying forward.</div>
                        <div className="form-row">
                          <div className="form-group"><label className="form-label">From Product (sell month — name)</label><select className="form-input" id="mp-transfer-from" /></div>
                          <div className="form-group"><label className="form-label">Quantity</label><input className="form-input" id="mp-transfer-qty" type="number" min="1" /></div>
                          </div>
                        <div id="mp-transfer-source-detail" />
                        <div className="form-group" style={{ marginTop: '.6rem' }}><label className="form-label">Reason</label><input className="form-input" id="mp-transfer-reason" placeholder="e.g. April leftover b/f to May" /></div>
                        <button className="btn btn-primary" onClick={(e) => { window.executeTransfer(); }} style={{ width: '100%', padding: '10px' }}>Transfer Stock →</button>
                        </div>
                      <div id="mp-transfer-history" />
                      </div>
                    </div>
                  <div>
                    <div className="mp-sidebar-block"><div className="mp-sidebar-title">Visibility</div><label className="mp-radio"><input type="radio" name="mp-vis" defaultValue="published" id="mp-published" /> Publish</label><label className="mp-radio"><input type="radio" name="mp-vis" defaultValue="unpublished" id="mp-unpublished" defaultChecked /> Unpublish</label></div>
                    <div className="mp-sidebar-block"><div className="mp-sidebar-title">Product Type</div><select className="form-input" id="mp-type" style={{ fontSize: '11px', padding: '8px 10px' }}><option value="Seedling">Seedling</option><option value="Merchandise">Merchandise</option></select></div>
                    <div className="mp-sidebar-block"><div className="mp-sidebar-title">Collection</div><select className="form-input" id="mp-coll" style={{ fontSize: '11px', padding: '8px 10px' }}><option value="Normal Sales">Normal Sales</option><option value="Promotion">Promotion</option></select></div>
                    <div className="mp-sidebar-block"><div className="mp-sidebar-title">Tags</div><select className="form-input" id="mp-tags" style={{ fontSize: '11px', padding: '6px 10px' }} multiple size="3" /><div style={{ fontSize: '8px', color: 'var(--ink4)', marginTop: '.15rem' }}>Ctrl/Cmd + click to multi-select</div></div>
                    </div>
                  </div>
                <div className="modal-foot"><button className="btn btn-outline" onClick={(e) => { closeModal('modal-product'); }}>Cancel</button><button className="btn btn-primary" id="mp-save-btn" onClick={(e) => { window.saveProduct(); }}>Save Product</button></div>
                </div></div>
            {/* PROMO FORM MODAL (manual entry — for admins who skip the AI builder) */}
            <div className="modal-overlay" id="modal-promo"><div className="modal" style={{ maxWidth: '680px' }}><div className="modal-head"><h2 id="mpr-title">New Promotion</h2><button className="modal-close" onClick={(e) => { closeModal('modal-promo'); }}>✕</button></div><div className="modal-body"><input type="hidden" id="mpr-id" />
                  <div className="form-row"><div className="form-group"><label className="form-label">Title (internal)</label><input className="form-input" id="mpr-name" /></div><div className="form-group"><label className="form-label">Status</label><select className="form-input" id="mpr-status"><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="live">Live</option><option value="ended">Ended</option><option value="archived">Archived</option></select></div></div>
                  <div className="form-group"><label className="form-label">Description (internal)</label><textarea className="form-input" id="mpr-desc" rows="2" /></div>
                  <div className="form-row"><div className="form-group"><label className="form-label">Customer Banner Text</label><input className="form-input" id="mpr-banner" maxLength="80" placeholder="e.g. 20% off all seedlings this weekend!" /></div><div className="form-group"><label className="form-label">Banner Style</label><div style={{ display: 'flex', gap: '.4rem' }}><input className="form-input" id="mpr-banner-emoji" style={{ width: '60px', textAlign: 'center', fontSize: '18px' }} placeholder="🎁" maxLength="4" /><select className="form-input" id="mpr-banner-color" style={{ flex: '1' }}><option value="green">Green</option><option value="amber">Amber</option><option value="red">Red</option><option value="blue">Blue</option><option value="purple">Purple</option></select></div></div></div>
                  <div className="form-row"><div className="form-group"><label className="form-label">Discount Type</label><select className="form-input" id="mpr-dtype"><option value="percentage">Percentage (%)</option><option value="fixed">Fixed Amount (RM)</option></select></div><div className="form-group"><label className="form-label">Discount Value</label><input className="form-input" id="mpr-dval" type="number" step="0.01" /></div></div>
                  <div className="form-row"><div className="form-group"><label className="form-label">Max Discount (RM, 0=none)</label><input className="form-input" id="mpr-maxdisc" type="number" step="0.01" defaultValue="0" /></div><div className="form-group"><label className="form-label">Min Order (RM, 0=none)</label><input className="form-input" id="mpr-minorder" type="number" step="0.01" defaultValue="0" /></div></div>
                  <div className="form-group"><label className="form-label">Target</label><select className="form-input" id="mpr-target" onChange={(e) => { window.togglePromoTargetFields(); }}><option value="all">All Products</option><option value="category">Specific Categories</option><option value="specific">Specific Products</option></select></div>
                  <div className="form-group" id="mpr-target-cats" style={{ display: 'none' }}><label className="form-label">Categories (comma-separated)</label><input className="form-input" id="mpr-tcats" placeholder="Seedling, Merchandise" /></div>
                  <div className="form-group" id="mpr-target-prods" style={{ display: 'none' }}><label className="form-label">Products</label><select className="form-input" id="mpr-tprods" multiple size="4" style={{ height: 'auto' }} /><div style={{ fontSize: '10px', color: 'var(--ink4)', marginTop: '.2rem' }}>Ctrl/Cmd+click to multi-select</div></div>
                  <div className="form-row"><div className="form-group"><label className="form-label">Start Date</label><input className="form-input" id="mpr-start" type="date" /></div><div className="form-group"><label className="form-label">End Date</label><input className="form-input" id="mpr-end" type="date" /></div></div>
                  <div className="form-row"><div className="form-group"><label className="form-label">Priority (higher wins)</label><input className="form-input" id="mpr-priority" type="number" defaultValue="0" /></div><div className="form-group" style={{ display: 'flex', alignItems: 'center' }}><label className="form-toggle"><input type="checkbox" id="mpr-active" defaultChecked /><span>Active</span></label></div></div>
                  </div><div className="modal-foot"><button className="btn btn-outline" onClick={(e) => { closeModal('modal-promo'); }}>Cancel</button><button className="btn btn-primary" onClick={(e) => { window.savePromo(); }}>Save Promotion</button></div></div></div>
            {/* AI PROMOTION ASSISTANT MODAL */}
            <div className="modal-overlay" id="modal-promo-assistant" style={{ zIndex: '260' }}><div className="modal promo-assistant-modal">
                <div className="modal-head">
                  <h2>✨ Promotion Builder — AI Assistant</h2>
                  <button className="modal-close" onClick={(e) => { window.closePromoAssistant(); }}>✕</button>
                  </div>
                <div className="modal-body" style={{ padding: '1rem' }}>
                  <div className="promo-assistant-grid">
                    <div className="promo-chat">
                      <div className="promo-chat-log" id="pa-log" />
                      <div className="promo-chat-input">
                        <textarea id="pa-input" placeholder="e.g. 20% off all seedlings this weekend, max RM 50 discount" onKeyDown={(e) => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.sendPromoMessage();}; }} />
                        <button id="pa-send" onClick={(e) => { window.sendPromoMessage(); }}>Send</button>
                        </div>
                      </div>
                    <div className="promo-preview-pane">
                      <div className="promo-preview-head">Live Preview</div>
                      <div className="promo-preview-body" id="pa-preview"><div className="promo-preview-empty">Describe your promotion in the chat — a preview will appear here as the assistant drafts it.</div></div>
                      <div className="promo-preview-foot" id="pa-preview-foot" style={{ display: 'none' }}>
                        <button className="promo-discard-btn" onClick={(e) => { window.discardPromoDraft(); }}>Discard</button>
                        <button className="promo-publish-btn" id="pa-publish" onClick={(e) => { window.publishPromoDraft(); }}>Publish</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div></div>
            {/* COUPON FORM MODAL */}
            <div className="modal-overlay" id="modal-coupon"><div className="modal" style={{ maxWidth: '720px' }}><div className="modal-head"><h2 id="mc-title">New Coupon</h2><button className="modal-close" onClick={(e) => { closeModal('modal-coupon'); }}>✕</button></div><div className="modal-body"><input type="hidden" id="mc-id" />
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Coupon Code</label><div style={{ display: 'flex', gap: '.4rem' }}><input className="form-input" id="mc-code" style={{ textTransform: 'uppercase', flex: '1' }} /><button type="button" className="btn btn-outline btn-sm" onClick={(e) => { window.randomizeCouponCode(); }} title="Generate a random code">🎲</button></div></div>
                    <div className="form-group"><label className="form-label">Internal Name</label><input className="form-input" id="mc-name" placeholder="e.g. Influencer Sept campaign" /></div>
                    </div>
                  <div className="form-group"><label className="form-label">Customer Description</label><input className="form-input" id="mc-desc" placeholder="Shown to customer when applied" /></div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Discount Type</label><select className="form-input" id="mc-dtype" onChange={(e) => { window.togglePctDiscountFields(); }}><option value="percentage">Percentage (%)</option><option value="fixed">Fixed Amount (RM)</option><option value="free_shipping">Free Shipping</option></select></div>
                    <div className="form-group"><label className="form-label">Discount Value</label><input className="form-input" id="mc-dval" type="number" step="0.01" /></div>
                    </div>
                  <div className="form-row" id="mc-row-pct">
                    <div className="form-group"><label className="form-label">Max Discount (RM, 0=none)</label><input className="form-input" id="mc-maxdisc" type="number" step="0.01" defaultValue="0" /></div>
                    <div className="form-group"><label className="form-label">Min Order Value (RM)</label><input className="form-input" id="mc-min" type="number" step="0.01" defaultValue="0" /></div>
                    </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Total Usage Limit (0 = unlimited)</label><input className="form-input" id="mc-limit" type="number" defaultValue="0" /></div>
                    <div className="form-group"><label className="form-label">Per-Customer Limit (0 = unlimited)</label><input className="form-input" id="mc-percust" type="number" defaultValue="0" /></div>
                    </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Start Date</label><input className="form-input" id="mc-start" type="date" /></div>
                    <div className="form-group"><label className="form-label">Expiry Date</label><input className="form-input" id="mc-expiry" type="date" /></div>
                    </div>
                  <div className="form-group"><label className="form-label">Scope</label>
                    <select className="form-input" id="mc-scope" onChange={(e) => { window.toggleCouponScopeFields(); }}>
                      <option value="all">All Products</option>
                      <option value="category">Specific Categories</option>
                      <option value="product">Specific Products</option>
                      </select>
                    </div>
                  <div className="form-group" id="mc-scope-cats" style={{ display: 'none' }}><label className="form-label">Categories (comma-separated)</label><input className="form-input" id="mc-cats" placeholder="Seedling, Merchandise" /></div>
                  <div className="form-group" id="mc-scope-prods" style={{ display: 'none' }}><label className="form-label">Products</label><select className="form-input" id="mc-prods" multiple size="4" style={{ height: 'auto' }} /></div>
                  {/* Discount usage — customer eligibility */}
                  <div className="form-group" style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--ink)', marginBottom: '.4rem' }}>Discount usage</div>
                    <label className="form-label" htmlFor="mc-elig-type">Customer eligibility</label>
                    <select className="form-input" id="mc-elig-type" onChange={(e) => { window.onCouponEligChange(); }} defaultValue="all_members">
                      <option value="public">Open to public</option>
                      <option value="all_members">All logged-in members</option>
                      <option value="groups">Selected customer group(s)</option>
                      <option value="customers">Selected customer(s)</option>
                      <option value="tiers">Selected membership tier(s)</option>
                      </select>
                    </div>
                  <div className="form-group" id="mc-elig-customers-wrap" style={{ display: 'none' }}>
                    <label className="form-label">Selected customer(s)</label>
                    <select className="form-input" id="mc-elig-customers" multiple size="5" style={{ height: 'auto' }} />
                    <div style={{ fontSize: '10.5px', color: 'var(--ink4)', marginTop: '.2rem' }}>Ctrl/⌘ + click to pick multiple customers.</div>
                    </div>
                  <div className="form-group" id="mc-elig-tiers-wrap" style={{ display: 'none' }}>
                    <label className="form-label">Selected membership tier(s)</label>
                    <div id="mc-elig-tiers" style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', fontSize: '12px' }} />
                    </div>
                  <div className="form-group" id="mc-elig-groups-wrap" style={{ display: 'none' }}>
                    <label className="form-label">Selected customer group(s)</label>
                    <div style={{ fontSize: '11px', color: 'var(--ink4)', padding: '.4rem .6rem', background: 'var(--bg)', borderRadius: '6px' }}>No customer groups configured yet — saving this option will store the choice but it won't filter until a groups feature is added.</div>
                    </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.5rem', background: 'var(--bg)', padding: '.7rem', borderRadius: '8px' }}>
                    <label className="form-toggle" style={{ fontSize: '12px' }}><input type="checkbox" id="mc-active" defaultChecked /><span>Active</span></label>
                    <label className="form-toggle" style={{ fontSize: '12px' }}><input type="checkbox" id="mc-firstorder" /><span>First-order only</span></label>
                    <label className="form-toggle" style={{ fontSize: '12px' }}><input type="checkbox" id="mc-stack" defaultChecked /><span>Stack with promos</span></label>
                    <label className="form-toggle" style={{ fontSize: '12px' }}><input type="checkbox" id="mc-autoapply" /><span>Auto-apply at checkout</span></label>
                    </div>
                  </div><div className="modal-foot"><button className="btn btn-outline" onClick={(e) => { closeModal('modal-coupon'); }}>Cancel</button><button className="btn btn-primary" onClick={(e) => { window.saveCoupon(); }}>Save Coupon</button></div></div></div>
            {/* BULK COUPON GENERATOR MODAL */}
            <div className="modal-overlay" id="modal-coupon-bulk"><div className="modal" style={{ maxWidth: '560px' }}><div className="modal-head"><h2>⚡ Bulk Generate Coupons</h2><button className="modal-close" onClick={(e) => { closeModal('modal-coupon-bulk'); }}>✕</button></div><div className="modal-body">
                  <div style={{ fontSize: '12px', color: 'var(--ink3)', marginBottom: '1rem', lineHeight: '1.5' }}>Generate many one-time-use codes from a single template — useful for influencer campaigns, gift drops, or partnership codes.</div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Quantity</label><input className="form-input" id="mcb-qty" type="number" defaultValue="50" min="1" max="2000" /></div>
                    <div className="form-group"><label className="form-label">Code Prefix</label><input className="form-input" id="mcb-prefix" placeholder="e.g. INFLU" style={{ textTransform: 'uppercase' }} /></div>
                    </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Discount Type</label><select className="form-input" id="mcb-dtype"><option value="percentage">Percentage (%)</option><option value="fixed">Fixed Amount (RM)</option></select></div>
                    <div className="form-group"><label className="form-label">Discount Value</label><input className="form-input" id="mcb-dval" type="number" step="0.01" defaultValue="10" /></div>
                    </div>
                  <div className="form-row">
                    <div className="form-group"><label className="form-label">Min Order (RM)</label><input className="form-input" id="mcb-min" type="number" step="0.01" defaultValue="0" /></div>
                    <div className="form-group"><label className="form-label">Expiry Date</label><input className="form-input" id="mcb-expiry" type="date" /></div>
                    </div>
                  <div style={{ background: 'var(--bg)', padding: '.6rem .8rem', borderRadius: '8px', fontSize: '11px', color: 'var(--ink3)' }}><strong>Note:</strong> Generated codes are 8 characters long, single-use (usage_limit=1), and tagged with the same bulk_batch_id so you can track or deactivate them together.</div>
                  </div><div className="modal-foot"><button className="btn btn-outline" onClick={(e) => { closeModal('modal-coupon-bulk'); }}>Cancel</button><button className="btn btn-primary" id="mcb-go" onClick={(e) => { window.bulkGenerateCoupons(); }}>Generate & Download CSV</button></div></div></div>
            {/* CUSTOMER DETAIL MODAL */}
            <div className="modal-overlay" id="modal-customer"><div className="modal" style={{ maxWidth: '900px' }}><div className="modal-head"><h2 id="mcu-title">Customer Profile</h2><button className="modal-close" onClick={(e) => { closeModal('modal-customer'); }}>✕</button></div><div className="modal-body" id="mcu-body" style={{ maxHeight: '80vh', overflowY: 'auto' }} /></div></div>
            {/* ADD CUSTOMER MODAL */}
            <div className="modal-overlay" id="modal-add-customer" style={{ zIndex: '255' }}><div className="modal" style={{ maxWidth: '480px' }}>
                <div className="modal-head"><h2>+ Add Customer</h2><button className="modal-close" onClick={(e) => { closeModal('modal-add-customer'); }}>✕</button></div>
                <div className="modal-body" style={{ padding: '1.2rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '.7rem' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Name <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input className="form-input" id="ac-name" autoComplete="off" style={{ fontSize: '13px', padding: '8px 12px' }} />
                      </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Email <span style={{ color: 'var(--ink4)', fontWeight: '400' }}>(used for login & receipts; leave blank for walk-in)</span></label>
                      <input className="form-input" id="ac-email" type="email" autoComplete="off" style={{ fontSize: '13px', padding: '8px 12px' }} />
                      </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Phone</label>
                      <input className="form-input" id="ac-phone" style={{ fontSize: '13px', padding: '8px 12px' }} />
                      </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Payment terms</label>
                      <select className="form-input" id="ac-terms" style={{ fontSize: '13px', padding: '8px 12px' }}><option value="cash">💵 Cash</option><option value="credit">💳 Credit</option></select>
                      </div>
                    <div id="ac-status" style={{ fontSize: '11px', display: 'none' }} />
                    </div>
                  </div>
                <div className="modal-foot">
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-add-customer'); }}>Cancel</button>
                  <button className="btn btn-primary" id="ac-submit" onClick={(e) => { window.submitAddCustomer(); }}>Create Customer</button>
                  </div>
                </div></div>
            {/* EDIT CUSTOMER MODAL */}
            <div className="modal-overlay" id="modal-edit-customer" style={{ zIndex: '255' }}><div className="modal" style={{ maxWidth: '480px' }}>
                <div className="modal-head"><h2>Edit Customer</h2><button className="modal-close" onClick={(e) => { closeModal('modal-edit-customer'); }}>✕</button></div>
                <div className="modal-body" style={{ padding: '1.2rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '.7rem' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Name <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input className="form-input" id="ec-name" autoComplete="off" style={{ fontSize: '13px', padding: '8px 12px' }} />
                      </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Email <span style={{ color: 'var(--ink4)', fontWeight: '400' }}>(leave blank for walk-in)</span></label>
                      <input className="form-input" id="ec-email" type="email" autoComplete="off" style={{ fontSize: '13px', padding: '8px 12px' }} />
                      </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Phone</label>
                      <input className="form-input" id="ec-phone" style={{ fontSize: '13px', padding: '8px 12px' }} />
                      </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Payment terms</label>
                      <select className="form-input" id="ec-terms" style={{ fontSize: '13px', padding: '8px 12px' }}><option value="cash">💵 Cash</option><option value="credit">💳 Credit</option></select>
                      </div>
                    </div>
                  </div>
                <div className="modal-foot">
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-edit-customer'); }}>Cancel</button>
                  <button className="btn btn-primary" id="ec-submit" onClick={(e) => { window.submitEditCustomer(); }}>Save Changes</button>
                  </div>
                </div></div>
            {/* CUSTOMER GROUP EDIT MODAL */}
            <div className="modal-overlay" id="modal-group-edit" style={{ zIndex: '255' }}><div className="modal" style={{ maxWidth: '480px' }}>
                <div className="modal-head"><h2 id="mg-title">New Group</h2><button className="modal-close" onClick={(e) => { closeModal('modal-group-edit'); }}>✕</button></div>
                <div className="modal-body" style={{ padding: '1.2rem' }}>
                  <input type="hidden" id="mg-id" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '.7rem' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Group name <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input className="form-input" id="mg-name" placeholder="e.g. Loyalty VIP" style={{ fontSize: '13px', padding: '8px 12px' }} />
                      </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Description</label>
                      <textarea className="form-input" id="mg-desc" rows="2" style={{ fontSize: '13px', padding: '8px 12px', resize: 'vertical' }} />
                      </div>
                    <div>
                      <label style={{ fontSize: '11px', color: 'var(--ink3)' }}>Badge colour</label>
                      <input className="form-input" id="mg-color" type="color" defaultValue="#7c5cbf" style={{ height: '36px', padding: '2px 6px' }} />
                      </div>
                    </div>
                  </div>
                <div className="modal-foot">
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-group-edit'); }}>Cancel</button>
                  <button className="btn btn-primary" id="mg-submit" onClick={(e) => { window.saveGroup(); }}>Save Group</button>
                  </div>
                </div></div>
            {/* MANAGE GROUP MEMBERS MODAL */}
            <div className="modal-overlay" id="modal-group-members" style={{ zIndex: '255' }}><div className="modal" style={{ maxWidth: '600px' }}>
                <div className="modal-head"><h2 id="mm-title">Group Members</h2><button className="modal-close" onClick={(e) => { closeModal('modal-group-members'); }}>✕</button></div>
                <div className="modal-body" style={{ padding: '1.2rem' }}>
                  <input type="hidden" id="mm-group-id" />
                  <input className="form-input" id="mm-search" placeholder="Search customers…" onInput={(e) => { window.renderGroupMembersList(); }} style={{ fontSize: '13px', padding: '8px 12px', marginBottom: '.6rem' }} />
                  <div style={{ fontSize: '11px', color: 'var(--ink4)', marginBottom: '.4rem' }}>Tick to add to the group · untick to remove.</div>
                  <div id="mm-list" style={{ maxHeight: '50vh', overflow: 'auto', border: '1px solid var(--border)', borderRadius: '8px' }} />
                  </div>
                <div className="modal-foot">
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-group-members'); }}>Cancel</button>
                  <button className="btn btn-primary" id="mm-submit" onClick={(e) => { window.saveGroupMembers(); }}>Save Members</button>
                  </div>
                </div></div>
            {/* PUBLISH PRODUCT MODAL */}
            <div className="modal-overlay" id="modal-publish"><div className="modal" style={{ maxWidth: '560px' }}>
                <div className="modal-head" style={{ background: 'var(--bg)' }}><h2 id="mpb-title" style={{ fontSize: '1.05rem' }}>Publish to Sales Web</h2><button className="modal-close" onClick={(e) => { closeModal('modal-publish'); }}>✕</button></div>
                <div className="modal-body" style={{ padding: '1.2rem 1.4rem' }}>
                  <input type="hidden" id="mpb-product-id" />
                  <div id="mpb-product-name" style={{ fontSize: '13px', fontWeight: '600', color: 'var(--ink2)', marginBottom: '.6rem' }} />
                  <div id="mpb-loading" style={{ fontSize: '12px', color: 'var(--ink4)' }}>Computing quantities…</div>
                  <div id="mpb-content" style={{ display: 'none' }}>
                    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '10px', padding: '.8rem 1rem', fontSize: '12.5px', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.2rem 0' }}><span style={{ color: 'var(--ink3)' }}>Raw maturity (transplanted − 10%)</span><span style={{ fontWeight: '700' }} id="mpb-raw">—</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.2rem 0' }}><span style={{ color: 'var(--ink3)' }}>Customer allocation (reserved this month)</span><span style={{ fontWeight: '700', color: 'var(--amber)' }} id="mpb-alloc">—</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.2rem 0' }}><span style={{ color: 'var(--ink3)' }}>Suitable for sales (audited ≥1.5m, prev/curr months)</span><span style={{ fontWeight: '700', color: 'var(--green)' }} id="mpb-suitable">—</span></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '.2rem 0' }}><span style={{ color: 'var(--ink3)' }}>Estimate collection (admin-keyed)</span><span style={{ fontWeight: '700', color: 'var(--amber)' }} id="mpb-estimate">—</span></div>
                      </div>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--ink3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem' }}>Quantity to publish</div>
                    <label className="mp-radio" style={{ padding: '.5rem .7rem', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '.4rem', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
                      <span><input type="radio" name="mpb-strat" defaultValue="raw" onChange={(e) => { window.updatePublishPreview(); }} /> Raw maturity</span>
                      <strong id="mpb-opt-raw">—</strong>
                      </label>
                    <label className="mp-radio" style={{ padding: '.5rem .7rem', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '.4rem', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }}>
                      <span><input type="radio" name="mpb-strat" defaultValue="minus_alloc" onChange={(e) => { window.updatePublishPreview(); }} /> After deducting customer allocation</span>
                      <strong id="mpb-opt-minus">—</strong>
                      </label>
                    <label className="mp-radio" style={{ padding: '.5rem .7rem', border: '1.5px solid var(--green)', borderRadius: '8px', marginBottom: '.4rem', display: 'flex', justifyContent: 'space-between', cursor: 'pointer', background: 'rgba(124,92,191,.04)' }}>
                      <span><input type="radio" name="mpb-strat" defaultValue="maturity_plus_suitable_minus_estimate" defaultChecked onChange={(e) => { window.updatePublishPreview(); }} /> <strong>Maturity + suitable − estimate</strong> <span style={{ fontSize: '10px', color: 'var(--ink4)' }}>(default)</span></span>
                      <strong id="mpb-opt-mse">—</strong>
                      </label>
                    <label className="mp-radio" style={{ padding: '.5rem .7rem', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '.4rem', display: 'flex', alignItems: 'center', gap: '.6rem', cursor: 'pointer' }}>
                      <span><input type="radio" name="mpb-strat" defaultValue="manual" onChange={(e) => { window.updatePublishPreview(); }} /> Manual</span>
                      <input type="number" id="mpb-manual-qty" min="0" placeholder="Enter qty" style={{ marginLeft: 'auto', width: '110px', padding: '6px 10px', fontSize: '13px', border: '1px solid var(--border)', borderRadius: '6px', textAlign: 'right' }} onInput={(e) => { document.querySelector('input[name=mpb-strat][value=manual]').checked=true;window.updatePublishPreview(); }} />
                      </label>
                    <div id="mpb-warnings" style={{ marginTop: '.8rem' }} />
                    </div>
                  </div>
                <div className="modal-foot" id="mpb-foot">
                  <button className="btn btn-outline" onClick={(e) => { closeModal('modal-publish'); }}>Cancel</button>
                  <button className="btn btn-primary" id="mpb-confirm" onClick={(e) => { window.confirmPublish(); }} disabled>Confirm & Publish</button>
                  </div>
                </div></div>
            {/* TOAST */}
            <div className="toast" id="toast" />
            
    </>
  );
}
