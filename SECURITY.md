# Security Policy

## Reporting a vulnerability

Email **revlyrotty.rr@gmail.com** with a description of the issue and
reproduction steps. Please do not open a public issue for security
reports. You should receive a reply within 5 business days.

## How ReAttest handles data

- ReAttest is an Atlassian Forge app. It runs entirely on Atlassian's
  Forge platform inside the customer's own Jira / Confluence site.
- All app data (evidence snapshots, fingerprints, verification history)
  is stored in Forge hosted storage provided by Atlassian. The app has
  no external servers and makes no network calls to third parties.
- No End-User Data is transmitted to, processed by, or stored on any
  system operated by the vendor.
- Verdicts are produced by a deterministic rules engine. No AI model
  receives customer data.
