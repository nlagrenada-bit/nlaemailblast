// POST /api/set-payout
//
// Adds or corrects the payout (or jackpot) on a result that already exists.
//
// Payouts are published after the winning numbers, and play.nla.gd does not
// carry them at all, so a result is routinely correct but waiting on its
// payout. This lets that be finished from the assisted-entry page instead of
// making the operator go back to manual entry for one figure.
//
// Unlike the numbers, a payout MAY be set on a published result: correcting a
// figure that was not yet known is a normal part of the day, not a rewrite of
// what was announced.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { createClient } from '@supabase/supabase-js';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

/** Accepts "1200" or "1200+450"; two figures maximum, addition only. */
function resolveAmount(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { total: null, error: null };
  const parts = text.replace(/\s+/g, '').split('+').filter((x) => x !== '');
  if (!parts.length) return { total: null, error: null };
  if (parts.length > 2) return { total: null, error: 'Only two figures can be added.' };
  const nums = [];
  for (const piece of parts) {
    if (!/^\d*\.?\d*$/.test(piece)) return { total: null, error: 'Numbers only, with one + to add two figures.' };
    const n = Number(piece);
    if (!Number.isFinite(n)) return { total: null, error: 'That is not a number.' };
    nums.push(n);
  }
  return { total: Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100, error: null };
}

const DAILY_FIELD = {
  play_way: 'play_way_payout', pick3: 'pick3_payout', cash4: 'cash4_payout',
};

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }
  const { game, drawDate, period, payout, jackpot } = b || {};

  if (!game || !drawDate) return json({ error: 'game and drawDate are required.' }, 400);

  const pay = resolveAmount(payout);
  const jack = resolveAmount(jackpot);
  if (pay.error) return json({ error: pay.error }, 400);
  if (jack.error) return json({ error: jack.error }, 400);
  if (pay.total === null && jack.total === null) {
    return json({ error: 'Nothing to save.' }, 400);
  }

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  try {
    if (game === 'lotto' || game === 'super6') {
      const table = game === 'lotto' ? 'lotto_results' : 'super6_results';
      const patch = {};
      if (jack.total !== null) patch.jackpot_amount = jack.total;
      if (!Object.keys(patch).length) {
        return json({ error: 'Lotto and Super 6 take a jackpot, not a payout.' }, 400);
      }
      const { error } = await admin.from(table).update(patch).eq('draw_date', drawDate);
      if (error) throw error;
      return json({ ok: true, game, drawDate, ...patch });
    }

    if (game === 'cash_pop') {
      if (!period) return json({ error: 'A draw period is required.' }, 400);
      const { error } = await admin.from('cash_pop_results')
        .update({ payout: pay.total }).eq('draw_date', drawDate).eq('period', period);
      if (error) throw error;
      return json({ ok: true, game, drawDate, period, payout: pay.total });
    }

    const field = DAILY_FIELD[game];
    if (!field) return json({ error: `Unknown game "${game}".` }, 400);
    if (!period) return json({ error: 'A draw period is required.' }, 400);

    const { error } = await admin.from('daily_results')
      .update({ [field]: pay.total }).eq('draw_date', drawDate).eq('period', period);
    if (error) throw error;
    return json({ ok: true, game, drawDate, period, payout: pay.total });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

export const config = { path: '/api/set-payout' };
