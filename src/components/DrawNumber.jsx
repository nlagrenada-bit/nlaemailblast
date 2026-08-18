import React, { useEffect, useState } from 'react';

/**
 * Draw number entry for one game.
 *
 * The number belongs to the draw, not the date. If a draw is postponed to the
 * next day, cancelled, or run out of its usual slot, the sequence has to follow
 * what actually happened — so this suggests the next number and gets out of the
 * way. It warns about a jump or a step backwards rather than blocking, because
 * after a disruption a gap is often the correct answer.
 */
export default function DrawNumber({ value, suggestion, onChange }) {
  const [draft, setDraft] = useState('');
  useEffect(() => { setDraft(value === null || value === undefined ? '' : String(value)); }, [value]);

  const next = suggestion?.next;
  const last = suggestion?.last;
  const entered = draft === '' ? null : Number(draft);

  const commit = () => {
    const n = draft.trim() === '' ? null : Number(draft.replace(/[^\d]/g, ''));
    if (n === (value ?? null)) return;
    onChange(Number.isFinite(n) ? n : null);
  };

  let hint = null;
  if (entered !== null && last !== null && last !== undefined) {
    const gap = entered - last;
    if (entered === next) hint = null;
    else if (gap > 1) hint = `${gap - 1} number${gap - 1 === 1 ? '' : 's'} skipped since ${last}. Fine after a cancelled draw — just check it was.`;
    else if (gap <= 0) hint = `This is at or behind the last number issued (${last}). Check you are not reusing a draw number.`;
  }

  return (
    <div
      className="row"
      style={{
        marginBottom: 18, paddingBottom: 16,
        borderBottom: '1px solid var(--line-2)', alignItems: 'flex-end',
      }}
    >
      <div className="field">
        <label>Draw number</label>
        <input
          className="money" type="text" inputMode="numeric" value={draft}
          placeholder={next ? String(next) : '—'} style={{ width: 140 }}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>

      {next !== undefined && next !== null && entered !== next && (
        <button
          className="btn sm"
          onClick={() => { setDraft(String(next)); onChange(next); }}
        >
          Use {next}
        </button>
      )}

      {hint && (
        <div className="notice warn" style={{ margin: 0, flex: '1 1 260px', padding: '8px 12px', fontSize: 12.5 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
