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
  // Netlify stops a normal function at 10 seconds. Leave room to record the
  // outcome and answer, so the browser always gets a real reply.
  const startedAt = Date.now();
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

  // Website-only needs no audience, so it skips the lookup entirely.
  let recipients = [];
  if (wantsEmail) {
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

  // The audience goes in first, so the email can start the moment the
  // websites are done, wherever that happens.
  if (wantsEmail) {
    const { error: recErr } = await admin.from('blast_recipients')
      .insert(rows.map((r) => ({ run_id: run.id, email: r.email, is_internal: r.is_internal })));
    if (recErr) {
      await admin.from('blast_runs').update({ status: 'failed', error_message: recErr.message })
        .eq('id', run.id);
      return json({ error: recErr.message }, 500);
    }
  }

  const base = process.env.URL || `https://${request.headers.get('host')}`;
  const accepted = {
    runId: run.id, mode,
    totalRecipients: rows.length,
    externalRecipients: externalCount,
    estimatedMinutes: wantsEmail ? estimateMinutes(externalCount) : 0,
  };

  /* WEBSITES FIRST, IN THE BACKGROUND.
     The public sites are the record of the result, so they go before the
     email. The push runs in a background function, which may take up to 15
     minutes, instead of inside this request, which Netlify stops at 10
     seconds. A slow or unreachable site can therefore no longer leave draws
     unsent or cut the request off. The background function starts the email
     itself once the websites are done, so the order is kept.

     Background functions need a Netlify Pro plan. If it is not accepted (202),
     the push runs here instead, inside a time limit, as before. */
  if (wantsWebsite) {
    let bgAccepted = false;
    try {
      const r = await fetch(`${base}/.netlify/functions/publish-day-background`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: run.id, drawDate, force: !!body?.force, thenEmail: wantsEmail }),
        signal: AbortSignal.timeout(3000),
      });
      bgAccepted = r.status === 202;
    } catch { /* not accepted: fall back below */ }

    if (bgAccepted) return json({ ...accepted, website: null, background: true }, 202);

    let website;
    try {
      website = await publishDay(admin, drawDate, { deadline: startedAt + 7500, force: !!body?.force });
    } catch (e) {
      website = { sent: 0, failed: 1, unchanged: 0, errors: [e.message], incomplete: [] };
    }
    const notes = [...(website?.incomplete || []), ...(website?.errors || [])];
    await admin.from('blast_runs').update({
      website_sent: website?.sent ?? 0,
      website_failed: website?.failed ?? 0,
      website_note: notes.map((x, i) => (i < (website?.incomplete || []).length ? `Not sent: ${x}` : x)).join(' | ') || null,
      website_done_at: new Date().toISOString(),
    }).eq('id', run.id);
    accepted.website = {
      sent: website?.sent ?? 0, failed: website?.failed ?? 0,
      unchanged: website?.unchanged ?? 0, notes,
    };

    if (!wantsEmail) {
      await admin.from('blast_runs').update({
        status: 'complete', finished_at: new Date().toISOString(),
      }).eq('id', run.id);
      return json(accepted, 200);
    }
  }

  // Start the chain. Awaited briefly so the invocation reliably leaves before
  // this function returns; the slice keeps running server-side regardless.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  await fetch(`${base}/api/send-blast-slice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId: run.id, drawDate }),
    signal: ctrl.signal,
  }).catch(() => {});
  clearTimeout(t);

  return json(accepted, 202);
};

export const config = { path: '/api/send-blast' };
