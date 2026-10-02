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

/* ---------------------------------------------------------------------------
   When to check for results.

   Results do not reach play.nla.gd the moment a draw happens. They appear a
   little later, and at a different point for each game:

       Cash Pop       about 10 min after its draw     8:45 -> ~8:55
       Daily games    about 15 min after              9:45 -> ~10:00
       Lotto          about 25 min after              7:45 -> ~8:10
       Super 6        about 45 min after              7:45 -> ~8:30

   So the fast checking STARTS when a game's results are due, and carries on
   for fifteen minutes. The first version started it at the draw time instead,
   which meant it checked hard while there was nothing to find and slowed down
   at exactly the moment the results arrived.

   The same timings serve the Abrazo JSON feed when it is switched on: the pace
   is decided here, whichever source answers the check. If the feed publishes
   sooner, shorten the delays below.

   Outside the fast windows it still checks every 60 seconds, so a result that
   arrives late is picked up rather than missed.

   Fast checking only in these windows also keeps the number of checks well
   inside Netlify's monthly allowance, which on the free plan suspends the site
   when it runs out.
--------------------------------------------------------------------------- */
export const PUBLISH_DELAY_MINUTES = { cash_pop: 10, daily: 15, lotto: 25, super6: 45 };
export const FAST_POLL_MS = 12_500;       // inside a window
export const SLOW_POLL_MS = 60_000;       // the rest of the time
export const FAST_WINDOW_MINUTES = 15;    // how long each window lasts

/** When each game's results should start appearing today, in minutes. */
function publishTimes(scheduled) {
  const s = scheduled || { daily: true, cash_pop: true, lotto: true, super6: true };
  const out = [];
  if (s.cash_pop) for (const p of CASH_POP_PERIODS) out.push(toMin(p.time) + PUBLISH_DELAY_MINUTES.cash_pop);
  if (s.daily)    for (const p of DAILY_PERIODS)    out.push(toMin(p.time) + PUBLISH_DELAY_MINUTES.daily);
  if (s.lotto)  out.push(toMin('19:45') + PUBLISH_DELAY_MINUTES.lotto);
  if (s.super6) out.push(toMin('19:45') + PUBLISH_DELAY_MINUTES.super6);
  return out;
}

/** Is it within fifteen minutes of a game's results becoming due? */
export function inFastWindow(now = new Date(), scheduled) {
  const m = gdMinutesNow(now);
  return publishTimes(scheduled).some((t) => m >= t && m < t + FAST_WINDOW_MINUTES);
}

/**
 * How long to wait before the next check.
 *
 * Inside a window: 12.5 seconds. Outside: 60 seconds — BUT never past the start
 * of the next window. Without that, a slow wait that began just before a window
 * opened ran its full minute: at 8:54:30 the next check landed at 8:55:30, so a
 * Cash Pop published at 8:55 sat unfilled for most of a minute. Cash Pop draws
 * are close together, so by then the operator had usually typed it themselves.
 * Now the first check happens exactly when the results are due.
 */
export function pollDelay(now = new Date(), scheduled) {
  if (inFastWindow(now, scheduled)) return FAST_POLL_MS;

  const nowMs = gdMinutesNow(now) * 60_000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  const untilNext = publishTimes(scheduled)
    .map((t) => t * 60_000 - nowMs)
    .filter((ms) => ms > 0)
    .reduce((a, b) => Math.min(a, b), Infinity);

  // A little after the window opens, never sooner than a second.
  return Math.max(1000, Math.min(SLOW_POLL_MS, untilNext + 500));
}

/* Has the operator pressed a key in the last few seconds?

   The auto-fill pauses while someone is actually typing, so a filled value can
   never land in the middle of a keystroke. It used to pause whenever the cursor
   was merely SITTING in a field — and since the cursor is placed in the draw
   number field after pressing Use, that was nearly all the time. The fill
   almost never ran. */
let lastKeyAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => { lastKeyAt = Date.now(); }, { capture: true, passive: true });
}
export function typedRecently(ms = 4000) {
  return Date.now() - lastKeyAt < ms;
}
