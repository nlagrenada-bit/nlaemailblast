import { useEffect, useRef } from 'react';
import { DAILY_PERIODS, CASH_POP_PERIODS } from '../../shared/config.js';

/** Minutes since midnight in Grenada (UTC-4 all year). */
export function gdMinutesNow(now = new Date()) {
  const t = new Date(now.getTime() - 4 * 3600 * 1000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

export function gdToday(now = new Date()) {
  return new Date(now.getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/**
 * The draw the desk should be looking at right now: the one that has most
 * recently happened, because that is the one waiting to be entered.
 *
 * Before the day's first draw it is that first draw — the Kick-Off Pop at
 * 8:45am, not the 9:45am Mid-Morning Draw. Opening the app at eight in the
 * morning should land on the Pop that is about to happen.
 *
 * A short grace period means the slot appears a few minutes BEFORE the draw,
 * so the operator is already on the right screen when the result arrives.
 */
export function drawForTimeOfDay(scheduled, now = new Date(), graceMinutes = 3) {
  const mins = gdMinutesNow(now) + graceMinutes;
  const stops = [];

  if (scheduled?.daily) {
    for (const p of DAILY_PERIODS) stops.push({ key: `daily:${p.code}`, at: toMin(p.time) });
  }
  if (scheduled?.cash_pop) {
    for (const p of CASH_POP_PERIODS) stops.push({ key: `pop:${p.code}`, at: toMin(p.time) });
  }
  // Both jackpot games draw at 7:45pm, alongside the Evening daily draw.
  if (scheduled?.lotto)  stops.push({ key: 'lotto',  at: toMin('19:45'), rank: 1 });
  if (scheduled?.super6) stops.push({ key: 'super6', at: toMin('19:45'), rank: 2 });

  if (!stops.length) return null;

  // Time first, then rank, so a 7:45pm tie opens on the Evening draw (three
  // games, the natural starting point) rather than jumping to Super 6.
  stops.sort((a, b) => (a.at - b.at) || ((a.rank ?? 0) - (b.rank ?? 0)));

  const due = stops.filter((s) => s.at <= mins);
  if (!due.length) return stops[0].key;          // before the first draw of the day

  const latest = due[due.length - 1].at;
  return due.find((s) => s.at === latest).key;
}

/** True when the cursor is in a result field, so a refresh would disturb it. */
export function isTypingInResults() {
  const el = document.activeElement;
  if (!el) return false;
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return false;
  return !!el.closest('.main');
}

/**
 * Re-run `fn` on a timer, and when the tab is brought back to the front —
 * but never while someone is typing, which would replace what is under their
 * hands.
 */
export function usePeriodicRefresh(fn, everyMs = 600_000, isBusy = () => false) {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    const tick = () => {
      if (document.hidden || isBusy()) return;
      ref.current?.();
    };
    const id = setInterval(tick, everyMs);
    const onVisible = () => { if (!document.hidden && !isBusy()) ref.current?.(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
    /* eslint-disable-next-line */
  }, [everyMs]);
}
