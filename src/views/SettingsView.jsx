import React, { useState } from 'react';
import { LETTERS, DEFAULT_LETTER_WORDS } from '../../shared/config.js';
import * as api from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { Ball } from '../components/Ball.jsx';

export default function SettingsView({ settings, onChanged }) {
  const toast = useToast();
  const [words, setWords] = useState({ ...DEFAULT_LETTER_WORDS, ...(settings.letter_words || {}) });
  const [greeting, setGreeting] = useState(settings.greeting || 'Dear All,');
  const [footer, setFooter] = useState(settings.footer || '');
  const [eodMode, setEodMode] = useState(settings.eod_mode || 'draft');
  const [testTo, setTestTo] = useState('info@nla.gd');
  const [testing, setTesting] = useState(false);

  async function save(key, value) {
    try { await api.saveSetting(key, value); onChanged(); toast('Saved.', 'good'); }
    catch (e) { toast(e.message, 'bad'); }
  }

  async function runTest() {
    setTesting(true);
    try {
      const r = await api.sendTestEmail(testTo);
      toast(`Test sent to ${r.to}. Check that inbox.`, 'good');
    } catch (e) { toast(e.message, 'bad'); } finally { setTesting(false); }
  }

  return (
    <div className="main" style={{ maxWidth: 900 }}>
      <div className="pagehead"><h1>Settings</h1></div>

      <section className="card">
        <header><h3>Sending address</h3><span className="hint">Where blasts are sent from</span></header>
        <div className="body">
          <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            The from-address is set on the server (the <code>MAIL_FROM</code> and SMTP settings in
            Netlify) so credentials never reach the browser. Most likely <strong>info@nla.gd</strong>.
            Use the test below to confirm the address is working before sending a real blast.
          </p>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field">
              <label>Send a test to</label>
              <input type="email" value={testTo} placeholder="info@nla.gd"
                onChange={(e) => setTestTo(e.target.value)} style={{ minWidth: 240 }} />
            </div>
            <button className="btn primary" onClick={runTest} disabled={testing || !testTo.trim()}>
              {testing ? 'Sending…' : 'Send test email'}
            </button>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>
            A short test message goes to that address through the live mail path. If it arrives,
            the sending address and SMTP credentials are correct.
          </p>
        </div>
      </section>

      <section className="card">
        <header><h3>Free ticket letters</h3><span className="hint">Reads as “G as in GRAND”</span></header>
        <div className="body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12 }}>
            {LETTERS.map((L) => (
              <div key={L} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Ball value={L} style="letter" small />
                <input type="text" value={words[L] || ''} aria-label={`Word for letter ${L}`}
                  onChange={(e) => setWords({ ...words, [L]: e.target.value.toUpperCase() })}
                  style={{ flex: 1, minWidth: 0, padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8 }} />
              </div>
            ))}
          </div>
          <button className="btn primary" style={{ marginTop: 16 }} onClick={() => save('letter_words', words)}>
            Save letters
          </button>
        </div>
      </section>

      <section className="card">
        <header><h3>Standard wording</h3></header>
        <div className="body">
          <div className="field" style={{ marginBottom: 16 }}>
            <label>Greeting</label>
            <input type="text" value={greeting} onChange={(e) => setGreeting(e.target.value)}
              onBlur={() => save('greeting', greeting)} style={{ maxWidth: 320 }} />
          </div>
          <div className="field">
            <label>Footer</label>
            <textarea className="plain" value={footer} onChange={(e) => setFooter(e.target.value)}
              onBlur={() => save('footer', footer)} style={{ width: '100%', minHeight: 90 }} />
          </div>
        </div>
      </section>

      <section className="card">
        <header><h3>Nightly complete-day blast</h3></header>
        <div className="body">
          <div className="multix-picker">
            <button type="button" aria-pressed={eodMode === 'draft'}
              onClick={() => { setEodMode('draft'); save('eod_mode', 'draft'); }}>
              Stage a draft for approval
            </button>
            <button type="button" aria-pressed={eodMode === 'send'}
              onClick={() => { setEodMode('send'); save('eod_mode', 'send'); }}>
              Send automatically
            </button>
          </div>
          <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            The job runs at 9:00pm, Monday to Saturday. On <b>stage a draft</b> it builds the
            complete day results, emails the desk to say it is ready, and waits for someone to
            press send. On <b>send automatically</b> it goes out unattended — only choose this
            once you trust the day's entries to be complete by 9:00pm.
          </p>
        </div>
      </section>
    </div>
  );
}
