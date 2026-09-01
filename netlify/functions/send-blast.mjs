// netlify/functions/send-blast.mjs
//
// Trigger endpoint. It no longer sends mail itself — it validates, builds the
// recipient list (splitting internal @nla.gd staff from external media houses),
// records a blast_runs row, and hands off to send-blast-background.mjs, which
// does the throttled send over several minutes. Returns 202 + a runId that the
// browser polls for progress.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { createClient } from '@supabase/supabase-js';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

const INTERNAL_DOMAIN = '@nla.gd';

// Estimate for the operator: external throttled at ~20/min via chained slices,
// plus a moment for the internal CC.
function estimateMinutes(externalCount) {
  const perSlice = Number(process.env.SLICE_EXTERNAL || 6);
  const gapMs = Number(process.env.SLICE_GAP_MS || 3000);
  const perSliceSeconds = perSlice * (gapMs / 1000);
  const slices = Math.ceil(externalCount / perSlice);
  return Math.max(1, Math.ceil((slices * perSliceSeconds) / 60) + 1);
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  // Role gate — approver or admin only.
  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!['approver', 'admin'].includes(auth.staff.role)) {
    return json({ error: 'Only an approver or admin can send a blast.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }
  const drawDate = (body?.drawDate || body?.draw_date || '').trim();
  if (!drawDate) return json({ error: 'drawDate is required.' }, 400);

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  // Resolve the audience now, at send time.
  const groupIds = body?.groupIds || null;
  const explicit = body?.emails || null;   // ad-hoc "pick specific addresses"

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

  if (!recipients.length) {
    return json({ error: 'No active recipients matched this audience.' }, 422);
  }

  // Split internal (tenant-local, CC'd) from external (throttled per-recipient).
  const rows = recipients.map((email) => ({
    email,
    is_internal: email.toLowerCase().endsWith(INTERNAL_DOMAIN),
  }));
  const externalCount = rows.filter((r) => !r.is_internal).length;

  // Create the run and its per-recipient rows.
  const { data: run, error: runErr } = await admin.from('blast_runs').insert({
    draw_date: drawDate,
    triggered_by: auth.staff.id,
    status: 'queued',
    total_recipients: rows.length,
  }).select().single();
  if (runErr) return json({ error: runErr.message }, 500);

  const { error: recErr } = await admin.from('blast_recipients')
    .insert(rows.map((r) => ({ run_id: run.id, email: r.email, is_internal: r.is_internal })));
  if (recErr) {
    await admin.from('blast_runs').update({ status: 'failed', error_message: recErr.message })
      .eq('id', run.id);
    return json({ error: recErr.message }, 500);
  }

  // Kick off the chain. Each slice sends a few, then re-invokes itself until
  // done — no background function needed, works on any Netlify plan.
  const base = process.env.URL || `https://${request.headers.get('host')}`;
  fetch(`${base}/api/send-blast-slice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId: run.id, drawDate }),
  }).catch((e) => console.error('slice invoke failed:', e.message));

  return json({
    runId: run.id,
    totalRecipients: rows.length,
    externalRecipients: externalCount,
    estimatedMinutes: estimateMinutes(externalCount),
  }, 202);
};

export const config = { path: '/api/send-blast' };
