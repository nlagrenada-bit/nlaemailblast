PLAY.NLA.GD CHECKING, AUTO-FILL, AND LATE RESULTS ALERTS
=========================================================

1. THE FALSE LOTTO CONFLICT — FIXED
------------------------------------
    app has 15 9 14 13 7, play.nla.gd has 7 9 13 14 15

Same draw, same result. The comparison checked position by position, which is
right for Pick 3 and Cash 4 — where 9-0-4 and 0-4-9 are different winning
numbers — but wrong for Lotto and Super 6, where only the set matters. The desk
types them in the order they are called; the site lists them ascending.

Now:
    Lotto, Super 6     compared as sets        your case now matches
    Pick 3, Cash 4     compared in order       a swapped digit is still caught
    Play Way, Cash Pop one number, so order never arises

The rule lives in ONE place, shared/compareResults.js, used by assisted entry,
the pre-send check and the auto-fill — so the three can never disagree about
what counts as a match.


2. CHECKED AGAINST PLAY.NLA.GD BEFORE SENDING
----------------------------------------------
When the send dialog opens it checks what you are about to send against
play.nla.gd, which is fed by the draw software itself:

    Checking against play.nla.gd...
    Matches play.nla.gd (3 checked)
    Does not match play.nla.gd - 1 problem

SEND STAYS DISABLED UNTIL THE CHECK FINISHES, so it cannot be skipped by typing
SEND quickly. A mismatch appears in red and again in the final "Send anyway?"
panel with a play.nla.gd tag.

TWO HONEST LIMITS
  - play.nla.gd shows only the LATEST result per game. An earlier draw that has
    been superseded cannot be checked, and is listed as "could not be checked"
    rather than passed.
  - If play.nla.gd is down, the check says so and the desk carries on. A website
    being unavailable must not stop results going out.


3. FIELDS FILL THEMSELVES AFTER A DRAW
---------------------------------------
Looking at today, the app checks play.nla.gd every 60 seconds and fills in any
EMPTY fields from it:
    numbers, Multi-X, the free ticket letter, and the Lotto/Super 6 jackpot

What it will NOT do:
  - overwrite anything an operator has typed
  - fill while someone is typing
  - set the DRAW NUMBER - that stays a deliberate "Use" click
  - send, or update the websites

Filled values are saved like typed ones, unpublished, and fully editable. A
notice says what was filled so nobody mistakes it for their own entry.

A deliberate safeguard falls out of this: because the draw number is never
filled, an auto-filled draw cannot be pushed to either website until a person
has pressed Use. Both website feeds skip any draw without a draw number.

Play Way, Pick 3 and Cash 4 share one database row per draw, so their fills are
merged into a single save. Three separate saves could each read a stale copy of
the row and blank out what the one before had written.


4. LATE RESULTS ALERTS
-----------------------
Settings now has a "Late results alert" section:
    - on / off
    - alert after N minutes (default 30)
    - who to tell, one address per line

Every five minutes a scheduled job checks each draw scheduled today. If a draw
closed more than N minutes ago and its results have not been EMAILED, those
addresses are told.

    - each draw alerts ONCE, not every five minutes
    - a full-day blast counts as emailing every draw
    - cancelled days and games switched off in the day plan are never reported
    - if the alert email fails it is NOT marked as sent, so the next run retries
    - uses the same Resend SMTP as the blast, so nothing extra to configure


ALSO CORRECTED
Settings said the nightly job "runs at 9:00pm". It runs at 10:30pm — it was
moved later so the 8:45pm Prime-Time Pop would be in — but the text was never
updated.


DEPLOY — IN THIS ORDER
  1. Run supabase/13_overdue_alerts.sql in the Supabase SQL editor.
  2. git add -A
     git commit -m "play.nla.gd checks and auto-fill; late results alerts"
     git push
  3. Open Settings, add the alert addresses, press Save addresses.


FILES
  shared/compareResults.js             NEW  the one comparison rule
  src/lib/playCheck.js                 NEW  pre-send check + what to fill
  netlify/functions/overdue-check.mjs  NEW  the late results alert
  netlify/functions/auto-entry.mjs     uses the shared comparison
  src/views/ResultsView.jsx            auto-fill + check on dialog open
  src/views/SettingsView.jsx           alert settings; 10:30pm corrected
  src/components/SendDialog.jsx        shows the check, waits for it
  src/styles.css
  supabase/13_overdue_alerts.sql


VERIFIED
  comparison: your case matches; a wrong number, a swapped Pick 3 and a short
    set all still caught
  pre-send: mismatch, swap and superseded draw each reported correctly
  auto-fill: fills empty fields, never overwrites, merges one row into one save
  alerts: none before the threshold, one at it, no repeat, full-day blast counts
  whole app linted, 0 errors
  app loaded in a browser past login - page mounted, no errors


TWO BUGS CAUGHT BEFORE THEY SHIPPED
Both would have blanked the page again, like the earlier SendDialog crash:
  - the auto-fill referenced the save functions ABOVE where they are declared,
    which throws on every render
  - moving it below them put two React hooks after an early return, which is
    the hook-order crash (React error #310)
The fix keeps the hooks above the early return and reaches the save functions
through a ref populated below them. The linter, now working, flagged the second
one directly.
