import Resolver from '@forge/resolver';
import { route } from '@forge/api';
import { packStatus, snapshotControl, verifyControl, getControl } from './pack.js';
import { CONTROLS } from './core/rules.js';
import { getReport, getLedgerRuns, getPopulation, getSnapshot } from './store.js';
import { seedDemo } from './seeder.js';
import { requestJira } from './forge-api.js';
import { getCloudId, pageProvenance, issueProvenance } from './twg.js';

const resolver = new Resolver();

resolver.define('getPackStatus', async () => packStatus());

resolver.define('snapshotControl', async (req) => snapshotControl(req.payload.controlId));

resolver.define('verifyControl', async (req) => verifyControl(req.payload.controlId));

resolver.define('verifyAll', async () => {
  const out = [];
  for (const c of CONTROLS) {
    if (await getPopulation(c.id)) out.push(await verifyControl(c.id));
  }
  return out;
});

resolver.define('getControlReport', async (req) => getReport(req.payload.controlId));

resolver.define('seedDemo', async () => seedDemo());

resolver.define('exportPack', async () => {
  const status = await packStatus();
  const reports = {};
  for (const c of CONTROLS) reports[c.id] = await getReport(c.id);
  return { exportedAt: new Date().toISOString(), status, reports, ledger: await getLedgerRuns(50) };
});


// --- F4: Teamwork Graph provenance -----------------------------------------
// Shared by the getProvenance agent action / MCP tool and the dashboard
// resolver of the same name. Fail-closed throughout: any graph error or
// unresolvable relation marks that item's provenance incomplete, and the
// aggregate flag follows the worst item — provenance is never overstated.
async function numericIssueId(itemKey) {
  try {
    const res = await requestJira(route`/rest/api/3/issue/${itemKey}?fields=${'id'}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

async function buildProvenance(controlId, accountId) {
  const pop = controlId ? await getPopulation(controlId) : null;
  if (!pop) {
    return {
      controlId: controlId ?? null,
      frozenPopulation: null,
      graphProvenance: { complete: false, reason: 'Control has not been snapshotted yet.' },
    };
  }
  const cloudId = await getCloudId(accountId);
  const items = await Promise.all(
    pop.map(async (itemKey) => {
      const snap = await getSnapshot(controlId, itemKey);
      const base = { itemKey, fingerprint: snap?.fingerprint ?? null };
      if (!cloudId) return { ...base, complete: false, reason: 'Teamwork Graph site id unavailable.' };
      if (itemKey.startsWith('page:')) {
        return { ...base, ...(await pageProvenance(cloudId, itemKey.slice(5))) };
      }
      const numId = await numericIssueId(itemKey);
      if (!numId) return { ...base, complete: false, reason: 'Issue id could not be resolved.' };
      return { ...base, ...(await issueProvenance(cloudId, numId)) };
    })
  );
  return {
    controlId,
    frozenPopulation: pop,
    graphProvenance: {
      source: 'teamwork-graph',
      complete: items.every((i) => i.complete),
      items,
    },
  };
}

resolver.define('getProvenance', async (req) =>
  buildProvenance(req.payload.controlId, req.context?.accountId ?? null)
);

export const handler = resolver.getDefinitions();

// --- Rovo agent actions + MCP tools (same four keys; manifest maps both) ---
export const agentActions = async (payload) => {
  const actionKey = payload?.actionKey ?? payload?.context?.actionKey ?? '';
  const inputs = payload?.inputs ?? payload?.payload ?? {};
  if (actionKey === 'packStatus') {
    const status = await packStatus();
    return { status, note: 'Counts are computed by the deterministic verification engine, not by AI.' };
  }
  if (actionKey === 'listGaps') {
    const gaps = [];
    for (const c of CONTROLS) {
      const report = await getReport(c.id);
      if (report) for (const f of report.findings) gaps.push({ controlId: c.id, ...f });
    }
    return { gaps };
  }
  if (actionKey === 'verifyItem') {
    const controlId = inputs.controlId;
    if (!controlId || !getControl(controlId)) return { error: 'Provide controlId (e.g. CC7.2).' };
    return verifyControl(controlId);
  }
  if (actionKey === 'getProvenance') {
    const controlId = inputs.controlId;
    if (!controlId || !getControl(controlId)) return { error: 'Provide controlId (e.g. CC7.2).' };
    const accountId = payload?.context?.accountId ?? payload?.accountId ?? null;
    const prov = await buildProvenance(controlId, accountId);
    return {
      ...prov,
      ledgerRuns: await getLedgerRuns(10),
      note: prov.graphProvenance?.complete
        ? 'Provenance combines the hash-chained verification ledger stored by the app with live Teamwork Graph relationships for every frozen item. Graph completeness is reported per item; an incomplete flag means the graph could not resolve that item, never that it has no history.'
        : 'Provenance is anchored in the hash-chained verification ledger stored by the app. Teamwork Graph enrichment is INCOMPLETE for at least one item (see graphProvenance.items) — treat graph-derived claims for those items as unverified.',
    };
  }
  return { error: `unknown action ${actionKey}` };
};

// --- Scheduled Drift Watch: re-verify every snapshotted control ---
export const driftWatch = async () => {
  const reports = [];
  for (const c of CONTROLS) {
    if (await getPopulation(c.id)) reports.push(await verifyControl(c.id));
  }
  return { verified: reports.length };
};
