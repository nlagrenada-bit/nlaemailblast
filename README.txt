SECOND RESULTS TARGET — WordPress webhooks
===========================================

Results now go to BOTH sites automatically:

  1. OMP Results API     about.nla.gd/omp/api/v1      Bearer token
  2. WordPress webhooks  hexivedev.com/wp-json/...    X-Webhook-Secret

The two are independent. Each is attempted regardless of the other, so one site
being down never stops the other updating. A target that isn't configured is
reported as "skipped", not as a failure — so you can deploy this before the
WordPress side is live.


ENVIRONMENT VARIABLES  (Netlify -> app site)

  Keep the existing:
    WEBSITE_API_BASE   = https://about.nla.gd/omp/api/v1
    WEBSITE_API_TOKEN  = <bearer token>

  Add:
    HEXIVE_WEBHOOK_BASE   = https://www.hexivedev.com
    HEXIVE_WEBHOOK_SECRET = <the X-Webhook-Secret value>

  Note HEXIVE_WEBHOOK_BASE is the HOST ONLY — no /wp-json and no trailing
  slash. The six endpoint paths are built by the code.


FILES
  netlify/functions/lib/hexiveWebhook.mjs   NEW  the WordPress sender
  netlify/functions/lib/pushAll.mjs         NEW  fans out to both targets
  netlify/functions/push-website.mjs        now pushes to both
  netlify/functions/send-blast-slice.mjs    now pushes to both
  netlify/functions/health.mjs              reports the new variables

DEPLOY
  git add -A
  git commit -m "Add WordPress webhook target alongside the OMP API"
  git push


WHAT THE CODE HANDLES (differences between the two specs)

  * Auth       X-Webhook-Secret here, Bearer for the OMP.
  * Fields     Each number is its own named field, as a STRING.
  * Padding    Lotto/Super 6 are zero-padded ("04"); daily games are single
               digits ("3"). Handled per game.
  * draw_type  Their naming differs from ours:
                 our midday         -> their mid_day
                 our mid_afternoon  -> their afternoon
                 mid_morning and evening are the same
               Cash Pop periods match exactly (kick_off, lunch, mid_rush,
               after_work, prime_time).
               The spec warns that if draw_type is not changed between
               requests, later draws overwrite earlier ones. Each result
               carries its own slot, so that cannot happen.


TWO THINGS TO RAISE WITH THE DEVELOPER

1. NO JACKPOT FIELD. The Lotto and Super 6 payloads have no jackpot in the
   spec, so the jackpot is NOT sent to WordPress. If the site is meant to show
   a current jackpot, ask them to add a field (e.g. "jackpot": 148000) and it
   will be sent.

2. THE PDF USES LIGATURES. Text extracted from it renders "first_number" as
   " rst_number" and "fifth_number" as " fth_number" (the "fi" is a single
   glyph). The code uses first_number / fifth_number / kick_off, which is
   almost certainly right — but worth confirming with them before go-live, as
   a wrong field name fails silently.


TEST
  Enter a result, then use the send dialog's "Update the website/database only"
  option. Nothing is emailed. Check both sites.

  Or check configuration first:
    https://nlaemailblast.netlify.app/api/health
