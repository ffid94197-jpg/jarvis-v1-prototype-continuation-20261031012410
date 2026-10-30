param([int]$Rounds=12, [int]$Cases=250, [string]$PythonExe='python')
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Path .\evidence\biometric -Force | Out-Null
& $PythonExe .\scripts\perception\verify_biometric_adversarial.py --rounds $Rounds --cases $Cases --output .\evidence\biometric\adversarial_results.json
if ($LASTEXITCODE -ne 0) { throw 'Biometric adversarial test failed.' }
& $PythonExe .\scripts\perception\verify_owner_wake_tts.py --rounds 2 --cases 20
if ($LASTEXITCODE -ne 0) { throw 'Owner wake regression failed.' }
& $PythonExe .\scripts\perception\verify_face_voice.py --rounds 1 --cases 20
if ($LASTEXITCODE -ne 0) { throw 'Face/voice regression failed.' }
Write-Host 'BIOMETRIC_OFFLINE_ACCEPTANCE_PASS; real speaker/face model accuracy untested.'
