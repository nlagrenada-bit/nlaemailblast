#!/usr/bin/env node
/**
 * Backfill historical draw results into Supabase from the NLA "Winning Numbers
 * for Period" and "Revenue and Prize Summary for Period" exports.
 *
 *   node scripts/import-history.mjs \
 *        --csv       "Winning_Numbers_for_Period-Pick_3cash4.csv" \
 *        --xlsx      "Winning_Numbers_for_Period.xlsx" \
 *        --prizes-daily   "Revenue_and_Prize_Summary_for_Period-Dailies.csv" \
 *        --prizes-jackpot "Revenue_and_Prize_Summary_for_Period-Jackpot.csv" \
 *        [--dry-run] [--from 2020-01-01] [--to 2026-12-31]
 *
 * Payouts: the prize files list each game and its Multi-X as separate rows,
 * matched by draw number. The Multi-X prize is ADDED to the base-game prize to
 * give the total payout the app displays — e.g. Play Way 13,704 + Multi-X
 * 34,464 = 48,168. The figure comes from the "Total Prizes" column.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (the
 * service key, because this writes across every results table). Reads them
 * from a .env file if present.
 *
 * The exports are "unpivoted": each game's result for a draw sits on its own
 * row, sharing a draw number and timestamp. Draw times in older data drift a
 * little (an evening draw logged at 18:45 rather than 19:45), so each row is
 * snapped to its nearest scheduled slot rather than matched exactly. Anything
 * that can't be placed is reported at the end rather than silently dropped.
 *
 * Safe to re-run: every write is an upsert keyed on (date, period) or date.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

// ------------------------------------------------------------------ args

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]);
    return acc;
  }, []),
);
const DRY = !!args['dry-run'];
const FROM = args.from || '2000-01-01';
const TO = args.to || '2999-12-31';

// ------------------------------------------------------------- env / db

function loadEnv() {
  const p = path.resolve('.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY && (!url || !key)) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or use --dry-run).');
  process.exit(1);
}
const db = (!DRY) ? createClient(url, key, { auth: { persistSession: false } }) : null;

// -------------------------------------------------------------- helpers

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** 'Aug 19 2026 09:45:00' or a Date -> { date:'2026-08-19', hhmm:'09:45' } */
function parseDt(v) {
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`, hhmm: `${p(v.getHours())}:${p(v.getMinutes())}` };
  }
  const m = String(v).trim().match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  if (mon === undefined) return null;
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${m[3]}-${p(mon + 1)}-${p(Number(m[2]))}`, hhmm: `${m[4]}:${m[5]}` };
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Snap a clock time to the nearest scheduled slot within `tolMin` minutes. */
function nearest(hhmm, slots, tolMin = 90) {
  const t = toMin(hhmm);
  let best = null, bestD = Infinity;
  for (const [slot, code] of Object.entries(slots)) {
    const d = Math.abs(toMin(slot) - t);
    if (d < bestD) { bestD = d; best = code; }
  }
  return bestD <= tolMin ? best : null;
}

const DAILY_SLOTS = { '09:45': 'mid_morning', '12:45': 'midday', '16:45': 'mid_afternoon', '19:45': 'evening' };
const POP_SLOTS = { '08:45': 'kick_off', '11:45': 'mid_rush', '14:45': 'lunch', '17:45': 'after_work', '20:45': 'prime_time' };

const digits = (s) => String(s).replace(/\D/g, '').split('').map(Number);
const nums = (s) => String(s).trim().split(/\s+/).map((n) => Number(n)).filter((n) => !Number.isNaN(n));

const VALID_MX = new Set(['FP', '2X', '3X', '5X', '7X', '10X']);
/** Accept only real Multi-X tokens; the export occasionally puts stray values
 *  in these columns, and the DB (rightly) rejects anything else. */
const mx = (s) => {
  const v = String(s).trim().toUpperCase().replace(/\s+/g, '');
  return VALID_MX.has(v) ? v : null;
};
const inRange = (d) => d >= FROM && d <= TO;

const report = { daily: 0, cashPop: 0, lotto: 0, super6: 0, skipped: [] };

// ---------------------------------------------------------------- CSV

function readCsvUtf16(file) {
  // The export is UTF-16 with a 3-row header, comma-separated inside each cell.
  const buf = fs.readFileSync(file);
  let text;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.toString('utf16le');
  else text = buf.toString('utf8');
  const lines = text.split(/\r?\n/).slice(3).filter((l) => l.trim());
  return lines.map(parseCsvLine);
}

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function importDaily(file, prizes) {
  const rows = readCsvUtf16(file);
  // col: 0 drawNo 1 dt 2 metrics 3 Daily3 4 PlayWay 5 Cash4 6 MX-PW 7 MX-D3 8 MX-C4 9 JP-PW
  const grouped = new Map();   // `${date}|${period}` -> record
  for (const r of rows) {
    const dt = parseDt(r[1]);
    if (!dt || !inRange(dt.date)) continue;
    const period = nearest(dt.hhmm, DAILY_SLOTS);
    if (!period) { report.skipped.push(`daily ${dt.date} ${dt.hhmm} (no slot) draw ${r[0]}`); continue; }
    const k = `${dt.date}|${period}`;
    const rec = grouped.get(k) || { draw_date: dt.date, period };
    const dn = Number(r[0]) || null;
    // Pick 3 must be exactly 3 digits, Cash 4 exactly 4, Play Way 1-36.
    if (r[3]?.trim()) {
      const d = digits(r[3]);
      if (d.length === 3) {
        rec.pick3_digits = d; rec.pick3_draw_no = dn;
        if (prizes) rec.pick3_payout = totalPayout(prizes.get(`pick3:${r[0].trim()}`));
      } else report.skipped.push(`pick3 ${dt.date} ${period}: "${r[3]}" not 3 digits`);
    }
    if (r[4]?.trim()) {
      const pw = Number(r[4]);
      if (pw >= 1 && pw <= 36) {
        rec.play_way_number = pw; rec.play_way_draw_no = dn;
        if (prizes) rec.play_way_payout = totalPayout(prizes.get(`play_way:${r[0].trim()}`));
      } else report.skipped.push(`playway ${dt.date} ${period}: "${r[4]}" out of 1-36`);
    }
    if (r[5]?.trim()) {
      const d = digits(r[5]);
      if (d.length === 4) {
        rec.cash4_digits = d; rec.cash4_draw_no = dn;
        if (prizes) rec.cash4_payout = totalPayout(prizes.get(`cash4:${r[0].trim()}`));
      } else report.skipped.push(`cash4 ${dt.date} ${period}: "${r[5]}" not 4 digits`);
    }
    if (mx(r[6])) rec.play_way_multiplier = mx(r[6]);
    if (mx(r[7])) rec.pick3_multiplier = mx(r[7]);
    if (mx(r[8])) rec.cash4_multiplier = mx(r[8]);
    grouped.set(k, rec);
  }
  return [...grouped.values()].map(normaliseMultipliers);
}

// multipliers in the export use lowercase 'x' (5x) and the app expects '5X'
function normaliseMultipliers(rec) {
  for (const f of ['play_way_multiplier', 'pick3_multiplier', 'cash4_multiplier']) {
    if (rec[f]) rec[f] = rec[f].toUpperCase().replace('X', 'X');
  }
  return rec;
}

// --------------------------------------------------------------- XLSX

function importJackpotGames(file, prizes) {
  const wb = XLSX.readFile(file, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  // header is 5 rows; data starts at index 5
  // col: 0 drawNo 1 dt 2 metrics 3 LOTTO 4 SUPER6 5 CashPop 6 LOTTO-ltr 7 SUPER6-ltr 8 LOTTO-jp 9 SUPER6-jp
  const lotto = [], super6 = [], pops = [];
  for (const r of rows.slice(5)) {
    if (!r[0]) continue;
    const dt = parseDt(r[1]);
    if (!dt || !inRange(dt.date)) continue;
    const dn = Number(r[0]) || null;
    const money = (v) => (v == null || v === '' ? null : Number(String(v).replace(/[,$]/g, '')));

    if (r[3] && String(r[3]).trim()) {
      lotto.push({
        draw_date: dt.date, draw_no: dn, numbers: nums(r[3]),
        free_ticket_letter: (r[6] || '').toString().trim() || null,
        jackpot_amount: money(r[8]), jackpot_winners: 0,
      });
    }
    if (r[4] && String(r[4]).trim()) {
      super6.push({
        draw_date: dt.date, draw_no: dn, numbers: nums(r[4]),
        free_ticket_letter: (r[7] || '').toString().trim() || null,
        jackpot_amount: money(r[9]), jackpot_winners: 0,
      });
    }
    if (r[5] && String(r[5]).trim()) {
      const period = nearest(dt.hhmm, POP_SLOTS);
      if (!period) { report.skipped.push(`cashpop ${dt.date} ${dt.hhmm} (no slot) draw ${dn}`); continue; }
      const pop = { draw_date: dt.date, period, draw_no: dn, number: Number(r[5]) };
      if (prizes && dn) pop.payout = totalPayout(prizes.get(`cash_pop:${dn}`));
      pops.push(pop);
    }
  }
  return { lotto, super6, pops };
}

// --------------------------------------------------------------- prizes

const money = (s) => {
  if (s == null || s === '') return 0;
  const n = Number(String(s).replace(/[,$]/g, ''));
  return Number.isNaN(n) ? 0 : n;
};

/**
 * Reads a Revenue and Prize Summary file (UTF-16, header on row 3) and returns
 * total payouts keyed by draw number. Each base game and its Multi-X are
 * separate rows sharing a draw number; the Multi-X "Total Prizes" is added to
 * the base game's, because that is the combined payout the app shows.
 *
 * @returns {Map<string, {base:number, mx:number}>} keyed `${gameKey}:${drawNo}`
 */
function readPrizes(file) {
  const buf = fs.readFileSync(file);
  const text = (buf[0] === 0xff && buf[1] === 0xfe) ? buf.toString('utf16le') : buf.toString('utf8');
  const lines = text.split(/\r?\n/).slice(3).filter((l) => l.trim());
  // columns: Game, Draw Number, Draw Date, Sales, Fees, Total Prizes
  const GAME_KEY = {
    'PLAY WAY': 'play_way', 'DAILY 3': 'pick3', 'CASH 4': 'cash4',
    'CASH POP': 'cash_pop', 'LOTTO': 'lotto', 'SUPER 6': 'super6',
  };
  const out = new Map();
  for (const line of lines) {
    const c = parseCsvLine(line);
    const rawGame = (c[0] || '').trim();
    const drawNo = (c[1] || '').trim();
    if (!rawGame || !drawNo) continue;

    const isMx = /^Multi-X-/i.test(rawGame);
    const baseName = rawGame.replace(/^Multi-X-/i, '').trim().toUpperCase();
    const gameKey = GAME_KEY[baseName];
    if (!gameKey) continue;

    const k = `${gameKey}:${drawNo}`;
    const rec = out.get(k) || { base: 0, mx: 0 };
    if (isMx) rec.mx += money(c[5]);
    else rec.base += money(c[5]);
    out.set(k, rec);
  }
  return out;
}

const totalPayout = (rec) => (rec ? Math.round((rec.base + rec.mx) * 100) / 100 : null);

async function upsert(table, rows, conflict) {
  if (!rows.length) return;
  if (DRY) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from(table).upsert(chunk, { onConflict: conflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    process.stdout.write(`\r  ${table}: ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

// ----------------------------------------------------------------- run

async function main() {
  console.log(DRY ? 'DRY RUN — nothing will be written\n' : 'Importing to Supabase\n');

  const dailyPrizes = args['prizes-daily'] ? readPrizes(args['prizes-daily']) : null;
  const jackpotPrizes = args['prizes-jackpot'] ? readPrizes(args['prizes-jackpot']) : null;
  if (dailyPrizes) console.log(`Loaded daily prize rows for ${dailyPrizes.size} game-draws`);
  if (jackpotPrizes) console.log(`Loaded jackpot prize rows for ${jackpotPrizes.size} game-draws`);

  if (args.csv) {
    const daily = importDaily(args.csv, dailyPrizes);
    report.daily = daily.length;
    const withPayout = daily.filter((d) => d.play_way_payout || d.pick3_payout || d.cash4_payout).length;
    console.log(`Daily games (Play Way / Pick 3 / Cash 4): ${daily.length} draw periods`
      + (dailyPrizes ? `, ${withPayout} with payouts` : ''));
    await upsert('daily_results', daily, 'draw_date,period');
  }

  if (args.xlsx) {
    const { lotto, super6, pops } = importJackpotGames(args.xlsx, jackpotPrizes);
    report.lotto = lotto.length; report.super6 = super6.length; report.cashPop = pops.length;
    console.log(`Lotto: ${lotto.length}  ·  Super 6: ${super6.length}  ·  Cash Pop: ${pops.length}`);
    await upsert('lotto_results', lotto, 'draw_date');
    await upsert('super6_results', super6, 'draw_date');
    await upsert('cash_pop_results', pops, 'draw_date,period');
  }

  console.log('\nSummary');
  console.log(`  daily periods: ${report.daily}`);
  console.log(`  cash pop:      ${report.cashPop}`);
  console.log(`  lotto:         ${report.lotto}`);
  console.log(`  super 6:       ${report.super6}`);
  if (report.skipped.length) {
    console.log(`\n  ${report.skipped.length} row(s) could not be placed on a schedule slot:`);
    for (const s of report.skipped.slice(0, 20)) console.log(`    - ${s}`);
    if (report.skipped.length > 20) console.log(`    … and ${report.skipped.length - 20} more`);
  }
  console.log(DRY ? '\nDry run complete.' : '\nImport complete.');
}

main().catch((e) => { console.error('\nImport failed:', e.message); process.exit(1); });
