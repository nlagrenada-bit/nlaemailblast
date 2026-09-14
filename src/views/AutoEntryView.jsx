import React, { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { longDate, MULTIPLIERS } from '../../shared/config.js';

/**
 * Assisted entry.
 *
 * Reads the latest results from play.nla.gd, lines them up against what the app
 * holds, and lets an operator accept them rather than retype. It is deliberately
 * SEMI-automatic:
 *
 *   - nothing is written until someone presses Accept
 *   - a conflict must be resolved explicitly; it cannot be accepted in bulk
 *   - draw numbers are SUGGESTED from the app's own sequence, never taken from
 *     the page, because the page does not carry them
 *   - payouts are not on the page at all and are still entered here by hand
 *
 * The manual entry screen is untouched and remains the primary path.
 */

const STATUS = {
  new:       { label: 'New',       cls: 'st-new',   help: 'Not in the app yet' },
  match:     { label: 'Matches',   cls: 'st-ok',    help: 'Already entered and identical' },
  conflict:  { label: 'Conflict',  cls: 'st-bad',   help: 'The app and the site disagree' },
  published: { label: 'Published', cls: 'st-pub',   help: 'Already sent — changes are corrections' },
  other_day: { label: 'Other day', cls: 'st-mute',  help: 'Belongs to a different date' },
};

export default function AutoEntryView({ date, onEntered }) {
  // Use the app's existing toast host. Referencing a `toast` prop that App
  // never passed was throwing on render and blanking the page.
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [payouts, setPayouts] = useState({});
  const [drawNos, setDrawNos] = useState({});
  const [live, setLive] = useState(false);
  const [lastRead, setLastRead] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.autoEntry(date);
      setData(r);
      setLastRead(new Date());
      // Seed the editable fields from what the reconciliation suggested.
      const d = {};
      for (const i of r.items || []) {
        if (i.suggestedDrawNo) d[key(i)] = i.suggestedDrawNo;
      }
      setDrawNos(d);
    } catch (e) {
      toast(e.message, 'bad');
      setData(null);
    } finally { setLoading(false); }
  };

  useEffect(() => { setData(null); setPayouts({}); setLive(false); /* eslint-disable-next-line */ }, [date]);

  /* Live mode: re-read every 90 seconds so a draw appears here shortly after it
     is published, without anyone pressing the button.

     It only ever READS. Nothing is accepted, saved or sent automatically — the
     operator still decides, which is the whole point of this being assisted
     rather than automatic. */
  useEffect(() => {
    if (!live) return undefined;
    load();
    const t = setInterval(load, 90_000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [live, date]);

  const key = (i) => `${i.game}:${i.period || 'x'}:${i.drawDate}`;

  const accept = async (item) => {
    const k = key(item);
    const drawNo = Number(drawNos[k]);
    if (!drawNo) { toast('A draw number is needed before this can be accepted.', 'bad'); return; }

    setBusy(k);
    try {
      await api.acceptScraped({
        game: item.game, drawDate: item.drawDate, period: item.period,
        numbers: item.numbers, multiplier: item.multiplier, letter: item.letter,
        drawNo, payout: payouts[k] ?? null, jackpot: item.jackpot ?? null,
      });
      toast(`${item.label} accepted. Review it on the results page before sending.`, 'good');
      await load();
      onEntered?.();
    } catch (e) {
      toast(e.message, 'bad');
    } finally { setBusy(null); }
  };

  /* Accept every NEW row in one go. Refused outright while a conflict exists
     for the day: if the app and the site disagree about one draw, the others
     are not trustworthy enough to wave through in bulk. */
  const acceptAll = async () => {
    if (conflicts.length) {
      toast('Resolve the conflict first. Nothing is accepted in bulk while the app and the site disagree.', 'bad');
      return;
    }
    const missing = actionable.filter((i) => !Number(drawNos[key(i)]));
    if (missing.length) {
      toast(`${missing.map((m) => m.label).join(', ')} still needs a draw number.`, 'bad');
      return;
    }
    setBusy('all');
    let done = 0;
    try {
      for (const item of actionable) {
        const k = key(item);
        await api.acceptScraped({
          game: item.game, drawDate: item.drawDate, period: item.period,
          numbers: item.numbers, multiplier: item.multiplier, letter: item.letter,
          drawNo: Number(drawNos[k]), payout: payouts[k] ?? null,
          jackpot: item.jackpot ?? null,
        });
        done += 1;
      }
      toast(`${done} result${done === 1 ? '' : 's'} accepted. Review and send from the Results page.`, 'good');
      await load();
    } catch (e) {
      toast(`Stopped after ${done}: ${e.message}`, 'bad');
      await load();
    } finally { setBusy(null); }
  };

  const items = data?.items || [];
  const actionable = items.filter((i) => i.status === 'new');
  const conflicts  = items.filter((i) => i.status === 'conflict');

  return (
    <div className="main auto-entry" style={{ maxWidth: 900 }}>
      <div className="pagehead">
        <h1>Assisted entry</h1>
        <span className="sub">{longDate(date)}</span>
        <div className="auto-controls">
          <label className={`livetoggle${live ? ' on' : ''}`}
            title="Re-read play.nla.gd every 90 seconds. Reads only — nothing is accepted or sent automatically.">
            <input type="checkbox" checked={live}
              onChange={(e) => setLive(e.target.checked)} />
            <span className="dot" />
            Live
          </label>
          <button className="btn primary" onClick={load} disabled={loading}>
            {loading ? 'Reading…' : 'Read now'}
          </button>
        </div>
      </div>

      <div className="notice info">
        <div>
          <strong>This is a helper, not an automatic publisher.</strong> Results are
          read from play.nla.gd and lined up against the app. Nothing is written
          until you accept it, nothing is sent, and payouts and draw numbers are
          not on that page — the draw number is suggested from the app's own
          sequence and payouts are still entered here.
        </div>
      </div>

      {!data && !loading && (
        <p className="muted">Press the button above to read the current results.</p>
      )}

      {data && (
        <>
          <div className="auto-summary">
            <span className="muted">
              Read at {lastRead ? lastRead.toLocaleTimeString() : new Date(data.fetchedAt).toLocaleTimeString()}
              {live && ' · re-reading every 90 seconds'}
              {' · '}{actionable.length} new, {conflicts.length} conflict
              {conflicts.length === 1 ? '' : 's'}
            </span>

            {actionable.length > 0 && (
              <button className="btn primary sm" onClick={acceptAll}
                disabled={busy === 'all' || conflicts.length > 0}
                title={conflicts.length
                  ? 'Resolve the conflict first'
                  : `Accept all ${actionable.length} new result(s)`}>
                {busy === 'all' ? 'Accepting…' : `Accept all ${actionable.length}`}
              </button>
            )}

            <a className="btn sm" href={`?tab=results&date=${date}`}
               onClick={(e) => { e.preventDefault();
                 window.history.pushState({}, '', `?tab=results&date=${date}`);
                 window.dispatchEvent(new PopStateEvent('popstate')); }}>
              Review and send →
            </a>
          </div>

          {conflicts.length > 0 && (
            <div className="notice error">
              <div>
                <strong>Resolve these before publishing anything for this day.</strong>
                {' '}The app and play.nla.gd disagree. One of them is wrong, and a
                wrong result reaching the media cannot be recalled.
              </div>
            </div>
          )}

          {data.problems?.length > 0 && (
            <div className="notice warn">
              <div>
                <strong>Could not read everything</strong>
                <ul>{data.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            </div>
          )}

          <div className="scrape-list">
            {items.map((i) => {
              const k = key(i);
              const st = STATUS[i.status] || STATUS.match;
              return (
                <div className={`scrape-row ${st.cls}`} key={k}>
                  <div className="scrape-head">
                    <b>{i.label}</b>
                    <span className="slot">
                      {i.drawDate}{i.time ? ` · ${i.time}` : ''}
                    </span>
                    <span className={`pill ${st.cls}`} title={st.help}>{st.label}</span>
                  </div>

                  <div className="scrape-nums">
                    {i.numbers.map((n, idx) => (
                      <span className="num" key={idx}>
                        {i.game === 'lotto' || i.game === 'super6'
                          ? String(n).padStart(2, '0') : n}
                      </span>
                    ))}
                    {i.multiplier && <span className="mx">{i.multiplier}</span>}
                    {i.letter && <span className="letter">{i.letter}</span>}
                    {i.jackpot != null && (
                      <span className="jp">jackpot ${i.jackpot.toLocaleString()}</span>
                    )}
                  </div>

                  {i.status === 'conflict' && (
                    <ul className="diffs">
                      {i.diffs.map((d) => <li key={d}>{d}</li>)}
                    </ul>
                  )}

                  {i.status === 'new' && (
                    <div className="scrape-actions">
                      <label>
                        Draw no.
                        <input type="number" value={drawNos[k] ?? ''}
                          onChange={(e) => setDrawNos((s) => ({ ...s, [k]: e.target.value }))} />
                        {i.lastDrawNo && (
                          <span className="hint">last was {i.lastDrawNo}</span>
                        )}
                      </label>
                      <label>
                        Payout
                        <input type="text" inputMode="decimal" placeholder="optional"
                          value={payouts[k] ?? ''}
                          onChange={(e) => setPayouts((s) => ({ ...s, [k]: e.target.value }))} />
                      </label>
                      <button className="btn primary sm" disabled={busy === k}
                        onClick={() => accept(i)}>
                        {busy === k ? 'Saving…' : 'Accept'}
                      </button>
                    </div>
                  )}

                  {i.status === 'other_day' && <p className="muted sm">{i.note}</p>}
                </div>
              );
            })}
          </div>

          <div className="notice warn" style={{ marginTop: 18 }}>
            <div>
              <strong>Accepting does not publish.</strong> Accepted results are saved
              as normal entries. Open the results page, add anything missing, and
              send from there as usual.
            </div>
          </div>
        </>
      )}

    </div>
  );
}
