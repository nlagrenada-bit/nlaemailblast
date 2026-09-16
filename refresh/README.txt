REFRESH EVERY 10 MINUTES  +  OPEN ON THE CURRENT DRAW
======================================================

WHY

The desk is left open all day. Without this the screen quietly goes stale: it
shows whatever loaded hours ago, still sitting on the mid-morning draw long
after someone else has entered the evening one.


1. REFRESHES EVERY TEN MINUTES

  - skipped while the tab is hidden; nothing is being read, so nothing is fetched
  - skipped while someone is TYPING in a result field, and retried on the next
    tick. Replacing what is on screen underneath an operator would lose their work
  - also refreshes the moment the tab is brought back to the front, which is when
    a stale screen is most likely and most confusing

This complements the Supabase realtime updates rather than replacing them.
Realtime is instant but depends on a live socket; this is the backstop for when
that drops, a laptop sleeps, or the SQL to enable realtime has not been run.


2. OPENS ON THE DRAW THAT HAS JUST HAPPENED

Rather than always the first draw of the day. On a live day that is the one
waiting to be entered, so the operator lands on the right screen.

    07:00  ->  Morning Pop        (before the first draw, the first draw)
    09:50  ->  Mid-Morning
    12:46  ->  Midday
    14:50  ->  Afternoon Pop
    17:46  ->  Evening Pop
    19:50  ->  Evening Draw
    20:46  ->  Night Pop

A three-minute grace period means the slot appears just BEFORE the draw, so the
screen is already right when the result arrives.

Only draws actually scheduled that day are offered, so a Tuesday never opens on
Lotto. On a Friday at 7:45pm, when the evening daily draw, Lotto and Super 6 all
land together, it opens on the EVENING DRAW — three games and the natural
starting point — not on Super 6.

Only applies when nothing has been chosen yet, and only for TODAY. Opening a
past date still starts at the beginning of that day, and a draw you have clicked
is never taken away from you.

All cases verified, including a Sunday with nothing scheduled (no selection).


HOW TO APPLY

  1. Copy src/lib/autoRefresh.js into the app repo at that path.
  2. Copy apply-refresh.mjs into the ROOT of the repo and run:

         node apply-refresh.mjs

     It edits src/views/ResultsView.jsx in place, writes a .bak first, and is
     safe to run twice. If it cannot find an anchor it prints exactly what to
     add by hand rather than guessing.

  3. npm run build
     git add -A
     git commit -m "Refresh every 10 minutes; open on the current draw"
     git push

  You can delete apply-refresh.mjs afterwards; it is a one-off tool.

  If the build fails:  mv src/views/ResultsView.jsx.bak src/views/ResultsView.jsx


TESTED
The patcher was run against a representative ResultsView, and the result
compiled with esbuild, re-ran cleanly (detecting its own work), and left the
surrounding code untouched.
