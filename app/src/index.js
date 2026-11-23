import Resolver from '@forge/resolver';
import { packStatus, snapshotControl, verifyControl, getControl } from './pack.js';
import { CONTROLS } from './core/rules.js';
import { getReport, getLedgerRuns, getPopulation } from './store.js';
import { seedDemo } from './seeder.js';

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
    // F4 enriches this with Teamwork Graph provenance; today it returns the
    // ledger chain and the control's frozen population membership.
    const controlId = inputs.controlId;
    const pop = controlId ? await getPopulation(controlId) : null;
    return {
      controlId: controlId ?? null,
      frozenPopulation: pop,
      ledgerRuns: await getLedgerRuns(10),
      note: 'Provenance is anchored in the hash-chained verification ledger stored by the app.',
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
