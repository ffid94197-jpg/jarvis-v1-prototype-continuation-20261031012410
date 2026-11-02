# WebBench candidate import report — 2026-11-02

**Imported:** 2,647 unique original task instructions into four JSONL shards under `benchmarks/autonomy/candidates/`.

## Provenance

- Upstream: https://github.com/Halluminate/WebBench
- Revision: `ea7a1628443321363989f354401f0653e0cba6f4`
- Source file: `webbenchfinal.csv`
- Source blob SHA: `d076ef6eaafe107fb0f4b372c7aee443c0d44d8c`
- License: MIT
- License file: https://github.com/Halluminate/WebBench/blob/main/LICENSE
- License blob SHA: `b4b5f9eb63d37741a87333daa1bfd8e61f573745`
- Difficulty file: `webbench_hitl_final.csv`
- Difficulty file blob SHA: `c3849ccc93be782ca437aff9ebf6d4a994db53e8`

## Import integrity

- Raw CSV records: 2,647
- Unique upstream IDs: 2,647
- Unique normalized task prompts: 2,647
- Difficulty-labelled records: 315
- Hard-labelled records: 61
- Easy-labelled records: 254
- Unrated records: 2,332
- Starting URLs: 2,633 HTTPS and 14 legacy HTTP

## Important discrepancy

The upstream README describes 2,454 open tasks, while the current raw `webbenchfinal.csv` at the pinned revision contains 2,647 rows. The discrepancy of 193 records has not been reconciled. All 2,647 are retained as candidate source data, but none are admitted into the strict 200,000 accepted corpus until the source count and task-level inclusion status are reconciled.

## Acceptance status

**Candidate-only; zero accepted into the 200K very-hard executable corpus.**

Reasons:
- Only 61 rows are labelled `hard`; none are labelled `very_hard`.
- 2,332 records have no difficulty label.
- The task instructions do not carry a complete, machine-executable independent verifier for every record.
- Many WRITE tasks require real third-party accounts and create/update/delete side effects. They must be rehosted in authorized test accounts or deterministic local replicas before execution.
- Fourteen source tasks use legacy HTTP starting URLs; these must not be executed as-is because transport is insecure. Migrate them to authorized HTTPS replicas or exclude them from execution.

The prompts are preserved verbatim. No paraphrase, model-generated variant or synthetic record was added. The source records are useful for candidate coverage and verifier-authoring, but they do not establish any JARVIS task-success result.
