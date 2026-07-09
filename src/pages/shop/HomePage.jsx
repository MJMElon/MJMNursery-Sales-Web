import React from 'react';
import { css } from './css.js';

// HOME PAGE — markup 1:1 from public/index.html. Product grids
// (#specialGrid / #productsGrid) and the passion strip (#passionFlow) are
// filled by main.js exactly like the legacy inline script did.
export default function HomePage() {
  return (
    <div className="page active" id="page-home">

      <div style={css('height:160px;')}></div>{/* spacer for fixed nav */}

      {/* Special For You section */}
      <section className="salesweb_products" id="salesweb_products" style={css('padding-top:3rem;')}>
        <div style={css('text-align:center;margin-bottom:2rem;')}>
          <h2 className="section-title">Handpicked <em>Special For You</em></h2>
        </div>
        <div className="special-showcase" id="specialGrid"></div>
      </section>

      {/* All Seedlings */}
      <section className="salesweb_products" style={css('padding-top:1rem;')}>
        <div className="products-header">
          <div>
            <span className="section-label">All Products</span>
            <h2 className="section-title">Available <em>Seedlings</em></h2>
          </div>
        </div>
        <div className="products-grid" id="productsGrid"></div>
      </section>

      {/* 20+ Years of Excellence — features strip */}
      <div className="features-strip">
        <div style={css('grid-column: 1 / -1; text-align: center; padding-bottom: .5rem;')}>
          <h2 style={css("font-family:'Playfair Display',serif;font-size:clamp(1.8rem,4vw,2.8rem);font-weight:700;color:#fff;letter-spacing:.02em;line-height:1.15;margin:0;")}>
            20+ Years of Excellence.<br /><em style={css('color:var(--gold-light);font-style:italic;font-weight:400;')}>Award-Winning Nursery.</em>
          </h2>
        </div>
        <div className="feature-item fi-award">
          <div className="feature-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="6" /><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" /></svg></div>
          <div className="feature-label">MPOB Award Winner</div>
          <div className="feature-desc">Awarded Best Nursery by the Malaysia Palm Oil Board (MPOB).</div>
        </div>
        <div className="feature-item fi-quality">
          <div className="feature-icon"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg></div>
          <div className="feature-label">20% Quality Upsize</div>
          <div className="feature-desc">Superior seedling health and vitality compared to industry standards.</div>
        </div>
        <div className="feature-item fi-response">
          <div className="feature-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg></div>
          <div className="feature-label">24-Hour Response</div>
          <div className="feature-desc">Dedicated support team available round the clock for any request or help.</div>
        </div>
        <div className="feature-item fi-trusted">
          <div className="feature-icon"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg></div>
          <div className="feature-label">Trusted by Thousands</div>
          <div className="feature-desc">The preferred choice for planters across Sarawak.</div>
        </div>
      </div>

      <section className="passion-section">
        <span className="section-label">Our Passion</span>
        <h2 className="section-title">From Seed to <em>Sustainability</em></h2>
        <div className="passion-strip" id="passionFlow">
          {/* Loaded dynamically from site_content table */}
        </div>
      </section>

      <section className="rewards">
        <h2 className="section-title">Earn Points for<br />Every <em style={css('color:var(--gold-light)')}>Purchase</em></h2>
        <p>Sign up today and start earning reward points. More exciting rewards coming soon.</p>
        <a href="salesweb_auth.html" className="rewards-btn">Sign Up Now</a>
      </section>

    </div>
  );
}
