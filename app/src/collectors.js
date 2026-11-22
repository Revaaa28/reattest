// ReAttest — live-source collectors (Forge runtime only).
// All reads run asUser: the app sees exactly what the installing user sees,
// and verdicts inherit that user's permissions (spec v1: reads asUser).
import { route } from '@forge/api';
import { requestJira, requestConfluence } from './forge-api.js';
import { canonicalJiraIssue, canonicalConfluencePage } from './core/canonical.js';
import { cosmeticView, fingerprint } from './core/engine.js';

async function jqlSearch(jql, max = 100) {
  const res = await requestJira(
    route`/rest/api/3/search/jql?jql=${jql}&maxResults=${max}&fields=${'summary,status,resolution,assignee,reporter,duedate,priority,labels,issuelinks,attachment,created,updated,comment,watches,approver'}&expand=changelog`
  );
  if (!res.ok) throw new Error(`JQL search failed: ${res.status}`);
  const data = await res.json();
  return data.issues ?? [];
}

function baseFacts(issue) {
  const f = issue.fields ?? {};
  let resolvedAt = null;
  for (const h of issue.changelog?.histories ?? []) {
    for (const item of h.items ?? []) {
      if (item.field === 'status' && /done|resolved|closed|complete/i.test(item.toString ?? '')) resolvedAt = h.created?.slice(0, 10) ?? resolvedAt;
    }
  }
  let eventDate = null;
  for (const [k, v] of Object.entries(f)) {
    if (/^customfield_/.test(k) && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { eventDate = v.slice(0, 10); break; }
  }
  return {
    status: f.status?.name ?? null,
    assignee: f.assignee?.accountId ?? null,
    reporter: f.reporter?.accountId ?? null,
    approver: f.approver?.accountId ?? null,
    createdAt: f.created?.slice(0, 10) ?? null,
    resolvedAt,
    eventDate: eventDate ?? f.created?.slice(0, 10) ?? null,
    dueDate: f.duedate ?? null,
    labels: f.labels ?? [],
    version: null,
    hasPostmortemLink: false,
    postmortemLagDays: null,
  };
}

// For CC7.2: a postmortem is a Confluence page linked as a remote link.
// Lag is measured honestly from data the platform stores: the page's
// creation date minus the incident date recorded on the page itself
// (property "incident-date"), falling back to the issue's creation date.
async function enrichPostmortem(issue, facts) {
  try {
    const res = await requestJira(route`/rest/api/3/issue/${issue.key}/remotelink`);
    if (!res.ok) return facts;
    const links = await res.json();
    const pm = (links ?? []).find((l) => /postmortem/i.test(l.object?.title ?? '') || /\/wiki\//.test(l.object?.url ?? ''));
    if (!pm) return facts;
    facts.hasPostmortemLink = true;
    const m = /pages\/(\d+)/.exec(pm.object?.url ?? '');
    if (!m) return facts;
    const pageId = m[1];
    const pres = await requestConfluence(route`/wiki/api/v2/pages/${pageId}`);
    if (!pres.ok) return facts;
    const page = await pres.json();
    const pageCreated = page.createdAt?.slice(0, 10);
    let incidentDate = facts.eventDate;
    const pmProps = await pageProperties(pageId);
    if (pmProps['incident-date']) incidentDate = String(pmProps['incident-date']).slice(0, 10);
    if (pageCreated && incidentDate) facts.postmortemLagDays = Math.round((new Date(pageCreated) - new Date(incidentDate)) / 86400000);
  } catch { /* enrichment is best-effort; missing data yields honest findings */ }
  return facts;
}

export async function collectJiraControl(control) {
  const issues = await jqlSearch(`${control.populationHint} ORDER BY created ASC`);
  const out = [];
  for (const issue of issues) {
    let facts = baseFacts(issue);
    if (control.id === 'CC7.2') facts = await enrichPostmortem(issue, facts);
    out.push({
      itemKey: issue.key,
      title: issue.fields?.summary ?? issue.key,
      canonical: canonicalJiraIssue(issue),
      cosmetic: cosmeticView(issue),
      facts,
    });
  }
  return out;
}

async function cqlSearch(cql, max = 100) {
  const res = await requestConfluence(
    route`/wiki/rest/api/content/search?cql=${cql}&limit=${max}&expand=${'body.storage,version,metadata.labels'}`
  );
  if (!res.ok) throw new Error(`CQL search failed: ${res.status}`);
  const data = await res.json();
  return data.results ?? [];
}

// NOTE: the v1 property-list endpoint returns 410 Gone through the Forge
// gateway on current Cloud instances (verified in forge logs 21 Nov 2026),
// although raw REST still answers it. Reads therefore use the v2 API.
async function pageProperties(pageId) {
  const props = {};
  const res = await requestConfluence(route`/wiki/api/v2/pages/${pageId}/properties?limit=${50}`);
  if (res.ok) {
    const data = await res.json();
    for (const p of data.results ?? []) props[p.key] = p.value;
  }
  return props;
}

export async function collectConfluenceControl(control) {
  const label = control.populationHint.replace('label = ', '');
  const pages = await cqlSearch(`type = page AND label = "${label}" ORDER BY created ASC`);
  const out = [];
  for (const page of pages) {
    const properties = await pageProperties(page.id);
    out.push({
      itemKey: `page:${page.id}`,
      title: page.title,
      canonical: canonicalConfluencePage(page, properties),
      cosmetic: {},
      facts: {
        status: page.status ?? 'current',
        version: page.version?.number ?? null,
        createdAt: null,
        author: page.version?.by?.accountId ?? null,
        properties,
        eventDate: properties['incident-date'] ?? properties['test-date'] ?? null,
      },
    });
  }
  return out;
}

export async function collectControl(control) {
  const records = control.source === 'jira' ? await collectJiraControl(control) : await collectConfluenceControl(control);
  for (const r of records) r.fingerprint = fingerprint(r.canonical);
  return records;
}
