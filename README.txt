SEND DIALOG FITS WITHOUT SCROLLING  +  PROGRESS PANEL CLEARS ITSELF
====================================================================

1. THE DIALOG NO LONGER NEEDS SCROLLING
----------------------------------------
Two things were wrong.

a) The three action buttons were tall stacked cards, each with a description.
   They are now ONE ROW, with the explanation on a single line underneath that
   changes with the choice:

       WHAT TO DO
       [ Websites + email ][ Websites only ][ Email only ]
       Websites are updated first, then the email goes out.

b) More importantly, the WHOLE modal scrolled - header, body and footer
   together - so the Send button scrolled out of sight. Only the body scrolls
   now. The header and footer are pinned, so SEND IS ALWAYS VISIBLE however
   long the content gets.

Measured at three screen heights:

       900px viewport -> 616px dialog, no scrolling, Send visible
       760px viewport -> 616px dialog, no scrolling, Send visible
       640px viewport -> body scrolls, Send STILL visible

That second point matters more than the button sizes: even on a small laptop,
or with a long subject line, the Send button can no longer disappear.


A BUG FOUND WHILE DOING THIS
The new action row had NO VISIBLE SELECTED STATE. The stylesheet highlights
aria-pressed, but the row used aria-checked, so nothing was highlighted - on
the control that decides whether 31 emails go out. The style now covers all
three attributes, and the chosen option is clearly marked.


2. THE PROGRESS PANEL CLEARS ITSELF AFTER TWO MINUTES
------------------------------------------------------
It sits in the bottom-right corner, over the Send button, so leaving it there
blocked the next draw.

  - it now disappears on its own 120 seconds after a send starts
  - the x is available at ALL times, not only once finished, so it can be moved
    out of the way immediately

Nothing is lost by hiding it. The send runs on the server and carries on
regardless - the panel was only ever a view of it. What happened is still in
History, and the draw's own status tag shows Sent / Resent / Updated.


FILES
  src/components/SendDialog.jsx    one-row actions
  src/components/SendProgress.jsx  auto-dismiss, always closable
  src/components/DrawNumber.jsx    (the earlier hotfix, included)
  src/styles.css                   modal structure, selected state

DEPLOY
  git add -A
  git commit -m "Send dialog fits without scrolling; progress panel auto-clears"
  git push


VERIFIED
  dialog measured at 900 / 760 / 640px - Send visible in all three
  auto-dismiss timer exercised: hidden after the period, parent notified
  whole app linted (0 errors) with a linter proven on a deliberate mistake
  app loaded in a browser past login - page mounted, no errors
