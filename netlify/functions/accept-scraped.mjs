// POST /api/accept-scraped
//
// Saves one result that an operator has reviewed on the assisted-entry page.
// It writes exactly what manual entry writes, so everything downstream — the
// preview, validation, the send path, publishing — is unchanged.
//
// It will NOT overwrite a published result. A result that has gone to the media
// must be corrected on the results page and resent, so the correction is
// visible and deliberate rather than silently replaced by a scrape.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { createClient } from '@supabase/supabase-js';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }

  const { game, drawDate, period, numbers, multiplier, letter, drawNo, payout, jackpot } = b || {};
  if (!game || !drawDate || !Array.isArray(numbers) || !numbers.length) {
    return json({ error: 'game, drawDate and numbers are required.' }, 400);
  }
  if (!drawNo) return json({ error: 'A draw number is required.' }, 400);

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const guardPublished = async (table, match) => {
    const { data } = await admin.from(table).select('published_at').match(match).maybeSingle();
    if (data?.published_at) {
      return 'That draw has already been published. Correct it on the results page and resend.';
    }
    return null;
  };

  try {
    if (game === 'lotto' || game === 'super6') {
      const table = game === 'lotto' ? 'lotto_results' : 'super6_results';
      const stop = await guardPublished(table, { draw_date: drawDate });
      if (stop) return json({ error: stop }, 409);

      const row = {
        draw_date: drawDate,
        draw_no: Number(drawNo),
        numbers: numbers.map(Number),
        free_ticket_letter: letter || null,
        entered_by: auth.staff.id,
      };
      if (jackpot != null) row.jackpot_amount = num(jackpot);

      const { error } = await admin.from(table).upsert(row, { onConflict: 'draw_date' });
      if (error) throw error;
      return json({ ok: true, game, drawDate, drawNo });
    }

    if (game === 'cash_pop') {
      if (!period) return json({ error: 'A draw period is required for Cash Pop.' }, 400);
      const stop = await guardPublished('cash_pop_results', { draw_date: drawDate, period });
      if (stop) return json({ error: stop }, 409);

      const { error } = await admin.from('cash_pop_results').upsert({
        draw_date: drawDate, period,
        draw_no: Number(drawNo),
        number: Number(numbers[0]),
        payout: num(payout),
        entered_by: auth.staff.id,
      }, { onConflict: 'draw_date,period' });
      if (error) throw error;
      return json({ ok: true, game, drawDate, period, drawNo });
    }

    // daily games: one row per period, so merge into whatever is there
    if (!period) return json({ error: 'A draw period is required.' }, 400);
    const stop = await guardPublished('daily_results', { draw_date: drawDate, period });
    if (stop) return json({ error: stop }, 409);

    const patch = { draw_date: drawDate, period, entered_by: auth.staff.id };
    if (game === 'play_way') {
      patch.play_way_number = Number(numbers[0]);
      patch.play_way_draw_no = Number(drawNo);
      if (multiplier) patch.play_way_multiplier = multiplier;
      if (payout != null && payout !== '') patch.play_way_payout = num(payout);
    } else if (game === 'pick3') {
      patch.pick3_digits = numbers.map(Number);
      patch.pick3_draw_no = Number(drawNo);
      if (multiplier) patch.pick3_multiplier = multiplier;
      if (payout != null && payout !== '') patch.pick3_payout = num(payout);
    } else if (game === 'cash4') {
      patch.cash4_digits = numbers.map(Number);
      patch.cash4_draw_no = Number(drawNo);
      if (multiplier) patch.cash4_multiplier = multiplier;
      if (payout != null && payout !== '') patch.cash4_payout = num(payout);
    } else {
      return json({ error: `Unknown game "${game}".` }, 400);
    }

    const { error } = await admin.from('daily_results')
      .upsert(patch, { onConflict: 'draw_date,period' });
    if (error) throw error;
    return json({ ok: true, game, drawDate, period, drawNo });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

export const config = { path: '/api/accept-scraped' };
