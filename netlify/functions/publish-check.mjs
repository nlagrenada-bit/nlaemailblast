// GET /api/publish-check?date=2026-11-25                 overview
// GET /api/publish-check?date=2026-11-25&game=lotto      OMP check for one game
//
// Read-only website publishing check. Nothing is written to either website:
// the OMP portal is only read and dry-run (?validate=1), and WordPress is only
// asked for its public route index. Any signed-in staff member may run it.
//
// The app calls the overview first, then each game one at a time, so every
// request stays well inside Netlify's time limit and the portal's 30 requests
// per minute.

import { requireStaff } from './lib/supabaseAdmin.mjs';
import { overview, checkOmpGame, GAMES, wordpressTestSend, wordpressResendDay } from './lib/publishCheck.mjs';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default async (request) => {
  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);

  // POST = the two actions that really send to WordPress. Approver/admin only.
  if (request.method === 'POST') {
    if (!['approver', 'admin'].includes(auth.staff.role)) {
      return json({ error: 'Only an approver or admin can send to the website.' }, 403);
    }
    let b = {};
    try { b = await request.json(); } catch { /* empty */ }
    const d = String(b.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: 'date=YYYY-MM-DD is required.' }, 400);
    try {
      if (b.action === 'wp-test') return json({ lines: await wordpressTestSend(auth.db, d) });
      if (b.action === 'wp-resend') return json({ lines: await wordpressResendDay(auth.db, d) });
      return json({ error: 'Unknown action.' }, 400);
    } catch (e) {
      return json({ error: `The action failed: ${e.message}` }, 500);
    }
  }
  if (request.method !== 'GET') return json({ error: 'Use GET or POST.' }, 405);

  const url = new URL(request.url);
  const date = (url.searchParams.get('date') || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'date=YYYY-MM-DD is required.' }, 400);

  const game = url.searchParams.get('game');
  try {
    if (game) {
      if (!GAMES.includes(game)) return json({ error: `Unknown game "${game}".` }, 400);
      return json({ game, lines: await checkOmpGame(auth.db, date, game) });
    }
    return json(await overview(auth.db, date));
  } catch (e) {
    return json({ error: `The check itself failed: ${e.message}` }, 500);
  }
};

export const config = { path: '/api/publish-check' };
