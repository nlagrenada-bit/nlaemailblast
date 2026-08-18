// Shared domain model. Imported by both the browser app and the Netlify
// functions, so it must stay dependency-free and side-effect-free.

/** Draw periods for the daily games (Play Way / Pick 3 / Cash 4). */
export const DAILY_PERIODS = [
  { code: 'mid_morning', time: '09:45', label: 'Mid-Morning Draw', banner: 'MID-MORNING' },
  { code: 'midday', time: '12:45', label: 'Midday Draw', banner: 'MID-DAY' },
  { code: 'mid_afternoon', time: '16:45', label: 'Mid-Afternoon Draw', banner: 'AFTERNOON' },
  { code: 'evening', time: '19:45', label: 'Evening Draw', banner: 'EVENING' },
];

/** The five Cash Pop draws. */
export const CASH_POP_PERIODS = [
  { code: 'kick_off', time: '08:45', label: 'Kick-Off Pop', banner: 'KICK-OFF POP' },
  { code: 'mid_rush', time: '11:45', label: 'Mid-Rush Pop', banner: 'MID-RUSH POP' },
  { code: 'lunch', time: '14:45', label: 'Lunch Pop', banner: 'LUNCH POP' },
  { code: 'after_work', time: '17:45', label: 'After-Work Pop', banner: 'AFTER-WORK POP' },
  { code: 'prime_time', time: '20:45', label: 'Prime-Time Pop', banner: 'PRIME-TIME POP' },
];

export const GAMES = {
  play_way: { name: 'Play Way', banner: 'PLAY WAY', logo: 'playway.png', min: 1, max: 36, digits: 1, seq: 'play_way' },
  pick3: { name: 'Daily Pick 3', banner: 'DAILY PICK 3', logo: 'pick3.png', count: 3, seq: 'pick3' },
  cash4: { name: 'Daily Cash 4', banner: 'DAILY CASH 4', logo: 'cash4.png', count: 4, seq: 'cash4' },
  cash_pop: { name: 'Cash Pop', banner: 'CASH POP', logo: 'cashpop.png', min: 1, max: 15, seq: 'cash_pop' },
  lotto: { name: 'Lotto', banner: 'LOTTO', logo: 'lotto.png', pick: 5, min: 1, max: 34, seq: 'lotto' },
  super6: { name: 'Super 6', banner: 'SUPER 6', logo: 'super6.png', pick: 6, min: 1, max: 28, seq: 'super6' },
  multix: { name: 'Multi-X', banner: 'MULTI-X', logo: 'multix.png' },
};

/**
 * Every game keeps its own running draw number. The sequence belongs to the
 * *draw*, not to the calendar: if a draw is postponed, cancelled or moved to
 * another day, the number travels with it and the next draw continues from
 * where the sequence actually left off. That is why draw numbers are stored
 * explicitly on each result rather than derived from the date — the app
 * suggests the next number and warns about gaps and repeats, but the operator
 * always has the final say.
 */
export const DRAW_SEQUENCES = ['play_way', 'pick3', 'cash4', 'cash_pop', 'lotto', 'super6'];

/** '4821' -> 'Draw No. 4821'. Draw numbers are never comma-grouped. */
export const drawNo = (n) =>
  (n === null || n === undefined || n === '' ? '' : `Draw No. ${n}`);

/** Multi-X outcomes. FP = Free Play. */
export const MULTIPLIERS = ['FP', '2X', '3X', '5X', '7X', '10X'];

/** Normal weekly schedule. 0 = Sunday. Overridable per date by a schedule exception. */
export const WEEKLY_SCHEDULE = {
  daily: [1, 2, 3, 4, 5, 6],   // Mon-Sat: Play Way, Pick 3, Cash 4, Cash Pop
  lotto: [1, 3, 5],            // Mon, Wed, Fri
  super6: [2, 5],              // Tue, Fri
};

/** Play Way chart, 1-36. Symbol art lives at {ASSET_BASE}/playway/NN.png */
export const PLAY_WAY_SYMBOLS = [
  'SUN', 'FISH', 'HOUSE', 'CROSSROAD', 'DOG', 'DEATH', 'MONEY', 'SPIDER', 'CAT',
  'POLICE', 'SNAKE', 'CAR', 'BLACK BIRD', 'OLD WOMAN', 'LIZARD', 'BUS DRIVER',
  'MONGOOSE', 'LOVE-MAKING', 'BLOOD', 'BELLY', 'WEDDING', 'GARBAGE', 'RAT',
  'STRONG MAN', 'FIRE', 'YARD FOWL', 'SPIRIT', 'BOAT', 'SICKNESS',
  'BEAUTIFUL WOMAN', 'COCKROACH', 'DIRTY WATER', 'CENTIPEDE', 'MACKO',
  'CRAPAUD', 'VAGRANT',
];

export const symbolFor = (n) => PLAY_WAY_SYMBOLS[Number(n) - 1] || '';
export const symbolImage = (n) => `playway/${String(n).padStart(2, '0')}.png`;

/** Free-ticket letters A-O and the word read out with each. Editable in Settings. */
export const DEFAULT_LETTER_WORDS = {
  A: 'APPLE', B: 'BOY', C: 'CAT', D: 'DOG', E: 'EQUAL', F: 'FISH', G: 'GRAND',
  H: 'HOUSE', I: 'ISLAND', J: 'JOY', K: 'KING', L: 'LOVE', M: 'MONEY',
  N: 'NATION', O: 'OCEAN',
};
export const LETTERS = Object.keys(DEFAULT_LETTER_WORDS);

// ---------------------------------------------------------------- formatting

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY',
  'SATURDAY'];

export function ordinal(d) {
  if (d > 3 && d < 21) return `${d}th`;
  return `${d}${({ 1: 'st', 2: 'nd', 3: 'rd' })[d % 10] || 'th'}`;
}

/** '2026-07-31' -> 'FRIDAY 31st JULY 2026' (matches the house style exactly). */
export function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAYS[dt.getUTCDay()]} ${ordinal(d)} ${MONTHS[m - 1]} ${y}`;
}

export function weekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 1054 -> '$1,054.00' */
export function money(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** '2,2,3' from [2,2,3]; Lotto/Super 6 are zero-padded: '04,07,17,25,34' */
export const joinDigits = (a) => (a || []).join(',');
export const joinPadded = (a) => (a || []).map((n) => String(n).padStart(2, '0')).join(',');

export const periodByCode = (code) =>
  [...DAILY_PERIODS, ...CASH_POP_PERIODS].find((p) => p.code === code);

export function gamesScheduledOn(iso, exception) {
  if (exception?.cancelled) return { daily: false, lotto: false, super6: false, cash_pop: false };
  const dow = weekday(iso);
  return {
    daily: exception?.daily ?? WEEKLY_SCHEDULE.daily.includes(dow),
    cash_pop: exception?.cash_pop ?? WEEKLY_SCHEDULE.daily.includes(dow),
    lotto: exception?.lotto ?? WEEKLY_SCHEDULE.lotto.includes(dow),
    super6: exception?.super6 ?? WEEKLY_SCHEDULE.super6.includes(dow),
  };
}
