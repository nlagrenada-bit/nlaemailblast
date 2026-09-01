// netlify/functions/health.mjs
//
// Open https://<your-site>/api/health in a browser to check the deployment.
// Reports whether functions are routable and which required settings are
// present. Never prints secret VALUES — only whether each is set.

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'content-type': 'application/json' } });

const isSet = (k) => Boolean(process.env[k] && String(process.env[k]).trim());

export default async () => {
  const env = {
    SUPABASE_URL: isSet('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: isSet('SUPABASE_SERVICE_ROLE_KEY'),
    SMTP_HOST: isSet('SMTP_HOST'),
    SMTP_PORT: isSet('SMTP_PORT'),
    SMTP_USER: isSet('SMTP_USER'),
    SMTP_PASS: isSet('SMTP_PASS'),
    MAIL_FROM: isSet('MAIL_FROM') || isSet('BLAST_FROM'),
    MAIL_REPLY_TO: isSet('MAIL_REPLY_TO'),
    WEBSITE_WEBHOOK_URL: isSet('WEBSITE_WEBHOOK_URL'),
  };
  const missing = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);

  // Non-secret echo of what the mailer would use, to catch identity mismatches.
  const smtpUser = process.env.SMTP_USER || null;
  const from = process.env.BLAST_FROM || process.env.MAIL_FROM || null;
  const fromAddr = from ? (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase() : null;
  const identityMatches = smtpUser && fromAddr
    ? smtpUser.trim().toLowerCase() === fromAddr : null;

  return json({
    ok: true,
    functionsRoutable: true,
    time: new Date().toISOString(),
    env,
    missing,
    smtp: {
      user: smtpUser,
      fromAddress: fromAddr,
      // Office 365 rejects sending "as" an address you didn't authenticate as.
      identityMatches,
      note: identityMatches === false
        ? 'SMTP_USER and the MAIL_FROM address differ. Microsoft 365 will reject the send unless that mailbox has Send As permission on the from-address.'
        : undefined,
    },
  });
};

export const config = { path: '/api/health' };
