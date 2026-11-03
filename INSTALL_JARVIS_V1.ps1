<#
.SYNOPSIS
  JARVIS V1 local Windows installation driver (source checkout).

.DESCRIPTION
  Prepares a source checkout to run JARVIS V1 locally on the owner's own
  Windows PC: dependencies, optional Python companion dependencies, a real
  production build via BUILD_JARVIS_PRODUCTION.ps1, and the guarded first-run
  development database bootstrap.

  It reuses the repository's existing guarded scripts instead of reimplementing
  them, and it never deletes a database, never passes --accept-data-loss, and
  never touches a separate production checkout.

  Passing -SkipProductionBuild installs and validates without compiling the
  standalone Next output. The final report says explicitly which stages ran.

  STATUS: PENDING LIVE WINDOWS ACCEPTANCE - reconstructed from the contract in
  scripts/verify-production-build-wiring.cjs; not executed in the authoring
  environment (no Windows/PowerShell there). It performs NO release signing and
  grants NO certification.

.PARAMETER SkipProductionBuild
  Do not compile the standalone production build.

.PARAMETER InstallDependencies
  Force a clean "npm ci" even when node_modules already exists.

.PARAMETER SkipPythonCompanion
  Skip Windows companion (Python) dependency installation.

.EXAMPLE
  .\INSTALL_JARVIS_V1.cmd
  .\INSTALL_JARVIS_V1.cmd -SkipProductionBuild -SkipPythonCompanion
#>
[CmdletBinding()]
param(
  [string]$AppPath,
  [switch]$SkipProductionBuild,
  [switch]$InstallDependencies,
  [switch]$SkipPythonCompanion
)

$ErrorActionPreference = 'Stop'

function Resolve-AppPath {
  param([string]$Requested)
  if ($Requested) {
    $full = (Resolve-Path -Path $Requested -ErrorAction Stop).Path
    if (!(Test-Path -LiteralPath (Join-Path $full 'package.json'))) {
      throw "No package.json under AppPath '$full'."
    }
    return $full
  }
  if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json')) { return $PSScriptRoot }
  $nested = Join-Path $PSScriptRoot 'app'
  if (Test-Path -LiteralPath (Join-Path $nested 'package.json')) { return $nested }
  throw 'Could not locate the JARVIS application root. Pass -AppPath explicitly.'
}

function Find-BuildScript {
  param([string]$App)
  foreach ($candidate in @((Join-Path $PSScriptRoot 'BUILD_JARVIS_PRODUCTION.ps1'),
                           (Join-Path $App 'BUILD_JARVIS_PRODUCTION.ps1'),
                           (Join-Path (Split-Path -Parent $App) 'BUILD_JARVIS_PRODUCTION.ps1'))) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  throw 'BUILD_JARVIS_PRODUCTION.ps1 not found beside the installer, in the app root, or one level above it.'
}

if ($env:OS -ne 'Windows_NT') {
  Write-Warning 'JARVIS V1 Windows installation is intended for Windows. Native UIA, LPAC/RLM and desktop control cannot be validated elsewhere.'
}

$script:App = Resolve-AppPath $AppPath
Set-Location -LiteralPath $script:App
Write-Host "JARVIS V1 install target: $($script:App)"

foreach ($tool in @('node', 'npm.cmd')) {
  if (!(Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool is required but was not found on PATH. Install Node.js for Windows, then rerun."
  }
}

$stages = [ordered]@{}

# --- 1. Node dependencies ---------------------------------------------------
Write-Host '=== 1/4 Node dependencies ==='
if ($InstallDependencies -or !(Test-Path -LiteralPath (Join-Path $script:App 'node_modules'))) {
  & npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed (exit $LASTEXITCODE)." }
  $stages['dependencies'] = 'installed (npm ci)'
} else {
  Write-Host 'node_modules present; skipping install. Use -InstallDependencies for a clean reproducible install.'
  $stages['dependencies'] = 'present (not reinstalled)'
}

# --- 2. Optional Python companion dependencies ------------------------------
Write-Host '=== 2/4 Windows companion (Python) dependencies ==='
if ($SkipPythonCompanion) {
  $stages['pythonCompanion'] = 'SKIPPED by operator'
} elseif (!(Get-Command python -ErrorAction SilentlyContinue)) {
  Write-Warning 'python not found; Windows companion offline policy checks cannot run. Skipping.'
  $stages['pythonCompanion'] = 'SKIPPED (python unavailable)'
} else {
  & python -m pip install -r (Join-Path $script:App 'windows-companion\requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw "Python companion dependency installation failed (exit $LASTEXITCODE)." }
  $stages['pythonCompanion'] = 'installed'
}

# --- 3. Production build ----------------------------------------------------
Write-Host '=== 3/4 Production build ==='
if ($SkipProductionBuild) {
  Write-Host 'Skipping the standalone production build (-SkipProductionBuild).'
  $stages['productionBuild'] = 'SKIPPED by operator; no standalone artifacts verified'
} else {
  $buildScript = Find-BuildScript $script:App
  & powershell -NoProfile -ExecutionPolicy Bypass -File $buildScript -AppPath $script:App
  if ($LASTEXITCODE -ne 0) { throw "BUILD_JARVIS_PRODUCTION.ps1 reported failure (exit $LASTEXITCODE). See PRODUCTION_BUILD_STATUS.json." }
  $stages['productionBuild'] = 'PASS (see PRODUCTION_BUILD_STATUS.json and PRODUCTION_BUILD_ARTIFACTS.json)'
}

# --- 4. Guarded first-run development database ------------------------------
Write-Host '=== 4/4 Guarded first-run development database ==='
if (!(Test-Path -LiteralPath (Join-Path $script:App '.env'))) {
  Write-Warning 'No private .env found. Configure it from WINDOWS_DESKTOP_COMPANION.env.example plus your EXISTING private DB/AI settings. Never paste credentials into chat or commit them.'
  $stages['database'] = 'NOT bootstrapped (.env missing)'
} else {
  # bootstrap-local-install.mjs is first-run guarded: it will not mutate an
  # existing database and never uses --accept-data-loss.
  & node scripts/bootstrap-local-install.mjs
  if ($LASTEXITCODE -ne 0) { throw "Guarded development database bootstrap failed (exit $LASTEXITCODE)." }
  $stages['database'] = 'bootstrapped (guarded first-run)'
}

Write-Host ''
Write-Host '=== JARVIS V1 INSTALLATION SUMMARY ==='
foreach ($key in $stages.Keys) { Write-Host ("  {0,-18} {1}" -f $key, $stages[$key]) }
Write-Host ''
Write-Host 'NOT certified by this script: Windows LPAC/RLM protected supervisor, live UIA/GUI control, real provider calls, voice/face hardware, live Minecraft gameplay, release signing, and owner release approval.'
Write-Host 'Next: configure your private .env, then run "npm.cmd run dev:windows" (or START_JARVIS_WINDOWS.cmd) on your own PC only.'
exit 0
