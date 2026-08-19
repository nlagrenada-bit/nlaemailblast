// Thin wrapper over the transactional email provider.
//
// Two adapters ship: 'smtp' (Microsoft 365 / any SMTP server) and 'resend'.
// Both honour the same send() contract, so nothing else in the app changes
// when you switch EMAIL_PROVIDER.
//
// Default is 'smtp', configured for Microsoft 365 with these env vars:
//   SMTP_HOST=smtp.office365.com
//   SMTP_PORT=587
//   SMTP_USER=results@nla.gd
//   SMTP_PASS=<app password for that mailbox>
//   MAIL_FROM="National Lotteries Authority <results@nla.gd>"

import nodemailer from 'nodemailer';

let cachedTransport = null;

function smtpTransport() {
  if (cachedTransport) return cachedTransport;
  const host = process.env.SMTP_HOST || 'smtp.office365.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error('SMTP_USER and SMTP_PASS must be set');

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,            // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
    // Office 365 requires STARTTLS on 587; nodemailer negotiates it automatically.
    tls: { minVersion: 'TLSv1.2' },
    pool: true,                      // reuse one connection across the batch loop
    maxConnections: 1,
    maxMessages: 100,
  });
  return cachedTransport;
}

/**
 * @returns {Promise<{id?:string, error?:string}>}
 */
async function smtpSend({ from, replyTo, to, bcc, subject, html, text }) {
  try {
    const info = await smtpTransport().sendMail({
      from,
      to,                            // the envelope/visible To: (usually the sender itself)
      bcc,                           // the real recipients, hidden from one another
      replyTo: replyTo || undefined,
      subject,
      html,
      text,
    });
    return { id: info.messageId };
  } catch (e) {
    return { error: e?.message || 'SMTP send failed' };
  }
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

async function resendSend({ from, replyTo, to, bcc, subject, html, text }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, bcc, subject, html, text, reply_to: replyTo || undefined }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: body?.message || `Provider returned ${res.status}` };
  return { id: body?.id };
}

export function mailer() {
  const provider = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();
  if (provider === 'smtp') return { send: smtpSend };
  if (provider === 'resend') {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
    return { send: resendSend };
  }
  throw new Error(`EMAIL_PROVIDER "${provider}" has no adapter. Add one in mailer.mjs.`);
}

/**
 * Splits recipients into BCC batches. Microsoft 365 caps a single message at
 * 500 distinct recipients; the default 100 keeps well under that and keeps any
 * one failure small.
 */
export function batches(list, size = Number(process.env.BATCH_SIZE || 100)) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
