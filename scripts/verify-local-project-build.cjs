#!/usr/bin/env node
'use strict';
/** Offline source/contract tests. Does not launch Windows Sandbox or execute project code. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/lib/agent/tools/localProjectBuild.ts');
const source = fs.readFileSync(file, 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: file,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;
const fakeWorkspace = path.join(os.tmpdir(), 'jarvis-local-build-offline-workspace');
const moduleBox = { exports: {} };
const mocks = {
  '../guardian/policy': {
    WORKSPACE_ROOT: fakeWorkspace,
    resolveScopedPath: () => ({ ok: false, reason: 'offline test stub' }),
    assertWithinRoot: async () => ({ ok: false, reason: 'offline test stub' }),
  },
};
const requireInside = (id) => Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : require(id);
vm.runInNewContext(compiled, {
  module: moduleBox,
  exports: moduleBox.exports,
  require: requireInside,
  process,
  Buffer,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
}, { filename: file, timeout: 12000 });
const api = moduleBox.exports;
let passed = 0;
function check(value, label) {
  assert.ok(value, label);
  passed++;
  console.log('PASS', label);
}

(async () => {
  const malformed = await api.prepareLocalProjectBuild(null);
  check(malformed.ok === false && /JSON object/.test(malformed.reason || ''),
    'malformed tool arguments fail closed without throwing');
  check(api.isExcludedProjectPath('node_modules/react/index.js'), 'node_modules excluded from source snapshot');
  check(api.isExcludedProjectPath('.git/config'), 'Git metadata excluded from source snapshot');
  check(api.isExcludedProjectPath('.env.production'), 'environment secrets excluded');
  check(api.isExcludedProjectPath('.npmrc'), 'npm auth/config excluded');
  check(api.isExcludedProjectPath('credentials/service-account.json'), 'credential directories excluded');
  check(api.isExcludedProjectPath('.jarvis-build-results/run/artifact/index.html'), 'prior build outputs excluded');
  check(!api.isExcludedProjectPath('src/index.ts'), 'ordinary project source retained');
  check(!api.isExcludedProjectPath('package-lock.json'), 'locked dependency manifest retained');

  check(api.isSafeSandboxEntryName('src-file.ts'), 'ordinary filename accepted');
  check(!api.isSafeSandboxEntryName('..'), 'parent traversal filename rejected');
  check(!api.isSafeSandboxEntryName('C:secret.txt'), 'alternate data stream filename rejected');
  check(!api.isSafeSandboxEntryName('CON.txt'), 'Windows device filename rejected');
  check(!api.isSafeSandboxEntryName('trailing.'), 'trailing-dot filename rejected');

  const config = api.createWindowsSandboxConfig({
    input: 'C:\\JARVIS\\stage\\input',
    tools: 'C:\\JARVIS\\stage\\tools',
    cache: 'C:\\JARVIS\\stage\\cache',
    output: 'C:\\JARVIS\\stage\\out&put',
  });
  check(config.includes('<Networking>Disable</Networking>'), 'Windows Sandbox networking disabled');
  check(config.includes('<ClipboardRedirection>Disable</ClipboardRedirection>'), 'clipboard redirection disabled');
  check(config.includes('<ProtectedClient>Enable</ProtectedClient>'), 'Protected Client enabled');
  check(config.includes('<MemoryInMB>4096</MemoryInMB>'), 'sandbox memory bounded');
  check((config.match(/<ReadOnly>true<\/ReadOnly>/g) || []).length === 3, 'input/runtime/cache mappings read-only');
  check(config.includes('<ReadOnly>false</ReadOnly>'), 'only run-scoped output mapping writable');
  check(config.includes('out&amp;put'), 'host paths XML escaped');

  const guest = api.createWindowsSandboxGuestScript();
  check(guest.includes("'--offline', '--cache'") && guest.includes("'ci'"), 'dependency install is offline');
  check(guest.includes("'--include=dev'") && guest.includes("$env:NODE_ENV = 'development'") &&
    guest.indexOf("$env:NODE_ENV = 'production'") > guest.indexOf("'ci', '--include=dev'"),
    'development dependencies installed before production build environment');
  check(guest.includes("'run', 'build'"), 'only declared npm build script executed');
  check(guest.includes('Get-TreeStats') && guest.includes('2147483648') &&
    guest.includes('$directories.Count -gt 50000') && guest.includes('$stats.directories -gt 25000'),
    'guest worktree and artifact file/directory quotas enforced');
  check(source.includes('bounded directory quota') && source.includes('directories: number'),
    'host source and output traversal enforce directory quotas');
  check(guest.includes('Stop-Tree') && guest.includes('shutdown.exe'), 'guest process tree and VM shutdown handled');
  check(source.includes('MAX_ARTIFACT_BYTES = 512') && source.includes('MAX_OUTPUT_BYTES = 520'),
    'artifact quota leaves bounded room for host result metadata');
  check(source.includes('Build cancelled during file snapshot') &&
    source.includes('Build cancelled during artifact hashing'),
    'cancellation is checked during staging and artifact verification');
  check(source.includes('copied.directories !== stats.directories'),
    'host artifact copy is compared for file, directory and byte counts');

  const previous = process.env.JARVIS_LOCAL_PROJECT_BUILD_ENABLED;
  process.env.JARVIS_LOCAL_PROJECT_BUILD_ENABLED = '0';
  const denied = await api.prepareLocalProjectBuild({ project: 'fixture' });
  check(denied.ok === false && /disabled|Windows host|interactive Windows/.test(denied.reason || ''),
    'build preparation fails closed without explicit owner opt-in');
  if (previous === undefined) delete process.env.JARVIS_LOCAL_PROJECT_BUILD_ENABLED;
  else process.env.JARVIS_LOCAL_PROJECT_BUILD_ENABLED = previous;

  const design = fs.readFileSync(path.join(root, 'docs/integrations/LOCAL_PROJECT_BUILD_WINDOWS_SANDBOX_20261103.md'), 'utf8');
  check(source.includes('signed build attestation') &&
    design.includes('NOT a cryptographic attestation') &&
    design.includes('visible to guest build code'),
    'guest writable output is explicitly treated as untrusted, non-attested data');

  const guardian = fs.readFileSync(path.join(root, 'src/lib/agent/guardian/guardian.ts'), 'utf8');
  const executor = fs.readFileSync(path.join(root, 'src/lib/agent/tools/executor.ts'), 'utf8');
  const effects = fs.readFileSync(path.join(root, 'src/lib/agent/core/effects.ts'), 'utf8');
  const prompts = fs.readFileSync(path.join(root, 'src/lib/agent/core/prompts.ts'), 'utf8');
  const gates = fs.readFileSync(path.join(root, 'scripts/verify-v1-gates.mjs'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  check(guardian.includes('"local_project_build"') && guardian.includes('prepareLocalProjectBuild'),
    'Guardian owns local build authorization');
  check(guardian.includes('Authenticated owner required for local project build'),
    'authenticated owner required');
  check(executor.includes('executeLocalProjectBuild') && executor.includes('registerChild(taskId, child)'),
    'executor registers sandbox process for cancellation');
  check(effects.includes('"local_project_build"') && !effects.includes('"ci_project_build"'),
    'local build participates in durable journal-before-effect');
  check(prompts.includes('local_project_build') && prompts.includes('never fall back'),
    'planner receives bounded local-only build contract');
  check(pkg.scripts['test:local-project-build-offline'] === 'node scripts/verify-local-project-build.cjs',
    'offline test command registered');
  check(pkg.scripts['test:local-project-build-windows-live'] === 'node scripts/verify-local-project-build-windows-live.cjs',
    'manual Windows Sandbox acceptance command registered');
  check(gates.includes('LOCAL-PROJECT-BUILD-OFFLINE') && gates.includes('scripts/verify-local-project-build.cjs'),
    'offline contract test wired into V1 release gate');

  console.log('LOCAL_PROJECT_BUILD_OFFLINE ' + passed + '/' + passed + ' PASS (static contracts and pure helpers only)');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
