#!/usr/bin/env node
/**
 * apply-refresh.mjs — wires the 10-minute refresh and time-of-day draw
 * selection into src/views/ResultsView.jsx.
 *
 * Run from the ROOT of the app repo (the folder containing package.json):
 *
 *     node apply-refresh.mjs
 *
 * A .bak copy is written first. Safe to run twice — it detects work already
 * done and skips. If an anchor cannot be found it says exactly what to add by
 * hand rather than guessing and corrupting the file.
 */
import fs from 'node:fs';
import path from 'node:path';

const VIEW = 'src/views/ResultsView.jsx';
const LIB  = 'src/lib/autoRefresh.js';

const fail = (msg) => { console.error(`\n  ${msg}\n`); process.exit(1); };

if (!fs.existsSync('package.json')) {
  fail('Run this from the root of the app repo (where package.json is).');
}
if (!fs.existsSync(VIEW)) fail(`Cannot find ${VIEW}`);
if (!fs.existsSync(LIB)) {
  fail(`Cannot find ${LIB}. Copy src/lib/autoRefresh.js into place first.`);
}

let s = fs.readFileSync(VIEW, 'utf8');
const before = s;
const done = [];
const manual = [];

// ---------------------------------------------------------------- 1. import
if (s.includes('autoRefresh.js')) {
  done.push('import already present');
} else {
  const m = s.match(/^import .*?from '\.\.\/lib\/api\.js';$/m);
  if (m) {
    s = s.replace(m[0], `${m[0]}\nimport { usePeriodicRefresh, drawForTimeOfDay, isTypingInResults, gdToday }\n  from '../lib/autoRefresh.js';`);
    done.push('added the import');
  } else {
    manual.push(`Add near the other imports in ${VIEW}:\n`
      + `    import { usePeriodicRefresh, drawForTimeOfDay, isTypingInResults, gdToday }\n`
      + `      from '../lib/autoRefresh.js';`);
  }
}

// ------------------------------------------------- 2. the periodic refresh
if (s.includes('usePeriodicRefresh(')) {
  done.push('periodic refresh already present');
} else {
  // Anchor on the effect that reloads when the date changes.
  const m = s.match(/useEffect\(\(\) => \{ setState\(null\); reload\(\);[^\n]*\n/);
  if (m) {
    s = s.replace(m[0], `${m[0]}
  /* The desk is left open all day, so the screen is refreshed every ten minutes
     — and whenever the tab is brought back to the front, which is when a stale
     screen is most likely and most confusing. Never while someone is typing:
     replacing what is on screen underneath them would lose their work. */
  usePeriodicRefresh(reload, 600_000, isTypingInResults);
`);
    done.push('added the 10-minute refresh');
  } else {
    manual.push(`Add just after the effect that calls reload() on a date change:\n`
      + `    usePeriodicRefresh(reload, 600_000, isTypingInResults);`);
  }
}

// ------------------------------------------- 3. time-of-day draw selection
if (s.includes('drawForTimeOfDay(')) {
  done.push('time-of-day selection already present');
} else {
  // The effect that picks a default draw once the day has loaded.
  const m = s.match(/useEffect\(\(\) => \{\s*\n?\s*if \(!state \|\| selected\) return;[\s\S]*?\n\s*\}, \[[^\]]*\]\);\n/);
  if (m) {
    s = s.replace(m[0], `  /* Open on the draw that has just happened, rather than always the first of
     the day. On a live day that is the one waiting to be entered; the operator
     lands on the right screen without hunting for it.

     Only when nothing has been chosen yet, and only for today — opening a past
     date should show that day from the start. */
  useEffect(() => {
    if (!state || selected) return;
    const key = date === gdToday()
      ? drawForTimeOfDay(scheduled)
      : (scheduled.daily ? 'daily:mid_morning'
        : scheduled.cash_pop ? 'pop:kick_off'
        : scheduled.lotto ? 'lotto'
        : scheduled.super6 ? 'super6' : null);
    if (key) setSelected(key);
    /* eslint-disable-next-line */
  }, [state, scheduled, date]);
`);
    done.push('replaced the default selection with time-of-day');
  } else {
    manual.push(`Could not find the effect that picks the default draw.\n`
      + `    Find the useEffect containing "if (!state || selected) return;" and\n`
      + `    replace the key it chooses with:\n`
      + `        date === gdToday() ? drawForTimeOfDay(scheduled) : <the existing first-draw logic>`);
  }
}

if (s !== before) {
  if (!fs.existsSync(`${VIEW}.bak`)) fs.copyFileSync(VIEW, `${VIEW}.bak`);
  fs.writeFileSync(VIEW, s);
}

console.log('');
for (const d of done) console.log(`  + ${d}`);
if (manual.length) {
  console.log('\n  COULD NOT PATCH AUTOMATICALLY — do these by hand:\n');
  for (const m of manual) console.log(`  ${m}\n`);
}
console.log(`
  Next:
    npm run build
    git add -A && git commit -m "Refresh every 10 minutes; open on the current draw" && git push

  If the build fails:
    mv ${VIEW}.bak ${VIEW}
`);
