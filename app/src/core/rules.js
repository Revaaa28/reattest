// ReAttest — control registry + pure rule evaluation (spec v2 §3, v3 §3).
// Pure functions only: no Forge imports, fully unit-testable off-platform.
// A "record" is { itemKey, title, facts } where facts carries the dates and
// actors the collectors extracted from the live source.

export const CONTROLS = [
  { id: 'CC7.2', name: 'Incident response', kind: 'deep', soc2: 'CC7.2', iso: 'A.5.24-A.5.26', source: 'jira', populationHint: "labels = incident" },
  { id: 'CC6.6', name: 'Policy currency', kind: 'deep', soc2: 'CC6.6', iso: 'A.5.15', source: 'confluence', populationHint: "label = policy" },
  { id: 'CC6.3', name: 'Access removal (leavers)', kind: 'deep', soc2: 'CC6.3', iso: 'A.5.15/A.8.2', source: 'jira', populationHint: "labels = leaver" },
  { id: 'CC7.4', name: 'Recovery testing', kind: 'deep', soc2: 'CC7.4', iso: 'A.8.13/A.8.14', source: 'confluence', populationHint: "label = restore-test" },
  { id: 'CC8.1', name: 'Change management', kind: 'light', soc2: 'CC8.1', iso: 'A.8.32', source: 'jira', populationHint: "labels = change" },
  { id: 'CC6.1', name: 'Access provisioning', kind: 'light', soc2: 'CC6.1', iso: 'A.5.15/A.8.2', source: 'jira', populationHint: "labels = access-grant" },
  { id: 'CC7.1', name: 'Vulnerability management', kind: 'light', soc2: 'CC7.1', iso: 'A.8.8', source: 'jira', populationHint: "labels = vuln" },
  { id: 'A.5.19', name: 'Supplier review', kind: 'light', soc2: '(ISO-led)', iso: 'A.5.19', source: 'confluence', populationHint: "label = supplier-review" },
];

export function businessDaysBetween(aISO, bISO) {
  const a = new Date(aISO); const b = new Date(bISO);
  if (isNaN(a) || isNaN(b)) return null;
  let days = 0; const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  const end = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const dow = d.getUTCDay(); if (dow !== 0 && dow !== 6) days++; }
  return days;
}

export function daysBetween(aISO, bISO) {
  const a = new Date(aISO); const b = new Date(bISO);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

const BAD_TITLES = /^(screenshot|img[_-]|untitled|test page|copy of)/i;

// Evidence Quality Gates (spec v2 §2.4) — named, per item.
export function qualityGates(record, inFrozenPopulation) {
  const f = record.facts ?? {};
  return {
    DATED: !!(f.eventDate || f.createdAt),
    NAMED: !!record.title && record.title.trim().length >= 10 && !BAD_TITLES.test(record.title.trim()),
    SOURCED: !!record.itemKey && (f.version != null || f.status != null),
    POPULATION_BOUND: !!inFrozenPopulation,
  };
}

function finding(itemKey, rule, message) { return { itemKey, rule, message }; }

// Segregation-of-duties detector — runs on any record set (spec v2 §2.5).
// Jira: approver vs reporter/assignee. Confluence: recorded approver
// (page property) vs the page author.
export function sodFindings(records) {
  const out = [];
  for (const r of records) {
    const f = r.facts ?? {};
    if (f.approver && f.reporter && f.approver === f.reporter) out.push(finding(r.itemKey, 'SOD-APPROVER-IS-REQUESTER', 'Approver is the same person as the requester'));
    if (f.approver && f.assignee && f.approver === f.assignee) out.push(finding(r.itemKey, 'SOD-APPROVER-IS-IMPLEMENTER', 'Approver is the same person as the implementer'));
    const propApprover = f.properties?.Approver ?? f.properties?.approver;
    if (propApprover && f.author && propApprover === f.author) out.push(finding(r.itemKey, 'SOD-APPROVER-IS-AUTHOR', 'Recorded approver is the same person who authored the page'));
  }
  return out;
}

const RESOLVED = /done|resolved|closed|complete/i;

export function evaluateControl(controlId, records, ctx = {}) {
  const asOf = ctx.asOf ?? new Date().toISOString().slice(0, 10);
  const findings = [];
  const add = (r, rule, message) => findings.push(finding(r.itemKey, rule, message));

  for (const r of records) {
    const f = r.facts ?? {};
    if (controlId === 'CC7.2') {
      if (!RESOLVED.test(f.status ?? '')) add(r, 'INCIDENT-OPEN', `Incident still open (status: ${f.status ?? 'unknown'})`);
      else if (!f.hasPostmortemLink) add(r, 'POSTMORTEM-MISSING', 'Resolved incident has no linked postmortem');
      else if (f.postmortemLagDays == null) add(r, 'POSTMORTEM-DATE-UNVERIFIABLE', 'Postmortem exists but its date cannot be verified');
      else if (f.postmortemLagDays > 14) add(r, 'POSTMORTEM-LATE', `Postmortem arrived ${f.postmortemLagDays} days after the incident (limit 14)`);
    }
    if (controlId === 'CC6.6') {
      const reviewed = f.properties?.['last-reviewed'] ?? f.properties?.['Last reviewed'];
      if (!reviewed) add(r, 'POLICY-REVIEW-DATE-MISSING', 'Policy has no recorded last-reviewed date');
      else { const age = daysBetween(reviewed, asOf); if (age != null && age > 365) add(r, 'POLICY-STALE', `Policy last reviewed ${age} days ago (limit 365)`); }
      if (!(f.properties?.Approver ?? f.properties?.approver)) add(r, 'POLICY-APPROVER-MISSING', 'Policy has no recorded approver');
    }
    if (controlId === 'CC6.3') {
      if (!RESOLVED.test(f.status ?? '')) add(r, 'LEAVER-OPEN', `Leaver removal still open (status: ${f.status ?? 'unknown'})`);
      else if (f.eventDate && f.resolvedAt) {
        const lag = businessDaysBetween(f.eventDate, f.resolvedAt);
        if (lag != null && lag > 5) add(r, 'LEAVER-REMOVAL-LATE', `Access removed after ${lag} business days (limit 5)`);
      } else add(r, 'LEAVER-DATES-MISSING', 'Leaver date or resolution date missing — removal time cannot be proven');
    }
    if (controlId === 'CC7.4') {
      const when = f.eventDate ?? f.properties?.['test-date'] ?? f.createdAt;
      const age = when ? daysBetween(when, asOf) : null;
      if (age == null) add(r, 'RESTORE-DATE-MISSING', 'Restore test has no verifiable date');
      else if (age > 92) add(r, 'RESTORE-TEST-STALE', `Latest restore test is ${age} days old (limit 92)`);
    }
    if (controlId === 'CC8.1' || controlId === 'CC6.1') {
      if (!f.approver) add(r, 'APPROVAL-MISSING', 'No approver recorded');
      if (!RESOLVED.test(f.status ?? '')) add(r, 'ITEM-OPEN', `Item still open (status: ${f.status ?? 'unknown'})`);
    }
    if (controlId === 'CC7.1') {
      if (RESOLVED.test(f.status ?? '') && f.eventDate && f.resolvedAt) {
        const lag = daysBetween(f.eventDate, f.resolvedAt);
        if (lag != null && lag > 30) add(r, 'VULN-SLA-BREACH', `Vulnerability closed after ${lag} days (limit 30)`);
      } else if (!RESOLVED.test(f.status ?? '')) add(r, 'VULN-OPEN', 'Vulnerability still open');
    }
    if (controlId === 'A.5.19') {
      const reviewed = f.properties?.['last-reviewed'] ?? f.properties?.['Last reviewed'];
      if (!reviewed) add(r, 'SUPPLIER-REVIEW-DATE-MISSING', 'Supplier review has no recorded review date');
      else { const age = daysBetween(reviewed, asOf); if (age != null && age > 365) add(r, 'SUPPLIER-REVIEW-STALE', `Supplier last reviewed ${age} days ago (limit 365)`); }
    }
  }
  findings.push(...sodFindings(records));
  return findings;
}
