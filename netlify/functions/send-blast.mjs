// netlify/functions/send-blast.mjs
//
// Trigger endpoint. Validates, resolves the audience, records a blast_runs row
// INCLUDING THE EXACT MESSAGE the operator previewed, then hands off to
// send-blast-slice.mjs which does the throttled send.
//
// The message is built in the browser (the same code that renders the preview)
// and stored here. The sender never rebuilds it. That is what guarantees a
// single-draw send goes out as that draw, not as the whole day.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { createClient } from '@supabase/supabase-js';
import { publishDay } from './lib/publishDay.mjs';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

const INTERNAL_DOMAIN = '@nla.gd';

function estimateMinutes(externalCount) {
  const perSlice = Number(process.env.SLICE_EXTERNAL || 6);
  const gapMs = Number(process.env.SLICE_GAP_MS || 3000);
  const slices = Math.ceil(externalCount / perSlice);
  return Math.max(1, Math.ceil((slices * perSlice * (gapMs / 1000)) / 60) + 1);
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!['approver', 'admin'].includes(auth.staff.role)) {
    return json({ error: 'Only an approver or admin can send a blast.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }

  const drawDate = (body?.drawDate || '').trim();

  // both (default) | website | email
  const mode = ['both', 'website', 'email'].includes(body?.mode) ? body.mode : 'both';
  const wantsWebsite = mode === 'both' || mode === 'website';
  const wantsEmail   = mode === 'both' || mode === 'email';
  const subject  = (body?.subject || '').trim();
  const html     = body?.html || '';
  const text     = body?.text || '';

  if (!drawDate) return json({ error: 'drawDate is required.' }, 400);
  // Without a message there is nothing to send — and rebuilding it here is what
  // caused single-draw sends to go out as the whole day.
  if (wantsEmail && (!subject || !html)) {
    return json({ error: 'The email could not be prepared. Reopen the draw and try again.' }, 400);
  }

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  // Resolve the audience now, at send time.
  const groupIds = body?.groupIds || null;
  const explicit = body?.emails || null;

  let recipients;
  if (explicit?.length) {
    const { data } = await admin.from('recipients')
      .select('email').in('email', explicit)
      .eq('active', true).eq('unsubscribed', false).is('bounced_at', null);
    recipients = (data || []).map((r) => r.email);
  } else {
    let { data: people } = await admin.from('recipients')
      .select('email, recipient_group_members(group_id)')
      .eq('active', true).eq('unsubscribed', false).is('bounced_at', null);
    if (groupIds?.length) {
      const want = new Set(groupIds);
      people = (people || []).filter((p) =>
        (p.recipient_group_members || []).some((m) => want.has(m.group_id)));
    }
    recipients = (people || []).map((p) => p.email);
  }
  recipients = [...new Set(recipients)];

  if (wantsEmail && !recipients.length) {
    return json({ error: 'No active recipients matched this audience.' }, 422);
  }

  const rows = recipients.map((email) => ({
    email,
    is_internal: email.toLowerCase().endsWith(INTERNAL_DOMAIN),
  }));
  const externalCount = rows.filter((r) => !r.is_internal).length;

  const { data: run, error: runErr } = await admin.from('blast_runs').insert({
    draw_date: drawDate,
    triggered_by: auth.staff.id,
    status: 'queued',
    total_recipients: rows.length,
    subject,
    html,
    text_body: text,
    scope_label: body?.scopeLabel || null,
    scope_kind: body?.scopeKind || null,
    is_resend: !!body?.isResend,
    mode,
  }).select().single();
  if (runErr) return json({ error: runErr.message }, 500);

  /* WEBSITES FIRST.
     The public sites are the record of the result, and a website push takes a
     few seconds while an email run takes a minute or more. Doing it first means
     the results are public the moment the operator commits, rather than after
     the last media house has been emailed — and a problem with the websites is
     known before sixty emails have gone out, not after. */
  let website = null;
  if (wantsWebsite) {
    try {
      // The same routine "update websites only" uses, so the two can never
      // drift apart again — including the jackpots.
      website = await publishDay(admin, drawDate);
    } catch (e) {
      website = { sent: 0, failed: 1, errors: [e.message] };
    }

    const note = [
      ...(website?.incomplete || []).map((x) => `Not sent: ${x}`),
      ...(website?.errors || []),
    ].join(' | ') || null;

    await admin.from('blast_runs').update({
      website_sent: website?.sent ?? 0,
      website_failed: website?.failed ?? 0,
      website_note: note,
      website_done_at: new Date().toISOString(),
    }).eq('id', run.id);
  }

  // Website only: nothing to email, so the run is finished.
  if (!wantsEmail) {
    await admin.from('blast_runs').update({
      status: 'complete', finished_at: new Date().toISOString(),
    }).eq('id', run.id);
    return json({
      runId: run.id, mode, totalRecipients: 0, estimatedMinutes: 0,
      website: { sent: website?.sent ?? 0, failed: website?.failed ?? 0 },
    }, 200);
  }

  const { error: recErr } = await admin.from('blast_recipients')
    .insert(rows.map((r) => ({ run_id: run.id, email: r.email, is_internal: r.is_internal })));
  if (recErr) {
    await admin.from('blast_runs').update({ status: 'failed', error_message: recErr.message })
      .eq('id', run.id);
    return json({ error: recErr.message }, 500);
  }

  // Start the chain. Awaited briefly so the invocation reliably leaves before
  // this function returns; the slice keeps running server-side regardless.
  const base = process.env.URL || `https://${request.headers.get('host')}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  await fetch(`${base}/api/send-blast-slice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId: run.id, drawDate }),
    signal: ctrl.signal,
  }).catch(() => {});
  clearTimeout(t);

  return json({
    runId: run.id,
    mode,
    totalRecipients: rows.length,
    externalRecipients: externalCount,
    estimatedMinutes: estimateMinutes(externalCount),
    website: website ? { sent: website.sent ?? 0, failed: website.failed ?? 0 } : null,
  }, 202);
};

export const config = { path: '/api/send-blast' };
