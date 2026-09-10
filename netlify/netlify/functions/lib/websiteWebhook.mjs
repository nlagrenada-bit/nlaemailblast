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

// Lotto and Super 6 are published smallest to largest, which is the convention
// on every lottery results page. Draw order is not meaningful for these games —
// unlike Pick 3 and Cash 4, where position IS the result and must never be
// reordered.
const ascending = (nums) => [...nums].map(Number).sort((a, b) => a - b);

/**
 * Build one API payload per game result for a day.
 * Each entry is { game, drawNumber, body } ready to send.
 */
export function buildApiPayloads({ date, daily = [], cashPops = [], lotto = null, super6 = null }, skipped = []) {
  const out = [];

  // A game is only sent when it has BOTH a result and a draw number. Anything
  // half-entered is recorded in `skipped` rather than dropped silently — a
  // silent skip looks exactly like a successful push that changed nothing.
  const note = (game, why) => skipped.push(`${game}: ${why}`);

  for (const row of daily) {
    const when = `${date} ${DAILY_TIME[row.period] || '00:00:00'}`;

    if (row.play_way_number != null && !row.play_way_draw_no) note('Play Way', `${row.period} has a number but no draw number`);
    if (row.play_way_number != null && row.play_way_draw_no) {
      out.push({ game: 'play_way', drawNumber: row.play_way_draw_no, body: {
        draw_number: row.play_way_draw_no,
        draw_date: when,
        winning_numbers: Number(row.play_way_number),
        multiplier: row.play_way_multiplier || '',
      }});
    }
    if (row.pick3_digits?.length && !row.pick3_draw_no) note('Pick 3', `${row.period} has digits but no draw number`);
    if (row.pick3_digits?.length && row.pick3_draw_no) {
      out.push({ game: 'pick3', drawNumber: row.pick3_draw_no, body: {
        draw_number: row.pick3_draw_no,
        draw_date: when,
        winning_numbers: row.pick3_digits.map(Number),
        multiplier: row.pick3_multiplier || '',
      }});
    }
    if (row.cash4_digits?.length && !row.cash4_draw_no) note('Cash 4', `${row.period} has digits but no draw number`);
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
    if (p.number != null && !p.draw_no && !p.cancelled) note('Cash Pop', `${p.period} has a number but no draw number`);
    if (p.number == null || !p.draw_no || p.cancelled) continue;
    out.push({ game: 'cash_pop', drawNumber: p.draw_no, body: {
      draw_number: p.draw_no,
      draw_date: `${date} ${POP_TIME[p.period] || '00:00:00'}`,
      draw_period: POP_PERIOD[p.period] || '',
      winning_number: Number(p.number),
    }});
  }

  // Lotto and Super 6 carry the NEW jackpot the operator enters after the draw
  // — which is exactly what the portal's "current jackpot" column expects.
  //
  // If no jackpot has been entered we OMIT the field rather than sending 0.
  // Sending 0 would either be rejected by the portal's jackpot-progression
  // check (a jackpot may not fall below the previous one) or, worse, overwrite
  // a good figure with zero. Omitting it leaves the stored jackpot untouched.
  //
  // jackpot_winners > 0 means the jackpot was won and legitimately resets to a
  // lower figure, so we flag that for the portal's progression check.
  for (const [game, row] of [['lotto', lotto], ['super6', super6]]) {
    if (row?.numbers?.length && !row.draw_no) note(game === 'lotto' ? 'Lotto' : 'Super 6', 'has numbers but no draw number');
    if (!row?.numbers?.length || !row.draw_no) continue;

    const body = {
      draw_number: row.draw_no,
      draw_date: `${date} ${JACKPOT_TIME}`,
      winning_numbers: ascending(row.numbers),
      winning_letter: row.free_ticket_letter || '',
    };

    const jp = Number(row.jackpot_amount);
    if (row.jackpot_amount != null && Number.isFinite(jp) && jp > 0) {
      body.jackpot = jp;
      if (Number(row.jackpot_winners) > 0) body.jackpot_reset = true;
    }

    out.push({ game, drawNumber: row.draw_no, body });
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
/**
 * How many draws the portal already holds for a game, cached for this run so a
 * whole day's push only asks once per game.
 */
const nextCache = new Map();
async function expectedNext(game) {
  if (nextCache.has(game)) return nextCache.get(game);
  const path = GAME_PATH[game] || game;
  let value = null;
  try {
    const res = await fetch(`${BASE()}/results/${path}/next`, { headers: headers() });
    if (res.ok) {
      const j = await res.json();
      value = Number(j.next_draw_number) || null;
    }
  } catch { /* fall back to POST-then-PUT below */ }
  nextCache.set(game, value);
  return value;
}

async function sendOne({ game, drawNumber, body }, { validate = false } = {}) {
  const path = GAME_PATH[game];
  if (!path) return { ok: false, game, error: `unknown game "${game}"` };

  const q = validate ? '?validate=1' : '';
  const postUrl = `${BASE()}/results/${path}${q}`;
  const putUrl  = `${BASE()}/results/${path}/${drawNumber}${q}`;
  const idem    = `${game}-${drawNumber}`;

  // Decide up front whether this is a NEW draw or a CORRECTION, by asking the
  // portal what it expects next. Guessing from the POST status code was
  // fragile: an already-stored draw can come back as 409 OR as 422 from the
  // sequence check, and only 409 triggered the PUT — so a correction that
  // returned 422 was silently lost.
  const next = await expectedNext(game);
  const isCorrection = next != null && Number(drawNumber) < next;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let res;

      if (isCorrection) {
        res = await fetch(putUrl, {
          method: 'PUT', headers: headers(), body: JSON.stringify(body),
        });
        if (res.ok) return { ok: true, game, drawNumber, action: 'updated' };
        // If the portal disagrees that it exists, fall through and try POST.
        if (res.status === 404) {
          res = await fetch(postUrl, {
            method: 'POST', headers: headers(idem), body: JSON.stringify(body),
          });
        }
      } else {
        res = await fetch(postUrl, {
          method: 'POST', headers: headers(idem), body: JSON.stringify(body),
        });

        // Already stored after all -> correct it in place. 422 is included
        // because the sequence check reports duplicates that way.
        if (res.status === 409 || res.status === 422) {
          const put = await fetch(putUrl, {
            method: 'PUT', headers: headers(), body: JSON.stringify(body),
          });
          if (put.ok) return { ok: true, game, drawNumber, action: 'updated' };
          res = put.status === 404 ? res : put;   // keep the more useful error
        }
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

  nextCache.clear();                 // fresh view of the portal for each push
  const skipped = [];
  const payloads = buildApiPayloads(doc, skipped);
  const results = [];

  for (const p of payloads) {
    results.push(await sendOne(p, opts));
    await sleep(250);            // stay comfortably inside 30 requests/minute
  }

  const failed = results.filter((r) => !r.ok);
  return { sent: results.length - failed.length, failed, results, skipped };
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

// ---------------------------------------------------------------------------
// Jackpot updates
//
// The jackpot an operator enters after a Lotto or Super 6 draw is the NEW
// figure now being played for, which is what the portal's jackpot column
// holds. Correcting it is a change to the LAST STORED draw, so it needs a PUT.
//
// This works even when the app has no local row for that draw: it reads the
// stored draw back from the portal, merges the new jackpot, and PUTs the whole
// record. That matters because the portal's PUT expects the full payload.
// ---------------------------------------------------------------------------


/**
 * Read one stored draw back from the portal so a jackpot correction can PUT the
 * full record. The list endpoint's exact envelope isn't documented, so several
 * shapes are accepted rather than assuming one.
 */
async function readStoredDraw(game, drawNumber) {
  const path = GAME_PATH[game] || game;
  const res = await fetch(`${BASE()}/results/${path}?limit=10`, { headers: headers() });
  if (!res.ok) {
    return { ok: false, error: `Could not read the stored ${game} draw (${res.status}).` };
  }
  let payload;
  try { payload = await res.json(); }
  catch { return { ok: false, error: `The portal returned an unreadable ${game} list.` }; }

  // Accept: [ ... ] | {results:[...]} | {data:[...]} | {lotto:[...]} | a bare object
  const rows =
    Array.isArray(payload) ? payload
    : Array.isArray(payload?.results) ? payload.results
    : Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.[path]) ? payload[path]
    : (payload && typeof payload === 'object' && payload.winning_numbers) ? [payload]
    : [];

  if (!rows.length) {
    return { ok: false, error: `The portal returned no ${game} draws to read back.` };
  }

  const row = rows.find((r) => Number(r.draw_number) === Number(drawNumber)) || rows[0];
  const numbers = String(row.winning_numbers ?? '')
    .split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));

  if (!numbers.length) {
    return { ok: false, error: `Could not read the winning numbers for ${game} draw ${drawNumber}.` };
  }
  return { ok: true, numbers, letter: row.winning_letter || '' };
}

/** Read what the portal currently holds for a game. */
export async function lastStored(game) {
  const path = GAME_PATH[game] || game;
  const res = await fetch(`${BASE()}/results/${path}/next`, { headers: headers() });
  if (!res.ok) {
    return { ok: false, error: `${res.status} ${await res.text().catch(() => '')}`.slice(0, 200) };
  }
  const j = await res.json();
  return {
    ok: true,
    nextDrawNumber: j.next_draw_number,
    lastDrawNumber: j.last_draw?.draw_number,
    lastDrawDate: j.last_draw?.draw_date,
    lastJackpot: j.last_jackpot != null ? Number(j.last_jackpot) : null,
    slots: j.draw_time_slots || [],
  };
}

/**
 * Set the jackpot on the most recently stored draw for a game.
 *
 * @param game    'lotto' | 'super6'
 * @param amount  the new jackpot
 * @param opts.numbers / opts.letter  supplied when we have them locally;
 *                otherwise the stored record is read back from the portal.
 * @param opts.jackpotWon  true when the jackpot was won, so a lower figure is
 *                legitimate and the portal's progression check must be told.
 */
export async function pushJackpot(game, amount, opts = {}) {
  if (!BASE())  return { ok: false, error: 'WEBSITE_API_BASE not set' };
  if (!TOKEN()) return { ok: false, error: 'WEBSITE_API_TOKEN not set' };

  const jp = Number(amount);
  if (!Number.isFinite(jp) || jp <= 0) {
    return { ok: false, error: 'A jackpot amount is required.' };
  }

  const info = await lastStored(game);
  if (!info.ok) return { ok: false, error: `Could not read the portal: ${info.error}` };
  if (!info.lastDrawNumber) {
    return { ok: false, error: `The portal has no stored ${game} draw to update.` };
  }

  if (info.lastJackpot === jp) {
    return { ok: true, unchanged: true, drawNumber: info.lastDrawNumber, jackpot: jp,
             note: `Already ${jp} on draw ${info.lastDrawNumber}.` };
  }

  // PUT needs the full record. Use what we hold locally if we have it,
  // otherwise fall back to the copy the portal already stores.
  let numbers = opts.numbers;
  let letter  = opts.letter;
  if (!numbers?.length) {
    const found = await readStoredDraw(game, info.lastDrawNumber);
    if (!found.ok) return found;
    numbers = found.numbers;
    letter  = found.letter;
  }

  const body = {
    winning_numbers: ascending(numbers),
    winning_letter: letter || '',
    jackpot: jp,
  };
  if (opts.jackpotWon) body.jackpot_reset = true;

  const path = GAME_PATH[game] || game;
  const res = await fetch(`${BASE()}/results/${path}/${info.lastDrawNumber}`, {
    method: 'PUT', headers: headers(), body: JSON.stringify(body),
  });

  if (res.ok) {
    return { ok: true, drawNumber: info.lastDrawNumber, jackpot: jp,
             was: info.lastJackpot, note: 'updated' };
  }
  const text = await res.text().catch(() => '');
  return { ok: false, drawNumber: info.lastDrawNumber, error: summarise(res.status, text) };
}
