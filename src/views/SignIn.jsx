import React, { useState } from 'react';
import { supabase, ASSET_BASE } from '../lib/supabase.js';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError('That email and password do not match an account on the results desk.');
    setBusy(false);
  }

  return (
    <div className="signin">
      <form onSubmit={submit}>
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
      </form>
    </div>
  );
}
