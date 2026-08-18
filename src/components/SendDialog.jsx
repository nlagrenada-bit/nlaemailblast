import React, { useEffect, useRef, useState } from 'react';
import { longDate } from '../../shared/config.js';
import { countAudience } from '../lib/api.js';

/**
 * Nothing is sent without passing through here. The operator picks the
 * audience, sees the live count, reads any outstanding warnings, and types
 * SEND. Typing rather than clicking is deliberate: a blast cannot be recalled,
 * and a mis-click at 8:46pm reaches every agent on the island.
 */
export default function SendDialog({
  open, onClose, onConfirm, email, date, label, groups, warnings = [], busy,
}) {
  const [groupIds, setGroupIds] = useState([]);
  const [count, setCount] = useState(null);
  const [typed, setTyped] = useState('');
  const first = useRef(null);

  useEffect(() => {
    if (!open) { setTyped(''); return; }
    first.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setCount(null);
    countAudience(groupIds).then((n) => { if (live) setCount(n); }).catch(() => setCount(0));
    return () => { live = false; };
  }, [open, groupIds]);

  if (!open) return null;

  const toggle = (id) =>
    setGroupIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const ready = typed.trim().toUpperCase() === 'SEND' && count > 0 && !busy;

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="send-title"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal">
        <header>
          <h2 id="send-title">Send this blast?</h2>
          <p className="lede">
            This goes out immediately and cannot be recalled. Check the audience and the
            subject line below.
          </p>
        </header>

        <div className="body">
          <div className="recap">
            <div><dt>Subject</dt><dd>{email?.subject}</dd></div>
            <div><dt>Draw</dt><dd>{label}</dd></div>
            <div><dt>Date</dt><dd>{longDate(date)}</dd></div>
            <div>
              <dt>Recipients</dt>
              <dd>{count === null ? 'counting…' : `${count} address${count === 1 ? '' : 'es'}`}</dd>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600, marginBottom: 8 }}>
              Audience
            </div>
            <div className="multix-picker">
              <button type="button" aria-pressed={groupIds.length === 0} onClick={() => setGroupIds([])}>
                Everyone
              </button>
              {groups.map((g) => (
                <button key={g.id} type="button" aria-pressed={groupIds.includes(g.id)} onClick={() => toggle(g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
            <p style={{ margin: '9px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
              Recipients are BCC'd, so nobody sees anyone else's address. Inactive,
              unsubscribed and bounced addresses are skipped.
            </p>
          </div>

          {warnings.length > 0 && (
            <div className="notice warn" style={{ marginTop: 16, marginBottom: 0 }}>
              <div>
                <strong>Going out with gaps</strong>
                <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            </div>
          )}

          {count === 0 && (
            <div className="notice error" style={{ marginTop: 16, marginBottom: 0 }}>
              No active addresses match this audience. Add recipients or pick another group.
            </div>
          )}

          <div className="confirmtype">
            <label htmlFor="confirm-send">Type SEND to confirm</label>
            <input
              id="confirm-send" ref={first} value={typed} autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ready) onConfirm(groupIds); }}
              placeholder="SEND"
            />
          </div>
        </div>

        <footer>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn send" disabled={!ready} onClick={() => onConfirm(groupIds)}>
            {busy ? 'Sending…' : `Send to ${count ?? 0}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
