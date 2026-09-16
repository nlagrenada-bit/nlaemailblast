import { useEffect, useRef } from 'react';
import { DAILY_PERIODS, CASH_POP_PERIODS } from '../../shared/config.js';

/**
 * Periodic refresh and time-of-day draw selection.
 *
 * The desk is left open all day. Without this, the screen quietly goes stale:
 * it shows whatever was loaded hours ago, still sitting on the mid-morning draw
 * long after the evening one has been entered by someone else.
 */

/** Minutes since midnight, in Grenada local time (UTC-4 all year). */
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
 * Which draw the desk should be looking at right now.
 *
 * The draw that has most recently happened, because that is the one waiting to
 * be entered. Before the first draw of the day, the first one. Only draws
 * actually scheduled for the day are considered, so a Tuesday does not offer
 * Lotto.
 *
 * A small grace period means the slot appears a couple of minutes BEFORE the
 * draw, so the operator is already on the right screen when the result arrives.
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
  // Lotto and Super 6 draw at 7:45pm, at the same time as the evening daily draw.
  if (scheduled?.lotto)  stops.push({ key: 'lotto',  at: toMin('19:45'), rank: 1 });
  if (scheduled?.super6) stops.push({ key: 'super6', at: toMin('19:45'), rank: 2 });

  if (!stops.length) return null;

  // Sort by time, then by rank so a tie resolves in the order the desk works:
  // the daily draw first (it carries three games), then Lotto, then Super 6.
  stops.sort((a, b) => (a.at - b.at) || ((a.rank ?? 0) - (b.rank ?? 0)));

  // The latest time that has already come round.
  const due = stops.filter((s) => s.at <= mins);
  if (!due.length) return stops[0].key;

  const latest = due[due.length - 1].at;
  // Among draws sharing that time, take the first — not the last — so 7:45pm on
  // a Friday opens on the evening draw rather than jumping straight to Super 6.
  return due.find((s) => s.at === latest).key;
}

/**
 * Re-run `fn` every `everyMs`, but never while the operator is typing.
 *
 * Replacing what is on screen underneath someone mid-entry would lose their
 * work. When that happens the refresh is simply deferred to the next tick.
 */
export function usePeriodicRefresh(fn, everyMs = 600_000, isBusy = () => false) {
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;        // nothing to see; save the request
      if (isBusy()) return;               // mid-entry: try again next time
      ref.current?.();
    };
    const id = setInterval(tick, everyMs);

    // Coming back to the tab after a while is the moment a stale screen is most
    // likely and most confusing, so refresh then too.
    const onVisible = () => { if (!document.hidden && !isBusy()) ref.current?.(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
    /* eslint-disable-next-line */
  }, [everyMs]);
}

/** True when the cursor is in a result field, so a refresh would disturb it. */
export function isTypingInResults() {
  const el = document.activeElement;
  if (!el) return false;
  if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return false;
  return !!el.closest('.main');
}
