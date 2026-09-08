#!/usr/bin/env node
/**
 * catch-up.mjs — brings the NLA website up to date via the OMP Results API v1.
 *
 * Posts every draw the site is missing, in strict draw-number order per game,
 * which is what the API's sequence validation requires (draw_number must be
 * exactly last + 1).
 *
 *   Dry run first — validates everything, writes nothing:
 *     node catch-up.mjs --token YOUR_TOKEN --dry-run
 *
 *   Then the real run:
 *     node catch-up.mjs --token YOUR_TOKEN
 *
 * Options:
 *   --token   <t>   API bearer token          (or set NLA_API_TOKEN)
 *   --base    <url> API base URL              (default https://about.nla.gd/omp/api/v1)
 *   --game    <g>   only this game            (lotto|super6|playway|dailypick3|cash4|cashpop)
 *   --dry-run       add ?validate=1 to every call; nothing is written
 *   --resume        skip ahead using each game's /next endpoint before sending
 *
 * Safe to re-run: it asks the API what it expects next, and skips anything
 * already stored. A draw that already exists returns 409, which is reported
 * and skipped rather than treated as a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt  = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const TOKEN = opt('token', process.env.NLA_API_TOKEN || '');
const BASE  = (opt('base', 'https://about.nla.gd/omp/api/v1')).replace(/\/$/, '');
const DRY   = flag('dry-run');
const ONLY  = opt('game', '');
const RESUME = flag('resume');

if (!TOKEN) {
  console.error('\n  Missing token. Use --token YOUR_TOKEN or set NLA_API_TOKEN.\n');
  process.exit(1);
}

// ------------------------------------------------------------- payloads
const DATA = path.join(__dir, 'catchup-data.json');
if (!fs.existsSync(DATA)) {
  console.error(`\n  Cannot find ${DATA}\n  Keep catch-up.mjs and catchup-data.json in the same folder.\n`);
  process.exit(1);
}
let items = JSON.parse(fs.readFileSync(DATA, 'utf8'));
if (ONLY) items = items.filter((i) => i.game === ONLY);

const GAME_ORDER = ['lotto', 'super6', 'playway', 'dailypick3', 'cash4', 'cashpop'];
items.sort((a, b) =>
  (GAME_ORDER.indexOf(a.game) - GAME_ORDER.indexOf(b.game)) ||
  (a.draw_number - b.draw_number));

// ------------------------------------------------------------- helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const headers = (idem) => {
  const h = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (idem) h['Idempotency-Key'] = idem;
  return h;
};

/** Strip the routing keys; the rest is the body the API wants. */
const bodyOf = ({ game, ...rest }) => rest;

async function nextExpected(game) {
  try {
    const res = await fetch(`${BASE}/results/${game}/next`, { headers: headers() });
    if (!res.ok) return null;
    const j = await res.json();
    return j.next_draw_number ?? j.draw_number ?? j.expected ?? null;
  } catch { return null; }
}

async function send(item) {
  const q = DRY ? '?validate=1' : '';
  const url = `${BASE}/results/${item.game}${q}`;
  const idem = `${item.game}-${item.draw_number}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: headers(idem), body: JSON.stringify(bodyOf(item)),
      });

      if (res.ok) return { ok: true, note: DRY ? 'valid' : 'created' };

      if (res.status === 409) return { ok: true, skipped: true, note: 'already stored' };

      if (res.status === 429 && attempt < 3) {
        const wait = Number(res.headers.get('retry-after') || 60);
        console.log(`      throttled, waiting ${wait}s…`);
        await sleep(wait * 1000);
        continue;
      }

      if (res.status >= 500 && attempt < 3) { await sleep(1500 * attempt); continue; }

      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, note: explain(res.status, text) };
    } catch (e) {
      if (attempt === 3) return { ok: false, note: e.message };
      await sleep(1000 * attempt);
    }
  }
  return { ok: false, note: 'unreachable' };
}

function explain(status, text) {
  try {
    const j = JSON.parse(text);
    if (j.errors) {
      return `${status} ` + Object.entries(j.errors).map(([k, v]) => `${k}: ${v}`).join('; ');
    }
    if (j.message) return `${status} ${j.message}`;
  } catch { /* not json */ }
  return `${status} ${String(text).replace(/\s+/g, ' ').slice(0, 160)}`;
}

// ------------------------------------------------------------------ run
(async () => {
  console.log(`\n  NLA catch-up  ${DRY ? '(DRY RUN — nothing will be written)' : '(LIVE)'}`);
  console.log(`  API: ${BASE}`);
  console.log(`  ${items.length} draw(s) to send\n`);

  // Optionally ask the API where each game actually stands, and skip past
  // anything it already has. Guards against a partial earlier run.
  if (RESUME) {
    console.log('  Checking what the API expects next…');
    for (const game of GAME_ORDER) {
      const n = await nextExpected(game);
      if (n) {
        const before = items.length;
        items = items.filter((i) => i.game !== game || i.draw_number >= n);
        const dropped = before - items.length;
        console.log(`    ${game.padEnd(11)} expects ${n}` + (dropped ? `  (skipping ${dropped} already stored)` : ''));
      }
    }
    console.log();
  }

  let created = 0, skipped = 0, failed = 0;
  let lastGame = '';

  for (const item of items) {
    if (item.game !== lastGame) {
      lastGame = item.game;
      console.log(`  ${item.game}`);
    }
    const r = await send(item);
    const tag = String(item.draw_number).padEnd(7);
    if (r.ok && r.skipped) { skipped++; console.log(`    ${tag} - ${r.note}`); }
    else if (r.ok)         { created++; console.log(`    ${tag} ✓ ${r.note}`); }
    else {
      failed++;
      console.log(`    ${tag} ✗ ${r.note}`);
      // A sequence error means everything after this will fail too — stop
      // rather than hammering the API with doomed requests.
      if (r.status === 422 && /sequence|draw_number/i.test(r.note)) {
        console.log(`\n  Stopping: the API rejected the draw number sequence for ${item.game}.`);
        console.log(`  Run with --resume to re-sync, or ask for an admin-scope token to backfill gaps.\n`);
        break;
      }
    }
    await sleep(2200);        // ~27/min, just inside the 30/min token limit
  }

  console.log(`\n  Done.  created: ${created}   skipped: ${skipped}   failed: ${failed}`);
  if (DRY) console.log('  Dry run — nothing was written. Re-run without --dry-run to apply.');
  console.log();
  process.exit(failed ? 1 : 0);
})();
