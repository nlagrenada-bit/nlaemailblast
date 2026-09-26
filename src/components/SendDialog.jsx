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
  open, onClose, onConfirm, email, date, label, groups, warnings = [], blocking = [], mismatches = [], verifying = false, verifiedCount = 0, busy, progress,
}) {
  const [mode, setMode] = useState('everyone');    // 'everyone' | 'groups' | 'pick'
  const [groupIds, setGroupIds] = useState([]);
  const [people, setPeople] = useState(null);      // for 'pick' mode
  const [chosen, setChosen] = useState(new Set());
  const [search, setSearch] = useState('');
  const [count, setCount] = useState(null);
  const [isResend, setIsResend] = useState(false);
  // both (default) | website | email
  const [action, setAction] = useState('both');
  const dbOnly = action === 'website';          // no email at all
  const emailing = action !== 'website';
  const [typed, setTyped] = useState('');
  const [finalCheck, setFinalCheck] = useState(null);   // gaps awaiting a last look
  const first = useRef(null);

  useEffect(() => {
    if (!open) {
      setTyped(''); setMode('everyone'); setGroupIds([]);
      setChosen(new Set()); setSearch(''); setIsResend(false); setAction('both');
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

  const confirmWord = action === 'website' ? 'UPDATE' : (isResend ? 'RESEND' : 'SEND');
  const ready = typed.trim().toUpperCase() === confirmWord
    && (dbOnly || count > 0) && !busy && !verifying;

  // What we hand back: the group filter (or null), the explicit email list (or
  // null for group/everyone mode), the resend flag, and whether to skip email
  // and only update the website/database.
  const emailsForPick = () =>
    (people || []).filter((p) => chosen.has(p.id)).map((p) => p.email);

  const doSend = () => onConfirm({
    groupIds: mode === 'groups' ? groupIds : [],
    emails: mode === 'pick' ? emailsForPick() : null,
    isResend,
    dbOnly,
    action,
  });

  /* Last gate. Typing the confirm word proves intent to send; this proves the
     operator has seen what is missing. A blast cannot be recalled, so anything
     incomplete gets one final, explicit look before it goes. */
  const confirm = () => {
    const gaps = [...mismatches, ...blocking, ...warnings];
    if (gaps.length === 0) return doSend();
    setFinalCheck(gaps);
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="send-title"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="modal">
        <header>
          <h2 id="send-title">{
            action === 'website' ? 'Update the websites?'
            : action === 'email' ? (isResend ? 'Resend the email?' : 'Send the email?')
            : (isResend ? 'Update the websites and resend?' : 'Update the websites and send?')
          }</h2>
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

          {/* What to do. Websites always go first when both are chosen: they are
              the public record, the push takes seconds, and a problem there is
              found before sixty emails go out rather than after. */}
          {/* One row rather than three stacked cards: the dialog has to fit
              without scrolling, and the Send button must stay reachable. The
              explanation moves to a single line that changes with the choice. */}
          <div className="minihead" style={{ marginTop: 14 }}>What to do</div>
          <div className="seg" role="radiogroup" aria-label="What to do">
            <button type="button" role="radio" aria-checked={action === 'both'}
              aria-selected={action === 'both'} onClick={() => setAction('both')}>
              Websites + email
            </button>
            <button type="button" role="radio" aria-checked={action === 'website'}
              aria-selected={action === 'website'} onClick={() => setAction('website')}>
              Websites only
            </button>
            <button type="button" role="radio" aria-checked={action === 'email'}
              aria-selected={action === 'email'} onClick={() => setAction('email')}>
              Email only
            </button>
          </div>
          <p className="actionhint">
            {action === 'both' ? 'Websites are updated first, then the email goes out.'
              : action === 'website' ? 'No email. For correcting or backfilling the sites.'
              : 'Websites untouched. For resending to someone who missed it.'}
          </p>

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

          {/* Where the play.nla.gd check stands. */}
          <div className={`verifyline ${verifying ? 'checking'
            : mismatches.length ? 'bad' : verifiedCount ? 'ok' : 'none'}`}>
            {verifying ? 'Checking against play.nla.gd…'
              : mismatches.length
                ? `Does not match play.nla.gd — ${mismatches.length} problem${mismatches.length === 1 ? '' : 's'}`
                : verifiedCount
                  ? `Matches play.nla.gd (${verifiedCount} checked)`
                  : 'Nothing could be checked against play.nla.gd'}
          </div>

          {mismatches.length > 0 && (
            <div className="notice error" style={{ marginTop: 12, marginBottom: 0 }}>
              <div>
                <strong>These do not match play.nla.gd</strong>
                <ul>{mismatches.map((w) => <li key={w}>{w}</li>)}</ul>
                <p style={{ margin: '8px 0 0' }}>
                  play.nla.gd is fed by the draw software. Check the numbers before
                  sending — one of the two is wrong.
                </p>
              </div>
            </div>
          )}

          {/* Where the play.nla.gd check stands. */}
          <div className={`verifyline ${verifying ? 'checking'
            : mismatches.length ? 'bad' : verifiedCount ? 'ok' : 'none'}`}>
            {verifying ? 'Checking against play.nla.gd…'
              : mismatches.length
                ? `Does not match play.nla.gd — ${mismatches.length} problem${mismatches.length === 1 ? '' : 's'}`
                : verifiedCount
                  ? `Matches play.nla.gd (${verifiedCount} checked)`
                  : 'Nothing could be checked against play.nla.gd'}
          </div>

          {mismatches.length > 0 && (
            <div className="notice error" style={{ marginTop: 12, marginBottom: 0 }}>
              <div>
                <strong>These do not match play.nla.gd</strong>
                <ul>{mismatches.map((w) => <li key={w}>{w}</li>)}</ul>
                <p style={{ margin: '8px 0 0' }}>
                  play.nla.gd is fed by the draw software. Check the numbers before
                  sending — one of the two is wrong.
                </p>
              </div>
            </div>
          )}

          {blocking.length > 0 && (
            <div className="notice error" style={{ marginTop: 16, marginBottom: 0 }}>
              <div>
                <strong>These will NOT reach the websites</strong>
                <ul>{blocking.map((w) => <li key={w}>{w}</li>)}</ul>
                <p style={{ margin: '8px 0 0' }}>
                  The email will still go out in full. Fix these and use
                  “Update the website/database only” afterwards, or cancel and
                  fix them now.
                </p>
              </div>
            </div>
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

        {finalCheck && (
          <div className="finalcheck">
            <h3>Send anyway?</h3>
            <p>
              {count > 0
                ? <>This goes to <strong>{count} recipient{count === 1 ? '' : 's'}</strong> and <strong>cannot be recalled</strong>.</>
                : <>This updates the public websites and <strong>cannot be undone</strong> from here.</>}
              {' '}The following is incomplete:
            </p>
            <ul>
              {mismatches.map((w) => (
                <li key={w}><span className="tagx mismatch">play.nla.gd</span>{w}</li>
              ))}
              {mismatches.map((w) => (
                <li key={w}><span className="tagx mismatch">play.nla.gd</span>{w}</li>
              ))}
              {blocking.map((w) => (
                <li key={w}><span className="tagx">websites</span>{w}</li>
              ))}
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
            <div className="finalcheck-actions">
              <button className="btn fix" onClick={() => setFinalCheck(null)} autoFocus>
                Go back and fix
              </button>
              <button className="btn anyway" onClick={() => { setFinalCheck(null); doSend(); }}>
                Send anyway
              </button>
            </div>
          </div>
        )}

        <footer>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            {busy ? 'Close (send continues)' : 'Cancel'}
          </button>
          <button className="btn send" disabled={!ready} onClick={confirm}
            title={verifying ? 'Waiting for the play.nla.gd check to finish' : undefined}>
            {busy ? (dbOnly ? 'Updating…' : 'Sending…') : (dbOnly ? 'Update website' : `${isResend ? 'Resend' : 'Send'} to ${count ?? 0}`)}
          </button>
        </footer>
      </div>
    </div>
  );
}
