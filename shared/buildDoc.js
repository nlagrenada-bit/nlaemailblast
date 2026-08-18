// Turns raw database rows into the normalised document that emailTemplate.js
// renders. Kept separate so the preview in the browser and the send function
// build from identical logic.

import {
  DAILY_PERIODS, CASH_POP_PERIODS, DEFAULT_LETTER_WORDS,
} from './config.js';

const bannerFor = (list, code) => list.find((p) => p.code === code)?.banner || code;

function dailyRow(row) {
  const p = DAILY_PERIODS.find((x) => x.code === row.period);
  return {
    code: row.period,
    banner: p?.banner || row.period,
    playWay: {
      number: row.play_way_number || null,
      multiplier: row.play_way_multiplier || null,
      payout: row.play_way_payout,
      drawNo: row.play_way_draw_no ?? null,
    },
    pick3: {
      digits: row.pick3_digits || [],
      multiplier: row.pick3_multiplier || null,
      payout: row.pick3_payout,
      drawNo: row.pick3_draw_no ?? null,
    },
    cash4: {
      digits: row.cash4_digits || [],
      multiplier: row.cash4_multiplier || null,
      payout: row.cash4_payout,
      drawNo: row.cash4_draw_no ?? null,
    },
  };
}

/**
 * @param {object} input
 *   date        'YYYY-MM-DD'
 *   kind        'daily_period' | 'cash_pop' | 'lotto' | 'super6' | 'eod'
 *   daily       daily_results rows to include
 *   cashPops    cash_pop_results rows to include
 *   lotto       lotto_results row or null
 *   super6      super6_results row or null
 *   settings    { greeting, letter_words, footer }
 *   day         draw_days row or null
 */
export function buildDoc(input) {
  const {
    date, kind, daily = [], cashPops = [], lotto = null, super6 = null,
    settings = {}, day = null, greeting, subject,
  } = input;

  const words = settings.letter_words || DEFAULT_LETTER_WORDS;
  const order = DAILY_PERIODS.map((p) => p.code);
  const popOrder = CASH_POP_PERIODS.map((p) => p.code);

  const doc = {
    date,
    kind,
    subject,
    greeting: greeting || settings.greeting || 'Dear All,',
    notice: day?.status && day.status !== 'normal' ? day.notice || null : null,
    dailyPeriods: daily
      .filter((r) => !r.cancelled)
      .sort((a, b) => order.indexOf(a.period) - order.indexOf(b.period))
      .map(dailyRow),
    cashPopGroups: [],
    lotto: null,
    super6: null,
  };

  const pops = cashPops
    .filter((r) => !r.cancelled && r.number != null)
    .sort((a, b) => popOrder.indexOf(a.period) - popOrder.indexOf(b.period))
    .map((r) => ({
      code: r.period,
      banner: bannerFor(CASH_POP_PERIODS, r.period),
      number: r.number,
      payout: r.payout,
      drawNo: r.draw_no ?? null,
    }));
  if (pops.length) doc.cashPopGroups = [{ pops }];

  if (lotto) {
    doc.lotto = {
      drawNo: lotto.draw_no ?? null,
      numbers: lotto.numbers || [],
      letter: lotto.free_ticket_letter || null,
      letterWord: words[lotto.free_ticket_letter] || '',
      match4Winners: lotto.match4_winners || 0,
      match4Payout: lotto.match4_payout,
      match3Winners: lotto.match3_winners || 0,
      match3Payout: lotto.match3_payout,
      jackpotWinners: lotto.jackpot_winners || 0,
      jackpot: lotto.jackpot_amount,
    };
  }

  if (super6) {
    doc.super6 = {
      drawNo: super6.draw_no ?? null,
      numbers: super6.numbers || [],
      letter: super6.free_ticket_letter || null,
      letterWord: words[super6.free_ticket_letter] || '',
      match4Winners: super6.match4_winners || 0,
      match4Payout: super6.match4_payout,
      match5Winners: super6.match5_winners || 0,
      match5Payout: super6.match5_payout,
      jackpotWinners: super6.jackpot_winners || 0,
      jackpot: super6.jackpot_amount,
    };
  }

  return doc;
}

/** Flags anything an operator would want to know about before sending. */
export function validateDoc(doc) {
  const warnings = [];
  const errors = [];

  const empty = !doc.dailyPeriods.length && !doc.cashPopGroups.length
    && !doc.lotto && !doc.super6;
  if (empty) errors.push('No results selected — there is nothing to send.');

  for (const p of doc.dailyPeriods) {
    for (const [g, v] of [['Play Way', p.playWay], ['Pick 3', p.pick3], ['Cash 4', p.cash4]]) {
      if (!v.drawNo) warnings.push(`${p.banner}: ${g} draw number is missing.`);
    }
    if (!p.playWay.number) warnings.push(`${p.banner}: Play Way number is missing.`);
    if (p.playWay.number && !p.playWay.multiplier) warnings.push(`${p.banner}: Play Way Multi-X is missing.`);
    if (p.pick3.digits.length !== 3) warnings.push(`${p.banner}: Pick 3 needs three digits.`);
    if (p.cash4.digits.length !== 4) warnings.push(`${p.banner}: Cash 4 needs four digits.`);
    for (const [g, v] of [['Play Way', p.playWay], ['Pick 3', p.pick3], ['Cash 4', p.cash4]]) {
      if (v.multiplier && (v.payout === null || v.payout === undefined || v.payout === '')) {
        warnings.push(`${p.banner}: ${g} payout is blank.`);
      }
    }
  }

  for (const g of doc.cashPopGroups) {
    for (const p of g.pops) {
      if (!p.drawNo) warnings.push(`${p.banner}: draw number is missing.`);
      if (p.payout === null || p.payout === undefined || p.payout === '') {
        warnings.push(`${p.banner}: payout is blank.`);
      }
    }
  }

  if (doc.lotto) {
    if ((doc.lotto.numbers || []).length !== 5) errors.push('Lotto needs five numbers.');
    if (new Set(doc.lotto.numbers).size !== doc.lotto.numbers.length) errors.push('Lotto numbers repeat.');
    if (!doc.lotto.drawNo) warnings.push('Lotto draw number is missing.');
    if (!doc.lotto.letter) warnings.push('Lotto free ticket letter is missing.');
    if (!doc.lotto.jackpot) warnings.push('Lotto jackpot amount is blank.');
  }

  if (doc.super6) {
    if ((doc.super6.numbers || []).length !== 6) errors.push('Super 6 needs six numbers.');
    if (new Set(doc.super6.numbers).size !== doc.super6.numbers.length) errors.push('Super 6 numbers repeat.');
    if (!doc.super6.drawNo) warnings.push('Super 6 draw number is missing.');
    if (!doc.super6.letter) warnings.push('Super 6 free ticket letter is missing.');
    if (!doc.super6.jackpot) warnings.push('Super 6 jackpot amount is blank.');
  }

  return { errors, warnings, ok: errors.length === 0 };
}
