// netlify/functions/lib/pushAll.mjs
//
// Fans a day's results out to every configured results target.
//
//   1. OMP Results API      about.nla.gd/omp/api/v1   (Bearer token)
//   2. WordPress webhooks   hexivedev.com/wp-json/... (X-Webhook-Secret)
//
// The two are independent: each is attempted regardless of the other, so one
// site being down never stops the other from updating. A target that isn't
// configured is reported as skipped, not as a failure.

import { pushResultsToWebsite } from './websiteWebhook.mjs';
import { pushResultsToHexive } from './hexiveWebhook.mjs';

export async function pushResultsEverywhere(doc) {
  const [omp, wp] = await Promise.allSettled([
    pushResultsToWebsite(doc),
    pushResultsToHexive(doc),
  ]);

  const unwrap = (r, name) =>
    r.status === 'fulfilled' ? r.value : { failed: [{ error: r.reason?.message || String(r.reason) }], sent: 0, target: name };

  const targets = {
    omp: unwrap(omp, 'omp'),
    wordpress: unwrap(wp, 'wordpress'),
  };

  // A single summary the caller can report without knowing the shapes.
  let sent = 0, failed = 0;
  const notConfigured = [];      // a whole target that is switched off
  const incomplete = [];         // a game that could not be sent, and why
  const errors = [];             // a game that was sent and rejected

  for (const [name, t] of Object.entries(targets)) {
    // NOTE: test notConfigured, never `skipped`. `skipped` is always an array
    // and an empty array is truthy in JavaScript — testing it made every
    // configured target look switched off.
    if (t.notConfigured) { notConfigured.push(`${name}: ${t.reason}`); continue; }
    sent += t.sent || 0;
    failed += t.failed?.length || 0;
    for (const s of t.skipped || []) {
      if (!incomplete.includes(s)) incomplete.push(s);   // same on both targets
    }
    for (const f of t.failed || []) {
      errors.push(`${name} ${f.game || ''} ${f.error || ''}`.trim());
    }
  }

  return { sent, failed, skipped: notConfigured, incomplete, errors, targets };
}
