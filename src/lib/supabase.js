import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail loudly at boot rather than with a confusing network error later.
  console.error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.');
}

export const supabase = createClient(url ?? '', key ?? '');

// Two asset bases with different needs:
//
//  ASSET_BASE       — for the app UI (logos, symbols, balls shown on screen).
//                     Always served from this same site, so a relative '/assets'
//                     is the most robust default: it can't be broken by a
//                     mis-set or placeholder VITE_ASSET_BASE_URL. Only an
//                     explicit absolute http(s) URL overrides it.
//
//  EMAIL_ASSET_BASE — baked into the emails, which are opened *outside* the
//                     site, so it MUST be an absolute URL. Falls back to the
//                     current origin so a forgotten variable still works.
const configured = (import.meta.env.VITE_ASSET_BASE_URL || '').replace(/\/$/, '');
const isAbsolute = /^https?:\/\//i.test(configured) && !/your-site|your-project|example\.com/.test(configured);

export const ASSET_BASE = isAbsolute ? configured : '/assets';

export const EMAIL_ASSET_BASE = isAbsolute
  ? configured
  : (typeof window !== 'undefined' ? `${window.location.origin}/assets` : '/assets');
