// Scheduled nightly, Monday to Saturday (see netlify.toml).
//
// Default behaviour is to *stage* the complete-day blast as a draft and email
// the desk to say it's ready — a human still presses send. Set the
// `eod_mode` setting to "send" if you later want it to go out unattended.

import { admin } from './lib/supabaseAdmin.mjs';
import { mailer } from './lib/mailer.mjs';
import { buildDoc, validateDoc } from '../../shared/buildDoc.js';
import { buildEmail } from '../../shared/emailTemplate.js';
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
  if (!check.ok) {
    await notifyDesk(`NLA end-of-day blast not staged for ${longDate(date)}`,
      `The nightly job could not build the complete results:\n\n`
      + check.errors.map((e) => `  - ${e}`).join('\n')
      + `\n\nEnter the missing results and send from the app.`);
    return new Response(JSON.stringify({ error: check.errors, date }), { status: 200 });
  }

  const { subject, html, text } = buildEmail(doc, {
    assetBase: process.env.VITE_ASSET_BASE_URL,
    footer: settings.footer,
  });

  const { data: blast } = await db.from('blasts').insert({
    draw_date: date, kind: 'eod', label: 'Complete day results',
    subject, html, text_body: text, status: 'draft',
  }).select('id').single();

  const mode = settings.eod_mode || 'draft';
  if (mode !== 'send') {
    await notifyDesk(`NLA end-of-day blast is ready to send — ${longDate(date)}`,
      `The complete results for ${longDate(date)} are drafted and waiting for approval`
      + `${check.warnings.length ? `.\n\nWorth a look before you send:\n` + check.warnings.map((w) => `  - ${w}`).join('\n') : '.'}`
      + `\n\nOpen the app, go to History, and review the draft.`);
    return new Response(JSON.stringify({ staged: blast.id, warnings: check.warnings, date }));
  }

  // Unattended mode: hand straight to the send path.
  const res = await fetch(`${process.env.URL}/api/send-blast`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.EOD_SERVICE_TOKEN || ''}`,
    },
    body: JSON.stringify({ blastId: blast.id }),
  });
  return new Response(JSON.stringify({ sent: res.ok, blastId: blast.id, date }));
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
export const config = { schedule: '0 1 * * 2-6,0' };
