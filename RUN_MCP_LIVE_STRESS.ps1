param(
  [ValidateRange(1,20)][int]$Rounds = 8,
  [ValidateRange(1,3000)][int]$CallsPerRound = 750
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not on PATH' }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw 'Python is not on PATH' }
$env:ROUNDS = "$Rounds"
$env:CALLS_PER_ROUND = "$CallsPerRound"
$commands = @(
  @{ Name = 'strict live MCP protocol'; Executable = 'node'; Args = @('scripts/adoption/stress-live.mjs') },
  @{ Name = 'hostile MCP and quota'; Executable = 'node'; Args = @('scripts/adoption/stress-security.mjs') },
  @{ Name = 'ZIP archive hardening'; Executable = 'python'; Args = @('scripts/adoption/stress-archives.py') },
  @{ Name = 'original adoption regression'; Executable = 'node'; Args = @('scripts/adoption/verify-adoption.mjs') },
  @{ Name = 'autonomy supervisor'; Executable = 'node'; Args = @('scripts/verify-autonomy-supervisor.cjs') },
  @{ Name = 'native-tool wiring'; Executable = 'node'; Args = @('scripts/verify-native-tool-wiring.cjs') },
  @{ Name = 'LAYA owner-priority'; Executable = 'node'; Args = @('scripts/model-manager/verify-owner-priority.cjs') },
  @{ Name = 'long-running routines'; Executable = 'node'; Args = @('scripts/longrun/verify-longrun.mjs') }
)
foreach ($job in $commands) {
  Write-Host "RUNNING: $($job.Name)" -ForegroundColor Cyan
  $arguments = $job.Args
  & $job.Executable @arguments
  if ($LASTEXITCODE -ne 0) { throw "FAILED: $($job.Name) (exit $LASTEXITCODE)" }
}
Write-Host 'JARVIS_MCP_LIVE_STRESS_LOCAL_PASS' -ForegroundColor Green
Write-Host 'NOTE: Real GitHub network downloads, authenticated MCP providers and native Windows UI tasks are separate acceptance gates.'
