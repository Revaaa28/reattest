import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';
import Button, { ButtonGroup } from '@atlaskit/button';
import Lozenge from '@atlaskit/lozenge';
import Spinner from '@atlaskit/spinner';
import SectionMessage from '@atlaskit/section-message';
import '@atlaskit/css-reset';

const VERDICT_APPEARANCE = {
  VERIFIED: 'success',
  CHANGED: 'removed',
  MISSING: 'removed',
  UNREADABLE: 'default',
  INCOMPLETE: 'inprogress',
  STALE: 'moved',
};

function VerdictCounts({ counts }) {
  if (!counts) return <span style={{ color: '#6B778C' }}>not verified yet</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {Object.entries(counts).map(([v, n]) => (
        <Lozenge key={v} appearance={VERDICT_APPEARANCE[v] ?? 'default'} isBold>{`${v} ${n}`}</Lozenge>
      ))}
    </span>
  );
}

function Gates({ gates }) {
  if (!gates) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {Object.entries(gates).map(([g, ok]) => (
        <Lozenge key={g} appearance={ok ? 'success' : 'removed'}>{g.replace('_', ' ')}</Lozenge>
      ))}
    </span>
  );
}

function ControlDetail({ controlId, onBack }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    invoke('getControlReport', { controlId })
      .then(setReport)
      .catch((e) => setError(String(e)));
  }, [controlId]);
  return (
    <div>
      <Button appearance="link" onClick={onBack}>← Back to pack</Button>
      <h2 style={{ marginTop: 4 }}>{controlId} — verification detail</h2>
      {error && <SectionMessage appearance="error" title="Could not load report"><p>{error}</p></SectionMessage>}
      {!report && !error && <Spinner size="large" />}
      {report && (
        <div>
          <p style={{ color: '#6B778C' }}>Verified at {new Date(report.at).toLocaleString()} · Population drift: {report.population.drift ? 'YES' : 'no'}</p>
          {report.population.added?.length > 0 && (
            <SectionMessage appearance="warning" title="Population drift — new items outside the frozen population">
              <p>{report.population.added.join(', ')}</p>
            </SectionMessage>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #DFE1E6' }}>
                <th style={{ padding: 6 }}>Item</th><th style={{ padding: 6 }}>Verdict</th><th style={{ padding: 6 }}>Quality gates</th><th style={{ padding: 6 }}>What changed</th>
              </tr>
            </thead>
            <tbody>
              {report.verdicts.map((v) => (
                <tr key={v.itemKey} style={{ borderBottom: '1px solid #DFE1E6', verticalAlign: 'top' }}>
                  <td style={{ padding: 6, fontFamily: 'monospace' }}>{v.itemKey}</td>
                  <td style={{ padding: 6 }}><Lozenge appearance={VERDICT_APPEARANCE[v.verdict] ?? 'default'} isBold>{v.verdict}</Lozenge></td>
                  <td style={{ padding: 6 }}><Gates gates={v.gates} /></td>
                  <td style={{ padding: 6 }}>
                    {v.diffs?.length > 0 ? v.diffs.map((d, i) => (
                      <div key={i} style={{ fontSize: 12 }}>
                        <strong>{d.path}</strong>: <span style={{ color: '#BF2600' }}>{String(d.before).slice(0, 120)}</span> → <span style={{ color: '#006644' }}>{String(d.after).slice(0, 120)}</span>
                      </div>
                    )) : <span style={{ color: '#6B778C' }}>{v.notes?.join(' ') ?? ''}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 style={{ marginTop: 20 }}>Rule findings ({report.findings.length})</h3>
          {report.findings.length === 0 && <p style={{ color: '#006644' }}>No findings — every rule passes on the live evidence.</p>}
          {report.findings.map((f, i) => (
            <p key={i} style={{ margin: '4px 0' }}>
              <Lozenge appearance="removed">{f.rule}</Lozenge>{' '}
              <span style={{ fontFamily: 'monospace' }}>{f.itemKey}</span> — {f.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback(() => invoke('getPackStatus').then(setStatus).catch((e) => setNotice({ type: 'error', text: String(e) })), []);
  useEffect(() => { load(); }, [load]);

  const run = async (label, fn) => {
    setBusy(label); setNotice(null);
    try { const r = await fn(); setNotice({ type: 'success', text: `${label} done.` }); await load(); return r; }
    catch (e) { setNotice({ type: 'error', text: `${label} failed: ${e}` }); }
    finally { setBusy(''); }
  };

  const exportPack = async () => {
    const data = await invoke('exportPack');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reattest-pack-export.json';
    a.click();
  };

  if (!status) return <div style={{ padding: 24 }}><Spinner size="large" /></div>;
  const anySnapshotted = status.controls.some((c) => c.snapshotted);
  const totalItems = status.controls.reduce((s, c) => s + (c.items ?? 0), 0);

  if (selected) return <div style={{ padding: 16 }}><ControlDetail controlId={selected} onBack={() => { setSelected(null); load(); }} /></div>;

  return (
    <div style={{ padding: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>ReAttest — Evidence Pack</h1>
      <p style={{ color: '#6B778C', marginTop: 0 }}>
        Audit evidence that must still be true. Every item below was fingerprinted at snapshot time and is
        re-verified against its live source — verdicts come from a deterministic engine, never from AI.
      </p>
      {notice && (
        <SectionMessage appearance={notice.type === 'error' ? 'error' : 'confirmation'} title={notice.type === 'error' ? 'Something went wrong' : 'Done'}>
          <p>{notice.text}</p>
        </SectionMessage>
      )}
      {!anySnapshotted && (
        <div style={{ margin: '12px 0' }}>
          <SectionMessage appearance="discovery" title="Start here — load the demo company">
            <p>
              This site has no evidence pack yet. Load <strong>Meridian Pay</strong>, a fictional fintech preparing for a
              SOC 2 Type II audit: 15 evidence items across 8 controls, with real defects planted (a late postmortem,
              a stale policy, a self-approved page, an un-removed leaver). Then snapshot the pack and re-verify it —
              and try editing a policy page afterwards to watch ReAttest catch it.
            </p>
            <p>
              <Button appearance="primary" isLoading={busy === 'Seeding demo company'} onClick={() => run('Seeding demo company', () => invoke('seedDemo'))}>
                Load demo company (Meridian Pay)
              </Button>
            </p>
          </SectionMessage>
        </div>
      )}
      <ButtonGroup>
        <Button isLoading={busy === 'Seeding demo company'} onClick={() => run('Seeding demo company', () => invoke('seedDemo'))}>Load demo company</Button>
        <Button isLoading={busy === 'Verifying all controls'} onClick={() => run('Verifying all controls', () => invoke('verifyAll'))}>Re-verify all</Button>
        <Button onClick={exportPack}>Export pack (JSON)</Button>
      </ButtonGroup>
      <p style={{ color: '#6B778C' }}>{totalItems} evidence items frozen · Ledger head: <span style={{ fontFamily: 'monospace' }}>{status.ledgerHead ? status.ledgerHead.slice(0, 16) + '…' : '—'}</span></p>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #DFE1E6' }}>
            <th style={{ padding: 6 }}>Control</th><th style={{ padding: 6 }}>Frameworks</th><th style={{ padding: 6 }}>Items</th>
            <th style={{ padding: 6 }}>Last verification</th><th style={{ padding: 6 }}>Findings</th><th style={{ padding: 6 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {status.controls.map((c) => (
            <tr key={c.controlId} style={{ borderBottom: '1px solid #DFE1E6' }}>
              <td style={{ padding: 6 }}><strong>{c.controlId}</strong> — {c.name} <Lozenge appearance={c.kind === 'deep' ? 'new' : 'default'}>{c.kind}</Lozenge></td>
              <td style={{ padding: 6, color: '#6B778C', fontSize: 12 }}>SOC 2 {c.soc2} · ISO {c.iso}</td>
              <td style={{ padding: 6 }}>{c.snapshotted ? c.items : '—'}</td>
              <td style={{ padding: 6 }}><VerdictCounts counts={c.lastVerify?.counts} /></td>
              <td style={{ padding: 6 }}>{c.lastVerify ? c.lastVerify.findings : '—'}{c.lastVerify?.drift ? ' · DRIFT' : ''}</td>
              <td style={{ padding: 6, whiteSpace: 'nowrap' }}>
                <ButtonGroup>
                  <Button spacing="compact" isLoading={busy === `Snapshot ${c.controlId}`} onClick={() => run(`Snapshot ${c.controlId}`, () => invoke('snapshotControl', { controlId: c.controlId }))}>Snapshot</Button>
                  <Button spacing="compact" isLoading={busy === `Verify ${c.controlId}`} onClick={() => run(`Verify ${c.controlId}`, () => invoke('verifyControl', { controlId: c.controlId }))}>Re-verify</Button>
                  <Button spacing="compact" appearance="link" onClick={() => setSelected(c.controlId)}>View</Button>
                </ButtonGroup>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: '#6B778C', fontSize: 12, marginTop: 16 }}>
        How to read this: VERIFIED means the live evidence still matches its fingerprint. CHANGED names the exact
        fields that moved. A verdict is never produced from an unreadable source — unreadable fails closed.
      </p>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
