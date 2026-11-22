# ReAttest — audit evidence that must still be true

ReAttest is an Atlassian Forge app for Jira and Confluence that keeps SOC 2 /
ISO 27001 evidence **continuously verified** instead of collected once.

It freezes an evidence population per control, fingerprints every item, and
re-verifies each one against its live source for the whole observation
window. When evidence silently changes, disappears, or was never complete,
ReAttest reports exactly what changed — field by field — before your auditor
finds it.

An auditor never has to trust the app: the full verification history is a
hash-chained ledger that can be recomputed **offline** from an exported pack
with [`scripts/verify-export.mjs`](app/scripts/verify-export.mjs).

## Why

A SOC 2 Type II audit samples evidence across a 3–12 month window. Teams
assemble that evidence by hand in the last weeks — screenshots without dates,
files without owners, populations built after the fact. Auditors reject it,
and evidence that *was* true in March may have quietly changed by October.
In December 2025 a major compliance platform was caught auto-generating
evidence. ReAttest is the opposite stance:

- **Deterministic verdicts.** Every verdict — VERIFIED, CHANGED, STALE,
  INCOMPLETE, MISSING, UNREADABLE — comes from a rules engine, never from an
  LLM. AI (a Rovo agent) explains findings; it cannot create or clear one.
- **Fail closed.** Anything unreadable is UNREADABLE, never VERIFIED.
- **Precision is published.** Cosmetic changes (comments, watchers, version
  bumps, formatting-only whitespace) do not flip a verdict. Populations are
  recomputed from the same query at snapshot and re-verify; drift is reported
  as its own finding, item by item.
- **Data never leaves Atlassian.** The app runs entirely on Forge; evidence
  stays in your Jira and Confluence.

## Controls

| Depth | Controls |
| --- | --- |
| Deep — frozen population, fingerprint, rules | CC7.2 incident response · CC6.6 / A.5.15 policy currency · CC6.3 access removal · CC7.4 recovery testing |
| Light — freshness + completeness | CC8.1 change · CC6.1 access provisioning · CC7.1 vulnerability SLA · A.5.19 supplier review |

Every item also passes four quality gates — **DATED, NAMED, SOURCED,
POPULATION-BOUND** — and a segregation-of-duties check flags evidence approved
by its own author.

## Measured on a live Atlassian site (21 Nov 2026)

A scripted fixture planted known changes against the deployed app:

- **20/20** material edits caught as CHANGED, each with a named field diff
- **7/7** cosmetic traps stayed VERIFIED (zero false alarms)
- **5/5** omission traps detected (deleted, trashed, unlabelled, population
  emptied, unbound new item named as drift)
- Demo company (15 items, 8 controls) seeds from empty in **10 seconds**
- Offline verifier recomputed all 16 ledger runs from a real export; a copy
  with one altered fingerprint **failed at exactly the altered run**

## Surfaces

- **Jira dashboard** — pack status, per-control drill-down, Judge Mode
  one-click demo company (Meridian Pay, a fictional fintech)
- **Rovo agent** — asks and answers over the same deterministic engine
- **MCP tools** — external AI clients can check pack status, list gaps,
  verify an item, and fetch provenance
- **Drift Watch** — a weekly scheduled re-verification
- **Offline verifier** — `node scripts/verify-export.mjs pack.json`

## Layout

- `app/` — the Forge app (manifest, resolvers, engine, dashboard UI)
- `app/src/core/` — canonicalization, fingerprinting, rules (pure, tested)
- `app/scripts/verify-export.mjs` — the standalone offline verifier

MIT licensed. Built solo for Codegeist 2026.
