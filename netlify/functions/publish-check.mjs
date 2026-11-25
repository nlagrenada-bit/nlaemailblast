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
import { overview, checkOmpGame, GAMES } from './lib/publishCheck.mjs';

const json = (b, s = 200) =>
  new Response(JSON.stringify(b, null, 2), {
    status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);

  const auth = await requireStaff(request);
  if (auth.error) return json({ error: auth.error }, auth.status);

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
