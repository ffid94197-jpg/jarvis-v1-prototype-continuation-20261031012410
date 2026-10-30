# JARVIS V1 — Overall Agent Simulation and Corrections

Source: `JARVIS_V1_GPT6_MCP_STRESS_FIXED_FULL_SOURCE_2026-10-28.zip`, extracted into a disposable test copy. Changes were made only to this copy, never to the protected Track A source.

## What changed

1. **Task misclassification fixed.** `categoryOf()` previously treated `app` as an arbitrary substring, so "Compare apple and banana nutrition" or "Research Appalachian trails" was routed as a Windows desktop task. The planner now matches whole-word `app/apps/application/applications` instead.
2. **Future routine time corrected.** `nextSchedule()` skipped the first requested run if called before the routine's start time. It now returns the first scheduled instant in that case, validates timestamps, and keeps the existing catch-up behavior for overdue schedules.
3. **Biometric test portability corrected.** The missing-model test assumed real face and Vosk weights were absent. The negative test now explicitly directs its model lookup to a deliberately empty fixture directory, so installing actual models on Windows does not cause a false regression failure. This changes the test, not the biometric recognition engine.
4. **New cross-subsystem property suite.** `scripts/overall/verify-overall-workflows.mjs` checks task classification, 30,000 task/recovery scenarios, 30,000 schedule properties, and 2,000 randomized graph problems against an independent reference. It makes no real Windows actions or live LLM calls.

## Verified results

- Pre-fix original-source baseline: **96/96 test-script runs passed** over 3 rounds × 32 suites; these tests did not cover the two discovered production defects.
- Corrected-source regressions: **96/96 test-script runs passed** over 3 rounds × 32 suites. The third round's remaining 12 scripts were completed in a separate bounded run after a container command interruption; all logged pass. No interrupted work is counted as passed.
- Total repeated script runs: **192/192 passed** across original and patched versions.
- Additional cross-system simulation: **30,000/30,000 scenarios**, **30,000 schedule checks**, and **2,000 graph test cases** passed; 273,294 assertions total.
- Each of six rounds included the planner's 50,000-decision synthetic check (300,000 deterministic planning decisions total; these are *not* autonomous task completions).
- Three baseline plus three post-fix rounds included real localhost modern/legacy MCP JSON-RPC traffic. Other MCP servers and tools are synthetic fixtures.
- Parsed source syntax: 159 JavaScript/TypeScript files and 19 Python files, no parse errors.
- Source ZIP and evidence ZIP verified with ZIP CRC checks and a new SHA-256 manifest.

## Not proved here

This test host is Linux. There is no actual Windows desktop/Guardian companion, live camera or microphone, Minecraft LAN player, installed real Piper/SFace/ECAPA/Vosk inference weights, or authenticated user model/API credentials. No complete Next.js production build or full Prisma-backed scheduler lifecycle was performed because project dependencies were not installed in this sandbox. The mock AI model and MCP server results are not evidence of actual third-party provider connectivity.

**Verdict:** Corrected-source *offline and localhost simulated suite PASS*. End-to-end autonomous JARVIS V1 on Windows remains **NOT VERIFIED**. This test does not certify that arbitrary PC tasks or games are autonomously controllable.

## Windows rerun

From the project root with Node, Python recognition dependencies, and installed development dependencies available:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN_OVERALL_AGENT_TESTS.ps1 -Rounds 3 -CrossCases 5000
bunx tsc --noEmit
bun run lint
bun run build
```

Passing those commands does not replace live Windows app-control, end-to-end Gemini/local model, actual audio/camera, and real Minecraft LAN acceptance tests.
