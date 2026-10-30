/**
 * GPT-6 focused security probes requiring Node 22+ with TypeScript stripping.
 * No database, model, or network required. Disposable isolated temp root only.
 * Run: node --experimental-strip-types scripts/gpt6-offline-security-probe.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-gpt6-security-'));
const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-gpt6-outside-'));
process.env.JARVIS_AGENT_WORKSPACE = root;
const { resolveScopedPath, assertWithinRoot, ensureWorkspace } = await import('../src/lib/agent/guardian/policy.ts');
const { classifyModelFailure } = await import('../src/lib/agent/core/modelErrors.ts');
const { mutationOriginError } = await import('../src/lib/agent/auth/origin.ts');
const previousOrigin = process.env.JARVIS_PUBLIC_ORIGIN;
const previousEnv = process.env.NODE_ENV;
let passed = 0;
function probe(label, fn) {
  return Promise.resolve().then(fn).then(() => {
    console.log('PASS', label); passed++;
  });
}
try {
  await ensureWorkspace();
  await probe('file under permitted root resolves', async () => {
    const decision = resolveScopedPath('safe.txt');
    assert.equal(decision.ok, true);
    assert.equal((await assertWithinRoot(decision.abs)).ok, true);
  });
  await probe('traversal denied', () => assert.equal(resolveScopedPath('../secret').ok, false));
  await probe('absolute path denied', () => assert.equal(resolveScopedPath('/etc/passwd').ok, false));
  await probe('Windows drive path denied on Linux', () => assert.equal(resolveScopedPath('C:\\secrets').ok, false));
  await probe('UNC path denied', () => assert.equal(resolveScopedPath('\\\\host\\share').ok, false));
  await fs.symlink(outside, path.join(root, 'escape'), 'dir');
  await probe('symlink escape denied', async () => {
    const decision = resolveScopedPath('escape/secret.txt');
    assert.equal(decision.ok, true); // lexical test alone is not enough
    assert.equal((await assertWithinRoot(decision.abs)).ok, false);
  });
  process.env.NODE_ENV = 'production';
  process.env.JARVIS_PUBLIC_ORIGIN = 'https://preview.example.test';
  const headers = (origin, site) => ({ get(key) {
    return key === 'origin' ? origin : key === 'sec-fetch-site' ? site : key === 'host' ? 'internal:3000' : null;
  }});
  await probe('approved proxied public origin accepted', () =>
    assert.equal(mutationOriginError(headers('https://preview.example.test', 'same-origin')), null));
  await probe('different preview tenant rejected', () =>
    assert.ok(mutationOriginError(headers('https://other.example.test', 'same-site'))));
  await probe('foreign cross-site request rejected', () =>
    assert.ok(mutationOriginError(headers('https://preview.example.test', 'cross-site'))));
  await probe('missing browser Origin in same-site context rejected', () =>
    assert.ok(mutationOriginError(headers(null, 'same-site'))));
  await probe('429 produces rate-limit error without raw secret', () => {
    const err = classifyModelFailure({status:429, message:'Quota exhausted key=PRIVATESECRET'});
    assert.equal(err.code, 'MODEL_RATE_LIMITED');
    assert.equal(err.publicMessage.includes('PRIVATESECRET'), false);
  });
  await probe('invalid credentials produce safe auth error', () => {
    const err = classifyModelFailure({status:401, message:'API key: PRIVATESECRET'});
    assert.equal(err.code, 'MODEL_AUTH_FAILED');
    assert.equal(err.publicMessage.includes('PRIVATESECRET'), false);
  });
  console.log(`ISOLATED PROBES ${passed}/12 PASS; not a full runtime or Windows certification`);
} finally {
  if (previousOrigin === undefined) delete process.env.JARVIS_PUBLIC_ORIGIN;
  else process.env.JARVIS_PUBLIC_ORIGIN = previousOrigin;
  if (previousEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousEnv;
  await fs.rm(root, { recursive:true, force:true });
  await fs.rm(outside, { recursive:true, force:true });
}
