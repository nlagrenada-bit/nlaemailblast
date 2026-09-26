import { sameNumbers, sameValue, display } from '../../shared/compareResults.js';
import { DAILY_PERIODS, CASH_POP_PERIODS } from '../../shared/config.js';

/**
 * Checking the desk against play.nla.gd.
 *
 * play.nla.gd is fed directly by the draw software, so it is the best
 * independent check on what the operator has typed. Two jobs use it:
 *
 *   verifyScope()  before sending, does what we are about to publish agree?
 *   fillsFor()     after a draw, what empty fields can be filled in for us?
 *
 * One limit shapes both: play.nla.gd shows only the LATEST result per game.
 * An earlier draw that has since been superseded cannot be checked, and that is
 * reported honestly as "could not verify" rather than as a pass.
 */

const DAILY_GAMES = [
  ['play_way', 'Play Way',     (r) => (r?.play_way_number != null ? [r.play_way_number] : null), (r) => r?.play_way_multiplier],
  ['pick3',    'Daily Pick 3', (r) => (r?.pick3_digits?.length ? r.pick3_digits : null),        (r) => r?.pick3_multiplier],
  ['cash4',    'Daily Cash 4', (r) => (r?.cash4_digits?.length ? r.cash4_digits : null),        (r) => r?.cash4_multiplier],
];

const find = (items, game, period) =>
  items.find((i) => i.game === game && (period == null || i.period === period));

/**
 * Every draw the current scope would send, taken straight from the scope's own
 * rows. Those are exactly what goes out — including every Pop when "include
 * earlier Pops" is ticked — so there is no second source of truth to drift.
 */
function expectedDraws(scope) {
  const out = [];
  for (const row of scope.daily || []) {
    const label = DAILY_PERIODS.find((p) => p.code === row.period)?.label || row.period;
    for (const [game, name, nums, mx] of DAILY_GAMES) {
      out.push({ game, period: row.period, label: `${label} — ${name}`,
        numbers: nums(row), multiplier: mx(row) });
    }
  }
  for (const row of scope.cashPops || []) {
    const label = CASH_POP_PERIODS.find((p) => p.code === row.period)?.label || row.period;
    out.push({ game: 'cash_pop', period: row.period, label,
      numbers: row.number != null ? [row.number] : null });
  }
  for (const [game, row, label] of [['lotto', scope.lotto, 'Lotto'], ['super6', scope.super6, 'Super 6']]) {
    if (!row) continue;
    out.push({ game, period: null, label,
      numbers: row.numbers?.length ? row.numbers : null, letter: row.free_ticket_letter });
  }
  return out;
}

/**
 * Before sending: does what we are about to publish agree with play.nla.gd?
 *
 * Returns { mismatches, unverified, verified }.
 *   mismatches  the site disagrees — BLOCKING
 *   unverified  the site no longer shows this draw — a warning, not a pass
 */
export function verifyScope(scope, items) {
  const mismatches = [];
  const unverified = [];
  let verified = 0;

  for (const d of expectedDraws(scope)) {
    if (!d.numbers) continue;                       // nothing entered; validation reports that
    const site = find(items, d.game, d.period);
    if (!site) {
      unverified.push(`${d.label} — no longer shown on play.nla.gd, so it could not be checked.`);
      continue;
    }
    const problems = [];
    if (!sameNumbers(d.game, d.numbers, site.numbers)) {
      problems.push(`numbers ${display(d.game, d.numbers)} but play.nla.gd has ${display(d.game, site.numbers)}`);
    }
    if (!sameValue(d.multiplier, site.multiplier)) {
      problems.push(`Multi-X ${d.multiplier} but play.nla.gd has ${site.multiplier}`);
    }
    if (!sameValue(d.letter, site.letter)) {
      problems.push(`letter ${d.letter} but play.nla.gd has ${site.letter}`);
    }
    if (problems.length) mismatches.push(`${d.label} — ${problems.join('; ')}.`);
    else verified += 1;
  }
  return { mismatches, unverified, verified };
}

/**
 * After a draw: which EMPTY fields can be filled from play.nla.gd?
 *
 * Only ever fills what is blank. Never overwrites anything an operator has
 * typed, never sets the draw number (that stays a deliberate "Use" click), and
 * never saves a jackpot over one already entered.
 *
 * Returns [{ kind, key, patch, label }].
 */
export function fillsFor(date, state, items) {
  const fills = [];
  for (const i of items) {
    if (i.drawDate !== date) continue;

    if (i.game === 'play_way' || i.game === 'pick3' || i.game === 'cash4') {
      const row = state.daily.find((r) => r.period === i.period);
      const patch = {};
      if (i.game === 'play_way' && row?.play_way_number == null) {
        patch.play_way_number = i.numbers[0];
        if (!row?.play_way_multiplier && i.multiplier) patch.play_way_multiplier = i.multiplier;
      }
      if (i.game === 'pick3' && !row?.pick3_digits?.length) {
        patch.pick3_digits = i.numbers;
        if (!row?.pick3_multiplier && i.multiplier) patch.pick3_multiplier = i.multiplier;
      }
      if (i.game === 'cash4' && !row?.cash4_digits?.length) {
        patch.cash4_digits = i.numbers;
        if (!row?.cash4_multiplier && i.multiplier) patch.cash4_multiplier = i.multiplier;
      }
      if (Object.keys(patch).length) {
        /* Play Way, Pick 3 and Cash 4 share ONE row per draw period. Merge them
           into a single patch, so the row is saved once. Three separate saves
           in quick succession could each read a stale copy of the row and blank
           out what the one before had just written. */
        const same = fills.find((f) => f.kind === 'daily' && f.key === i.period);
        if (same) Object.assign(same.patch, patch);
        else fills.push({ kind: 'daily', key: i.period, patch, label: 'Daily draw' });
      }
    } else if (i.game === 'cash_pop') {
      const row = state.cashPops.find((r) => r.period === i.period);
      if (row?.number == null) {
        fills.push({ kind: 'pop', key: i.period, patch: { number: i.numbers[0] }, label: 'Cash Pop' });
      }
    } else if (i.game === 'lotto' || i.game === 'super6') {
      const row = i.game === 'lotto' ? state.lotto : state.super6;
      const patch = {};
      if (!row?.numbers?.length) patch.numbers = i.numbers;
      if (!row?.free_ticket_letter && i.letter) patch.free_ticket_letter = i.letter;
      if ((row?.jackpot_amount == null) && i.jackpot) patch.jackpot_amount = i.jackpot;
      if (Object.keys(patch).length) {
        fills.push({ kind: i.game, key: i.game, patch, label: i.game === 'lotto' ? 'Lotto' : 'Super 6' });
      }
    }
  }
  return fills;
}
