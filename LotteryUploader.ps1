# ==========================================
# NLA Lottery Results Webhook Uploader
# ==========================================

$Secret = "oeKuCdyLaQxdJg5sRJtwjJ9FIW5U0Z6re3bw2vqIMUiLmCja"

$Headers = @{
    "X-Webhook-Secret" = $Secret
}

$DailyCsv   = ".\Winning Numbers for Period-dailies-09-09-26.csv"
$JackpotCsv = ".\Winning Numbers for Period-Jackpot-09-09-26.csv"

# ------------------------------------------
# DRAW TYPE MAPPING
# ------------------------------------------

function Get-DailyDrawType {
    param([datetime]$DrawDate)

    switch ($DrawDate.Hour) {
        9  { "mid_morning" }
        12 { "mid_day" }
        16 { "afternoon" }
        19 { "evening" }
        default { "evening" }
    }
}

function Get-CashPopDrawType {
    param([datetime]$DrawDate)

    switch ($DrawDate.Hour) {
        8  { "kick_off" }
        11 { "lunch" }
        14 { "mid_rush" }
        17 { "after_work" }
        20 { "prime_time" }
    }
}

# ------------------------------------------
# POST FUNCTION
# ------------------------------------------

function Send-Webhook {
    param(
        [string]$Url,
        [object]$Payload
    )

    Write-Host ""
    Write-Host "Posting to $Url" -ForegroundColor Cyan
    Write-Host ($Payload | ConvertTo-Json -Depth 10)

    try {
        Invoke-RestMethod `
            -Uri $Url `
            -Method Post `
            -Headers $Headers `
            -ContentType "application/json" `
            -Body ($Payload | ConvertTo-Json)

        Write-Host "SUCCESS" -ForegroundColor Green
    }
    catch {
        Write-Host "FAILED" -ForegroundColor Red
        Write-Host $_.Exception.Message
    }
}

# ==========================================
# IMPORT FILES
# ==========================================

$DailyRows = Import-Csv $DailyCsv
$JackpotRows = Import-Csv $JackpotCsv

# ==========================================
# LOTTO
# ==========================================

$Lotto = $JackpotRows |
Where-Object {$_.Game -eq "LOTTO"} |
Select-Object -First 1

if ($Lotto)
{
    $Numbers = ($Lotto.'Winning Numbers').Split(" ")

    $Payload = @{
        draw_id       = [int]$Lotto.'Draw Number'
        first_number  = $Numbers[0]
        second_number = $Numbers[1]
        third_number  = $Numbers[2]
        fourth_number = $Numbers[3]
        fifth_number  = $Numbers[4]
        letter        = $Lotto.'Winning Numbers6'
    }

    Send-Webhook `
        "https://www.hexivedev.com/wp-json/lotto/v1/webhook" `
        $Payload
}

# ==========================================
# SUPER 6
# ==========================================

$Super6 = $JackpotRows |
Where-Object {$_.Game -eq "SUPER 6"} |
Select-Object -First 1

if ($Super6)
{
    $Numbers = ($Super6.'Winning Numbers1').Split(" ")

    $Payload = @{
        draw_id       = [int]$Super6.'Draw Number'
        first_number  = $Numbers[0]
        second_number = $Numbers[1]
        third_number  = $Numbers[2]
        fourth_number = $Numbers[3]
        fifth_number  = $Numbers[4]
        sixth_number  = $Numbers[5]
        letter        = $Super6.'Winning Numbers6'
    }

    Send-Webhook `
        "https://www.hexivedev.com/wp-json/super6/v1/webhook" `
        $Payload
}

# ==========================================
# PICK 3
# ==========================================

$Pick3Rows = $DailyRows |
Where-Object {$_.Game -eq "DAILY 3"}

foreach($Row in $Pick3Rows | Select-Object -First 4)
{
    $Date = [datetime]$Row.'Draw Date'
    $Value = $Row.'Winning Numbers'

    $Payload = @{
        draw_type    = Get-DailyDrawType $Date
        draw_id      = [int]$Row.'Draw Number'
        first_number = $Value.Substring(0,1)
        second_number = $Value.Substring(1,1)
        third_number = $Value.Substring(2,1)
        multi_x      = "FP"
    }

    Send-Webhook `
        "https://www.hexivedev.com/wp-json/pick3/v1/webhook" `
        $Payload
}

# ==========================================
# CASH 4
# ==========================================

$Cash4Rows = $DailyRows |
Where-Object {$_.Game -eq "CASH 4"}

foreach($Row in $Cash4Rows | Select-Object -First 4)
{
    $Date = [datetime]$Row.'Draw Date'
    $Value = $Row.'Winning Numbers2'

    $Payload = @{
        draw_type = Get-DailyDrawType $Date
        draw_id   = [int]$Row.'Draw Number'

        cash_4_first_number  = $Value.Substring(0,1)
        cash_4_second_number = $Value.Substring(1,1)
        cash_4_third_number  = $Value.Substring(2,1)
        cash_4_fourth_number = $Value.Substring(3,1)

        cash_4_multi_x = "FP"
    }

    Send-Webhook `
        "https://www.hexivedev.com/wp-json/cash4/v1/webhook" `
        $Payload
}

# ==========================================
# CASH POP
# ==========================================

$CashPopRows = $JackpotRows |
Where-Object {$_.Game -eq "Cash Pop"} |
Select-Object -First 5

foreach($Row in $CashPopRows)
{
    $Date = [datetime]$Row.'Draw Date'

    $Payload = @{
        draw_type = Get-CashPopDrawType $Date
        draw_id   = [int]$Row.'Draw Number'
        number    = $Row.'Winning Numbers2'
    }

    Send-Webhook `
        "https://www.hexivedev.com/wp-json/cashpop/v1/webhook" `
        $Payload
}
