CORRECTIONS NOW REACH THE OMP RELIABLY
=======================================

YOUR DATA RULED OUT THE FIRST THEORY

    2026-09-10  mid_morning  [1,3,9,6]  FP  7850
    2026-09-10  midday       [0,4,0,6]  FP  7851

Draw numbers present, multipliers present. Nothing missing on your side.


THE ACTUAL BUG

The push decided between "create" and "correct" by reading the POST status
code, and only fell back to PUT on a 409:

    if (res.status === 409) { ...PUT... }

But the portal has SEQUENCE VALIDATION. Re-sending draw 7850 when it already
holds 7851 is out of sequence, so it can answer 422 rather than 409. On a 422
the old code never tried the PUT — the correction was silently dropped and the
push still reported success.

That is why adding the Multi-X changed nothing on the site.


THE FIX — ASK, DON'T GUESS

Before sending, the code now asks the portal what it expects next:

    GET /results/cash4/next   ->  next_draw_number: 7852

  draw 7850  <  7852   ->  it exists, so PUT   (a correction)
  draw 7852  >= 7852   ->  it is new, so POST  (a creation)

One call per game per push, cached. No status-code guessing.

Belt and braces: a POST that still comes back 409 OR 422 falls back to PUT, and
a PUT that returns 404 falls back to POST. So it self-corrects if the portal and
the app ever disagree about what exists.

Verified against a mock that answers 422 for duplicates:
    before  7850 multiplier ""      ->  GET /next, PUT /results/cash4/7850
    after   7850 multiplier "FP"    PASS
And a genuinely new draw still POSTs and is created.


ALSO INCLUDED — SILENT SKIPS ARE NOW REPORTED

A game with a result but NO draw number was skipped with no message. It now
says so:

    "Sent 3. Not sent: Cash 4: mid_morning has digits but no draw number.
     Add the missing draw number, then update again."

And the outcomes are distinguishable rather than all reading as success:
nothing entered, a target rejected it (with the error text), or genuine success.


FILES
  netlify/functions/lib/websiteWebhook.mjs   POST/PUT decided from /next
  netlify/functions/lib/hexiveWebhook.mjs    skip reporting
  netlify/functions/lib/pushAll.mjs          collects incomplete + errors
  netlify/functions/push-website.mjs         returns them
  src/views/ResultsView.jsx                  shows them

DEPLOY
  git add -A
  git commit -m "Decide POST vs PUT from the portal; report skipped games"
  git push

THEN
Open 10 September and press "Update the website/database only". The Cash 4
multipliers should now reach the OMP. If anything is still refused, the toast
will name the game and quote the portal's own error.
