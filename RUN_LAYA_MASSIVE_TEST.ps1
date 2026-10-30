# Run from the project root (once dependencies are installed); all tests use mock endpoints only.
param([int]$Rounds = 10, [int]$DecisionsPerRound = 2000)
$ErrorActionPreference = 'Stop'
$source = (Get-Location).Path
$target = Join-Path $source 'scripts\model-manager\verify-laya-stress.cjs'
if (-not (Test-Path $target)) { throw 'Open PowerShell at the root of JARVIS source before running.' }
$logs = Join-Path $source 'evidence\laya-massive-stress'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
for ($i = 1; $i -le $Rounds; $i++) {
    $env:LAYA_STRESS_ROUND = "$i"
    $env:LAYA_STRESS_DECISIONS = "$DecisionsPerRound"
    $env:LAYA_STRESS_REPORT = Join-Path $logs "stress_round_$i.json"
    & node $target *>&1 | Tee-Object -FilePath (Join-Path $logs "stress_round_$i.log")
    if ($LASTEXITCODE -ne 0) { throw "LAYA stress round $i failed!" }
}
Write-Host "PASS: $Rounds stress rounds. See $logs" -ForegroundColor Green
