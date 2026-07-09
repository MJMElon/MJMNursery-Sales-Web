import React from 'react';
import { css } from './css.js';

// PORTAL MODALS — markup 1:1 from public/index.html (consent, attachments,
// file viewer, booking edit, order detail, rating). The <style> block that
// sat between the file-viewer and booking-edit modals in the original was
// extracted verbatim into src/styles/shop.css.
export default function PortalModals() {
  return (
    <>
      <div className="portal-modal-overlay" id="p-consent-modal">
        <div className="portal-modal">
          <div style={css('display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;')}>
            <h3 style={css("font-family:'Cormorant Garamond',serif;font-size:1.3rem;")}>📋 Collection Consent</h3>
            <button onClick={() => document.getElementById('p-consent-modal').classList.remove('open')} style={css('background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-mid);')}>✕</button>
          </div>
          <div style={css('background:var(--cream);border:1px solid #ddd;border-radius:10px;padding:1rem;font-size:.8rem;color:var(--text-mid);line-height:1.7;max-height:180px;overflow-y:auto;margin-bottom:1rem;')}>
            <strong>1.</strong> Customer is responsible for transportation.<br />
            <strong>2.</strong> Seedlings guaranteed healthy at collection.<br />
            <strong>3.</strong> Verify quantity on-site — no claims after leaving.<br />
            <strong>4.</strong> 48 hours notice for changes; RM 200 fee for late cancellations.<br />
            <strong>5.</strong> Adhere to nursery safety guidelines.<br />
            <strong>6.</strong> Force majeure may cause rescheduling.
          </div>
          <label style={css('display:flex;align-items:flex-start;gap:.6rem;cursor:pointer;margin-bottom:1rem;')}>
            <input type="checkbox" id="p-consent-chk" onChange={(e) => { document.getElementById('p-consent-btn').disabled = !e.target.checked; }} style={css('width:17px;height:17px;accent-color:var(--green-dark);margin-top:.1rem;')} />
            <span style={css('font-size:.82rem;color:var(--text-mid);')}>I agree to the Collection Terms & Conditions.</span>
          </label>
          <button id="p-consent-btn" disabled onClick={() => window.portalSignConsent()} style={css('width:100%;background:var(--green-dark);color:#fff;border:none;padding:.7rem;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;')}>✍️ Sign & Proceed</button>
        </div>
      </div>

      <div className="portal-modal-overlay" id="p-att-modal">
        <div className="portal-modal">
          <div style={css('display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;')}>
            <h3 id="p-att-title" style={css("font-family:'Cormorant Garamond',serif;font-size:1.2rem;")}>Documents</h3>
            <button onClick={() => document.getElementById('p-att-modal').classList.remove('open')} style={css('background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-mid);')}>✕</button>
          </div>
          <div id="p-att-body"></div>
        </div>
      </div>

      {/* In-portal file viewer. Opened by the "View" button on each attached
          document in the order detail modal. z-index sits ABOVE the order
          detail modal (z-index 500). */}
      <div className="portal-modal-overlay" id="p-file-viewer-modal" style={css('z-index:600;')}>
        <div className="portal-modal" style={css('max-width:760px;')}>
          <div style={css('display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:.8rem;')}>
            <h3 id="p-file-viewer-title" style={css("font-family:'Cormorant Garamond',serif;font-size:1.05rem;flex:1;word-break:break-all;")}>File</h3>
            <a id="p-file-viewer-dl" href="#" target="_blank" rel="noopener noreferrer" style={css('font-size:11px;font-weight:600;color:var(--green-mid);text-decoration:none;border:1px solid var(--green-pale);padding:.3rem .7rem;border-radius:6px;white-space:nowrap;')}>⬇ Download</a>
            <button onClick={() => window.pCloseFileViewer()} style={css('background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-mid);')}>✕</button>
          </div>
          <div id="p-file-viewer-body" style={css('min-height:300px;max-height:70vh;overflow:auto;background:var(--cream);border:1px solid var(--green-pale);border-radius:10px;padding:.5rem;display:flex;align-items:center;justify-content:center;')}></div>
        </div>
      </div>

      {/* Booking edit modal — quick inline edits to a saved collection
          booking (date / time / qty / note). Opens above the order detail
          modal (z-index 600). */}
      <div className="portal-modal-overlay" id="p-booking-edit-modal" style={css('z-index:600;')}>
        <div className="portal-modal" style={css('max-width:520px;')}>
          <div style={css('display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;')}>
            <h3 style={css("font-family:'Cormorant Garamond',serif;font-size:1.2rem;")}>Edit Collection Booking Time</h3>
            <button onClick={() => window.pCloseBookingEdit()} style={css('background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-mid);')}>✕</button>
          </div>
          <div id="p-be-summary" style={css('background:var(--cream);border:1px solid var(--green-pale);border-radius:10px;padding:.6rem .8rem;font-size:12px;color:var(--text-mid);margin-bottom:.8rem;')}>
            <div style={css('font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-light);')}>Booking Number</div>
            <div id="p-be-booking-no" style={css('font-size:14px;font-weight:700;color:var(--text-dark);margin-top:.1rem;')}>—</div>
          </div>
          <div style={css('display:flex;flex-direction:column;gap:.6rem;')}>
            <div>
              <div className="p-be-cal-bar">
                <button className="p-be-cal-nav" id="p-be-prev" onClick={() => window.pBePrevMonth()}>‹</button>
                <span className="p-be-cal-label" id="p-be-cal-label">—</span>
                <button className="p-be-cal-nav" id="p-be-next" onClick={() => window.pBeNextMonth()}>›</button>
              </div>
              <div className="p-be-cal-grid" id="p-be-cal-grid"></div>
              <div className="p-be-cal-legend">
                <span><i style={css('background:var(--green-dark);')}></i>Selected</span>
                <span><i style={css('background:#fff;border:2px solid var(--green-mid);')}></i>Your booking</span>
                <span><i style={css('background:#fef3c7;')}></i>Fully booked</span>
                <span><i style={css('background:#fee2e2;')}></i>Closed / holiday</span>
                <span><i style={css('background:#f5f5f0;')}></i>Past</span>
              </div>
              <div id="p-be-selected-pill" className="p-be-selected-pill" style={css('display:none;')}>—</div>
            </div>
            {/* Section header framing the editable half of the modal. */}
            <div style={css('font-size:10px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:.08em;margin-top:.6rem;padding-bottom:.4rem;border-bottom:1px solid var(--green-pale);')}>
              Collection Time Booking
            </div>
            <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:.7rem;')}>
              <div>
                <label style={css('display:block;font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.3rem;')}>Collection Time</label>
                <select id="p-be-time" style={css('width:100%;background:var(--cream);border:1.5px solid var(--green-pale);border-radius:10px;padding:8px 12px;font-size:13px;font-family:inherit;')}></select>
                <div id="p-be-avail" style={css('font-size:10px;color:var(--text-light);margin-top:.2rem;min-height:1em;')}></div>
              </div>
              <div>
                <label style={css('display:block;font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.3rem;')}>Quantity</label>
                <input type="number" id="p-be-qty" min="1" style={css('width:100%;background:var(--cream);border:1.5px solid var(--green-pale);border-radius:10px;padding:8px 12px;font-size:13px;font-family:inherit;')} />
                <div id="p-be-qty-hint" style={css('font-size:10px;color:var(--text-light);margin-top:.2rem;')}></div>
              </div>
            </div>
            {/* Live estimate box — mirrors collect.mjmnursery.com. */}
            <div id="p-be-est" style={css('display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:.7rem .85rem;')}>
              <div style={css('font-size:9px;font-weight:900;color:#1d4ed8;text-transform:uppercase;letter-spacing:.12em;margin-bottom:.25rem;')}>⏱ Estimated Collection Time</div>
              <div id="p-be-est-hrs" style={css('font-size:1.05rem;font-weight:800;color:#1e3a8a;')}>—</div>
              <div id="p-be-est-range" style={css('font-size:11px;font-weight:600;color:#2563eb;margin-top:.15rem;')}>—</div>
              <div id="p-be-est-desc" style={css('font-size:10px;color:var(--text-light);margin-top:.3rem;line-height:1.4;')}></div>
            </div>
            <div>
              <label style={css('display:block;font-size:11px;font-weight:600;color:var(--text-light);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.3rem;')}>Note (optional)</label>
              <textarea id="p-be-note" rows="2" style={css('width:100%;background:var(--cream);border:1.5px solid var(--green-pale);border-radius:10px;padding:8px 12px;font-size:13px;font-family:inherit;resize:vertical;')}></textarea>
            </div>
            <div id="p-be-error" style={css('display:none;font-size:12px;color:#dc2626;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:.5rem .7rem;')}></div>
            <div style={css('display:flex;gap:.5rem;margin-top:.3rem;')}>
              <button onClick={() => window.pCloseBookingEdit()} style={css('flex:1;background:#fff;border:1.5px solid var(--green-pale);color:var(--text-mid);padding:.6rem;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;')}>Cancel</button>
              <button onClick={() => window.pSaveBookingEdit()} id="p-be-save" style={css('flex:2;background:var(--green-dark);border:none;color:#fff;padding:.6rem;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;')}>Save Changes</button>
            </div>
            <a id="p-be-fullcal" href="#" target="_blank" rel="noopener" style={css('font-size:11px;color:var(--green-mid);text-align:center;text-decoration:none;')}>Use full booking calendar →</a>
          </div>
        </div>
      </div>

      <div className="portal-modal-overlay" id="p-order-detail-modal">
        <div className="portal-modal" style={css('max-width:600px;')}>
          <div style={css('display:flex;justify-content:flex-end;margin-bottom:.3rem;')}>
            <button onClick={() => document.getElementById('p-order-detail-modal').classList.remove('open')} style={css('background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-mid);')}>✕</button>
          </div>
          <div id="p-od-body"></div>
        </div>
      </div>

      <div className="portal-modal-overlay" id="p-rating-modal">
        <div className="portal-modal" style={css('text-align:center;')}>
          <h3 style={css("font-family:'Cormorant Garamond',serif;font-size:1.2rem;margin-bottom:.5rem;")}>🌟 Rate Your Experience</h3>
          <div id="p-rating-info" style={css('font-size:.82rem;color:var(--text-light);margin-bottom:1rem;')}></div>
          <div id="p-star-row" style={css('display:flex;justify-content:center;gap:.5rem;margin-bottom:.5rem;')}>
            <span className="p-star" data-v="1" onClick={() => window.pSetRating(1)}>☆</span>
            <span className="p-star" data-v="2" onClick={() => window.pSetRating(2)}>☆</span>
            <span className="p-star" data-v="3" onClick={() => window.pSetRating(3)}>☆</span>
            <span className="p-star" data-v="4" onClick={() => window.pSetRating(4)}>☆</span>
            <span className="p-star" data-v="5" onClick={() => window.pSetRating(5)}>☆</span>
          </div>
          <div id="p-star-label" style={css('font-size:.82rem;color:var(--text-light);margin-bottom:1rem;')}>Tap a star</div>
          <textarea id="p-rating-comment" placeholder="Comment (optional)" style={css('width:100%;border:1px solid #ddd;border-radius:8px;padding:.6rem;font-size:.85rem;min-height:70px;resize:vertical;margin-bottom:.8rem;font-family:inherit;')}></textarea>
          <button id="p-rating-btn" disabled onClick={() => window.pSubmitRating()} style={css('width:100%;background:var(--green-dark);color:#fff;border:none;padding:.7rem;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;')}>Submit Review</button>
          <button onClick={() => document.getElementById('p-rating-modal').classList.remove('open')} style={css('background:none;border:none;color:var(--text-light);font-size:.8rem;cursor:pointer;margin-top:.5rem;')}>Skip</button>
        </div>
      </div>
    </>
  );
}
