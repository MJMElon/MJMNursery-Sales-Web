import React from 'react';
import { css } from './css.js';

// LOGIN MODAL — markup ported from public/index.html, extended with the
// Phone tab. Phone accounts need NO SMS provider: the phone-auth edge
// function maps the phone number to the account's email and delivers the
// one-time login code there via Resend (handlers: clPhone* in main.js).
export default function LoginModal() {
  // Track whether the mousedown started on the overlay itself (not on
  // an input inside the card). If the customer drags to select text
  // inside the email input and releases outside the card, the browser
  // still fires a click on the overlay — closing the modal mid-edit.
  // Only close when BOTH mousedown and click land on the overlay.
  const overlayMouseDownRef = React.useRef(false);
  return (
    <div
      className="login-modal-overlay"
      id="login-modal-overlay"
      onMouseDown={(e) => { overlayMouseDownRef.current = (e.target === e.currentTarget); }}
      onClick={(e) => {
        if (e.target === e.currentTarget && overlayMouseDownRef.current) window.closeLoginModal();
        overlayMouseDownRef.current = false;
      }}
    >
      <div className="login-modal-card" id="login-modal-card">
        <button className="login-modal-close" onClick={() => window.closeLoginModal()} aria-label="Close">✕</button>

        <div className="login-modal-hero">
          <div className="login-modal-logo">
            <img src="https://cdn.store-assets.com/s/1408881/f/16655641.png" alt="MJM Nursery" />
          </div>
          <div className="login-modal-title">Welcome</div>
          <div className="login-modal-sub" id="lm-sub">Sign in to your account</div>
        </div>

        <div className="login-modal-body">
          <div className="lm-tabs">
            <button className="lm-tab active" id="lm-tab-phone" onClick={() => window.clSwitchMode('phone')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
              {' '}Phone
            </button>
            <button className="lm-tab" id="lm-tab-email" onClick={() => window.clSwitchMode('email')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
              {' '}Email
            </button>
          </div>

          <div className="cl-status" id="cl-status"></div>

          {/* ── PHONE PANE ── */}
          <div className="lm-pane active" id="lm-pane-phone">
            <div style={css('display:flex;flex-direction:column;gap:.65rem;')}>
              <div id="cl-signup-fields-phone" style={css('display:none;')}>
                <input type="text" id="cl-signup-name-phone" className="cl-input" placeholder="Full Name" style={css('margin-bottom:.65rem;')} />
                <input type="email" id="cl-signup-email-phone" className="cl-input" placeholder="Email Address" autoComplete="email" style={css('margin-bottom:.35rem;')} />
                <div style={css('font-size:11px;color:var(--text-mid);margin-bottom:.65rem;line-height:1.5;')}>
                  We&rsquo;ll email your login codes and receipts here.
                </div>
              </div>

              <input type="tel" id="cl-phone" className="cl-input" placeholder="Phone Number (e.g. 012-3456789)" autoComplete="tel" inputMode="tel" />

              <input type="password" id="cl-password-phone" className="cl-input" placeholder="Password" autoComplete="current-password" />

              <button className="cl-btn" id="cl-btn-login-phone" onClick={() => window.clPhoneAction()}>Sign In</button>

              <div className="cl-divider"><span>or no password?</span></div>

              <button className="cl-otp-btn" id="cl-btn-otp-phone" onClick={() => window.clPhoneSendOTP()}>Email me a Login Code</button>

              <div className="cl-otp-row" id="cl-otp-row-phone">
                <input type="text" id="cl-otp-code-phone" className="cl-input" placeholder="Enter code" maxLength="8" inputMode="numeric" />
                <button className="cl-otp-verify" onClick={() => window.clPhoneVerifyOTP()}>Login with Code</button>
              </div>
            </div>

            <div style={css('display:flex;justify-content:flex-end;align-items:center;margin-top:.8rem;')}>
              <button className="cl-link" id="cl-btn-toggle-phone" onClick={() => window.clToggleSignup('phone')}>First time? Create Account</button>
            </div>
          </div>

          {/* ── EMAIL PANE ── */}
          <div className="lm-pane" id="lm-pane-email">
            <div style={css('display:flex;flex-direction:column;gap:.65rem;')}>
              <div id="cl-signup-fields" style={css('display:none;')}>
                <input type="text" id="cl-signup-name" className="cl-input" placeholder="Full Name" style={css('margin-bottom:.65rem;')} />
              </div>

              <input type="email" id="cl-identity" className="cl-input" placeholder="Email Address" autoComplete="email" />

              <input type="password" id="cl-password" className="cl-input" placeholder="Password" autoComplete="current-password" />

              <button className="cl-btn" id="cl-btn-login" onClick={() => window.clLoginPassword()}>Sign In</button>

              <div className="cl-divider"><span>or no password?</span></div>

              <button className="cl-otp-btn" id="cl-btn-otp" onClick={() => window.clSendOTP('email')}>Send Email OTP Code</button>

              <div className="cl-otp-row" id="cl-otp-row">
                <input type="text" id="cl-otp-code" className="cl-input" placeholder="Enter 8-digit code" maxLength="8" inputMode="numeric" />
                <button className="cl-otp-verify" onClick={() => window.clVerifyOTP('email')}>Login with OTP</button>
              </div>
            </div>

            <div style={css('display:flex;justify-content:space-between;align-items:center;margin-top:.8rem;')}>
              <button className="cl-link" onClick={() => window.clForgotPassword()}>Forgot Password?</button>
              <button className="cl-link" id="cl-btn-toggle" onClick={() => window.clToggleSignup('email')}>Create Account</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
