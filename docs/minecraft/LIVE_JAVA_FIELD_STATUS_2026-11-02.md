# Minecraft Java live acceptance — 2026-11-02

## Outcome (no simulated passes accepted as Java evidence)

**FULL DRAGON-FIRST → FULL NETHERITE JAVA SURVIVAL: NOT ACCEPTED.**

This is a historical field-status snapshot. The local acceptance runner and evidence documentation are now included on Prototype JARVIS `main`; this does not certify the runtime or merge unaccepted Minecraft changes. The primary PC Work JARVIS remains separate and untouched.

## Grounded real Java server evidence

- [41399296801](https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/actions/runs/41399296801): genuine Mojang vanilla Java 1.21.1 server started; Mineflayer joined as a separate survival player from empty inventory. **FAILED** wood discovery/route on seed 20261102; no logs acquired.
- [41399840139](https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/actions/runs/41399840139): alternate forest seed 41902 found and physically dug real wood but dropped items did not reach inventory. **FAILED** honest item pickup proof, not a victory.
- [41400409789](https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/actions/runs/41400409789): bounded Pathfinder item-drop recovery fixed. **PASS** independent Mineflayer Java server survival connection, empty spawn inventory, physical log collection and observed inventory gain. No commands, creative-mode or /give.
- [41400699785](https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/actions/runs/41400699785): extended actual Java test passed the wood stage and constructed wooden pickaxe/crafting table, but **FAILED** stone stage: stone mined, cobblestone dropped, inventory did not increase; controller honestly blocked after three attempts.
- Patch `d95f8663f9a50e6977427783984b329d070c381a`: applied a common bounded physical drop-pickup / server inventory verification helper to stone, iron and diamond (similar to validated wood fix). This is **not validated** in a real run yet.
- [41401104714](https://github.com/kolarume774-design/jarvis-v1-prototype-continuation-20261031012410/actions/runs/41401104714): first and retried GitHub Actions jobs returned **failure with no steps/logs**. This is not interpretable as a gameplay test result. Runner/billing/account configuration may need investigation; do not invent the cause.

## Engineering changes

- `dragon_then_netherite_run` long-goal duration and survival-mode admission wired into real Mineflayer bot.
- Fresh server-observed dragon-death evidence on each new mission; no reuse of earlier dragon proof.
- Field smoke with actual official Mojang checksum-verified server and independent Java protocol player.
- Bounded real item-drop recovery for wood, stone, iron, and diamond. No inventory increase means FAIL.
- `verify_real_java_full_campaign.cjs` fail-closed acceptance harness: requires **empty initial inventory**, actual survival mode, owner-authorized single Dragon-first autonomous mission, in-End Dragon entity-death and exit milestones, later server-backed full Netherite equipment, and final Overworld readback. Results are persisted to local JSON evidence with a digest. **This full harness has not passed**.

## Remaining mandatory live acceptance

1. Restore a functional CI runner or authorized native Java server and rerun the **stone** fixture from PR8 HEAD.
2. Resolve subsequent real-world iron/diamond, Nether portal, resource, bastion template, smithing, stronghold, Dragon combat, End exit, durability, death/cancel/replan problems as they are observed. No scripted model world can substitute.
3. Run the full one-instruction real Java survival campaign with the new strict harness. **PASS ONLY** if the actual Dragon is defeated first and four Netherite armor pieces are subsequently worn, with independently observable live proof; all other outcomes are NOT ACCEPTED.

The earlier **2,000 / 2,000 model campaigns** were synthetic survival-rule scenarios, not a vanilla Java Edition game or LAN acceptance.
