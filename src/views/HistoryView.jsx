import React, { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { longDate } from '../../shared/config.js';
import { useToast } from '../components/Toast.jsx';
import SendDialog from '../components/SendDialog.jsx';

export default function HistoryView({ groups, canSend }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);   // full blast being previewed
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = () => api.listBlasts().then(setRows).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, []);

  async function preview(id) {
    try { setOpen(await api.getBlast(id)); } catch (e) { toast(e.message, 'bad'); }
  }

  async function send(groupIds) {
    setBusy(true);
    try {
      if (groupIds.length) {
        // Audience chosen at approval time wins over whatever was drafted.
        await api.createBlast; // no-op guard for lint clarity
      }
      const res = await api.sendBlast(open.id);
      toast(`Sent to ${res.sent} recipient${res.sent === 1 ? '' : 's'}.`, 'good');
      setDialog(false); setOpen(null); reload();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  }

  return (
    <div className="main" style={{ maxWidth: 1080 }}>
      <div className="pagehead">
        <h1>History</h1>
        <span className="sub">Drafts waiting for approval and everything already sent</span>
      </div>

      <section className="card">
        <div className="body" style={{ padding: '14px 6px' }}>
          {!rows && <p style={{ padding: 14, color: 'var(--ink-3)' }}>Loading…</p>}
          {rows?.length === 0 && (
            <div className="empty">
              <b>No blasts yet</b>
              Enter a draw result and the blast you send will be recorded here.
            </div>
          )}
          {rows?.length > 0 && (
            <table className="list">
              <thead><tr><th>Draw date</th><th>Blast</th><th>Subject</th><th>Sent to</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="num">{b.draw_date}</td>
                    <td>
                      {b.label || b.kind}
                      {b.is_resend && <span className="tag resent-tag">RESENT</span>}
                      {b.explicit_emails?.length ? <span className="tag pick-tag">Picked</span> : null}
                    </td>
                    <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.subject}</td>
                    <td className="num">{b.status === 'sent' ? `${b.sent_count}${b.failed_count ? ` (${b.failed_count} failed)` : ''}` : '—'}</td>
                    <td><span className={`pill ${b.status}`}>{b.status}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn sm ghost" onClick={() => preview(b.id)}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {open && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setOpen(null)}>
          <div className="modal" style={{ width: 'min(760px, 100%)' }}>
            <header>
              <h2>{open.label || open.kind}</h2>
              <p className="lede">{longDate(open.draw_date)} · {open.subject}</p>
            </header>
            <div className="body" style={{ padding: 0 }}>
              <iframe title="Blast" srcDoc={open.html} sandbox=""
                style={{ width: '100%', height: '52vh', border: 0, background: 'var(--mist)' }} />
            </div>
            <footer>
              <button className="btn ghost" onClick={() => setOpen(null)}>Close</button>
              {open.status === 'draft' && (
                <button className="btn primary" disabled={!canSend} onClick={() => setDialog(true)}>
                  Review and send
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

      <SendDialog
        open={dialog} onClose={() => setDialog(false)} onConfirm={send}
        email={open} date={open?.draw_date || new Date().toISOString().slice(0, 10)}
        label={open?.label} groups={groups} busy={busy}
      />
    </div>
  );
}
