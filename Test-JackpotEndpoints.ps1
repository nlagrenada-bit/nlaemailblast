param(
    [Parameter(Mandatory = $true)][string]$Secret,
    [decimal]$Amount = 152000,
    [string]$BaseUrl = "https://www.hexivedev.com"
)

# Finds which jackpot endpoint the WordPress site actually accepts.
# The spec names them inconsistently ("super6-game" but "lottogame") and the
# Lotto one was line-wrapped in the PDF, so the hyphen was ambiguous.
# Sends the CURRENT jackpot value, so a success is harmless.

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$base = $BaseUrl.TrimEnd('/')
$body = @{ estimated_jackpot = [int]$Amount } | ConvertTo-Json -Compress
$headers = @{ "X-Webhook-Secret" = $Secret }

$candidates = @(
    @{ game = "Lotto";   path = "wp-json/lottogame/v1/update-jackpot" },
    @{ game = "Lotto";   path = "wp-json/lottogame/v1/updatejackpot" },
    @{ game = "Lotto";   path = "wp-json/lotto-game/v1/update-jackpot" },
    @{ game = "Lotto";   path = "wp-json/lotto/v1/update-jackpot" },
    @{ game = "Super 6"; path = "wp-json/super6-game/v1/update-jackpot" },
    @{ game = "Super 6"; path = "wp-json/super6/v1/update-jackpot" }
)

Write-Host ""
Write-Host "  Testing jackpot endpoints on $base" -ForegroundColor Cyan
Write-Host "  Sending: $body" -ForegroundColor DarkGray
Write-Host ""

$working = @()

foreach ($c in $candidates) {
    $url = "$base/" + $c.path
    Write-Host ("  {0,-8} /{1}" -f $c.game, $c.path)
    try {
        $r = Invoke-RestMethod -Uri $url -Method Post -ContentType "application/json" -Headers $headers -Body $body -TimeoutSec 20
        Write-Host "           200 OK  <-- THIS ONE WORKS" -ForegroundColor Green
        if ($r) { Write-Host ("           " + ($r | ConvertTo-Json -Compress)) -ForegroundColor DarkGray }
        $working += $c
    }
    catch {
        $status = "no response"
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        $colour = "Yellow"
        if ($status -eq 404) { $colour = "DarkGray" }
        Write-Host "           $status" -ForegroundColor $colour
        if ($status -eq 401 -or $status -eq 403) {
            Write-Host "           endpoint EXISTS but rejected the secret" -ForegroundColor Yellow
        }
        if ($_.ErrorDetails.Message -and $status -ne 404) {
            Write-Host ("           " + $_.ErrorDetails.Message) -ForegroundColor DarkGray
        }
    }
    Write-Host ""
}

Write-Host "  ---------------------------------------------" -ForegroundColor DarkGray
if ($working.Count -eq 0) {
    Write-Host "  Nothing worked." -ForegroundColor Red
    Write-Host "  All 404 means the endpoints are named differently. Ask the developer." -ForegroundColor Yellow
    Write-Host "  A 401 or 403 means the path is right and the secret is wrong." -ForegroundColor Yellow
}
else {
    Write-Host "  Use these paths:" -ForegroundColor Green
    foreach ($w in $working) {
        Write-Host ("    {0,-8} /{1}" -f $w.game, $w.path) -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "  Send me any path that differs from what the app uses." -ForegroundColor Cyan
}
Write-Host ""
