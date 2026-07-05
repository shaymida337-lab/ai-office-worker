param(
  [string]$ScanId = 'cmr0sele500adik2dlu7gofmq',
  [string]$LogPath = 'c:\Users\shaym\ai-office-worker\backend\_scan_monitor.log',
  [int]$IntervalSec = 150,
  [int]$MaxPolls = 25
)

$envFile = Join-Path $PSScriptRoot '..' '.env.prod.local' | Resolve-Path
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') {
    Set-Item -Path ("Env:" + $Matches[1].Trim()) -Value $Matches[2].Trim().Trim('"')
  }
}

$prevP = $null
$prevS = $null
$lastAdvance = [datetime]::UtcNow
'' | Out-File $LogPath

for ($i = 1; $i -le $MaxPolls; $i++) {
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss') + ' UTC'
  $sql = @"
SELECT sl.status, sl."finishedAt", sl."emailsProcessed", sl."emailsSaved", sl."errorsCount",
  COALESCE(sl."errorMessage", ''), COALESCE(sl."totalMatched"::text, ''), sl."startedAt",
  ROUND(EXTRACT(EPOCH FROM (NOW() - sl."startedAt")))::int,
  COALESCE((SELECT MAX(em."processedAt")::text FROM "EmailMessage" em WHERE em."organizationId" = sl."organizationId" AND em."processedAt" >= sl."startedAt"), ''),
  COALESCE((SELECT MAX(gsi."updatedAt")::text FROM "GmailScanItem" gsi WHERE gsi."organizationId" = sl."organizationId" AND gsi."updatedAt" >= sl."startedAt"), '')
FROM "SyncLog" sl WHERE sl.id = '$ScanId';
"@

  $raw = ($sql | psql $env:PROD_DATABASE_URL -t -A -F '|' 2>&1) -join "`n"
  $parts = @($raw.Trim() -split '\|')

  if ($parts.Count -ge 10 -and $parts[0] -notmatch 'ERROR') {
    $status = $parts[0]
    $finished = if ($parts[1]) { $parts[1] } else { 'null' }
    $ep = [int]$parts[2]
    $es = [int]$parts[3]
    $ec = [int]$parts[4]
    $err = $parts[5]
    $tm = if ($parts[6]) { $parts[6] } else { 'null' }
    $rsec = [int]$parts[8]
    $lep = if ($parts[9]) { $parts[9] } else { 'none' }
    $lgsi = if ($parts[10]) { $parts[10] } else { 'none' }

    $adv = 'FIRST'
    if ($null -ne $prevP) {
      if ($ep -gt $prevP -or $es -gt $prevS) {
        $adv = 'YES'
        $lastAdvance = [datetime]::UtcNow
      } else {
        $adv = 'NO'
      }
    }

    $stallMin = [math]::Round(([datetime]::UtcNow - $lastAdvance).TotalMinutes, 1)
    $line = "[$ts] poll=$i status=$status finishedAt=$finished ep=$ep es=$es errCnt=$ec totalMatched=$tm running_sec=$rsec advancing=$adv stall_min=$stallMin last_email=$lep last_gsi=$lgsi errMsg=$err"
    $line | Tee-Object -FilePath $LogPath -Append
    $prevP = $ep
    $prevS = $es

    if ($status -ne 'running' -or ($parts[1] -and $parts[1].Length -gt 0)) {
      "DONE: $line" | Tee-Object -FilePath $LogPath -Append
      break
    }

    if ($rsec -ge 1860 -and $status -eq 'running') {
      'STALE_WINDOW_REACHED' | Tee-Object -FilePath $LogPath -Append
    }
  } else {
    "[$ts] QUERY_ERROR: $raw" | Tee-Object -FilePath $LogPath -Append
  }

  if ($i -lt $MaxPolls) {
    Start-Sleep -Seconds $IntervalSec
  }
}
