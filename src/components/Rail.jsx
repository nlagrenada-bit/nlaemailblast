import React from 'react';
import { DAILY_PERIODS, CASH_POP_PERIODS, gamesScheduledOn } from '../../shared/config.js';
import { minutesNow, toMinutes, to12h } from '../lib/dates.js';

/**
 * The day, top to bottom, in the order the draws actually happen. Cash Pop and
 * the daily games interleave through the day, so they share one timeline
 * rather than sitting in separate lists — that matches how the desk works.
 */
export default function Rail({
  date, isToday, selected, onSelect, day, onDayChange, results, scheduled,
}) {
  const stops = [];

  if (scheduled.cash_pop) {
    for (const p of CASH_POP_PERIODS) {
      stops.push({
        key: `pop:${p.code}`, kind: 'pop', code: p.code,
        name: p.label, time: p.time, game: 'Cash Pop',
        entered: results.cashPops.some((r) => r.period === p.code && r.number != null),
      });
    }
  }
  if (scheduled.daily) {
    for (const p of DAILY_PERIODS) {
      const row = results.daily.find((r) => r.period === p.code);
      stops.push({
        key: `daily:${p.code}`, kind: 'daily', code: p.code,
        name: p.label, time: p.time, game: 'Play Way · Pick 3 · Cash 4',
        entered: !!(row?.play_way_number || row?.pick3_digits?.length || row?.cash4_digits?.length),
      });
    }
  }
  if (scheduled.lotto) {
    stops.push({
      key: 'lotto', kind: 'lotto', code: 'lotto', name: 'Lotto Draw',
      time: '19:45', game: '5 from 34 · free ticket letter',
      entered: !!results.lotto,
    });
  }
  if (scheduled.super6) {
    stops.push({
      key: 'super6', kind: 'super6', code: 'super6', name: 'Super 6 Draw',
      time: '19:45', game: '6 from 28 · free ticket letter',
      entered: !!results.super6,
    });
  }

  // Sorted only once every stop exists. Lotto and Super 6 draw at the same
  // time as the Evening daily draw, so ties fall back to a fixed order that
  // matches how the desk reads the day.
  const TIE = { daily: 0, pop: 1, lotto: 2, super6: 3 };
  stops.sort((a, b) =>
    (toMinutes(a.time) - toMinutes(b.time)) || (TIE[a.kind] - TIE[b.kind]));

  const now = minutesNow();
  const dueKey = isToday
    ? stops.find((s) => !s.entered && toMinutes(s.time) <= now + 15)?.key
    : null;

  const sentKinds = new Set(results.blasts.filter((b) => b.status === 'sent').map((b) => b.label));

  return (
    <aside className="rail">
      <h2>Day status</h2>
      <div className="daystate">
        <select
          value={day?.status || 'normal'}
          onChange={(e) => onDayChange({ status: e.target.value })}
          aria-label="Day status"
        >
          <option value="normal">Running normally</option>
          <option value="disrupted">Disrupted — some draws moved or dropped</option>
          <option value="cancelled">Cancelled — no draws today</option>
        </select>
        {day?.status && day.status !== 'normal' && (
          <textarea
            placeholder="What happened? This line appears at the top of every blast today."
            value={day.notice || ''}
            onChange={(e) => onDayChange({ notice: e.target.value })}
            aria-label="Disruption notice"
          />
        )}

        {day?.status === 'disrupted' && (
          <DayPlan day={day} isoDate={date} onDayChange={onDayChange} />
        )}
      </div>

      <hr />

      <h2>{isToday ? "Today's draws" : 'Draws this day'}</h2>
      <div className="timeline">
        {stops.length === 0 && (
          <p style={{ padding: '0 4px', color: 'var(--ink-3)', fontSize: 13 }}>
            No draws are scheduled. Change the day status if that is wrong.
          </p>
        )}
        {stops.map((s) => {
          const sent = sentKinds.has(s.name);
          return (
            <button
              key={s.key}
              className="stop"
              aria-current={selected === s.key}
              onClick={() => onSelect(s.key)}
            >
              <span className={`dot${sent ? ' sent' : s.entered ? ' entered' : ''}${dueKey === s.key ? ' due' : ''}`}>
                {sent ? '✓' : s.time.slice(0, 2)}
              </span>
              <span className="stop-body">
                <span className="stop-name">{s.name}</span>
                <span className="stop-meta">
                  {to12h(s.time)}
                  {sent ? <span className="tag sent">Sent</span>
                    : s.entered ? <span className="tag ready">Ready</span> : null}
                  {dueKey === s.key && !s.entered ? <span className="tag">Due now</span> : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <hr />

      <div className="railgroup">
        <h2>Whole day</h2>
        <div className="timeline">
          <button
            className="stop"
            aria-current={selected === 'eod'}
            onClick={() => onSelect('eod')}
          >
            <span className={`dot${sentKinds.has('Complete day results') ? ' sent' : ''}`}>∑</span>
            <span className="stop-body">
              <span className="stop-name">Complete day results</span>
              <span className="stop-meta">
                21:00
                {sentKinds.has('Complete day results') && <span className="tag sent">Sent</span>}
              </span>
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
}


/* -------------------------------------------------------------- day plan

   Which games run on a disrupted day. Each toggle is three-state:

     Normal  - follow the usual weekly schedule (stored as null)
     On      - run today even though it normally would not
     Off     - do not run today even though it normally would

   That third state is the point. Moving Tuesday's Super 6 to Wednesday is two
   edits: Off on the Tuesday, On on the Wednesday. Draw numbers are stored per
   game rather than derived from the date, so the moved draw keeps its correct
   sequence number.
*/

const PLAN_GAMES = [
  ['daily_on',    'Daily games',  'Play Way, Pick 3, Cash 4'],
  ['cash_pop_on', 'Cash Pop',     'five draws'],
  ['lotto_on',    'Lotto',        'normally Mon, Wed, Fri'],
  ['super6_on',   'Super 6',      'normally Tue, Fri'],
];

function DayPlan({ day, isoDate, onDayChange }) {
  // What the weekly schedule would do, so "Normal" can say which it means.
  const usual = gamesScheduledOn(isoDate, null);
  const usualFor = {
    daily_on: usual.daily, cash_pop_on: usual.cash_pop,
    lotto_on: usual.lotto, super6_on: usual.super6,
  };

  const set = (key, value) => onDayChange({ [key]: value });

  // Append a suggested sentence to the notice without disturbing what is
  // already written. The operator can then edit it freely, or delete it.
  const appendNotice = (text) => {
    const current = (day?.notice || '').trim();
    if (current.includes(text)) return;               // don't add it twice
    onDayChange({ notice: current ? `${current} ${text}` : text });
  };

  const changed = PLAN_GAMES.filter(([k]) => day?.[k] != null && day[k] !== usualFor[k]);

  return (
    <div className="dayplan">
      <div className="dayplan-head">Which games run today</div>

      {PLAN_GAMES.map(([key, label, hint]) => {
        const value = day?.[key];                 // null | true | false
        const normally = usualFor[key];
        return (
          <div className="dayplan-row" key={key}>
            <div className="dayplan-label">
              <b>{label}</b>
              <span>{hint}</span>
            </div>
            <div className="seg sm" role="group" aria-label={label}>
              <button type="button" aria-pressed={value == null}
                onClick={() => set(key, null)}
                title={`Follow the usual schedule (${normally ? 'runs' : 'does not run'} today)`}>
                Normal
              </button>
              <button type="button" aria-pressed={value === true}
                onClick={() => set(key, true)} title="Run today">
                On
              </button>
              <button type="button" aria-pressed={value === false}
                onClick={() => set(key, false)} title="Do not run today">
                Off
              </button>
            </div>
          </div>
        );
      })}

      {changed.length > 0 && (
        <div className="dayplan-note">
          <p style={{ margin: 0 }}>
            {changed.map(([k, label]) => (
              <span key={k}>
                <b>{label}</b> {day[k] ? 'added to' : 'removed from'} today.{' '}
              </span>
            ))}
            A move is two edits — set the matching change on the other day too.
          </p>

          {/* Optional wording. The notice above is free text and whatever the
              operator writes always wins; these just save typing. Nothing is
              inserted unless one is clicked. */}
          <div className="dayplan-suggest">
            <span>Add to the notice:</span>
            {changed.map(([key, label]) => {
              const k = key;
              // "Daily games" is plural, so it needs different phrasing from
              // the single-draw games.
              const plural = key === 'daily_on';
              const text = day[k]
                ? (plural
                    ? 'Includes the rescheduled daily draws.'
                    : `Includes the rescheduled ${label} draw.`)
                : (plural
                    ? "Today's daily draws have been rescheduled."
                    : `Today's ${label} draw has been rescheduled.`);
              return (
                <button key={k} type="button" onClick={() => appendNotice(text)}
                  title="Adds this sentence to the notice. You can edit it afterwards.">
                  {text}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
