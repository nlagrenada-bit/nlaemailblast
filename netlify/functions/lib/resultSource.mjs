// netlify/functions/lib/resultSource.mjs
//
// Where assisted entry gets its results from.
//
// Today that is play.nla.gd, scraped. The intention is that it becomes the
// Abrazo/CBN JSON feed once that exists, and this file is the one place that
// has to change — auto-entry.mjs, the reconciliation, the review page and the
// accept path all work from the shape below and neither know nor care which
// source produced it.
//
//   RESULT_SOURCE=play   (default)  scrape play.nla.gd
//   RESULT_SOURCE=cbn               the Abrazo feed, once CBN_API_BASE is set
//
// THE SHAPE EVERY SOURCE MUST RETURN
//
//   {
//     results: [{
//       game:       'play_way' | 'pick3' | 'cash4' | 'cash_pop' | 'lotto' | 'super6',
//       drawDate:   'YYYY-MM-DD',
//       time:       'HH:MM'        24-hour, Grenada local
//       period:     period code, or null for lotto/super6
//       numbers:    [Number]       in draw order for pick3/cash4, any order otherwise
//       multiplier: 'FP'|'2X'|... or null
//       letter:     'A'-'O'       or null
//       jackpot:    Number        or null
//       drawNo:     Number        or null   <- the scrape cannot supply this
//       payout:     Number        or null   <- nor this
//     }],
//     problems: [String],
//     fetchedAt: ISO string,
//     source: 'play.nla.gd' | 'abrazo'
//   }
//
// The two nulls are the whole reason this is assisted rather than automatic.
// A source that CAN supply drawNo and payout — as the requested CBN feed would —
// removes the manual steps without any other change: the review page already
// prefers a supplied draw number over its own suggestion, and already skips the
// payout prompt when a payout is present.

import { fetchLatestResults as fetchFromPlay } from './playScrape.mjs';

/** Placeholder for the Abrazo feed. Wired the day CBN provides it. */
async function fetchFromCbn() {
  const base = process.env.CBN_API_BASE;
  const token = process.env.CBN_API_TOKEN;
  if (!base) {
    return { results: [], source: 'abrazo',
      problems: ['CBN_API_BASE is not set, so the Abrazo feed cannot be used yet.'] };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/draws/latest`, {
      headers: {
        Authorization: `Bearer ${token || ''}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      return { results: [], source: 'abrazo',
        problems: [`The Abrazo feed returned ${res.status}.`] };
    }
    const body = await res.json();
    return {
      results: (body.draws || []).map(fromAbrazo).filter(Boolean),
      problems: [],
      fetchedAt: new Date().toISOString(),
      source: 'abrazo',
    };
  } catch (e) {
    return { results: [], source: 'abrazo',
      problems: [`Could not reach the Abrazo feed: ${e.message}`] };
  }
}

/**
 * Map one Abrazo draw onto the shape above.
 *
 * Written against the specification sent to CBN. It will need checking against
 * whatever they actually return, but the mapping lives here and nothing else
 * has to move.
 */
function fromAbrazo(d) {
  if (!d?.game || !d?.draw_date) return null;
  const r = d.result || {};
  const f = d.financials || {};

  const numbers = Array.isArray(r.digits) ? r.digits.map(Number)
    : Array.isArray(r.numbers) ? r.numbers.map(Number)
    : r.number != null ? [Number(r.number)]
    : [];
  if (!numbers.length) return null;

  return {
    game: d.game,
    drawDate: d.draw_date,
    time: (d.draw_time || '').slice(0, 5) || null,
    period: d.draw_period ?? null,
    numbers,
    multiplier: r.multiplier ?? null,
    letter: r.free_ticket_letter ?? null,
    jackpot: f.jackpot?.next_draw_amount ?? f.jackpot?.amount_this_draw ?? null,
    // The two the scrape cannot give us.
    drawNo: d.draw_number ?? null,
    payout: f.total_prizes ?? null,
  };
}

/** Fetch from whichever source is configured. */
export async function fetchResults() {
  if ((process.env.RESULT_SOURCE || 'play').toLowerCase() === 'cbn') {
    return fetchFromCbn();
  }
  const r = await fetchFromPlay();
  return { ...r, source: 'play.nla.gd' };
}
