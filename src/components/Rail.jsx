import React from 'react';
import { DAILY_PERIODS, CASH_POP_PERIODS } from '../../shared/config.js';
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
  stops.sort((a, b) => toMinutes(a.time) - toMinutes(b.time));

  if (scheduled.lotto) {
    stops.push({
      key: 'lotto', kind: 'lotto', code: 'lotto', name: 'Lotto Draw',
      time: '20:30', game: '5 from 34 · free ticket letter',
      entered: !!results.lotto,
    });
  }
  if (scheduled.super6) {
    stops.push({
      key: 'super6', kind: 'super6', code: 'super6', name: 'Super 6 Draw',
      time: '20:30', game: '6 from 28 · free ticket letter',
      entered: !!results.super6,
    });
  }

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
