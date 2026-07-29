import React from 'react';
import { css } from './css.js';

// INFORMATION PAGE — markup 1:1 from public/index.html.
const cardStyle = 'background:#fff;border-radius:16px;padding:2.5rem;border:1px solid rgba(0,0,0,.06);line-height:1.8;color:var(--text-mid);font-size:14px;';
const h3First = 'color:var(--text-dark);font-size:15px;margin:0 0 .5rem;';
const h3Next = 'color:var(--text-dark);font-size:15px;margin:1.5rem 0 .5rem;';

export default function InformationPage() {
  return (
    <div className="page" id="page-information">

      <div className="page-hero">
        <div className="page-hero-content">
          <div className="breadcrumb" onClick={() => window.showPage('home')}>Home <span>/ Information</span></div>
          <h1>Information &amp; <em>Policies</em></h1>
        </div>
      </div>

      <div className="info-page">
        <div className="info-policies">
          <span className="section-label">Legal Documents</span>
          <h2 className="section-title">Our <em>Policies</em></h2>

          {/* Policy tabs */}
          <div style={css('display:flex;gap:.5rem;margin-bottom:1.5rem;flex-wrap:wrap;')}>
            <button className="policy-tab active" onClick={(e) => window.switchPolicyTab('terms', e.currentTarget)}>Terms & Conditions</button>
            <button className="policy-tab" onClick={(e) => window.switchPolicyTab('privacy', e.currentTarget)}>Privacy Policy</button>
            <button className="policy-tab" onClick={(e) => window.switchPolicyTab('refund', e.currentTarget)}>Non Refund Policy</button>
            <button className="policy-tab" onClick={(e) => window.switchPolicyTab('collection', e.currentTarget)}>Customer Collection Policy</button>
            <button className="policy-tab" onClick={(e) => window.switchPolicyTab('einvoice', e.currentTarget)}>E-Invoice Policy</button>
          </div>

          {/* Terms & Conditions */}
          <div className="policy-content active" id="pol-terms">
            <div style={css(cardStyle)}>
              <h3 style={css(h3First)}>1. Introduction</h3>
              <p>These Terms apply to the website and transactions for products and services. Additional contracts may apply and will control if they conflict with these Terms.</p>
              <h3 style={css(h3Next)}>2. Binding</h3>
              <p>By registering, accessing, or using this website, you agree to be bound by these Terms. The mere use of this website implies the knowledge and acceptance of these Terms.</p>
              <h3 style={css(h3Next)}>3. Electronic Communication</h3>
              <p>You consent to electronic communications from the company via website or email, which satisfy legal requirements for written communication.</p>
              <h3 style={css(h3Next)}>4. Intellectual Property</h3>
              <p>The company owns all copyright and intellectual property rights in the website and its content. Without written permission, you may not use, copy, reproduce, distribute, alter, reverse engineer, decompile, transfer, download, transmit, monetize, sell, market, or commercialize website resources.</p>
              <h3 style={css(h3Next)}>5. Third-Party Property</h3>
              <p>The site contains links to other websites. The company does not monitor their content and is not responsible for any privacy practices or content of these sites.</p>
              <h3 style={css(h3Next)}>6. Responsible Use</h3>
              <p>You agree to use the website only lawfully and ethically. Prohibited activities include distributing malware, collecting data for marketing, or conducting automated data collection.</p>
              <h3 style={css(h3Next)}>7. Registration</h3>
              <p>Account holders must maintain password confidentiality and are responsible for all account activities. You must immediately notify the company of password disclosure.</p>
              <h3 style={css(h3Next)}>8. Idea Submission</h3>
              <p>Unsolicited idea submissions grant the company a worldwide, irrevocable, non-exclusive, royalty-free license to use, reproduce, store, adapt, publish, translate and distribute your content.</p>
              <h3 style={css(h3Next)}>9. Termination of Use</h3>
              <p>The company may suspend or discontinue website access at any discretion without liability.</p>
              <h3 style={css(h3Next)}>10. Warranties and Liability</h3>
              <p>The website is provided "as is and as available" with all warranties disclaimed. Liability is limited to amounts paid for products or services.</p>
              <h3 style={css(h3Next)}>11. Privacy</h3>
              <p>Users must provide accurate information during registration. The company commits to protecting personal data.</p>
              <h3 style={css(h3Next)}>12. Accessibility</h3>
              <p>The company commits to making content accessible to individuals with disabilities.</p>
              <h3 style={css(h3Next)}>13. Export Restrictions / Legal Compliance</h3>
              <p>Users must comply with Malaysian export regulations.</p>
              <h3 style={css(h3Next)}>14. Assignment</h3>
              <p>Users cannot assign rights or obligations under these Terms without written consent.</p>
              <h3 style={css(h3Next)}>15. Breaches of Terms</h3>
              <p>The company may suspend accounts, contact internet service providers, or pursue legal action for breaches.</p>
              <h3 style={css(h3Next)}>16. Force Majeure</h3>
              <p>Neither party is liable for delays or failures arising from causes beyond reasonable control, except for payment obligations.</p>
              <h3 style={css(h3Next)}>17. Indemnification</h3>
              <p>Users must indemnify and compensate the company for claims relating to Terms violations.</p>
              <h3 style={css(h3Next)}>18. Waiver</h3>
              <p>Failure to enforce provisions does not constitute waiver of those provisions.</p>
              <h3 style={css(h3Next)}>19. Language</h3>
              <p>These Terms are interpreted exclusively in English.</p>
              <h3 style={css(h3Next)}>20. Entire Agreement</h3>
              <p>These Terms, privacy statement, and cookie policy constitute the entire agreement regarding website use.</p>
              <h3 style={css(h3Next)}>21. Updating of Terms</h3>
              <p>It is your obligation to periodically check these Terms for changes or updates.</p>
              <h3 style={css(h3Next)}>22. Choice of Law and Jurisdiction</h3>
              <p>Malaysian law governs these Terms, with disputes subject to Malaysian court jurisdiction.</p>
              <h3 style={css(h3Next)}>23. Contact Information</h3>
              <p>Company: Mega Jutamas Sdn Bhd<br />Email: nursery.mjsb@gmail.com<br />Address: 2nd Floor, Bangunan Bei, Lot 1180B, Lorong 2, Krokop 98000 Miri, Sarawak</p>
            </div>
          </div>

          {/* Privacy Policy */}
          <div className="policy-content" id="pol-privacy">
            <div style={css(cardStyle)}>
              <p style={css('font-size:12px;color:var(--text-light);margin-bottom:1rem;font-style:italic;')}>Last updated January 01, 2024</p>
              <p>This privacy notice for Mega Jutamas Sdn. Bhd. describes how and why we might collect, store, use, and/or share your information when you use our services.</p>
              <h3 style={css(h3Next)}>1. What Information Do We Collect?</h3>
              <p>We collect personal information that you voluntarily provide: names, phone numbers, email addresses, mailing addresses, passwords, usernames, billing addresses, debit/credit card numbers, and contact or authentication data. We do not process sensitive information. Payment data is stored by Billplz.</p>
              <h3 style={css(h3Next)}>2. How Do We Process Your Information?</h3>
              <p>We process your information to provide, improve, and administer our Services, communicate with you, for security and fraud prevention, and to comply with law.</p>
              <h3 style={css(h3Next)}>3. When and With Whom Do We Share Your Information?</h3>
              <p>We may share your information in connection with any merger, sale of company assets, financing, or acquisition of our business.</p>
              <h3 style={css(h3Next)}>4. How Long Do We Keep Your Information?</h3>
              <p>We keep your personal information only as long as necessary for the purposes set out in this notice.</p>
              <h3 style={css(h3Next)}>5. How Do We Keep Your Information Safe?</h3>
              <p>We have implemented appropriate technical and organisational security measures. However, no transmission over the Internet can be guaranteed 100% secure.</p>
              <h3 style={css(h3Next)}>6. Do We Collect Information From Minors?</h3>
              <p>We do not knowingly solicit data from children under 18 years of age.</p>
              <h3 style={css(h3Next)}>7. What Are Your Privacy Rights?</h3>
              <p>You may review, change, or terminate your account at any time. You have the right to withdraw your consent by contacting us.</p>
              <h3 style={css(h3Next)}>8. Do-Not-Track Features</h3>
              <p>We do not currently respond to DNT browser signals.</p>
              <h3 style={css(h3Next)}>9. Updates to This Notice</h3>
              <p>We may update this privacy notice from time to time. We encourage you to review it frequently.</p>
              <h3 style={css(h3Next)}>10. Contact Us</h3>
              <p>Mega Jutamas Sdn. Bhd.<br />Lot 1180, 2nd Floor, Bangunan Bei, Krokop 2, Miri, Sarawak 98000<br />Email: <a href="mailto:nursery.mjsb@gmail.com" style={css('color:var(--green-mid);')}>nursery.mjsb@gmail.com</a></p>
            </div>
          </div>

          {/* Non Refund Policy */}
          <div className="policy-content" id="pol-refund">
            <div style={css(cardStyle)}>
              <p style={css('background:var(--green-pale);color:var(--green-dark);padding:1rem 1.5rem;border-radius:10px;font-weight:500;margin-bottom:1.5rem;')}>We honor the committed price and reservation within the valid collection period. Please review our non-refund policy before making any purchases.</p>
              <h3 style={css(h3First)}>1. Order Confirmation</h3>
              <p>To secure your order for ready stock, we require full payment before collection. For pre-orders, a 10% deposit is necessary, and full payment must be made before collecting your oil palm seedlings.</p>
              <h3 style={css(h3Next)}>2. Non-Refundable Payment / Deposit</h3>
              <p>All payments / deposits made towards oil palm seedlings are non-refundable. Once a payment has been made, it cannot be refunded for any reason. We allocate resources and reserve seedlings specifically for your order — it is non-transferable and non-refundable.</p>
              <h3 style={css(h3Next)}>3. Scheduled Collection</h3>
              <p>Customers must collect seedlings on the scheduled date. Failure to collect may result in forfeiture of payment and cancellation of the order.</p>
              <h3 style={css(h3Next)}>4. Change of Collection Date</h3>
              <p>Rescheduling may require additional payment for any price difference, subject to availability. Additional payment must be made before a new date is confirmed.</p>
              <h3 style={css(h3Next)}>5. Final Payment</h3>
              <p>Deposits will be automatically deducted from the total invoice amount during final payment.</p>
            </div>
          </div>

          {/* Customer Collection Policy */}
          <div className="policy-content" id="pol-collection">
            <div style={css(cardStyle)}>
              <p style={css('background:var(--green-pale);color:var(--green-dark);padding:1rem 1.5rem;border-radius:10px;font-weight:500;margin-bottom:1.5rem;')}>The following customer responsibilities apply at the point of collection. Please read carefully before arriving at the nursery.</p>
              <h3 style={css(h3First)}>1. Physical Verification</h3>
              <p>Customer must verify the number of identification stickers matches the total purchase quantity before proceeding to the nursery.</p>
              <h3 style={css(h3Next)}>2. Selection &amp; Quality Control</h3>
              <p>Seedling selection is the sole responsibility of the customer. Applying a sticker to a polybag constitutes formal and final acceptance of that seedling's health, size, and quality.</p>
              <p><strong>Worker Assistance Disclaimer:</strong> If the customer requests nursery staff to assist with or perform the marking/sticking on their behalf, the customer assumes all risk regarding the selection. The company shall not be held liable for the quality or characteristics of seedlings selected by staff under the customer's instruction.</p>
              <h3 style={css(h3Next)}>3. Loading Accuracy</h3>
              <p>Customer is responsible for verifying the final count loaded onto the vehicle. Any discrepancies must be raised before signing the Delivery Order (DO).</p>
              <h3 style={css(h3Next)}>4. Finality of Sale</h3>
              <p>Post-signature of the DO, the company is absolved of all liability regarding seedling health, replacement, or exchange.</p>
              <h3 style={css(h3Next)}>5. Administrative Accuracy</h3>
              <p>Upon completion, the Borang Akuan (L3) must be checked. Any administrative errors must be corrected at the site office immediately prior to departure.</p>
            </div>
          </div>

          {/* E-Invoice Policy */}
          <div className="policy-content" id="pol-einvoice">
            <div style={css(cardStyle)}>
              <p style={css('background:var(--green-pale);color:var(--green-dark);padding:1rem 1.5rem;border-radius:10px;font-weight:500;margin-bottom:1.5rem;')}>Please review the following guidelines regarding invoicing, receipts, and Malaysian LHDN E-Invoice compliance before placing your order.</p>

              <h3 style={css(h3First)}>1. Proforma Invoicing &amp; Receipts</h3>
              <p>For orders placed under a personal name with a total value below <strong>RM 10,000</strong>, the system automatically generates a Proforma Invoice at checkout, followed by a Receipt once payment is confirmed. No standard invoice is issued for these orders.</p>

              <h3 style={css(h3Next)}>2. Automatic E-Invoice Processing</h3>
              <p>Official E-Invoices (compliant with LHDN guidelines) are generated and submitted to LHDN automatically for:</p>
              <ul style={css('margin:.5rem 0 .5rem 1.4rem;padding:0;')}>
                <li>Orders placed under a registered <strong>Company / Corporate Name</strong>.</li>
                <li>Orders with a total value of <strong>RM 10,000.00 and above</strong>.</li>
              </ul>

              <h3 style={css(h3Next)}>3. Personal Orders &amp; Request Window</h3>
              <p>For individual / personal purchases under RM 10,000.00, an official E-Invoice is <strong>not generated automatically</strong>. Customers who need one must submit an explicit request via the active order portal.</p>
              <p>Requests must be submitted within <strong>five (5) calendar days</strong> of the order date. After this window, requests are automatically declined and cannot be entertained.</p>
              <p>Unrequested individual orders are aggregated and submitted as a consolidated E-Invoice to LHDN in accordance with regulatory guidelines.</p>

              <h3 style={css(h3Next)}>4. Customer Responsibility &amp; Tax Data Accuracy</h3>
              <p>Customers requesting an E-Invoice must provide complete and accurate tax details, including:</p>
              <ul style={css('margin:.5rem 0 .5rem 1.4rem;padding:0;')}>
                <li>Full Tax Identification Number (TIN)</li>
                <li>NRIC / Passport Number / Business Registration Number</li>
                <li>SST Registration Number (if applicable)</li>
                <li>Valid email address and contact information</li>
              </ul>
              <p>Requests with missing, mismatched, or invalid details will be rejected by Accounts. Any re-submission must still take place within the original 5-calendar-day window.</p>

              <h3 style={css(h3Next)}>5. Finality &amp; Non-Amendability</h3>
              <p>A validated E-Invoice is <strong>final</strong>. No modification, cancellation, or re-issuance under a different name or TIN is allowed — by any means, system or otherwise. Errors must be corrected via a Credit Note, Debit Note, or replacement E-Invoice per LHDN guidelines.</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
