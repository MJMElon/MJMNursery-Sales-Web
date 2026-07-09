import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { checkEmailTypo } from '../lib/emailTypo.js';
import '../styles/auth.css';

const LOGO = 'https://cdn.store-assets.com/s/1408881/f/16655641.png';

// Login page — React port of the original auth.html. Behaviour is kept
// identical: password / OTP (email or SMS) / signup / forgot-password /
// recovery flows, email typo suggestions, and the same post-login routing
// via shared_profiles.permissions.modules.salesweb.
export default function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isRecovery, setIsRecovery] = useState(() => window.location.hash.includes('type=recovery'));
  const [status, setStatus] = useState(null); // {msg, type}
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [signupName, setSignupName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [recPassword, setRecPassword] = useState('');
  const [otpRowShown, setOtpRowShown] = useState(false);
  const [otpBtn, setOtpBtn] = useState({ disabled: false, label: 'Send OTP Code' });
  const [hint, setHint] = useState({ kind: 'none' }); // none | phone | email | suggest | corrected

  // Mutable flags that mirror the original script's globals.
  const inputTypeRef = useRef('email'); // 'email' | 'phone'
  const typoAcceptedRef = useRef(false);
  const isRecoveryRef = useRef(isRecovery);
  isRecoveryRef.current = isRecovery;
  const countdownRef = useRef(null);
  const otpInputRef = useRef(null);

  const showStatus = (msg, type) => setStatus({ msg, type });

  function detectInputType(val) {
    typoAcceptedRef.current = false;
    if (val.startsWith('+') || /^\d{8,}$/.test(val)) {
      inputTypeRef.current = 'phone';
      setHint({ kind: 'phone' });
      setOtpBtn(b => ({ ...b, label: b.disabled ? b.label : 'Send SMS OTP' }));
    } else if (val.includes('@')) {
      inputTypeRef.current = 'email';
      const suggestion = checkEmailTypo(val);
      if (suggestion) {
        setHint({ kind: 'suggest', suggestion });
      } else {
        setHint({ kind: 'email' });
      }
      setOtpBtn(b => ({ ...b, label: b.disabled ? b.label : 'Send Email OTP' }));
    } else {
      inputTypeRef.current = 'email';
      setHint({ kind: 'none' });
      setOtpBtn(b => ({ ...b, label: b.disabled ? b.label : 'Send OTP Code' }));
    }
  }

  function applyEmailSuggestion(corrected) {
    setIdentity(corrected);
    setHint({ kind: 'corrected' });
    typoAcceptedRef.current = true;
    setTimeout(() => setHint({ kind: 'email' }), 2000);
  }

  function dismissEmailSuggestion() {
    setHint({ kind: 'email' });
    typoAcceptedRef.current = true;
  }

  function pendingTypoBlocks(id) {
    if (inputTypeRef.current === 'email' && !typoAcceptedRef.current) {
      const suggestion = checkEmailTypo(id);
      if (suggestion) {
        showStatus('Did you mean ' + suggestion + "? Check the suggestion below, or click \"No, it's correct\" to continue.", 'error');
        detectInputType(id);
        return true;
      }
    }
    return false;
  }

  async function handlePostLogin(session) {
    if (!session) { showStatus('Login failed.', 'error'); return; }
    showStatus('Welcome! Redirecting...', 'success');
    sessionStorage.setItem('mjm_user_email', session.user.email || '');
    sessionStorage.setItem('mjm_user_name', session.user.user_metadata?.full_name || session.user.email || session.user.phone || '');

    // Routing: read per-module access from shared_profiles.permissions JSONB
    // (set via the User Access page). Fall back to legacy role='admin' column
    // for users provisioned before the permissions migration.
    const { data: profile } = await supabase.from('shared_profiles').select('role, permissions').eq('id', session.user.id).single();
    const swLevel = (profile && profile.permissions && profile.permissions.modules && profile.permissions.modules.salesweb) || 'none';
    const legacyAdmin = profile && profile.role === 'admin';

    if (swLevel === 'admin' || swLevel === 'normal' || legacyAdmin) {
      window.location.href = 'admin.html';
    } else {
      sessionStorage.setItem('mjm_last_page', 'portal');
      window.location.href = 'index.html';
    }
  }

  async function loginWithPassword() {
    const id = identity.trim();
    if (!id || !password) { showStatus('Please enter email/phone and password.', 'error'); return; }
    if (pendingTypoBlocks(id)) return;

    if (isSignUp) {
      const name = signupName.trim();
      if (!name) { showStatus('Please enter your full name.', 'error'); return; }
      if (password.length < 6) { showStatus('Password must be at least 6 characters.', 'error'); return; }
      showStatus('Creating account...', 'success');
      const { data: signUpData, error } = await supabase.auth.signUp({ email: id, password, options: { data: { full_name: name, user_type: 'customer' } } });
      if (error) {
        if (error.message.toLowerCase().includes('database')) {
          const { data: retryData, error: retryErr } = await supabase.auth.signUp({ email: id, password, options: { data: { user_type: 'customer' } } });
          if (retryErr) { showStatus(retryErr.message, 'error'); return; }
          if (retryData && retryData.user) {
            await supabase.from('shared_profiles').upsert({ id: retryData.user.id, email: id, full_name: name, role: 'customer', user_type: 'customer' }, { onConflict: 'id' });
          }
        } else { showStatus(error.message, 'error'); return; }
      } else if (signUpData && signUpData.user) {
        await supabase.from('shared_profiles').upsert({ id: signUpData.user.id, email: id, full_name: name, role: 'customer', user_type: 'customer' }, { onConflict: 'id' });
      }
      showStatus('Account created! You can now sign in.', 'success');
      setIsSignUp(false);
      return;
    }

    showStatus('Signing in...', 'success');
    const creds = inputTypeRef.current === 'phone' ? { phone: id, password } : { email: id, password };
    const { data, error } = await supabase.auth.signInWithPassword(creds);
    if (error) { showStatus(error.message, 'error'); return; }
    await handlePostLogin(data.session);
  }

  async function sendOTP() {
    const id = identity.trim();
    if (!id) { showStatus('Please enter your email or phone number.', 'error'); return; }
    if (pendingTypoBlocks(id)) return;

    setOtpBtn({ disabled: true, label: 'Sending...' });

    const opts = inputTypeRef.current === 'phone' ? { phone: id } : { email: id };
    const { error } = await supabase.auth.signInWithOtp(opts);

    if (error) {
      showStatus(error.message, 'error');
      setOtpBtn({ disabled: false, label: inputTypeRef.current === 'phone' ? 'Send SMS OTP' : 'Send Email OTP' });
      return;
    }

    showStatus(inputTypeRef.current === 'phone' ? 'SMS sent to ' + id : 'Code sent to ' + id, 'success');
    setOtpRowShown(true);
    setTimeout(() => otpInputRef.current?.focus(), 0);

    setOtpBtn({ disabled: true, label: 'Sent' });
    let cd = 30;
    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      cd--;
      if (cd <= 0) {
        clearInterval(countdownRef.current);
        setOtpBtn({ disabled: false, label: inputTypeRef.current === 'phone' ? 'Resend SMS' : 'Resend Code' });
      } else {
        setOtpBtn({ disabled: true, label: 'Resend (' + cd + ')' });
      }
    }, 1000);
  }

  async function verifyOTP() {
    const id = identity.trim();
    const otp = otpCode.trim();
    if (!id || !otp) { showStatus('Please enter the 8-digit code.', 'error'); return; }

    showStatus('Verifying...', 'success');
    const opts = inputTypeRef.current === 'phone'
      ? { phone: id, token: otp, type: 'sms' }
      : { email: id, token: otp, type: 'email' };

    const { data, error } = await supabase.auth.verifyOtp(opts);
    if (error) { showStatus(error.message, 'error'); return; }
    await handlePostLogin(data.session);
  }

  async function forgotPassword() {
    const id = identity.trim();
    if (!id || inputTypeRef.current === 'phone') { showStatus('Enter your email address first.', 'error'); return; }
    // Pin the reset link to THIS app's recovery page. Without an explicit
    // redirectTo, Supabase falls back to the project-wide Site URL (which
    // points at a different MJM app).
    const { error } = await supabase.auth.resetPasswordForEmail(id, {
      redirectTo: window.location.origin + '/auth.html',
    });
    if (error) { showStatus(error.message, 'error'); return; }
    showStatus('Reset link sent! Check your inbox.', 'success');
  }

  async function updatePassword() {
    if (!recPassword || recPassword.length < 6) { showStatus('Password must be at least 6 characters.', 'error'); return; }
    const { error } = await supabase.auth.updateUser({ password: recPassword });
    if (error) { showStatus(error.message, 'error'); return; }
    showStatus('Password updated!', 'success');
    setIsRecovery(false);
    window.location.hash = '';
    setTimeout(() => { window.location.href = 'auth.html'; }, 1500);
  }

  useEffect(() => {
    // Ignore auth events for the first 300ms so an existing session doesn't
    // bounce the user away from the login page (same as the original).
    let pageLoaded = false;
    const t = setTimeout(() => { pageLoaded = true; }, 300);

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
        return;
      }
      if (event === 'SIGNED_IN' && session && !isRecoveryRef.current && pageLoaded) {
        await handlePostLogin(session);
      }
    });

    return () => {
      clearTimeout(t);
      clearInterval(countdownRef.current);
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onEnter = fn => e => { if (e.key === 'Enter') fn(); };

  return (
    <>
      <div className="auth-bg"></div>

      <div className="auth-card">
        <div className="auth-logo">
          <img src={LOGO} alt="MJM Nursery" />
          <div className="auth-logo-title">Welcome Back</div>
          <div className="auth-logo-sub">Sign in to your account</div>
        </div>

        <div className="auth-divider"></div>

        {status && <div className={'status-msg ' + status.type}>{status.msg}</div>}

        {!isRecovery ? (
          <div id="form-main">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              {isSignUp && (
                <div>
                  <input
                    type="text"
                    className="auth-input"
                    placeholder="Full Name"
                    style={{ marginBottom: '.75rem' }}
                    value={signupName}
                    onChange={e => setSignupName(e.target.value)}
                  />
                </div>
              )}

              <input
                type="text"
                className="auth-input"
                placeholder="Email or Phone Number"
                value={identity}
                onChange={e => { setIdentity(e.target.value); detectInputType(e.target.value.trim()); }}
                onKeyDown={onEnter(loginWithPassword)}
              />
              <div className="input-hint" style={hint.kind === 'suggest' ? { color: '#fca5a5' } : hint.kind === 'corrected' ? { color: '#86efac' } : undefined}>
                {hint.kind === 'phone' && <>☎ Phone detected — OTP will be sent via SMS</>}
                {hint.kind === 'email' && <>✉ Email detected — OTP will be sent to your inbox</>}
                {hint.kind === 'corrected' && <>✅ Email corrected!</>}
                {hint.kind === 'suggest' && (
                  <>
                    ⚠️ Did you mean{' '}
                    <strong
                      style={{ color: '#E8D49A', cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={() => applyEmailSuggestion(hint.suggestion)}
                    >
                      {hint.suggestion}
                    </strong>
                    ?{' '}
                    <span style={{ opacity: 0.6, cursor: 'pointer' }} onClick={dismissEmailSuggestion}>
                      No, it&apos;s correct
                    </span>
                  </>
                )}
              </div>

              <input
                type="password"
                className="auth-input"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={onEnter(loginWithPassword)}
              />

              <button className="auth-btn" onClick={loginWithPassword}>
                {isSignUp ? 'Create Account' : 'Sign In'}
              </button>

              <div className="or-line"><span>or</span></div>

              <button className="otp-btn" disabled={otpBtn.disabled} onClick={sendOTP}>
                {otpBtn.label}
              </button>

              <div className={'otp-verify-row' + (otpRowShown ? ' show' : '')}>
                <input
                  ref={otpInputRef}
                  type="text"
                  className="auth-input"
                  placeholder="Enter 8-digit code"
                  maxLength={8}
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value)}
                  onKeyDown={onEnter(verifyOTP)}
                />
                <button className="otp-verify-btn" onClick={verifyOTP}>Login with OTP</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
              <button className="link-btn" onClick={forgotPassword}>Forgot Password?</button>
              <button className="link-btn" onClick={() => setIsSignUp(s => !s)}>
                {isSignUp ? 'Back to Sign In' : 'Create Account'}
              </button>
            </div>
          </div>
        ) : (
          <div id="form-recovery">
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <div className="auth-logo-title" style={{ fontSize: '1.3rem' }}>New <em>Password</em></div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
              <input
                type="password"
                className="auth-input"
                placeholder="Enter New Password"
                value={recPassword}
                onChange={e => setRecPassword(e.target.value)}
                onKeyDown={onEnter(updatePassword)}
              />
              <button className="auth-btn" onClick={updatePassword}>Save Password</button>
            </div>
          </div>
        )}

        <a href="index.html" className="back-link">&larr; Back to Shop</a>
        <div className="auth-footer">&copy; 2026 Mega Jutamas Sdn Bhd (663951-U)</div>
      </div>
    </>
  );
}
