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

export const listRecipients = () =>
  supabase.from('recipients')
    .select('*, recipient_group_members(group_id)')
    .order('email').then(unwrap);

export const addRecipient = (row) =>
  supabase.from('recipients').insert(row).select().single().then(unwrap);

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
    .select('id,draw_date,kind,label,subject,status,recipient_count,sent_count,failed_count,sent_at,created_at,error')
    .order('created_at', { ascending: false }).limit(limit).then(unwrap);

export const getBlast = (id) =>
  supabase.from('blasts').select('*').eq('id', id).single().then(unwrap);

export async function sendBlast(blastId) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/send-blast', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ blastId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'The blast could not be sent.');
  return body;
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
