// ReAttest — pack orchestration: snapshot, verify, status (Forge runtime).
import { CONTROLS, evaluateControl, qualityGates } from './core/rules.js';
import { verifyItem, verifyPopulation, ledgerHash } from './core/engine.js';
import { collectControl } from './collectors.js';
import * as store from './store.js';

export function getControl(controlId) {
  return CONTROLS.find((c) => c.id === controlId) ?? null;
}

export async function snapshotControl(controlId) {
  const control = getControl(controlId);
  if (!control) throw new Error(`unknown control ${controlId}`);
  const records = await collectControl(control);
  const keys = records.map((r) => r.itemKey);
  await store.putPopulation(controlId, keys);
  for (const r of records) {
    await store.putSnapshot(controlId, {
      itemKey: r.itemKey, canonical: r.canonical, fingerprint: r.fingerprint,
      cosmetic: r.cosmetic, takenAt: new Date().toISOString(),
    });
  }
  const prev = await store.getLedgerHead();
  const at = new Date().toISOString();
  const fps = records.map((r) => r.fingerprint);
  const hash = ledgerHash(prev, fps, at);
  // fps are stored so the offline verifier can recompute every hash.
  await store.appendLedgerRun({ at, hash, prev, kind: 'snapshot', controlId, items: keys.length, fps });
  return { controlId, items: keys.length, keys };
}

function applyExceptions(findings, exceptions, asOf) {
  const active = (exceptions ?? []).filter((e) => !e.expires || e.expires >= asOf);
  return findings.filter((f) => !active.some((e) => e.itemKey === f.itemKey && e.rule === f.rule));
}

export async function verifyControl(controlId) {
  const control = getControl(controlId);
  if (!control) throw new Error(`unknown control ${controlId}`);
  const frozen = await store.getPopulation(controlId);
  if (!frozen) return { controlId, error: 'NO_SNAPSHOT', message: 'Snapshot this control before verifying it.' };
  const asOf = new Date().toISOString().slice(0, 10);
  const live = await collectControl(control);
  const liveByKey = new Map(live.map((r) => [r.itemKey, r]));
  const verdicts = [];
  for (const itemKey of frozen) {
    const snap = await store.getSnapshot(controlId, itemKey);
    const liveRec = liveByKey.get(itemKey);
    const result = liveRec
      ? verifyItem(snap, liveRec.canonical, liveRec.cosmetic)
      : { verdict: 'MISSING', materialDiffs: [], notes: ['item no longer returned by the population query'] };
    verdicts.push({
      itemKey, verdict: result.verdict, diffs: result.materialDiffs, notes: result.notes,
      gates: liveRec ? qualityGates(liveRec, true) : { DATED: false, NAMED: false, SOURCED: false, POPULATION_BOUND: true },
    });
  }
  const population = verifyPopulation(frozen, live.map((r) => r.itemKey));
  let findings = evaluateControl(controlId, live, { asOf });
  findings = applyExceptions(findings, await store.getExceptions(controlId), asOf);
  const counts = {};
  for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  const prev = await store.getLedgerHead();
  const at = new Date().toISOString();
  const fps = live.map((r) => r.fingerprint);
  const hash = ledgerHash(prev, fps, at);
  await store.appendLedgerRun({ at, hash, prev, kind: 'verify', controlId, counts, findings: findings.length, drift: population.drift, fps });
  const report = { controlId, at: new Date().toISOString(), verdicts, findings, population, counts };
  await store.putReport(controlId, report);
  return report;
}

export async function packStatus() {
  const out = [];
  for (const c of CONTROLS) {
    const pop = await store.getPopulation(c.id);
    const report = await store.getReport(c.id);
    out.push({
      controlId: c.id, name: c.name, kind: c.kind, soc2: c.soc2, iso: c.iso,
      snapshotted: !!pop, items: pop?.length ?? 0,
      lastVerify: report ? { at: report.at, counts: report.counts, findings: report.findings.length, drift: report.population.drift } : null,
    });
  }
  return { controls: out, ledgerHead: await store.getLedgerHead(), runs: (await store.getLedgerRuns(5)).length };
}
