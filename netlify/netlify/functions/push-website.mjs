// POST /api/push-website
//   { drawDate }                         push a day's results
//   { game: 'lotto', jackpot: 148000 }   update just the jackpot
//
// Pushes to the results portal without sending any email. Approver/admin only.
// Used by the "Update the website/database only" option.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { createClient } from '@supabase/supabase-js';
import { pushResultsToWebsite, pushJackpot, lastStored } from './lib/websiteWebhook.mjs';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!['approver', 'admin'].includes(auth.staff.role)) {
    return json({ error: 'Only an approver or admin can update the website.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }

  // ---- jackpot-only update -------------------------------------------
  // Correcting the jackpot on the last stored draw. Works even when the app
  // holds no local row for it, because the record is read back from the portal.
  if (body?.game && body?.jackpot != null) {
    const r = await pushJackpot(body.game, body.jackpot, { jackpotWon: !!body.jackpotWon });
    if (!r.ok) return json({ error: r.error }, 502);
    return json({ ok: true, jackpot: r });
  }

  // ---- whole-day push -------------------------------------------------
  const drawDate = (body?.drawDate || '').trim();
  if (!drawDate) return json({ error: 'drawDate is required.' }, 400);

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const [daily, cashPops, lotto, super6] = await Promise.all([
    admin.from('daily_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('cash_pop_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('lotto_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
    admin.from('super6_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
  ]);

  const website = await pushResultsToWebsite({ date: drawDate, daily, cashPops, lotto, super6 });

  if (website?.skipped) {
    return json({ error: `The results portal is not configured (${website.reason}).` }, 400);
  }

  // A jackpot entered without winning numbers cannot go out as a result push —
  // the portal needs the full record. Send it as a jackpot correction instead,
  // so entering a jackpot on its own still reaches the site.
  const extras = [];
  for (const [game, row] of [['lotto', lotto], ['super6', super6]]) {
    const jp = Number(row?.jackpot_amount);
    if (!row || !Number.isFinite(jp) || jp <= 0) continue;
    if (row.numbers?.length) continue;           // already handled by the day push
    const r = await pushJackpot(game, jp, { jackpotWon: Number(row.jackpot_winners) > 0 });
    extras.push({ game, ...r });
  }

  // Nothing at all to send is worth saying plainly, rather than reporting
  // a silent success the operator will misread.
  if (website.sent === 0 && website.failed.length === 0 && extras.length === 0) {
    return json({
      error: `No results are entered for ${drawDate}, so there was nothing to send. `
           + `Enter the winning numbers first, or use the jackpot update if you only `
           + `need to change the jackpot.`,
    }, 422);
  }

  return json({ ok: true, website, jackpotUpdates: extras });
};

export const config = { path: '/api/push-website' };
