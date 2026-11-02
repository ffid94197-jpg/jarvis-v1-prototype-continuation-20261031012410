# Windows Agent Arena candidate import report — 2026-11-02

**Imported:** 12 representative Windows task records from the upstream repository's 154 task JSON files. The complete upstream source is not copied into this project.

## Provenance
- Upstream: https://github.com/microsoft/WindowsAgentArena
- Revision: `eb220c4dcf64babefc1bfc287edda91ab04132ed`
- License: MIT
- License: https://github.com/microsoft/WindowsAgentArena/blob/eb220c4dcf64babefc1bfc287edda91ab04132ed/LICENSE

## Coverage
12 tasks cover Chrome, LibreOffice Calc, LibreOffice Writer, File Explorer, Edge, Notepad, Windows Settings, VLC, VS Code, Paint, Clock and Windows Calculator.

- Imported: 12
- Unique upstream IDs: 12
- Unique normalized instructions: 12
- Raw upstream evaluator objects retained: 12
- Difficulty labels: none; all remain `unrated`
- Accepted into the 200K very-hard corpus: 0

## Why candidate-only
Each record retains the original instruction, Windows snapshot name, related apps and raw evaluator JSON (including expected state or artifact references where supplied). The raw evaluator has not yet been adapted to JARVIS's independent verifier interface, and task difficulty has not been rated as `very_hard`. These records therefore cannot count toward the 200K acceptance corpus or any live task pass.

The sample spans diverse Windows applications and gives us concrete evaluator specifications to adapt next. No real third-party account actions are run from this import.
