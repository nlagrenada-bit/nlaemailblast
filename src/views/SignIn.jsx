import React, { useState } from 'react';
import { supabase, ASSET_BASE } from '../lib/supabase.js';

export default function SignIn() {
  const [mode, setMode] = useState('signin');   // 'signin' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signIn(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError('That email and password do not match an account on the results desk.');
    setBusy(false);
  }

  async function sendReset(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    // The link brings the user back to the app, where App.jsx catches the
    // recovery event and shows the "set a new password" screen.
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });
    // Don't reveal whether an address exists — always show the same confirmation.
    if (err && !/rate/i.test(err.message)) {
      setError('Something went wrong sending the reset email. Try again in a moment.');
    } else {
      setSent(true);
    }
    setBusy(false);
  }

  return (
    <div className="signin">
      {mode === 'signin' && (
        <form onSubmit={signIn}>
          <img src={`${ASSET_BASE}/nla.png`} alt="" />
          <div>
            <h1>Results desk</h1>
            <p>Sign in to enter draw results and send blasts.</p>
          </div>
          <input type="email" placeholder="Email" value={email} required autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" value={password} required autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="notice error" style={{ margin: 0 }}>{error}</div>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" className="btn ghost" style={{ justifySelf: 'center' }}
            onClick={() => { setMode('forgot'); setError(null); }}>
            Forgot password?
          </button>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={sendReset}>
          <img src={`${ASSET_BASE}/nla.png`} alt="" />
          <div>
            <h1>Reset password</h1>
            <p>Enter your desk email and we'll send a link to set a new password.</p>
          </div>

          {sent ? (
            <div className="notice info" style={{ margin: 0 }}>
              If that address is on the results desk, a reset link is on its way.
              Check your inbox, and your spam folder if it doesn't arrive shortly.
            </div>
          ) : (
            <>
              <input type="email" placeholder="Email" value={email} required autoComplete="username"
                onChange={(e) => setEmail(e.target.value)} />
              {error && <div className="notice error" style={{ margin: 0 }}>{error}</div>}
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </>
          )}

          <button type="button" className="btn ghost" style={{ justifySelf: 'center' }}
            onClick={() => { setMode('signin'); setError(null); setSent(false); }}>
            Back to sign in
          </button>
        </form>
      )}
    </div>
  );
}
