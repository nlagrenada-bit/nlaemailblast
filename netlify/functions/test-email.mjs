// POST /api/test-email   { to }
//
// Sends a small test message through the configured SMTP/provider so an
// operator can confirm the sending address works before relying on it for a
// real blast. Approver/admin only.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { mailer } from './lib/mailer.mjs';

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!['approver', 'admin'].includes(auth.staff.role)) {
    return json({ error: 'Only an approver or admin can send a test.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }
  const to = (body?.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json({ error: 'Enter a valid email address to test.' }, 400);

  const from = process.env.MAIL_FROM;
  if (!from) return json({ error: 'MAIL_FROM is not configured on the site.' }, 500);

  const when = new Date().toLocaleString('en-US', { timeZone: 'America/Grenada' });
  try {
    const res = await mailer().send({
      from,
      replyTo: process.env.MAIL_REPLY_TO,
      to: [to],
      subject: 'NLA Results Desk — test email',
      text: `This is a test from the NLA Results Desk.\n\nIf you received this, the sending address is working.\n\nSent: ${when}\nFrom: ${from}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#16202f;line-height:1.6">
        <p>This is a test from the <strong>NLA Results Desk</strong>.</p>
        <p>If you received this, the sending address is working correctly.</p>
        <p style="color:#5a6b84;font-size:13px">Sent: ${when}<br>From: ${from}</p></div>`,
    });
    if (res.error) return json({ error: res.error }, 502);
    return json({ ok: true, to, from });
  } catch (e) {
    return json({ error: e.message || 'The test could not be sent.' }, 500);
  }
};

export const config = { path: '/api/test-email' };
