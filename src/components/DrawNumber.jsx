import React, { useEffect, useRef, useState } from 'react';

/**
 * Draw number entry for one game.
 *
 * The number belongs to the draw, not the date. If a draw is postponed, is
 * cancelled, or runs out of its usual slot, the sequence has to follow what
 * actually happened.
 *
 * HOW IT BEHAVES, AND WHY
 *
 * Starting a draw, the field is LOCKED and the next number is offered:
 *
 *      Draw number [ 3996 ]  [ Use 3996 ]   next after 3995
 *
 * Nothing can be typed until "Use" is pressed. That is deliberate: the app's
 * own sequence is right the overwhelming majority of the time, and an
 * accidental keystroke in an unlocked field silently produces a wrong draw
 * number that is then published and emailed.
 *
 * Once "Use" is pressed the suggestion has served its purpose: the button and
 * its note disappear for that draw, and the field unlocks so the number can be
 * corrected by hand if the sequence really did move.
 *
 * A draw that already has a number saved opens unlocked, with no suggestion —
 * the number is settled, and only a correction would change it.
 *
 * The one message that survives is the duplicate warning. If a number is typed
 * that is at or behind the last one issued, that is a real risk of reusing a
 * draw number, so it is still said plainly.
 */
export default function DrawNumber({ value, suggestion, onChange }) {
  const [draft, setDraft] = useState('');
  // Has the operator taken the suggestion for THIS draw? Resets when the draw
  // changes, which is what makes the lock reappear on the next one.
  const [accepted, setAccepted] = useState(false);
  const inputRef = useRef(null);

  const next = suggestion?.next;
  const last = suggestion?.last;

  useEffect(() => {
    setDraft(value === null || value === undefined ? '' : String(value));
    // Arriving at a draw that already has a number: treat it as settled, so it
    // is editable and unprompted. Arriving at an empty one: lock and suggest.
    setAccepted(value !== null && value !== undefined);
  }, [value === null || value === undefined, suggestion?.next]);

  // Keep the box in step when the saved value changes underneath us — another
  // operator editing the same draw, or a refresh.
  useEffect(() => {
    setDraft(value === null || value === undefined ? '' : String(value));
  }, [value]);

  const entered = draft === '' ? null : Number(draft);
  // The lock exists to make someone take the suggestion deliberately. With no
  // suggestion there is nothing to take — locking would leave the field with
  // no way in at all.
  const locked = !accepted && next != null;

  const commit = () => {
    const n = draft.trim() === '' ? null : Number(draft.replace(/[^\d]/g, ''));
    if (n === (value ?? null)) return;
    onChange(Number.isFinite(n) ? n : null);
  };

  const useSuggestion = () => {
    setDraft(String(next));
    setAccepted(true);
    onChange(next);
    // Put the cursor in the field, so a correction needs no extra click.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  /* Only ever warn about reusing a number. The "numbers skipped" note was
     useful while the field was free-form, but now a gap can only appear
     because someone typed it deliberately after taking the suggestion. */
  let warning = null;
  if (accepted && entered !== null && last !== null && last !== undefined
      && entered !== next && entered - last <= 0) {
    warning = `This is at or behind the last number issued (${last}). `
      + 'Check you are not reusing a draw number.';
  }

  return (
    <div
      className="row drawno"
      style={{
        marginBottom: 18, paddingBottom: 16,
        borderBottom: '1px solid var(--line-2)', alignItems: 'flex-end',
      }}
    >
      <div className="field">
        <label>Draw number</label>
        <input
          ref={inputRef}
          className={`money${locked ? ' locked' : ''}`}
          type="text" inputMode="numeric"
          value={locked && next != null ? String(next) : draft}
          placeholder={next != null ? String(next) : '—'}
          style={{ width: 140 }}
          readOnly={locked}
          title={locked
            ? 'Press Use to accept this number. It can be changed afterwards.'
            : 'Change this only if the sequence really did move.'}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>

      {locked && next != null && (
        <>
          <button className="btn sm primary" onClick={useSuggestion}>
            Use {next}
          </button>
          {last != null && (
            <span className="drawno-note">next after {last}</span>
          )}
        </>
      )}

      {!accepted && next == null && (
        <span className="drawno-note">
          No earlier draw to count from — type the draw number.
        </span>
      )}

      {warning && (
        <div className="notice warn" style={{ margin: 0, flex: '1 1 260px', padding: '8px 12px', fontSize: 12.5 }}>
          {warning}
        </div>
      )}
    </div>
  );
}
