BLANK SCREEN AFTER LOGIN — FIXED
=================================

THE CAUSE (my error)

Replacing the "database only" checkbox with the three action buttons, I removed
the setDbOnly function but left one call to it, in SendDialog's reset effect:

    setChosen(new Set()); setSearch(''); setIsResend(false); setDbOnly(false);

The send dialog is always mounted — just closed — so that effect runs on EVERY
page load. It called a function that no longer existed, threw a ReferenceError,
and took the whole results page down with it. Hence nothing past login.

FIXED: it now resets to the default action instead:

    ... setIsResend(false); setAction('both');

That is also the correct behaviour: reopening the dialog starts from
"Update websites & send email" rather than whatever was picked last time.


A SECOND BUG, FOUND WHILE CHECKING

The draw number field could be locked with NO WAY IN. When there is no earlier
draw to count from there is no suggestion — so no Use button — but the field
was still locked. The operator would be stuck. Its note also said "enter the
draw number on the results page", while already on the results page.

FIXED: the lock only applies when there is a suggestion to take. With nothing
to suggest the field is open, and the note now reads:

    "No earlier draw to count from — type the draw number."


WHY THIS SHIPPED, AND WHAT CHANGED

I had been reporting "HOOKS CLEAN" after each change. Those checks were not
running. The project uses ESLint 9, which rejects the flag I was passing, so
the linter failed to start, printed nothing my filter recognised, and I read
silence as success. Vite's build does not check for undefined names either, so
nothing caught this.

Now verified properly, three ways:
  1. A working lint config, proven by a deliberate probe (an undefined call it
     correctly flagged) before trusting it. Whole app: 0 errors.
  2. The app actually LOADED in a headless browser past the login screen.
     Results page mounted, zero page errors.
  3. The draw number field confirmed typeable in the rendered page.

eslint.config.check.mjs is included. To run the same check yourself:

    npx eslint -c eslint.config.check.mjs src netlify shared

It needs:  npm i -D eslint-plugin-react eslint-plugin-react-hooks globals


FILES
  src/components/SendDialog.jsx     the crash
  src/components/DrawNumber.jsx     the locked-field trap
  eslint.config.check.mjs           working lint config (optional)

DEPLOY
  git add src/components/SendDialog.jsx src/components/DrawNumber.jsx
  git commit -m "Fix blank screen after login; unlock draw number with no suggestion"
  git push

This is a two-file hotfix on top of the websites-first update, which still
needs its SQL (11_send_modes.sql) run if that has not been done.
