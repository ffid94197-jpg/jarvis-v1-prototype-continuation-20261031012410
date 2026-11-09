#requires -Version 5.1
<#
.SYNOPSIS
  Prepare an isolated JARVIS prototype checkout for a real Windows field test.
.DESCRIPTION
  Local-only clean install, Prisma generation, TypeScript and Next.js build.
  Never runs GitHub Actions, touches the original PC Work JARVIS, overwrites
  private .env values, starts real-world effects without -Launch, or marks
  any gameplay task as accepted. Fails on dirty or wrong checkout.
.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-field-test.ps1
.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare-field-test.ps1 -MinecraftCode -Launch
#>
[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$MinecraftCode,
  [switch]$NativeFabric,
  [switch]$Launch
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') {
  throw 'This field-test preparation is only for the owner Windows PC.'
}
$repo=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$branchExpected='feat/field-test-build-integration-20261109'
if ($repo -match '(?i)(^|[\\/])jarvis_pc_work([\\/]|$)') {
  throw 'Refusing to operate in original PC Work JARVIS. Use a fresh isolated prototype clone.'
}
function Require-Exe([string]$name) {
  $command=Get-Command $name -ErrorAction SilentlyContinue
  if (-not $command) {throw "Required executable not available: $name"}
  return $command.Source
}
function Run-Checked([string]$exe,[string[]]$argv,[string]$label) {
  Write-Host ("JARVIS FIELD PREP: "+$label)
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE). No field acceptance claimed." }
}
$git=Require-Exe 'git.exe'
$node=Require-Exe 'node.exe'
$npm=Require-Exe 'npm.cmd'
$npx=Require-Exe 'npx.cmd'
$nodeVersion=(& $node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') {
  throw "Cannot determine Node.js version: $nodeVersion"
}
if ([int]$Matches[1] -lt 22) {throw 'Node.js 22 or newer is required.'}
$branchName=(& $git -C $repo branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branchName -ne $branchExpected) {
  throw "Wrong or detached branch. Required: $branchExpected"
}
$remote=(& $git -C $repo remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or $remote -notmatch 'ffid94197-jpg/jarvis-v1-prototype-continuation-20261031012410(?:\.git)?$') {
  throw 'Unexpected origin remote. Refusing to build an unrelated project.'
}
$dirty=(& $git -C $repo status --porcelain | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $dirty) {
  throw 'Checkout has uncommitted files. Preserve them; use a new clean field-test clone instead.'
}
$head=(& $git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') {
  throw 'Unable to establish the exact prototype commit.'
}
Write-Host "Field-test candidate: $head"
Write-Host 'No hosted GitHub Actions will be launched.'
Push-Location $repo
try {
  if (-not $SkipInstall) {
    Run-Checked $npm @('ci','--no-audit','--no-fund') 'Clean pinned dependency install'
  } elseif (-not (Test-Path (Join-Path $repo 'node_modules\typescript'))) {
    throw '-SkipInstall requested, but TypeScript dependencies are absent.'
  }
  Run-Checked $npx @('--no-install','prisma','generate') 'Prisma client generation'
  Run-Checked $npm @('run','typecheck') 'Full TypeScript typecheck'
  Run-Checked $npm @('run','build') 'Full Next.js build'

  if ($MinecraftCode) {
    $mcScript=Join-Path $repo 'scripts\minecraft\run-local-acceptance.ps1'
    if (-not (Test-Path $mcScript)) {throw 'Local Minecraft acceptance script missing.'}
    & $mcScript -Mode Code
    if ($LASTEXITCODE -ne 0) {throw 'Offline Minecraft code gate failed.'}
  }
  if ($NativeFabric) {
    $fabricScript=Join-Path $repo 'integrations\ai-companion-bridge\Build-JarvisCompanion.ps1'
    if (-not (Test-Path $fabricScript)) {throw 'Native Java overlay build script missing.'}
    & $fabricScript
    if ($LASTEXITCODE -ne 0) {throw 'Native Fabric/PlayerEngine build failed.'}
  }
  Write-Host "LOCAL BUILD GATES PASSED for commit $head. Real Windows effects and Minecraft gameplay are still UNVERIFIED."
  if ($Launch) {
    if (-not (Test-Path (Join-Path $repo '.env'))) {
      throw 'Create a private, isolated .env first. No secrets are copied or generated.'
    }
    $bun=Require-Exe 'bun.exe'
    Write-Host 'Starting local Windows-only JARVIS on 127.0.0.1. Guardian, consent and emergency stop remain mandatory.'
    Run-Checked $bun @('run','dev:windows') 'Owner-supervised Windows field-test runtime'
  }
} finally {
  Pop-Location
}
