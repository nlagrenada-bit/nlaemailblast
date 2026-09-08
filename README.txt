JACKPOT FROM THE APP DATABASE
==============================

The jackpot the operator enters in the app is now the source of truth, and can
be pushed to the portal on its own - no winning numbers needed, no figure to
retype.


FIRST: FIND OUT WHERE THE TWO DISAGREE

  POST /api/push-website     { "diagnose": true }

Returns, for lotto and super6:

  app     - the newest jackpot entered in the app, with its draw and date
  portal  - what about.nla.gd currently stores, and its last/next draw number
  match   - true or false

That answers "is the jackpot wrong because the app never had it, or because it
never reached the portal?" - two different problems.


THEN: PUSH IT

  POST /api/push-website     { "game": "lotto" }
  POST /api/push-website     { "game": "super6" }

With no amount given, the app reads the most recent jackpot from its own
database and PUTs it onto the portal's last stored draw. Winning numbers and
letter are read back from the portal and preserved exactly.

To send a specific figure instead:

  POST /api/push-website     { "game": "lotto", "jackpot": 148000 }

When a jackpot has been WON the figure legitimately drops. The app detects this
from jackpot_winners and sends "jackpot_reset": true so the portal's
progression check accepts it. Nothing extra to do.


IF THE DIAGNOSE SHOWS THE APP HAS NO JACKPOT

  "No lotto jackpot has been entered in the app yet."

Then the figure was never saved in the app. Open the draw, enter the new
jackpot in "Next estimated jackpot", press Save jackpot, then push.


FILES
  netlify/functions/push-website.mjs         diagnose + database-sourced jackpot
  netlify/functions/lib/websiteWebhook.mjs   unchanged from the previous update

DEPLOY
  git add -A
  git commit -m "Push jackpot from the app database; add diagnose"
  git push


HOW IT WORKS
  1. Read the newest jackpot from lotto_results / super6_results.
  2. Ask the portal for its last stored draw and current jackpot.
  3. If they already agree, report "unchanged" and write nothing.
  4. Otherwise read that draw back from the portal, merge the new jackpot,
     and PUT the full record. PUT is the portal's correction route, so the
     existing draw is updated rather than duplicated.
