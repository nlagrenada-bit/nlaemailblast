// POST /api/send-blast   { blastId }
//
// The browser never sends mail directly. It saves a draft blast (subject,
// html, text, audience) and calls this. That way the exact bytes an operator
// approved in the preview are the bytes that go out, and the provider key
// stays server-side.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { mailer, batches, sleep } from './lib/mailer.mjs';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  const { db, user, staff } = auth;

  if (!['approver', 'admin'].includes(staff.role)) {
    return json({ error: 'Only an approver or admin can send a blast.' }, 403);
  }

  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }
  const { blastId } = payload || {};
  if (!blastId) return json({ error: 'blastId is required.' }, 400);

  const { data: blast, error: readErr } = await db
    .from('blasts').select('*').eq('id', blastId).single();
  if (readErr || !blast) return json({ error: 'That blast no longer exists.' }, 404);
  if (['sending', 'sent'].includes(blast.status)) {
    return json({ error: `This blast is already ${blast.status}.` }, 409);
  }

  // Claim it before doing anything slow, so a double-click can't send twice.
  const { data: claimed } = await db.from('blasts')
    .update({ status: 'sending', approved_by: user.id })
    .eq('id', blastId).in('status', ['draft', 'queued', 'failed'])
    .select('id').maybeSingle();
  if (!claimed) return json({ error: 'Another sender already picked this up.' }, 409);

  // Resolve the audience at send time, so removals since drafting are honoured.
  let query = db.from('recipients')
    .select('email, recipient_group_members(group_id)')
    .eq('active', true).eq('unsubscribed', false).is('bounced_at', null);

  let { data: people, error: recErr } = await query;
  if (recErr) {
    await db.from('blasts').update({ status: 'failed', error: recErr.message }).eq('id', blastId);
    return json({ error: 'Could not load the recipient list.' }, 500);
  }

  if (blast.group_ids?.length) {
    const wanted = new Set(blast.group_ids);
    people = people.filter((p) =>
      (p.recipient_group_members || []).some((m) => wanted.has(m.group_id)));
  }

  const emails = [...new Set(people.map((p) => p.email))];
  if (!emails.length) {
    await db.from('blasts').update({
      status: 'failed', error: 'No active recipients matched this audience.',
    }).eq('id', blastId);
    return json({ error: 'No active recipients matched this audience.' }, 400);
  }

  const from = process.env.MAIL_FROM;
  if (!from) {
    await db.from('blasts').update({ status: 'failed', error: 'MAIL_FROM is not set' }).eq('id', blastId);
    return json({ error: 'MAIL_FROM is not configured on the site.' }, 500);
  }

  const send = mailer().send;
  const envelope = process.env.MAIL_ENVELOPE || from;   // the visible To:
  let sent = 0, failed = 0;
  const rows = [];

  for (const group of batches(emails)) {
    const res = await send({
      from,
      replyTo: process.env.MAIL_REPLY_TO,
      to: [envelope],
      bcc: group,                // recipients never see each other
      subject: blast.subject,
      html: blast.html,
      text: blast.text_body,
    });
    if (res.error) {
      failed += group.length;
      rows.push(...group.map((e) => ({ blast_id: blastId, email: e, status: 'failed', error: res.error })));
    } else {
      sent += group.length;
      rows.push(...group.map((e) => ({ blast_id: blastId, email: e, status: 'sent', provider_id: res.id })));
    }
    await sleep(Number(process.env.BATCH_DELAY_MS || 600));   // stay inside provider rate limits
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db.from('blast_deliveries').insert(rows.slice(i, i + 500));
  }

  const status = failed === 0 ? 'sent' : (sent === 0 ? 'failed' : 'sent');
  await db.from('blasts').update({
    status,
    recipient_count: emails.length,
    sent_count: sent,
    failed_count: failed,
    sent_at: new Date().toISOString(),
    error: failed ? `${failed} address(es) were rejected by the provider.` : null,
  }).eq('id', blastId);

  return json({ ok: true, sent, failed, recipients: emails.length });
};

export const config = { path: '/api/send-blast' };
