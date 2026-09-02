// netlify/functions/send-blast-slice.mjs
//
// Chained sender: each invocation sends one small slice within the ~26s
// regular-function limit, then re-invokes itself until the run is done. Paced
// to stay under Microsoft's 30 messages/minute guidance (relevant only while
// sending through Exchange Online; a relay has no such limit).
//
// IMPORTANT: this function does NOT build the email. It sends the exact
// subject/html/text stored on the run by send-blast.mjs, which the browser
// produced for the preview. Rebuilding it here was what made a single-draw
// send go out as the whole day.

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { pushResultsToWebsite } from './lib/websiteWebhook.mjs';

const SLICE_EXTERNAL = Number(process.env.SLICE_EXTERNAL || 6);
const SLICE_GAP_MS   = Number(process.env.SLICE_GAP_MS || 3000);

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_ADDR = process.env.BLAST_FROM || process.env.MAIL_FROM || 'info@nla.gd';
const REPLY_TO  = process.env.MAIL_REPLY_TO || 'info@nla.gd';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRestricted = (err) =>
  err?.responseCode === 550 && /5\.1\.8/.test(err?.response || '');
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });

export default async (request) => {
  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'bad body' }, 400); }
  const { runId, drawDate } = payload;
  if (!runId) return json({ error: 'runId required' }, 400);

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
  const setRun = (patch) => admin.from('blast_runs').update(patch).eq('id', runId);

  // Load the run WITH its stored message. Stop if already finished.
  const { data: run } = await admin.from('blast_runs')
    .select('status, subject, html, text_body, draw_date').eq('id', runId).single();
  if (!run) return json({ error: 'run not found' }, 404);
  if (run.status === 'complete' || run.status === 'failed') return json({ done: true });

  const subject = run.subject;
  const html = run.html;
  const text = run.text_body || '';
  if (!subject || !html) {
    await setRun({ status: 'failed', error_message: 'No message stored on this run.',
      finished_at: new Date().toISOString() });
    return json({ error: 'no message' }, 400);
  }

  const { data: extPending } = await admin.from('blast_recipients')
    .select('id, email').eq('run_id', runId).eq('is_internal', false).eq('status', 'pending')
    .order('id').limit(SLICE_EXTERNAL);

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2' }, pool: true, maxConnections: 1, maxMessages: 50,
  });

  const counts = async () => {
    const { data } = await admin.from('blast_recipients').select('status').eq('run_id', runId);
    return {
      sent: (data || []).filter((r) => r.status === 'sent').length,
      failed: (data || []).filter((r) => r.status === 'failed').length,
    };
  };

  try {
    // ---- external recipients, individually, throttled ------------------
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
          const detail = [err.responseCode, err.response, err.message]
            .filter(Boolean).join(' | ').slice(0, 1000);
          await admin.from('blast_recipients')
            .update({ status: 'failed', error_text: detail }).eq('id', rec.id);
          console.error(`FAILED ${rec.email}: ${detail}`);
          if (isRestricted(err)) {
            const c = await counts();
            await setRun({ status: 'failed', sent_count: c.sent, failed_count: c.failed,
              error_message: `Sender restricted (550 5.1.8). Halted at ${c.sent} sent.`,
              finished_at: new Date().toISOString() });
            transporter.close();
            return json({ halted: true });
          }
        }
        if (i < extPending.length - 1) await sleep(SLICE_GAP_MS);
      }
      const c = await counts();
      await setRun({ sent_count: c.sent, failed_count: c.failed });
      transporter.close();
      await chainNext(request, runId, drawDate);
      return json({ slice: 'external', sent: extPending.length });
    }

    // ---- internal @nla.gd staff: one message, staff in CC ---------------
    const { data: intPending } = await admin.from('blast_recipients')
      .select('id, email').eq('run_id', runId).eq('is_internal', true).eq('status', 'pending');

    if (intPending?.length) {
      await setRun({ status: 'sending_internal' });
      try {
        const info = await transporter.sendMail({
          from: FROM_ADDR, to: REPLY_TO,
          cc: intPending.map((r) => r.email).join(', '),
          subject, html, text,
          headers: { 'X-Entity-Ref-ID': `${runId}-internal` },
        });
        await admin.from('blast_recipients').update({
          status: 'sent', sent_at: new Date().toISOString(),
          smtp_response: info.response?.slice(0, 500) ?? null,
        }).in('id', intPending.map((r) => r.id));
      } catch (err) {
        const detail = [err.responseCode, err.response, err.message]
          .filter(Boolean).join(' | ').slice(0, 1000);
        await admin.from('blast_recipients').update({ status: 'failed', error_text: detail })
          .in('id', intPending.map((r) => r.id));
      }
    }
    transporter.close();

    // ---- website push, then finish --------------------------------------
    let website = null;
    const date = drawDate || run.draw_date;
    try {
      const [daily, cashPops, lotto, super6] = await Promise.all([
        admin.from('daily_results').select('*').eq('draw_date', date).then((r) => r.data || []),
        admin.from('cash_pop_results').select('*').eq('draw_date', date).then((r) => r.data || []),
        admin.from('lotto_results').select('*').eq('draw_date', date).maybeSingle().then((r) => r.data),
        admin.from('super6_results').select('*').eq('draw_date', date).maybeSingle().then((r) => r.data),
      ]);
      website = await pushResultsToWebsite({ date, daily, cashPops, lotto, super6 });
    } catch (e) { website = { error: e.message }; }

    const c = await counts();
    await setRun({
      status: 'complete', sent_count: c.sent, failed_count: c.failed,
      error_message: website?.failed?.length
        ? `${website.failed.length} website update(s) failed.` : null,
      finished_at: new Date().toISOString(),
    });
    return json({ done: true, sent: c.sent, failed: c.failed });
  } catch (err) {
    transporter.close();
    console.error('slice crashed:', err);
    await setRun({ status: 'failed', error_message: err.message?.slice(0, 1000),
      finished_at: new Date().toISOString() });
    return json({ error: err.message }, 500);
  }
};

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

export const config = { path: '/api/send-blast-slice' };
