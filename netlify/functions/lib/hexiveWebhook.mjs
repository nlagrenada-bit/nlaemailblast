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

/** Node's fetch only says "fetch failed"; the real reason is on e.cause. */
export function networkReason(e, url) {
  const host = (() => { try { return new URL(url).host; } catch { return url; } })();
  const code = e?.cause?.code || e?.code || '';
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `${host} did not answer within 6 seconds`;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `${host} could not be found (DNS). If the site moved, update HEXIVE_WEBHOOK_BASE in Netlify`;
  if (code === 'ECONNREFUSED') return `${host} refused the connection (server down or wrong address)`;
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return `${host} dropped the connection (often a firewall)`;
  if (/CERT|SSL|TLS|ERR_TLS/i.test(code + ' ' + (e?.cause?.message || ''))) return `${host} has an SSL certificate problem (${code || e?.cause?.message})`;
  return `${host}: ${e?.cause?.message || e?.message || 'network error'}${code ? ` (${code})` : ''}`;
}

/** A failure that will be the same for every request to this site. */
const siteWide = (r) => r && !r.ok && (r.network || r.status === 401 || r.status === 403 || r.status === 404);

// No single request may hang the whole push.
const fetchT = (url, init = {}) => fetch(url, { signal: AbortSignal.timeout(6000), ...init });

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

async function sendOne({ game, drawId, body }, deadline = Infinity) {
  const path = PATH[game];
  if (!path) return { ok: false, game, error: `unknown game "${game}"` };
  const url = `${BASE()}/wp-json/${path}/v1/webhook`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchT(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': SECRET(),
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) return { ok: true, game, drawId };

      // 5xx and 429 are worth retrying, if there is time; a 4xx is a decision.
      if ((res.status >= 500 || res.status === 429) && attempt < 3 && Date.now() + 1500 * attempt < deadline) {
        await sleep(1500 * attempt);
        continue;
      }
      const text = await res.text().catch(() => '');
      return { ok: false, game, drawId, status: res.status,
               error: `${res.status} ${String(text).replace(/\s+/g, ' ').slice(0, 180)}` };
    } catch (e) {
      // DNS, refused or certificate failures will not fix themselves in a
      // second, so do not retry those; only a timeout or a dropped connection.
      const code = e?.cause?.code || '';
      const permanent = ['ENOTFOUND', 'ECONNREFUSED'].includes(code) || /CERT|TLS/i.test(code);
      if (permanent || attempt === 3 || Date.now() + 1000 * attempt > deadline) {
        return { ok: false, game, drawId, network: true, error: networkReason(e, url) };
      }
      await sleep(1000 * attempt);
    }
  }
  return { ok: false, game, drawId, error: 'unreachable after retries' };
}

/* WordPress cannot be read back, so the app remembers what it last sent
   successfully (table website_push_log). A draw already sent with exactly the
   same content is not sent again. Without this, every push re-sent the whole
   day, which late in the day took longer than Netlify allows. If the table is
   missing, everything is sent, as before. */
const fingerprint = (body) => JSON.stringify(body);

async function alreadySent(admin, payloads) {
  if (!admin || !payloads.length) return new Set();
  try {
    const { data, error } = await admin.from('website_push_log')
      .select('game, draw_no, fingerprint').eq('target', 'wordpress')
      .in('draw_no', [...new Set(payloads.map((p) => Number(p.drawId)))]);
    if (error) return new Set();
    return new Set((data || []).map((r) => `${r.game}|${r.draw_no}|${r.fingerprint}`));
  } catch { return new Set(); }
}

async function remember(admin, sent) {
  if (!admin || !sent.length) return;
  try {
    await admin.from('website_push_log').upsert(sent.map((p) => ({
      target: 'wordpress', game: p.game, draw_no: Number(p.drawId),
      fingerprint: fingerprint(p.body), sent_at: new Date().toISOString(),
    })), { onConflict: 'target,game,draw_no' });
  } catch { /* logging must never fail the push */ }
}

/**
 * Push a day's results to the WordPress site.
 * opts.admin     Supabase service client, to skip draws already sent identically
 * opts.deadline  epoch ms; anything not started by then is reported, not sent
 * opts.force     send everything regardless of the log
 * Returns { sent, failed[], results[], skipped[], unchanged }, or
 * { notConfigured, reason } when the target is switched off.
 */
export async function pushResultsToHexive(doc, opts = {}) {
  if (!BASE())   return { notConfigured: true, reason: 'HEXIVE_WEBHOOK_BASE not set' };
  if (!SECRET()) return { notConfigured: true, reason: 'HEXIVE_WEBHOOK_SECRET not set' };

  const deadline = opts.deadline || Infinity;
  const skipped = [];
  const all = buildHexivePayloads(doc, skipped);

  const seen = opts.force ? new Set() : await alreadySent(opts.admin, all);
  const payloads = all.filter((p) => !seen.has(`${p.game}|${Number(p.drawId)}|${fingerprint(p.body)}`));
  const unchanged = all.length - payloads.length;

  // Each game has its own endpoint, so games go in parallel; within a game,
  // draws stay in order so a later slot never lands before an earlier one.
  const byGame = new Map();
  for (const p of payloads) (byGame.get(p.game) || byGame.set(p.game, []).get(p.game)).push(p);

  const results = [];

  /* Probe with ONE request first. If the site is unreachable or refuses the
     secret, every other request would fail the same way, and trying each one
     just burns time. Say it once, clearly, and stop. */
  const first = payloads[0];
  if (first) {
    const r = await sendOne(first, deadline);
    results.push({ ...r, _p: first });
    const list = byGame.get(first.game);
    list.shift();
    if (!list.length) byGame.delete(first.game);
    if (siteWide(r)) {
      const rest = [...byGame.values()].flat();
      for (const p of rest) results.push({ ok: false, game: p.game, drawId: p.drawId, siteDown: true, error: r.error });
      byGame.clear();
    }
  }

  await Promise.all([...byGame.values()].map(async (list) => {
    for (const p of list) {
      if (Date.now() > deadline) {
        skipped.push(`${p.game} draw ${p.drawId}: not sent yet (time limit reached). Press update again to finish`);
        continue;
      }
      results.push({ ...(await sendOne(p, deadline)), _p: p });
      await sleep(150);
    }
  }));

  await remember(opts.admin, results.filter((r) => r.ok).map((r) => r._p));
  for (const r of results) delete r._p;

  const failed = results.filter((r) => !r.ok);
  return { sent: results.length - failed.length, failed, results, skipped, unchanged };
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
      const res = await fetchT(url, {
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
      const code = e?.cause?.code || '';
      if (attempt === 3 || ['ENOTFOUND', 'ECONNREFUSED'].includes(code)) {
        return { ok: false, game, network: true, error: networkReason(e, url) };
      }
      await sleep(1000 * attempt);
    }
  }
  return { ok: false, game, error: 'unreachable after retries' };
}
