// netlify/functions/publish-day-background.mjs
//
// Puts a day's results on the websites, as a Netlify BACKGROUND function.
//
// Why background: a normal function is stopped after 10 seconds. A website
// push talks to two outside servers, and when either is slow or down the push
// ran out of time, so draws were left unsent ("time limit reached") and an
// unreachable site could starve the other one. A background function may run
// for up to 15 minutes, so every draw gets its full chance, with retries.
//
// Netlify answers the caller with 202 at once; the outcome is written to the
// blast_runs row, which the app's progress bar is already watching.
//
// Body: { runId, drawDate, force?, thenEmail? }
//   thenEmail  start the email (send-blast-slice) once the websites are done,
//              so "websites, then email" keeps its order.
//
// Safe to call twice: it only acts on a run whose website stage has not
// finished, and it only ever sends what is already stored in the app.

import { createClient } from '@supabase/supabase-js';
import { publishDay } from './lib/publishDay.mjs';

export default async (request) => {
  let runId = null;
  let admin = null;
  try {
    await run(request, (id, a) => { runId = id; admin = a; });
  } catch (e) {
    // Never leave the app waiting on a run that died: record why, and finish it.
    console.error('publish-day-background failed', e);
    if (runId && admin) {
      await admin.from('blast_runs').update({
        website_sent: 0, website_failed: 1,
        website_note: `The background publish stopped with an error: ${String(e?.message || e).slice(0, 300)}`,
        website_done_at: new Date().toISOString(),
        status: 'complete', finished_at: new Date().toISOString(),
      }).eq('id', runId).then(() => {}, () => {});
    }
  }
};

async function run(request, register) {
  let body;
  try { body = await request.json(); } catch { console.error('publish-day-background: no JSON body'); return; }
  const { runId, drawDate, force = false, thenEmail = false } = body || {};
  if (!runId || !drawDate) { console.error('publish-day-background: runId/drawDate missing'); return; }

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });
  register(runId, admin);

  const { data: run, error: readErr } = await admin.from('blast_runs')
    .select('id, status, draw_date, website_done_at').eq('id', runId).single();
  if (readErr) throw new Error(`could not read the run: ${readErr.message}`);
  if (!run || run.website_done_at || run.status === 'complete' || run.status === 'failed') return;
  if (String(run.draw_date).slice(0, 10) !== drawDate) throw new Error(`run is for ${run.draw_date}, asked for ${drawDate}`);

  // Handshake: tells send-blast this background run really started. If this
  // mark never appears, send-blast does the push itself instead.
  await admin.from('blast_runs').update({ website_note: 'Started in the background.' }).eq('id', runId);
  console.log(`publish-day-background: run ${runId} ${drawDate} started`);
  let website;
  try {
    website = await publishDay(admin, drawDate, { force });
  } catch (e) {
    website = { sent: 0, failed: 1, unchanged: 0, errors: [e.message], incomplete: [] };
  }

  const note = [
    ...(website?.incomplete || []).map((x) => `Not sent: ${x}`),
    ...(website?.errors || []),
  ].join(' | ') || null;

  const update = {
    website_sent: website?.sent ?? 0,
    website_failed: website?.failed ?? 0,
    website_note: note,
    website_done_at: new Date().toISOString(),
  };
  // Column added by 13_background_publish.sql; tolerate it being absent.
  const { error } = await admin.from('blast_runs')
    .update({ ...update, website_unchanged: website?.unchanged ?? 0 }).eq('id', runId);
  if (error) await admin.from('blast_runs').update(update).eq('id', runId);

  if (!thenEmail) {
    await admin.from('blast_runs').update({
      status: 'complete', finished_at: new Date().toISOString(),
    }).eq('id', runId);
    return;
  }

  // Websites done: now the email, exactly as send-blast would have started it.
  const base = process.env.URL || new URL(request.url).origin;
  try {
    await fetch(`${base}/api/send-blast-slice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId, drawDate }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* the slice runs on server-side even if this wait is cut short */ }
}
