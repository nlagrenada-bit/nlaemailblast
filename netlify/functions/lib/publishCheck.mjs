// netlify/functions/lib/publishCheck.mjs
//
// Website publishing check. Answers two questions for one day:
//   1. Is the data getting through to each website?
//   2. If not, why not?
//
// Everything here runs FROM NETLIFY, with the real environment variables, so it
// sees exactly what a real push sees (same IP address, same token, same
// firewall treatment). A test run from an office PC can pass while Netlify is
// blocked, which is why this lives on the server.
//
// Nothing is written to either website:
//   * OMP portal: read-only GETs, plus "?validate=1" dry runs, which the API
//     documents as full validation with nothing stored.
//   * WordPress: reads the public /wp-json/ index only. WordPress has no dry
//     run, so the secret itself can only be proven by a real send.

import { buildApiPayloads, sendOne } from './websiteWebhook.mjs';
import { buildHexivePayloads, judgeReply, networkReason, pushResultsToHexive } from './hexiveWebhook.mjs';
import { loadDay } from './publishDay.mjs';

const OMP_BASE   = () => (process.env.WEBSITE_API_BASE || '').trim().replace(/\/$/, '');
const OMP_TOKEN  = () => (process.env.WEBSITE_API_TOKEN || '').trim();
const WP_BASE    = () => (process.env.HEXIVE_WEBHOOK_BASE || '').trim().replace(/\/$/, '');
const WP_SECRET  = () => (process.env.HEXIVE_WEBHOOK_SECRET || '').trim();

export const GAMES = ['play_way', 'pick3', 'cash4', 'cash_pop', 'lotto', 'super6'];

export const GAME_LABEL = {
  play_way: 'Play Way', pick3: 'Pick 3', cash4: 'Cash 4',
  cash_pop: 'Cash Pop', lotto: 'Lotto', super6: 'Super 6',
};

const OMP_PATH = {
  play_way: 'playway', pick3: 'dailypick3', cash4: 'cash4',
  cash_pop: 'cashpop', lotto: 'lotto', super6: 'super6',
};

// Every WordPress route the app posts to. Checked against the site's own
// route index, so a renamed or disabled plugin shows up by name.
const WP_ROUTES = [
  { label: 'Lotto results',    ns: 'lotto/v1',       route: '/lotto/v1/webhook' },
  { label: 'Super 6 results',  ns: 'super6/v1',      route: '/super6/v1/webhook' },
  { label: 'Cash 4 results',   ns: 'cash4/v1',       route: '/cash4/v1/webhook' },
  { label: 'Pick 3 results',   ns: 'pick3/v1',       route: '/pick3/v1/webhook' },
  { label: 'Cash Pop results', ns: 'cashpop/v1',     route: '/cashpop/v1/webhook' },
  { label: 'Play Way results', ns: 'playway/v1',     route: '/playway/v1/webhook' },
  { label: 'Lotto jackpot',    ns: 'lottogame/v1',   route: '/lottogame/v1/update-jackpot' },
  { label: 'Super 6 jackpot',  ns: 'super6-game/v1', route: '/super6-game/v1/update-jackpot' },
];

const TIMEOUT_MS = 12000;

// ---------------------------------------------------------------- helpers

/** One line of the report. status: pass | warn | fail | info */
const line = (status, title, detail = '', fix = '') => ({ status, title, detail, fix });

/** fetch with a timeout, never throws: returns { ok, status, text, json, headers, netError }. */
async function probe(url, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return {
      ok: res.ok, status: res.status, text, json, headers: res.headers,
      ms: Date.now() - started,
    };
  } catch (e) {
    const code = e?.cause?.code || e?.code || e?.name || '';
    return { ok: false, status: 0, text: '', json: null, netError: `${code} ${e?.cause?.message || e?.message || ''}`.trim(),
             ms: Date.now() - started };
  }
}

/** True when a response is a firewall / bot-protection page rather than the app itself. */
function isFirewallPage(r) {
  if (r.json) return false;
  const server = (r.headers?.get?.('server') || '').toLowerCase();
  const body = r.text || '';
  return /cloudflare/.test(server)
    || /cf-ray|attention required|just a moment|cf-browser-verification|challenge-platform/i.test(body)
    || /wordfence|sucuri|mod_security|imunify|access denied/i.test(body);
}

const short = (s, n = 220) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Turn any failed response into a plain-English cause and fix. */
function explain(r, target) {
  if (r.status === 0) {
    const ne = r.netError || '';
    if (/ENOTFOUND|EAI_AGAIN/i.test(ne)) {
      return { cause: `The ${target} address could not be found (DNS).`,
               fix: 'Check the base URL in Netlify for typos, and that the domain is live.' };
    }
    if (/Timeout|AbortError|ETIMEDOUT/i.test(ne)) {
      return { cause: `The ${target} did not answer within ${TIMEOUT_MS / 1000} seconds.`,
               fix: 'The server may be down or overloaded. Try again shortly; if it persists, contact the host.' };
    }
    if (/CERT|SSL|TLS/i.test(ne)) {
      return { cause: `The ${target} has a security certificate problem (${short(ne, 80)}).`,
               fix: 'The site\'s SSL certificate needs renewing or fixing by the host.' };
    }
    return { cause: `Could not connect to the ${target}: ${short(ne, 120)}`,
             fix: 'Check the base URL and that the server is up.' };
  }
  if (isFirewallPage(r)) {
    return { cause: `A firewall in front of the ${target} blocked the request before it reached the site (HTTP ${r.status}, bot-protection page returned).`,
             fix: 'Ask the host to allow API traffic from Netlify: whitelist the API path in Cloudflare / the security plugin, or turn off bot protection for it. The token or secret is not the problem here.' };
  }
  const msg = r.json?.message || r.json?.error || short(r.text, 160);
  switch (r.status) {
    case 401: return { cause: `The ${target} rejected the credentials (401). ${msg}`,
                       fix: 'The token or secret in Netlify is wrong, has been rotated, or was revoked. Get the current value, update it in Netlify, then redeploy.' };
    case 403: return { cause: `The ${target} refused access (403). ${msg}`,
                       fix: target === 'OMP portal'
                         ? 'Either Netlify\'s IP address is not on this client\'s IP allowlist, or the token\'s scopes do not include this game. Ask the portal admin to check "bin/cake api_client show".'
                         : 'The secret was refused or the request was blocked. Confirm the secret with the developer.' };
    case 404: return { cause: `The ${target} says this address does not exist (404). ${msg}`,
                       fix: 'The base URL is wrong, or the endpoint was renamed or disabled. Check the URL in Netlify against the developer\'s spec.' };
    case 429: return { cause: `The ${target} is throttling requests (429). ${msg}`,
                       fix: 'Too many requests, or too many failed logins (15-minute lockout). Wait 15 minutes and check again; repeated 401s cause this.' };
    default:
      if (r.status >= 500) {
        return { cause: `The ${target} had an internal error (${r.status}). ${msg}`,
                 fix: 'This is on the website\'s side. Send the error to the developer.' };
      }
      return { cause: `The ${target} answered ${r.status}. ${msg}`, fix: '' };
  }
}

const ompHeaders = () => ({
  Authorization: `Bearer ${OMP_TOKEN()}`,
  Accept: 'application/json',
});

/** Rows from the portal's list endpoint; the envelope is not documented, so accept the usual shapes. */
function rowsOf(payload, path) {
  if (Array.isArray(payload)) return payload;
  for (const k of ['results', 'data', path, 'items']) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  return payload && typeof payload === 'object' && payload.draw_number ? [payload] : [];
}

/** All integers in a value: "03,09,13" | [3,9,13] | 7 -> [3,9,13] */
const ints = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[^0-9]+/))
  .filter((x) => x !== '' && x != null).map(Number).filter(Number.isFinite);

/** The numbers we send for one payload, in the order the portal should store them. */
function ourNumbers(p) {
  const b = p.body;
  if (b.winning_number != null) return [Number(b.winning_number)];
  return ints(b.winning_numbers);
}

/** The numbers the portal stored for one row. */
function theirNumbers(row) {
  if (row.winning_number != null && row.winning_numbers == null) return ints(row.winning_number);
  return ints(row.winning_numbers ?? row.winning_number);
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------- overview

/**
 * Configuration, our own data for the day, the WordPress route check and the
 * recorded outcome of the last pushes. One call, fast.
 */
export async function overview(admin, drawDate) {
  const config = [];
  const data = [];
  const wordpress = [];
  const history = [];

  // ---- 1. configuration ------------------------------------------------
  const env = [
    ['WEBSITE_API_BASE', OMP_BASE(), 'OMP portal address'],
    ['WEBSITE_API_TOKEN', OMP_TOKEN(), 'OMP portal token'],
    ['HEXIVE_WEBHOOK_BASE', WP_BASE(), 'WordPress site address'],
    ['HEXIVE_WEBHOOK_SECRET', WP_SECRET(), 'WordPress webhook secret'],
  ];
  for (const [name, value, what] of env) {
    if (!value) {
      config.push(line('fail', `${what} is not set`, `${name} is empty in Netlify, so this website is switched off and nothing is sent to it.`,
        `Netlify > Site configuration > Environment variables: add ${name}, then redeploy.`));
    } else {
      const shown = /TOKEN|SECRET/.test(name)
        ? `set (${value.length} characters, ends ...${value.slice(-4)})`
        : value;
      config.push(line('pass', `${what}`, `${name}: ${shown}`));
    }
  }
  if (OMP_BASE() && !/\/api\/v1$/.test(OMP_BASE())) {
    config.push(line('warn', 'OMP address may be wrong',
      `WEBSITE_API_BASE is "${OMP_BASE()}". The spec requires it to end in /omp/api/v1.`,
      'Set it to https://about.nla.gd/omp/api/v1 (no trailing slash).'));
  }
  if (WP_BASE() && /\/wp-json/.test(WP_BASE())) {
    config.push(line('warn', 'WordPress address includes /wp-json',
      `HEXIVE_WEBHOOK_BASE is "${WP_BASE()}". The app adds /wp-json/... itself, so it would be doubled.`,
      'Set it to the bare site address, e.g. https://www.hexivedev.com'));
  }
  if (/hexivedev\.com/i.test(WP_BASE())) {
    config.push(line('fail', 'WordPress address points at the old site',
      `HEXIVE_WEBHOOK_BASE is "${WP_BASE()}". The WordPress site moved to www.nla.gd in November 2026, so everything sent to the old address is lost.`,
      'Netlify > Site configuration > Environment variables: set HEXIVE_WEBHOOK_BASE to https://www.nla.gd, then redeploy. Ask the developer whether the webhook secret changed with the move.'));
  }
  if (/\s/.test(process.env.WEBSITE_API_TOKEN || '') || /\s/.test(process.env.HEXIVE_WEBHOOK_SECRET || '')) {
    config.push(line('warn', 'A token or secret has spaces or a line break around it',
      'This often happens when pasting. The check trims it, but re-paste it cleanly in Netlify.', ''));
  }

  // ---- 2. what we hold for the day ------------------------------------
  const day = await loadDay(admin, drawDate);
  const doc = { date: drawDate, ...day };
  const ompSkipped = [];
  const ompPayloads = buildApiPayloads(doc, ompSkipped);
  const wpSkipped = [];
  const wpPayloads = buildHexivePayloads(doc, wpSkipped);

  const perGame = {};
  for (const p of ompPayloads) (perGame[p.game] ||= []).push(Number(p.drawNumber));
  const games = GAMES.filter((g) => perGame[g]?.length);

  if (!ompPayloads.length) {
    data.push(line('fail', `No complete results in the app for ${drawDate}`,
      'There is nothing with both winning numbers and a draw number, so a push sends nothing to either website.',
      'Enter the results and make sure each draw number is saved (press "Use" if it shows a grey suggestion).'));
  } else {
    for (const g of games) {
      const nums = perGame[g].sort((a, b) => a - b);
      data.push(line('pass', `${GAME_LABEL[g]}: ${nums.length} result(s) ready to send`, `Draw no. ${nums.join(', ')}`));
    }
  }
  for (const s of [...new Set([...ompSkipped, ...wpSkipped])]) {
    data.push(line('fail', `Will NOT be sent: ${s}`,
      'A result without a draw number is skipped on both websites.',
      'Open that draw, save its draw number, then update the websites again.'));
  }

  const pops = (day.cashPops || []).filter((p) => p.cancelled);
  if (pops.length) data.push(line('info', `${pops.length} Cash Pop draw(s) marked cancelled`, 'Cancelled draws are never sent.'));

  const unpublished = [
    ...(day.daily || []), ...(day.cashPops || []),
    ...(day.lotto ? [day.lotto] : []), ...(day.super6 ? [day.super6] : []),
  ].filter((r) => r && !r.published_at).length;
  if (ompPayloads.length && unpublished) {
    data.push(line('info', `${unpublished} row(s) for this day are not marked published yet`,
      'Normal if the day has not been pushed. After a successful push they are marked published automatically.'));
  }

  // ---- 3. WordPress routes --------------------------------------------
  if (WP_BASE()) {
    const r = await probe(`${WP_BASE()}/wp-json/`, { headers: { Accept: 'application/json' } });
    if (!r.ok || !r.json) {
      const why = r.ok
        ? { cause: 'The site answered, but not with the WordPress API index (a page or redirect came back instead).',
            fix: 'Check HEXIVE_WEBHOOK_BASE is the WordPress site itself, and that the REST API is not disabled by a security plugin.' }
        : explain(r, 'WordPress site');
      wordpress.push(line('fail', 'WordPress API could not be reached', why.cause, why.fix));
    } else {
      wordpress.push(line('pass', 'WordPress API reachable', `${WP_BASE()}/wp-json/ answered in ${r.ms} ms`));
      const namespaces = r.json.namespaces || [];
      const routes = Object.keys(r.json.routes || {});
      for (const w of WP_ROUTES) {
        const hasRoute = routes.length ? routes.includes(w.route) : namespaces.includes(w.ns);
        wordpress.push(hasRoute
          ? line('pass', w.label, `/wp-json${w.route} is registered`)
          : line('fail', `${w.label}: endpoint missing`,
            `/wp-json${w.route} is not registered on the site. Anything sent there is lost.`,
            'The receiving plugin is disabled or the route was renamed. Ask the developer to check it.'));
      }
      wordpress.push(line('info', 'Secret not tested',
        'WordPress has no dry-run mode, so the secret is only proven by a real send. If a real update returns 401 or 403, the secret is wrong.'));
    }
  }

  // ---- 4. what happened on the last pushes for this day ---------------
  try {
    const { data: runs } = await admin.from('blast_runs')
      .select('*')
      .eq('draw_date', drawDate).order('started_at', { ascending: false }).limit(5);
    for (const r of runs || []) {
      const when = r.started_at ? new Date(r.started_at).toLocaleString('en-GB', { timeZone: 'America/Grenada' }) : '';
      const kind = r.scope_kind === 'website_only' || r.mode === 'website' ? 'Websites only'
        : r.mode === 'email' ? 'Email only' : 'Websites and email';
      if (r.mode === 'email') {
        history.push(line('info', `${when}: ${kind}`, 'Email only, so the websites were not touched by this run.'));
        continue;
      }
      const failed = Number(r.website_failed ?? r.failed_count ?? 0);
      const sent = r.website_sent;
      history.push(line(failed > 0 ? 'fail' : 'pass',
        `${when}: ${kind}`,
        [sent != null ? `${sent} sent` : null, r.website_unchanged ? `${r.website_unchanged} already up to date (not resent)` : null, failed ? `${failed} failed` : null, r.website_note && !/^Started in the background/.test(r.website_note) ? r.website_note : null]
          .filter(Boolean).join('. ')));
    }
    if (!runs?.length) history.push(line('info', 'No sends or website updates recorded for this day', ''));
  } catch { /* history is a nice-to-have */ }

  return {
    drawDate,
    checkedAt: new Date().toISOString(),
    ompConfigured: Boolean(OMP_BASE() && OMP_TOKEN()),
    games,
    sections: { config, data, wordpress, history },
  };
}

// ---------------------------------------------------------------- OMP, one game

/**
 * For one game: can we reach the portal, which of the day's draws it holds,
 * whether they match, and for anything missing or different, a dry run that
 * returns the portal's exact reason for refusing it.
 */
export async function checkOmpGame(admin, drawDate, game) {
  const out = [];
  const label = GAME_LABEL[game] || game;
  const path = OMP_PATH[game];
  if (!path) return [line('fail', `Unknown game "${game}"`)];
  if (!OMP_BASE() || !OMP_TOKEN()) return [line('info', `${label}: OMP portal not configured, skipped`)];

  const day = await loadDay(admin, drawDate);
  const payloads = buildApiPayloads({ date: drawDate, ...day }, []).filter((p) => p.game === game);

  // 1. reach + auth: what does the portal expect next?
  const n = await probe(`${OMP_BASE()}/results/${path}/next`, { headers: ompHeaders() });
  if (!n.ok || !n.json) {
    const why = n.ok
      ? { cause: 'The portal answered, but not with JSON (a web page came back instead).', fix: 'Check WEBSITE_API_BASE ends with /omp/api/v1.' }
      : explain(n, 'OMP portal');
    out.push(line('fail', `${label}: cannot reach the OMP portal`, why.cause, why.fix));
    return out;
  }
  const next = Number(n.json.next_draw_number) || null;
  const last = n.json.last_draw?.draw_number ?? null;
  const lastDate = n.json.last_draw?.draw_date ?? '';
  out.push(line('pass', `${label}: portal reachable, token accepted`,
    `Last stored draw ${last ?? 'none'}${lastDate ? ` (${lastDate})` : ''}. Portal expects draw ${next ?? '?'} next. ${n.ms} ms.`));

  if (!payloads.length) {
    out.push(line('info', `${label}: nothing entered for ${drawDate}`, 'Nothing to compare.'));
    return out;
  }

  // 2. read back what the portal holds
  const list = await probe(`${OMP_BASE()}/results/${path}?limit=60`, { headers: ompHeaders() });
  const rows = list.ok && list.json ? rowsOf(list.json, path) : [];
  if (!list.ok) {
    const why = explain(list, 'OMP portal');
    out.push(line('warn', `${label}: could not read stored results back`, why.cause, why.fix));
  }
  const byNo = new Map(rows.map((r) => [Number(r.draw_number), r]));

  const needDryRun = [];
  for (const p of payloads) {
    const no = Number(p.drawNumber);
    const stored = byNo.get(no);
    const ours = ourNumbers(p);
    if (stored) {
      const theirs = theirNumbers(stored);
      const ourLetter = (p.body.winning_letter || '').toUpperCase();
      const theirLetter = String(stored.winning_letter || '').toUpperCase();
      const ourMulti = String(p.body.multiplier || '').toUpperCase();
      const theirMulti = String(stored.multiplier || '').toUpperCase();
      const diffs = [];
      if (!same(ours, theirs)) diffs.push(`numbers: app ${ours.join(' ')} / portal ${theirs.join(' ') || '(none)'}`);
      if ('winning_letter' in p.body && ourLetter !== theirLetter) diffs.push(`letter: app ${ourLetter || '-'} / portal ${theirLetter || '-'}`);
      if ('multiplier' in p.body && ourMulti !== theirMulti) diffs.push(`Multi-X: app ${ourMulti || 'none'} / portal ${theirMulti || 'none'}`);
      if (p.body.jackpot != null && stored.jackpot != null && Number(stored.jackpot) !== Number(p.body.jackpot)) {
        diffs.push(`jackpot: app ${p.body.jackpot} / portal ${Number(stored.jackpot)}`);
      }
      if (diffs.length) {
        out.push(line('warn', `${label} draw ${no}: on the portal but DIFFERENT`, diffs.join('. '),
          'Update the websites again to send the correction. The dry run below shows whether it will be accepted.'));
        needDryRun.push(p);
      } else {
        out.push(line('pass', `${label} draw ${no}: published and matches`, `Portal holds ${theirs.join(' ')}${stored.draw_date ? ` at ${stored.draw_date}` : ''}`));
      }
    } else if (next && no < next && rows.length && no < Math.min(...byNo.keys())) {
      out.push(line('info', `${label} draw ${no}: older than the portal's recent list`,
        'The portal has moved past this draw, so it is stored, but it is too old to read back and compare.'));
    } else {
      out.push(line('fail', `${label} draw ${no}: NOT on the portal`, `App has ${ours.join(' ')}.`, ''));
      needDryRun.push(p);
    }
  }

  // Sequence gap: the portal only accepts draw = last + 1.
  const firstMissing = needDryRun.map((p) => Number(p.drawNumber)).filter((x) => !byNo.has(x)).sort((a, b) => a - b)[0];
  if (next && firstMissing && firstMissing > next) {
    out.push(line('fail', `${label}: gap in the draw sequence`,
      `The portal expects draw ${next} next, but the first missing draw here is ${firstMissing}. It refuses any draw that is not exactly the next one, so everything after the gap is blocked.`,
      `Send draw ${next}${firstMissing - next > 1 ? ` to ${firstMissing - 1}` : ''} first (open the day it belongs to and update the websites), or check that draw number ${firstMissing} was typed correctly.`));
  }

  // 3. dry run anything missing or different, for the portal's own reason
  for (const p of needDryRun) {
    const r = await sendOne(p, { validate: true });
    if (r.ok) {
      const isFix = byNo.has(Number(p.drawNumber));
      out.push(line('pass', `${label} draw ${p.drawNumber}: dry run ACCEPTED`,
        isFix
          ? 'The portal would accept this correction now. It differs only because the correction was never sent, or the last send failed.'
          : 'The portal would accept this now. It is missing only because it was never sent, or the last send failed on the network.',
        'Press "Update websites only" for this day.'));
    } else {
      out.push(line('fail', `${label} draw ${p.drawNumber}: dry run REJECTED`, r.error || `HTTP ${r.status}`,
        hintFor(r.error || '')));
    }
  }
  return out;
}

/** A plain-English next step for the portal's most common validation messages. */
function hintFor(err) {
  if (/expecting draw|sequence|last \+ 1/i.test(err)) return 'Send the earlier missing draw first, then this one.';
  if (/valid draw slot|time .* not a valid/i.test(err)) return 'The draw time does not match a valid slot for this game. Check the draw was entered under the right period.';
  if (/future/i.test(err)) return 'The draw date is in the future. Check the date of the day you entered it under.';
  if (/jackpot/i.test(err)) return 'The jackpot failed the portal\'s progression check. If the jackpot was won, record a winner so it can reset; otherwise check the figure for a typo.';
  if (/period/i.test(err)) return 'The Cash Pop period does not match its time slot. Check the draw is under the right period.';
  if (/out of range|distinct|letter|multiplier/i.test(err)) return 'One of the values is outside what the portal allows. Check the numbers, letter and Multi-X for that draw.';
  if (/duplicate|409/i.test(err)) return 'The portal already has a different draw at this date/time or period. A draw number may have been entered under the wrong period.';
  if (/^401/.test(err)) return 'The token was refused. Update WEBSITE_API_TOKEN in Netlify.';
  if (/^403/.test(err)) return 'Not allowed: IP allowlist or token scope. Ask the portal admin.';
  return '';
}

// ---------------------------------------------------------------- WordPress, real send


/**
 * One REAL send to WordPress: the latest draw of the day, with exactly the
 * values already published, so it changes nothing visible if it works. It
 * reports everything about the reply, which is the only way to prove the
 * secret and to see what the site actually does with a post.
 */
export async function wordpressTestSend(admin, drawDate) {
  const out = [];
  if (!WP_BASE() || !WP_SECRET()) return [line('fail', 'WordPress is not configured in Netlify')];
  const day = await loadDay(admin, drawDate);
  const payloads = buildHexivePayloads({ date: drawDate, ...day }, []);
  if (!payloads.length) return [line('fail', `Nothing complete for ${drawDate} to test with`)];
  const p = payloads[payloads.length - 1];
  const PATHS = { super6: 'super6', lotto: 'lotto', cash4: 'cash4', pick3: 'pick3', cash_pop: 'cashpop', play_way: 'playway' };
  const url = `${WP_BASE()}/wp-json/${PATHS[p.game]}/v1/webhook`;

  out.push(line('info', `Sent ${GAME_LABEL[p.game]} draw ${p.drawId} to ${url}`, JSON.stringify(p.body)));
  let res; let text = '';
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': WP_SECRET(), Accept: 'application/json' },
      body: JSON.stringify(p.body),
      signal: AbortSignal.timeout(15000),
    });
    text = await res.text().catch(() => '');
  } catch (e) {
    out.push(line('fail', 'Could not connect', networkReason(e, url)));
    return out;
  }
  const v = judgeReply(text, res);
  out.push(line(res.redirected ? 'fail' : 'info', `HTTP ${res.status}${res.redirected ? `, REDIRECTED to ${res.url}` : ''}`,
    `Content type: ${res.headers.get('content-type') || 'none'}. Server: ${res.headers.get('server') || '?'}.`));
  out.push(line('info', 'What the site replied', short(text, 400) || '(empty)'));
  out.push(v.ok
    ? line('pass', 'WordPress accepted it', 'Check the home page now: this draw should show. If it does not, the plugin is accepting posts without storing them, or the page is cached. Send this report to the developer.')
    : line('fail', 'WordPress did NOT store it', v.error,
      /secret|unauthori|forbidden/i.test(v.error) ? 'The secret is wrong. Get the current one from the developer and update HEXIVE_WEBHOOK_SECRET in Netlify, then redeploy.'
        : /redirect/i.test(v.error) ? 'Set HEXIVE_WEBHOOK_BASE to exactly the address it redirected to (shown above), without the /wp-json part, then redeploy.'
          : 'Send this report to the developer.'));
  return out;
}

/** Forget what was sent to WordPress for this day, and send the whole day again. */
export async function wordpressResendDay(admin, drawDate) {
  const day = await loadDay(admin, drawDate);
  const payloads = buildHexivePayloads({ date: drawDate, ...day }, []);
  const nums = [...new Set(payloads.map((p) => Number(p.drawId)))];
  if (nums.length) {
    await admin.from('website_push_log').delete().eq('target', 'wordpress').in('draw_no', nums);
  }
  const r = await pushResultsToHexive({ date: drawDate, ...day }, { admin, force: true });
  if (r.notConfigured) return [line('fail', 'WordPress is not configured', r.reason)];
  const lines = [line(r.failed.length ? 'fail' : 'pass',
    `Resent ${r.results.length} draw(s) to WordPress: ${r.sent} stored, ${r.failed.length} failed`)];
  const seen = new Set();
  for (const f of r.failed) {
    if (seen.has(f.error)) continue;
    seen.add(f.error);
    lines.push(line('fail', `${GAME_LABEL[f.game] || f.game} draw ${f.drawId}`, f.error));
  }
  return lines;
}
