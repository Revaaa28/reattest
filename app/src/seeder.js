// ReAttest — Demo Seeder: plants the fictional fintech "Meridian Pay"
// dataset (spec v2 §4) into the CURRENT site so a judge sees a living pack
// fast. Refactored 21 Nov 2026: PARALLEL batches (the sequential version
// took ~2 min, over the Forge time limits) and IDEMPOTENT (existing items
// are reused, so a re-run or a half-finished run heals instead of
// duplicating). All dates are real stored values (page properties), never
// backdated created fields — the platform cannot backdate those, and
// pretending otherwise would be fabrication.
import { route } from '@forge/api';
import { requestJira, requestConfluence } from './forge-api.js';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const p = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const warnings = [];

async function firstProjectKey() {
  const res = await requestJira(route`/rest/api/3/project`);
  const projects = await res.json();
  const pick = (projects ?? []).find((x) => !x.projectTypeKey?.includes('personal')) ?? projects?.[0];
  if (!pick) throw new Error('No Jira project found on this site');
  return pick.key;
}
async function firstSpace() {
  const res = await requestConfluence(route`/wiki/rest/api/space?limit=${25}`);
  const data = await res.json();
  const results = data.results ?? [];
  const pick = results.find((s) => s.type === 'global') ?? results[0];
  if (!pick) throw new Error('No Confluence space found on this site');
  return pick;
}
async function myAccountId() {
  try {
    const res = await requestJira(route`/rest/api/3/myself`);
    if (!res.ok) return 'compliance-lead';
    const me = await res.json();
    return me.accountId ?? 'compliance-lead';
  } catch { return 'compliance-lead'; }
}

let cachedSpaceId = null;
async function spaceIdFor(spaceKey) {
  if (cachedSpaceId) return cachedSpaceId;
  const res = await requestConfluence(route`/wiki/api/v2/spaces?keys=${spaceKey}`);
  const data = await res.json();
  cachedSpaceId = data.results?.[0]?.id;
  if (!cachedSpaceId) throw new Error(`space ${spaceKey} not found via v2 API`);
  return cachedSpaceId;
}

async function findPage(spaceKey, title) {
  const res = await requestConfluence(route`/wiki/rest/api/content/search?cql=${`space = "${spaceKey}" AND title = "${title}"`}`);
  if (!res.ok) return null;
  const data = await res.json();
  const hit = (data.results ?? [])[0];
  return hit ? { id: hit.id } : null;
}
async function pageUrl(pageId) {
  const v1 = await requestConfluence(route`/wiki/rest/api/content/${pageId}`);
  if (v1.ok) { const pj = await v1.json(); if (pj._links?.base && pj._links?.webui) return pj._links.base + pj._links.webui; }
  return `pages/${pageId}`;
}

// Confluence v1 content creation is REMOVED on current Cloud instances
// (410 Gone) — pages are created via the v2 API; labels still work on v1,
// properties are written via v2 (verified live 21 Nov 2026).
async function createPage(spaceKey, title, bodyHtml, labels, properties) {
  const existing = await findPage(spaceKey, title);
  if (existing) return { id: existing.id, url: await pageUrl(existing.id), reused: true };
  const spaceId = await spaceIdFor(spaceKey);
  const res = await requestConfluence(route`/wiki/api/v2/pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId: String(spaceId), status: 'current', title, body: { representation: 'storage', value: bodyHtml } }),
  });
  if (!res.ok) throw new Error(`create page "${title}" failed: ${res.status} ${await res.text()}`);
  const page = await res.json();
  await Promise.all([
    ...labels.map((name) => requestConfluence(route`/wiki/rest/api/content/${page.id}/label`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ prefix: 'global', name }]),
    })),
    ...Object.entries(properties ?? {}).map(([key, value]) => requestConfluence(route`/wiki/api/v2/pages/${page.id}/properties`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }),
    })),
  ]);
  return { id: page.id, url: await pageUrl(page.id), reused: false };
}

async function findIssue(projectKey, summary) {
  const jql = `project = ${projectKey} AND summary ~ "${summary.replace(/"/g, '')}"`;
  const res = await requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=${5}&fields=${'summary'}`);
  if (!res.ok) return null;
  const data = await res.json();
  const hit = (data.issues ?? []).find((i) => i.fields?.summary === summary);
  return hit ? { key: hit.key } : null;
}
async function resolveIssue(issueKey) {
  const tres = await requestJira(route`/rest/api/3/issue/${issueKey}/transitions`);
  if (!tres.ok) return;
  const tdata = await tres.json();
  const t = (tdata.transitions ?? []).find((x) => /done|resolved|closed|complete/i.test(x.to?.name ?? x.name ?? ''));
  if (t) {
    await requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition: { id: t.id } }),
    });
  }
}
async function createIssue(projectKey, summary, labels, description, resolve) {
  const existing = await findIssue(projectKey, summary);
  if (existing) { if (resolve) await resolveIssue(existing.key); return { key: existing.key, reused: true }; }
  const res = await requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { project: { key: projectKey }, summary, issuetype: { name: 'Task' }, labels, description: p(description) } }),
  });
  if (!res.ok) throw new Error(`create issue "${summary}" failed: ${res.status} ${await res.text()}`);
  const issue = await res.json();
  if (resolve) await resolveIssue(issue.key);
  return { key: issue.key, reused: false };
}
async function linkExists(issueKey, url) {
  const res = await requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`);
  if (!res.ok) return false;
  const links = await res.json();
  const pageId = /pages\/(\d+)/.exec(url ?? '')?.[1];
  return (links ?? []).some((l) => l.object?.url === url || (pageId && new RegExp(`pages/${pageId}(/|$)`).test(l.object?.url ?? '')));
}
async function remoteLink(issueKey, url, title) {
  if (await linkExists(issueKey, url)) return;
  const res = await requestJira(route`/rest/api/3/issue/${issueKey}/remotelink`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ object: { url, title } }),
  });
  if (!res.ok && !(await linkExists(issueKey, url))) {
    warnings.push(`remote link for ${issueKey} failed: ${res.status} (run the seeder from the app UI if app-user linking is restricted)`);
  }
}

export async function seedDemo(spaceKeyOverride) {
  const started = Date.now();
  warnings.length = 0;
  const projectKey = await firstProjectKey();
  const space = spaceKeyOverride ? { key: spaceKeyOverride } : await firstSpace();
  const me = await myAccountId();

  const pageDefs = [
    ['Postmortem: Payments API outage', '<p>Root cause: connection pool exhaustion. Actions completed.</p>', ['postmortem'], { 'incident-date': daysAgo(3) }],
    ['Postmortem: Checkout latency incident', '<p>Root cause: unbounded cache growth. Write-up completed late.</p>', ['postmortem'], { 'incident-date': daysAgo(21) }],
    ['Access Control Policy', '<p>Access is granted on least-privilege principles and reviewed quarterly.</p>', ['policy'], { 'last-reviewed': daysAgo(60), Approver: 'compliance-lead' }],
    ['Password Policy', '<p>Passwords must be at least 14 characters.</p>', ['policy'], { 'last-reviewed': daysAgo(30), Approver: me }],
    ['Information Security Policy', '<p>Umbrella security policy for Meridian Pay.</p>', ['policy'], { 'last-reviewed': daysAgo(400), Approver: 'compliance-lead' }],
    ['Restore test — production database', '<p>Restore completed in 42 minutes; integrity checks passed.</p>', ['restore-test'], { 'test-date': daysAgo(100) }],
    ['Restore test — file storage', '<p>Restore completed in 18 minutes; checksums verified.</p>', ['restore-test'], { 'test-date': daysAgo(20) }],
    ['Supplier review — CloudHost Ltd', '<p>Annual review: SOC 2 Type II report on file, no exceptions.</p>', ['supplier-review'], { 'last-reviewed': daysAgo(90) }],
  ];
  const pages = await Promise.all(pageDefs.map(([t, b, l, pr]) => createPage(space.key, t, b, l, pr)));
  const [pm1, pm2] = pages;

  const issueDefs = [
    ['Incident: Payments API outage', ['incident'], 'Payments API unavailable for 23 minutes.', true, pm1, 'Postmortem: Payments API outage'],
    ['Incident: Checkout latency spike', ['incident'], 'Checkout p95 latency rose above 4 seconds.', true, pm2, 'Postmortem: Checkout latency incident'],
    ['Incident: Email delivery failure', ['incident'], 'Transactional email delayed up to 2 hours.', true, null, null],
    ['Leaver: Dedi — remove all access', ['leaver'], 'Employment ended; remove all system access.', false, null, null],
    ['Leaver: Sari — remove all access', ['leaver'], 'Employment ended; remove all system access.', true, null, null],
    ['Change: Deploy billing v2.4', ['change'], 'Routine production deployment.', true, null, null],
    ['Vulnerability: XSS in customer portal', ['vuln'], 'Reflected XSS reported by internal test.', false, null, null],
    ['Access grant: production read for Bimo', ['access-grant'], 'Read-only production access for incident support.', true, null, null],
  ];
  const issues = await Promise.all(issueDefs.map(([s, l, d, r]) => createIssue(projectKey, s, l, d, r)));
  await Promise.all(issueDefs.map(([, , , , pm, pmTitle], i) => (pm ? remoteLink(issues[i].key, pm.url, pmTitle) : Promise.resolve())));

  return {
    status: 'SEEDED', projectKey, spaceKey: space.key,
    created: { pages: pages.map((x) => x.id), issues: issues.map((x) => x.key) },
    reused: { pages: pages.filter((x) => x.reused).length, issues: issues.filter((x) => x.reused).length },
    warnings: [...warnings],
    seconds: Math.round((Date.now() - started) / 1000),
  };
}
