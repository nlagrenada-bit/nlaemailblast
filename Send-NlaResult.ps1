<#
.SYNOPSIS
    Send a Lotto or Super 6 result and jackpot to the NLA WordPress site by hand.

.DESCRIPTION
    Posts the winning numbers to the game's result webhook and the estimated
    jackpot to its jackpot endpoint. Numbers are sorted smallest to largest
    automatically, matching how results are published.

.EXAMPLE
    # Preview without sending
    .\Send-NlaResult.ps1 -Secret "SECRET" -Game lotto -DrawId 3995 `
        -Numbers 32,3,29,9,13 -Letter K -Jackpot 148000 -WhatIf

    # Send it
    .\Send-NlaResult.ps1 -Secret "SECRET" -Game lotto -DrawId 3995 `
        -Numbers 32,3,29,9,13 -Letter K -Jackpot 148000

    # Super 6
    .\Send-NlaResult.ps1 -Secret "SECRET" -Game super6 -DrawId 2615 `
        -Numbers 25,2,28,10,8,15 -Letter G -Jackpot 507000

    # Jackpot only, no result
    .\Send-NlaResult.ps1 -Secret "SECRET" -Game lotto -Jackpot 150000
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Secret,
    [Parameter(Mandatory = $true)][ValidateSet("lotto","super6")][string]$Game,

    [int]$DrawId = 0,
    [int[]]$Numbers,
    [string]$Letter = "",
    [decimal]$Jackpot = 0,

    [string]$BaseUrl = "https://www.hexivedev.com"
)

# Windows PowerShell 5.1 defaults to old TLS, which modern hosts refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$base = $BaseUrl.TrimEnd('/')

$resultPath  = @{ lotto = "wp-json/lotto/v1/webhook";  super6 = "wp-json/super6/v1/webhook" }
# Note the inconsistent naming between these two - not a typo.
$jackpotPath = @{ lotto = "wp-json/lottogame/v1/update-jackpot"
                  super6 = "wp-json/super6-game/v1/update-jackpot" }
$expected    = @{ lotto = 5; super6 = 6 }
$label       = @{ lotto = "Lotto"; super6 = "Super 6" }

$headers = @{ "X-Webhook-Secret" = $Secret }

function Send-Json {
    param([string]$Url, [string]$Body, [string]$What)

    Write-Host "  $What"
    Write-Host "    $Url" -ForegroundColor DarkGray
    Write-Host "    $Body" -ForegroundColor DarkGray

    if (-not $PSCmdlet.ShouldProcess($What, "POST")) {
        Write-Host "    (WhatIf - nothing sent)" -ForegroundColor Yellow
        Write-Host ""
        return $true
    }
    try {
        $r = Invoke-RestMethod -Uri $Url -Method Post -ContentType "application/json" `
                -Headers $headers -Body $Body -TimeoutSec 30
        Write-Host "    Sent." -ForegroundColor Green
        if ($r) { Write-Host "    $($r | ConvertTo-Json -Compress)" -ForegroundColor DarkGray }
        Write-Host ""
        return $true
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
        Write-Host "    FAILED$(if ($status) { " - HTTP $status" })" -ForegroundColor Red
        if ($_.ErrorDetails.Message) { Write-Host "    $($_.ErrorDetails.Message)" -ForegroundColor Red }
        else { Write-Host "    $($_.Exception.Message)" -ForegroundColor Red }
        if ($status -eq 401 -or $status -eq 403) {
            Write-Host "    The secret was rejected." -ForegroundColor Yellow
        } elseif ($status -eq 404) {
            Write-Host "    Endpoint not found - confirm the path with the developer." -ForegroundColor Yellow
        }
        Write-Host ""
        return $false
    }
}

Write-Host ""
Write-Host "  $($label[$Game]) - manual send" -ForegroundColor Cyan
Write-Host "  $base"
Write-Host ""

$failed = 0

# ---- the result ---------------------------------------------------------
if ($Numbers -and $Numbers.Count -gt 0) {

    if ($DrawId -le 0) {
        Write-Host "  -DrawId is required when sending numbers." -ForegroundColor Red
        Write-Host ""
        exit 1
    }
    if ($Numbers.Count -ne $expected[$Game]) {
        Write-Host "  $($label[$Game]) needs exactly $($expected[$Game]) numbers; you gave $($Numbers.Count)." -ForegroundColor Red
        Write-Host ""
        exit 1
    }

    # Published smallest to largest, and zero-padded to two digits.
    $sorted = $Numbers | Sort-Object
    $padded = $sorted | ForEach-Object { "{0:D2}" -f $_ }

    Write-Host ("  Numbers as given : {0}" -f ($Numbers -join ' '))
    Write-Host ("  Sent ascending   : {0}" -f ($padded -join ' '))
    if ($Letter) { Write-Host "  Letter           : $Letter" }
    Write-Host ""

    $body = [ordered]@{
        draw_id       = $DrawId
        first_number  = $padded[0]
        second_number = $padded[1]
        third_number  = $padded[2]
        fourth_number = $padded[3]
        fifth_number  = $padded[4]
    }
    if ($Game -eq "super6") { $body["sixth_number"] = $padded[5] }
    $body["letter"] = $Letter

    $json = $body | ConvertTo-Json -Compress
    if (-not (Send-Json -Url "$base/$($resultPath[$Game])" -Body $json -What "Result, draw $DrawId")) {
        $failed++
    }
}

# ---- the jackpot --------------------------------------------------------
if ($Jackpot -gt 0) {
    $json = @{ estimated_jackpot = [int]$Jackpot } | ConvertTo-Json -Compress
    if (-not (Send-Json -Url "$base/$($jackpotPath[$Game])" -Body $json `
                -What ("Jackpot `${0:N0}" -f $Jackpot))) {
        $failed++
    }
}

if (-not $Numbers -and $Jackpot -le 0) {
    Write-Host "  Nothing to send. Give -Numbers (with -DrawId) or -Jackpot." -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

if ($failed -gt 0) { Write-Host "  $failed request(s) failed." -ForegroundColor Red; Write-Host ""; exit 1 }
Write-Host "  Done." -ForegroundColor Green
Write-Host ""
