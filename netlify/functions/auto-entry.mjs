// GET /api/auto-entry?date=YYYY-MM-DD
//
// Reads the latest results from play.nla.gd and reconciles them against what
// the app holds, so an operator can review and accept rather than retype.
//
// This NEVER writes anything. It reports, and the app decides. Publishing stays
// behind the same review and send path as manual entry.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { createClient } from '@supabase/supabase-js';
import { fetchResults } from './lib/resultSource.mjs';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'content-type': 'application/json' } });

const GAME_LABEL = {
  play_way: 'Play Way', pick3: 'Daily Pick 3', cash4: 'Daily Cash 4',
  cash_pop: 'Cash Pop', lotto: 'Lotto', super6: 'Super 6',
};

const eqNums = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((v, i) => Number(v) === Number(b[i]));

export default async (request) => {
  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);

  const url = new URL(request.url);
  const date = (url.searchParams.get('date') || '').trim();

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const scraped = await fetchResults();
  if (!scraped.results.length) {
    return json({ error: `Could not read any results from ${scraped.source || 'the source'}.`,
                  problems: scraped.problems }, 502);
  }

  const items = [];

  for (const r of scraped.results) {
    // Only reconcile the day being viewed, when one is given.
    if (date && r.drawDate !== date) {
      items.push({ ...r, status: 'other_day', label: GAME_LABEL[r.game],
        note: `This is the ${r.drawDate} draw, not ${date}.` });
      continue;
    }

    const base = { ...r, label: GAME_LABEL[r.game] };

    if (r.game === 'lotto' || r.game === 'super6') {
      const table = r.game === 'lotto' ? 'lotto_results' : 'super6_results';
      const { data: row } = await admin.from(table).select('*')
        .eq('draw_date', r.drawDate).maybeSingle();
      const { data: last } = await admin.from(table)
        .select('draw_no').lt('draw_date', r.drawDate)
        .order('draw_date', { ascending: false }).limit(1);

      items.push(reconcile(base, row?.numbers, row?.free_ticket_letter,
        null, row?.draw_no, last?.[0]?.draw_no, row?.published_at,
        null, row?.jackpot_amount));
      continue;
    }

    if (r.game === 'cash_pop') {
      const { data: row } = await admin.from('cash_pop_results').select('*')
        .eq('draw_date', r.drawDate).eq('period', r.period).maybeSingle();
      const { data: last } = await admin.from('cash_pop_results')
        .select('draw_no').not('draw_no', 'is', null)
        .order('draw_date', { ascending: false }).order('period', { ascending: false }).limit(1);

      items.push(reconcile(base, row?.number != null ? [row.number] : null,
        null, null, row?.draw_no, last?.[0]?.draw_no, row?.published_at,
        row?.payout));
      continue;
    }

    // daily games share one row per period
    const { data: row } = await admin.from('daily_results').select('*')
      .eq('draw_date', r.drawDate).eq('period', r.period).maybeSingle();

    const F = {
      play_way: ['play_way_number', 'play_way_multiplier', 'play_way_draw_no'],
      pick3:    ['pick3_digits', 'pick3_multiplier', 'pick3_draw_no'],
      cash4:    ['cash4_digits', 'cash4_multiplier', 'cash4_draw_no'],
    }[r.game];

    const held = r.game === 'play_way'
      ? (row?.[F[0]] != null ? [row[F[0]]] : null)
      : (row?.[F[0]]?.length ? row[F[0]] : null);

    const { data: last } = await admin.from('daily_results')
      .select(F[2]).not(F[2], 'is', null)
      .order('draw_date', { ascending: false }).limit(1);

    const PAYOUT_FIELD = {
      play_way: 'play_way_payout', pick3: 'pick3_payout', cash4: 'cash4_payout',
    }[r.game];

    items.push(reconcile(base, held, null, row?.[F[1]], row?.[F[2]],
      last?.[0]?.[F[2]], row?.published_at, row?.[PAYOUT_FIELD]));
  }

  const counts = items.reduce((a, i) => { a[i.status] = (a[i.status] || 0) + 1; return a; }, {});

  return json({
    ok: true,
    source: scraped.source || 'play.nla.gd',
    fetchedAt: scraped.fetchedAt,
    date: date || null,
    counts,
    problems: scraped.problems,
    items,
  });
};

/**
 * Compare one scraped result against what the app holds.
 *
 * new       nothing stored - can be accepted
 * match     identical - nothing to do
 * conflict  differs - MUST be resolved by a person before publishing
 * published already sent; a difference here is a correction, not an entry
 */
function reconcile(base, heldNumbers, heldLetter, heldMultiplier, heldDrawNo,
                   lastDrawNo, publishedAt, heldPayout = null, heldJackpot = null) {
  // A source that carries the real draw number (the Abrazo feed will) is
  // trusted over our own last-plus-one guess.
  const suggestedDrawNo = base.drawNo ?? heldDrawNo
    ?? (lastDrawNo ? Number(lastDrawNo) + 1 : null);

  // Payouts are published after the numbers and are not on play.nla.gd at all,
  // so a result can be perfectly correct and still be waiting for one. That is
  // reported separately from a conflict — it is an outstanding task, not a
  // disagreement.
  // If the source supplied a payout, nothing needs entering by hand.
  const needsPayout = (base.payout ?? heldPayout) === null
    || (base.payout ?? heldPayout) === undefined;
  const needsJackpot = (base.game === 'lotto' || base.game === 'super6')
    && (heldJackpot === null || heldJackpot === undefined);

  if (!heldNumbers) {
    return { ...base, status: 'new', heldNumbers: null,
      suggestedDrawNo, lastDrawNo: lastDrawNo ?? null, publishedAt: null,
      needsPayout: true, needsJackpot };
  }

  const diffs = [];
  if (!eqNums(heldNumbers, base.numbers)) {
    diffs.push(`numbers: app has ${heldNumbers.join(' ')}, play.nla.gd has ${base.numbers.join(' ')}`);
  }
  if (base.multiplier && heldMultiplier && base.multiplier !== heldMultiplier) {
    diffs.push(`Multi-X: app has ${heldMultiplier}, play.nla.gd has ${base.multiplier}`);
  }
  if (base.letter && heldLetter && base.letter !== heldLetter) {
    diffs.push(`letter: app has ${heldLetter}, play.nla.gd has ${base.letter}`);
  }

  return {
    ...base,
    status: diffs.length ? 'conflict' : (publishedAt ? 'published' : 'match'),
    heldNumbers, heldMultiplier: heldMultiplier ?? null, heldDrawNo: heldDrawNo ?? null,
    heldPayout: heldPayout ?? null, heldJackpot: heldJackpot ?? null,
    suggestedDrawNo, lastDrawNo: lastDrawNo ?? null,
    publishedAt: publishedAt ?? null,
    needsPayout, needsJackpot,
    diffs,
  };
}

export const config = { path: '/api/auto-entry' };
