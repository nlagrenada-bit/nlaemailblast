#!/usr/bin/env node
/**
 * apply-fix.mjs — patches the two client files so the browser sends the email
 * it previewed, instead of the server rebuilding it as the whole day.
 *
 * Run from the ROOT of the app repo (the folder containing package.json):
 *
 *     node apply-fix.mjs
 *
 * It edits:
 *     src/lib/api.js              -> replaces sendBlast()
 *     src/views/ResultsView.jsx   -> replaces confirmSend(), adds markResent() if absent
 *
 * A .bak copy of each file is written first. Nothing else is touched.
 */
import fs from 'node:fs';
import path from 'node:path';

const API  = 'src/lib/api.js';
const VIEW = 'src/views/ResultsView.jsx';

// ---------------------------------------------------------------- helpers

/** Find the end of the PARAMETER LIST: the index just past the ')' that closes
 *  the argument list. Needed because destructured params like ({ a, b }) contain
 *  braces that would otherwise be mistaken for the function body. */
function endOfParams(src, startIdx) {
  const open = src.indexOf('(', startIdx);
  if (open === -1) throw new Error('no opening parenthesis found');
  let depth = 0;
  let inS = null, inLine = false, inBlock = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inS) {
      if (c === '\\') { i++; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced parentheses in parameter list');
}

/** Find a function starting at `startIdx` and return the index just past its
 *  closing brace, by counting braces outside strings/comments. The search for
 *  the body's opening brace begins AFTER the parameter list. */
function endOfBlock(src, startIdx) {
  const afterParams = endOfParams(src, startIdx);
  const open = src.indexOf('{', afterParams);
  if (open === -1) throw new Error('no opening brace found');
  let depth = 0, i = open;
  let inS = null, inLine = false, inBlock = false;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inS) {
      if (c === '\\') { i++; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces - could not find end of function');
}

function backup(file) {
  const bak = file + '.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  return bak;
}

function must(file) {
  if (!fs.existsSync(file)) {
    console.error(`\n  Cannot find ${file}`);
    console.error('  Run this from the root of the app repo (where package.json is).\n');
    process.exit(1);
  }
}

// ---------------------------------------------------- replacement sources

const NEW_SEND_BLAST = `export async function sendBlast({
  drawDate, subject, html, text,
  scopeLabel = null, scopeKind = null, isResend = false,
  groupIds = null, emails = null,
}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/api/send-blast', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: \`Bearer \${session?.access_token ?? ''}\`,
    },
    body: JSON.stringify({
      drawDate, subject, html, text,
      scopeLabel, scopeKind, isResend,
      groupIds, emails,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'The blast could not be started.');
  return body;
}`;

const NEW_CONFIRM_SEND = `  async function confirmSend({ groupIds, emails, isResend, dbOnly }) {
    setBusy(true);
    setProgress(null);
    try {
      if (dbOnly) {
        const r = await api.pushToWebsite(date);
        const failed = r?.website?.failed?.length || 0;
        const sent = r?.website?.sent ?? 0;
        toast(failed
          ? \`Website updated with \${sent} result(s); \${failed} failed.\`
          : \`Website updated with \${sent} result(s). No email sent.\`,
          failed ? 'info' : 'good');
        setDialog(false);
        return;
      }

      // The email built for THIS selection - the same one shown in the preview,
      // so a single draw sends that draw and not the whole day.
      const subject = isResend ? \`[RESENT] \${email.subject}\` : email.subject;
      const html    = isResend ? markResent(email.html) : email.html;
      const text    = isResend
        ? \`*** RESENT - corrects earlier results ***\\n\\n\${email.text}\`
        : email.text;

      const started = await api.sendBlast({
        drawDate: date,
        subject, html, text,
        scopeLabel: scope.label,
        scopeKind: scope.kind,
        isResend: !!isResend,
        groupIds: groupIds?.length ? groupIds : null,
        emails: emails?.length ? emails : null,
      });

      toast(
        \`Sending "\${scope.label}" to \${started.totalRecipients} recipient\`
        + \`\${started.totalRecipients === 1 ? '' : 's'}. \`
        + \`About \${started.estimatedMinutes} min - it continues even if you close this.\`,
        'good',
      );
      setProgress({ sent: 0, total: started.totalRecipients });

      const final = await api.watchBlastRun(started.runId, (run) => {
        setProgress({ sent: run.sent_count, total: run.total_recipients, status: run.status });
      });

      const bits = [\`Sent to \${final.sent_count} of \${final.total_recipients}\`];
      if (final.failed_count) bits.push(\`\${final.failed_count} failed\`);
      toast(bits.join(' \\u00b7 ') + '.', final.failed_count ? 'info' : 'good');
      setDialog(false);
      reload();
    } catch (e) {
      toast(e.message, 'bad');
    } finally { setBusy(false); setProgress(null); }
  }`;

const MARK_RESENT = `
/**
 * Prepend a RESENT banner so recipients can see this corrects an earlier email.
 */
function markResent(html) {
  const banner = '<div style="background:#b3261e;color:#fff;font-family:Arial,sans-serif;'
    + 'font-weight:700;font-size:14px;text-align:center;padding:10px 14px;letter-spacing:.02em">'
    + 'RESENT \\u2014 this corrects results sent earlier. Please disregard the previous email.</div>';
  if (html.includes('<body')) return html.replace(/(<body[^>]*>)/i, '$1' + banner);
  return banner + html;
}
`;

// ------------------------------------------------------------------- run

console.log('\nPatching the Results Desk app...\n');

// ---- 1. api.js : sendBlast ------------------------------------------------
must(API);
let api = fs.readFileSync(API, 'utf8');

if (api.includes('scopeLabel = null, scopeKind = null')) {
  console.log(`  = ${API} already patched, skipping`);
} else {
  const m = api.match(/export\s+(?:async\s+)?function\s+sendBlast\s*\(/);
  if (!m) {
    console.error(`  ! Could not find sendBlast() in ${API}. Patch it by hand.`);
    process.exit(1);
  }
  backup(API);
  const start = m.index;
  const end = endOfBlock(api, start);
  api = api.slice(0, start) + NEW_SEND_BLAST + api.slice(end);
  fs.writeFileSync(API, api);
  console.log(`  + ${API}  sendBlast() replaced   (backup: ${API}.bak)`);
}

// ---- 2. ResultsView.jsx : confirmSend + markResent ------------------------
must(VIEW);
let view = fs.readFileSync(VIEW, 'utf8');
backup(VIEW);

if (view.includes('scopeLabel: scope.label')) {
  console.log(`  = ${VIEW} confirmSend already patched, skipping`);
} else {
  const m = view.match(/\n\s*async\s+function\s+confirmSend\s*\(/);
  if (!m) {
    console.error(`  ! Could not find confirmSend() in ${VIEW}. Patch it by hand.`);
    process.exit(1);
  }
  const start = m.index + 1;               // keep the preceding newline
  const end = endOfBlock(view, start);
  view = view.slice(0, start) + NEW_CONFIRM_SEND + view.slice(end);
  console.log(`  + ${VIEW}  confirmSend() replaced   (backup: ${VIEW}.bak)`);
}

if (/function\s+markResent\s*\(/.test(view)) {
  console.log(`  = ${VIEW}  markResent() already present`);
} else {
  // Insert after the last import so it sits at module scope.
  const imports = [...view.matchAll(/^import .*?;$/gm)];
  if (!imports.length) {
    console.error(`  ! No imports found in ${VIEW}; add markResent() by hand.`);
    process.exit(1);
  }
  const at = imports[imports.length - 1].index + imports[imports.length - 1][0].length;
  view = view.slice(0, at) + '\n' + MARK_RESENT + view.slice(at);
  console.log(`  + ${VIEW}  markResent() added`);
}

fs.writeFileSync(VIEW, view);

console.log(`
Done.

Next:
  npm run build          # confirm it compiles
  git add -A
  git commit -m "Send the previewed email, not a rebuilt end-of-day document"
  git push

If the build fails, restore with:
  mv ${API}.bak ${API}
  mv ${VIEW}.bak ${VIEW}
`);
