# Prototype JARVIS selective third-party native integrations: local acceptance.
# Runs on the owner's Windows checkout only; no GitHub Actions and no network.
# Produces an explicit FAIL if any changed offline contract fails.
param([string]$OutputPath = "")
$ErrorActionPreference = "Stop"
if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "Windows-native test host required. No release acceptance claimed."
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $root 'data\external-integration-acceptance.json'
}
$cases = @(
  @{Name='Memory contracts'; Exec='node'; Args=@('scripts/verify-memory-contracts.cjs')},
  @{Name='Owner memory route'; Exec='node'; Args=@('scripts/verify-memory-route.cjs')},
  @{Name='MCP/skills adoption'; Exec='node'; Args=@('scripts/adoption/verify-adoption.mjs')},
  @{Name='Long-run checkpoint'; Exec='node'; Args=@('scripts/longrun/verify-longrun.mjs')},
  @{Name='Browser companion'; Exec='python'; Args=@('windows-companion/verify_agent_tools_offline.py')},
  @{Name='OmniParser detection'; Exec='python'; Args=@('windows-companion/verify_omniparser_offline.py')},
  @{Name='OmniParser loopback'; Exec='python'; Args=@('windows-companion/verify_omniparser_loopback_offline.py')},
  @{Name='UIA wiring'; Exec='node'; Args=@('scripts/verify-native-tool-wiring.cjs')},
  @{Name='UIA mock'; Exec='python'; Args=@('windows-companion/verify_native_uia_offline.py')},
  @{Name='Windows tool policy'; Exec='node'; Args=@('scripts/verify-windows-policy.cjs')},
  @{Name='TypeScript check'; Exec='npx'; Args=@('--no-install','tsc','--noEmit')}
)
$checks = @()
foreach ($case in $cases) {
  Write-Host "Running $($case.Name)"
  $exe = Get-Command $case.Exec -ErrorAction SilentlyContinue
  if (-not $exe) {
    $checks += @{name=$case.Name; outcome='BLOCKED'; reason='runtime not installed'}
    continue
  }
  try {
    $argsList = [string[]]$case.Args
    & $case.Exec @argsList
    $code = $LASTEXITCODE
    if ($null -eq $code) {$code = 1}
    $checks += @{name=$case.Name; outcome=$(if($code -eq 0){'PASS'}else{'FAIL'}); exitCode=$code}
  } catch {
    $checks += @{name=$case.Name; outcome='FAIL'; reason=$_.Exception.GetType().Name}
  }
}
$offlinePass = @($checks | Where-Object { $_.outcome -ne 'PASS' }).Count -eq 0
$report = @{
  kind='prototype_external_integration_delta_acceptance'
  generatedAt=(Get-Date).ToUniversalTime().ToString('o')
  checkMode='owner_Windows_offline'
  offlinePass=$offlinePass
  testCases=$checks
  liveWindowsAndGuardian='NOT_RUN'
  actualOmniParserWeightsAndInference='NOT_RUN'
  externalFullFrameworks='NOT_INSTALLED'
  liveLLMAndOpenHandsCoding='NOT_RUN'
  realJavaMinecraftNetheriteDragon='NOT_RUN'
  fullPrototypeAccepted=$false
}
$parent=Split-Path -Parent $OutputPath
if(-not (Test-Path $parent)){New-Item -ItemType Directory -Path $parent -Force | Out-Null}
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Host "Acceptance evidence saved to $OutputPath"
if(-not $offlinePass){Write-Error 'External integration offline acceptance FAILED or BLOCKED'; exit 1}
Write-Host 'Offline checks passed. Live Windows/model/Guardian/game acceptance STILL REQUIRED.'
exit 0
