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

export async function publishDay(admin, drawDate) {
  const { daily, cashPops, lotto, super6 } = await loadDay(admin, drawDate);

  const website = await pushResultsEverywhere({ date: drawDate, daily, cashPops, lotto, super6 });

  // Jackpots. WordPress needs this unconditionally; the OMP only when there are
  // no numbers to carry the jackpot inside the result payload.
  const jackpots = [];
  for (const [game, row] of [['lotto', lotto], ['super6', super6]]) {
    const jp = Number(row?.jackpot_amount);
    if (!row || !Number.isFinite(jp) || jp <= 0) continue;
    const won = Number(row.jackpot_winners) > 0;
    const hasNumbers = !!row.numbers?.length;
    const [omp, wordpress] = await Promise.all([
      hasNumbers ? Promise.resolve({ ok: true, note: 'sent with the result' })
                 : pushJackpot(game, jp, { jackpotWon: won }),
      pushHexiveJackpot(game, jp),
    ]);
    jackpots.push({ game, jackpot: jp, omp, wordpress });
  }

  if (website?.sent > 0 || jackpots.length) await markPublished(admin, drawDate);

  const jackpotFailures = jackpots.flatMap((j) => [
    ...(j.omp && j.omp.ok === false ? [`${j.game} jackpot (OMP): ${j.omp.error}`] : []),
    ...(j.wordpress && j.wordpress.ok === false && !j.wordpress.notConfigured
      ? [`${j.game} jackpot (WordPress): ${j.wordpress.error}`] : []),
  ]);

  return {
    sent: website?.sent ?? 0,
    failed: (website?.failed ?? 0) + jackpotFailures.length,
    incomplete: website?.incomplete || [],
    errors: [...(website?.errors || []), ...jackpotFailures],
    skipped: website?.skipped || [],
    jackpots,
  };
}
