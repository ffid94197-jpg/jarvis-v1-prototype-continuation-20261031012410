# Autonomous layer: verified blockers and current evidence (2026-11-02)

## Scope

Prototype JARVIS only. No changes to PC Work JARVIS or repository `main`. Work is isolated on `autonomy-100-percent-acceptance-20261102`.

## Verified current implementation facts

1. The actual Core task API is `POST /api/jarvis/task`; it streams status, step, delta, final and error events. The task route derives the owner from the active session, uses the durable task journal, calls the real Core loop, and reconstructs replay state on resume.
2. The Windows development launcher is `npm run dev:windows`. It starts NEXUS/Next.js and the private Windows companion, with loopback-only development authentication and an isolated SQLite database.
3. The local Ollama adapter is implemented in `src/lib/agent/core/modelProvider.ts`. It only accepts loopback HTTP, checks the configured installed model ID, and uses a bounded HTTP deadline.
4. The default model request deadline was 90 seconds with a maximum override of 120 seconds. This was too restrictive for slow CPU inference experiments. The isolated acceptance branch now permits an operator-configured 30–300 second deadline, default 90 seconds; `scripts/verify-model-deadline-offline.cjs` was extended to cover the new bound. This is a bounded wait, not proof that a model will answer correctly.
5. The current tool catalog in `src/lib/agent/core/prompts.ts` describes `run_command` as read-only. Guardian's command allowlist in `src/lib/agent/guardian/policy.ts` permits only `pwd,date,whoami,node -v,bun -v,echo,ls,cat,wc,sleep`. There is no authorized package-install/build/test command in this catalog. Therefore JARVIS cannot currently satisfy the TVS instruction to install dependencies, run a build and fix build errors using its own approved tools. An external test harness running the build after JARVIS stops would verify the artifact, but it would NOT prove autonomous build execution.
6. The TVS Motor source prompt is pinned in `benchmarks/autonomy/fixtures/tvs-motor-original-3954.txt` (3,954 Unicode characters including the two terminal newline characters preserved from the source text). Source: https://prompts.chat/prompts/cmuz5u62d0004l904ys2nmj7u_premium-tvs-motor-digital-showroom-website. The prompt must not be paraphrased or modified during the fixed regression.
7. No 200,000-record corpus is present in the repository. The new validator and CI gates are infrastructure only; they do not create or claim the existence of the corpus.

## Benchmark source reality

- OSWorld 1.0 / Verified lists 369 tasks; its page separately identifies 43 supplemental Windows tasks subject to activation/copyright restrictions. It is not a 200k task source.
- OSWorld 2.0 lists 108 long-horizon workflows. The project reports median human completion around 1.6 hours, 69.6% of tasks taking skilled users over one hour, and an average of 318 tool calls in the cited Claude Opus 4.7 setup. Its published best reported configuration reaches 20.6% binary completion at 500 steps.
- These official benchmark sizes mean a 200k corpus must be assembled from many independent public datasets. It cannot be honestly produced by duplicating 108/369 tasks or counting model-generated variants as Internet-original prompts.

## Critical missing capability before live acceptance

A new Guardian-authorized, workspace-scoped project build/test capability is needed. It must:
- run only inside a disposable, least-privilege sandbox with no inherited secrets;
- accept only a small structured action set (dependency install, build, tests, start/stop preview), never arbitrary shell text;
- verify the target path is inside the configured workspace and reject symlinks/path traversal;
- cap runtime, CPU, memory, output, network access and child processes;
- register all child processes to the task so cancellation/E-stop actually terminates them;
- emit receipts containing exit code, bounded stdout/stderr, artifact hashes and independent postcondition evidence;
- require Guardian approval for network dependency downloads or external writes;
- never mark a task completed solely because a command returned exit code 0.

Do not weaken the existing read-only `run_command` policy to allow arbitrary `npm`, PowerShell or shell execution. A safe build adapter is a separate capability and needs its own security tests.

## Current live test status

The real Ollama workflow is configured to run on a disposable native Windows GitHub runner using the actual configured model, real Core/Guardian/companion, exact TVS prompt, actual task API, real workspace writes, and an independent build/preview verifier. Its result must be read from its workflow run and artifact; workflow creation alone is not a pass.

The live TVS test passes only if:
- Ollama reports the configured model installed and answers a real HTTP inference probe;
- the actual Core emits at least one real tool-call event;
- Core reports completed;
- a complete React/Vite project is found in the authorized workspace;
- the independent harness installs dependencies and builds successfully;
- the built site starts and returns HTTP 200.

This currently proves only an end-to-end website artifact if all gates pass. It does not alone prove six milestone completion or universal autonomy.

## Corpus integrity gate

`scripts/autonomy/validate-internet-corpus.cjs` requires exactly 200,000 unique `internet_original` records, each with source URL, dataset URL, revision, SPDX license ID/URL, exact raw-prompt SHA-256, `very_hard` difficulty, environment setup reference and independent verifier specification. Derived/generated variants are explicitly excluded from the original count.

The validator is schema/provenance hygiene, not execution. Each corpus task still needs execution in a suitable environment and independent outcome scoring. The sealed holdout must not be used for prompt or code tuning.

## Release truth

No six-milestone 100% claim is permitted until each gate has its own evidence. Zero critical safety violations are mandatory. A finite benchmark can establish measured performance on that corpus; it cannot prove human-equivalent cognition or guarantee success on every possible task.
