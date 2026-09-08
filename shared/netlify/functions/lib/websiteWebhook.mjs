// netlify/functions/lib/websiteWebhook.mjs
//
// Pushes published draw results to the NLA Online Management Portal.
//
//   Reference: "NLA Results API - v1", 7 September 2026 (rev. 5)
//   Base URL:  https://about.nla.gd/omp/api/v1
//
// Configured by two environment variables:
//   WEBSITE_API_BASE    e.g. https://about.nla.gd/omp/api/v1   (no trailing slash)
//   WEBSITE_API_TOKEN   the Bearer token issued to this client
// If WEBSITE_API_BASE is unset this is a no-op, so the feature stays dark until
// the portal side is ready.
//
// HOW THE API SHAPES THIS CODE
//
//   * One result per request, POSTed to /results/{game} - not a single
//     envelope for the whole day.
//   * POST answers 409 for a draw number that already exists. That is
//     deliberate: it stops an accidental resend silently overwriting official
//     results. To CORRECT a result we must PUT to /results/{game}/{draw_number}.
//     So: POST first, and on 409 fall back to PUT.
//   * Idempotency-Key makes a retry after a timeout replay the original
//     response instead of colliding.
//   * Throttle is 30 requests/minute per token. A full day is well under that,
//     but we pace slightly to stay clear.

const BASE  = () => (process.env.WEBSITE_API_BASE || '').replace(/\/$/, '');
const TOKEN = () => process.env.WEBSITE_API_TOKEN || '';

// Our internal game codes -> the portal's URL segment.
const GAME_PATH = {
  play_way: 'playway',
  pick3:    'dailypick3',
  cash4:    'cash4',
  cash_pop: 'cashpop',
  lotto:    'lotto',
  super6:   'super6',
};

// Our period codes -> the portal's Cash Pop period names.
const POP_PERIOD = {
  kick_off: 'Morning', lunch: 'Midday', mid_rush: 'Afternoon',
  after_work: 'Evening', prime_time: 'Night',
};

// Draw times. The portal validates draw_date against these exact slots.
const DAILY_TIME = {
  mid_morning: '09:45:00', midday: '12:45:00',
  mid_afternoon: '16:45:00', evening: '19:45:00',
};
const POP_TIME = {
  kick_off: '08:45:00', lunch: '11:45:00', mid_rush: '14:45:00',
  after_work: '17:45:00', prime_time: '20:45:00',
};
const JACKPOT_TIME = '19:45:00';      // lotto and super 6 both draw at 7:45pm

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build one API payload per game result for a day.
 * Each entry is { game, drawNumber, body } ready to send.
 */
export function buildApiPayloads({ date, daily = [], cashPops = [], lotto = null, super6 = null }) {
  const out = [];

  for (const row of daily) {
    const when = `${date} ${DAILY_TIME[row.period] || '00:00:00'}`;

    if (row.play_way_number != null && row.play_way_draw_no) {
      out.push({ game: 'play_way', drawNumber: row.play_way_draw_no, body: {
        draw_number: row.play_way_draw_no,
        draw_date: when,
        winning_numbers: Number(row.play_way_number),
        multiplier: row.play_way_multiplier || '',
      }});
    }
    if (row.pick3_digits?.length && row.pick3_draw_no) {
      out.push({ game: 'pick3', drawNumber: row.pick3_draw_no, body: {
        draw_number: row.pick3_draw_no,
        draw_date: when,
        winning_numbers: row.pick3_digits.map(Number),
        multiplier: row.pick3_multiplier || '',
      }});
    }
    if (row.cash4_digits?.length && row.cash4_draw_no) {
      out.push({ game: 'cash4', drawNumber: row.cash4_draw_no, body: {
        draw_number: row.cash4_draw_no,
        draw_date: when,
        winning_numbers: row.cash4_digits.map(Number),
        multiplier: row.cash4_multiplier || '',
      }});
    }
  }

  for (const p of cashPops) {
    if (p.number == null || !p.draw_no || p.cancelled) continue;
    out.push({ game: 'cash_pop', drawNumber: p.draw_no, body: {
      draw_number: p.draw_no,
      draw_date: `${date} ${POP_TIME[p.period] || '00:00:00'}`,
      draw_period: POP_PERIOD[p.period] || '',
      winning_number: Number(p.number),
    }});
  }

  if (lotto?.numbers?.length && lotto.draw_no) {
    out.push({ game: 'lotto', drawNumber: lotto.draw_no, body: {
      draw_number: lotto.draw_no,
      draw_date: `${date} ${JACKPOT_TIME}`,
      winning_numbers: lotto.numbers.map(Number),
      winning_letter: lotto.free_ticket_letter || '',
      jackpot: lotto.jackpot_amount ?? 0,
    }});
  }

  if (super6?.numbers?.length && super6.draw_no) {
    out.push({ game: 'super6', drawNumber: super6.draw_no, body: {
      draw_number: super6.draw_no,
      draw_date: `${date} ${JACKPOT_TIME}`,
      winning_numbers: super6.numbers.map(Number),
      winning_letter: super6.free_ticket_letter || '',
      jackpot: super6.jackpot_amount ?? 0,
    }});
  }

  return out;
}

function headers(idempotencyKey) {
  const h = {
    'Authorization': `Bearer ${TOKEN()}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  return h;
}

/**
 * Send one result. POST first; if the draw already exists (409) fall back to
 * PUT, which is how the API expects corrections. Retries only on network
 * errors, 429 and 5xx - a 4xx is a decision, not a hiccup.
 */
async function sendOne({ game, drawNumber, body }, { validate = false } = {}) {
  const path = GAME_PATH[game];
  if (!path) return { ok: false, game, error: `unknown game "${game}"` };

  const q = validate ? '?validate=1' : '';
  const postUrl = `${BASE()}/results/${path}${q}`;
  const putUrl  = `${BASE()}/results/${path}/${drawNumber}${q}`;
  const idem    = `${game}-${drawNumber}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let res = await fetch(postUrl, {
        method: 'POST', headers: headers(idem), body: JSON.stringify(body),
      });

      // Already stored -> this is a correction, so update it in place.
      if (res.status === 409) {
        res = await fetch(putUrl, {
          method: 'PUT', headers: headers(), body: JSON.stringify(body),
        });
        if (res.ok) return { ok: true, game, drawNumber, action: 'updated' };
      }

      if (res.ok) {
        const replay = res.headers.get('x-idempotency-replay') === 'true';
        return { ok: true, game, drawNumber, action: replay ? 'replayed' : 'created' };
      }

      if (res.status === 429 && attempt < 3) {
        const wait = Number(res.headers.get('retry-after') || 60) * 1000;
        await sleep(Math.min(wait, 65000));
        continue;
      }

      if (res.status >= 500 && attempt < 3) {
        await sleep(1500 * attempt);
        continue;
      }

      const detail = await res.text().catch(() => '');
      return {
        ok: false, game, drawNumber, status: res.status,
        error: summarise(res.status, detail),
      };
    } catch (e) {
      if (attempt === 3) return { ok: false, game, drawNumber, error: e.message };
      await sleep(1000 * attempt);
    }
  }
  return { ok: false, game, drawNumber, error: 'unreachable after retries' };
}

/** Turn an API error body into one readable line for the blast record. */
function summarise(status, text) {
  try {
    const j = JSON.parse(text);
    if (j.errors && typeof j.errors === 'object') {
      const fields = Object.entries(j.errors).map(([k, v]) => `${k}: ${v}`).join('; ');
      return `${status} ${j.message || 'Validation failed'} - ${fields}`;
    }
    if (j.message) return `${status} ${j.message}`;
  } catch { /* not JSON */ }
  return `${status} ${String(text).slice(0, 200)}`;
}

/**
 * Push a day's results to the portal.
 * Returns { sent, failed[], results[] } or { skipped } when unconfigured.
 */
export async function pushResultsToWebsite(doc, opts = {}) {
  if (!BASE())  return { skipped: true, reason: 'WEBSITE_API_BASE not set' };
  if (!TOKEN()) return { skipped: true, reason: 'WEBSITE_API_TOKEN not set' };

  const payloads = buildApiPayloads(doc);
  const results = [];

  for (const p of payloads) {
    results.push(await sendOne(p, opts));
    await sleep(250);            // stay comfortably inside 30 requests/minute
  }

  const failed = results.filter((r) => !r.ok);
  return { sent: results.length - failed.length, failed, results };
}

/** Dry run: full validation on the portal, nothing written. */
export const validateResultsWithWebsite = (doc) =>
  pushResultsToWebsite(doc, { validate: true });

/** Ask the portal what it expects next for a game - useful for diagnostics. */
export async function nextExpected(game) {
  if (!BASE()) return { skipped: true };
  const path = GAME_PATH[game];
  const res = await fetch(`${BASE()}/results/${path}/next`, { headers: headers() });
  return res.ok ? res.json() : { error: `${res.status} ${await res.text().catch(() => '')}` };
}
