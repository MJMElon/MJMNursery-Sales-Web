import React from 'react';
import { css } from './css.js';

// LOGIN MODAL. Two ways in: Email (password or email code) and WhatsApp
// (phone number + a code sent on WhatsApp). The WhatsApp code is sent by
// the send-whatsapp-otp Edge Function through Supabase's Send SMS Hook --
// there is no SMS button because nothing sends an SMS. Every id here is
// one main.js already drives (clSwitchMode, clSendOTP, clVerifyOTP,
// clToggleSignup), so the markup and the logic must keep the same names.
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
          <div className="cl-status" id="cl-status"></div>

          <div className="lm-tabs">
            <button className="lm-tab active" id="lm-tab-email" onClick={() => window.clSwitchMode('email')}>✉️ Email</button>
            <button className="lm-tab" id="lm-tab-phone" onClick={() => window.clSwitchMode('phone')}>💬 WhatsApp</button>
          </div>

          {/* ── WHATSAPP PANE ── */}
          <div className="lm-pane" id="lm-pane-phone">
            <div style={css('display:flex;flex-direction:column;gap:.65rem;')}>
              <div id="cl-signup-fields-phone" style={css('display:none;')}>
                <input type="text" id="cl-signup-name-phone" className="cl-input" placeholder="Full Name" />
              </div>

              <input type="tel" id="cl-phone" className="cl-input" placeholder="Phone number, e.g. 012 345 6789" autoComplete="tel" inputMode="tel" />

              <button className="cl-btn" id="cl-btn-wa" onClick={() => window.clSendOTP('whatsapp')}>Send code to WhatsApp</button>

              <div className="cl-otp-row" id="cl-otp-row-phone">
                <input type="text" id="cl-otp-code-phone" className="cl-input" placeholder="Enter code from WhatsApp" maxLength="8" inputMode="numeric" autoComplete="one-time-code" />
                <button className="cl-otp-verify" onClick={() => window.clVerifyOTP('phone')}>Login</button>
              </div>
            </div>

            <div style={css('display:flex;justify-content:flex-end;align-items:center;margin-top:.8rem;')}>
              <button className="cl-link" id="cl-btn-toggle-phone" onClick={() => window.clToggleSignup('phone')}>First time? Create Account</button>
            </div>
          </div>

          {/* ── EMAIL PANE ── */}
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
