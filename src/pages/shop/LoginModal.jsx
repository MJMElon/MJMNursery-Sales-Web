import React from 'react';
import { css } from './css.js';

// LOGIN MODAL — markup 1:1 from public/index.html. Phone OTP tabs are
// intentionally absent (hidden until a phone sender is registered with
// Twilio), exactly as in the legacy page.
export default function LoginModal() {
  return (
    <div className="login-modal-overlay" id="login-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) window.closeLoginModal(); }}>
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
          <div className="cl-status" id="cl-status"></div>

          {/* ── EMAIL PANE (only mode for now) ── */}
          <div className="lm-pane active" id="lm-pane-email">
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
