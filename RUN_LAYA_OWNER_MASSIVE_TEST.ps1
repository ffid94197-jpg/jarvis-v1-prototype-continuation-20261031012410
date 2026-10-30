param([int]$Rounds = 12, [int]$DecisionsPerRound = 8000)
$ErrorActionPreference = 'Stop'
if ($Rounds -lt 1 -or $DecisionsPerRound -lt 1) { throw 'Rounds and DecisionsPerRound must be positive.' }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$logDir = Join-Path $root 'evidence\owner-priority'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$total = 0
for ($i = 1; $i -le $Rounds; $i++) {
  $env:LAYA_OWNER_ROUND = "$i"
  $env:LAYA_OWNER_DECISIONS = "$DecisionsPerRound"
  $env:LAYA_OWNER_REPORT = Join-Path $logDir "round_$i.json"
  & node scripts/model-manager/verify-owner-priority.cjs
  if ($LASTEXITCODE -ne 0) { throw "LAYA owner-priority stress round $i failed." }
  $result = Get-Content $env:LAYA_OWNER_REPORT -Raw | ConvertFrom-Json
  if ($result.decisions -ne $DecisionsPerRound -or $result.failures.Count -gt 0) { throw "Invalid test results in round $i." }
  $total += $result.decisions
}
Remove-Item Env:LAYA_OWNER_ROUND,Env:LAYA_OWNER_DECISIONS,Env:LAYA_OWNER_REPORT -ErrorAction SilentlyContinue
Write-Host "PASSED: $total owner-priority routing decisions across $Rounds rounds. Logs: $logDir"
