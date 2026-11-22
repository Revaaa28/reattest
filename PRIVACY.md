# ReAttest — Privacy Policy

Effective: 22 November 2026

ReAttest is an Atlassian Forge app for Jira and Confluence. This policy
describes what data the app accesses, where it is stored, and what never
happens to it.

## The short version

ReAttest runs entirely on Atlassian's Forge platform, inside your own
Atlassian site. It has no servers of its own, sends no data anywhere else,
and stores everything it creates in the storage Atlassian provisions for the
app within your installation.

## What the app accesses

To verify audit evidence, ReAttest reads — only on the site where it is
installed:

- Jira issues in the projects you point it at (fields needed to evaluate the
  controls you enable: status, assignees, labels, dates, linked items)
- Confluence pages in the spaces you point it at (titles, bodies, version
  metadata, and the content properties used as evidence dates/approvers)
- Remote links between those items (for example, an incident issue linked to
  its postmortem page)

## What the app stores

Inside Atlassian-provisioned app storage (Forge Key-Value Store) on your
site:

- Frozen evidence populations and their content fingerprints
- Verification verdicts, findings, and the hash-chained verification ledger
- Exception records you create in the app

Uninstalling the app removes this stored data in accordance with Atlassian's
Forge data-removal practices.

## What the app never does

- It never sends your data to any server outside Atlassian.
- It never sells, rents, or shares your data with third parties.
- It contains no advertising, analytics, or tracking.
- It never modifies your Jira or Confluence content, except for the demo
  dataset it creates when you explicitly run the built-in demo seeder in
  your own site.

## AI features

The optional Rovo agent answers questions using the app's stored verdicts.
Verdicts themselves are produced by a deterministic rules engine; no
evidence content is sent to any external AI service by the app.

## Contact

Questions about this policy or the app: revlyrotty.rr@gmail.com
