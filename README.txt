SORT LOTTO AND SUPER 6 EVERYWHERE  +  JACKPOT FIX
==================================================

The previous update sorted the two WEBSITE feeds but not the EMAIL, because the
email is built by a different path. This completes it.


WHERE THE SORT NOW HAPPENS

  shared/buildDoc.js                       the EMAIL and the on-screen preview
  netlify/functions/lib/websiteWebhook.mjs the OMP API
  netlify/functions/lib/hexiveWebhook.mjs  the WordPress webhooks

buildDoc.js is the single source for both the email and the preview, so what an
operator sees before sending is exactly what recipients get.

  Lotto  32 3 29 9 13     ->  03 09 13 29 32
  Super6 25 2 28 10 8 15  ->  02 08 10 15 25 28

Verified on a real rendered email:
  "The LOTTO results ... are as follows: 03,09,13,29,32"
  "The SUPER 6 results ... are as follows: 02,08,10,15,25,28"

PICK 3 AND CASH 4 ARE NOT SORTED, anywhere. For those games the position of each
digit IS the result - 9 0 4 is a different result from 0 4 9. Confirmed
unchanged through the email, the preview and both website feeds.


ALSO IN THIS UPDATE (from the previous fix)

push-website.mjs had:

    if (row.numbers?.length) continue;

which skipped the jackpot push whenever a draw had its numbers. That was fine
for the OMP, whose result payload carries the jackpot - but the WordPress RESULT
webhook has NO jackpot field, so the dedicated /update-jackpot endpoint is the
only route to that site. On a normal draw the jackpot was skipped entirely.

Now the jackpot always goes to WordPress; the OMP still only gets a separate
call when there are no numbers to carry it. Applies to Super 6 identically.


FILES
  shared/buildDoc.js                          NEW in this update - email sort
  netlify/functions/lib/websiteWebhook.mjs
  netlify/functions/lib/hexiveWebhook.mjs
  netlify/functions/push-website.mjs

DEPLOY
  git add -A
  git commit -m "Sort Lotto and Super 6 ascending in the email too"
  git push


NOTE
Sorting is applied at DISPLAY time only. The database still stores the numbers
as they were drawn, so nothing historical is rewritten and the draw order is not
lost.


STILL OUTSTANDING
/api/health was showing HEXIVE_WEBHOOK_BASE and HEXIVE_WEBHOOK_SECRET as false.
They are entered in Netlify but need a REDEPLOY to take effect. Until then no
result webhook reaches WordPress at all.
