// Thin wrapper over the transactional email provider.
//
// Resend is the default. To move to SendGrid/Postmark/Mailgun, implement the
// same send() contract below and switch on EMAIL_PROVIDER — nothing else in
// the app touches the provider.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * @returns {Promise<{id?:string, error?:string}>}
 */
async function resendSend({ from, replyTo, to, bcc, subject, html, text }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from, to, bcc, subject, html, text,
      reply_to: replyTo || undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: body?.message || `Provider returned ${res.status}` };
  return { id: body?.id };
}

export function mailer() {
  const provider = (process.env.EMAIL_PROVIDER || 'resend').toLowerCase();
  if (provider !== 'resend') {
    throw new Error(`EMAIL_PROVIDER "${provider}" has no adapter. Add one in mailer.mjs.`);
  }
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  return { send: resendSend };
}

/** Splits recipients into BCC batches the provider will accept. */
export function batches(list, size = Number(process.env.BATCH_SIZE || 45)) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
