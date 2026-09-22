WEBSITES FIRST, THREE ACTIONS, FASTER EMAIL, PROGRESS OUTSIDE THE DIALOG
========================================================================

1. WEBSITES NOW GO FIRST
------------------------
Previously the websites were updated AFTER the last email had gone out — the
push sat at the very end of the email run. Now it happens first.

Why it is better that way round:
  - the public sites are the record of the result. They are now correct the
    moment the operator commits, not a minute or two later.
  - a website push takes seconds; an email run takes much longer.
  - if the websites have a problem you find out BEFORE sixty emails go out,
    not after.


2. THREE ACTIONS, NOT A CHECKBOX
---------------------------------
The "database only" checkbox is replaced by three clear choices:

    Update websites & send email     (default)  websites first, then email
    Update websites only                        no email
    Send email only                             websites untouched

The confirm word follows the choice — UPDATE for websites only, SEND or RESEND
otherwise — and "Send email only" still needs an audience while "Update
websites only" does not.


3. EMAIL IS ROUGHLY THREE TIMES FASTER
---------------------------------------
The old pace — 6 emails, then a 3-second gap — was set for Microsoft 365, which
blocks a mailbox sending more than about 30 a minute. Mail now goes through
Resend, which has no such ceiling.

    before   ~90 s for 30 recipients
    now      ~27 s for 30 recipients

Resend's own documentation variously states 2, 5 and 10 requests per second, so
the new default (about 1.6 a second) sits UNDER the lowest of them and is safe
on any plan. If Resend ever refuses with a temporary SMTP error — which is how
its rate limit arrives over SMTP — the send now waits and retries that message
instead of marking a good recipient failed.

To go faster, check your plan's limit on Resend's Settings -> Usage page and
set in Netlify:
    SLICE_EXTERNAL   messages per slice   (now 15)
    SLICE_GAP_MS     gap between them     (now 600)


4. PROGRESS MOVED OUT OF THE DIALOG
------------------------------------
YOUR QUESTION: does the dialog have to stay visible? NO.

The work runs on the server and carries on regardless of the browser. Holding
the dialog open achieved nothing except stopping the operator doing anything
else. It now closes the moment the send is accepted.

Progress moves to a panel in the bottom-right corner that stays visible while
you move to the next draw. It shows the two stages in the order they run:

    Midday Draw        WEBSITES, THEN EMAIL
    ● Websites — 4 results published
    ● Email — 18 of 30
    [██████████░░░░░░]
    Carries on if you move to another draw or close the tab.

When it finishes the bar turns green and a × dismisses it.


5. A REGRESSION CAUGHT BEFORE IT SHIPPED
-----------------------------------------
Moving the website push into the send path, the first version pushed the
RESULTS but not the JACKPOTS. WordPress receives jackpots through separate
endpoints — its result webhook has no jackpot field — so every "update websites
& send" would have silently stopped updating the Lotto and Super 6 jackpots.
That is the exact bug fixed last week.

The fix: all website work now lives in ONE function, lib/publishDay.mjs, used
by every route to the websites. Results, jackpots and the publish marker happen
together, so the routes cannot drift apart again.


DEPLOY — IN THIS ORDER
  1. Run supabase/11_send_modes.sql in the Supabase SQL editor FIRST.
     The app writes the new mode and website columns.
  2. git add -A
     git commit -m "Websites first; three send actions; faster email; progress panel"
     git push


FILES
  supabase/11_send_modes.sql              mode + website outcome columns
  netlify/functions/lib/publishDay.mjs    NEW  the single website routine
  netlify/functions/send-blast.mjs        websites first, then email
  netlify/functions/send-blast-slice.mjs  email only; faster; retries 4xx
  src/components/SendDialog.jsx           three action buttons
  src/components/SendProgress.jsx         NEW  the progress panel
  src/components/Rail.jsx                 status understands the mode
  src/views/ResultsView.jsx               closes the dialog, shows the panel
  src/lib/api.js                          passes the mode
  src/styles.css


VERIFIED
  both      run -> websites (results + jackpots) -> recipients -> email
  website   run -> websites (results + jackpots) -> complete, no audience needed
  email     run -> recipients -> email, websites untouched; refuses with no audience
  rail      both -> Updated + Sent   website -> Updated   email -> Sent
