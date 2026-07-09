import React from 'react';

// QUOTATION PAGE — markup 1:1 from public/index.html. The quotation
// document (#quote-output) is rendered by renderQuotation() in main.js.
export default function QuotationPage() {
  return (
    <div className="page" id="page-quotation">
      <div className="page-hero">
        <div className="page-hero-content">
          <div className="breadcrumb" onClick={() => window.showPage('home')}>Home <span>/ Plan Your Purchase / Request a Quotation</span></div>
          <h1>Request a <em>Quotation</em></h1>
        </div>
      </div>
      <div className="tool-page">
        <div className="quote-wrap">
          <div className="tool-card quote-form-card">
            <h2>Quotation <em>Details</em></h2>

            <div className="tool-field">
              <label>Company Name / Personal Name</label>
              <input className="tool-input" type="text" id="quote-company" onInput={() => window.renderQuotation()} />
            </div>
            <div className="tool-field">
              <label>Contact Person</label>
              <input className="tool-input" type="text" id="quote-attn" onInput={() => window.renderQuotation()} />
            </div>
            <div className="tool-field">
              <label>Contact Number</label>
              <input className="tool-input" type="tel" id="quote-phone" onInput={() => window.renderQuotation()} />
            </div>
            <div className="tool-field">
              <label>Email</label>
              <input className="tool-input" type="email" id="quote-email" onInput={() => window.renderQuotation()} />
            </div>
            <div className="tool-field">
              <label>Address</label>
              <input className="tool-input" type="text" id="quote-addr" onInput={() => window.renderQuotation()} />
            </div>
          </div>

          <div id="quote-output"></div>
        </div>
      </div>
    </div>
  );
}
