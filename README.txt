LIVE UPDATES  +  A LAST LOOK BEFORE SENDING
============================================

1. AUTO-REFRESH WHEN SOMEONE ELSE MAKES A CHANGE
-------------------------------------------------
Uses Supabase Realtime, not polling. The database pushes each change as it
happens, so there is no repeated querying and no lag between one operator
saving and everyone else seeing it.

Watched for the day on screen: daily_results, cash_pop_results, lotto_results,
super6_results and draw_days.

THE SAFEGUARD THAT MATTERS

A blind auto-refresh would wipe out whatever the person at this screen is
halfway through typing. So:

  nobody mid-entry   the change is applied straight away, silently
  mid-entry          a banner appears instead:

      "Someone else has updated this day. Your entry is untouched —
       apply the change when you are ready."   [ Show latest ]

Typing in the rail's notice box, or having a button focused, does not count as
mid-entry — only the result fields do. Verified across five cases.

SECURITY: Realtime respects row-level security. The staff_read policy already
restricts these tables to signed-in staff, so nothing leaks to the public.

YOU MUST RUN THE SQL
  supabase/10_enable_realtime.sql

Supabase only streams tables added to the supabase_realtime publication.
Without it the app subscribes fine and simply never receives anything — which
looks exactly like the feature not working. The script also sets REPLICA
IDENTITY FULL so deletes carry enough information to be matched to a date.


2. A LAST LOOK BEFORE AN INCOMPLETE BLAST GOES OUT
---------------------------------------------------
Typing SEND proves intent. This proves the operator has SEEN what is missing.

After typing the confirm word and pressing send, if anything is incomplete a
red panel appears:

      Send anyway?
      This goes to 60 recipients and cannot be recalled.
      The following is incomplete:
        [WEBSITES] MID-MORNING Cash 4 — no draw number, so it will NOT
                   reach the websites.
        [WEBSITES] Lotto jackpot is blank — the websites will keep
                   showing the old figure.
        MIDDAY: Play Way payout is blank.
        Lotto free ticket letter is missing.

      [ Go back and fix ]        [ Send with these gaps ]

The red WEBSITES tag separates "this will not publish at all" from an ordinary
cosmetic gap — the two have very different consequences.

A COMPLETE DAY SENDS IMMEDIATELY. No extra click is added when there is nothing
wrong, so this never becomes a rubber stamp.


FILES
  src/lib/liveUpdates.js          NEW  realtime watcher + mid-edit guard
  src/views/ResultsView.jsx       subscribes; shows the banner
  src/components/SendDialog.jsx   the final check
  src/styles.css                  styling
  supabase/10_enable_realtime.sql MUST BE RUN
  shared/buildDoc.js              severity split (from the previous update)
  netlify/functions/eod-blast.mjs nightly website push (previous update)

DEPLOY
  1. Run supabase/10_enable_realtime.sql in the Supabase SQL editor.
  2. git add -A
     git commit -m "Live updates between operators; final check before incomplete sends"
     git push

TEST
  Open the same date in two browsers signed in as different staff. Enter a
  result in one; the other should update within a second without being touched.
  Then start typing in the second and repeat — the banner should appear rather
  than the value changing under you.
