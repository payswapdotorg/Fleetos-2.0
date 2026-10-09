# F300B Browser-Journey Scripts — Safety/Intelligence Surface

**Status:** lane-delivered scripts per WAVE10-HOST-CONTRACT §4. The TL
executes them against the F301 shell (`packages/web`, FleetOS application
identity) and records results bound to the deployed commit. Per the
contract's honesty law: if the shell is not yet reachable when these
scripts are due, the machine-run corpus (17 journeys,
`packages/acceptance/security`) + these scripts constitute lane evidence,
and the browser runs complete at F301/F302 — recorded honestly, never
fabricated.

**Surface under test:** `@fleetos/experience-safety-intel/host`
(`SAFETY_INTEL_HOST_SURFACE`, surfaceId `safety-intel`).

**Route manifest (7):** findings-board · evidence-chain · guardian-decision
· action-authorization · execution-results · inspect-why · advisory-board.
Suggested URL scheme: `/safety-intel/<routeId>` (TL's routing choice; the
scripts reference routes by the STABLE routeId, not by URL guess).

**Intent catalog (3, all inert):** `security.findings.request-remediation`
(builder `requestRemediation`) · `security.plans.propose-step` (builder
`proposeActionPlanStep`) · `security.advisory.request-refresh` (builder
`requestAdvisoryRefresh`). Drafts bind to the real control-plane submit at
the TL layer — a browser click must never execute anything directly.

**Recording template (every journey):** exact URL/environment, deployed
commit sha, persona, step-by-step expected-vs-actual, console/network
errors, screenshot refs. A refusal that renders honestly is a PASS; a
fabricated success is a FAIL.

## Index

1. [`guardian-e2e.md`](./guardian-e2e.md) — finding → evidence → Guardian
   decision → authorized action intent → execution result → verification +
   audit trail, end to end through the shell.
2. [`inspect-why-mission-replay.md`](./inspect-why-mission-replay.md) —
   inspect-why (decision provenance) + execution results/audit trail routes
   with replay records.
3. [`advisory-honesty.md`](./advisory-honesty.md) — the advisory board with
   provenance, uncertainty, model identity and the structural-vs-trained
   disclosure.
4. [`refusals-tenant-fail-closed.md`](./refusals-tenant-fail-closed.md) —
   Guardian refusals visible, tenant mismatch fail-closed, capability
   denial, honest not-composed states.
