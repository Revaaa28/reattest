import Resolver from '@forge/resolver';
import forgeApi from '@forge/api';
import { packStatus, snapshotControl, verifyControl, getControl } from './pack.js';
import { CONTROLS } from './core/rules.js';
import { getReport, getLedgerRuns, getPopulation, resetAll } from './store.js';
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

// --- Webtrigger: ops endpoint (seed / snapshot / verify without the UI) ---
// Used by the demo script and the offline verifier; the URL itself is the
// capability (unguessable per installation).
export const ops = async (req) => {
  const q = req.queryParameters ?? {};
  const op = (q.op ?? [])[0];
  const controlId = (q.control ?? [])[0];
  const json = (statusCode, obj) => ({ statusCode, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(obj, null, 2) });
  try {
    if (op === 'reset') { await resetAll(CONTROLS.map((c) => c.id)); return json(200, { reset: true }); }
    if (op === 'twg') {
      // Probe: can this app query the Teamwork Graph at all (F4 recon)?
      const ari = (q.ari ?? [])[0];
      if (!ari) return json(400, { error: 'pass ari=<jira issue ARI>' });
      const query = `query ReAttestProbe($ari: ID!) { node(id: $ari) { id ... on JiraIssue { key summary } } }`;
      try {
        const res = await forgeApi.asApp().requestGraph(query, { ari });
        return json(200, { status: res.status, body: (await res.text()).slice(0, 600) });
      } catch (e) { return json(200, { thrown: String(e?.message ?? e).slice(0, 400) }); }
    }
    if (op === 'seed') return json(200, await seedDemo((q.space ?? [])[0]));
    if (op === 'snapshot' && controlId) return json(200, await snapshotControl(controlId));
    if (op === 'snapshotAll') {
      const out = [];
      for (const c of CONTROLS) { try { out.push(await snapshotControl(c.id)); } catch (e) { out.push({ controlId: c.id, error: String(e) }); } }
      return json(200, out);
    }
    if (op === 'verify' && controlId) return json(200, await verifyControl(controlId));
    if (op === 'verifyAll') {
      const out = [];
      for (const c of CONTROLS) { if (await getPopulation(c.id)) out.push(await verifyControl(c.id)); }
      return json(200, out);
    }
    return json(400, { error: 'op must be seed | snapshot | snapshotAll | verify | verifyAll (with control= for single ops)' });
  } catch (e) {
    return json(500, { error: String(e?.message ?? e) });
  }
};

// --- Webtrigger: offline-verifier export endpoint ---
export const packExport = async () => {
  const status = await packStatus();
  const reports = {};
  for (const c of CONTROLS) reports[c.id] = await getReport(c.id);
  return {
    statusCode: 200,
    headers: { 'Content-Type': ['application/json'] },
    body: JSON.stringify({ exportedAt: new Date().toISOString(), status, reports, ledger: await getLedgerRuns(50) }, null, 2),
  };
};
