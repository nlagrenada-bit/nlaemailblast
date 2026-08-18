import React, { useState } from 'react';
import { supabase, ASSET_BASE } from '../lib/supabase.js';

/**
 * Shown when the app opens from a password-recovery link. At this point
 * Supabase has already established a temporary recovery session, so all we do
 * is collect a new password and call updateUser.
 */
export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) { setError(err.message); return; }
    onDone?.();
  }

  return (
    <div className="signin">
      <form onSubmit={submit}>
        <img src={`${ASSET_BASE}/nla.png`} alt="" />
        <div>
          <h1>Set a new password</h1>
          <p>Choose a new password for the results desk.</p>
        </div>
        <input type="password" placeholder="New password" value={password} required
          autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
        <input type="password" placeholder="Confirm new password" value={confirm} required
          autoComplete="new-password" onChange={(e) => setConfirm(e.target.value)} />
        {error && <div className="notice error" style={{ margin: 0 }}>{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </div>
  );
}
