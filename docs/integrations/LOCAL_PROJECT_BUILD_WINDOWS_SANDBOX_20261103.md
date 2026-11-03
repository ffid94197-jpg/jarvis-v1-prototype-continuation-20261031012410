# Local project build — Windows Sandbox adapter

## Purpose

Replace the old GitHub-Actions-only ci_project_build experiment with a local-only local_project_build tool. Project-controlled npm lifecycle/build scripts must never run directly in the JARVIS server process or through the read-only run_command allowlist.

This adapter is for the secondary Prototype JARVIS track only. It does not change PC Work JARVIS.

## Admission and authority

- Every request passes through the existing Guardian.
- An authenticated owner is required.
- The owner must explicitly set JARVIS_LOCAL_PROJECT_BUILD_ENABLED=1 in the local JARVIS process environment.
- Only a concrete workspace-relative project directory is accepted.
- The project must contain a regular package.json, a regular package-lock.json (lockfileVersion 1–3), and a bounded scripts.build command.
- The host must be Windows and WindowsSandbox.exe must be installed.
- The adapter denies CI execution and has no direct-process fallback.
- The action is in the durable EFFECTFUL_TOOLS journal. An unsettled build is not blindly replayed.

## Isolation model

1. Guardian resolves the project within WORKSPACE_ROOT.
2. The host rechecks the package and lockfile hashes, then copies a bounded source snapshot. It rejects symbolic links, reparse points, hard-linked files, unsafe Windows names, and non-regular files.
3. The snapshot excludes .git, node_modules, previous build outputs, .env*, .npmrc, credential directories, private keys, databases and common secret/config files.
4. JARVIS stages a copy of its Node executable, npm CLI package and npm content cache. No application environment variables, API keys, database URLs, companion tokens or provider credentials are forwarded to the guest.
5. Windows Sandbox is launched with:
   - Networking disabled
   - Clipboard, printer, audio and video redirection disabled
   - vGPU disabled
   - Protected Client enabled
   - 4096 MB guest memory
   - Source, runtime and cache mapped read-only
   - Only one run-scoped output folder mapped writable
6. Inside the disposable guest, JARVIS runs npm ci --offline --include=dev with NODE_ENV=development, then sets NODE_ENV=production and runs npm run build. No external network is available. Package lifecycle scripts and project build code execute only inside the guest.
7. Guest and host quotas bound source size, npm cache size, runtime size, file and directory counts, working-tree size, output size and elapsed time. Cancellation attempts to terminate the Windows Sandbox process tree. If shutdown cannot be confirmed, the result is outcomeUnknown and staging is retained rather than replayed.
8. The host rejects output reparse points and unsafe filenames, independently copies and hashes the artifact tree, and writes a host-generated build-receipt.json inside the project’s .jarvis-build-results/<runId>/ directory.

Supported artifact markers are .next/BUILD_ID, dist/index.html, build/index.html, and out/index.html. A zero exit code without one of these markers is not a successful build.

## Important limitations

- Requires Windows Sandbox support on the host (normally Windows Pro, Enterprise or Education with the Windows Sandbox optional feature enabled).
- Requires the Node installation to include its npm CLI under node_modules/npm.
- Dependencies must be available in the host npm content cache. Installation is offline by design; missing cached packages cause a truthful build failure, not a network fallback.
- This is an OS-level disposable VM boundary for prototype use. It is not the same as the JARVIS Phase 6 LPAC/AppContainer boundary and is not a production security certification.
- The guest build process and trusted bootstrap share the Windows Sandbox guest account. The run-scoped writable output mapping is visible to guest build code, not only the bootstrap. A malicious build script could alter files or guest-reported status in that mapping. The host treats all guest output and status as untrusted, validates path types/counts/bytes, independently hashes the copied artifact, and never executes, publishes or deploys it. The receipt is a host observation of copied bytes, NOT a cryptographic attestation that the declared build command was honest.
- Windows Sandbox logon commands run as the guest account, which should be an administrator account. This is a disposable VM boundary, not a least-privilege per-process sandbox. Do not use this adapter for hostile multi-tenant code or as release certification.
- Windows documents that writable mapped-folder changes persist to the host and can be affected by sandbox apps. Only the run-scoped output folder is writable; source/runtime/cache are read-only. See [Microsoft's Windows Sandbox configuration guidance](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file).
- The guest can read the staged project and staged npm cache. Although common secrets are excluded and host credentials are not forwarded, the owner should review build artifacts before sharing them.

## Verification

TypeScript check and offline contracts (no Windows Sandbox launch, no GitHub Actions):

npm run typecheck
npm run test:local-project-build-offline

Real owner-PC fixture acceptance (starts and shuts down a disposable Windows Sandbox, uses a no-dependency fixture, does not build the owner’s application):

npm run test:local-project-build-windows-live

To enable the capability in the local JARVIS process, set:

JARVIS_LOCAL_PROJECT_BUILD_ENABLED=1

No GitHub Actions workflow is required or dispatched.
