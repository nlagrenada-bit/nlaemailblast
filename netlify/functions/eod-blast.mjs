// Scheduled nightly, Monday to Saturday (see netlify.toml).
//
// Default behaviour is to *stage* the complete-day blast as a draft and email
// the desk to say it's ready — a human still presses send. Set the
// `eod_mode` setting to "send" if you later want it to go out unattended.

import { admin } from './lib/supabaseAdmin.mjs';
import { mailer } from './lib/mailer.mjs';
import { buildDoc, validateDoc, missingScheduledDraws } from '../../shared/buildDoc.js';
import { buildEmail } from '../../shared/emailTemplate.js';
import { pushResultsEverywhere } from './lib/pushAll.mjs';
import { markPublished } from './lib/publish.mjs';
import { longDate, gamesScheduledOn } from '../../shared/config.js';

/** Today in Grenada (AST, UTC-4, no daylight saving). */
function localDate(offsetHours = -4) {
  const now = new Date(Date.now() + offsetHours * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

export default async () => {
  const db = admin();
  const date = process.env.EOD_DATE_OVERRIDE || localDate(Number(process.env.TZ_OFFSET_HOURS || -4));

  const { data: settingRows } = await db.from('settings').select('key, value');
  const settings = Object.fromEntries((settingRows || []).map((r) => [r.key, r.value]));

  const { data: day } = await db.from('draw_days').select('*').eq('draw_date', date).maybeSingle();
  if (day?.status === 'cancelled') {
    return new Response(JSON.stringify({ skipped: 'Day marked cancelled.', date }));
  }

  const scheduled = gamesScheduledOn(date, day && {
    daily: day.daily_on, cash_pop: day.cash_pop_on,
    lotto: day.lotto_on, super6: day.super6_on,
    cancelled: day.status === 'cancelled',
  });
  if (!scheduled.daily && !scheduled.lotto && !scheduled.super6) {
    return new Response(JSON.stringify({ skipped: 'No draws scheduled.', date }));
  }

  const [daily, cashPops, lotto, super6] = await Promise.all([
    db.from('daily_results').select('*').eq('draw_date', date).then((r) => r.data || []),
    db.from('cash_pop_results').select('*').eq('draw_date', date).then((r) => r.data || []),
    db.from('lotto_results').select('*').eq('draw_date', date).maybeSingle().then((r) => r.data),
    db.from('super6_results').select('*').eq('draw_date', date).maybeSingle().then((r) => r.data),
  ]);

  const doc = buildDoc({ date, kind: 'eod', daily, cashPops, lotto, super6, settings, day });
  const check = validateDoc(doc);

  // Beyond the structural validation, the nightly job must not send a day that
  // is still missing its late draws — the Evening daily draw (7:45pm) and the
  // Prime-Time Pop (8:45pm) are the ones most likely not yet entered when the
  // job runs. If a scheduled draw's results aren't in, hold and tell the desk
  // rather than sending an incomplete "complete day".
  const lateMissing = [];
  if (scheduled.daily) {
    const evening = daily.find((r) => r.period === 'evening');
    if (!evening || evening.play_way_number == null) lateMissing.push('Evening Draw (7:45pm) results');
  }
  if (scheduled.cash_pop) {
    const prime = cashPops.find((r) => r.period === 'prime_time');
    if (!prime || prime.number == null) lateMissing.push('Prime-Time Pop (8:45pm) result');
  }

  if (!check.ok || lateMissing.length) {
    const reasons = [...check.errors, ...lateMissing.map((m) => `Missing: ${m}`)];
    await notifyDesk(`NLA end-of-day blast NOT sent for ${longDate(date)} — results incomplete`,
      `The nightly job did not send the complete-day results because the day isn't finished:\n\n`
      + reasons.map((e) => `  - ${e}`).join('\n')
      + `\n\nEnter the missing results in the app, then send the complete day from the Results tab `
      + `(select "Whole day") or approve the draft in History. Nothing was sent, so no incomplete `
      + `email went out.`);
    return new Response(JSON.stringify({ held: true, reasons, date }), { status: 200 });
  }

  const { subject, html, text } = buildEmail(doc, {
    assetBase: process.env.VITE_ASSET_BASE_URL,
    footer: settings.footer,
  });

  const { data: blast } = await db.from('blasts').insert({
    draw_date: date, kind: 'eod', label: 'Complete day results',
    subject, html, text_body: text, status: 'draft',
  }).select('id').single();

  // ---------------------------------------------------------------------
  // Push the day's results to the websites REGARDLESS of the email mode.
  //
  // The last draw of the day is the Night Cash Pop at 8:45pm. Previously the
  // websites only updated when a human sent a blast, so if nobody did, the
  // night result never reached the public site at all. Publishing results is
  // a separate obligation from emailing them, so it no longer waits for an
  // approval that may not come until morning.
  // ---------------------------------------------------------------------
  let website = null;
  try {
    website = await pushResultsEverywhere({ date, daily, cashPops, lotto, super6 });
    if (website?.sent > 0) await markPublished(db, date);
  } catch (e) {
    website = { errors: [e.message] };
  }

  // Draws that were never entered at all. validateDoc cannot see these — it
  // only inspects what was keyed in — yet an unentered late draw is the most
  // consequential gap there is.
  const notEntered = missingScheduledDraws({ scheduled, daily, cashPops, lotto, super6 });

  const websiteLine = website?.notConfigured
    ? ''
    : `\n\nWebsites: ${website?.sent ?? 0} result(s) published`
      + `${website?.failed ? `, ${website.failed} failed` : ''}`
      + `${website?.incomplete?.length ? `.\nNot published: ${website.incomplete.join('; ')}` : '.'}`;

  const mode = settings.eod_mode || 'draft';
  if (mode !== 'send') {
    await notifyDesk(`NLA end-of-day blast is ready to send — ${longDate(date)}`,
      `The complete results for ${longDate(date)} are drafted and waiting for approval`
      + `${check.warnings.length ? `.\n\nWorth a look before you send:\n` + check.warnings.map((w) => `  - ${w}`).join('\n') : '.'}`
      + (notEntered.length
          ? `\n\n*** NOT ENTERED — these scheduled draws have no result at all: ***\n`
            + notEntered.map((m) => `  - ${m}`).join('\n')
            + `\n\nEnter them and resend, or the day's record is incomplete on the`
            + ` websites and in the archive.`
          : '')
      + (check.blocking.length
          ? `\n\n*** WILL NOT REACH THE WEBSITES: ***\n`
            + check.blocking.map((m) => `  - ${m}`).join('\n')
          : '')
      + websiteLine
      + `\n\nOpen the app, go to History, and review the draft.`);
    return new Response(JSON.stringify({
      staged: blast.id, warnings: check.warnings, website, date,
    }));
  }

  // Unattended mode: hand straight to the send path. The send endpoint takes
  // the built message, not a blast id.
  const res = await fetch(`${process.env.URL}/api/send-blast`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.EOD_SERVICE_TOKEN || ''}`,
    },
    body: JSON.stringify({
      drawDate: date, subject, html, text,
      scopeLabel: 'Complete day results', scopeKind: 'eod',
    }),
  });
  return new Response(JSON.stringify({ sent: res.ok, website, date }));
};

async function notifyDesk(subject, text) {
  const to = (process.env.DESK_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!to.length || !process.env.MAIL_FROM) return;
  try {
    await mailer().send({ from: process.env.MAIL_FROM, to, subject, text, html: `<pre style="font:14px/1.5 Arial">${text}</pre>` });
  } catch { /* notification failure must not fail the job */ }
}

// Fire at 21:00 AST (Grenada, UTC-4), Monday to Saturday.
// 21:00 AST is 01:00 UTC the *next* calendar day, so the UTC days are shifted
// forward by one: Mon-Sat AST -> Tue-Sun UTC. Cron day-of-week is 0-6 (0=Sun),
// and 7 is out of range and rejected by Netlify, so Sunday is written as 0:
// '2-6,0' = Tue,Wed,Thu,Fri,Sat,Sun UTC = Mon-Sat 21:00 AST.
// Runs at 02:30 UTC = 10:30 PM AST, Mon–Sun. That's ~1h45m after the last
// draw of the day (Prime-Time Pop at 8:45 PM), leaving room for the Evening
// and Prime-Time results to be entered before the complete-day blast is built.
export const config = { schedule: '30 2 * * *' };
