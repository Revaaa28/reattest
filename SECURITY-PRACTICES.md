# ReAttest — Security Practices

ReAttest is developed and operated by Revly Rotty, a one-person
independent developer ("the developer"). This document records the
security practices actually followed for the ReAttest Forge app. It is
kept proportionate to a one-person operation and updated when practices
change. Last updated: 24 November 2026.

## Access control

- Only the developer has access to the source repositories, the
  Atlassian developer account, and deployment tooling (least privilege:
  there are no other accounts).
- Multi-factor authentication is enabled on the accounts used for
  development and operations.
- Credentials (API tokens, passwords) are kept in a password vault /
  secure storage, never in source code. The one local credential file
  used by deployment tooling is permission-restricted (0600) and
  git-ignored.

## Secure development lifecycle

- All code is under version control (Git). Changes follow a written
  build plan with phase gates.
- Every deployment must pass: `forge lint` with no issues, and the full
  unit-test suite (48 tests covering the verification engine, rules and
  canonicalization) with zero failures. A change that fails either gate
  is not deployed.
- Development and production use separate Forge environments.
- Dependencies are inventoried from the lockfile and scanned for known
  vulnerabilities (SCA) against the OSV database before Marketplace
  submissions. Scan of 24 Nov 2026 (65 packages): 3 advisories, all in
  transitive build/tooling packages inside the Atlassian Forge package
  tree (glob, minimatch); none are in code paths the app executes with
  customer data. They are tracked for upstream updates.
- The app additionally passes Atlassian's own EcoScanner security scan
  on every Marketplace submission. The one finding it has ever raised
  (AMS-77790, unauthenticated webtriggers) was remediated by removing
  the endpoints entirely and resubmitting.

## Secure coding practices

- Follow the Forge security best practices published by Atlassian.
- Verdict logic is deterministic and fail-closed: unreadable or missing
  evidence never produces a positive verdict.
- All resolver inputs are validated (control keys, item identifiers)
  before use; the app performs no user impersonation — UI resolvers run
  in the invoking user's context, and app-context calls are used only
  for app-level operations (scheduled verification), never to act with
  a specific user's permissions.

## Logging and monitoring

- The app itself maintains a timestamped, hash-chained verification
  ledger inside Forge hosted storage (its audit trail).
- Development and deployment activity is recorded in Git history and
  Forge deployment logs.

## Incident response

- Security reports are received at revlyrotty.rr@gmail.com (see
  SECURITY.md), acknowledged within 5 business days.
- On a confirmed incident: contain (disable or roll back the affected
  app version via Forge deployment), assess scope from the ledger and
  platform logs, fix, redeploy, and notify affected customers via the
  Marketplace listing and release notes. Relevant vulnerabilities are
  also reported to Atlassian through the AMS / ECOHELP process.

## Vulnerability management

- Intake: SECURITY.md disclosure address, Atlassian AMS tickets, and
  dependency scan results.
- Triage by severity; fixes are developed, gated by lint + full tests,
  deployed, and described in the Marketplace version release notes.
- Third-party library vulnerabilities are handled by updating the
  dependency (or its upstream) and redeploying; where the vulnerable
  package sits inside a vendor's own dependency tree, the finding is
  recorded and tracked until the vendor ships an update.

## Business continuity / disaster recovery

- The app is stateless on the vendor side: it runs entirely on
  Atlassian Forge inside each customer's own site, and its data lives
  in that site's Forge storage. The vendor holds no customer data, so
  there is nothing to restore on the vendor side.
- Source code is hosted on GitHub; any environment can be rebuilt and
  redeployed from the repository with the documented tooling.

## Third-party services and subprocessors

- For the app itself: none. ReAttest runs entirely on Atlassian Forge,
  has no external servers, and sends no data to third parties (see
  PRIVACY.md).
- For development only: GitHub (source hosting). No customer data is
  processed there.

## AI use

- The product includes an Atlassian Rovo agent (Forge `rovo:agent`)
  that explains verification results in natural language. Verdicts are
  computed by a deterministic rules engine; the AI layer never decides
  verdicts and receives no data outside the customer's own site.
- AI assistants are used during development. No customer data is sent
  to any external AI service by the app.
