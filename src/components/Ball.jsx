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

  function handle(e) {
    const raw = e.target.value.replace(/[^\d]/g, '').slice(0, width);
    if (raw === '') return onChange('');
    const n = Number(raw);
    if (n > max) {
      // Two-digit games: '3' is valid on the way to '35', but '37' is not.
      if (raw.length >= String(max).length) return;
      return onChange(n);
    }
    onChange(n);
    if (autoAdvance && raw.length >= width) autoAdvance();
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
            inputs?.[i + 1]?.focus();
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
