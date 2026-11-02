# Candidate public task-source catalog for the 200K programme

**State: discovery plus candidate import. WebBench's current raw CSV has been imported as 2,647 candidate records; none are accepted into the 200K corpus. See [WebBench import report](WEBBENCH_IMPORT_REPORT_2026-11-02.md). Each source must be pinned to a revision and checked against its upstream data card, LICENSE file, terms, task-level restrictions and verifier before ingestion. Counts are source-reported, not additive: datasets overlap and many tasks are not eligible as very-hard executable tasks.

| Source | Publicly reported task count | Platform / value | Eligibility notes |
|---|---:|---|---|
| Halluminate WebBench | 2,454 open-source tasks; about 5,750 candidates before pruning | 452 websites; READ and write workflows | GitHub source reports 2,454 tasks and a 5,750 candidate pool. Use only the open, runnable subset; inspect the upstream LICENSE and per-task access assumptions. Browser-only, not Windows desktop. |
| OSWorld 1.0 / Verified | 369 tasks | Real desktop computer-use | Apache-2.0 is reported for the upstream source. Its 43 Windows supplemental tasks have separate activation/copyright restrictions; exclude until permissions are confirmed. |
| OSWorld 2.0 | 108 long-horizon workflows | Deep multi-step desktop tasks | Very valuable for long-horizon evaluation; not a large corpus. Project reports 1.6-hour median human completion and 318 average tool calls in a cited configuration. |
| Windows Agent Arena | 154 tasks | Native Windows desktop | Candidate only. Verify current upstream data files and MIT license directly before import. |
| WebArena | 812 tasks | Browser workflows | Candidate only. Verify current source revision, license and reproducibility. |
| VisualWebArena | 910 tasks | Visual browser workflows | Candidate only. Verify current source revision, license and reproducibility. |
| GeneralAgentBench | 1,448 tasks; 197 labelled hard | Desktop / mobile / browser task catalog | Dataset card reports CC BY 4.0. Only 197 are labelled hard; hard is not automatically very_hard. The catalog lacks trajectories and independent verdict labels, so build/verify environments before acceptance. |
| WebTailBench V2 | 609 tasks | Browser computer-use | License and task-level redistribution rights must be confirmed before import. |
| BU Bench V2.1 | 200 tasks | Real web workflows with weighted rubrics | Task bundle is encrypted and maintainers explicitly ask users not to publish decrypted tasks or train on them. Do not decrypt, copy or count it unless the upstream terms explicitly authorize this use. |
| ClawBench | 283 task definitions | Browser workflows and saved traces | Apache-2.0 is reported for the task catalog. Verify each upstream source and whether task text can be redistributed. |
| Odysseys2 | 100 tasks | Real user web requests with 982 rubric checks | Excellent long-horizon/human-request cases. Verify task-download license before import. |

## What the numbers mean

The candidate sources above are measured in thousands, not 200,000. Some counts overlap, some include non-hard tasks, and some are encrypted or license-restricted. Summing the row counts would be dishonest. A strict 200,000-record Internet-original corpus cannot be claimed until the source records are downloaded from authorized upstream locations, deduplicated and provenance-verified.

The source records must remain verbatim. Any derived paraphrase, mutation, translation or parameterized expansion goes into a separate derived set and does not count toward the 200,000 Internet-original target.

## Prioritized acquisition order

1. WebBench's open 2,454-task set: inspect upstream LICENSE and pin the exact commit; import only tasks with safe reproducible browser environments and objective verifiers.
2. OSWorld 1.0 open tasks and OSWorld 2.0 long-horizon tasks: preserve Windows supplemental restrictions; build disposable desktop images.
3. Windows Agent Arena, WebArena and VisualWebArena: fetch from upstream repositories, pin revisions and confirm per-task licensing.
4. GeneralAgentBench: import only after mapping its checkpoint definitions to independent executable verifiers; do not mislabel medium/easy as very_hard.
5. WebTailBench, ClawBench and Odysseys2: obtain license/redistribution confirmation and implement their rubrics as deterministic or evidence-backed evaluators.
6. Expand with additional public coding, terminal, spreadsheet, API/tool-use and mobile/desktop benchmarks only when the task text, environment and verifier are redistributable and safe.

## Sources reviewed

- Halluminate WebBench upstream repository: https://github.com/Halluminate/WebBench
- WebBench benchmark page: https://webbench.ai/
- OSWorld 1.0: https://os-world.github.io/
- OSWorld 2.0: https://osworld-v2.xlang.ai/
- Windows Agent Arena: https://github.com/microsoft/WindowsAgentArena
- WebArena: https://webarena.dev/
- VisualWebArena: https://visualwebarena.org/
- GeneralAgentBench: https://huggingface.co/datasets/agentjudge-anon/GeneralAgentBench
- WebTailBench: https://huggingface.co/datasets/microsoft/WebTailBench
- BU Bench: https://github.com/browser-use/benchmark
- ClawBench: https://www.claw-bench.com/
- Odysseys2: https://odysseysbench.com/v2/

## Acceptance guardrail

The validator's exact 200,000 count applies only to `internet_original` records. It rejects duplicates, transformed prompts, missing license evidence, missing independent verifier specifications and any record not marked `very_hard`. A corpus of 200,000 prompt strings without 200,000 safe, independently gradable environments is a prompt collection—not proof of 200,000 completed autonomous tasks.
