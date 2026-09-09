#!/usr/bin/env node
/**
 * set-jackpot.mjs — set the stored jackpot on the last Lotto or Super 6 draw.
 *
 * The portal keeps the jackpot on the most recently stored draw. Changing it is
 * a correction to that draw, so this uses PUT (the API's correction route) and
 * resends the winning numbers and letter exactly as the portal already holds
 * them — only the jackpot changes.
 *
 *   node set-jackpot.mjs --token YOUR_TOKEN --game lotto --amount 148000 --dry-run
 *   node set-jackpot.mjs --token YOUR_TOKEN --game lotto --amount 148000
 *
 * Options
 *   --token  <t>   API token (or set NLA_API_TOKEN)
 *   --game   <g>   lotto | super6            (default lotto)
 *   --amount <n>   the new jackpot           (required)
 *   --won          the jackpot was won, so a LOWER figure is expected
 *   --base   <url> default https://about.nla.gd/omp/api/v1
 *   --dry-run      validate only, write nothing
 */

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt  = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const TOKEN  = opt('token', process.env.NLA_API_TOKEN || '');
const GAME   = opt('game', 'lotto');
const AMOUNT = Number(opt('amount', ''));
const BASE   = opt('base', 'https://about.nla.gd/omp/api/v1').replace(/\/$/, '');
const DRY    = flag('dry-run');
const WON    = flag('won');

if (!TOKEN)                       fail('Missing --token');
if (!['lotto','super6'].includes(GAME)) fail('--game must be lotto or super6');
if (!Number.isFinite(AMOUNT) || AMOUNT <= 0) fail('--amount must be a positive number');

function fail(m) { console.error(`\n  ${m}\n`); process.exit(1); }

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const money = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 });

(async () => {
  console.log(`\n  Set ${GAME} jackpot${DRY ? '   (DRY RUN — nothing will be written)' : ''}`);
  console.log(`  ${BASE}\n`);

  // 1. What does the portal hold right now?
  let info;
  try {
    const res = await fetch(`${BASE}/results/${GAME}/next`, { headers });
    if (!res.ok) fail(`Could not read the portal: ${res.status} ${await res.text().catch(()=> '')}`);
    info = await res.json();
  } catch (e) { fail(`Could not reach the portal: ${e.message}`); }

  const drawNo  = info.last_draw?.draw_number;
  const drawDt  = info.last_draw?.draw_date;
  const current = info.last_jackpot != null ? Number(info.last_jackpot) : null;

  if (!drawNo) fail(`The portal has no stored ${GAME} draw to update.`);

  console.log(`  Last stored draw : ${drawNo}   ${drawDt || ''}`);
  console.log(`  Current jackpot  : ${current != null ? '$' + money(current) : '(none)'}`);
  console.log(`  New jackpot      : $${money(AMOUNT)}`);
  console.log(`  Next draw will be: ${info.next_draw_number}\n`);

  if (current === AMOUNT) {
    console.log('  Already set to that figure. Nothing to do.\n');
    process.exit(0);
  }
  if (current != null && AMOUNT < current && !WON) {
    console.log(`  NOTE: the new figure is LOWER than the stored one. The portal rejects`);
    console.log(`  that unless the jackpot was won. If it was, re-run with --won.\n`);
  }

  // 2. Read the stored draw back — PUT needs the full record, and we must not
  //    disturb the winning numbers or letter.
  let numbers = null, letter = '';
  try {
    const res = await fetch(`${BASE}/results/${GAME}?limit=10`, { headers });
    if (res.ok) {
      const p = await res.json();
      const rows = Array.isArray(p) ? p
        : Array.isArray(p?.results) ? p.results
        : Array.isArray(p?.data) ? p.data
        : Array.isArray(p?.[GAME]) ? p[GAME]
        : (p && p.winning_numbers) ? [p] : [];
      const row = rows.find(r => Number(r.draw_number) === Number(drawNo)) || rows[0];
      if (row) {
        numbers = String(row.winning_numbers ?? '')
          .split(/[,\s]+/).map(Number).filter(Number.isFinite);
        letter = row.winning_letter || '';
      }
    }
  } catch { /* fall through to the check below */ }

  if (!numbers?.length) {
    fail(`Could not read the winning numbers for ${GAME} draw ${drawNo}.\n`
       + `  The list endpoint returned an unexpected shape. Ask the web admin what\n`
       + `  GET /results/${GAME}?limit=1 returns, and this can be adjusted.`);
  }

  console.log(`  Preserving numbers: ${numbers.map(n => String(n).padStart(2,'0')).join(' ')}`
            + (letter ? `   letter ${letter}` : ''));

  // 3. PUT the correction.
  const body = { winning_numbers: numbers, winning_letter: letter, jackpot: AMOUNT };
  if (WON) body.jackpot_reset = true;

  const url = `${BASE}/results/${GAME}/${drawNo}${DRY ? '?validate=1' : ''}`;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');

  if (res.ok) {
    console.log(`\n  ${DRY ? 'Valid — nothing written.' : `Updated. Draw ${drawNo} jackpot is now $${money(AMOUNT)}.`}`);
    if (DRY) console.log('  Re-run without --dry-run to apply.');
    console.log();
    process.exit(0);
  }

  console.log(`\n  Failed: ${res.status}`);
  try {
    const j = JSON.parse(text);
    if (j.errors) for (const [k, v] of Object.entries(j.errors)) console.log(`    ${k}: ${v}`);
    else if (j.message) console.log(`    ${j.message}`);
  } catch { console.log(`    ${text.slice(0, 300)}`); }
  console.log();
  process.exit(1);
})();
