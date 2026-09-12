import React, { useRef } from 'react';
import { symbolFor, symbolImage } from '../../shared/config.js';
import { ASSET_BASE } from '../lib/supabase.js';

const pad = (v, style) =>
  ['playway', 'cashpop', 'lotto', 'super6'].includes(style)
    ? String(v).padStart(2, '0') : String(v);

/** Read-only ball. `style` is the game: playway | pick3 | cash4 | cashpop | lotto | super6 | multix | letter */
export function Ball({ value, style = 'cashpop', small = false }) {
  const filled = value !== '' && value !== null && value !== undefined;
  return (
    <span className={`ball ${filled ? style : 'empty'}${small ? ' sm' : ''}`}>
      {filled ? pad(value, style) : '—'}
    </span>
  );
}

/**
 * A plain number text box for entering a single value (Play Way, Cash Pop, or
 * one Lotto/Super 6 number). The lottery-ball styling is reserved for the
 * email — during entry a clear rectangular field where the number is fully
 * visible is far easier to read and check.
 */
export function BallInput({
  value, onChange, style = 'cashpop', min = 0, max = 9, width = 1,
  label, autoAdvance,
}) {
  const ref = useRef(null);
  const filled = value !== '' && value !== null && value !== undefined;

  /* Move to the next box AFTER React has committed this one. Advancing in the
     same tick as onChange moved focus before the value was applied, which is
     what made the second digit misbehave. */
  const advance = () => {
    if (!autoAdvance) return;
    setTimeout(autoAdvance, 0);
  };

  /* Focusing by keyboard or click already selects the contents; the helper
     below does the same after an automatic advance. */

  function handle(e) {
    /* Keep the LAST digits, not the first.
       Typing into a box that already holds a value appends: '0' + '4' = '04'.
       slice(0, width) kept the '0' and threw the new digit away, so the box
       appeared stuck until the operator highlighted it by hand. */
    const raw = e.target.value.replace(/[^\d]/g, '').slice(-width);
    if (raw === '') return onChange('');

    const n = Number(raw);

    if (n > max) {
      // Reject only when nothing longer could still be valid. For a 1-36 field
      // '3' is fine on the way to '35', but '37' is not.
      if (raw.length >= String(max).length) return;
      onChange(n);
      return;
    }

    onChange(n);

    // When is this box finished?
    //   single digit  -> as soon as one digit is typed
    //   two digit     -> at two digits, OR at one when no second digit could
    //                    keep it in range (e.g. '4' in a 1-34 field: 40+ is out)
    let done = raw.length >= width;
    if (!done && width > 1) {
      done = Number(raw + '0') > max;
    }
    if (done) advance();
  }

  function keyDown(e) {
    if (e.key === 'Backspace' && !e.target.value) onChange('');
    if (e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(max, (Number(value) || min - 1) + 1)); }
    if (e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(min, (Number(value) || min + 1) - 1)); }
  }

  // one-digit games get a narrow box, two-digit a slightly wider one
  const boxClass = `num-box num-box-${width <= 1 ? 'sm' : 'md'}`;

  return (
    <input
      ref={ref}
      className={boxClass}
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={filled ? String(value) : ''}
      placeholder={width <= 1 ? '0' : '—'}
      onChange={handle}
      onKeyDown={keyDown}
      onFocus={(e) => e.target.select()}
    />
  );
}

/** Play Way number plus the chart symbol it maps to, resolved live. */
export function SymbolChip({ number }) {
  if (!number) return null;
  const name = symbolFor(number);
  if (!name) return null;
  return (
    <span className="symbol-chip">
      <img src={`${ASSET_BASE}/${symbolImage(number)}`} alt="" />
      <b>{name}</b>
    </span>
  );
}

/** A row of ball inputs for fixed-length digit games (Pick 3, Cash 4). */
export function DigitRow({ count, digits, onChange, style, label }) {
  const refs = useRef([]);
  const values = Array.from({ length: count }, (_, i) => digits?.[i] ?? '');

  const set = (i, v) => {
    const next = [...values];
    next[i] = v;
    onChange(next.every((d) => d === '' || d === null) ? [] : next);
  };

  return (
    <div className="balls" ref={(el) => { refs.current.root = el; }}>
      {values.map((v, i) => (
        <BallInput
          key={i}
          value={v}
          style={style}
          min={0}
          max={9}
          width={1}
          label={`${label} digit ${i + 1}`}
          onChange={(nv) => set(i, nv)}
          autoAdvance={() => {
            const inputs = refs.current.root?.querySelectorAll('input');
            const next = inputs?.[i + 1];
            // Select as well as focus, so the next digit simply overwrites
            // whatever is there instead of appending to it.
            if (next) { next.focus(); next.select(); }
          }}
        />
      ))}
    </div>
  );
}

/** Multi-X picker. Six fixed outcomes, so buttons beat a dropdown. */
export function MultiXPicker({ value, onChange, options, label }) {
  return (
    <div className="multix-picker" role="group" aria-label={label}>
      {options.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => onChange(value === m ? null : m)}
        >{m}</button>
      ))}
    </div>
  );
}
