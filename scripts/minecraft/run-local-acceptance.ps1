#requires -Version 5.1
<#
.SYNOPSIS
  Runs Minecraft tests on this Windows PC, with zero GitHub Actions minutes.
.EXAMPLE
  .\scripts\minecraft\run-local-acceptance.ps1 -Mode Stone -OwnerName YourJavaName -Port 54821
.EXAMPLE
  .\scripts\minecraft\run-local-acceptance.ps1 -Mode Full -OwnerName YourJavaName -Port 54821
  # Full live acceptance requires empty survival inventory and may take hours.
#>
[CmdletBinding()]
param(
    [ValidateSet('Offline','Code','Wood','Stone','Iron','Full')]
    [string]$Mode = 'Stone',
    [string]$OwnerName = '',
    [string]$HostAddress = '127.0.0.1',
    [ValidateRange(1024,65535)]
    [int]$Port = 25565,
    [ValidateRange(1,1000)]
    [int]$Seeds = 40,
    [switch]$SkipInstall
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$bot = Join-Path $repo 'windows-companion\minecraft-bot'
if (-not (Test-Path (Join-Path $bot 'bot.cjs'))) {
    throw "Minecraft companion sources missing: $bot"
}
$node = Get-Command 'node.exe' -ErrorAction SilentlyContinue
if (-not $node) { throw 'Install Node.js 22+ and ensure node.exe is on PATH.' }

if ($Mode -notin @('Offline','Code')) {
    $hostOk = $HostAddress -eq 'localhost'
    if (-not $hostOk) {
        try {
            $ip = [System.Net.IPAddress]::Parse($HostAddress)
            $hostOk = $ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and (
                $HostAddress -match '^127\.' -or $HostAddress -match '^10\.' -or
                $HostAddress -match '^192\.168\.' -or
                $HostAddress -match '^172\.(1[6-9]|2[0-9]|3[01])\.'
            )
        } catch { $hostOk = $false }
    }
    if (-not $hostOk) { throw 'Only numeric private IPv4 addresses or localhost are allowed.' }
    if ($OwnerName -notmatch '^[A-Za-z0-9_]{1,16}$' -or $OwnerName -ieq 'JarvisBuddy') {
        throw 'Set -OwnerName to your actual Java player username (not JarvisBuddy).'
    }
}
$keys = @('JARVIS_MINECRAFT_LAN_HOST','JARVIS_MINECRAFT_LAN_PORT',
    'JARVIS_MINECRAFT_PLAYER','JARVIS_MC_TEST_PORT','JARVIS_MC_TEST_STONE','JARVIS_MC_TEST_IRON',
    'MINECRAFT_LIVE_ACCEPTANCE','JARVIS_MC_EVIDENCE_DIR','JARVIS_MC_SIM_SEEDS')
$old = @{}
foreach ($key in $keys) { $old[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
try {
    if ($Mode -eq 'Offline') {
        [Environment]::SetEnvironmentVariable('JARVIS_MC_SIM_SEEDS', [string]$Seeds, 'Process')
        Write-Host "OFFLINE survival-rule model: $Seeds seeds (NOT Minecraft Java)"
        & $node.Source (Join-Path $bot 'verify_java_survival_campaign.cjs')
    } else {
        $module = Join-Path $bot 'node_modules\mineflayer'
        if (-not (Test-Path $module)) {
            if ($SkipInstall) { throw 'Mineflayer not installed. Retry without -SkipInstall.' }
            $npm = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
            if (-not $npm) { throw 'npm.cmd not found; install Node.js/npm.' }
            Write-Host 'Installing pinned Mineflayer dependencies locally (once)...'
            & $npm.Source ci --prefix $bot --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'Local dependency installation failed.' }
        }
        if ($Mode -eq 'Code') {
            Write-Host 'LOCAL ONLY: full Minecraft code regression; no vanilla Java server or hosted Actions.'
            & $node.Source (Join-Path $bot 'run_offline_minecraft_gates.cjs')
            if ($LASTEXITCODE -ne 0) { throw "Minecraft Code regression FAILED (exit code $LASTEXITCODE)." }
            Write-Host 'Minecraft Code regression PASSED (offline only; real game still unverified).'
            return
        }
        [Environment]::SetEnvironmentVariable('JARVIS_MINECRAFT_LAN_HOST', $HostAddress, 'Process')
        [Environment]::SetEnvironmentVariable('JARVIS_MINECRAFT_LAN_PORT', [string]$Port, 'Process')
        [Environment]::SetEnvironmentVariable('JARVIS_MINECRAFT_PLAYER', $OwnerName, 'Process')
        [Environment]::SetEnvironmentVariable('JARVIS_MC_TEST_PORT', [string]$Port, 'Process')
        Write-Host ("Using approved Minecraft Java survival server at " + $HostAddress + ":" + $Port)
        switch ($Mode) {
            'Wood' {
                [Environment]::SetEnvironmentVariable('JARVIS_MC_TEST_STONE','0','Process')
                & $node.Source (Join-Path $bot 'verify_real_java_server_wood.cjs')
            }
            'Stone' {
                [Environment]::SetEnvironmentVariable('JARVIS_MC_TEST_STONE','1','Process')
                [Environment]::SetEnvironmentVariable('JARVIS_MC_TEST_IRON','0','Process')
                & $node.Source (Join-Path $bot 'verify_real_java_server_wood.cjs')
            }
            'Iron' {
                [Environment]::SetEnvironmentVariable('JARVIS_MC_TEST_STONE','1','Process')
                [Environment]::SetEnvironmentVariable('JARVIS_MC_TEST_IRON','1','Process')
                & $node.Source (Join-Path $bot 'verify_real_java_server_wood.cjs')
            }
            'Full' {
                [Environment]::SetEnvironmentVariable('MINECRAFT_LIVE_ACCEPTANCE','1','Process')
                $evidenceDir = Join-Path $repo 'minecraft-live-evidence'
                [Environment]::SetEnvironmentVariable('JARVIS_MC_EVIDENCE_DIR',$evidenceDir,'Process')
                Write-Host 'Full live acceptance: empty survival -> real Dragon death -> End exit -> equipped Netherite.'
                Write-Host 'No creative, /give, teleport or fabricated victory.'
                & $node.Source (Join-Path $bot 'verify_real_java_full_campaign.cjs')
                Write-Host "Evidence folder: $evidenceDir"
            }
        }
    }
    if ($LASTEXITCODE -ne 0) { throw "Minecraft $Mode acceptance FAILED (exit code $LASTEXITCODE)." }
    Write-Host "Minecraft $Mode test PASSED (scope is only this test)."
} finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$old[$key],'Process') }
}
