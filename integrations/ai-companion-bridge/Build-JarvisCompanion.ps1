param(
  [switch]$ApplyOnly,
  [switch]$BuildOnly
)
$ErrorActionPreference = 'Stop'
$bridge = $PSScriptRoot
$upstream = Join-Path (Split-Path $bridge -Parent) 'ai-companion'
if (-not (Test-Path $upstream)) { throw 'Pinned AI Companion submodule missing. Run git submodule update --init integrations/ai-companion in the prototype checkout.' }
$javaExecutable = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin\java.exe' } else { 'java' }
$java = & $javaExecutable -version 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $java -notmatch 'version "17|openjdk version "17') { throw 'JDK 17 must be active for Fabric 1.20.1 build.' }
if (-not $BuildOnly) {
  & node (Join-Path $bridge 'apply-overlay.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Overlay installation failed; preserved upstream edits.' }
}
if ($ApplyOnly) { Write-Host 'JARVIS overlay installed; no build executed.'; exit 0 }
foreach ($name in @('JarvisBridgeServer.java', 'JarvisEndgameTask.java')) {
  $sourceOverlay = Join-Path $bridge ('overlay\com\neovetta\aicompanion\jarvis\' + $name)
  $installedOverlay = Join-Path $upstream ('aicompanion\src\main\java\com\neovetta\aicompanion\jarvis\' + $name)
  if (-not (Test-Path $installedOverlay)) {
    throw ('Native JARVIS source missing: ' + $name)
  }
  if ((Get-FileHash -LiteralPath $sourceOverlay -Algorithm SHA256).Hash -ne
      (Get-FileHash -LiteralPath $installedOverlay -Algorithm SHA256).Hash) {
    throw ('Overlay has changed outside the pinned adapter: ' + $name)
  }
}
$engine = Join-Path $upstream 'engine'
$consumer = Join-Path $upstream 'aicompanion'
$engineGradle = Join-Path $engine 'gradlew.bat'
$modGradle = Join-Path $consumer 'gradlew.bat'
if (-not (Test-Path $engineGradle) -or -not (Test-Path $modGradle)) { throw 'Upstream Gradle wrappers missing.' }
Push-Location $engine
try {
  & $engineGradle build
  if ($LASTEXITCODE -ne 0) { throw 'PlayerEngine Gradle build failed.' }
} finally { Pop-Location }
$produced = @(Get-ChildItem (Join-Path $engine 'build\libs') -Filter 'PlayerEngine-1.1.19.jar' -File)
if ($produced.Count -ne 1) { throw 'Expected exact PlayerEngine 1.1.19 jar not found. No stale jars will be copied.' }
$dest = Join-Path $consumer 'libs\PlayerEngine-1.1.19.jar'
Copy-Item $produced[0].FullName $dest -Force
Push-Location $consumer
try {
  & $modGradle build
  if ($LASTEXITCODE -ne 0) { throw 'AI Companion Fabric build failed.' }
} finally { Pop-Location }
Write-Host 'Built overlay candidate. Keep JARVIS_MC_BRIDGE_ENABLE disabled until independent acceptance.'
Write-Host 'This script does NOT run a game, prove Guardian integration, or promote the backend.'
