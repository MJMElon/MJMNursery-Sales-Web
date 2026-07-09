import React from 'react';
import { css } from './css.js';

// PRODUCT POPUP — read-only detail view (photo + description). Markup 1:1
// from public/index.html; populated by openProductPopup() in main.js.
export default function ProductPopup() {
  return (
    <div className="product-popup-overlay" id="productPopup" onClick={(e) => { if (e.target === e.currentTarget) window.closeProductPopup(); }}>
      <div className="product-popup">
        <div className="pp-img" id="ppImg"></div>
        <div className="pp-body">
          <div className="pp-name" id="ppName"></div>
          <div className="pp-desc" id="ppDesc" style={css('white-space:pre-wrap;line-height:1.55;')}></div>
          <div className="pp-price" id="ppPrice"></div>
          <div className="pp-stock" id="ppStock"></div>
          <div className="pp-actions" style={css('margin-top:1rem;')}>
            <button className="pp-close-btn" onClick={() => window.closeProductPopup()} style={css('width:100%;')}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
