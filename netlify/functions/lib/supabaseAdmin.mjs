// Service-role client. Only ever instantiated inside a function — the
// service key bypasses RLS and must never be exposed to the browser.
import { createClient } from '@supabase/supabase-js';

export function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Resolves the caller's Supabase user from the Authorization header. */
export async function requireStaff(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Sign in to send a blast.', status: 401 };

  const db = admin();
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return { error: 'Your session has expired. Sign in again.', status: 401 };

  const { data: staff } = await db.from('staff').select('*').eq('id', user.id).single();
  if (!staff) return { error: 'This account is not on the results desk.', status: 403 };

  return { user, staff, db };
}
