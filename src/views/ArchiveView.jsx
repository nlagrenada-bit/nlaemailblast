import React, { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { longDate } from '../../shared/config.js';
import { useToast } from '../components/Toast.jsx';

/**
 * Browse and re-send past results. Two ways in:
 *  - by date: pick any day that has results and jump to the Results view for it
 *  - by draw number: type a game's draw number and jump straight to its day
 *
 * The actual entry/preview/send all happens in the Results view — Archive is
 * just a finder, so there's one place that builds and sends a blast, past or
 * present.
 */
export default function ArchiveView({ onOpenDate }) {
  const toast = useToast();
  const [dates, setDates] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [game, setGame] = useState('play_way');
  const [drawNo, setDrawNo] = useState('');
  const [finding, setFinding] = useState(false);

  const load = () => api.listResultDates({ from: from || undefined, to: to || undefined })
    .then(setDates).catch((e) => toast(e.message, 'bad'));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function findDraw(e) {
    e.preventDefault();
    if (!drawNo.trim()) return;
    setFinding(true);
    try {
      const hit = await api.findByDrawNo(game, drawNo.trim());
      if (!hit) { toast(`No ${GAME_LABEL[game]} draw #${drawNo} found.`, 'info'); return; }
      toast(`Draw #${drawNo} is ${longDate(hit.date)}. Opening it.`, 'good');
      onOpenDate(hit.date);
    } catch (err) { toast(err.message, 'bad'); } finally { setFinding(false); }
  }

  // group dates by year-month for a tidy browse
  const grouped = {};
  for (const d of dates || []) {
    const ym = d.slice(0, 7);
    (grouped[ym] ||= []).push(d);
  }

  return (
    <div className="main" style={{ maxWidth: 1000 }}>
      <div className="pagehead">
        <h1>Archive</h1>
        <span className="sub">Send results for any past draw, by date or draw number</span>
      </div>

      <section className="card">
        <header><h3>Find by draw number</h3></header>
        <div className="body">
          <form className="row" onSubmit={findDraw} style={{ alignItems: 'flex-end' }}>
            <div className="field">
              <label>Game</label>
              <select value={game} onChange={(e) => setGame(e.target.value)}
                style={{ padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8 }}>
                {Object.entries(GAME_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Draw number</label>
              <input className="money" type="text" inputMode="numeric" value={drawNo}
                placeholder="e.g. 12960" onChange={(e) => setDrawNo(e.target.value.replace(/\D/g, ''))}
                style={{ width: 160 }} />
            </div>
            <button className="btn primary" type="submit" disabled={finding || !drawNo.trim()}>
              {finding ? 'Finding…' : 'Open draw'}
            </button>
          </form>
        </div>
      </section>

      <section className="card">
        <header>
          <h3>Browse by date</h3>
          <div className="hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date"
              style={{ padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 7 }} />
            <span>to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date"
              style={{ padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 7 }} />
            <button className="btn sm" onClick={load}>Apply</button>
          </div>
        </header>
        <div className="body">
          {!dates && <p style={{ color: 'var(--ink-3)' }}>Loading…</p>}
          {dates && dates.length === 0 && (
            <div className="empty"><b>No results in range</b>Widen the dates, or import history first.</div>
          )}
          {Object.entries(grouped).map(([ym, ds]) => (
            <div key={ym} style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em',
                color: 'var(--ink-3)', textTransform: 'uppercase', marginBottom: 8 }}>
                {monthLabel(ym)}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ds.map((d) => (
                  <button key={d} className="btn sm" onClick={() => onOpenDate(d)}
                    title={`Open ${longDate(d)}`}>
                    {Number(d.slice(8, 10))}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const GAME_LABEL = {
  play_way: 'Play Way', pick3: 'Daily Pick 3', cash4: 'Daily Cash 4',
  cash_pop: 'Cash Pop', lotto: 'Lotto', super6: 'Super 6',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
