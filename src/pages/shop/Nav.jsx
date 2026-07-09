import React from 'react';
import { css } from './css.js';

// NAV — markup 1:1 from public/index.html. Always present in the DOM; the
// splash overlay covers it until dismissed. Inline onclick= attributes are
// rewritten as React handlers calling the same window-bridged functions.
export default function Nav() {
  return (
    <nav id="navbar">
      <div className="nav-logo" onClick={() => window.showPage('home')}>
        {/* The img used to have onclick="event.stopPropagation();" which killed
            the parent div's click handler on mobile. Removed so tapping the
            logo on phones navigates home as expected. Hover overlay still
            fires on desktop via onmouseenter. */}
        <img
          id="nav-logo-img"
          src="https://cdn.store-assets.com/s/1408881/f/16655641.png"
          alt="MJM Nursery"
          style={css('height:140px;cursor:pointer;transition:transform .3s ease;pointer-events:none;')}
          onMouseEnter={() => window.showLogoOverlay()}
        />
      </div>
      <ul className="nav-links" id="navLinks">
        <li><a onClick={() => { window.showPage('home'); window.scrollToSection('salesweb_products'); }} id="nav-shop" style={css('font-weight:700;')}>Shop</a></li>
        <li>
          <a href="https://collect.mjmnursery.com" target="_blank" className="btn-book-collection" style={css('font-size:11px;padding:.45rem 1rem;')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            {' '}Book Seedling Collection
          </a>
        </li>
        <li className="nav-dropdown-wrap">
          <a id="nav-information" style={css('display:flex;align-items:center;gap:4px;opacity:.7;')}>Information <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg></a>
          <div className="nav-dropdown-menu">
            <div className="nav-dropdown-section">About MJM</div>
            <a onClick={() => window.showPage('information')}>Our Policies</a>
            <a onClick={() => window.showPage('contact')}>Contact Us</a>
            <a onClick={() => window.showPage('join')}>Join Our Team</a>
            <div className="nav-dropdown-section">Plan Your Purchase</div>
            <a onClick={() => window.showPage('calculator')}>Seedling Calculator</a>
            <a onClick={() => window.showPage('quotation')}>Request a Quotation</a>
          </div>
        </li>
        <li className="mobile-only-login">
          <a href="#" id="mob-login-link" onClick={(e) => { e.preventDefault(); window.closeMobileMenu(); window.openLoginModal('nav'); }} style={css('font-weight:700;color:var(--gold-light);')}>Log In</a>
          <a id="mob-myaccount" onClick={() => { window.closeMobileMenu(); window.showPage('portal'); }} style={css('display:none;cursor:pointer;font-weight:700;color:var(--gold-light);')}>My Account</a>
          <a id="mob-signout" onClick={() => { window.closeMobileMenu(); window.portalSignOut(); }} style={css('display:none;cursor:pointer;font-size:12px;opacity:.7;')}>Sign Out</a>
        </li>
      </ul>
      <div className="nav-actions">
        <a onClick={() => window.openLoginModal('nav')} id="nav-login-link" style={css('cursor:pointer;')}>Log In</a>
        <a onClick={() => window.showPage('portal')} id="nav-myaccount" style={css('display:none;cursor:pointer;')}>My Account</a>
        <a onClick={() => window.portalSignOut()} id="nav-signout" style={css('display:none;cursor:pointer;font-size:11px;opacity:.6;')}>Sign Out</a>
        <div style={css('position:relative;')}>
          <button className="btn-cart" id="cartBtn" onClick={() => window.toggleCartDropdown()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
            {' '}<span className="cart-label">Cart&nbsp;</span>(<span id="cartCount">0</span>)
          </button>
          <div className="cart-dropdown" id="cartDropdown">
            <div className="cart-header"><span>Shopping Cart</span><button onClick={() => window.toggleCartDropdown()} style={css('background:none;border:none;font-size:16px;cursor:pointer;color:var(--text-mid);')}>✕</button></div>
            <div className="cart-items" id="cartItems"></div>
            <div className="cart-footer" id="cartFooter"></div>
          </div>
        </div>
        {/* Hamburger: ontouchend fires immediately on mobile (no 300ms tap
            delay) and stopPropagation prevents the same tap from being
            re-handled by the document-level outside-click closer. onclick
            remains for desktop / accessibility / keyboard activation. The
            inner spans have pointer-events:none so taps always hit the
            button itself. NOTE: main.js additionally attaches a click
            listener to #hamburger, exactly like the legacy page did. */}
        <button
          className="hamburger"
          id="hamburger"
          aria-label="Menu"
          onClick={() => { var l = document.getElementById('navLinks'); if (l) l.classList.toggle('open'); }}
          onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); var l = document.getElementById('navLinks'); if (l) l.classList.toggle('open'); }}
        >
          <span style={css('pointer-events:none;')}></span><span style={css('pointer-events:none;')}></span><span style={css('pointer-events:none;')}></span>
        </button>
      </div>
    </nav>
  );
}
