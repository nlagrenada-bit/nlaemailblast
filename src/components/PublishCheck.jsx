import React, { useState } from 'react';
import * as api from '../lib/api.js';
import { todayLocal, shiftDate } from '../lib/dates.js';

// Website publishing check.
//
// Runs on the server with the real Netlify settings, so it sees exactly what a
// real push sees. Read-only: nothing is written to either website.

const LABEL = {
  play_way: 'Play Way', pick3: 'Pick 3', cash4: 'Cash 4',
  cash_pop: 'Cash Pop', lotto: 'Lotto', super6: 'Super 6',
};

const MARK = { pass: '✓', fail: '✕', warn: '!', info: 'i' };
const COLOUR = {
  pass: { fg: '#1c6b34', bg: '#eaf6ec' },
  fail: { fg: '#8f1a15', bg: '#fdeceb' },
  warn: { fg: '#6b4200', bg: '#fff6e0' },
  info: { fg: '#12489e', bg: '#e8f1fd' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function Line({ l }) {
  const c = COLOUR[l.status] || COLOUR.info;
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line, #e5e9f0)' }}>
      <span aria-label={l.status} style={{
        flex: '0 0 22px', height: 22, borderRadius: 11, background: c.bg, color: c.fg,
        display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12,
      }}>{MARK[l.status] || 'i'}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5, color: l.status === 'fail' ? c.fg : 'var(--ink, #16202f)' }}>{l.title}</div>
        {l.detail && <div style={{ fontSize: 12.5, color: 'var(--ink-2, #5a6b84)', marginTop: 2, wordBreak: 'break-word' }}>{l.detail}</div>}
        {l.fix && <div style={{ fontSize: 12.5, marginTop: 4, color: '#12489e' }}><strong>What to do:</strong> {l.fix}</div>}
      </div>
    </div>
  );
}

function Group({ title, lines }) {
  if (!lines?.length) return null;
  const fails = lines.filter((l) => l.status === 'fail').length;
  const warns = lines.filter((l) => l.status === 'warn').length;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>{title}</h4>
        <span style={{ fontSize: 12, color: fails ? '#8f1a15' : warns ? '#6b4200' : '#1c6b34' }}>
          {fails ? `${fails} problem${fails > 1 ? 's' : ''}` : warns ? `${warns} warning${warns > 1 ? 's' : ''}` : 'OK'}
        </span>
      </div>
      <div style={{ marginTop: 4 }}>{lines.map((l, i) => <Line key={i} l={l} />)}</div>
    </div>
  );
}

/** The whole report as plain text, to paste into an email or chat. */
function asText(date, groups) {
  const out = [`NLA Results Desk: website publishing check for ${date}`, `Run ${new Date().toLocaleString()}`, ''];
  for (const [title, lines] of groups) {
    if (!lines?.length) continue;
    out.push(`== ${title}`);
    for (const l of lines) {
      out.push(`[${l.status.toUpperCase()}] ${l.title}`);
      if (l.detail) out.push(`    ${l.detail}`);
      if (l.fix) out.push(`    What to do: ${l.fix}`);
    }
    out.push('');
  }
  return out.join('\n');
}

export default function PublishCheck() {
  const [date, setDate] = useState(todayLocal());
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState('');
  const [report, setReport] = useState(null);   // { overview, games: {game: lines} }
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [wpLines, setWpLines] = useState(null);
  const [wpBusy, setWpBusy] = useState('');

  async function run() {
    setRunning(true); setError(''); setReport(null); setCopied(false); setWpLines(null);
    try {
      setStep('Checking settings, the day’s results and the WordPress site…');
      const ov = await api.publishCheck(date);
      const games = {};
      setReport({ overview: ov, games: { ...games } });

      if (ov.ompConfigured) {
        // Every game is checked so a portal-wide fault (firewall, token) shows
        // even on a day with nothing entered for some games.
        const order = ov.games.length ? ov.games : ['lotto'];
        for (const g of order) {
          setStep(`Checking ${LABEL[g] || g} on the OMP portal…`);
          try {
            const r = await api.publishCheck(date, g);
            games[g] = r.lines;
          } catch (e) {
            games[g] = [{ status: 'fail', title: `${LABEL[g] || g}: check failed`, detail: e.message, fix: '' }];
          }
          setReport({ overview: ov, games: { ...games } });
          await sleep(400);   // stay well inside the portal's 30 requests a minute
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false); setStep('');
    }
  }

  const s = report?.overview?.sections;
  const ompLines = report ? Object.values(report.games).flat() : [];
  const groups = s ? [
    ['1. Netlify settings', s.config],
    ['2. Results in the app', s.data],
    ['3. OMP portal (about.nla.gd)', ompLines],
    ['4. WordPress site', s.wordpress],
    ['5. Recent sends for this day', s.history],
    ...(wpLines ? [['6. WordPress real send', wpLines]] : []),
  ] : [];
  const all = groups.flatMap(([, l]) => l || []);
  const fails = all.filter((l) => l.status === 'fail').length;
  const warns = all.filter((l) => l.status === 'warn').length;

  async function wpAction(action) {
    if (action === 'wp-resend' && !window.confirm(
      `Send every result for ${date} to the WordPress site again?\n\nUse this when the site is missing draws that the app shows as sent. Results already there are simply overwritten with the same values.`)) return;
    setWpBusy(action); setError('');
    try {
      const r = await api.publishAction(date, action);
      setWpLines(r.lines || []);
    } catch (e) { setError(e.message); } finally { setWpBusy(''); }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText(date, groups));
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch { setError('Could not copy. Select the report and copy it by hand.'); }
  }

  return (
    <section className="card">
      <header><h3>Website publishing check</h3><span className="hint">Is the data getting through, and if not, why</span></header>
      <div className="body">
        <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          Checks one day from the server, using the same settings, token and network a real
          update uses. It reads back what each website holds, compares it with the app, and for
          anything missing asks the OMP portal for a <strong>dry run</strong> that returns its exact
          reason for refusing. <strong>Nothing is published or changed.</strong>
        </p>
        <div className="row" style={{ alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <div className="field">
            <label>Day to check</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button className="btn sm" onClick={() => setDate(shiftDate(date, -1))} disabled={running}>Previous day</button>
          <button className="btn sm" onClick={() => setDate(todayLocal())} disabled={running}>Today</button>
          <button className="btn primary" onClick={run} disabled={running || !date}>
            {running ? 'Checking…' : 'Run check'}
          </button>
          {report && !running && (
            <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy report'}</button>
          )}
        </div>

        {running && step && <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-3)' }}>{step}</p>}
        {error && <div className="notice error" style={{ marginTop: 14 }}><div>{error}</div></div>}

        {report && !running && (
          <div className={`notice ${fails ? 'error' : warns ? 'warn' : 'info'}`} style={{ marginTop: 14 }}>
            <div>
              {fails
                ? <><strong>{fails} problem{fails > 1 ? 's' : ''} found.</strong> Start with the first red item; later ones are often caused by it.</>
                : warns
                  ? <><strong>No blocking problems,</strong> but {warns} thing{warns > 1 ? 's' : ''} to look at.</>
                  : <><strong>All clear.</strong> Both websites are reachable and everything checked for {date} is published and matches.</>}
            </div>
          </div>
        )}

        {groups.map(([title, lines]) => <Group key={title} title={title} lines={lines} />)}

        {report && !running && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line, #e5e9f0)' }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>WordPress: real send</h4>
            <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              The check above cannot prove WordPress stored anything. <strong>Test</strong> sends the latest
              draw of this day again, with the same values, and shows exactly what the site replied.
              {' '}<strong>Resend the day</strong> sends every result for this day to WordPress again, even
              ones the app thinks are already there. Both are approver/admin only.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => wpAction('wp-test')} disabled={!!wpBusy}>
                {wpBusy === 'wp-test' ? 'Sending\u2026' : 'Test WordPress with one real send'}
              </button>
              <button className="btn" onClick={() => wpAction('wp-resend')} disabled={!!wpBusy}>
                {wpBusy === 'wp-resend' ? 'Resending\u2026' : 'Resend this day to WordPress'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
