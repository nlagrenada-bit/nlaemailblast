TWO FIXES + A MANUAL SCRIPT
============================

1. WHY THE LOTTO JACKPOT NEVER UPDATED
--------------------------------------
push-website.mjs had:

    if (row.numbers?.length) continue;    // skip when the draw has numbers

That was correct for the OMP, whose result payload already carries the jackpot.
But the WordPress RESULT webhook has NO jackpot field at all - the only way a
jackpot reaches that site is the dedicated /update-jackpot endpoints. So on a
normal draw (numbers present) the jackpot was skipped and WordPress never got it.

Fixed: the jackpot is now always sent to WordPress. The OMP still only gets a
separate call when there are no numbers to carry it, so nothing is sent twice.

This applies to Super 6 as well - same code path, same fix. Verified both.


2. LOTTO AND SUPER 6 NUMBERS NOW SORT ASCENDING
-----------------------------------------------
Sorted smallest to largest before sending, on BOTH targets.

  32 3 29 9 13      ->  03 09 13 29 32
  25 2 28 10 8 15   ->  02 08 10 15 25 28

Pick 3 and Cash 4 are deliberately NOT sorted - for those games the position of
each digit IS the result, so reordering would corrupt it. Verified: 9 0 4 stays
9 0 4, and 8 1 7 2 stays 8 1 7 2.


FILES
  netlify/functions/push-website.mjs          jackpot fix
  netlify/functions/lib/websiteWebhook.mjs    ascending sort (OMP)
  netlify/functions/lib/hexiveWebhook.mjs     ascending sort (WordPress)

DEPLOY
  git add -A
  git commit -m "Always push jackpot to WordPress; sort Lotto/Super 6 ascending"
  git push


3. MANUAL SCRIPT - Send-NlaResult.ps1
--------------------------------------
Sends a result and/or jackpot to WordPress by hand. Sorts and zero-pads for you.

  # preview
  .\Send-NlaResult.ps1 -Secret "SECRET" -Game lotto -DrawId 3995 `
      -Numbers 32,3,29,9,13 -Letter K -Jackpot 148000 -WhatIf

  # send
  .\Send-NlaResult.ps1 -Secret "SECRET" -Game lotto -DrawId 3995 `
      -Numbers 32,3,29,9,13 -Letter K -Jackpot 148000

  # Super 6
  .\Send-NlaResult.ps1 -Secret "SECRET" -Game super6 -DrawId 2615 `
      -Numbers 25,2,28,10,8,15 -Letter G -Jackpot 507000

  # jackpot only
  .\Send-NlaResult.ps1 -Secret "SECRET" -Game lotto -Jackpot 150000

If PowerShell blocks it as unsigned:

  powershell -ExecutionPolicy Bypass -File .\Send-NlaResult.ps1 -Secret "SECRET" ...

Keep this OUT of the app repository - it takes a secret on the command line.


STILL OUTSTANDING
-----------------
/api/health was still showing HEXIVE_WEBHOOK_BASE and HEXIVE_WEBHOOK_SECRET as
false. The variables are entered in Netlify but a REDEPLOY is needed before they
take effect. Until then no result webhook reaches WordPress at all.
