// ReAttest spike — fingerprint + verification engine (spec v3 §3, §6).
import { createHash } from 'node:crypto';
import { stableStringify } from './canonical.js';

export function fingerprint(canonicalPayload) {
  return createHash('sha256').update(stableStringify(canonicalPayload), 'utf8').digest('hex');
}

// Fields whose change is recorded as a NOTE but never flips the verdict.
// (Cosmetic layer is compared on the RAW live object, outside canonical.)
const COSMETIC_PATHS = ['_cosmetic.commentCount', '_cosmetic.watcherCount', '_cosmetic.lastViewed'];

function diffPaths(a, b, prefix = '') {
  const out = [];
  if (stableStringify(a) === stableStringify(b)) return out;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
    out.push({ path: prefix, before: a ?? null, after: b ?? null });
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    out.push(...diffPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

// cosmeticView: pull purely-cosmetic signals from a raw object so the
// verifier can report NOTE-level changes without touching the verdict.
export function cosmeticView(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const f = raw.fields ?? raw;
  return {
    commentCount: f.comment?.total ?? raw.commentCount ?? null,
    watcherCount: f.watches?.watchCount ?? raw.watcherCount ?? null,
    lastViewed: raw.lastViewed ?? null,
  };
}

// verifyItem: snapshot = { canonical, fingerprint, takenAt }
//             live     = { canonical } or null when the source is unreadable
// Returns { verdict, materialDiffs, notes } — fail-closed: unreadable is
// never VERIFIED.
export function verifyItem(snapshot, liveCanonical, liveCosmetic = {}) {
  if (liveCanonical == null) {
    return { verdict: 'UNREADABLE', materialDiffs: [], notes: ['source could not be read'] };
  }
  const liveFp = fingerprint(liveCanonical);
  const notes = [];
  const snapCos = snapshot.cosmetic ?? {};
  for (const k of Object.keys(liveCosmetic)) {
    if (liveCosmetic[k] !== snapCos[k]) notes.push(`cosmetic: ${k} ${snapCos[k]} -> ${liveCosmetic[k]}`);
  }
  if (liveFp === snapshot.fingerprint) {
    return { verdict: 'VERIFIED', materialDiffs: [], notes };
  }
  const materialDiffs = diffPaths(snapshot.canonical, liveCanonical);
  // Precision rule: a Confluence version bump whose canonical body, labels
  // and properties are identical is a save event, not an evidence change.
  if (materialDiffs.length > 0 && materialDiffs.every((d) => d.path === 'version')) {
    notes.push(`version bumped ${materialDiffs[0].before} -> ${materialDiffs[0].after}, content unchanged`);
    return { verdict: 'VERIFIED', materialDiffs: [], notes };
  }
  return { verdict: 'CHANGED', materialDiffs, notes };
}

// Population verification: frozen member keys vs live member keys.
// Any asymmetry is a finding of its own (spec v3 §4 — omission catch).
export function verifyPopulation(frozenKeys, liveKeys) {
  const frozen = new Set(frozenKeys);
  const live = new Set(liveKeys);
  const missingFromLive = [...frozen].filter((k) => !live.has(k)); // was frozen, gone now
  const unboundInLive = [...live].filter((k) => !frozen.has(k)); // new, never snapshotted
  return {
    drift: missingFromLive.length > 0 || unboundInLive.length > 0,
    missingFromLive,
    unboundInLive,
  };
}

// Hash-chained ledger entry (spec v3 §6): each run commits to the previous
// run's hash, so history cannot be reordered or edited silently.
export function ledgerHash(prevHash, itemFingerprints, runTimestamp) {
  const payload = stableStringify({
    prev: prevHash ?? 'GENESIS',
    items: [...itemFingerprints].sort(),
    at: runTimestamp,
  });
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
