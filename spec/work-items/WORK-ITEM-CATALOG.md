# FleetOS 2.0 Work Item Catalog

## Execution contract

Every item must include:

- objective;
- owned paths;
- dependencies;
- acceptance tests;
- deliverable evidence;
- rollback/recovery expectations.

Work items are the durable execution backlog. The TL dispatches from this file.

## Wave 0 — Repository conversion / architecture substrate

### F200A — FleetOS repository identity and ZCode substrate boundary
Owner: A

Convert ZCode identity assumptions in edge/runtime-facing surfaces into FleetOS-neutral abstractions without breaking inherited runtime behavior.

Acceptance:
- FleetOS naming is canonical at repository/product boundaries;
- upstream ZCode-only identity is isolated;
- runtime still boots;
- tests/builds pass.

### F200B — Canonical FleetOS contracts + bounded-context skeleton
Owner: B

Create contracts and package skeletons for the FleetOS domain kernel, Guardian, capabilities, missions, evidence and intelligence.

Acceptance:
- public contracts exist;
- dependency checks enforce boundaries;
- no domain implementation depends on UI/runtime internals.

### F200C — Work/control/commercial domain skeleton
Owner: C

Create work, project, workload, procurement, vendor, software, agent-organization and model-gateway bounded-context skeletons.

Acceptance:
- public contracts;
- tenant-aware interfaces;
- no business truth in ZCode runtime packages.

### F201 — TL architecture-governance harness
Owner: TL

Make FleetOS architecture rules executable:
- architecture policy;
- ownership validation;
- dependency report;
- work-item verification;
- contract snapshot;
- source-of-truth checks;
- repository freshness/consistency commands.

Dependencies: F200A/B/C.

## Wave 1 — Kernel and persistence

### F210A — Identity/Tenancy/Actor kernel
A

### F210B — Guardian/Capability/Action/Evidence kernel
B

### F210C — Mission/Workflow/Work/Project application kernel
C

### F211 — Transactional persistence + outbox + repository ports
TL

Dependencies:
- F201
- F210A/B/C

Parallelism:
F210A, F210B, F210C run concurrently.

## Wave 2 — Assets and operational truth

### F220A — ManagedAsset + DeviceTwin + Observation ingestion
A

### F220B — Security/Health/Recovery/Execution composition
B

### F220C — Workloads/Projects/Procurement/Vendor/Software
C

### F221 — Control-plane command bus + durable mission runtime
TL

Parallelism:
F220A/B/C fully concurrent after Wave 1 public contracts freeze.

## Wave 3 — Edge + intelligence

### F230A — FleetOS Edge Agent
A

Capabilities:
- enrollment;
- trust;
- telemetry;
- diagnostics;
- local evidence;
- command inbox;
- reconciliation.

### F230B — Predictive Twin + World Model
B

Capabilities:
- deterministic reference model;
- provenance;
- uncertainty;
- counterfactuals;
- model adapter seam;
- tenant/privacy enforcement.

### F230C — Agent Organization + Model Gateway
C

Capabilities:
- agent roles;
- capability budgets;
- model routing;
- provider fallback;
- organization configuration.

### F231 — Intelligence/application convergence
TL

Parallelism:
F230A/B/C concurrently; F231 after all three.

## Wave 4 — Experience

### F240A — Asset/field/mobile experiences
A

### F240B — Security/Guardian/Predictive experiences
B

### F240C — Work/Projects/Commerce experiences
C

### F241 — FleetOS Control Tower + universal command/search
TL

All three worker experience lanes run concurrently.
F241 converges after contracts are stable but may scaffold in parallel.

## Wave 5 — Integration ecosystem

### F250A — ADCOS + connectivity adapters
A

### F250B — Arena + learning/evaluation adapters
B

### F250C — Aurum + Apify + vendor/external adapters
C

### F251 — Integration health/convergence/retry/idempotency
TL

All three adapter lanes run concurrently.

## Wave 6 — Simulation and optimization

### F260A — Operational simulation worlds
A

### F260B — Predictive evaluation/replay/safety benchmarks
B

### F260C — Agent organization optimization
C

### F261 — FleetOS Engineering Lab product shell
TL

All three simulation lanes run concurrently.

## Wave 7 — Product acceptance

### F270A — Device/field acceptance journeys
A

### F270B — Security/action/intelligence acceptance journeys
B

### F270C — Work/commerce/project acceptance journeys
C

### F271 — Full industry adoption simulation + deployment acceptance
TL

Minimum acceptance population:
- 10 industries;
- small/medium/large firms;
- 30 real workspaces;
- 7 personas where applicable;
- 100+ repeatable journeys per firm where supported;
- mobile validation for every industry;
- cross-role handoffs;
- incumbent capability baseline;
- SWITCH-ONLY / MAIN-INTERFACE / COMPLEMENT / RETAIN verdicts.

## Wave 8 — Hardening and scale readiness

### F280A — Edge hardening / offline / fleet-scale ingestion
A

### F280B — Security, audit, replay, disaster recovery
B

### F280C — Commerce, SLA, vendor marketplace, production economics
C

### F281 — Production release gate / observability / cost controls
TL

## Wave 9 — Future industrial intelligence

Only start after the core product acceptance gate.

### F290A — Asset lineage / material / method graph
A

### F290B — Advanced world models / JEPA-family adapter implementations
B

### F290C — Industry-specific agent organizations and optimization
C

### F291 — Industrial intelligence convergence
TL

## Concurrency rules

- Tasks without explicit dependency edges are parallelizable.
- TL should keep workers continuously supplied with ready work.
- Workers may pre-build tests, fixtures, adapters, schemas and migration plans for their next item while blocked, but must not violate dependency contracts.
- A worker may not "reserve" a task by leaving code in another worker's ownership path.
- Every merged worker lane must reduce, not increase, integration uncertainty.


## Wave 10 — Product closure and deployed acceptance

This phase substantiates product-level claims after the Wave 0–9 implementation ledger. It does not erase or silently reopen completed work. Read `docs/tech-lead/PRODUCT-CLOSURE-HANDOFF.md`.

### F300A — Asset/field experience and end-to-end device journeys
Owner: A

Connect and verify the asset/field experience using real composed FleetOS state. Cover Device 360, health/observations/evidence, approved recovery/maintenance, field/mobile journeys where supported, and tenant separation.

Dependencies: completed Waves 0–9 baseline; shared integration contract from TL.

Acceptance: browser journeys against real product paths; exact commit; tests/typecheck/lint; limitations and evidence recorded.

### F300B — Security, Guardian and predictive experience
Owner: B

Connect and verify finding/evidence/Guardian/action/execution/verification/audit journeys; show refusals, tenant protection, provenance and advisory-only predictive outputs honestly. Do not claim trained predictive accuracy for structural reference models.

Dependencies: completed Waves 0–9 baseline; shared integration contract from TL.

Acceptance: positive and negative/refusal browser journeys; exact commit; tests/typecheck/lint; evidence of honest model/output labeling.

### F300C — Work/commerce integration reality and adoption coverage
Owner: C

Verify work/project/workload/procurement/quote/order/handoff surfaces. Classify each external connector as LIVE_VERIFIED, SANDBOX_VERIFIED, CONTRACT_ONLY or BLOCKED with evidence. Improve parameterization and distinct scenario coverage toward the existing adoption target (100 counted journeys per firm where supported); do not count identical reruns or silently lower the threshold.

Dependencies: completed Waves 0–9 baseline; shared integration contract from TL.

Acceptance: exact commit; tests/typecheck/lint; integration status matrix; updated adoption counts, limitations and journey evidence.

### F301 — FleetOS application shell and product convergence
Owner: TL

Integrate the FleetOS experience packages into the actual web/desktop host as supported. Verify FleetOS identity, navigation, Control Tower, Device 360/field, safety/intelligence, work/commerce and Engineering Lab surfaces; role switching and tenant scopes where supported; typed command path, Guardian checks and verified outcomes. Keep ZCode as generic substrate; do not place FleetOS business authority in generic runtime/provider/UI/RPC packages.

Dependencies: F300A/B/C for final convergence; non-conflicting shell inspection/scaffolding may run in parallel.

Acceptance: deployed browser evidence tied to an exact commit; at least one complete UI-to-real-domain journey from each worker lane; negative states render honestly; no placeholder shown as operational truth.

### F302 — Clean-checkout final gate and release decision
Owner: TL

Run clean-checkout install, source-of-truth/snapshot/architecture checks, lint, typecheck, full package tests, build and all six acceptance suites. Verify the deployed candidate matches the tested commit. Update the product acceptance report, residual risks, runbook and AI_CONTINUATION.

Dependencies: F300A/B/C merged and F301 integrated.

Acceptance: machine-captured commands/counts at exact HEAD; browser/deployment evidence; integration status matrix; explicit READY/NOT READY with named blockers.

### Wave 10 parallelism

F300A, F300B and F300C run concurrently within their existing ownership boundaries. F301 may inspect/prepare non-conflicting application integration work in parallel but does not edit worker-owned paths. F302 closes only after the lanes and product convergence have been verified.


## Wave 11 — Final release-blocker closure

Canonical handoff: `docs/tech-lead/FINAL-RELEASE-HANDOFF.md`. The Wave 10 F302 verdict remains NOT READY until these tasks are verified or a release decision is explicitly recorded.

### F310A — Full root typecheck on a suitable builder
Owner: A (verification lane; no out-of-scope edits)

Run `corepack pnpm typecheck` from a clean checkout at the exact candidate SHA on a builder with at least 8 GB RAM and without the resident workload that caused the recorded OOM. Capture environment, command output, exit code and tested commit. Do not hide a failure behind per-package checks or loosen compiler settings to force a green result.

Acceptance: the full root typecheck passes and the report identifies the exact tested SHA; otherwise keep B-1 open with a reproduction and repair proposal.

### F310B — Full monorepo build with complete tooling
Owner: B (verification lane; code repairs require an explicit owned-path assignment)

Run the frozen install with required lifecycle scripts/tooling enabled, then `corepack pnpm -r --no-bail build` on a suitable builder. Verify inherited web, desktop, server and CLI/SEA targets as well as FleetOS packages. Record every package outcome; the standalone FleetOS shell build does not substitute for the full monorepo gate.

Acceptance: full build passes at the exact candidate SHA; otherwise B-2 remains open and every failing package has a reproduction, owner and scoped repair item.

### F310C — Adoption coverage closure and decision packet
Owner: C

Reconcile the F302 figures (1,575 counted executions, 58 journeys per fully applicable firm, target 100, shortfall 42). Map missing journey coverage to actual capabilities/personas and decide which genuinely distinct scenarios are supported now, require real new capability, or are legitimately inapplicable. Add only scenarios backed by real behavior; never count identical reruns or weaken the target silently. C must not edit TL-owned adoption-ledger paths without an explicit scoped grant.

Acceptance: a machine-verifiable per-firm/industry ledger and a written recommendation to TL/user. If truthful supported journeys cannot reach 100, present the explicit choices and preserve NOT READY pending a recorded decision; do not self-authorize a threshold change.

### F311 — Release convergence, integration status and deployment truth
Owner: TL

Merge and verify permitted deliveries by exact SHA. Reconcile adoption counts and release baselines; inspect the actual public deployment and its commit identity; distinguish fixture-composed demo state from durable operational persistence; preserve the current CONTRACT_ONLY status for every connector absent live/sandbox proof.

Acceptance: coherent report backed by current tree and commit-bound browser/deployment evidence; no placeholder success or silently omitted limitations.

### F312 — Final clean-checkout gates and release decision
Owner: TL

Run frozen install, source-of-truth, snapshot, architecture, lint, root typecheck, full monorepo tests, each of the six acceptance suites, and full recursive build from a clean checkout. Capture exact commands, counts, exit codes, environment and SHA. Then browser-verify the candidate product deployment and update F302/product acceptance/residual risks/runbook/AI_CONTINUATION.

Acceptance: explicit READY only if all required gates pass and the adoption criterion and deployment/persistence scope are resolved; otherwise explicit NOT READY with named blockers and next actions.

### Wave 11 parallelism

F310A, F310B and F310C run concurrently and do not edit one another's owned paths. F311 can prepare non-conflicting convergence while lanes run, but final recomputation starts after lane evidence arrives. F312 executes only after F311 convergence and candidate SHA freeze.
