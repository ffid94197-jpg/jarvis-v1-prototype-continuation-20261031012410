$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host 'JARVIS native desktop checks — isolated Windows source'
python -c "import pywinauto; print('pywinauto import OK')"
if ($LASTEXITCODE -ne 0) { throw 'Missing or incompatible pywinauto. Install locked companion requirements first.' }
bun run test:native-desktop-offline
if ($LASTEXITCODE -ne 0) { throw 'Native desktop contract failed.' }
bun run test:full-desktop-offline
if ($LASTEXITCODE -ne 0) { throw 'Desktop regression failed.' }
bunx tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw 'TypeScript failed.' }
bun run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint failed.' }
bun run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Host 'Static gates PASS. REAL Windows UIA + NEXUS + Minecraft still require live tests.'
