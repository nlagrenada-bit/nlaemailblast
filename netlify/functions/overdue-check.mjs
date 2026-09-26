// netlify/functions/overdue-check.mjs
//
// Tells named people when a draw's results have not been emailed in time.
//
// Runs every five minutes. For each draw scheduled today whose close time is
// more than N minutes past (30 by default), it checks whether an email has gone
// out for it. If not, and nobody has already been told about that draw, it
// emails the addresses set in Settings. Each draw alerts ONCE.
//
// Configured from the app, not from code:
//   overdue_enabled        true / false
//   overdue_minutes        how late before alerting        (default 30)
//   overdue_notify_emails  who to tell                     (a list)
//
// Uses the same Resend SMTP as the results blast, so there is nothing extra to
// set up for delivery.

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { DAILY_PERIODS, CASH_POP_PERIODS, gamesScheduledOn } from '../../shared/config.js';

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Grenada is UTC-4 all year. */
function gdNow() {
  const t = new Date(Date.now() - 4 * 3600 * 1000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

const to12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

export default async () => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const { data: settingRows } = await admin.from('settings').select('key, value')
    .in('key', ['overdue_enabled', 'overdue_minutes', 'overdue_notify_emails']);
  const cfg = Object.fromEntries((settingRows || []).map((r) => [r.key, r.value]));

  if (cfg.overdue_enabled === false) return new Response('disabled');

  const grace = Number(cfg.overdue_minutes) || 30;
  const recipients = (Array.isArray(cfg.overdue_notify_emails) ? cfg.overdue_notify_emails : [])
    .map((e) => String(e).trim()).filter((e) => /\S+@\S+\.\S+/.test(e));

  if (!recipients.length) return new Response('no recipients configured');

  const { date, minutes } = gdNow();

  // Respect the day plan: a cancelled day, or a game switched off for a
  // holiday, is not overdue.
  const { data: day } = await admin.from('draw_days').select('*')
    .eq('draw_date', date).maybeSingle();
  const scheduled = gamesScheduledOn(date, day && {
    daily: day.daily_on, cash_pop: day.cash_pop_on,
    lotto: day.lotto_on, super6: day.super6_on,
    cancelled: day.status === 'cancelled',
  });

  // Every draw due today, with the label its email is recorded under.
  const draws = [];
  if (scheduled.daily) {
    for (const p of DAILY_PERIODS) draws.push({ slot: `daily:${p.code}`, label: p.label, time: p.time });
  }
  if (scheduled.cash_pop) {
    for (const p of CASH_POP_PERIODS) draws.push({ slot: `pop:${p.code}`, label: p.label, time: p.time });
  }
  if (scheduled.lotto)  draws.push({ slot: 'lotto',  label: 'Lotto Draw',   time: '19:45' });
  if (scheduled.super6) draws.push({ slot: 'super6', label: 'Super 6 Draw', time: '19:45' });

  const overdueNow = draws.filter((d) => minutes >= toMin(d.time) + grace);
  if (!overdueNow.length) return new Response('nothing due yet');

  // What has actually been emailed today. A full-day blast covers every draw.
  const { data: runs } = await admin.from('blast_runs')
    .select('scope_label, scope_kind, mode, status')
    .eq('draw_date', date);
  const emailed = (runs || []).filter((r) =>
    r.status === 'complete' && r.mode !== 'website' && r.scope_kind !== 'website_only');
  const fullDaySent = emailed.some((r) => r.scope_kind === 'eod');
  const sentLabels = new Set(emailed.map((r) => r.scope_label));

  // Alerts already sent today, so nobody is told twice.
  const { data: already } = await admin.from('overdue_alerts')
    .select('slot').eq('draw_date', date);
  const alerted = new Set((already || []).map((a) => a.slot));

  const missing = overdueNow.filter((d) =>
    !fullDaySent && !sentLabels.has(d.label) && !alerted.has(d.slot));

  if (!missing.length) return new Response('all emailed or already alerted');

  // One message covering everything newly overdue.
  const lines = missing.map((d) =>
    `  - ${d.label} (closed ${to12(d.time)}, now ${Math.floor(minutes - toMin(d.time))} min ago)`);

  const subject = missing.length === 1
    ? `Results not yet sent: ${missing[0].label}`
    : `Results not yet sent: ${missing.length} draws`;

  const text = [
    `The following draw results have not been emailed ${grace} minutes after the`,
    `draw closed (${date}):`,
    '',
    ...lines,
    '',
    'Media houses may be waiting for these. Open the Results Desk to enter and',
    'send them:',
    `  ${process.env.URL || 'https://nlaemailblast.netlify.app'}/?tab=results&date=${date}`,
    '',
    'You will be told about each draw once. This message is sent automatically',
    'by the NLA Results Desk; the addresses it goes to are set in Settings.',
  ].join('\n');

  try {
    const port = Number(process.env.SMTP_PORT || 465);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.BLAST_FROM || process.env.MAIL_FROM,
      to: recipients.join(', '),
      replyTo: process.env.MAIL_REPLY_TO || undefined,
      subject, text,
    });
    transporter.close();
  } catch (e) {
    // Do NOT record the alert if it failed to send, so the next run retries.
    console.error('overdue alert failed:', e.message);
    return new Response(`send failed: ${e.message}`, { status: 500 });
  }

  // Record only after a successful send.
  await admin.from('overdue_alerts').upsert(
    missing.map((d) => ({ draw_date: date, slot: d.slot, recipients: recipients.join(', ') })),
    { onConflict: 'draw_date,slot' },
  );

  return new Response(`alerted: ${missing.map((d) => d.slot).join(', ')}`);
};

// Every five minutes. An overdue draw is reported within five minutes of
// crossing the threshold.
export const config = { schedule: '*/5 * * * *' };
