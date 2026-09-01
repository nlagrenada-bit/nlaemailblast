// POST /api/push-website  { drawDate }
// Pushes a day's results to the website/database without sending any email.
// Approver/admin only. Used by the "Update the website/database only" option.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { createClient } from '@supabase/supabase-js';
import { pushResultsToWebsite } from './lib/websiteWebhook.mjs';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);
  if (!['approver', 'admin'].includes(auth.staff.role)) {
    return json({ error: 'Only an approver or admin can update the website.' }, 403);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }
  const drawDate = (body?.drawDate || '').trim();
  if (!drawDate) return json({ error: 'drawDate is required.' }, 400);

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  const [daily, cashPops, lotto, super6] = await Promise.all([
    admin.from('daily_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('cash_pop_results').select('*').eq('draw_date', drawDate).then((r) => r.data || []),
    admin.from('lotto_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
    admin.from('super6_results').select('*').eq('draw_date', drawDate).maybeSingle().then((r) => r.data),
  ]);

  const website = await pushResultsToWebsite({ date: drawDate, daily, cashPops, lotto, super6 });
  if (website?.skipped) return json({ error: 'Website endpoint is not configured (WEBSITE_WEBHOOK_URL).' }, 400);
  return json({ ok: true, website });
};

export const config = { path: '/api/push-website' };
