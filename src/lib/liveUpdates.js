import { supabase } from './supabase.js';

/**
 * Watch a day's results for changes made by other people.
 *
 * Uses Supabase Realtime rather than polling: the database pushes each change
 * as it happens, so there is no repeated querying and no lag between someone
 * saving and everyone else seeing it.
 *
 * THE SAFEGUARD THAT MATTERS
 * A blind auto-refresh would overwrite whatever the current operator is halfway
 * through typing. So the caller is told a change arrived and decides: apply it
 * straight away when nobody is mid-edit, or offer it when they are.
 *
 * @param date      the draw date being viewed, 'YYYY-MM-DD'
 * @param onChange  called with { table, event } for each change from elsewhere
 * @returns         an unsubscribe function
 */
export function watchDay(date, onChange) {
  if (!date) return () => {};

  const TABLES = [
    'daily_results',
    'cash_pop_results',
    'lotto_results',
    'super6_results',
    'draw_days',
  ];

  const channel = supabase.channel(`day:${date}`);

  for (const table of TABLES) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `draw_date=eq.${date}` },
      (payload) => {
        onChange({
          table,
          event: payload.eventType,          // INSERT | UPDATE | DELETE
          row: payload.new || payload.old,
        });
      },
    );
  }

  channel.subscribe();

  return () => { supabase.removeChannel(channel); };
}

/**
 * Is the operator currently typing into a results field?
 *
 * If so we must not replace what is on screen underneath them. Checks for a
 * focused input or textarea inside the results area.
 */
export function isEditing() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  // Ignore focus in the rail or the send dialog — only entry fields count.
  return !!el.closest('.main');
}
