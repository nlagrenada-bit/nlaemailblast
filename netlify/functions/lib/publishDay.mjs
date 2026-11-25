// netlify/functions/lib/publishDay.mjs
//
// Everything involved in putting a day's results on the websites, in ONE place.
//
// There are now two routes to the websites — "update websites only" and the
// website stage of "update websites & send email". Each previously did its own
// version of this work, and they drifted: one sent the jackpots, the other did
// not. Keeping it here means both always do exactly the same thing.
//
// Steps:
//   1. push every result to both sites (OMP API + WordPress)
//   2. push the Lotto and Super 6 jackpots, which WordPress receives through
//      separate endpoints — its result webhook has no jackpot field at all
//   3. mark the day published, so the public results page shows it

import { pushResultsEverywhere } from './pushAll.mjs';
import { pushJackpot } from './websiteWebhook.mjs';
import { pushHexiveJackpot } from './hexiveWebhook.mjs';
import { markPublished } from './publish.mjs';

export async function loadDay(admin, drawDate) {
  const [daily, cashPops, lotto, super6] = await Promise.all([
    admin.from('daily_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('cash_pop_results').select('*').eq('draw_date', drawDate)
      .order('draw_no', { ascending: true }).then((r) => r.data || []),
    admin.from('lotto_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
    admin.from('super6_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
  ]);
  return { daily, cashPops, lotto, super6 };
}

/** Resolve to `fallback` if `promise` has not settled by `deadline`. */
const before = (promise, deadline, fallback) => {
  const ms = deadline - Date.now();
  if (!Number.isFinite(ms)) return promise;
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(fallback), Math.max(0, ms)))]);
};

/** True when this exact WordPress jackpot figure was already sent successfully. */
async function jackpotAlreadySent(admin, game, drawNo, amount) {
  try {
    const { data } = await admin.from('website_push_log').select('fingerprint')
      .eq('target', 'wordpress').eq('game', `${game}_jackpot`).eq('draw_no', Number(drawNo) || 0).maybeSingle();
    return data?.fingerprint === String(amount);
  } catch { return false; }
}

async function rememberJackpot(admin, game, drawNo, amount) {
  try {
    await admin.from('website_push_log').upsert({
      target: 'wordpress', game: `${game}_jackpot`, draw_no: Number(drawNo) || 0,
      fingerprint: String(amount), sent_at: new Date().toISOString(),
    }, { onConflict: 'target,game,draw_no' });
  } catch { /* never fail the push over logging */ }
}

/**
 * opts.deadline  epoch ms by which everything must have finished. Netlify cuts a
 *                normal function off at 10 seconds and the browser then sees no
 *                answer at all ("The blast could not be started"). Anything not
 *                done by the deadline is reported so a second press finishes it.
 * opts.force     resend everything, even draws the sites already hold.
 */
export async function publishDay(admin, drawDate, opts = {}) {
  const deadline = opts.deadline || Infinity;
  const { daily, cashPops, lotto, super6 } = await loadDay(admin, drawDate);

  const jackpotJob = (async () => {
    const out = [];
    await Promise.all([['lotto', lotto], ['super6', super6]].map(async ([game, row]) => {
      const jp = Number(row?.jackpot_amount);
      if (!row || !Number.isFinite(jp) || jp <= 0) return;
      const won = Number(row.jackpot_winners) > 0;
      const hasNumbers = !!row.numbers?.length;
      const skipWp = !opts.force && await jackpotAlreadySent(admin, game, row.draw_no, jp);
      const [omp, wordpress] = await Promise.all([
        hasNumbers ? Promise.resolve({ ok: true, note: 'sent with the result' })
                   : before(pushJackpot(game, jp, { jackpotWon: won }), deadline,
                       { ok: false, error: 'not sent yet (time limit reached). Press update again to finish' }),
        skipWp ? Promise.resolve({ ok: true, note: 'already on the site' })
               : before(pushHexiveJackpot(game, jp), deadline,
                   { ok: false, error: 'not sent yet (time limit reached). Press update again to finish' }),
      ]);
      if (wordpress?.ok && !skipWp) await rememberJackpot(admin, game, row.draw_no, jp);
      out.push({ game, jackpot: jp, omp, wordpress });
    }));
    return out;
  })();

  // Results and jackpots go out at the same time; they use different endpoints.
  const [website, jackpots] = await Promise.all([
    pushResultsEverywhere({ date: drawDate, daily, cashPops, lotto, super6 },
      { deadline, force: opts.force, admin }),
    jackpotJob,
  ]);

  if (website?.sent > 0 || website?.unchanged > 0 || jackpots.length) await markPublished(admin, drawDate);

  const jackpotFailures = jackpots.flatMap((j) => [
    ...(j.omp && j.omp.ok === false ? [`${j.game} jackpot (OMP): ${j.omp.error}`] : []),
    ...(j.wordpress && j.wordpress.ok === false && !j.wordpress.notConfigured
      ? [`${j.game} jackpot (WordPress): ${j.wordpress.error}`] : []),
  ]);

  return {
    sent: website?.sent ?? 0,
    unchanged: website?.unchanged ?? 0,
    failed: (website?.failed ?? 0) + jackpotFailures.length,
    incomplete: website?.incomplete || [],
    errors: [...(website?.errors || []), ...jackpotFailures],
    skipped: website?.skipped || [],
    jackpots,
  };
}
