// Builds a sample blast from a full day of results.
// Useful for eyeballing template changes without touching the database:
//   node scripts/sample-email.mjs eod > /tmp/preview.html
import { buildDoc } from '../shared/buildDoc.js';
import { buildEmail } from '../shared/emailTemplate.js';

const kind = process.argv[2] || 'eod';
const date = '2026-07-31';
const assetBase = process.env.ASSET_BASE || 'http://localhost:8888/assets';

const daily = [
  {
    period: 'mid_morning', play_way_draw_no: 14207, pick3_draw_no: 14207, cash4_draw_no: 14207, play_way_number: 35, play_way_multiplier: '3X', play_way_payout: 27144,
    pick3_digits: [2, 2, 3], pick3_multiplier: '5X', pick3_payout: 9260,
    cash4_digits: [1, 6, 8, 8], cash4_multiplier: 'FP', cash4_payout: 4100,
  },
  {
    period: 'midday', play_way_draw_no: 14208, pick3_draw_no: 14208, cash4_draw_no: 14208, play_way_number: 14, play_way_multiplier: 'FP', play_way_payout: 5112,
    pick3_digits: [1, 8, 4], pick3_multiplier: 'FP', pick3_payout: 2530,
    cash4_digits: [0, 1, 2, 0], cash4_multiplier: 'FP', cash4_payout: 4550,
  },
  {
    period: 'mid_afternoon', play_way_draw_no: 14209, pick3_draw_no: 14209, cash4_draw_no: 14209, play_way_number: 27, play_way_multiplier: 'FP', play_way_payout: 10152,
    pick3_digits: [9, 3, 4], pick3_multiplier: '3X', pick3_payout: 4000,
    cash4_digits: [5, 1, 5, 0], cash4_multiplier: 'FP', cash4_payout: 2000,
  },
  {
    period: 'evening', play_way_draw_no: 14210, pick3_draw_no: 14210, cash4_draw_no: 14210, play_way_number: 34, play_way_multiplier: 'FP', play_way_payout: 14016,
    pick3_digits: [5, 0, 4], pick3_multiplier: '3X', pick3_payout: 5700,
    cash4_digits: [6, 1, 3, 0], cash4_multiplier: 'FP', cash4_payout: 6200,
  },
];

const cashPops = [
  { period: 'kick_off', draw_no: 9051, number: 5, payout: 1054 },
  { period: 'mid_rush', draw_no: 9052, number: 6, payout: 722 },
  { period: 'lunch', draw_no: 9053, number: 3, payout: 86 },
  { period: 'after_work', draw_no: 9054, number: 8, payout: 240 },
  { period: 'prime_time', draw_no: 9055, number: 4, payout: 604 },
];

const lotto = {
  draw_no: 3312,
  numbers: [4, 7, 17, 25, 34], free_ticket_letter: 'G',
  match4_winners: 0, match4_payout: null,
  match3_winners: 70, match3_payout: 13,
  jackpot_winners: 0, jackpot_amount: 120000,
};

const super6 = {
  draw_no: 1874,
  numbers: [4, 6, 9, 17, 19, 28], free_ticket_letter: 'E',
  match4_winners: 39, match4_payout: 25,
  match5_winners: 1, match5_payout: 500,
  jackpot_winners: 0, jackpot_amount: 210000,
};

const settings = { greeting: 'Dear All,' };

const scopes = {
  eod: { daily, cashPops, lotto, super6 },
  daily_period: { daily: [daily[0]], cashPops: [], lotto: null, super6: null },
  cash_pop: { daily: [], cashPops, lotto: null, super6: null },
  lotto: { daily: [], cashPops: [], lotto, super6: null },
  super6: { daily: [], cashPops: [], lotto: null, super6 },
};

const doc = buildDoc({ date, kind, settings, ...scopes[kind] });
const email = buildEmail(doc, { assetBase });

if (process.argv.includes('--text')) {
  process.stdout.write(email.text);
} else {
  process.stdout.write(email.html);
}
process.stderr.write(`\nSubject: ${email.subject}\n`);
