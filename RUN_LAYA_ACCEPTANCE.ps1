$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'JARVIS LAYA ROUTING — Three-round offline acceptance'
for ($round = 1; $round -le 3; $round++) {
  Write-Host "ROUND $round"
  bun run test:laya-offline
  if ($LASTEXITCODE -ne 0) { throw "LAYA round $round failed" }
  bun run test:autonomy-offline
  if ($LASTEXITCODE -ne 0) { throw "Autonomy round $round failed" }
}
Write-Host 'Checking types, lint, and production build'
bunx tsc --noEmit
if ($LASTEXITCODE -ne 0) { throw 'TypeScript validation failed' }
bun run lint
if ($LASTEXITCODE -ne 0) { throw 'Lint validation failed' }
bun run build
if ($LASTEXITCODE -ne 0) { throw 'Production build failed' }
Write-Host 'OFFLINE CHECKS PASS — live on-device model and UI verification still required'
