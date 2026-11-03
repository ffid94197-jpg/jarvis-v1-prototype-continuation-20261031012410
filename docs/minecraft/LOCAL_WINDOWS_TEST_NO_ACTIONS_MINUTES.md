# Minecraft testing without GitHub Actions minutes

**Status:** Full real-world Minecraft Java survival completion remains NOT ACCEPTED. The confirmed vanilla Java 1.21.1 smoke test passed an empty-inventory start and actual wood gathering. The stone-stage drop-pickup correction still needs a real Java retest.

## No more automatic hosted-runner jobs

The two Minecraft workflows on this isolated branch are now MANUAL-ONLY. Neither push nor pull_request events can start these workflows from this branch. Do not manually dispatch GitHub-hosted jobs until the repository owner explicitly reauthorizes GitHub Actions spending. No changes were made to the PC Work JARVIS worktree.

Instead, the Windows PowerShell runner below invokes Node.js and Mineflayer directly on your PC. Direct execution consumes **zero GitHub Actions minutes**, although it uses local CPU, game memory, electricity, and network access.

## Prerequisites

1. Windows PC with Node.js 22+ and npm installed. The local script installs locked Mineflayer dependencies only if missing.
2. Minecraft Java Edition survival world (ideally a dedicated disposable world). Open to LAN from Java Minecraft and note the LAN port shown in game, or start a trusted localhost private Java survival server. Do not use Creative mode, give commands, teleports, or operator-assisted progression for acceptance.
3. Run from a clean, isolated checkout or extracted copy of prototype branch fix/minecraft-live-survival-bridge-20261102, never your dirty primary PC Work JARVIS.
4. Use the real Java player username as OwnerName. The bot joins separately as JarvisBuddy. The full test requires its starting inventory to be **empty**.

## Commands (from prototype repository root in PowerShell)

First, validate the previously failed real-world stone progression:

    .\scripts\minecraft\run-local-acceptance.ps1 -Mode Stone -OwnerName YOUR_JAVA_USERNAME -Port YOUR_LAN_PORT

For the optional cheap deterministic survival-rule simulation (NOT real Java gameplay):

    .\scripts\minecraft\run-local-acceptance.ps1 -Mode Offline -Seeds 40

For the actual live empty-survival wood test only:

    .\scripts\minecraft\run-local-acceptance.ps1 -Mode Wood -OwnerName YOUR_JAVA_USERNAME -Port YOUR_LAN_PORT

When the stone stage and subsequent real-world blockers pass, run full genuine acceptance:

    .\scripts\minecraft\run-local-acceptance.ps1 -Mode Full -OwnerName YOUR_JAVA_USERNAME -Port YOUR_LAN_PORT

Defaults to localhost. For an approved private LAN server, pass -HostAddress 192.168.x.y. Arbitrary Internet addresses are refused. The full run may use up to six hours; its honest outcome and stored evidence are written into minecraft-live-evidence in the isolated prototype checkout.

## Acceptance

- Simplified synthetic survival campaign: previous 2,000/2,000 seeded simulations passed; **not Minecraft Java**.
- Actual vanilla Java survival: empty inventory -> real wood PASS in GitHub run 41400409789.
- Actual Java stone: FAILED in run 41400699785 because stone drops were not picked up. Updated bounded pickup logic is awaiting validation.
- Final full Java acceptance: **NOT PASSED**. Requires one autonomous real-world episode from empty survival inventory, actual Ender Dragon death in the End, End exit, and only afterward all four Netherite armor pieces physically equipped in the Java server. Unproven drops, unknown tools, partial runs, timeouts, game-mode mismatch, or fabricated receipts must fail.

Do not mark the release as finished based on simulation or code compilation.

## GitHub and security

See the repository owner's GitHub Settings -> Billing and licensing -> Usage for billing details. Current official GitHub documentation says self-hosted runners are free, but using this direct PowerShell workflow avoids GitHub Actions scheduling/billing altogether. Do not install a permanent self-hosted GitHub Actions runner on your personal PC to execute arbitrary unreviewed pull requests. Such a runner could execute malicious code. If needed, use a dedicated disposable machine with explicit owner authorization.
