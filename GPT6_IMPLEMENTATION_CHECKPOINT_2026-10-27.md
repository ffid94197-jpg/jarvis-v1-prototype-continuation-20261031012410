# GPT-6 JARVIS V1 implementation checkpoint — 2026-10-27

**Release status: NOT COMPLETE / NOT WINDOWS-NATIVE CERTIFIED.**

This is a consolidated *development source candidate* based on the latest available GPT-6 consolidated source from the user's earlier GLM Track B export. It was not merged with the unseen newer live ZCode AR-9 files and must not overwrite those changes blindly.

## Actual new code in this checkpoint

1. **Opt-in owner-managed persistent memory and World Model foundation:** `JarvisMemory` and `JarvisWorldObservation` Prisma models, per-principal data isolation, provenance, expiry/staleness, soft retraction and API input validation. Users' reported world state cannot claim `VERIFIED_TOOL` provenance. Memory remains private to the owner and is **not automatically sent to any model**.
2. **Text Mode MEMORY manager:** a new nested view in the assistant panel for saving, viewing and retracting owner memory and user-reported observations. The Orb Mode contract is unchanged.
3. **Trust boundary repair:** independent completion verifier calls the same realpath containment gate as Guardian before inspecting files and refuses symlink escapes (this is not race-free isolation).
4. **Explicit local quota fallback:** when `JARVIS_MODEL_BACKEND=zai`, setting `JARVIS_OLLAMA_FALLBACK=1` and a valid local `JARVIS_OLLAMA_MODEL` permits a one-way local Ollama fallback on an inference 429. It never silently falls back to another cloud provider and never mixes partial streams.
5. **Windows-portable start/build scripts:** Node/Next commands replace Unix `cp`, `tee`, and Bun reliance. Not evidence of LPAC security.

## Tests actually executed in this environment

- `verify-provider-offline.cjs`: 12/12 PASS (existing fixture checks).
- `verify-memory-contracts.cjs`: 15/15 PASS (new pure-input contract tests).
- `verify-memory-route.cjs`: 12/12 PASS (isolated API mock, NOT live Prisma).
- `verify-local-fallback.cjs`: 6/6 PASS (offline simulated quota and streams).
- `verify-path-containment.cjs`: 4/4 PASS (real temporary filesystem with outward symlink).
- Portable standalone copier: 1 fixture PASS, does not test Next.js build.
- TypeScript/TSX parser: 88 source files, 0 syntax diagnostics. This is **not** a TypeScript type check.
- Script syntax: `node --check` on the five modified/new Node scripts succeeded.

## NOT TESTED / BLOCKED

- `npx prisma generate`, migration, and live DB route behavior (project dependencies absent).
- Next.js `npm run build`, lint, full typecheck, production start and real browser/NEXUS integration (project dependencies absent).
- Actual Ollama or Z.ai provider call (no authorized model/credentials in this container).
- Windows-native LPAC/RLM process, Guardian integration/certification and multi-app/game control.
- Live microphone, camera, YuNet/SFace, sherpa-onnx, MediaPipe, screen video, multi-device pairing.
- Complete memory integration with trusted tool observation and user-approved model retrieval.
- All other V1 final acceptance gates, including clean native install/upgrade, security audit, and hardware performance.

## Next safe integration and acceptance steps

1. Compare this candidate with the **actual live ZCode workspace**. Merge surgically; newer code always requires conflict review.
2. In a backed-up disposable database, run the exact Prisma migration/`prisma generate`; verify no existing sessions or tasks are destroyed.
3. Install the repository's reviewed dependencies with the appropriate locked package manager. Run lint, typecheck, full tests and Next.js production build.
4. Test owner memory management in an authenticated browser against real Prisma, including foreign-user rejection, deletion and stale World Model records.
5. Test local Ollama failover from an actual 429 model error. The local server means the computer running JARVIS, not the remote browser's PC.
6. Complete the Windows-native protected execution architecture and run native negative security probes on the actual target hardware.
7. Complete the rest of the V1 requirements from the master acceptance specification; only assert final release success after every mandatory gate passes.

**Do not present this candidate as finished JARVIS V1.**
