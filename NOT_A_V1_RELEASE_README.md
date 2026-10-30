# JARVIS V1 Minecraft Pathfinder Recovery — Engineering Patch

**Status:** Development candidate; **V1 NOT COMPLETE**. No live-world victory or wood pickup has been certified.

## Confirmed source defect

- `startAction()` returned to `follow` and called `doFollow` after both success and failure.
- Manual `collect_wood` cancelled Pathfinder after 14 seconds without a useful deadline error and treated `dig()` as proof of wood collection.
- The autonomous wood path used a second navigation implementation, with the same generic stopped-path outcome.

## Changes implemented in source

1. Keep exclusive manual-action navigation, end in `stay` rather than silently following.
2. Unified wood gathering for manual and autonomous paths, multiple target candidates and bounded nearby survey.
3. Differentiate navigation timeout, external cancellation, and unexpected Pathfinder stop.
4. Verify an increase in wood logs in inventory before reporting success; no fabricated completion on `dig` alone.
5. Retry alternatives when one visible log is inaccessible, with finite time budgets.
6. `come` now uses the same navigation/arrival-verification helper.
7. Add 13 assertions for successful collection, unreachable first tree, no wood, cancellation, timeout and retained `stay` mode.

## Installation on Windows — SAFE/OPT-IN

1. Stop the running JARVIS Windows launcher and Minecraft companion bot before patching; preserve the LAN world.
2. Extract this patch ZIP to a folder on your PC.
3. From PowerShell, execute:

```powershell
& "<extracted patch folder>\APPLY_SAFE_MINECRAFT_FIX.ps1" -ProjectRoot "D:\glm 5.3\GPT6_TEST\JARVIS_V1_GPT6_MINECRAFT_AUTONOMY_2026-10-28"
```

This installer requires the exact known old source hash. If your Windows source is newer or dirty, it **refuses to overwrite anything**. Preserve and merge manually via the included unified diff. It makes a uniquely named original source backup, rolls back if affected tests fail and never touches `D:\jarvis_pc_work`.

4. Restart `npm run dev:windows` with your existing private LAN, owner username, database and Guardian settings.
5. Join the Java LAN world, send `stay`, then `collect_wood` while a tree is reachable; check `status` and inventory after the 75-second bound.
6. For PASS: independently observe the log breaking and an oak/spruce/etc log appear in JarvisBuddy inventory; otherwise capture precise failure and **do not restart the six-hour goal**.

## Evidence, limitations and release gates

- Source from archived `JARVIS_V1_NEXUS_ORB_HOME_RESTORED_FULL_SOURCE_2026-10-28.zip`.
- Original bot SHA256: `07C1831CEC99EE3DC5684FC1E0DD0607FEFACA8E8803C37B30258D8A626C42CB`.
- Patched bot SHA256: `FCC9824333E19367EB822E66B788F71794345C26F31B5CF55071005F7002647A`.
- New test SHA256: `102BE4AE901D5F6D043F904139F76424DF60EEF19A72DE49876D3885AE05FA8E`.
- The archived source may not reflect current Windows edits or connected ZCode commits.
- Offline mocks are not proof of a real Minecraft action, actual hardware webcam/microphone, LPAC certification, production BYOK or secure owner enrollment.
- Historical source manifests embedded in a full-source archive are not new release attestations; do not treat them as valid for this changed file.
- No existing login/Guardian security was relaxed.

**Full V1 acceptance remains blocked pending:** native Windows LPAC/Guardian proof, provider/credential/routing live tests, memory, screen/voice/face, multi-device/connectors, broad application control, live Minecraft Ender Dragon run, packaged install, adversarial tests, independent owner sign-off.
