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
// Lotto and Super 6 are published smallest to largest, the convention on every
// lottery results page. Pick 3 and Cash 4 are NOT sorted anywhere: for those
// games the position of each digit is the result.
const ascending = (nums) => [...(nums || [])].map(Number).sort((a, b) => a - b);

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
      numbers: ascending(lotto.numbers),
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
      numbers: ascending(super6.numbers),
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
  const warnings = [];   // advisory - worth a look
  const blocking = [];   // WILL NOT reach the websites
  const errors = [];     // cannot send at all

  const empty = !doc.dailyPeriods.length && !doc.cashPopGroups.length
    && !doc.lotto && !doc.super6;
  if (empty) errors.push('No results selected — there is nothing to send.');

  // A missing draw number is not a cosmetic gap. The results portal keys on it,
  // so the game is silently dropped from every website push. It is separated
  // from the soft warnings for that reason.
  const noDrawNo = (label) => blocking.push(`${label} — no draw number, so it will NOT reach the websites.`);

  for (const p of doc.dailyPeriods) {
    if (!p.playWay.number) warnings.push(`${p.banner}: Play Way number is missing.`);
    if (p.pick3.digits.length !== 3) warnings.push(`${p.banner}: Pick 3 needs three digits.`);
    if (p.cash4.digits.length !== 4) warnings.push(`${p.banner}: Cash 4 needs four digits.`);

    for (const [g, v, entered] of [
      ['Play Way', p.playWay, p.playWay.number != null],
      ['Pick 3',   p.pick3,   p.pick3.digits.length === 3],
      ['Cash 4',   p.cash4,   p.cash4.digits.length === 4],
    ]) {
      if (entered && !v.drawNo) noDrawNo(`${p.banner} ${g}`);
      if (entered && !v.multiplier) warnings.push(`${p.banner}: ${g} Multi-X is missing.`);
      if (v.multiplier && (v.payout === null || v.payout === undefined || v.payout === '')) {
        warnings.push(`${p.banner}: ${g} payout is blank.`);
      }
    }
  }

  for (const g of doc.cashPopGroups) {
    for (const p of g.pops) {
      if (p.number != null && !p.drawNo) noDrawNo(`${p.banner}`);
      if (p.payout === null || p.payout === undefined || p.payout === '') {
        warnings.push(`${p.banner}: payout is blank.`);
      }
    }
  }

  if (doc.lotto) {
    if ((doc.lotto.numbers || []).length !== 5) errors.push('Lotto needs five numbers.');
    if (new Set(doc.lotto.numbers).size !== doc.lotto.numbers.length) errors.push('Lotto numbers repeat.');
    if (!doc.lotto.drawNo) noDrawNo('Lotto');
    if (!doc.lotto.letter) warnings.push('Lotto free ticket letter is missing.');
    if (!doc.lotto.jackpot) blocking.push('Lotto jackpot is blank — the websites will keep showing the old figure.');
  }

  if (doc.super6) {
    if ((doc.super6.numbers || []).length !== 6) errors.push('Super 6 needs six numbers.');
    if (new Set(doc.super6.numbers).size !== doc.super6.numbers.length) errors.push('Super 6 numbers repeat.');
    if (!doc.super6.drawNo) noDrawNo('Super 6');
    if (!doc.super6.letter) warnings.push('Super 6 free ticket letter is missing.');
    if (!doc.super6.jackpot) blocking.push('Super 6 jackpot is blank — the websites will keep showing the old figure.');
  }

  return { errors, blocking, warnings, ok: errors.length === 0 };
}

/**
 * Which scheduled draws have no result entered at all. buildDoc only sees what
 * was entered, so a draw nobody keyed in is invisible to validateDoc — yet it
 * is the most consequential gap of all, and the one most likely on the late
 * draws. Pass the day's schedule to find them.
 */
export function missingScheduledDraws({ scheduled, daily = [], cashPops = [], lotto, super6 }) {
  const missing = [];

  if (scheduled?.daily) {
    for (const p of DAILY_PERIODS) {
      const row = daily.find((d) => d.period === p.code);
      const gaps = [];
      if (row?.play_way_number == null) gaps.push('Play Way');
      if (!row?.pick3_digits?.length)  gaps.push('Pick 3');
      if (!row?.cash4_digits?.length)  gaps.push('Cash 4');
      if (gaps.length) missing.push(`${p.label}: ${gaps.join(', ')} not entered`);
    }
  }

  if (scheduled?.cash_pop) {
    for (const p of CASH_POP_PERIODS) {
      const row = cashPops.find((c) => c.period === p.code);
      if (row?.cancelled) continue;
      if (row?.number == null) missing.push(`${p.label}: not entered`);
    }
  }

  if (scheduled?.lotto && !lotto?.numbers?.length) missing.push('Lotto: not entered');
  if (scheduled?.super6 && !super6?.numbers?.length) missing.push('Super 6: not entered');

  return missing;
}
