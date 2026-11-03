#!/usr/bin/env node
'use strict';
/**
 * REAL Windows-only acceptance. Runs a disposable no-dependency fixture inside
 * Windows Sandbox; never uses GitHub Actions and never builds owner project code.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS === 'true') {
  throw new Error('This acceptance must run on the owner Windows PC, never in CI.');
}

const root = path.resolve(__dirname, '..');
function loadTs(relative, mocks = {}) {
  const file = path.join(root, relative);
  const compiled = ts.transpileModule(fsSync.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const moduleBox = { exports: {} };
  const requireInside = (id) => Object.prototype.hasOwnProperty.call(mocks, id) ? mocks[id] : require(id);
  vm.runInNewContext(compiled, {
    module: moduleBox, exports: moduleBox.exports, require: requireInside,
    process, Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval,
  }, { filename: file, timeout: 15000 });
  return moduleBox.exports;
}
const fsSync = require('node:fs');
const policy = loadTs('src/lib/agent/guardian/policy.ts');
const build = loadTs('src/lib/agent/tools/localProjectBuild.ts', {
  '../guardian/policy': policy,
});
const workspace = policy.WORKSPACE_ROOT;
const fixtureName = '.local-project-build-live-' + randomUUID();
const fixture = path.join(workspace, fixtureName);
const previous = process.env.JARVIS_LOCAL_PROJECT_BUILD_ENABLED;
let fixtureCreated = false;

(async () => {
  try {
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(fixture, { recursive: false });
    fixtureCreated = true;
    const packageJson = {
      name: 'jarvis-windows-sandbox-fixture',
      version: '1.0.0',
      private: true,
      scripts: { build: 'node build.cjs' },
    };
    const packageLock = {
      name: packageJson.name,
      version: packageJson.version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: packageJson.name, version: packageJson.version } },
    };
    await fs.writeFile(path.join(fixture, 'package.json'), JSON.stringify(packageJson, null, 2));
    await fs.writeFile(path.join(fixture, 'package-lock.json'), JSON.stringify(packageLock, null, 2));
    await fs.writeFile(path.join(fixture, 'build.cjs'),
      "'use strict';const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','<!doctype html><title>JARVIS sandbox acceptance</title><p>BUILD_OK</p>');\n");

    process.env.JARVIS_LOCAL_PROJECT_BUILD_ENABLED = '1';
    const project = path.relative(workspace, fixture).split(path.sep).join('/');
    const authorization = await build.prepareLocalProjectBuild({ project });
    assert.equal(authorization.ok, true, authorization.reason || 'Guardian preparation failed');
    assert.ok(authorization.prepared, 'prepared build arguments required');

    const result = await build.executeLocalProjectBuild(
      authorization.prepared,
      () => false,
      () => {},
    );
    assert.equal(result.ok, true, result.error || 'Windows Sandbox build failed');
    assert.equal(result.detail.sandboxed, true);
    assert.equal(result.detail.networkDisabled, true);
    assert.equal(result.detail.artifactKind, 'dist');
    assert.ok(Number(result.detail.artifactFiles) >= 1);
    assert.match(result.detail.artifactManifestSha256, /^[a-f0-9]{64}$/);

    const artifact = path.join(workspace, result.detail.artifactPath, 'index.html');
    const html = await fs.readFile(artifact, 'utf8');
    assert.match(html, /BUILD_OK/);
    const receipt = JSON.parse(await fs.readFile(path.join(workspace, result.detail.receiptPath), 'utf8'));
    assert.equal(receipt.sandbox, 'Windows Sandbox; networking, clipboard, printer, audio, video and vGPU disabled');
    assert.equal(receipt.packageLockSha256, authorization.prepared.packageLockSha256);

    console.log('LOCAL_PROJECT_BUILD_WINDOWS_LIVE PASS');
    console.log(JSON.stringify({
      sandboxed: result.detail.sandboxed,
      networkDisabled: result.detail.networkDisabled,
      artifactKind: result.detail.artifactKind,
      artifactFiles: result.detail.artifactFiles,
      artifactBytes: result.detail.artifactBytes,
      artifactManifestSha256: result.detail.artifactManifestSha256,
    }, null, 2));
  } finally {
    if (previous === undefined) delete process.env.JARVIS_LOCAL_PROJECT_BUILD_ENABLED;
    else process.env.JARVIS_LOCAL_PROJECT_BUILD_ENABLED = previous;
    if (fixtureCreated) await fs.rm(fixture, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
