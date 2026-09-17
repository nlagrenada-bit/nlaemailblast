@echo off
REM Tests the Lotto and Super 6 jackpot endpoints without PowerShell.
REM Usage:  Test-Jackpot.cmd YOUR_SECRET
setlocal
if "%~1"=="" (
  echo.
  echo   Usage: Test-Jackpot.cmd YOUR_SECRET
  echo.
  exit /b 1
)
set SECRET=%~1
set BASE=https://www.hexivedev.com

echo.
echo   Testing Lotto and Super 6 jackpot endpoints
echo   Look at the FIRST line of each response:
echo     HTTP/1.1 200 = works   404 = wrong path   401/403 = secret rejected
echo.

echo   --- Lotto: lottogame/v1/update-jackpot
curl -s -i -X POST "%BASE%/wp-json/lottogame/v1/update-jackpot" -H "Content-Type: application/json" -H "X-Webhook-Secret: %SECRET%" -d "{\"estimated_jackpot\":152000}" | findstr /B "HTTP"
echo.

echo   --- Lotto: lottogame/v1/updatejackpot
curl -s -i -X POST "%BASE%/wp-json/lottogame/v1/updatejackpot" -H "Content-Type: application/json" -H "X-Webhook-Secret: %SECRET%" -d "{\"estimated_jackpot\":152000}" | findstr /B "HTTP"
echo.

echo   --- Lotto: lotto-game/v1/update-jackpot
curl -s -i -X POST "%BASE%/wp-json/lotto-game/v1/update-jackpot" -H "Content-Type: application/json" -H "X-Webhook-Secret: %SECRET%" -d "{\"estimated_jackpot\":152000}" | findstr /B "HTTP"
echo.

echo   --- Super 6 (control): super6-game/v1/update-jackpot
curl -s -i -X POST "%BASE%/wp-json/super6-game/v1/update-jackpot" -H "Content-Type: application/json" -H "X-Webhook-Secret: %SECRET%" -d "{\"estimated_jackpot\":587000}" | findstr /B "HTTP"
echo.

echo   Done. If Super 6 returns 200 and every Lotto line returns 404,
echo   the Lotto path is wrong - send me the one that worked.
echo.
endlocal
