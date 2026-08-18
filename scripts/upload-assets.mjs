// Uploads public/assets to a public Supabase Storage bucket, for teams that
// would rather serve email images from Supabase than from Netlify.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-assets.mjs
//
// Then point VITE_ASSET_BASE_URL at:
//   https://<project>.supabase.co/storage/v1/object/public/nla-assets

import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

const BUCKET = process.env.ASSET_BUCKET || 'nla-assets';
const ROOT = new URL('../public/assets', import.meta.url).pathname;

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.svg': 'image/svg+xml', '.gif': 'image/gif' };

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const { error: bucketErr } = await db.storage.createBucket(BUCKET, {
  public: true, fileSizeLimit: '5MB',
});
if (bucketErr && !/exists/i.test(bucketErr.message)) throw bucketErr;

let n = 0, failed = 0;
for await (const file of walk(ROOT)) {
  const key = relative(ROOT, file);
  const { error } = await db.storage.from(BUCKET).upload(key, await readFile(file), {
    contentType: TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    upsert: true,
    cacheControl: '31536000',
  });
  if (error) { console.error(`  failed  ${key}: ${error.message}`); failed++; }
  else n++;
}

console.log(`uploaded ${n} files to ${BUCKET}${failed ? `, ${failed} failed` : ''}`);
console.log(`base URL: ${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}`);
