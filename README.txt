NUMBER ENTRY AUTO-ADVANCE  +  DAY PLAN PANEL
=============================================

1. THE ENTRY GLITCH — FIXED
---------------------------
Two faults:

  a) autoAdvance() ran in the SAME tick as onChange(), so focus moved to the
     next box before React had committed the value. That is what made the
     second digit misbehave. It now runs after the commit.

  b) Lotto and Super 6 had NO auto-advance wired at all — every number had to
     be clicked into.

Now, typing moves through the boxes and STOPS at the last one:

  Pick 3     3 boxes,  one digit each   ->  advances on every digit
  Cash 4     4 boxes,  one digit each   ->  advances on every digit
  Lotto      5 boxes,  1-34             ->  see below
  Super 6    6 boxes,  1-28             ->  see below
  Play Way   1 box,    1-36

TWO-DIGIT FIELDS ARE SMARTER THAN A SIMPLE COUNT

They advance as soon as no longer number could still be valid:

  Lotto (1-34)   type 3  -> waits  (34 is still possible)
                 type 4  -> advances (40+ is out of range)
                 type 34 -> advances
                 type 35 -> rejected, box unchanged

  Super 6 (1-28) type 2  -> waits  (28 is still possible)
                 type 3  -> advances
                 type 29 -> rejected

So single-digit numbers do not need a leading zero and do not stall the
operator waiting for a second keystroke.

Backspace on an empty box still clears; up/down arrows still step the value.


2. WORDING
----------
The day-plan example now reads:
  "Includes Tuesday's Rescheduled Super 6 draw."


FILES
  src/components/Ball.jsx      auto-advance timing and two-digit logic
  src/views/ResultsView.jsx    auto-advance wired for Lotto and Super 6
  src/components/Rail.jsx      day plan panel (from the previous update)
  src/styles.css               day plan styling

DEPLOY
  git add -A
  git commit -m "Fix number entry auto-advance; add day plan panel"
  git push

TEST
  Open a Pick 3 draw and type three digits without touching the mouse.
  Then a Lotto draw: type 4 11 19 27 33 — each should advance by itself, and
  focus should stop on the fifth box rather than wrapping.
