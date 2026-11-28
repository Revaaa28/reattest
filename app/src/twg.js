// Teamwork Graph client wrapper (F4).
// Rules (from f4-study-twg-mcp.md, official docs + field reports):
// - asUser only; there is no asApp path for TWG.
// - Always send a conforming operation name ([company]_[operation]).
// - HTTP 200 does NOT mean success — always inspect the errors array.
// - A missing/ungranted read:graph:* scope yields SILENT empty results,
//   so an empty connection is ambiguous. Callers must treat empty or
//   errored results as INCOMPLETE (fail-closed), never as "no data".
import api from '@forge/api';

export async function twgQuery(query, variables = {}) {
  let res;
  try {
    res = await api.asUser().requestTeamworkGraph(query, variables);
  } catch (e) {
    return { ok: false, complete: false, errors: [{ message: `request failed: ${e.message}` }], data: null };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    return { ok: false, complete: false, errors: [{ message: 'non-JSON TWG response' }], data: null };
  }
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  return {
    ok: errors.length === 0,
    complete: errors.length === 0,
    errors,
    data: body?.data ?? null,
  };
}

// Collect every page of a Relay connection field. Returns the nodes plus a
// completeness flag: false when any page errored (fail-closed semantics).
// The first error list seen is carried through so callers can say WHY a
// relation is incomplete instead of swallowing the reason.
export async function twgCollect(runPage) {
  const nodes = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const r = await runPage(after);
    if (!r.ok || !r.connection) return { nodes, complete: false, errors: r.errors ?? [] };
    for (const e of r.connection.edges ?? []) if (e?.node) nodes.push(e.node);
    if (!r.connection.pageInfo?.hasNextPage) return { nodes, complete: true, errors: [] };
    after = r.connection.pageInfo.endCursor;
    if (!after) return { nodes, complete: false, errors: [] };
  }
  return { nodes, complete: false, errors: [] }; // exceeded page budget — treat as incomplete
}

// --- Provenance (F4 build) -------------------------------------------------
// Schema facts below are LIVE-VERIFIED on this site (spike probes, 2026-11-28):
// JiraWorkItem has NO `title` field (it is `summary`); the page creator and
// contributor connections return a UNION whose only member is AtlassianUser
// { id, accountId, name, email }; work-item ARIs are
// ari:cloud:jira:<cloudId>:issue/<numericId>, page ARIs are
// ari:cloud:confluence:<cloudId>:page/<pageId>.
import { getTwgCloudId, putTwgCloudId } from './store.js';

const REPORTED_ONE_QUERY = `
query reattest_cloudId($userId: ID!) {
  atlassianUserReportedJiraWorkItems(userId: $userId, first: 1) {
    edges { node { ... on JiraWorkItem { id } } }
  }
}`;

// The site cloudId is needed to build item ARIs. It is derived from a real
// work-item ARI returned by the graph itself (never hardcoded), then cached.
export async function getCloudId(accountId) {
  const cached = await getTwgCloudId();
  if (cached) return cached;
  if (!accountId) return null;
  const res = await twgQuery(REPORTED_ONE_QUERY, {
    userId: `ari:cloud:identity::user/${accountId}`,
  });
  const ari = res?.data?.atlassianUserReportedJiraWorkItems?.edges?.[0]?.node?.id;
  const m = /^ari:cloud:jira:([^:]+):/.exec(ari ?? '');
  if (!m) return null;
  await putTwgCloudId(m[1]);
  return m[1];
}

const PAGE_PEOPLE_QUERY = `
query reattest_pagePeople($id: ID!) {
  confluencePageCreator(id: $id, first: 25) {
    edges { node { ... on AtlassianUser { id accountId name } } }
    pageInfo { hasNextPage endCursor }
  }
  confluencePageContributors(id: $id, first: 25) {
    edges { node { ... on AtlassianUser { id accountId name } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const userNode = (n) => (n ? { accountId: n.accountId ?? null, name: n.name ?? null } : null);

// Provenance for one Confluence page. Any graph error (including the
// platform's unresolvable-author nodes seen in the spike) marks the result
// incomplete — callers surface that honestly instead of claiming the page
// has no provenance.
export async function pageProvenance(cloudId, pageId) {
  const ari = `ari:cloud:confluence:${cloudId}:page/${pageId}`;
  const res = await twgQuery(PAGE_PEOPLE_QUERY, { id: ari });
  if (!res.ok) return { source: 'teamwork-graph', ari, complete: false, errors: res.errors };
  const creators = (res.data?.confluencePageCreator?.edges ?? []).map((e) => userNode(e?.node)).filter(Boolean);
  const contributors = (res.data?.confluencePageContributors?.edges ?? []).map((e) => userNode(e?.node)).filter(Boolean);
  return {
    source: 'teamwork-graph',
    ari,
    complete: true,
    creator: creators[0] ?? null,
    contributors,
  };
}

const ISSUE_COMMENTS_QUERY = `
query reattest_issueComments($id: ID!, $after: String) {
  jiraWorkItemComments(id: $id, first: 25, after: $after) {
    edges {
      node {
        ... on JiraWorkItemComment {
          id
          createdAt
          author { ... on AtlassianUser { accountId name } }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ISSUE_PRS_QUERY = `
query reattest_issuePullRequests($id: ID!, $after: String) {
  jiraWorkItemLinkedExternalPullRequests(id: $id, first: 25, after: $after) {
    edges { node { __typename } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ISSUE_GOALS_QUERY = `
query reattest_issueGoals($id: ID!, $after: String) {
  jiraWorkItemGoals(id: $id, first: 25, after: $after) {
    edges { node { __typename } }
    pageInfo { hasNextPage endCursor }
  }
}`;

// Provenance for one Jira work item: its graph-recorded discussion
// (comment authorship — who engaged with this evidence, and when), plus
// linked pull requests and goals. Comment BODIES are deliberately not
// read: provenance is about who and when, not what was said.
export async function issueProvenance(cloudId, numericIssueId) {
  const ari = `ari:cloud:jira:${cloudId}:issue/${numericIssueId}`;
  const collect = (query, field) =>
    twgCollect(async (after) => {
      const r = await twgQuery(query, { id: ari, after });
      return { ok: r.ok, connection: r.data?.[field] ?? null, errors: r.errors };
    });
  const [comments, prs, goals] = await Promise.all([
    collect(ISSUE_COMMENTS_QUERY, 'jiraWorkItemComments'),
    collect(ISSUE_PRS_QUERY, 'jiraWorkItemLinkedExternalPullRequests'),
    collect(ISSUE_GOALS_QUERY, 'jiraWorkItemGoals'),
  ]);
  const complete = comments.complete && prs.complete && goals.complete;
  const rel = (c) => ({
    complete: c.complete,
    count: c.nodes.length,
    ...(c.complete ? {} : { errors: c.errors }),
  });
  return {
    source: 'teamwork-graph',
    ari,
    complete,
    comments: {
      ...rel(comments),
      entries: comments.nodes.slice(0, 25).map((n) => ({
        at: n.createdAt ?? null,
        author: userNode(n.author),
      })),
    },
    linkedPullRequests: rel(prs),
    goals: rel(goals),
  };
}
