param([ValidateRange(1,12)][int]$Rounds = 3,[ValidateRange(10,30000)][int]$CrossCases = 5000)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$manifest = Get-Content .\OVERALL_TEST_SUITE_MANIFEST.json -Raw | ConvertFrom-Json
$resultsDir = Join-Path $PSScriptRoot 'overall-local-test-results'
New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null
$env:LAYA_OWNER_DECISIONS = '1200'
$env:ROUNDS = '2'
$env:CALLS_PER_ROUND = '85'
$env:PYTHONDONTWRITEBYTECODE = '1'
Write-Host "JARVIS offline acceptance: $Rounds rounds x $($manifest.Count) test scripts. No real Windows desktop controls are executed by these tests."
for ($round=1; $round -le $Rounds; $round++) {
    $env:LAYA_OWNER_ROUND = "$round"
    foreach ($test in $manifest) {
        $name = [string]$test.name
        $parts = @($test.command | ForEach-Object { [string]$_ })
        $exe = if($parts[0] -eq 'python3') { 'python' } else { $parts[0] }
        $args = @($parts | Select-Object -Skip 1)
        $file = Join-Path $resultsDir ("round_{0}_{1}.log" -f $round, $name)
        & $exe @args *> $file
        if ($LASTEXITCODE -ne 0) {
            Write-Host "FAIL: Round $round - $name. Read $file" -ForegroundColor Red
            throw "Overall JARVIS regression failed."
        }
        Write-Host "PASS: round=$round suite=$name"
    }
}
$env:OVERALL_ROUNDS = "$Rounds"
$env:OVERALL_CASES = "$CrossCases"
$crossLog = Join-Path $resultsDir 'cross_workflows.log'
& node .\scripts\overall\verify-overall-workflows.mjs *> $crossLog
if ($LASTEXITCODE -ne 0) { throw "Cross-subsystem simulation failed. Read $crossLog" }
Write-Host "ALL OFFLINE TESTS PASSED: $($Rounds * $manifest.Count) script runs. Cross-subsystem property tests passed."
Write-Host "Live camera, model inference, Windows automation, Prisma worker, Minecraft LAN and end-to-end NEXUS acceptance remain separate."
