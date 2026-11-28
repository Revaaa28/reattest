// ReAttest — Forge KVS storage layer.
// Keys: snap:<controlId>:<itemKey>  -> { canonical, fingerprint, cosmetic, takenAt }
//       pop:<controlId>             -> [itemKey]  (frozen population)
//       ledger:head                 -> last run hash
//       ledger:runs                 -> [{ at, hash, prev, counts }] (capped)
import { kvs } from '@forge/kvs';

const snapKey = (controlId, itemKey) => `snap:${controlId}:${itemKey}`;

export async function putSnapshot(controlId, entry) {
  await kvs.set(snapKey(controlId, entry.itemKey), entry);
}
export async function getSnapshot(controlId, itemKey) {
  return (await kvs.get(snapKey(controlId, itemKey))) ?? null;
}
export async function putPopulation(controlId, itemKeys) {
  await kvs.set(`pop:${controlId}`, itemKeys);
}
export async function getPopulation(controlId) {
  return (await kvs.get(`pop:${controlId}`)) ?? null;
}
export async function getLedgerHead() {
  return (await kvs.get('ledger:head')) ?? null;
}
export async function appendLedgerRun(run) {
  const runs = (await kvs.get('ledger:runs')) ?? [];
  runs.push(run);
  await kvs.set('ledger:runs', runs.slice(-200));
  await kvs.set('ledger:head', run.hash);
  return run;
}
export async function getLedgerRuns(limit = 20) {
  const runs = (await kvs.get('ledger:runs')) ?? [];
  return runs.slice(-limit);
}
export async function putReport(controlId, report) {
  await kvs.set(`report:${controlId}`, report);
}
export async function getReport(controlId) {
  return (await kvs.get(`report:${controlId}`)) ?? null;
}
export async function resetAll(controlIds) {
  for (const controlId of controlIds) {
    const pop = (await kvs.get(`pop:${controlId}`)) ?? [];
    for (const itemKey of pop) await kvs.delete(snapKey(controlId, itemKey));
    await kvs.delete(`pop:${controlId}`);
    await kvs.delete(`report:${controlId}`);
    await kvs.delete(`exc:${controlId}`);
  }
  await kvs.delete('ledger:runs');
  await kvs.delete('ledger:head');
}
export async function getTwgCloudId() {
  return (await kvs.get('twg:cloudId')) ?? null;
}
export async function putTwgCloudId(cloudId) {
  await kvs.set('twg:cloudId', cloudId);
}
export async function putExceptions(controlId, exceptions) {
  await kvs.set(`exc:${controlId}`, exceptions);
}
export async function getExceptions(controlId) {
  return (await kvs.get(`exc:${controlId}`)) ?? [];
}
