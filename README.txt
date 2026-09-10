WHY A MULTI-X UPDATE CAN GO NOWHERE — AND HOW YOU NOW SEE IT
=============================================================

WHAT I TESTED

I ran the real push code for a Cash 4 multiplier-only change against mocks of
both sites. It works correctly:

  OMP   POST /results/cash4        -> 409 (draw already exists)
        PUT  /results/cash4/7818   -> multiplier 5X stored
  WP    POST /wp-json/cash4/v1/webhook  {"cash_4_multi_x":"5X", ...}

So POST-then-PUT does upsert, on both targets.


THE REAL WEAKNESS: SILENT SKIPS

A game is only sent when it has BOTH a result AND a draw number:

    if (row.cash4_digits?.length && row.cash4_draw_no) { ... }

If the DRAW NUMBER is missing, the whole game was skipped with no message. You
would press "Update the website only", get a success toast, and nothing would
have been sent. That is almost certainly what happened.

The same applied to Play Way, Pick 3, Cash Pop, Lotto and Super 6.


WHAT CHANGES

Every skip is now reported, on both targets, and surfaced in the app:

    "Sent 3. Not sent: Cash 4: mid_morning has digits but no draw number.
     Add the missing draw number, then update again."

Other outcomes are now distinct too, instead of all reading as success:

    nothing entered      "Nothing was sent — check the results are entered
                          for this day."
    a target rejected    "Websites updated with 3 result(s); 1 failed."
                          followed by the actual error text
    all good             "Websites updated with 4 result(s). No email sent."


CHECK THIS FIRST ON YOUR CASH 4

Open the draw and look at the DRAW NUMBER field. If it is showing a grey
suggestion rather than a saved black value, press "Use <number>" to commit it,
then update the websites again.

    select draw_date, period, cash4_digits, cash4_multiplier, cash4_draw_no
    from daily_results
    where draw_date = '2026-09-10';

A null cash4_draw_no confirms it.


FILES
  netlify/functions/lib/websiteWebhook.mjs   skip reporting
  netlify/functions/lib/hexiveWebhook.mjs    skip reporting
  netlify/functions/lib/pushAll.mjs          collects incomplete + errors
  netlify/functions/push-website.mjs         returns them
  src/views/ResultsView.jsx                  shows them in the toast

DEPLOY
  git add -A
  git commit -m "Report games that cannot be pushed instead of skipping silently"
  git push
