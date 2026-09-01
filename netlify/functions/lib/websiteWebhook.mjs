// Pushes published results to the NLA website's receiving endpoint.
//
// One POST per game per draw, in the exact shape documented in the developer
// brief. Controlled by two env vars:
//   WEBSITE_WEBHOOK_URL     the developer's endpoint (e.g. https://www.nla.gd/api/results-webhook)
//   WEBSITE_WEBHOOK_SECRET  the shared secret, sent as the X-NLA-Signature header
// If WEBSITE_WEBHOOK_URL is unset, this is a no-op, so the feature stays dark
// until the website side is ready.

const PERIODS_WITH = new Set(['play_way', 'pick3', 'cash4', 'cash_pop']);

// The website's own database uses these Cash Pop period names (mapped by time),
// its own table names, and comma-joined winning numbers. We include a ready-to-
// store `db` block on each payload so their receiver can insert directly without
// re-deriving anything. Source of truth: their live schema (25 Aug 2026).
const POP_PERIOD_TO_SITE = {
  kick_off: 'Morning', lunch: 'Midday', mid_rush: 'Afternoon',
  after_work: 'Evening', prime_time: 'Night',
};
const SITE_TABLE = {
  play_way: 'playway', pick3: 'dailypick3', cash4: 'cash4',
  cash_pop: 'cashpop', lotto: 'lotto', super6: 'super6',
};
const pad2 = (n) => String(n).padStart(2, '0');

/** Build the array of per-game payloads for one day's document rows. */
/**
 * Map one result to the website's own table + columns, so their endpoint can
 * store it with a plain upsert. draw_date carries the time (identifies which
 * daily draw). Numbers are comma-joined to match their existing records.
 */
function siteRow(game, drawNo, period, date, r) {
  const table = SITE_TABLE[game];
  const common = { draw_number: drawNo ?? 0, description: '' };
  if (game === 'lotto' || game === 'super6') {
    return {
      table, conflict: 'draw_number',
      row: {
        ...common,
        draw_date: `${date} 19:45:00`,
        winning_numbers: (r.numbers || []).map(pad2).join(','),
        winning_letter: r.free_ticket_letter || '',
        jackpot: r.jackpot_amount ?? 0,
        multiplier: '',
      },
    };
  }
  if (game === 'play_way') {
    return {
      table, conflict: 'draw_number',
      row: {
        ...common,
        draw_date: `${date} ${timeFor(period)}`,
        winning_numbers: String(r.number ?? ''),
        multiplier: r.multiplier || '',
        jackpot: 0,
      },
    };
  }
  if (game === 'pick3' || game === 'cash4') {
    return {
      table, conflict: 'draw_number',
      row: {
        ...common,
        draw_date: `${date} ${timeFor(period)}`,
        winning_numbers: (r.digits || []).join(','),
        multiplier: r.multiplier || '',
      },
    };
  }
  // cash_pop — dedupe on (draw_date, draw_period)
  return {
    table, conflict: 'draw_date,draw_period',
    row: {
      draw_number: drawNo ?? 0, description: '',
      draw_date: `${date} ${timeFor(period)}`,
      draw_period: POP_PERIOD_TO_SITE[period] || '',
      winning_number: r.number ?? null,
    },
  };
}

const DAILY_TIME = { mid_morning: '09:45:00', midday: '12:45:00', mid_afternoon: '16:45:00', evening: '19:45:00' };
const POP_TIME = { kick_off: '08:45:00', lunch: '11:45:00', mid_rush: '14:45:00', after_work: '17:45:00', prime_time: '20:45:00' };
const timeFor = (period) => DAILY_TIME[period] || POP_TIME[period] || '00:00:00';

export function buildWebhookPayloads({ date, daily = [], cashPops = [], lotto = null, super6 = null }) {
  const out = [];
  const now = new Date().toISOString();
  const base = (game, drawNo, period, result) => ({
    event: 'result.published',
    game,
    draw_date: date,
    draw_number: drawNo ?? null,
    ...(PERIODS_WITH.has(game) ? { period } : {}),
    published_at: now,
    result,
    // Ready-to-store mapping to the website's own tables/columns. Their receiver
    // can insert `db.row` into `db.table`, upserting on `db.conflict`.
    db: siteRow(game, drawNo, period, date, result),
  });

  for (const row of daily) {
    if (row.play_way_number != null) {
      out.push(base('play_way', row.play_way_draw_no, row.period, {
        number: row.play_way_number,
        symbol: row.play_way_symbol || null,
        multiplier: row.play_way_multiplier || null,
        payout: row.play_way_payout ?? null,
      }));
    }
    if (row.pick3_digits?.length) {
      out.push(base('pick3', row.pick3_draw_no, row.period, {
        digits: row.pick3_digits,
        multiplier: row.pick3_multiplier || null,
        payout: row.pick3_payout ?? null,
      }));
    }
    if (row.cash4_digits?.length) {
      out.push(base('cash4', row.cash4_draw_no, row.period, {
        digits: row.cash4_digits,
        multiplier: row.cash4_multiplier || null,
        payout: row.cash4_payout ?? null,
      }));
    }
  }

  for (const p of cashPops) {
    if (p.number == null) continue;
    out.push(base('cash_pop', p.draw_no, p.period, {
      number: p.number,
      payout: p.payout ?? null,
    }));
  }

  if (lotto?.numbers?.length) {
    out.push(base('lotto', lotto.draw_no, null, {
      numbers: lotto.numbers,
      free_ticket_letter: lotto.free_ticket_letter || null,
      match4_winners: lotto.match4_winners ?? 0,
      match4_payout: lotto.match4_payout ?? null,
      match3_winners: lotto.match3_winners ?? 0,
      match3_payout: lotto.match3_payout ?? null,
      jackpot_winners: lotto.jackpot_winners ?? 0,
      jackpot_amount: lotto.jackpot_amount ?? null,
    }));
  }

  if (super6?.numbers?.length) {
    out.push(base('super6', super6.draw_no, null, {
      numbers: super6.numbers,
      free_ticket_letter: super6.free_ticket_letter || null,
      match4_winners: super6.match4_winners ?? 0,
      match4_payout: super6.match4_payout ?? null,
      match5_winners: super6.match5_winners ?? 0,
      match5_payout: super6.match5_payout ?? null,
      jackpot_winners: super6.jackpot_winners ?? 0,
      jackpot_amount: super6.jackpot_amount ?? null,
    }));
  }

  return out;
}

/** POST one payload, with a few retries on network/5xx failure. */
async function postOne(url, secret, payload, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-NLA-Signature': secret },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { ok: true };
      // 4xx won't be fixed by retrying (bad data / auth) — stop early.
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, error: `endpoint returned ${res.status}` };
      }
    } catch (e) {
      if (attempt === tries) return { ok: false, error: e.message };
    }
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  return { ok: false, error: 'endpoint unreachable after retries' };
}

/**
 * Send every game payload for a day to the website. Returns a per-game summary
 * so the caller can log or surface failures. No-op (and reported as skipped) if
 * the webhook isn't configured.
 */
export async function pushResultsToWebsite(doc) {
  const url = process.env.WEBSITE_WEBHOOK_URL;
  const secret = process.env.WEBSITE_WEBHOOK_SECRET || '';
  if (!url) return { skipped: true, reason: 'WEBSITE_WEBHOOK_URL not set' };

  const payloads = buildWebhookPayloads(doc);
  const results = [];
  for (const p of payloads) {
    const r = await postOne(url, secret, p);
    results.push({ game: p.game, period: p.period ?? null, ...r });
  }
  const failed = results.filter((r) => !r.ok);
  return { sent: results.length - failed.length, failed, results };
}
