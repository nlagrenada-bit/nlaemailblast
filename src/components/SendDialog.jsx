import React, { useEffect, useMemo, useRef, useState } from 'react';
import { longDate } from '../../shared/config.js';
import { countAudience, listSendable } from '../lib/api.js';

/**
 * Nothing is sent without passing through here. The operator picks the
 * audience (everyone, chosen groups, or a hand-picked set of addresses), sees
 * the live count, reads any warnings, optionally marks the blast as a RESEND
 * that corrects an earlier one, and types SEND. Typing rather than clicking is
 * deliberate: a blast cannot be recalled.
 */
export default function SendDialog({
  open, onClose, onConfirm, email, date, label, groups, warnings = [], busy, progress,
}) {
  const [mode, setMode] = useState('everyone');    // 'everyone' | 'groups' | 'pick'
  const [groupIds, setGroupIds] = useState([]);
  const [people, setPeople] = useState(null);      // for 'pick' mode
  const [chosen, setChosen] = useState(new Set());
  const [search, setSearch] = useState('');
  const [count, setCount] = useState(null);
  const [isResend, setIsResend] = useState(false);
  const [dbOnly, setDbOnly] = useState(false);
  const [typed, setTyped] = useState('');
  const first = useRef(null);

  useEffect(() => {
    if (!open) {
      setTyped(''); setMode('everyone'); setGroupIds([]);
      setChosen(new Set()); setSearch(''); setIsResend(false); setDbOnly(false);
      return;
    }
    first.current?.focus();
  }, [open]);

  // Load the address book the first time "pick specific" is opened.
  useEffect(() => {
    if (open && mode === 'pick' && people === null) {
      listSendable().then(setPeople).catch(() => setPeople([]));
    }
  }, [open, mode, people]);

  // Live recipient count depends on the mode.
  useEffect(() => {
    if (!open) return;
    if (mode === 'pick') { setCount(chosen.size); return; }
    let live = true;
    setCount(null);
    const gids = mode === 'groups' ? groupIds : [];
    countAudience(gids).then((n) => { if (live) setCount(n); }).catch(() => setCount(0));
    return () => { live = false; };
  }, [open, mode, groupIds, chosen]);

  const shown = useMemo(() => {
    if (!people) return [];
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      p.email.toLowerCase().includes(q) || (p.full_name || '').toLowerCase().includes(q));
  }, [people, search]);

  if (!open) return null;

  const toggleGroup = (id) =>
    setGroupIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const togglePerson = (id) =>
    setChosen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const confirmWord = dbOnly ? 'UPDATE' : (isResend ? 'RESEND' : 'SEND');
  const ready = typed.trim().toUpperCase() === confirmWord
    && (dbOnly || count > 0) && !busy;

  // What we hand back: the group filter (or null), the explicit email list (or
  // null for group/everyone mode), the resend flag, and whether to skip email
  // and only update the website/database.
  const emailsForPick = () =>
    (people || []).filter((p) => chosen.has(p.id)).map((p) => p.email);

  const confirm = () => onConfirm({
    groupIds: mode === 'groups' ? groupIds : [],
    emails: mode === 'pick' ? emailsForPick() : null,
    isResend,
    dbOnly,
  });

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="send-title"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal">
        <header>
          <h2 id="send-title">{dbOnly ? 'Update the website only?' : (isResend ? 'Resend this blast?' : 'Send this blast?')}</h2>
          <p className="lede">
            This goes out immediately and cannot be recalled. Check the audience and the
            subject line below.
          </p>
        </header>

        <div className="body">
          <div className="recap">
            <div><dt>Subject</dt><dd>{isResend ? `[RESENT] ${email?.subject}` : email?.subject}</dd></div>
            <div><dt>Draw</dt><dd>{label}</dd></div>
            <div><dt>Date</dt><dd>{longDate(date)}</dd></div>
            <div>
              <dt>Recipients</dt>
              <dd>{count === null ? 'counting…' : `${count} address${count === 1 ? '' : 'es'}`}</dd>
            </div>
          </div>

          {/* database-only option */}
          <label className="dbonly-toggle">
            <input type="checkbox" checked={dbOnly} onChange={(e) => setDbOnly(e.target.checked)} />
            <span>
              <strong>Update the website/database only</strong> — push these results to the
              website without emailing anyone. Use this to correct or backfill the site when no
              email blast is needed.
            </span>
          </label>

          {/* audience mode */}
          <div style={{ marginTop: 18, opacity: dbOnly ? 0.4 : 1, pointerEvents: dbOnly ? 'none' : 'auto' }}>
            <div className="minihead">Audience</div>
            <div className="seg" role="tablist" style={{ marginBottom: 10 }}>
              <button role="tab" aria-selected={mode === 'everyone'} onClick={() => setMode('everyone')}>Everyone</button>
              <button role="tab" aria-selected={mode === 'groups'} onClick={() => setMode('groups')}>Groups</button>
              <button role="tab" aria-selected={mode === 'pick'} onClick={() => setMode('pick')}>Pick addresses</button>
            </div>

            {mode === 'groups' && (
              <div className="multix-picker">
                {groups.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>No groups yet</span>}
                {groups.map((g) => (
                  <button key={g.id} type="button" aria-pressed={groupIds.includes(g.id)} onClick={() => toggleGroup(g.id)}>
                    {g.name}
                  </button>
                ))}
              </div>
            )}

            {mode === 'pick' && (
              <div>
                <input type="search" placeholder="Search addresses" value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: '100%', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 8, marginBottom: 8 }} />
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
                  {people === null && <p style={{ padding: 12, color: 'var(--ink-3)', margin: 0 }}>Loading…</p>}
                  {people && shown.length === 0 && <p style={{ padding: 12, color: 'var(--ink-3)', margin: 0 }}>No matches.</p>}
                  {shown.map((p) => (
                    <label key={p.id} className="pickrow">
                      <input type="checkbox" checked={chosen.has(p.id)} onChange={() => togglePerson(p.id)} />
                      <span>{p.full_name ? `${p.full_name} · ` : ''}{p.email}</span>
                    </label>
                  ))}
                </div>
                {chosen.size > 0 && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-2)' }}>
                    {chosen.size} address{chosen.size === 1 ? '' : 'es'} chosen.
                  </p>
                )}
              </div>
            )}

            <p style={{ margin: '9px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
              Recipients are BCC'd, so nobody sees anyone else's address. Inactive,
              unsubscribed and bounced addresses are skipped.
            </p>
          </div>

          {/* resend flag */}
          {!dbOnly && (
          <label className="resend-toggle">
            <input type="checkbox" checked={isResend} onChange={(e) => setIsResend(e.target.checked)} />
            <span>
              <strong>This is a resend</strong> — corrects results already sent. The subject and
              a banner will be marked <em>RESENT</em> so recipients know it supersedes the earlier email.
            </span>
          </label>
          )}

          {warnings.length > 0 && (
            <div className="notice warn" style={{ marginTop: 16, marginBottom: 0 }}>
              <div>
                <strong>Going out with gaps</strong>
                <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            </div>
          )}

          {count === 0 && mode !== 'pick' && (
            <div className="notice error" style={{ marginTop: 16, marginBottom: 0 }}>
              No active addresses match this audience. Add recipients or pick another group.
            </div>
          )}

          <div className="confirmtype">
            <label htmlFor="confirm-send">Type {confirmWord} to confirm</label>
            <input
              id="confirm-send" ref={first} value={typed} autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ready) confirm(); }}
              placeholder={confirmWord}
            />
          </div>
        </div>

        {busy && progress && (
          <div className="notice" style={{ margin: '0 0 4px' }}>
            <div>
              Sending… <strong>{progress.sent} of {progress.total}</strong> so far.
              This continues on the server even if you close the window.
            </div>
          </div>
        )}

        <footer>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {busy ? 'Close (send continues)' : 'Cancel'}
          </button>
          <button className="btn send" disabled={!ready} onClick={confirm}>
            {busy ? (dbOnly ? 'Updating…' : 'Sending…') : (dbOnly ? 'Update website' : `${isResend ? 'Resend' : 'Send'} to ${count ?? 0}`)}
          </button>
        </footer>
      </div>
    </div>
  );
}
