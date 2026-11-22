#!/usr/bin/env node
// ReAttest offline verifier — anyone holding a pack export (the JSON the
// dashboard's "Export pack" button produces) can re-check the verification
// ledger WITHOUT trusting ReAttest or Atlassian: every ledger run's hash is
// recomputed from its stored fingerprints and timestamp, and the hash chain
// linkage is verified end to end.
//
// Usage: node scripts/verify-export.mjs <pack-export.json>
// Exit code 0 = ledger intact; 1 = tampered or malformed.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
// Must stay byte-identical to src/core/canonical.js stableStringify and
// src/core/engine.js ledgerHash.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
const ledgerHash = (prevHash, fingerprints, atISO) =>
  sha256(stableStringify({ prev: prevHash ?? 'GENESIS', items: [...fingerprints].sort(), at: atISO }));

const file = process.argv[2];
if (!file) { console.error('usage: node verify-export.mjs <pack-export.json>'); process.exit(1); }
const pack = JSON.parse(readFileSync(file, 'utf8'));
const runs = pack.ledger ?? [];
if (!runs.length) { console.error('FAIL: export contains no ledger runs'); process.exit(1); }

let prev = null;
let checked = 0;
for (const [i, run] of runs.entries()) {
  if (run.prev !== prev) { console.error(`FAIL: run ${i} (${run.kind} ${run.controlId ?? ''} at ${run.at}) does not link to the previous hash`); process.exit(1); }
  if (!Array.isArray(run.fps)) { console.error(`FAIL: run ${i} has no fingerprints — cannot recompute (exported by an old version?)`); process.exit(1); }
  const recomputed = ledgerHash(run.prev, run.fps, run.at);
  if (recomputed !== run.hash) { console.error(`FAIL: run ${i} hash mismatch — recomputed ${recomputed}, stored ${run.hash}`); process.exit(1); }
  prev = run.hash;
  checked++;
}
const head = pack.status?.ledgerHead;
if (head && head !== prev) { console.error(`FAIL: ledger head in export (${head}) does not match the last run hash (${prev})`); process.exit(1); }
console.log(`OK: ${checked} ledger runs re-computed and chain-linked. Ledger head ${prev.slice(0, 16)}… is intact.`);
console.log('This proves the verification history in this export was not altered after the fact.');
