// POST /api/push-website
//
//   { drawDate: '2026-09-07' }              push that day's results
//   { game: 'lotto' }                       take the jackpot from OUR database
//                                           and push it to the portal
//   { game: 'lotto', jackpot: 148000 }      push an explicit figure
//   { diagnose: true }                      compare our jackpots with the portal's
//
// Pushes to the results portal without sending any email. Approver/admin only.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { createClient } from '@supabase/supabase-js';
import { pushJackpot, lastStored } from './lib/websiteWebhook.mjs';
import { pushResultsEverywhere } from './lib/pushAll.mjs';
import { pushHexiveJackpot } from './lib/hexiveWebhook.mjs';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'content-type': 'application/json' } });

const db = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

const TABLE = { lotto: 'lotto_results', super6: 'super6_results' };

/**
 * The jackpot the operator most recently entered for a game. This is the
 * figure now being played for, which is exactly what the portal stores.
 * Reads the newest row that actually has a jackpot, so a later draw entered
 * without one doesn't mask it.
 */
async function jackpotFromDatabase(game, admin) {
  const table = TABLE[game];
  if (!table) return { ok: false, error: `No jackpot is tracked for ${game}.` };

  const { data, error } = await admin.from(table)
    .select('draw_date, draw_no, numbers, free_ticket_letter, jackpot_amount, jackpot_winners')
    .not('jackpot_amount', 'is', null)
    .gt('jackpot_amount', 0)
    .order('draw_date', { ascending: false })
    .limit(1);

  if (error) return { ok: false, error: error.message };
  const row = data?.[0];
  if (!row) {
    return { ok: false, error:
      `No ${game} jackpot has been entered in the app yet. Enter it on the draw, then try again.` };
  }
  return {
    ok: true,
    amount: Number(row.jackpot_amount),
    drawDate: row.draw_date,
    drawNo: row.draw_no,
    numbers: row.numbers || null,
    letter: row.free_ticket_letter || '',
    won: Number(row.jackpot_winners) > 0,
  };
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!['approver', 'admin'].includes(auth.staff.role)) {
    return json({ error: 'Only an approver or admin can update the website.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }
  const admin = db();

  // ---- diagnose: what do we hold vs what does the portal hold? --------
  if (body?.diagnose) {
    const out = {};
    for (const game of ['lotto', 'super6']) {
      const ours = await jackpotFromDatabase(game, admin);
      const theirs = await lastStored(game);
      out[game] = {
        app: ours.ok
          ? { jackpot: ours.amount, drawDate: ours.drawDate, drawNo: ours.drawNo }
          : { error: ours.error },
        portal: theirs.ok
          ? { jackpot: theirs.lastJackpot, lastDraw: theirs.lastDrawNumber, nextDraw: theirs.nextDrawNumber }
          : { error: theirs.error },
        match: ours.ok && theirs.ok ? ours.amount === theirs.lastJackpot : null,
      };
    }
    return json({ ok: true, compare: out });
  }

  // ---- jackpot update -------------------------------------------------
  if (body?.game) {
    const game = body.game;
    let amount = body.jackpot;
    let won = !!body.jackpotWon;
    let source = 'supplied';

    // No figure given: take the one the operator entered in the app.
    if (amount == null) {
      const ours = await jackpotFromDatabase(game, admin);
      if (!ours.ok) return json({ error: ours.error }, 422);
      amount = ours.amount;
      won = ours.won;
      source = `app database (${game} draw ${ours.drawNo ?? '?'}, ${ours.drawDate})`;
    }

    // Both sites carry the jackpot, on different endpoints. Send to each
    // independently so one failing never blocks the other.
    const [ompR, wpR] = await Promise.all([
      pushJackpot(game, amount, { jackpotWon: won }),
      pushHexiveJackpot(game, amount),
    ]);

    const failures = [];
    if (!ompR.ok && !ompR.unchanged) failures.push(`OMP: ${ompR.error}`);
    if (!wpR.ok && !wpR.skipped)     failures.push(`WordPress: ${wpR.error}`);

    if (failures.length === 2) {
      return json({ error: failures.join(' | '), source, amount }, 502);
    }
    return json({
      ok: true, source, amount,
      omp: ompR,
      wordpress: wpR,
      warning: failures.length ? failures.join(' | ') : undefined,
    });
  }

  // ---- whole-day push -------------------------------------------------
  const drawDate = (body?.drawDate || '').trim();
  if (!drawDate) return json({ error: 'drawDate is required.' }, 400);

  const [daily, cashPops, lotto, super6] = await Promise.all([
    admin.from('daily_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('cash_pop_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('lotto_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
    admin.from('super6_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
  ]);

  const website = await pushResultsEverywhere({ date: drawDate, daily, cashPops, lotto, super6 });

  // Every target unconfigured means there is nowhere to send at all.
  if (website.skipped.length === 2) {
    return json({ error: `No results target is configured (${website.skipped.join('; ')}).` }, 400);
  }

  // Jackpots always go out separately, whether or not the draw has numbers.
  //
  // WordPress needs this unconditionally: its result webhook has NO jackpot
  // field, so the ONLY way a jackpot reaches that site is these dedicated
  // endpoints. Skipping them when numbers were present is why the Lotto
  // jackpot never updated.
  //
  // The OMP is different - its result payload already carries the jackpot - so
  // it only needs a separate call when there are no numbers to carry it.
  const extras = [];
  for (const [game, row] of [['lotto', lotto], ['super6', super6]]) {
    const jp = Number(row?.jackpot_amount);
    if (!row || !Number.isFinite(jp) || jp <= 0) continue;
    const won = Number(row.jackpot_winners) > 0;
    const hasNumbers = !!row.numbers?.length;

    const [o, w] = await Promise.all([
      hasNumbers ? Promise.resolve({ skipped: true, reason: 'sent with the result' })
                 : pushJackpot(game, jp, { jackpotWon: won }),
      pushHexiveJackpot(game, jp),
    ]);
    extras.push({ game, jackpot: jp, omp: o, wordpress: w });
  }

  if (website.sent === 0 && website.failed === 0 && extras.length === 0) {
    return json({
      error: `No results are entered for ${drawDate}, so there was nothing to send. `
           + `Enter the winning numbers first, or update the jackpot on its own.`,
    }, 422);
  }

  return json({ ok: true, website, jackpotUpdates: extras });
};

export const config = { path: '/api/push-website' };
