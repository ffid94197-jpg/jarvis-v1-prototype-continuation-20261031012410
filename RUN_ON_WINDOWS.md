# Windows integration prerequisites (operator action)

1. Use **only** the isolated GLM Track B folder. Do not overwrite `D:\jarvis_pc_work`.
2. Audit this source against the current LIVE ZCode workspace first. Prefer newer
   working code; this ZIP is not a safely mergeable source-of-truth for AR-9.
3. Install dependencies from the reviewed lockfile in a disposable clone. Avoid
   reusing databases with credentials or historical user tasks.
4. Set operator-owned `.env` values privately (never put secrets in chat or Git).
5. Run `npm run test:provider-offline`, `npm run lint`, a TypeScript check,
   `npm run build`, relevant Guardian/auth/effect tests, then live NEXUS E2E.
6. Confirm real LPAC worker token, IPC, resource and network denials on the
   Windows host; if not available, mark Windows certification BLOCKED.
7. Run independent native install/upgrade/rollback tests before any release.

There is no shortcut from this source tree to a 100% certified V1.


## GPT-6 2026-10-27 portable build changes

- `npm run dev` now uses `next dev -p 3000` without Unix `tee`.
- `npm run build` invokes Next.js and uses a Node asset copier instead of Unix `cp`.
- `npm run start` invokes `node .next/standalone/server.js` without Bun.
- The database schema has new `JarvisMemory` and `JarvisWorldObservation`
  models. On a **separate backup/test database only**, run `npx prisma
  generate` then a reviewed schema migration (`prisma migrate dev` or `db push`
  only for disposable test DB). Do not reset a live user database.
- Memory is owner-managed via the TEXT MODE MEMORY control. This is **not**
  automatic model retrieval or cloud memory sharing.
- `JARVIS_OLLAMA_FALLBACK=1` (only when primary backend is `zai`) enables
  one-way, opt-in local-only quota fallback. Set `JARVIS_OLLAMA_MODEL` to a
  locally installed model and run Ollama **on the same host as the server**.
  A remote browser's localhost is not the same machine as cloud ZCode's server.
- Full acceptance still requires the real Windows-native LPAC/RLM supervisor,
  audit/Guardian probes, and real device tests.


## Application control update

Keep your existing `.env`, DB, Gemini key, Playwright install, and app state. After installing the app-control overlay, test `Open Windows Settings`, `Open Chrome`, and `List the approved apps`. Use `WINDOWS_APP_CONTROL.md` for local custom-app approvals; no full reinstallation is required. Run `bun run test:agent-tools-offline` and the previous full build/typecheck/lint gates before live tests.
