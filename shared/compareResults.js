/**
 * Do two results for the same draw agree?
 *
 * The one rule that matters: ORDER MEANS DIFFERENT THINGS IN DIFFERENT GAMES.
 *
 *   Pick 3, Cash 4      position IS the result. 9-0-4 and 0-4-9 are different
 *                       winning numbers, so these are compared in order.
 *   Lotto, Super 6      only the set matters. The desk types numbers in the
 *                       order they are called (15 9 14 13 7); play.nla.gd lists
 *                       them ascending (7 9 13 14 15). Same draw, same result.
 *   Play Way, Cash Pop  a single number, so order never arises.
 *
 * Used by assisted entry, the pre-send check and the auto-fill, so the three
 * can never disagree about what counts as a match.
 */

const ORDER_MATTERS = new Set(['pick3', 'cash4']);

const norm = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((n) => n !== '' && n !== null && n !== undefined)
    .map(Number)
    .filter(Number.isFinite);

export function sameNumbers(game, a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x.length || x.length !== y.length) return false;
  if (ORDER_MATTERS.has(game)) return x.every((v, i) => v === y[i]);
  const sx = [...x].sort((p, q) => p - q);
  const sy = [...y].sort((p, q) => p - q);
  return sx.every((v, i) => v === sy[i]);
}

/** Case-insensitive, ignores a missing value on either side. */
export function sameValue(a, b) {
  if (a === null || a === undefined || a === '') return true;
  if (b === null || b === undefined || b === '') return true;
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

/** How a list should be shown in a message: ascending for set games. */
export function display(game, list) {
  const x = norm(list);
  const shown = ORDER_MATTERS.has(game) ? x : [...x].sort((p, q) => p - q);
  return shown.join(' ');
}
