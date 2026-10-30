# Run inside the new JARVIS test folder; no changes to Track A.
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$commands = @(
    @('node', 'scripts/longrun/verify-longrun.mjs'),
    @('node', 'scripts/verify-autonomy-supervisor.cjs'),
    @('node', 'scripts/model-manager/verify-laya-router.cjs'),
    @('node', 'scripts/model-manager/verify-owner-priority.cjs'),
    @('python', 'windows-companion/verify_autonomy_native_offline.py'),
    @('bunx', 'tsc', '--noEmit'),
    @('bun', 'run', 'lint'),
    @('bun', 'run', 'build')
)
foreach($cmd in $commands) {
    Write-Host "RUNNING: $($cmd -join ' ')"
    & $cmd[0] $cmd[1..($cmd.Length-1)]
    if($LASTEXITCODE -ne 0) { throw "FAILED: $($cmd -join ' ')" }
}
Write-Host 'OFFLINE AND BUILD GATES PASSED. Live Windows worker acceptance still required.'
