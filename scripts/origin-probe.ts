/** Deterministic origin-policy tests; no DB, credentials or network. */
import { mutationOriginError } from '../src/lib/agent/auth/origin';

const baselineEnv = {
  NODE_ENV: process.env.NODE_ENV,
  JARVIS_PUBLIC_ORIGIN: process.env.JARVIS_PUBLIC_ORIGIN,
};
const cases: Array<{
  title: string;
  origin: string | null;
  site?: string;
  publicOrigin: string;
  nodeEnv: string;
  host: string;
  allowed: boolean;
}> = [
  { title: 'proxied allowed origin', origin: 'https://preview.example.test', site: 'same-origin', publicOrigin: 'https://preview.example.test', nodeEnv: 'production', host: 'internal:3000', allowed: true },
  { title: 'foreign origin', origin: 'https://evil.example.test', publicOrigin: 'https://preview.example.test', nodeEnv: 'production', host: 'internal:3000', allowed: false },
  { title: 'same-site sibling denied', origin: 'https://other.example.test', site: 'same-site', publicOrigin: 'https://preview.example.test', nodeEnv: 'production', host: 'internal:3000', allowed: false },
  { title: 'cross-site metadata denied', origin: 'https://preview.example.test', site: 'cross-site', publicOrigin: 'https://preview.example.test', nodeEnv: 'production', host: 'internal:3000', allowed: false },
  { title: 'no production config fails closed', origin: 'https://preview.example.test', publicOrigin: '', nodeEnv: 'production', host: 'preview.example.test', allowed: false },
  { title: 'local development allowed', origin: 'http://localhost:3000', publicOrigin: '', nodeEnv: 'development', host: 'localhost:3000', allowed: true },
  { title: 'foreign origin rejected on localhost', origin: 'https://evil.example', publicOrigin: '', nodeEnv: 'development', host: 'localhost:3000', allowed: false },
  { title: 'non-HTTPS remote origin rejected', origin: 'http://preview.example.test', publicOrigin: 'http://preview.example.test', nodeEnv: 'production', host: 'preview.example.test', allowed: false },
];
try {
  let failed = 0;
  for (const c of cases) {
    Reflect.set(process.env, 'NODE_ENV', c.nodeEnv);
    process.env.JARVIS_PUBLIC_ORIGIN = c.publicOrigin;
    const headers = { get: (key: string) => key === 'origin' ? c.origin : key === 'host' ? c.host : key === 'sec-fetch-site' ? c.site ?? null : null } as Headers;
    const actual = mutationOriginError(headers) === null;
    console.log(`${actual === c.allowed ? 'PASS' : 'FAIL'} ORIGIN ${c.title}`);
    if (actual !== c.allowed) failed++;
  }
  if (failed) process.exitCode = 1;
} finally {
  for (const [key, value] of Object.entries(baselineEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
