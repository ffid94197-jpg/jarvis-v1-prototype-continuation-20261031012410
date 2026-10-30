param([ValidateRange(1,100)][int]$Rounds = 12)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
for ($i=1; $i -le $Rounds; $i++) {
  Write-Host "Minecraft autonomy test round $i/$Rounds"
  node .\windows-companion\minecraft-bot\verify_friend_offline.cjs
  if ($LASTEXITCODE -ne 0) { throw "Friend simulation failed on round $i" }
  node .\windows-companion\minecraft-bot\verify_autonomous_gameplay.cjs
  if ($LASTEXITCODE -ne 0) { throw "Gameplay decision stress failed on round $i" }
  node .\windows-companion\minecraft-bot\verify_autonomy_session.cjs
  if ($LASTEXITCODE -ne 0) { throw "Crafting session failed on round $i" }
  node .\windows-companion\minecraft-bot\verify_late_game.cjs
  if ($LASTEXITCODE -ne 0) { throw "Late-game mission planner failed on round $i" }
  node .\windows-companion\minecraft-bot\verify_late_skills.cjs
  if ($LASTEXITCODE -ne 0) { throw "Smithing/equipment mock integration failed on round $i" }
}
node .\scripts\verify-minecraft-bridge-policy.cjs
if ($LASTEXITCODE -ne 0) { throw 'TypeScript Minecraft Guardian bridge failed' }
python .\windows-companion\verify_minecraft_gateway_offline.py
if ($LASTEXITCODE -ne 0) { throw 'Python Minecraft LAN gateway failed' }
python -m py_compile .\windows-companion\companion.py
if ($LASTEXITCODE -ne 0) { throw 'Companion syntax error' }
Write-Host "PASS $Rounds rounds — mock tests only; real Minecraft LAN acceptance pending"
