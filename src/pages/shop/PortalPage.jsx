import React from 'react';
import { css } from './css.js';

// MY ACCOUNT / PORTAL PAGE — markup 1:1 from public/index.html. Order
// lists, member/points cards etc. are rendered into the placeholder divs
// by the portal functions in main.js.
export default function PortalPage() {
  return (
    <div className="page" id="page-portal">
      <div className="page-hero">
        <div className="page-hero-content">
          <div className="breadcrumb" onClick={() => window.showPage('home')}>Home <span>/ My Account</span></div>
          <h1>My <em>Account</em></h1>
        </div>
      </div>
      <section style={css('padding:2rem 3rem;max-width:1140px;margin:0 auto;')}>
        <div className="portal-layout">
          {/* LEFT: Orders + History + Profile */}
          <div className="portal-left">
            {/* Order tabs */}
            <div style={css('display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:.5rem;')}>
              <div style={css('display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;')}>
                <a href="https://collect.mjmnursery.com" target="_blank" className="btn-book-collection">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  {' '}Book Collection
                </a>
                <button className="portal-tab active" id="ptab-active" onClick={(e) => window.pShowOrderView('active', e.currentTarget)}>Active Orders</button>
                <button className="portal-tab" id="ptab-history" onClick={(e) => window.pShowOrderView('history', e.currentTarget)}>History</button>
                <button className="portal-tab" id="ptab-profile" onClick={(e) => window.pShowOrderView('profile', e.currentTarget)}>Profile</button>
              </div>
            </div>
            <div style={css('margin-bottom:.8rem;')}>
              <input
                type="text"
                id="pp-order-search"
                name="mjm-portal-search"
                autoComplete="off"
                inputMode="search"
                data-form-type="other"
                data-1p-ignore=""
                data-lpignore="true"
                placeholder="Search by order #, billing name, item..."
                onInput={() => window.pFilterOrders()}
                style={css("width:100%;padding:8px 12px;border:1.5px solid var(--green-pale);border-radius:8px;font-size:12px;font-family:'DM Sans',sans-serif;outline:none;background:var(--cream);color:var(--text-dark);transition:border-color .15s;")}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--green-mid)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--green-pale)'; }}
              />
            </div>
            <div id="pp-orders"></div>
            <div id="pp-history" style={css('display:none;')}></div>
            <div id="pp-profile" style={css('display:none;')}>
              {/* Account Details (collapsible) */}
              <div className="p-card p-collapse open">
                <h3 onClick={(e) => window.toggleCollapse(e.currentTarget)} style={css('cursor:pointer;display:flex;justify-content:space-between;align-items:center;')}>Account Details <span className="p-collapse-icon">▼</span></h3>
                <div className="p-collapse-body">
                  <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:.8rem;')}>
                    <div className="p-field" style={css('grid-column:1/-1;')}><label>Full Name</label><input type="text" id="pf-name2" /></div>
                    <div className="p-field"><label>Email Address</label><input type="email" id="pf-email2" readOnly /></div>
                    <div className="p-field"><label>Phone Number</label><input type="tel" id="pf-phone2" /></div>
                  </div>
                  <div style={css('text-align:right;margin-top:.8rem;')}>
                    <button className="p-save-btn" onClick={() => window.saveProfileDetails()}>Save</button>
                  </div>
                </div>
              </div>

              {/* Change Password (collapsible) */}
              <div className="p-card p-collapse">
                <h3 onClick={(e) => window.toggleCollapse(e.currentTarget)} style={css('cursor:pointer;display:flex;justify-content:space-between;align-items:center;')}>Change Password <span className="p-collapse-icon">▶</span></h3>
                <div className="p-collapse-body" style={css('display:none;')}>
                  <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:.8rem;')}>
                    <div className="p-field"><label>Current Password</label><div className="pw-wrap"><input type="password" id="pw-current" /><button className="pw-eye" onMouseDown={() => window.showPw('pw-current')} onMouseUp={() => window.hidePw('pw-current')} onMouseLeave={() => window.hidePw('pw-current')} onTouchStart={() => window.showPw('pw-current')} onTouchEnd={() => window.hidePw('pw-current')}>👁</button></div></div>
                    <div className="p-field"><label>New Password</label><div className="pw-wrap"><input type="password" id="pw-new" /><button className="pw-eye" onMouseDown={() => window.showPw('pw-new')} onMouseUp={() => window.hidePw('pw-new')} onMouseLeave={() => window.hidePw('pw-new')} onTouchStart={() => window.showPw('pw-new')} onTouchEnd={() => window.hidePw('pw-new')}>👁</button></div></div>
                  </div>
                  <div style={css('text-align:right;margin-top:.8rem;')}>
                    <button className="p-save-btn" onClick={() => window.showPortalToast('Password updated ✅')}>Update Password</button>
                  </div>
                </div>
              </div>

              {/* Billing Information (collapsible) */}
              <div className="p-card p-collapse open">
                <h3 onClick={(e) => window.toggleCollapse(e.currentTarget)} style={css('cursor:pointer;display:flex;justify-content:space-between;align-items:center;')}>Billing Information <span className="p-collapse-icon">▼</span></h3>
                <div className="p-collapse-body">
                  {/* Saved billing entries */}
                  <div id="billing-entries-list"></div>
                  {/* Add new */}
                  <div style={css('margin-top:1rem;')}>
                    <button className="portal-tab" onClick={() => window.openAddBilling()} style={css('width:100%;text-align:center;padding:.6rem;border-style:dashed;')}>+ Add New Billing Info</button>
                  </div>
                  {/* Add form (hidden) */}
                  <div id="billing-add-form" style={css('display:none;margin-top:1rem;padding:1.2rem;background:var(--cream);border-radius:12px;border:1px solid var(--green-pale);')}>
                    <div style={css('display:flex;gap:.4rem;margin-bottom:1rem;')}>
                      <button className="portal-tab active" id="add-bill-personal-btn" onClick={() => window.switchAddBillingType('personal')}>🧑 Personal</button>
                      <button className="portal-tab" id="add-bill-company-btn" onClick={() => window.switchAddBillingType('company')}>🏢 Company</button>
                    </div>
                    {/* Personal fields */}
                    <div id="add-bill-personal">
                      <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:.8rem;')}>
                        <div className="p-field" style={css('grid-column:1/-1;')}><label>Billing Name</label><input type="text" id="ab-name" /></div>
                        <div className="p-field"><label>I/C Number (NRIC)</label><input type="text" id="ab-ic" /></div>
                        <div className="p-field"><label>TIN</label><input type="text" id="ab-tin" /></div>
                        <div className="p-field" style={css('grid-column:1/-1;')}><label>MPOB License Number</label><input type="text" id="ab-mpob" /></div>
                      </div>
                    </div>
                    {/* Company fields */}
                    <div id="add-bill-company" style={css('display:none;')}>
                      <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:.8rem;')}>
                        <div className="p-field" style={css('grid-column:1/-1;')}><label>Company Name</label><input type="text" id="ab-coname" /></div>
                        <div className="p-field"><label>Registration No.</label><input type="text" id="ab-coreg" /></div>
                        <div className="p-field"><label>TIN</label><input type="text" id="ab-cotin" /></div>
                        <div className="p-field" style={css('grid-column:1/-1;')}><label>MPOB License Number</label><input type="text" id="ab-compob" /></div>
                        <div className="p-field"><label>Contact Person Name</label><input type="text" id="ab-contact" /></div>
                        <div className="p-field"><label>Contact Person Phone</label><input type="tel" id="ab-cophone" /></div>
                      </div>
                    </div>
                    <div style={css('display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem;')}>
                      <button className="p-btn" onClick={() => window.closeAddBilling()}>Cancel</button>
                      <button className="p-save-btn" onClick={() => window.saveBillingEntry()}>Save Billing Info</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* RIGHT: Member tier + Points + Vouchers + Sign Out */}
          <div className="portal-right">
            <div id="pp-member-card"></div>
            <div id="pp-points-card"></div>
            <div id="pp-points-activity"></div>
          </div>
        </div>
      </section>
    </div>
  );
}
