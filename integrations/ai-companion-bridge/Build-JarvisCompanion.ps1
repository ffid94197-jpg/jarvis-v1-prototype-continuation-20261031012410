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
foreach ($name in @('JarvisBridgeServer.java', 'JarvisEndgameTask.java', 'JarvisNativeJournal.java', 'JarvisNativeSequenceTask.java', 'JarvisNativeInventoryTransfer.java', 'JarvisNativeVillagerTrade.java', 'JarvisNativeOwnerEnchant.java', 'JarvisNativeVolumeTask.java')) {
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

# The pinned upstream Fabric consumer references a separate version-neutral
# memory jar. It is NOT committed into the AI Companion submodule.
# Pin source so a clean Windows build can reproduce that required dependency.
$memoryCommit = 'f0ec8d17e1f1c8527f6a15c34d65b6a670dbf044'
$memoryRoot = Join-Path (Split-Path $bridge -Parent) 'ai-companion-memory'
$memoryOutput = Join-Path $consumer 'libs\aicompanion-memory-0.4.0.jar'
$memoryMarker = $memoryOutput + '.jarvis-source'
if (Test-Path $memoryOutput) {
  if (-not (Test-Path $memoryMarker)) {
    throw 'Existing memory dependency has unknown provenance. Preserve it and reconcile source before building.'
  }
  $markerText = Get-Content -LiteralPath $memoryMarker -Raw
  $currentHash = (Get-FileHash -LiteralPath $memoryOutput -Algorithm SHA256).Hash
  if ($markerText.Trim() -ne ($memoryCommit + ':' + $currentHash)) {
    throw 'Memory dependency hash or source pin mismatch. No opaque jar will be silently reused.'
  }
} else {
  if (-not (Test-Path $memoryRoot)) {
    & git clone --no-checkout 'https://github.com/adevivo/ai-companion-memory.git' $memoryRoot
    if ($LASTEXITCODE -ne 0) { throw 'Unable to retrieve pinned public AI Companion memory source.' }
    & git -C $memoryRoot checkout --detach $memoryCommit
    if ($LASTEXITCODE -ne 0) { throw 'Pinned memory source checkout failed.' }
  }
  $actualMemoryCommit = (& git -C $memoryRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualMemoryCommit -ne $memoryCommit) {
    throw 'Memory source checkout differs from the pinned dependency. Existing files left untouched.'
  }
  if ((& git -C $memoryRoot status --porcelain | Out-String).Trim()) {
    throw 'Memory source checkout contains edits. Refusing to overwrite or rebuild it.'
  }
  $memoryEngine = Join-Path $memoryRoot 'engine'
  Push-Location $memoryEngine
  try {
    & (Join-Path $memoryEngine 'gradlew.bat') jar
    if ($LASTEXITCODE -ne 0) { throw 'Pinned memory jar build failed.' }
  } finally { Pop-Location }
  $memoryBuilt = Join-Path $memoryEngine 'build\libs\aicompanion-memory-0.4.0.jar'
  if (-not (Test-Path $memoryBuilt)) { throw 'Expected pinned memory artifact missing.' }
  New-Item -ItemType Directory -Path (Split-Path $memoryOutput) -Force | Out-Null
  Copy-Item -LiteralPath $memoryBuilt -Destination $memoryOutput
  $hash = (Get-FileHash -LiteralPath $memoryOutput -Algorithm SHA256).Hash
  Set-Content -LiteralPath $memoryMarker -Value ($memoryCommit + ':' + $hash) -Encoding Ascii
}
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
