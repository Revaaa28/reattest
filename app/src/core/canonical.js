// ReAttest spike — canonical evidence payload builders.
// Only evidence-bearing fields enter the canonical payload (spec v3 §3).
// Volatile fields (updated timestamps, counts, watchers, worklogs) are
// deliberately EXCLUDED so legitimate noise never flips a verdict.

function accountId(user) {
  return user ? user.accountId ?? null : null;
}

function normalizeBody(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/>\s+</g, '><') // whitespace between tags is formatting, not content
    .replace(/\s+/g, ' ') // collapse whitespace runs inside text
    // Whitespace at block boundaries renders identically in HTML, so it is
    // formatting, not content. Inline tags are NOT touched: a space before
    // </b> mid-sentence changes the rendered text.
    .replace(/ +<\/(p|div|li|td|th|tr|h[1-6]|blockquote|ul|ol|table|section|article)>/g, '</$1>')
    .replace(/<(p|div|li|td|th|tr|h[1-6]|blockquote|ul|ol|table|section|article)> +/g, '<$1>')
    .replace(/<br\s*\/?>/gi, '<br/>')
    .trim();
}

// Jira issue -> canonical payload
export function canonicalJiraIssue(issue) {
  const f = issue.fields ?? {};
  const links = (f.issuelinks ?? [])
    .map((l) => {
      const other = l.outwardIssue ?? l.inwardIssue;
      return other ? `${l.type?.name ?? '?'}:${other.key}` : null;
    })
    .filter(Boolean)
    .sort();
  const attachments = (f.attachment ?? [])
    .map((a) => ({ filename: a.filename, size: a.size, hash: a.contentHash ?? null }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  // Evidence-date / approver custom fields are passed in by config:
  const custom = {};
  for (const key of Object.keys(f)) {
    if (/^customfield_/.test(key) && f[key] != null && typeof f[key] !== 'object') {
      custom[key] = f[key];
    }
  }
  return {
    type: 'jira-issue',
    key: issue.key,
    summary: f.summary ?? null,
    status: f.status?.name ?? null,
    resolution: f.resolution?.name ?? null,
    assignee: accountId(f.assignee),
    reporter: accountId(f.reporter),
    approver: accountId(f.customfield_approver ?? null) || (f.approver ? accountId(f.approver) : null),
    duedate: f.duedate ?? null,
    priority: f.priority?.name ?? null,
    labels: [...(f.labels ?? [])].sort(),
    issuelinks: links,
    attachments,
    custom,
  };
}

// Confluence page -> canonical payload
export function canonicalConfluencePage(page, properties = {}) {
  const labels = (page.metadata?.labels?.results ?? page.labels ?? [])
    .map((l) => l.name ?? l)
    .sort();
  return {
    type: 'confluence-page',
    id: String(page.id),
    title: page.title ?? null,
    version: page.version?.number ?? null,
    bodyHashSource: normalizeBody(page.body?.storage?.value ?? ''),
    labels,
    properties: Object.fromEntries(
      Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))
    ),
  };
}

// Stable stringify: object keys sorted recursively, arrays kept in order
// (callers sort order-sensitive arrays themselves).
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}
