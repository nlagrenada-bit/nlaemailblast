EMAIL READABILITY FOR ON-AIR READING
=====================================

Presenters read these figures aloud, often from a phone, at speed. Two numbers
matter most and both were too small to find quickly.


1. PAYOUT: 15px -> 24px, IN ITS OWN BAND

It was set at 15px — the SAME SIZE as the surrounding prose — and tucked at the
bottom of each card. The single most-spoken number on the page was the hardest
one to locate.

It now sits in a tinted band with a gold edge:

        PAYOUT
        $48,168.00        <- 24px bold navy

Built as a table, because Outlook ignores padding and background on <p>.


2. JACKPOT: 17px -> 26px, WITH ITS OWN LABEL

Same problem, and arguably the most-read figure of all:

        CURRENT ESTIMATED LOTTO JACKPOT
        $148,000.00       <- 26px bold navy

Previously it was an inline <strong> inside a sentence.


WHAT WAS ALREADY RIGHT, AND LEFT ALONE

  - Lotto and Super 6 numbers print smallest to largest (3 9 13 29 32)
  - "Free Ticket Letter: K as in KING" — the spoken word is already there,
    which is exactly what a presenter needs
  - Draw numbers sit top-right, out of the reading path but available
  - The plain-text version is unchanged and still reads cleanly for anyone
    working from text rather than HTML

NOT CHANGED, DELIBERATELY
Multi-X appears as its own card rather than inside the parent game. That looks
redundant on screen, but it mirrors how the draws are announced, so it is house
style rather than a fault. Say the word if you want them merged.


FILE
  shared/emailTemplate.js

DEPLOY
  git add shared/emailTemplate.js
  git commit -m "Enlarge payout and jackpot for on-air readability"
  git push

The preview in the app uses the same template, so what the operator checks
before sending is exactly what the presenter reads.
