import { supabase } from './supabase.js';

const unwrap = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ------------------------------------------------------------------ a day

export async function loadDay(date) {
  const [day, daily, cashPops, lotto, super6, blasts] = await Promise.all([
    supabase.from('draw_days').select('*').eq('draw_date', date).maybeSingle().then(unwrap),
    supabase.from('daily_results').select('*').eq('draw_date', date).then(unwrap),
    supabase.from('cash_pop_results').select('*').eq('draw_date', date).then(unwrap),
    supabase.from('lotto_results').select('*').eq('draw_date', date).maybeSingle().then(unwrap),
    supabase.from('super6_results').select('*').eq('draw_date', date).maybeSingle().then(unwrap),
    supabase.from('blasts').select('id,kind,label,status,sent_at,recipient_count')
      .eq('draw_date', date).order('created_at', { ascending: false }).then(unwrap),
  ]);
  return { day, daily: daily || [], cashPops: cashPops || [], lotto, super6, blasts: blasts || [] };
}

export const saveDayStatus = (date, patch) =>
  supabase.from('draw_days').upsert({ draw_date: date, ...patch }, { onConflict: 'draw_date' })
    .select().single().then(unwrap);

export const saveDaily = (row) =>
  supabase.from('daily_results').upsert(row, { onConflict: 'draw_date,period' })
    .select().single().then(unwrap);

export const saveCashPop = (row) =>
  supabase.from('cash_pop_results').upsert(row, { onConflict: 'draw_date,period' })
    .select().single().then(unwrap);

export const saveLotto = (row) =>
  supabase.from('lotto_results').upsert(row, { onConflict: 'draw_date' })
    .select().single().then(unwrap);

export const saveSuper6 = (row) =>
  supabase.from('super6_results').upsert(row, { onConflict: 'draw_date' })
    .select().single().then(unwrap);

// -------------------------------------------------------------- recipients

export const listGroups = () =>
  supabase.from('recipient_groups').select('*').order('name').then(unwrap);

export const createGroup = (name, description = null) =>
  supabase.from('recipient_groups')
    .insert({ name: name.trim(), description }).select().single().then(unwrap);

export const renameGroup = (id, name) =>
  supabase.from('recipient_groups')
    .update({ name: name.trim() }).eq('id', id).select().single().then(unwrap);

export const deleteGroup = (id) =>
  supabase.from('recipient_groups').delete().eq('id', id).then(unwrap);

export const listRecipients = () =>
  supabase.from('recipients')
    .select('*, recipient_group_members(group_id)')
    .order('email').then(unwrap);

export const addRecipient = async (row, groupIds = []) => {
  const rec = await supabase.from('recipients').insert(row).select().single().then(unwrap);
  if (groupIds.length) {
    await supabase.from('recipient_group_members')
      .insert(groupIds.map((group_id) => ({ recipient_id: rec.id, group_id })));
  }
  return rec;
};

export const updateRecipient = (id, patch) =>
  supabase.from('recipients').update(patch).eq('id', id).select().single().then(unwrap);

export const removeRecipient = (id) =>
  supabase.from('recipients').delete().eq('id', id).then(unwrap);

export const removeRecipients = (ids) =>
  supabase.from('recipients').delete().in('id', ids).then(unwrap);

export const setGroups = async (recipientId, groupIds) => {
  await supabase.from('recipient_group_members').delete().eq('recipient_id', recipientId);
  if (groupIds.length) {
    await supabase.from('recipient_group_members')
      .insert(groupIds.map((group_id) => ({ recipient_id: recipientId, group_id })));
  }
};

/** Add many recipients to one group (idempotent — ignores already-members). */
export const addToGroup = async (recipientIds, groupId) => {
  if (!recipientIds.length) return;
  await supabase.from('recipient_group_members')
    .upsert(recipientIds.map((recipient_id) => ({ recipient_id, group_id: groupId })),
      { onConflict: 'recipient_id,group_id', ignoreDuplicates: true });
};

/** Remove many recipients from one group. */
export const removeFromGroup = async (recipientIds, groupId) => {
  if (!recipientIds.length) return;
  await supabase.from('recipient_group_members')
    .delete().eq('group_id', groupId).in('recipient_id', recipientIds);
};

/** Member count per group id, as a { [groupId]: count } map. */
export async function groupCounts() {
  const { data } = await supabase.from('recipient_group_members').select('group_id');
  const out = {};
  for (const r of data || []) out[r.group_id] = (out[r.group_id] || 0) + 1;
  return out;
}

/**
 * Bulk import. Accepts pasted text or a CSV: one address per line, optionally
 * `name, email` or `email, name` in either order.
 * @returns {{added:string[], duplicates:string[], invalid:string[]}}
 */
export async function importRecipients(text, groupIds = []) {
  const EMAIL = /[^\s,;<>"]+@[^\s,;<>"]+\.[^\s,;<>"]+/;
  const rows = [];
  const invalid = [];

  for (const raw of text.split(/[\n\r]+/)) {
    const line = raw.trim();
    if (!line || /^(email|e-mail|address)\b/i.test(line)) continue;
    const match = line.match(EMAIL);
    if (!match) { invalid.push(line); continue; }
    const email = match[0].toLowerCase();
    const name = line.replace(match[0], '').replace(/[,;<>"]/g, ' ').trim();
    rows.push({ email, full_name: name || null });
  }

  const seen = new Set();
  const unique = rows.filter((r) => !seen.has(r.email) && seen.add(r.email));
  if (!unique.length) return { added: [], duplicates: [], invalid };

  const { data: existing } = await supabase.from('recipients')
    .select('email').in('email', unique.map((r) => r.email));
  const have = new Set((existing || []).map((r) => r.email.toLowerCase()));
  const fresh = unique.filter((r) => !have.has(r.email));

  let inserted = [];
  if (fresh.length) {
    inserted = await supabase.from('recipients').insert(fresh).select('id,email').then(unwrap);
    if (groupIds.length) {
      await supabase.from('recipient_group_members').insert(
        inserted.flatMap((r) => groupIds.map((group_id) => ({ recipient_id: r.id, group_id }))),
      );
    }
  }

  return {
    added: inserted.map((r) => r.email),
    duplicates: unique.filter((r) => have.has(r.email)).map((r) => r.email),
    invalid,
  };
}

export async function countAudience(groupIds) {
  let q = supabase.from('recipients')
    .select('id, recipient_group_members(group_id)')
    .eq('active', true).eq('unsubscribed', false).is('bounced_at', null);
  const people = await q.then(unwrap);
  if (!groupIds?.length) return people.length;
  const wanted = new Set(groupIds);
  return people.filter((p) => (p.recipient_group_members || [])
    .some((m) => wanted.has(m.group_id))).length;
}

// ------------------------------------------------------------------ blasts

export const createBlast = (row) =>
  supabase.from('blasts').insert(row).select().single().then(unwrap);

export const listBlasts = (limit = 60) =>
  supabase.from('blasts')
    .select('id,draw_date,kind,label,subject,status,recipient_count,sent_count,failed_count,sent_at,created_at,error,is_resend,explicit_emails')
    .order('created_at', { ascending: false }).limit(limit).then(unwrap);

export const getBlast = (id) =>
  supabase.from('blasts').select('*').eq('id', id).single().then(unwrap);

// Triggers a throttled send. Returns { runId, totalRecipients, estimatedMinutes }
// immediately (HTTP 202); the actual send runs server-side over several minutes.
// Poll the run with watchBlastRun() for progress.
export async function sendBlast({ drawDate, groupIds = null, emails = null }) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/send-blast', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ drawDate, groupIds, emails }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'The blast could not be started.');
  return body;   // 202 + { runId, totalRecipients, estimatedMinutes }
}

// Polls a blast_runs row until it completes or fails, calling onProgress with
// each snapshot. Returns the final row. Sends continue server-side even if the
// browser closes — this only watches.
export function watchBlastRun(runId, onProgress, intervalMs = 5000) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      const { data, error } = await supabase.from('blast_runs').select('*').eq('id', runId).single();
      if (error) return;   // transient — try again next tick
      onProgress?.(data);
      if (data.status === 'complete' || data.status === 'failed') {
        clearInterval(timer);
        if (data.status === 'failed') reject(new Error(data.error_message || 'The send failed.'));
        else resolve(data);
      }
    };
    const timer = setInterval(tick, intervalMs);
    tick();
  });
}

// ---------------------------------------------------------------- settings

export async function loadSettings() {
  const rows = await supabase.from('settings').select('key,value').then(unwrap);
  return Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
}

export const saveSetting = (key, value) =>
  supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
    .then(unwrap);

// ---------------------------------------------------------- draw numbers

/** { play_way: {last, next}, pick3: {...}, ... } */
export async function nextDrawNumbers() {
  const { data, error } = await supabase.rpc('next_draw_numbers');
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((r) => [r.game, { last: r.last_no, next: r.next_no }]));
}

// ---------------------------------------------------------- test email

export async function sendTestEmail(to) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/test-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ to }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'The test could not be sent.');
  return body;
}

// --------------------------------------------------------- archive / history

/** Distinct dates that have any result, most recent first, for browsing. */
export async function listResultDates({ from, to, limit = 400 } = {}) {
  // Pull dates from each table and merge; Supabase has no cross-table distinct.
  const q = (t) => {
    let sel = supabase.from(t).select('draw_date').order('draw_date', { ascending: false }).limit(limit);
    if (from) sel = sel.gte('draw_date', from);
    if (to) sel = sel.lte('draw_date', to);
    return sel.then(({ data }) => (data || []).map((r) => r.draw_date));
  };
  const [a, b, c, d] = await Promise.all([
    q('daily_results'), q('cash_pop_results'), q('lotto_results'), q('super6_results'),
  ]);
  const set = new Set([...a, ...b, ...c, ...d]);
  return [...set].sort().reverse().slice(0, limit);
}

/** Find the date a given game + draw number belongs to. */
export async function findByDrawNo(game, drawNo) {
  const n = Number(drawNo);
  if (!n) return null;
  if (game === 'lotto' || game === 'super6') {
    const { data } = await supabase.from(`${game}_results`).select('draw_date').eq('draw_no', n).maybeSingle();
    return data ? { date: data.draw_date, game } : null;
  }
  if (game === 'cash_pop') {
    const { data } = await supabase.from('cash_pop_results').select('draw_date,period').eq('draw_no', n).maybeSingle();
    return data ? { date: data.draw_date, game, period: data.period } : null;
  }
  // daily games each have their own draw-number column
  const col = { play_way: 'play_way_draw_no', pick3: 'pick3_draw_no', cash4: 'cash4_draw_no' }[game];
  if (!col) return null;
  const { data } = await supabase.from('daily_results').select('draw_date,period').eq(col, n).maybeSingle();
  return data ? { date: data.draw_date, game, period: data.period } : null;
}

// -------------------------------------------------- ad-hoc send selection

/** Active, sendable recipients (for the "pick specific addresses" sender). */
export const listSendable = () =>
  supabase.from('recipients')
    .select('id, email, full_name')
    .eq('active', true).eq('unsubscribed', false).is('bounced_at', null)
    .order('email').then(unwrap);

// Push a day's results to the website/database only — no email sent.
export async function pushToWebsite(drawDate) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/push-website', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify({ drawDate }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'The website update failed.');
  return body;
}
