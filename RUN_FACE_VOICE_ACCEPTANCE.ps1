param([int]$Rounds=12,[int]$CasesPerRound=400)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
if($Rounds -lt 1 -or $Rounds -gt 30 -or $CasesPerRound -lt 20 -or $CasesPerRound -gt 10000){throw 'Invalid stress-test size.'}
Write-Host 'Running camera/voice offline regression with public media fixtures'
python .\scripts\perception\verify_face_voice.py --rounds $Rounds --cases $CasesPerRound --output .\FACE_VOICE_LOCAL_TEST_RESULTS.json
if($LASTEXITCODE -ne 0){throw 'Perception stress test failed.'}
Write-Host 'Running existing LAYA/Native agent regressions'
node .\scripts\model-manager\verify-owner-priority.cjs
if($LASTEXITCODE -ne 0){throw 'LAYA priority failed.'}
node .\scripts\verify-autonomy-supervisor.cjs
if($LASTEXITCODE -ne 0){throw 'Autonomy regression failed.'}
python .\windows-companion\verify_native_uia_offline.py
if($LASTEXITCODE -ne 0){throw 'Native UIA regression failed.'}
Write-Host 'Now run separately: bunx tsc --noEmit; bun run lint; bun run build'
Write-Host 'And verify real camera and microphone in NEXUS on Windows (not covered by these offline tests).'
