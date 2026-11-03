<#
.SYNOPSIS
  Reproducible JARVIS V1 Windows production build driver.

.DESCRIPTION
  Runs the real toolchain in a fixed order and writes a machine-readable
  attestation (PRODUCTION_BUILD_STATUS.json) plus the standalone artifact
  report (PRODUCTION_BUILD_ARTIFACTS.json).

  Order: Prisma client generation -> full TypeScript typecheck -> Next
  production build -> standalone artifact gate.

  Any non-zero exit records a FAIL attestation. A FAIL is never rewritten to a
  PASS, and this script never reports release certification.

  SECURITY: the loopback development authentication bypass is forced OFF for
  the whole build. A production attestation must never be produced by a
  process that had JARVIS_LOCAL_DEV_NO_LOGIN enabled.

  This file was reconstructed from the contract asserted by
  scripts/verify-production-build-wiring.cjs and the schema of the committed
  PRODUCTION_BUILD_STATUS.json. The original lived one directory ABOVE the app
  in the owner's Windows layout and was never committed.
  STATUS: PENDING LIVE WINDOWS ACCEPTANCE - not executed in the authoring
  environment (no Windows/PowerShell available there).

.PARAMETER AppPath
  Application root containing package.json. Defaults to this script's own
  folder, or .\app when this script sits beside the app (historical layout).

.PARAMETER InstallDependencies
  Run "npm ci" before building, for a clean reproducible install.

.PARAMETER SkipArtifactGate
  Skip the standalone artifact verification step. The attestation then says so
  explicitly; it never implies the artifacts were checked.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\BUILD_JARVIS_PRODUCTION.ps1
#>
[CmdletBinding()]
param(
  [string]$AppPath,
  [switch]$InstallDependencies,
  [switch]$SkipArtifactGate
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
  # Same-folder layout (script committed at the repo root).
  if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json')) { return $PSScriptRoot }
  # Historical owner layout: scripts one level above .\app
  $nested = Join-Path $PSScriptRoot 'app'
  if (Test-Path -LiteralPath (Join-Path $nested 'package.json')) { return $nested }
  throw 'Could not locate the JARVIS application root. Pass -AppPath explicitly.'
}

$script:App = Resolve-AppPath $AppPath
$script:StatusPath = Join-Path $script:App 'PRODUCTION_BUILD_STATUS.json'
$script:ArtifactPath = Join-Path $script:App 'PRODUCTION_BUILD_ARTIFACTS.json'
$script:StartedUtc = (Get-Date).ToUniversalTime().ToString('o')
$script:ScopeText = 'Windows Next standalone application compilation only; not JARVIS V1 release certification'

# Writes the durable attestation. Status is constrained to PASS/FAIL so a
# failed build cannot be recorded as anything else.
function WriteStatus {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('PASS', 'FAIL')][string]$Status,
    [string]$Detail = '',
    [string]$Stage = 'NEXT_STANDALONE_PRODUCTION_BUILD'
  )
  $payload = [ordered]@{
    schemaVersion = 1
    stage         = $Stage
    status        = $Status
    startedUtc    = $script:StartedUtc
    endedUtc      = (Get-Date).ToUniversalTime().ToString('o')
    detail        = $Detail
    scope         = $script:ScopeText
  }
  try {
    ($payload | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $script:StatusPath -Encoding UTF8
  } catch {
    Write-Host "WARNING: could not write attestation to $($script:StatusPath): $($_.Exception.Message)"
  }
  Write-Host "[$Status] $Stage :: $Detail"
}

Set-Location -LiteralPath $script:App
Write-Host "JARVIS V1 production build in: $($script:App)"

# --- Security preconditions -------------------------------------------------
$env:NODE_ENV = 'production'
# The loopback development authentication bypass must NEVER be active while a
# production build or its attestation is produced.
$env:JARVIS_LOCAL_DEV_NO_LOGIN='0'
if ($env:JARVIS_EXPERIMENTAL_DESKTOP_CONTROL -eq '1') {
  Write-Warning 'JARVIS_EXPERIMENTAL_DESKTOP_CONTROL=1 is set. Generic desktop mouse/keyboard control is an owner-authorized test-laptop opt-in and is NOT part of a certified production build. It is recorded in the attestation detail and remains under Guardian.'
}
$experimentalNote = if ($env:JARVIS_EXPERIMENTAL_DESKTOP_CONTROL -eq '1') { ' Experimental desktop control flag was ON in the build environment.' } else { '' }

if (!(Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  WriteStatus 'FAIL' 'npm.cmd not available on PATH; install Node.js for Windows before building.'
  exit 1
}
if (!(Test-Path -LiteralPath (Join-Path $script:App 'prisma\schema.prisma'))) {
  WriteStatus 'FAIL' 'prisma\schema.prisma missing; refusing to build an incomplete source tree.'
  exit 1
}

if ($InstallDependencies) {
  Write-Host '=== npm ci (clean reproducible install) ==='
  & npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { WriteStatus 'FAIL' "npm ci failed (exit $LASTEXITCODE)."; exit 1 }
} elseif (!(Test-Path -LiteralPath (Join-Path $script:App 'node_modules'))) {
  WriteStatus 'FAIL' 'node_modules missing. Re-run with -InstallDependencies, or install dependencies first.'
  exit 1
}

# --- 1. Prisma client generation -------------------------------------------
Write-Host '=== 1/4 Prisma client generation ==='
& npm.cmd run db:generate
if ($LASTEXITCODE -ne 0) { WriteStatus 'FAIL' "Prisma client generation failed (exit $LASTEXITCODE)."; exit 1 }

# --- 2. Full TypeScript typecheck ------------------------------------------
Write-Host '=== 2/4 TypeScript typecheck (tsc --noEmit) ==='
& npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { WriteStatus 'FAIL' "Full TypeScript typecheck failed (exit $LASTEXITCODE)."; exit 1 }

# --- 3. Real Next production build -----------------------------------------
Write-Host '=== 3/4 Next production build ==='
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { WriteStatus 'FAIL' "Next.js production build failed (exit $LASTEXITCODE)."; exit 1 }

# --- 4. Standalone artifact gate -------------------------------------------
$buildId = ''
$buildIdPath = Join-Path $script:App '.next\BUILD_ID'
if (Test-Path -LiteralPath $buildIdPath) {
  $buildId = (Get-Content -LiteralPath $buildIdPath -Raw).Trim()
}

if ($SkipArtifactGate) {
  WriteStatus 'PASS' "Compiled standalone Next application; BUILD_ID=$buildId. Artifact gate SKIPPED by operator, so artifacts were NOT independently verified. NOT security or full V1 acceptance.$experimentalNote"
  exit 0
}

Write-Host '=== 4/4 Standalone artifact gate ==='
& node scripts/verify-production-build.mjs --check $script:App --output $script:ArtifactPath
if ($LASTEXITCODE -ne 0) {
  WriteStatus 'FAIL' "Standalone artifact gate failed (exit $LASTEXITCODE); BUILD_ID=$buildId. See PRODUCTION_BUILD_ARTIFACTS.json."
  exit 1
}

WriteStatus 'PASS' "Compiled standalone Next application; BUILD_ID=$buildId. NOT security or full V1 acceptance.$experimentalNote"
Write-Host 'Production build artifacts verified. This is NOT Windows LPAC/RLM certification, NOT live GUI/model acceptance and NOT JARVIS V1 release approval.'
exit 0
