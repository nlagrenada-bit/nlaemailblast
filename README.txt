TEST DATA WENT PUBLIC — FIXED
==============================

WHAT WENT WRONG (my error)

The public results page reads the results tables directly, and the app saves as
you type. The public view had NO published filter, so the moment you keyed a
test Pick 3 it appeared on the public site.

Entering numbers should never publish them. Now it doesn't.


THE FIX — A PUBLISH GATE

  published_at added to daily_results, cash_pop_results, lotto_results,
  super6_results.

  The public views (public_results and public_archive) now require
  published_at to be set. Nothing else changes for the reader.

  published_at is set in exactly two places, both deliberate operator actions:
    - a blast is sent
    - "Update the website/database only" is pressed

  So typed, half-typed and test entries stay inside the app until someone
  chooses to publish them.

BACKFILL: the migration marks everything already live as published, so the
public page does not go blank on deploy. Past days and any day with a completed
blast are treated as published.


THE CLEAR BUTTON

"Clear this draw" now sits in the results header. It warns before acting:

    Clear Mid-Morning Draw?
    This permanently deletes the numbers, multipliers and payouts entered
    for it. It cannot be undone.
    Results that have already been sent or published are protected and
    will not be cleared.

PUBLISHED DRAWS CANNOT BE CLEARED. A result that has gone to media houses must
be corrected and resent — using the RESENT option — not silently deleted.
Attempting it returns:
    "That draw has already been published. Correct it and resend instead."


DEPLOY — IN THIS ORDER

  1. Run supabase/08_published_gate.sql in the Supabase SQL editor.
     Do this FIRST. The app writes published_at, so the column must exist.

  2. Deploy the code:
       git add -A
       git commit -m "Publish gate: results go public only when sent; add clear button"
       git push


CLEAN UP THE TEST DATA YOU ALREADY POSTED

After running the SQL, that Pick 3 test entry will be unpublished (it was never
sent), so it disappears from the public site by itself. To remove it from the
app as well, open the draw and press "Clear this draw".

To see what is currently held back:

  select draw_date, period,
         published_at is not null as published
  from daily_results
  where draw_date >= current_date - 3
  order by draw_date desc, period;


FILES
  supabase/08_published_gate.sql              the gate + backfill + rebuilt views
  netlify/functions/lib/publish.mjs           NEW - marks results published
  netlify/functions/push-website.mjs          marks published after a push
  netlify/functions/send-blast-slice.mjs      marks published after a send
  src/lib/api.js                              clearDraw + clearUnpublishedDay
  src/views/ResultsView.jsx                   the Clear this draw button
