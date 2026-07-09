import React from 'react';
import { css } from './css.js';

// CONTACT US PAGE — markup 1:1 from public/index.html.
export default function ContactPage() {
  return (
    <div className="page" id="page-contact">

      <div className="page-hero">
        <div className="page-hero-content">
          <div className="breadcrumb" onClick={() => window.showPage('home')}>Home <span>/ Contact Us</span></div>
          <h1>Get In <em>Touch</em></h1>
        </div>
      </div>

      <div className="contact-page">
        <div className="contact-page-grid">

          <div className="contact-info-block">
            <p>Reach out for orders, enquiries, or to learn more about our seedlings and collection schedule. We're happy to hear from you.</p>

            <div className="contact-card">
              <div className="cc-icon"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg></div>
              <div>
                <div className="cc-label">Office Address</div>
                <div className="cc-value">2nd Floor (B), Lot 1180, Bangunan BEI, Lorong Dua, Krokop, P.O. Box 163, 98007 Miri, Sarawak</div>
              </div>
            </div>
            <div className="contact-card">
              <div className="cc-icon"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.7 19.79 19.79 0 0 1 1.61 5.13 2 2 0 0 1 3.6 3h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10.67a16 16 0 0 0 6 6l.89-.89a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 18z" /></svg></div>
              <div>
                <div className="cc-label">Phone & Fax</div>
                <div className="cc-value"><a href="tel:085419907">085-419907</a> · Fax: 085-413264</div>
              </div>
            </div>
            <div className="contact-card">
              <div className="cc-icon"><svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg></div>
              <div>
                <div className="cc-label">Email</div>
                <div className="cc-value"><a href="mailto:nursery.mjsb@gmail.com">nursery.mjsb@gmail.com</a></div>
              </div>
            </div>

            <div>
              <div className="cc-label" style={css('display:block;margin-bottom:.75rem;')}>Follow Us</div>
              <div className="social-links">
                <a className="social-btn fb" href="https://www.facebook.com/theMJMGroup" target="_blank">
                  <svg viewBox="0 0 24 24"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>
                  {' '}Facebook
                </a>
                <a className="social-btn ig" href="https://www.instagram.com/themjmgroup/" target="_blank">
                  <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg>
                  {' '}Instagram
                </a>
                <a className="social-btn wa" href="https://wa.me/601129337889?text=Hello,%20I%20would%20like%20to%20enquire%20about%20oil%20palm%20seedlings." target="_blank">
                  <svg viewBox="0 0 448 512"><path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zM223.9 438.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z" /></svg>
                  {' '}WhatsApp
                </a>
                <a className="social-btn tt" href="https://www.tiktok.com/@mjmgroup1234" target="_blank" rel="noopener">
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.69a8.16 8.16 0 0 0 4.77 1.52v-3.43a4.85 4.85 0 0 1-1.84-.09z" /></svg>
                  {' '}TikTok
                </a>
                {/* LinkedIn slot — replace href when URL is confirmed (kept
                    commented out in the legacy page too). */}
              </div>
            </div>
          </div>

          <div className="contact-form-block">
            <h3>Send us a Message</h3>
            <form onSubmit={(e) => window.submitContactForm(e.nativeEvent)}>
              <div className="form-row">
                <div className="form-group">
                  <label>Full Name</label>
                  <input type="text" placeholder="Your full name" required />
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <input type="tel" placeholder="e.g. 011-2345 6789" />
                </div>
              </div>
              <div className="form-group">
                <label>Email Address</label>
                <input type="email" placeholder="your@email.com" required />
              </div>
              <div className="form-group">
                <label>Subject</label>
                <select defaultValue="">
                  <option value="">Select a topic...</option>
                  <option>Product Enquiry</option>
                  <option>Bulk / Wholesale Order</option>
                  <option>Collection Schedule</option>
                  <option>Payment & Banking</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="form-group">
                <label>Message</label>
                <textarea placeholder="Tell us more about your enquiry..."></textarea>
              </div>
              <button type="submit" className="btn-submit">Send Message</button>
            </form>
          </div>

        </div>
      </div>

    </div>
  );
}
