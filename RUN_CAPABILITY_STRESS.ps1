param([int]$Rounds=12,[int]$Cases=2500)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host 'JARVIS capability matching simulation (no real PC actions performed)'
python .\scripts\capability\verify_discovery.py --rounds $Rounds --cases $Cases
if ($LASTEXITCODE -ne 0) {throw 'Capability simulation failed'}
node .\scripts\capability\verify_wiring.cjs
if ($LASTEXITCODE -ne 0) {throw 'Tool wiring check failed'}
node .\scripts\capability\verify_direct_intent.cjs
if ($LASTEXITCODE -ne 0) {throw 'Direct intent test failed'}
node .\scripts\verify-windows-policy.cjs
if ($LASTEXITCODE -ne 0) {throw 'Windows policy regression failed'}
Write-Host 'CAPABILITY_SIMULATION_PASS — live Windows acceptance still required'
