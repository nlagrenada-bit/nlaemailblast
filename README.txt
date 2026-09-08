JACKPOT FIX — Lotto and Super 6
================================

THE BUG
The app's sender had:

    jackpot: lotto.jackpot_amount ?? 0

If no jackpot had been entered yet, that sent 0. The portal's jackpot
progression check refuses a jackpot lower than the previous one, so the value
was either rejected outright or the record was stored without a usable figure.
Either way the site's jackpot did not update.

THE FIX
The field is now OMITTED when there is no jackpot, rather than sent as 0.
Omitting leaves the stored jackpot untouched; sending 0 destroyed it.

Also added: when jackpot_winners > 0 the jackpot legitimately drops (it was
won), so the payload now sets "jackpot_reset": true, which is what the portal
needs to accept a lower figure.

Behaviour now:
  jackpot entered        -> "jackpot": 148000
  jackpot not entered    -> field omitted entirely
  jackpot won            -> "jackpot": 50000, "jackpot_reset": true


TWO PARTS TO APPLY
------------------

1. APP CODE  (stops it happening again)

   Replace:  netlify/functions/lib/websiteWebhook.mjs

     git add netlify/functions/lib/websiteWebhook.mjs
     git commit -m "Omit jackpot when unset; flag jackpot_reset when won"
     git push


2. REPAIR THE DRAWS ALREADY ON THE SITE

   fix-jackpots.mjs resends the correct jackpot for the 8 Lotto and Super 6
   draws from the catch-up, using PUT (the API's correction route) so nothing
   is duplicated.

   Keep fix-jackpots.mjs and catchup-data.json in the same folder, then:

     node fix-jackpots.mjs --token YOUR_TOKEN --dry-run
     node fix-jackpots.mjs --token YOUR_TOKEN

   It sends:
     lotto  3990 = 142,000    super6 2609 = 260,000
     lotto  3991 = 144,000    super6 2610 = 270,000
     lotto  3992 = 146,000    super6 2611 = 307,000
                              super6 2612 = 354,000
                              super6 2613 = 398,000


WORTH CHECKING
--------------
The homepage's "Current Estimated Jackpot" banner may be a separate WordPress
setting rather than a value read from the results table. If the per-draw
jackpots correct but the big banner figure does not, ask the web admin which
source that banner uses.
