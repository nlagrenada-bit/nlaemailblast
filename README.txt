DAY PLAN — moving draws for holidays and disruptions
=====================================================

WHAT THIS ADDS

Set the day status to "Disrupted" and a new panel appears in the rail:

    WHICH GAMES RUN TODAY
      Daily games   Play Way, Pick 3, Cash 4    [Normal] On  Off
      Cash Pop      five draws                  [Normal] On  Off
      Lotto         normally Mon, Wed, Fri      [Normal] On  Off
      Super 6       normally Tue, Fri           [Normal] On  Off

Each game is three-state:

    Normal   follow the usual weekly schedule   (stored as null)
    On       run today even though it normally would not
    Off      do not run today even though it normally would

The "On" state is what makes a MOVE possible rather than just a cancellation.


MOVING SUPER 6 FROM A HOLIDAY TUESDAY TO WEDNESDAY

  On the Tuesday   set status Disrupted, Super 6 -> Off,
                   notice: "Super 6 moves to Wednesday 16 September due to
                   the public holiday."
  On the Wednesday set status Disrupted, Super 6 -> On,
                   notice: "Includes Tuesday's Super 6 draw."

Wednesday then runs its usual Lotto AND the moved Super 6. Verified.

The panel reminds you: after changing one day it says "Remember to set the
matching change on the day it moves to." A move is always two edits.


DRAW NUMBERS TRAVEL WITH THE DRAW

Draw numbers are stored per game, not derived from the date, so a moved Super 6
keeps its correct sequence number. The draw-number field also warns if a gap
appears ("1 number skipped since 2611. Fine after a cancelled draw — just check
it was."), so a genuine cancellation is distinguishable from a mistake.


OTHER CASES THIS COVERS

  Equipment failure, one game only   that game -> Off, notice explains
  Whole day lost (disaster, storm)   status -> Cancelled, everything stops
  Extra draw added                   that game -> On


FILES
  src/components/Rail.jsx   DayPlan component
  src/styles.css            styling

No database change: draw_days already has daily_on, cash_pop_on, lotto_on and
super6_on. They were simply never editable from the app — only by SQL.

DEPLOY
  git add -A
  git commit -m "Add day plan panel for holiday and disruption moves"
  git push


WHAT THIS DOES NOT DO YET

Draw TIMES are still fixed. There is no way to record "the Evening draw ran at
8:30 because of the power cut". That matters because the OMP API validates
draw_date against expected time slots, and its /next response shows it already
accepts several (12:45, 18:15, 18:45, 19:15, 19:45, 20:15, 20:45) — but the app
can only ever send the scheduled one. That is the natural next step if you find
you need it.
