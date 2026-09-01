// netlify/functions/send-blast-background.mjs
//
// The "-background" suffix is required: it lifts the timeout from ~26s to 15
// minutes and makes the function return 202 immediately. Confirm your Netlify
// plan includes background functions before the first live run — if this 404s,
// that's why.
//
// SENDING PROFILE — set against Microsoft's guidance to keep the mailbox under
// 30 messages/minute and avoid one large BCC blast:
//
//   External recipients : individual messages, BATCH_SIZE per burst, gap between
//                         bursts -> ~20/min (a third under the 30/min ceiling)
//   Pause               : INTERNAL_DELAY_MS
//   Internal @nla.gd    : a single message, To info@nla.gd, staff in CC
//                         (tenant-internal delivery doesn't cross outbound spam
//                          filtering, so it doesn't need throttling)
//
// Per-recipient sends replace the old single BCC blast, which is what removes
// the "compromised account" behavioural signal. Do not raise BATCH_SIZE or drop
// BATCH_INTERVAL_MS without recomputing against the 30/min limit.

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { buildDoc } from '../../shared/buildDoc.js';
import { buildEmail } from '../../shared/emailTemplate.js';
import { longDate } from '../../shared/config.js';
import { pushResultsToWebsite } from './lib/websiteWebhook.mjs';

// ---- Throttle configuration (Microsoft: under 30/min) ---------------
const BATCH_SIZE        = Number(process.env.BATCH_SIZE || 5);            // messages per burst
const BATCH_INTERVAL_MS = Number(process.env.BATCH_INTERVAL_MS || 15_000); // -> 20/min at size 5
const INTERNAL_DELAY_MS = Number(process.env.INTERNAL_DELAY_MS || 60_000); // pause before internal CC
const INTERNAL_CC_CHUNK = Number(process.env.INTERNAL_CC_CHUNK || 0);     // 0 = one message

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
// BLAST_FROM lets you move to the results.nla.gd relay later without a code
// change; info@nla.gd stays as Reply-To. Defaults to the current mailbox.
const FROM_ADDR  = process.env.BLAST_FROM || process.env.MAIL_FROM || 'info@nla.gd';
const REPLY_TO   = process.env.MAIL_REPLY_TO || 'info@nla.gd';
const ASSET_BASE = process.env.EMAIL_ASSET_BASE
  || (process.env.URL ? `${process.env.URL}/assets` : '/assets');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRestricted = (err) =>
  err?.responseCode === 550 && /5\.1\.8/.test(err?.response || '');

export const handler = async (event) => {
  const { runId, drawDate } = JSON.parse(event.body || '{}');
  if (!runId || !drawDate) return { statusCode: 400 };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const setStatus = (patch) => admin.from('blast_runs').update(patch).eq('id', runId);

  try {
    // Only pending rows, so a retry after a crash resumes rather than restarts.
    const { data: pending } = await admin
      .from('blast_recipients')
      .select('id, email, is_internal')
      .eq('run_id', runId).eq('status', 'pending');

    if (!pending?.length) {
      await setStatus({ status: 'complete', finished_at: new Date().toISOString() });
      return { statusCode: 200 };
    }

    const external = pending.filter((r) => !r.is_internal);
    const internal = pending.filter((r) => r.is_internal);

    const { subject, html, text } = await buildMessage(admin, drawDate);

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { minVersion: 'TLSv1.2' },
      pool: true, maxConnections: 1, maxMessages: 100,
    });

    let sent = 0, failed = 0;
    const bump = () => setStatus({ sent_count: sent, failed_count: failed });

    // ---- Leg 1: external recipients, throttled ----------------------
    await setStatus({ status: 'sending_external' });

    for (let i = 0; i < external.length; i += BATCH_SIZE) {
      const batch = external.slice(i, i + BATCH_SIZE);
      for (const rec of batch) {                 // sequential within the burst
        try {
          const info = await transporter.sendMail({
            from: FROM_ADDR, to: rec.email, replyTo: REPLY_TO,
            subject, html, text,
            headers: {
              'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=unsubscribe>`,
              'X-Entity-Ref-ID': `${runId}-${rec.id}`,
            },
          });
          await admin.from('blast_recipients').update({
            status: 'sent', sent_at: new Date().toISOString(),
            smtp_response: info.response?.slice(0, 500) ?? null,
          }).eq('id', rec.id);
          sent++;
        } catch (err) {
          const detail = [err.responseCode, err.response, err.message]
            .filter(Boolean).join(' | ').slice(0, 1000);
          await admin.from('blast_recipients').update({ status: 'failed', error_text: detail })
            .eq('id', rec.id);
          failed++;
          console.error(`FAILED ${rec.email}: ${detail}`);

          // Mailbox restricted again -> stop; further sends only deepen it.
          if (isRestricted(err)) {
            await setStatus({
              status: 'failed', sent_count: sent, failed_count: failed,
              error_message: `Sender restricted mid-run (550 5.1.8). Halted at ${sent} sent. ${detail}`,
              finished_at: new Date().toISOString(),
            });
            transporter.close();
            return { statusCode: 200 };
          }
        }
      }
      await bump();
      if (i + BATCH_SIZE < external.length) await sleep(BATCH_INTERVAL_MS);
    }

    // ---- Pause, then Leg 2: internal staff in CC --------------------
    if (internal.length) {
      await setStatus({ status: 'waiting' });
      await sleep(INTERNAL_DELAY_MS);
      await setStatus({ status: 'sending_internal' });

      const chunks = INTERNAL_CC_CHUNK > 0 ? chunk(internal, INTERNAL_CC_CHUNK) : [internal];
      for (let c = 0; c < chunks.length; c++) {
        const group = chunks[c];
        try {
          const info = await transporter.sendMail({
            from: FROM_ADDR, to: REPLY_TO,
            cc: group.map((r) => r.email).join(', '),
            subject, html, text,
            headers: { 'X-Entity-Ref-ID': `${runId}-internal-${c}` },
          });
          await admin.from('blast_recipients').update({
            status: 'sent', sent_at: new Date().toISOString(),
            smtp_response: info.response?.slice(0, 500) ?? null,
          }).in('id', group.map((r) => r.id));
          sent += group.length;
        } catch (err) {
          const detail = [err.responseCode, err.response, err.message]
            .filter(Boolean).join(' | ').slice(0, 1000);
          await admin.from('blast_recipients').update({ status: 'failed', error_text: detail })
            .in('id', group.map((r) => r.id));
          failed += group.length;
          console.error(`FAILED internal CC batch ${c}: ${detail}`);
        }
        await bump();
        if (c < chunks.length - 1) await sleep(BATCH_INTERVAL_MS);
      }
    }

    transporter.close();

    // ---- Push the day's results to the website (non-blocking) -------
    let website = null;
    if (sent > 0) {
      try {
        const [daily, cashPops, lotto, super6] = await Promise.all([
          admin.from('daily_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
          admin.from('cash_pop_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
          admin.from('lotto_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
          admin.from('super6_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
        ]);
        website = await pushResultsToWebsite({ date: drawDate, daily, cashPops, lotto, super6 });
      } catch (e) { website = { error: e.message }; }
    }

    await setStatus({
      status: 'complete', sent_count: sent, failed_count: failed,
      error_message: website?.failed?.length
        ? `${website.failed.length} website update(s) failed.` : null,
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 200 };
  } catch (err) {
    console.error('Blast run crashed:', err);
    await setStatus({
      status: 'failed', error_message: err.message?.slice(0, 1000),
      finished_at: new Date().toISOString(),
    });
    return { statusCode: 500 };
  }
};

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Build the message from the real results, using the same buildDoc + buildEmail
// the app and preview use — so the sent bytes match the preview exactly.
// Lottery balls stay pre-rendered PNGs (Outlook drops CSS border-radius).
async function buildMessage(admin, drawDate) {
  const [daily, cashPops, lotto, super6, settingsRows, dayRow] = await Promise.all([
    admin.from('daily_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('cash_pop_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('lotto_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
    admin.from('super6_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
    admin.from('settings').select('*').then((r) => r.data || []),
    admin.from('draw_days').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
  ]);

  const settings = Object.fromEntries((settingsRows || []).map((s) => [s.key, s.value]));
  const doc = buildDoc({
    date: drawDate, kind: 'eod', daily, cashPops, lotto, super6, settings, day: dayRow,
  });
  const email = buildEmail(doc, { assetBase: ASSET_BASE, footer: settings.footer });
  return {
    subject: email.subject || `NLA Draw Results — ${longDate(drawDate)}`,
    html: email.html,
    text: email.text,
  };
}
