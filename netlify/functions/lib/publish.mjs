// netlify/functions/lib/publish.mjs
//
// Marks a day's results as published.
//
// Entering numbers in the app saves them immediately — that is what makes the
// preview and the draft work. But saving must NOT put them on the public site,
// or a half-typed or test entry appears publicly the moment it is keyed in.
//
// So the public views are gated on published_at, and it is set HERE: only when
// a blast is actually sent, or the operator presses "Update the website only".

export async function markPublished(admin, drawDate) {
  const now = new Date().toISOString();
  const onlyUnset = (q) => q.eq('draw_date', drawDate).is('published_at', null);

  const [a, b, c, d] = await Promise.all([
    onlyUnset(admin.from('daily_results').update({ published_at: now })),
    onlyUnset(admin.from('cash_pop_results').update({ published_at: now })),
    onlyUnset(admin.from('lotto_results').update({ published_at: now })),
    onlyUnset(admin.from('super6_results').update({ published_at: now })),
  ]);

  const errors = [a, b, c, d].map((r) => r?.error?.message).filter(Boolean);
  return { ok: errors.length === 0, errors, publishedAt: now };
}
