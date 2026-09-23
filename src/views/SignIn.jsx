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

    if (err) {
      /* A rate limit means NO email was sent. Previously this was folded in
         with success, so the person was told a link was on its way and then
         waited for one that did not exist. Say what actually happened. */
      /* Supabase words this several ways: "Email rate limit exceeded", and
         "For security purposes, you can only request this after 60 seconds".
         Both mean wait, not that something is broken. */
      if (/rate|too many|limit|after \d+ second|security purposes/i.test(err.message)) {
        setError('Too many reset attempts just now. Wait a minute or two and try '
          + 'again, or ask an administrator to reset it for you.');
      } else {
        setError('The reset email could not be sent. Ask an administrator to reset '
          + 'your password for you.');
      }
    } else {
      // Don't reveal whether an address exists — the same confirmation either way.
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
          <button type="button" className="linklike" onClick={() => { setMode('forgot'); setError(null); }}>
            Forgot your password?
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
              <div>
                <strong>Check your email.</strong> If that address is on the results
                desk, a link to set a new password is on its way. Look in your junk
                folder too — the first one often lands there.
                <p style={{ margin: '8px 0 0' }}>
                  Nothing after a few minutes? Ask an administrator to reset it for
                  you. The link also expires, so start again here if it has been a
                  while.
                </p>
              </div>
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

          <button type="button" className="linklike"
            onClick={() => { setMode('signin'); setError(null); setSent(false); }}>
            Back to sign in
          </button>
        </form>
      )}
    </div>
  );
}
