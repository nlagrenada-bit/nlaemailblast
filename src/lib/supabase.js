import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail loudly at boot rather than with a confusing network error later.
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
}

export const supabase = createClient(url ?? '', key ?? '');
export const ASSET_BASE = (import.meta.env.VITE_ASSET_BASE_URL || '/assets').replace(/\/$/, '');
