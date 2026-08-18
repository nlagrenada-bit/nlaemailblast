import React, { useState } from 'react';

/** Live preview of the exact bytes that will be sent. */
export default function Preview({ email, warnings = [], errors = [], children }) {
  const [mode, setMode] = useState('html');

  return (
    <section className="side">
      <header className="pv">
        <h2 style={{ padding: 0, margin: 0 }}>Preview</h2>
        <div className="seg" style={{ marginLeft: 'auto' }}>
          <button type="button" aria-pressed={mode === 'html'} onClick={() => setMode('html')}>HTML</button>
          <button type="button" aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Plain text</button>
        </div>
      </header>

      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 }}>Subject</div>
        <div style={{ fontWeight: 600, marginTop: 3, lineHeight: 1.4 }}>{email?.subject || '—'}</div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div style={{ padding: '12px 18px 0' }}>
          {errors.length > 0 && (
            <div className="notice error">
              <div>
                <strong>Fix before sending</strong>
                <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="notice warn">
              <div>
                <strong>Worth a check</strong>
                <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'html'
        ? <iframe className="pv-frame" title="Email preview" srcDoc={email?.html || ''} sandbox="" />
        : <pre className="pv-text">{email?.text || ''}</pre>}

      {children}
    </section>
  );
}
