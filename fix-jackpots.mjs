#!/usr/bin/env node
/**
 * fix-jackpots.mjs — repairs the stored jackpot on Lotto and Super 6 draws
 * that are already on the site.
 *
 * Uses PUT (the API's correction route), so it updates existing records rather
 * than creating anything. Winning numbers and letters are resent unchanged
 * alongside the jackpot, because PUT expects the full payload.
 *
 *   node fix-jackpots.mjs --token YOUR_TOKEN --dry-run
 *   node fix-jackpots.mjs --token YOUR_TOKEN
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt  = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const TOKEN = opt('token', process.env.NLA_API_TOKEN || '');
const BASE  = opt('base', 'https://about.nla.gd/omp/api/v1').replace(/\/$/, '');
const DRY   = flag('dry-run');

if (!TOKEN) { console.error('\n  Missing --token\n'); process.exit(1); }

const items = JSON.parse(fs.readFileSync(path.join(__dir, 'catchup-data.json'), 'utf8'))
  .filter((i) => (i.game === 'lotto' || i.game === 'super6') && i.jackpot > 0)
  .sort((a, b) => a.game.localeCompare(b.game) || a.draw_number - b.draw_number);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\n  Jackpot repair ${DRY ? '(DRY RUN)' : '(LIVE)'}`);
console.log(`  ${items.length} draw(s)\n`);

let ok = 0, bad = 0;
for (const it of items) {
  const { game, draw_number, ...body } = it;
  const url = `${BASE}/results/${game}/${draw_number}${DRY ? '?validate=1' : ''}`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.ok) { ok++; console.log(`  ${game.padEnd(8)} ${draw_number}  ✓ jackpot ${body.jackpot}`); }
    else {
      bad++;
      const t = await res.text().catch(() => '');
      console.log(`  ${game.padEnd(8)} ${draw_number}  ✗ ${res.status} ${t.replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  } catch (e) {
    bad++; console.log(`  ${game.padEnd(8)} ${draw_number}  ✗ ${e.message}`);
  }
  await sleep(2200);
}
console.log(`\n  Done.  updated: ${ok}   failed: ${bad}\n`);
