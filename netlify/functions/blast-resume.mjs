// netlify/functions/blast-resume.mjs
//
// Safety net for the chained sender. Serverless invocations can occasionally be
// dropped, which would leave a run stalled (status queued/sending_* with rows
// still pending). This scheduled function runs every few minutes, finds any
// stalled run, and re-kicks its slice chain. Idempotent: if a run is already
// moving or finished, re-invoking does nothing harmful (the slice guard and the
// pending-row filter handle it).

import { createClient } from '@supabase/supabase-js';

const STALE_MS = 90_000;   // a run untouched for 90s with pending rows is stalled

export default async (request) => {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } });

  // Non-terminal runs that haven't been touched recently. A live chain updates
  // the run every slice (~18s), so anything quiet for STALE_MS has stalled.
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data: runs } = await admin.from('blast_runs')
    .select('id, draw_date, status, updated_at')
    .in('status', ['queued', 'sending_external', 'waiting', 'sending_internal'])
    .lt('updated_at', staleBefore);

  if (!runs?.length) return new Response(JSON.stringify({ resumed: 0 }), { status: 200 });

  const base = process.env.URL || `https://${request.headers.get('host')}`;
  let resumed = 0;

  for (const run of runs) {
    // Does it still have pending recipients? If not, complete it.
    const { data: pend } = await admin.from('blast_recipients')
      .select('id').eq('run_id', run.id).eq('status', 'pending').limit(1);

    if (!pend?.length) {
      await admin.from('blast_runs').update({
        status: 'complete', finished_at: new Date().toISOString(),
      }).eq('id', run.id);
      continue;
    }

    // Re-kick the slice chain for this run.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    await fetch(`${base}/api/send-blast-slice`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: run.id, drawDate: run.draw_date }), signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(t);
    resumed++;
  }

  return new Response(JSON.stringify({ resumed }), { status: 200 });
};

// Every 2 minutes. A stalled run resumes within ~2 min automatically.
export const config = { schedule: '*/2 * * * *' };
