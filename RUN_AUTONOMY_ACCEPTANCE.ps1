[CmdletBinding()]
param([ValidateRange(1,5)][int]$Rounds = 3, [switch]$SkipBuild)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (!(Test-Path '.\node_modules\typescript')) { throw 'Dependencies missing. Run bun install --frozen-lockfile in this folder.' }
if (!(Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python is required for Windows UIA policy/fixture tests.' }
$tests = @(
  @('node','scripts/verify-autonomy-supervisor.cjs'),
  @('python','windows-companion/verify_autonomy_native_offline.py'),
  @('node','scripts/verify-agent-tool-wiring.cjs'),
  @('node','scripts/verify-native-tool-wiring.cjs'),
  @('node','scripts/verify-windows-policy.cjs'),
  @('node','scripts/verify-full-desktop-policy.cjs'),
  @('python','windows-companion/verify_native_uia_offline.py'),
  @('python','windows-companion/verify_full_desktop_offline.py'),
  @('node','scripts/model-manager/verify-model-manager.cjs'),
  @('node','windows-companion/minecraft-bot/verify_friend_offline.cjs')
)
for ($i=1; $i -le $Rounds; $i++) {
  Write-Host "=== OFFLINE AUTONOMY ROUND $i/$Rounds ==="
  foreach ($test in $tests) {
    & $test[0] $test[1]
    if ($LASTEXITCODE -ne 0) { throw "FAIL Round $i : $($test -join ' ') (exit $LASTEXITCODE)" }
  }
}
Write-Host 'Offline suite passed. Checking TypeScript and ESLint.'
& bunx tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw 'Full TypeScript check FAILED' }
& bun run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint FAILED' }
if (!$SkipBuild) {
  & bun run build
  if ($LASTEXITCODE -ne 0) { throw 'Next.js production build FAILED' }
}
Write-Host 'OFFLINE + BUILD GATES PASSED. Real Windows GUI and live model execution are still NOT_TESTED.'
