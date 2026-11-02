#!/usr/bin/env node
'use strict';

/**
 * Strict validator for JARVIS's Internet-sourced autonomous task corpus.
 *
 * This validates provenance/shape/deduplication only. It does NOT execute tasks,
 * prove that source URLs contain the prompt, or establish agent success.
 *
 * Usage:
 *   node scripts/autonomy/validate-internet-corpus.mjs \
 *     --input benchmarks/autonomy/internet-hard-200k.jsonl \
 *     --expected 200000 \
 *     --manifest artifacts/autonomy-corpus-manifest.json
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const input = path.resolve(arg('--input', 'benchmarks/autonomy/internet-hard-200k.jsonl'));
const expected = Number(arg('--expected', '200000'));
const manifestPath = path.resolve(arg('--manifest', 'artifacts/autonomy-corpus-manifest.json'));
const errors = [];
const domains = new Map();
const sources = new Map();
const ids = new Set();
const promptHashes = new Set();
const sourceRecordIds = new Set();
const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const fail = (line, message) => { if (errors.length < 100) errors.push({ line, message }); };

if (!Number.isSafeInteger(expected) || expected < 1) {
  console.error('Invalid --expected value');
  process.exit(2);
}
if (!fs.existsSync(input) || !fs.statSync(input).isFile()) {
  console.error(`CORPUS_MISSING: ${input}`);
  process.exit(2);
}

const raw = fs.readFileSync(input);
const fileHash = crypto.createHash('sha256').update(raw).digest('hex');
const lines = raw.toString('utf8').split(/\r?\n/);
let count = 0;
let byteOffset = 0;
const validOrigins = new Set(['internet_original']);
const validVerifierKinds = new Set([
  'filesystem_state', 'process_state', 'http_state', 'database_state',
  'browser_state', 'windows_uia', 'screenshot_assertion', 'game_state',
  'build_test', 'structured_artifact', 'multi_state'
]);

for (let index = 0; index < lines.length; index++) {
  const text = lines[index];
  const lineNumber = index + 1;
  const lineBytes = Buffer.byteLength(text, 'utf8') + 1;
  if (!text.trim()) { byteOffset += lineBytes; continue; }
  let row;
  try { row = JSON.parse(text); }
  catch (e) { fail(lineNumber, 'Invalid JSON: ' + e.message); byteOffset += lineBytes; continue; }
  count++;

  const requiredString = (value, label, min = 1) => {
    if (typeof value !== 'string' || value.trim().length < min) fail(lineNumber, label + ' missing/invalid');
  };
  requiredString(row.id, 'id');
  requiredString(row.prompt, 'prompt', 80);
  requiredString(row.domain, 'domain');
  if (row.difficulty !== 'very_hard') fail(lineNumber, 'difficulty must be very_hard');
  if (!row.origin || !validOrigins.has(row.origin.kind)) fail(lineNumber, 'origin.kind must be internet_original; derived/synthetic records do not count');
  if (!row.source || typeof row.source !== 'object') fail(lineNumber, 'source metadata missing');
  else {
    requiredString(row.source.name, 'source.name');
    requiredString(row.source.record_id, 'source.record_id');
    requiredString(row.source.revision, 'source.revision');
    requiredString(row.source.license_spdx, 'source.license_spdx');
    requiredString(row.source.raw_prompt_sha256, 'source.raw_prompt_sha256');
    for (const key of ['url', 'dataset_url', 'license_url']) {
      try {
        const u = new URL(row.source[key]);
        if (u.protocol !== 'https:') throw new Error('HTTPS required');
      } catch { fail(lineNumber, 'source.' + key + ' must be a valid HTTPS URL'); }
    }
    const sourceKey = row.source.name + ':' + row.source.record_id;
    if (sourceRecordIds.has(sourceKey)) fail(lineNumber, 'duplicate upstream source record: ' + sourceKey);
    sourceRecordIds.add(sourceKey);
    sources.set(row.source.name, (sources.get(row.source.name) || 0) + 1);
  }

  if (!row.environment || typeof row.environment !== 'object') fail(lineNumber, 'environment metadata missing');
  else {
    requiredString(row.environment.kind, 'environment.kind');
    requiredString(row.environment.setup_ref, 'environment.setup_ref');
  }
  if (!row.verifier || typeof row.verifier !== 'object') fail(lineNumber, 'independent verifier missing');
  else {
    if (!validVerifierKinds.has(row.verifier.kind)) fail(lineNumber, 'unsupported verifier.kind');
    requiredString(row.verifier.spec, 'verifier.spec', 20);
    if (row.verifier.independent !== true) fail(lineNumber, 'verifier.independent must be true');
  }
  if (row.risk_class !== 'safe' && row.risk_class !== 'approval_required' && row.risk_class !== 'blocked') {
    fail(lineNumber, 'risk_class must be safe, approval_required, or blocked');
  }

  if (typeof row.id === 'string') {
    if (ids.has(row.id)) fail(lineNumber, 'duplicate corpus id: ' + row.id);
    ids.add(row.id);
  }
  if (typeof row.prompt === 'string') {
    const normalized = row.prompt.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const promptHash = sha256(normalized);
    if (promptHashes.has(promptHash)) fail(lineNumber, 'duplicate normalized prompt');
    promptHashes.add(promptHash);
    if (row.source?.raw_prompt_sha256 && row.source.raw_prompt_sha256 !== sha256(row.prompt)) {
      fail(lineNumber, 'raw_prompt_sha256 does not match prompt bytes; transformed prompts must be stored separately and do not count');
    }
  }
  domains.set(row.domain, (domains.get(row.domain) || 0) + 1);
  byteOffset += lineBytes;
}

if (count !== expected) fail(0, `expected exactly ${expected} original Internet-sourced prompts; found ${count}`);
const summary = {
  schema: 'jarvis.autonomy.internet-task-corpus.v1',
  generatedAt: new Date().toISOString(),
  input: path.relative(process.cwd(), input),
  expected,
  records: count,
  uniqueIds: ids.size,
  uniquePrompts: promptHashes.size,
  sourceRecords: sourceRecordIds.size,
  sha256: fileHash,
  domains: Object.fromEntries([...domains].sort()),
  sources: Object.fromEntries([...sources].sort()),
  errors: errors.length,
  errorSamples: errors
};
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (errors.length) {
  console.error('CORPUS VALIDATION FAILED. No records were counted as accepted.');
  process.exit(1);
}
console.log(`CORPUS VALIDATION PASSED: ${count} unique, very-hard, Internet-original task prompts.`);
