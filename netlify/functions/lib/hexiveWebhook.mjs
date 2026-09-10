// netlify/functions/lib/hexiveWebhook.mjs
//
// Second results target: the WordPress site's REST webhooks.
//
//   Reference: "NLA Webhook Integration", 9 September 2026
//   Six endpoints, one per game:
//     https://<host>/wp-json/{super6|lotto|cash4|pick3|cashpop|playway}/v1/webhook
//
// Configured by:
//   HEXIVE_WEBHOOK_BASE     e.g. https://www.hexivedev.com   (no trailing slash)
//   HEXIVE_WEBHOOK_SECRET   sent as the X-Webhook-Secret header
// Unset base = no-op, so this stays dark until the site is ready.
//
// This runs ALONGSIDE the OMP API push (websiteWebhook.mjs). The two are
// independent: one failing never stops the other.
//
// DIFFERENCES FROM THE OMP API, WHICH THIS CODE EXISTS TO ABSORB
//   * Auth is X-Webhook-Secret, not Bearer.
//   * Each number is its own named field, as a STRING.
//   * Lotto and Super 6 numbers are zero-padded ("01", "05"); the daily games
//     send single digits ("3", "7").
//   * draw_type must change per time slot or, per the spec, "subsequent draws
//     throughout the day will overwrite the earlier group".
//   * Their "mid_day" and "afternoon" are our "midday" and "mid_afternoon".
//   * There is no jackpot field, so jackpots are not sent here.

const BASE   = () => (process.env.HEXIVE_WEBHOOK_BASE || '').replace(/\/$/, '');
const SECRET = () => process.env.HEXIVE_WEBHOOK_SECRET || '';

const PATH = {
  super6:   'super6',
  lotto:    'lotto',
  cash4:    'cash4',
  pick3:    'pick3',
  cash_pop: 'cashpop',
  play_way: 'playway',
};

// Our daily period codes -> their draw_type. Note mid_day / afternoon.
const DAILY_TYPE = {
  mid_morning:   'mid_morning',
  midday:        'mid_day',
  mid_afternoon: 'afternoon',
  evening:       'evening',
};
// Cash Pop periods happen to match ours exactly.
const POP_TYPE = {
  kick_off: 'kick_off', lunch: 'lunch', mid_rush: 'mid_rush',
  after_work: 'after_work', prime_time: 'prime_time',
};

const pad2 = (n) => String(Number(n)).padStart(2, '0');
const s    = (n) => String(Number(n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lotto and Super 6 publish smallest to largest. Pick 3 and Cash 4 must NOT be
// sorted — for those games the position of each digit is the result.
const ascending = (nums) => [...nums].map(Number).sort((a, b) => a - b);

/**
 * Build one webhook payload per game result for a day.
 * Returns [{ game, drawId, body }].
 */
export function buildHexivePayloads({ date, daily = [], cashPops = [], lotto = null, super6 = null }, skipped = []) {
  const out = [];
  const note = (game, why) => skipped.push(`${game}: ${why}`);

  if (lotto?.numbers?.length >= 5 && lotto.draw_no) {
    const n = ascending(lotto.numbers);
    out.push({ game: 'lotto', drawId: lotto.draw_no, body: {
      draw_id: Number(lotto.draw_no),
      first_number:  pad2(n[0]),
      second_number: pad2(n[1]),
      third_number:  pad2(n[2]),
      fourth_number: pad2(n[3]),
      fifth_number:  pad2(n[4]),
      letter: lotto.free_ticket_letter || '',
    }});
  }

  if (super6?.numbers?.length >= 6 && super6.draw_no) {
    const n = ascending(super6.numbers);
    out.push({ game: 'super6', drawId: super6.draw_no, body: {
      draw_id: Number(super6.draw_no),
      first_number:  pad2(n[0]),
      second_number: pad2(n[1]),
      third_number:  pad2(n[2]),
      fourth_number: pad2(n[3]),
      fifth_number:  pad2(n[4]),
      sixth_number:  pad2(n[5]),
      letter: super6.free_ticket_letter || '',
    }});
  }

  for (const row of daily) {
    const type = DAILY_TYPE[row.period];
    if (!type) continue;                       // unknown slot: skip rather than guess

    if (row.cash4_digits?.length === 4 && !row.cash4_draw_no) note('Cash 4', `${row.period} has digits but no draw number`);
    if (row.cash4_digits?.length === 4 && row.cash4_draw_no) {
      const d = row.cash4_digits;
      out.push({ game: 'cash4', drawId: row.cash4_draw_no, body: {
        draw_type: type,
        draw_id: Number(row.cash4_draw_no),
        cash_4_first_number:  s(d[0]),
        cash_4_second_number: s(d[1]),
        cash_4_third_number:  s(d[2]),
        cash_4_fourth_number: s(d[3]),
        cash_4_multi_x: row.cash4_multiplier || '',
      }});
    }

    if (row.pick3_digits?.length === 3 && !row.pick3_draw_no) note('Pick 3', `${row.period} has digits but no draw number`);
    if (row.pick3_digits?.length === 3 && row.pick3_draw_no) {
      const d = row.pick3_digits;
      out.push({ game: 'pick3', drawId: row.pick3_draw_no, body: {
        draw_type: type,
        draw_id: Number(row.pick3_draw_no),
        first_number:  s(d[0]),
        second_number: s(d[1]),
        third_number:  s(d[2]),
        multi_x: row.pick3_multiplier || '',
      }});
    }

    if (row.play_way_number != null && !row.play_way_draw_no) note('Play Way', `${row.period} has a number but no draw number`);
    if (row.play_way_number != null && row.play_way_draw_no) {
      out.push({ game: 'play_way', drawId: row.play_way_draw_no, body: {
        draw_type: type,
        draw_id: Number(row.play_way_draw_no),
        number: s(row.play_way_number),
        multi_x: row.play_way_multiplier || '',
      }});
    }
  }

  for (const p of cashPops) {
    const type = POP_TYPE[p.period];
    if (!type || p.number == null || !p.draw_no || p.cancelled) continue;
    out.push({ game: 'cash_pop', drawId: p.draw_no, body: {
      draw_type: type,
      draw_id: Number(p.draw_no),
      number: s(p.number),
    }});
  }

  return out;
}

async function sendOne({ game, drawId, body }) {
  const path = PATH[game];
  if (!path) return { ok: false, game, error: `unknown game "${game}"` };
  const url = `${BASE()}/wp-json/${path}/v1/webhook`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': SECRET(),
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) return { ok: true, game, drawId };

      // 5xx and 429 are worth retrying; a 4xx is a decision.
      if ((res.status >= 500 || res.status === 429) && attempt < 3) {
        await sleep(1500 * attempt);
        continue;
      }
      const text = await res.text().catch(() => '');
      return { ok: false, game, drawId, status: res.status,
               error: `${res.status} ${String(text).replace(/\s+/g, ' ').slice(0, 180)}` };
    } catch (e) {
      if (attempt === 3) return { ok: false, game, drawId, error: e.message };
      await sleep(1000 * attempt);
    }
  }
  return { ok: false, game, drawId, error: 'unreachable after retries' };
}

/**
 * Push a day's results to the WordPress site.
 * Returns { sent, failed[], results[], skipped[] }, or { notConfigured, reason }
 * when the target is switched off. `skipped` lists games that could not be
 * sent; it is ALWAYS an array, so never test it for truthiness.
 */
export async function pushResultsToHexive(doc) {
  if (!BASE())   return { notConfigured: true, reason: 'HEXIVE_WEBHOOK_BASE not set' };
  if (!SECRET()) return { notConfigured: true, reason: 'HEXIVE_WEBHOOK_SECRET not set' };

  const skipped = [];
  const payloads = buildHexivePayloads(doc, skipped);
  const results = [];
  for (const p of payloads) {
    results.push(await sendOne(p));
    await sleep(300);
  }
  const failed = results.filter((r) => !r.ok);
  return { sent: results.length - failed.length, failed, results, skipped };
}

// ---------------------------------------------------------------------------
// Jackpot updates
//
// Separate endpoints from the result webhooks, and note the two paths are
// named inconsistently in the spec — "super6-game" but "lottogame". They are
// listed explicitly rather than derived, so a wrong guess can't fail silently.
//
//   POST /wp-json/super6-game/v1/update-jackpot   { "estimated_jackpot": 5000000 }
//   POST /wp-json/lottogame/v1/update-jackpot     { "estimated_jackpot": 250000 }
// ---------------------------------------------------------------------------

const JACKPOT_PATH = {
  super6: 'super6-game/v1/update-jackpot',
  lotto:  'lottogame/v1/update-jackpot',
};

/**
 * Set the estimated jackpot shown on the WordPress site.
 * @param game    'lotto' | 'super6'
 * @param amount  the new estimated jackpot
 */
export async function pushHexiveJackpot(game, amount) {
  if (!BASE())   return { notConfigured: true, reason: 'HEXIVE_WEBHOOK_BASE not set' };
  if (!SECRET()) return { notConfigured: true, reason: 'HEXIVE_WEBHOOK_SECRET not set' };

  const path = JACKPOT_PATH[game];
  if (!path) return { ok: false, game, error: `No jackpot endpoint for "${game}".` };

  const jp = Number(amount);
  if (!Number.isFinite(jp) || jp <= 0) {
    return { ok: false, game, error: 'A positive jackpot amount is required.' };
  }

  const url = `${BASE()}/wp-json/${path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': SECRET(),
          Accept: 'application/json',
        },
        body: JSON.stringify({ estimated_jackpot: jp }),
      });
      if (res.ok) return { ok: true, game, jackpot: jp };
      if ((res.status >= 500 || res.status === 429) && attempt < 3) {
        await sleep(1500 * attempt);
        continue;
      }
      const text = await res.text().catch(() => '');
      return { ok: false, game, status: res.status,
               error: `${res.status} ${String(text).replace(/\s+/g, ' ').slice(0, 180)}` };
    } catch (e) {
      if (attempt === 3) return { ok: false, game, error: e.message };
      await sleep(1000 * attempt);
    }
  }
  return { ok: false, game, error: 'unreachable after retries' };
}
