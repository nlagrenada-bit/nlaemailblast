FIX: "no results target is configured" after the last update
=============================================================

MY BUG, AND AN EMBARRASSING ONE

The last update made both senders return a `skipped` ARRAY listing games that
could not be sent. But `skipped` was ALREADY used as a boolean meaning "this
target is switched off":

    return { skipped: true, reason: 'WEBSITE_API_BASE not set' };

and the fan-out tested it for truthiness:

    if (t.skipped) { ...treat the whole target as switched off... }

In JavaScript an EMPTY ARRAY IS TRUTHY. So a perfectly configured target
returning `skipped: []` was read as "switched off", both targets were marked
unconfigured, and the push refused to run.

Your configuration was never the problem.


THE FIX

The two meanings are now separate fields:

    notConfigured: true      the target is switched off  (a boolean)
    skipped: [ ... ]         games that could not be sent (always an array)

The fan-out tests `notConfigured`. Nothing tests an array for truthiness.

Verified across all four combinations:

    both configured        sent 2, no targets off      <- was broken, now works
    only OMP               sent 1, wordpress off
    only WordPress         sent 1, omp off
    neither                sent 0, both off


FILES
  netlify/functions/lib/websiteWebhook.mjs
  netlify/functions/lib/hexiveWebhook.mjs
  netlify/functions/lib/pushAll.mjs
  netlify/functions/push-website.mjs

DEPLOY
  git add -A
  git commit -m "Fix truthy empty array making every target look unconfigured"
  git push

Everything from the previous update is retained: POST vs PUT is still decided
by asking the portal's /next endpoint, and games that cannot be sent are still
reported by name.
