/** Today in Grenada (AST, UTC-4, no daylight saving), as YYYY-MM-DD. */
export function todayLocal(offsetHours = -4) {
  return new Date(Date.now() + offsetHours * 3600 * 1000).toISOString().slice(0, 10);
}

export function shiftDate(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minutes since midnight, local to Grenada — drives the 'due next' marker. */
export function minutesNow(offsetHours = -4) {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const to12h = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')}${ampm}`;
};
