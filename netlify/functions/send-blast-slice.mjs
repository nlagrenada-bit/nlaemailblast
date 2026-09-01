// netlify/functions/send-blast-slice.mjs
//
// Chained sender that works WITHOUT background functions. Each invocation sends
// one small slice of recipients inside the ~26s regular-function limit, records
// progress, then re-invokes itself for the next slice. Repeats until the run is
// complete. The pacing across slices holds the mailbox under Microsoft's 30/min.
//
// Rate arithmetic: SLICE_EXTERNAL messages spread over ~SLICE_SECONDS, then a
// fresh invocation. 6 messages / 18s = 20/min, a third under the ceiling.
//
// This is invoked by send-blast.mjs (the trigger) and then by itself. It is not
// called from the browser.

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { buildDoc } from '../../shared/buildDoc.js';
import { buildEmail } from '../../shared/emailTemplate.js';
import { longDate } from '../../shared/config.js';
import { pushResultsToWebsite } from './lib/websiteWebhook.mjs';

// ---- Slice + throttle configuration ---------------------------------
const SLICE_EXTERNAL   = Number(process.env.SLICE_EXTERNAL || 6);      // external msgs per slice
const SLICE_GAP_MS     = Number(process.env.SLICE_GAP_MS || 3000);     // gap between msgs in a slice
// 6 msgs * 3s = 18s per slice -> ~20/min. Keep SLICE_EXTERNAL * (SLICE_GAP_MS/1000)
// comfortably under 24s, and the effective rate under 30/min.

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_ADDR = process.env.BLAST_FROM || process.env.MAIL_FROM || 'info@nla.gd';
const REPLY_TO  = process.env.MAIL_REPLY_TO || 'info@nla.gd';
const ASSET_BASE = process.env.EMAIL_ASSET_BASE
  || (process.env.URL ? `${process.env.URL}/assets` : '/assets');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRestricted = (err) =>
  err?.responseCode === 550 && /5\.1\.8/.test(err?.response || '');

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });

export default async (request) => {
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'bad body' }, 400); }
  const { runId, drawDate } = payload;
  if (!runId || !drawDate) return json({ error: 'runId and drawDate required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const setRun = (patch) => admin.from('blast_runs').update(patch).eq('id', runId);

  // Guard: if the run was already finished, stop (prevents duplicate chains).
  const { data: run } = await admin.from('blast_runs').select('status').eq('id', runId).single();
  if (!run || run.status === 'complete' || run.status === 'failed') return json({ done: true });

  // Pull this slice: external pending first; only when external is exhausted do
  // we send the internal CC. External are throttled; internal is one message.
  const { data: extPending } = await admin.from('blast_recipients')
    .select('id, email').eq('run_id', runId).eq('is_internal', false).eq('status', 'pending')
    .order('id').limit(SLICE_EXTERNAL);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2' }, pool: true, maxConnections: 1, maxMessages: 50,
  });

  const { subject, html, text } = await buildMessage(admin, drawDate);

  // running totals for the UI
  const counts = async () => {
    const { data } = await admin.from('blast_recipients').select('status').eq('run_id', runId);
    const sent = (data || []).filter((r) => r.status === 'sent').length;
    const failed = (data || []).filter((r) => r.status === 'failed').length;
    return { sent, failed };
  };

  try {
    if (extPending?.length) {
      await setRun({ status: 'sending_external' });
      for (let i = 0; i < extPending.length; i++) {
        const rec = extPending[i];
        try {
          const info = await transporter.sendMail({
            from: FROM_ADDR, to: rec.email, replyTo: REPLY_TO, subject, html, text,
            headers: {
              'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=unsubscribe>`,
              'X-Entity-Ref-ID': `${runId}-${rec.id}`,
            },
          });
          await admin.from('blast_recipients').update({
            status: 'sent', sent_at: new Date().toISOString(),
            smtp_response: info.response?.slice(0, 500) ?? null,
          }).eq('id', rec.id);
        } catch (err) {
          const detail = [err.responseCode, err.response, err.message].filter(Boolean).join(' | ').slice(0, 1000);
          await admin.from('blast_recipients').update({ status: 'failed', error_text: detail }).eq('id', rec.id);
          console.error(`FAILED ${rec.email}: ${detail}`);
          if (isRestricted(err)) {
            const c = await counts();
            await setRun({ status: 'failed', sent_count: c.sent, failed_count: c.failed,
              error_message: `Sender restricted (550 5.1.8). Halted at ${c.sent} sent. ${detail}`,
              finished_at: new Date().toISOString() });
            transporter.close();
            return json({ halted: true });
          }
        }
        // pace within the slice, except after the last one
        if (i < extPending.length - 1) await sleep(SLICE_GAP_MS);
      }
      const c = await counts();
      await setRun({ sent_count: c.sent, failed_count: c.failed });
      transporter.close();
      await chainNext(request, runId, drawDate);      // more external may remain
      return json({ slice: 'external', sent: extPending.length });
    }

    // No external left — send the internal CC (one message), then finish.
    const { data: intPending } = await admin.from('blast_recipients')
      .select('id, email').eq('run_id', runId).eq('is_internal', true).eq('status', 'pending');

    if (intPending?.length) {
      await setRun({ status: 'sending_internal' });
      try {
        const info = await transporter.sendMail({
          from: FROM_ADDR, to: REPLY_TO, cc: intPending.map((r) => r.email).join(', '),
          subject, html, text, headers: { 'X-Entity-Ref-ID': `${runId}-internal` },
        });
        await admin.from('blast_recipients').update({
          status: 'sent', sent_at: new Date().toISOString(),
          smtp_response: info.response?.slice(0, 500) ?? null,
        }).in('id', intPending.map((r) => r.id));
      } catch (err) {
        const detail = [err.responseCode, err.response, err.message].filter(Boolean).join(' | ').slice(0, 1000);
        await admin.from('blast_recipients').update({ status: 'failed', error_text: detail })
          .in('id', intPending.map((r) => r.id));
      }
    }
    transporter.close();

    // Everything sent — push to the website, then mark complete.
    let website = null;
    try {
      const [daily, cashPops, lotto, super6] = await Promise.all([
        admin.from('daily_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
        admin.from('cash_pop_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
        admin.from('lotto_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
        admin.from('super6_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
      ]);
      website = await pushResultsToWebsite({ date: drawDate, daily, cashPops, lotto, super6 });
    } catch (e) { website = { error: e.message }; }

    const c = await counts();
    await setRun({
      status: 'complete', sent_count: c.sent, failed_count: c.failed,
      error_message: website?.failed?.length ? `${website.failed.length} website update(s) failed.` : null,
      finished_at: new Date().toISOString(),
    });
    return json({ done: true, sent: c.sent, failed: c.failed });
  } catch (err) {
    transporter.close();
    console.error('slice crashed:', err);
    await setRun({ status: 'failed', error_message: err.message?.slice(0, 1000), finished_at: new Date().toISOString() });
    return json({ error: err.message }, 500);
  }
};

// Fire the next slice. We await just the handoff (with a short timeout) so the
// invocation reliably leaves before this function returns — a bare
// fire-and-forget fetch can be killed on return, stalling the chain. Aborting
// the client side does not stop the server-side slice from running.
async function chainNext(request, runId, drawDate) {
  const base = process.env.URL || `https://${request.headers.get('host')}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  await fetch(`${base}/api/send-blast-slice`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, drawDate }), signal: ctrl.signal,
  }).catch(() => {});
  clearTimeout(t);
}

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
  const doc = buildDoc({ date: drawDate, kind: 'eod', daily, cashPops, lotto, super6, settings, day: dayRow });
  const email = buildEmail(doc, { assetBase: ASSET_BASE, footer: settings.footer });
  return {
    subject: email.subject || `NLA Draw Results — ${longDate(drawDate)}`,
    html: email.html, text: email.text,
  };
}

export const config = { path: '/api/send-blast-slice' };
