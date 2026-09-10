<#
.SYNOPSIS
    Sets the estimated jackpot shown on the NLA WordPress site.

.DESCRIPTION
    Posts to the two dedicated jackpot endpoints. Note the paths are named
    inconsistently in the spec ("super6-game" but "lottogame"), so both are
    written out in full rather than derived.

.EXAMPLE
    # Check what would be sent, without sending it
    .\Set-NlaJackpots.ps1 -Secret "YOUR_SECRET" -WhatIf

    # Apply the current figures
    .\Set-NlaJackpots.ps1 -Secret "YOUR_SECRET"

    # One game only
    .\Set-NlaJackpots.ps1 -Secret "YOUR_SECRET" -Game lotto -Amount 150000
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$Secret,

    [string]$BaseUrl = "https://www.hexivedev.com",

    [ValidateSet("lotto", "super6", "both")]
    [string]$Game = "both",

    [decimal]$Amount = 0
)

# Windows PowerShell 5.1 defaults to old TLS, which modern hosts refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Current figures. Change these, or override a single game with -Amount.
$jackpots = @{
    lotto  = 148000
    super6 = 507000
}

# The two endpoints, spelled out exactly as documented.
$paths = @{
    lotto  = "wp-json/lottogame/v1/update-jackpot"
    super6 = "wp-json/super6-game/v1/update-jackpot"
}

$names = @{ lotto = "Lotto"; super6 = "Super 6" }

$targets = if ($Game -eq "both") { @("lotto", "super6") } else { @($Game) }

if ($Amount -gt 0 -and $Game -eq "both") {
    Write-Host ""
    Write-Host "  -Amount applies to one game. Use -Game lotto or -Game super6 with it." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$base = $BaseUrl.TrimEnd('/')

Write-Host ""
Write-Host "  NLA jackpot update" -ForegroundColor Cyan
Write-Host "  $base"
Write-Host ""

$failed = 0

foreach ($g in $targets) {

    $value = if ($Amount -gt 0) { $Amount } else { $jackpots[$g] }
    $url   = "$base/$($paths[$g])"
    $body  = @{ estimated_jackpot = [int]$value } | ConvertTo-Json -Compress

    Write-Host ("  {0,-8} `${1:N0}" -f $names[$g], $value)
    Write-Host "           $url" -ForegroundColor DarkGray
    Write-Host "           $body" -ForegroundColor DarkGray

    if (-not $PSCmdlet.ShouldProcess($names[$g], "set jackpot to $value")) {
        Write-Host "           (WhatIf - nothing sent)" -ForegroundColor Yellow
        Write-Host ""
        continue
    }

    try {
        $response = Invoke-RestMethod -Uri $url -Method Post `
            -ContentType "application/json" `
            -Headers @{ "X-Webhook-Secret" = $Secret } `
            -Body $body -TimeoutSec 30

        Write-Host "           Updated." -ForegroundColor Green
        if ($response) {
            Write-Host "           Response: $($response | ConvertTo-Json -Compress)" -ForegroundColor DarkGray
        }
    }
    catch {
        $failed++
        $status = $null
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        Write-Host "           FAILED$(if ($status) { " - HTTP $status" })" -ForegroundColor Red
        if ($_.ErrorDetails.Message) {
            Write-Host "           $($_.ErrorDetails.Message)" -ForegroundColor Red
        } else {
            Write-Host "           $($_.Exception.Message)" -ForegroundColor Red
        }

        if ($status -eq 401 -or $status -eq 403) {
            Write-Host "           The secret was rejected. Check X-Webhook-Secret." -ForegroundColor Yellow
        }
        elseif ($status -eq 404) {
            Write-Host "           Endpoint not found. Confirm the path with the developer." -ForegroundColor Yellow
        }
    }
    Write-Host ""
}

if ($failed -gt 0) {
    Write-Host "  $failed of $($targets.Count) failed." -ForegroundColor Red
    Write-Host ""
    exit 1
}

Write-Host "  Done." -ForegroundColor Green
Write-Host ""
