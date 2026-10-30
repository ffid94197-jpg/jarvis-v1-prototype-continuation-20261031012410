# Safe, repeatable setup for a separate source checkout. No database deletion,
# no changes to D:\jarvis_pc_work and no touching the user's other projects.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw 'Bun missing from this PowerShell session. Restart shell or add $HOME\.bun\bin to PATH.'
}
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw 'Python missing. Install Python 3.12+ for Windows with PATH enabled, then rerun.'
}
if (-not (Test-Path '.env')) {
  Write-Host 'No private .env found. Create it using the example plus your EXISTING private DB/AI settings. Do not paste credentials in chat.'
  Write-Host 'IMPORTANT: do not start JARVIS until .env is configured.'
}
Write-Host 'Installing locked JARVIS dependencies...'
bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Bun install failed.' }
Write-Host 'Installing Python Windows companion dependencies...'
python -m pip install -r windows-companion\requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
Write-Host 'Installing Playwright Chromium browser (download required)...'
python -m playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Playwright browser installation failed.' }
Write-Host 'Running offline desktop policy checks...'
bun run test:windows-policy
if ($LASTEXITCODE -ne 0) { throw 'Desktop policy checks failed.' }
python windows-companion\verify_companion_offline.py
if ($LASTEXITCODE -ne 0) { throw 'Companion policy checks failed.' }
Write-Host 'Running integrated agent-tool wiring and browser policy checks...'
bun run test:agent-tools-offline
if ($LASTEXITCODE -ne 0) { throw 'New agent-tool checks failed.' }
Write-Host 'Checking native desktop tool contract (UIA)...'
bun run test:native-desktop-offline
if ($LASTEXITCODE -ne 0) { throw 'Native desktop policy checks failed.' }
Write-Host 'Setup prerequisites installed. Now configure private .env and run bun run dev:windows.'
Write-Host 'Minecraft optional: cd windows-companion\minecraft-bot ; npm install'
