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
