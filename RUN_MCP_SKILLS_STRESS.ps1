param([ValidateRange(1,30)][int]$Rounds=5)
$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
  for ($i=1; $i -le $Rounds; $i++) {
    Write-Host "JARVIS_MCP_ADOPTION_TEST_ROUND=$i" -ForegroundColor Cyan
    node .\scripts\adoption\verify-adoption.mjs
    if ($LASTEXITCODE -ne 0) { throw "Integration fixture round $i failed" }
  }
  Write-Host "JARVIS_MCP_ADOPTION_TEST_ALL_ROUNDS_PASS=$Rounds" -ForegroundColor Green
} finally { Pop-Location }
