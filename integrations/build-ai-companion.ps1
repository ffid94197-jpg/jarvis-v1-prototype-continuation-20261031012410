[CmdletBinding()]
param(
  [string]$Java17Home = $env:JARVIS_JAVA17_HOME,
  [string]$Java21Home = $env:JARVIS_JAVA21_HOME
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$AI = Join-Path $Root 'integrations/ai-companion'
$Memory = Join-Path $Root 'integrations/ai-companion-memory'
$ExpectedAI = '6623267807879593a1002b2030e8b2ad82829c87'
$ExpectedMemory = 'cc33ad4c2f8202f68b138c0df433ede3b8947e95'

function Assert-Toolchain([string]$Home, [string]$Major) {
  if ([string]::IsNullOrWhiteSpace($Home) -or
      -not (Test-Path (Join-Path $Home 'bin/java.exe'))) {
    throw "JDK $Major is required. Set the corresponding JARVIS_JAVA_HOME variable or pass the JavaHome parameter."
  }
}
function Invoke-Gradle([string]$Directory, [string]$JavaHome, [string[]]$Arguments) {
  $oldHome = $env:JAVA_HOME
  $oldPath = $env:PATH
  try {
    $env:JAVA_HOME = $JavaHome
    $env:PATH = (Join-Path $JavaHome 'bin') + ';' + $oldPath
    Push-Location $Directory
    try {
      & .\gradlew.bat @Arguments
      if ($LASTEXITCODE -ne 0) { throw "Gradle failed in $Directory (exit $LASTEXITCODE)." }
    } finally { Pop-Location }
  } finally {
    $env:JAVA_HOME = $oldHome
    $env:PATH = $oldPath
  }
}
function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

Push-Location $Root
try {
  & git submodule update --init --recursive
  if ($LASTEXITCODE -ne 0) { throw 'Could not initialize pinned AI Companion source submodules.' }
} finally { Pop-Location }

if ((& git -C $AI rev-parse HEAD).Trim() -ne $ExpectedAI) { throw 'AI Companion submodule is not at the reviewed 1.21.11 release commit.' }
if ((& git -C $Memory rev-parse HEAD).Trim() -ne $ExpectedMemory) { throw 'AI Companion memory submodule is not at the reviewed 0.5.1 commit.' }
Assert-Toolchain $Java17Home '17'
Assert-Toolchain $Java21Home '21'

# Apply the JARVIS-only overlay idempotently. The upstream submodule remains pinned;
# the patch itself is version-controlled in this prototype repository.
$BridgeSource = Join-Path $PSScriptRoot 'ai-companion-overlay/JarvisBridge.java'
$BridgeTarget = Join-Path $AI 'aicompanion/src/main/java/com/neovetta/aicompanion/JarvisBridge.java'
if (-not (Test-Path $BridgeSource)) { throw 'JARVIS bridge overlay source is missing.' }
Copy-Item $BridgeSource $BridgeTarget -Force

$Entry = Join-Path $AI 'aicompanion/src/main/java/com/neovetta/aicompanion/AiCompanion.java'
$entryText = [System.IO.File]::ReadAllText($Entry)
$entryAnchor = '        registerServerToClientChannels();'
if (-not $entryText.Contains('JarvisBridge.register();')) {
  if (-not $entryText.Contains($entryAnchor)) { throw 'AI Companion entrypoint changed; refusing a fuzzy patch.' }
  $entryText = $entryText.Replace($entryAnchor, $entryAnchor + [Environment]::NewLine + '        JarvisBridge.register();')
  Write-Utf8NoBom $Entry $entryText
}

$Entity = Join-Path $AI 'aicompanion/src/main/java/com/neovetta/aicompanion/entity/CompanionEntity.java'
$entityText = [System.IO.File]::ReadAllText($Entity)
$entityAnchor = '        this.controller.setOwner(owner);'
if (-not $entityText.Contains('JarvisBridge.enabled()')) {
  if (-not $entityText.Contains($entityAnchor)) { throw 'Companion brain attachment changed; refusing a fuzzy patch.' }
  $replacement = $entityAnchor + [Environment]::NewLine +
    '        if (JarvisBridge.enabled()) this.controller.setChatClefEnabled(false);'
  $entityText = $entityText.Replace($entityAnchor, $replacement)
  Write-Utf8NoBom $Entity $entityText
}

$MemoryJar = Join-Path $Memory 'engine/build/libs/aicompanion-memory-0.5.1.jar'
$MemoryLibEngine = Join-Path $AI 'engine/common/libs'
$MemoryLibMod = Join-Path $AI 'aicompanion/libs'
New-Item -ItemType Directory -Force $MemoryLibEngine,$MemoryLibMod | Out-Null

Invoke-Gradle (Join-Path $Memory 'engine') $Java17Home @('clean','jar')
if (-not (Test-Path $MemoryJar)) { throw 'Expected aicompanion-memory-0.5.1.jar was not produced.' }
Copy-Item $MemoryJar (Join-Path $MemoryLibEngine 'aicompanion-memory-0.5.1.jar') -Force
Copy-Item $MemoryJar (Join-Path $MemoryLibMod 'aicompanion-memory-0.5.1.jar') -Force

Invoke-Gradle (Join-Path $AI 'engine') $Java21Home @('clean','build')
$PlayerEngineJar = Join-Path $AI 'engine/fabric/build/libs/playerengine-fabric-1.21.11-1.0.46.jar'
if (-not (Test-Path $PlayerEngineJar)) { throw 'Expected PlayerEngine Fabric 1.21.11 jar was not produced.' }
Copy-Item $PlayerEngineJar (Join-Path $MemoryLibMod 'PlayerEngine-1.21.11-1.0.46.jar') -Force

Invoke-Gradle (Join-Path $AI 'aicompanion') $Java21Home @('clean','build')
$ModJar = Join-Path $AI 'aicompanion/build/libs/aicompanion-0.4.0+mc1.21.11.jar'
if (-not (Test-Path $ModJar)) { throw 'Expected AI Companion 0.4.0+mc1.21.11 jar was not produced.' }
$hash = (Get-FileHash $ModJar -Algorithm SHA256).Hash
Write-Host "AI Companion JAR built: $ModJar"
Write-Host "SHA256: $hash"
Write-Host 'No live Minecraft gameplay or acceptance test was run by this build script.'
