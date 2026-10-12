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

Status: **DONE** — delivered `3bc3df5`, merged `3dee6d1`. Evidence: `docs/evidence/F310A/report.md` (B-1 census + P1-P5; the OOM resolved, the 220 real errors found). B-1 subsequently CLOSED by the TL repairs (P2(a) dedicated shell project + P3 the 62 shell errors) with `TYPECHECK_EXIT=0` at `f0c0921` (run `38018805250`), re-validated at the converged tree.

### F310B — Full monorepo build with complete tooling
Owner: B (verification lane; code repairs require an explicit owned-path assignment)

Run the frozen install with required lifecycle scripts/tooling enabled, then `corepack pnpm -r --no-bail build` on a suitable builder. Verify inherited web, desktop, server and CLI/SEA targets as well as FleetOS packages. Record every package outcome; the standalone FleetOS shell build does not substitute for the full monorepo gate.

Acceptance: full build passes at the exact candidate SHA; otherwise B-2 remains open and every failing package has a reproduction, owner and scoped repair item.

Status: **DONE** — delivered `c0591f6`, merged `1d840e2`. B-2 CLOSED at `da3f99ee`: `BUILD_EXIT=0`, 75/75 packages, scripts ON, all four substrate targets green. Evidence: `docs/evidence/F310B/report.md`.

### F310C — Adoption coverage closure and decision packet
Owner: C

Reconcile the F302 figures (1,575 counted executions, 58 journeys per fully applicable firm, target 100, shortfall 42). Map missing journey coverage to actual capabilities/personas and decide which genuinely distinct scenarios are supported now, require real new capability, or are legitimately inapplicable. Add only scenarios backed by real behavior; never count identical reruns or weaken the target silently. C must not edit TL-owned adoption-ledger paths without an explicit scoped grant.

Acceptance: a machine-verifiable per-firm/industry ledger and a written recommendation to TL/user. If truthful supported journeys cannot reach 100, present the explicit choices and preserve NOT READY pending a recorded decision; do not self-authorize a threshold change.

Status: **DONE** — delivered `f1d7515`, merged `6455526`. Corpus 21->31, counted 1,848, cap 68, shortfall 32 (target retained); the 42-slot mapping + decision packet (recommended Option 2). Evidence: `docs/evidence/F310C/report.md`. B-3 remains the sole substantive blocker pending the Wave-12 roadmap or a user decision.

### F311 — Release convergence, integration status and deployment truth
Owner: TL

Merge and verify permitted deliveries by exact SHA. Reconcile adoption counts and release baselines; inspect the actual public deployment and its commit identity; distinguish fixture-composed demo state from durable operational persistence; preserve the current CONTRACT_ONLY status for every connector absent live/sandbox proof.

Acceptance: coherent report backed by current tree and commit-bound browser/deployment evidence; no placeholder success or silently omitted limitations.

Status: **DONE** — lanes merged at exact commits; release re-pin `886cefa`; all six suites green at `8c97ac8`; deployment/persistence honestly scoped (sandbox static, fixture-composed, no durable persistence, connectors CONTRACT_ONLY). Record: `docs/evidence/F302/report.md` §8-10.

### F312 — Final clean-checkout gates and release decision
Owner: TL

Run frozen install, source-of-truth, snapshot, architecture, lint, root typecheck, full monorepo tests, each of the six acceptance suites, and full recursive build from a clean checkout. Capture exact commands, counts, exit codes, environment and SHA. Then browser-verify the candidate product deployment and update F302/product acceptance/residual risks/runbook/AI_CONTINUATION.

Acceptance: explicit READY only if all required gates pass and the adoption criterion and deployment/persistence scope are resolved; otherwise explicit NOT READY with named blockers and next actions.

Status: **DONE** — final candidate `8c97ac8`; gates machine-captured on the 16 GB builder (run `38022898223`); verdict **NOT READY** with B-3 the sole substantive blocker (68/100 vs the retained target). Record: `docs/evidence/F302/report.md` §11.

### Wave 11 parallelism

F310A, F310B and F310C run concurrently and do not edit one another's owned paths. F311 can prepare non-conflicting convergence while lanes run, but final recomputation starts after lane evidence arrives. F312 executes only after F311 convergence and candidate SHA freeze.


## Wave 12 — Adoption coverage with explicit provider-readiness boundary

**Canonical execution handoff:** `docs/tech-lead/FINAL-RELEASE-HANDOFF.md`.

**Starting status:** Wave 11 B-1 and B-2 are closed. B-3 remains open at cap 68/100 (1,848 counted executions, 30 firm workspaces). The target remains 100 distinct counted journeys per firm where applicable. **Aurum, ADCOS and Arena are not provider-ready** and remain CONTRACT_ONLY. Locally exercised contract behavior must not be reported as a live provider integration.

### F320 — TL pre-dispatch time-parameterization/count-law decision
Owner: TL. Must precede F321A/B/C implementation.

Record the distinct-journey law for time/epoch parameterization. A case counts only where a real input/state/time boundary produces meaningful, asserted domain behavior; a changed timestamp or byte-identical rerun does not count. Define deterministic expected outcomes and tests. If the distinction cannot be proven, do not count the cases; proceed on the non-parameterized path. Keep the adoption ledger and release count pins TL-owned.

Acceptance: a reviewed, versioned decision in TL-owned evidence; tests/laws named; no relaxation of duplicate, determinism or mask-honesty rules.

Status: **DONE** — the Distinct-Journey Count Law is frozen at `docs/evidence/F320/report.md` (grounded in source inspection at `dc4b5e2`): D2 defines the four-condition epoch-distinctness test; **Wave 12 ruled NON-PARAMETERIZED** because every declared epoch anchors at `ADOPTION_T0` (firms.ts:88), field expectations are T0-calibrated with at most 12-16 of 20 journeys time-responsive, and the commerce/security runner parameterization behind the 170-ceiling does not exist. Row 36 stays deferred as TL-owned capability work with the D6 activation shape. No path grants to lanes; adoption ledger and release pins remain TL-owned.

### F321A — Field/edge/asset adoption journeys
Owner: A. Run concurrently with F321B/C after F320.

Use the F310C §3.3 proposals. Implement ten genuine scenarios where feasible, including offline/store-and-forward, diagnosis/anomaly, evidence-gated recovery, maintenance scheduling, asset/material lineage, identity/session and tenant lifecycle. The proposed `adcos-session-trust` slot is excluded as provider-ready work while ADCOS is not ready; substitute a real non-ADCOS domain journey or leave the slot uncounted.

Acceptance: unique IDs, real public API calls, meaningful positive/negative/refusal assertions, deterministic reproduction, honest applicability, exact SHA, typecheck/lint/package and field-suite results, evidence under A-owned paths.

### F321B — Safety/execution/audit/intelligence adoption journeys
Owner: B. Run concurrently with F321A/C after F320.

Use the F310C §3.4 proposals. Implement ten genuine local-domain scenarios across audit ledger, finding storms/suppression, verified execution, compensation, capability-store DR, outcomes/adoption, predictive honesty and degradation/staleness. The proposed `arena-evaluation-runs` slot is excluded as provider-ready work while Arena is not ready; replace it with a real non-Arena domain journey or leave the slot uncounted.

Acceptance: unique IDs, real public APIs, meaningful refusal/security/provenance assertions, deterministic reproduction, honest model labeling, exact SHA and relevant B-owned gate evidence.

### F321C — Work/commerce adoption journeys
Owner: C. Run concurrently with F321A/B after F320.

Deliver the three F310C §3.2 deferred journeys where supported. `marketplace-publication-lifecycle` is local-domain work and may proceed. `actor-job-failure-expiry` may be tested as a local contract/lifecycle only and does not mark Apify live. The proposed `aurum-delta-sync-session` slot is excluded as provider-ready work while Aurum is not ready; substitute a distinct non-Aurum work/commerce journey or leave it uncounted.

Acceptance: unique IDs, existing public domain API calls, meaningful assertions/refusals, no claimed remote success, exact SHA and C-owned commerce/package tests, typecheck and lint evidence.

### F322 — TL convergence, count recomputation and disposition
Owner: TL. Depends on F320 and all F321 lane evidence.

Verify ownership and exact commits; reject superficial or provider-dependent substitutes; merge/converge; update the TL-owned adoption ledger and release pins; machine-run all 30 workspaces; report firm-by-firm counts/masks/shortfalls; run full clean-checkout gates and browser-verify the tested candidate SHA. Update F302, product acceptance, residual risks, runbook if needed, and AI_CONTINUATION.

Acceptance: B-3 closes only if the target is met honestly under the approved count law. Otherwise mark NOT READY with the remaining shortfall and a next capability plan. Do not lower the target or broaden masks.

### F323 — Aurum/ADCOS/Arena provider readiness and end-to-end integration (DEFERRED)
Owner: TL with A/B/C integration lanes, but **do not begin live implementation until the corresponding upstream provider is ready**.

Entry criteria: explicit upstream readiness and version, versioned supported API/event contracts, real or supported sandbox endpoints, approved runtime credential provisioning (no secrets committed), and an executable smoke test. Once available, A owns ADCOS, B owns Arena and C owns Aurum in parallel; TL owns secrets/configuration composition, health/retry/idempotency, contract convergence and end-to-end gates.

Acceptance per provider: independent smoke-test and audit evidence for authentication, tenant boundary, success/refusal/error handling, retries/idempotency, rate limits and reconciliation. Set SANDBOX_VERIFIED or LIVE_VERIFIED only when the named evidence passes. Until then the status is CONTRACT_ONLY / provider not ready.

### Wave 12 concurrency and dependency rules

- F320 is a short TL-owned preflight; F321A, F321B and F321C then execute concurrently with exactly three implementation workers.
- Each worker may edit only its owned paths; adoption ledger, convergence delta and release pins remain TL-owned unless a written scoped grant says otherwise.
- F323 is explicitly deferred and must not block F321 scenarios that use real local domain behavior without those providers.
- No synthetic telemetry, repeated runs, dummy success, fake remote calls, weakened target or unjustified mask changes count as completion.


## Wave 12 live status addendum — 2026-10-11 (post-F322 convergence)

This status addendum complements the F320/F321/F322/F323 acceptance contracts above. It records delivery/evidence state, not a release approval.

| Item | Status | Verified record / next gate |
|---|---|---|
| F320 — Distinct-Journey Count Law | **DONE** | `docs/evidence/F320/report.md`; frozen NON-PARAMETERIZED law D1–D6. |
| F321A — A field/edge/asset expansion | **DELIVERED; CONVERGED** | `docs/evidence/F321A/report.md`; lane tip `ffb4119`, merged `7ea9b00`; ten journeys/227 assertions (slot-21 replaced by the non-ADCOS `ingestion-limits-admission-discipline`); gates run `38146799222` (B-1/B-2 SUCCESS, field 79/79). |
| F321B — B safety/intelligence expansion | **DELIVERED; CONVERGED** | `docs/evidence/F321B/report.md`; merged `1d1d67f`; ten journeys/431 assertions, security suite 151/151. |
| F321C — C work/commerce expansion | **DELIVERED; CONVERGED** | `docs/evidence/F321C/report.md`; lane tip `2408201`, merged `ceb55df`; three journeys/95 assertions (slot-12 replaced by the non-Aurum `vendor-directory-service-relationship`); gates run `38160560665` (B-1/B-2 SUCCESS, commerce 98/98). |
| F322 — TL convergence/final release gate | **DONE — verdict NOT READY** | `docs/evidence/F322/report.md`; converged corpora 30/34/27; counted 2,523; cap 91/100 (shortfall 9); pins re-pinned and six suites GREEN at `16e35e8` (run `38165177822`); frozen candidate `5c3d18f` (run `38165903409`). B-3 remains OPEN with the §3.5 capability plan. |
| F323 — Aurum/ADCOS/Arena integrations | **DEFERRED — UPSTREAM NOT READY** | Keep each provider CONTRACT_ONLY until its own real/supported sandbox or live smoke-test evidence passes. |

### Wave 12 converged adoption totals (machine-run, post re-pin)

- Counted executions: 1,848 → **2,523** (+675: F321A +300, F321B +300, F321C +90 − 15 masked).
- Unique applicable journeys (industry-sum semantics): 616 → **841**.
- Fully applicable firm cap: 68 → **91** (field 30 + commerce 34 + security 27); remaining shortfall: **9** against the unchanged target of 100.
- Mask change (TL adjudication of F321C §7): `actor-job-failure-expiry` masked in the five industries already masking `apify-actor-job`, rationales mirrored verbatim.
- Six acceptance suites at the converged, re-pinned tree: field 79/79, security 151/151, commerce 98/98, adoption GREEN (pins exact), release GREEN (pins exact), convergence 82/82.

### Next wave (capability-backed, target 100 unchanged)

The F310C §3.5 rows remain the honest path: row 36 (honest time-parameterization under the F320 D2 epoch-distinctness law — the highest-leverage single item), rows 34–35 (marketplace transactions; tenant billing — worker C), rows 37–39 (validated predictive model; live connectors gated on F323; edge OTA campaigns — worker A). No target lowering, no mask broadening, no synthetic counts.

---

## Wave 14 — the small-firm remainder (F340 freeze, 2026-10-13)

### F340 — Wave-14 preflight: the remainder freeze
Owner: TL. DONE at dispatch time — `docs/evidence/F340/report.md` (machine census at `15a4f4b`: 5 verified candidates — A1 observations backpressure, A2 retention/projections, A3 sim-worlds checkpoint determinism, B1 evidence artifact-store, B2 world-context windowing; journal compaction + command storm have NO API = new-capability class, NOT remainder; the D14-D17 law; honest arithmetic: 5 land → small fully-applicable firms 99, +1 D17 slot → 100).

### F341A — worker A: the three field remainder journeys
Owner: A. Per F340 §4: A1 backpressure discipline, A2 retention projections, A3 checkpoint determinism. Acceptance: census citations, corpus laws, field suite green grow-only, exact SHA + owned-path diff + gate evidence. Optional D17 sixth-slot proposal with census evidence.

### F341B — worker B: the two security remainder journeys
Owner: B. Per F340 §4: B1 artifact-store completeness, B2 world-context windowing. Acceptance: same laws; security suite green grow-only. Optional D17 sixth-slot proposal with census evidence.

### F342 — TL convergence, recount + verdict
Owner: TL. Recount the ledger at the converged tree; re-pin; full battery; the honest verdict per F340 §3 (if 5 land: 99/100, NOT READY with a named 1-journey remainder; if a D17 sixth lands: 100, B-3 closes for fully-applicable firms; medium/large already closed at 102-110).

## Wave 13 — epoch-count activation + capability rows (frozen by F330)

### F330 — Wave-13 epoch-count law activation freeze
Owner: TL. DONE at dispatch time — `docs/evidence/F330/report.md` (machine census: 7/30 field journeys respond — 4 count-eligible, 2 rewrite-eligible, 1 past-only excluded; frozen D9 schedules medium [T0, T0+30d] / large [T0, T0+30d, T0+90d]; proof form D10; worker boundary D11; commerce/security census-before-variants D12; never-count D13). Lanes execute against this freeze; the counting gate lands only at F332.

### F331A — field epoch parameterization + edge OTA campaigns
Owner: A. Per F330 §4: per-epoch expectation tables + distinctness proofs for the 4 count-eligible field journeys; echo-class rewrites for the 2 eligible (or honest non-rewrite); field runner epoch-execution capability (D10 proof form); row 39 edge firmware/OTA campaign module + journeys. Acceptance: census citations, per-epoch tables machine-proven distinct (D2(c)/(d) enforced), field suite green at T0, exact SHA + owned-path diff + gate evidence.

### F331B — security time seam + census + parameterization
DELIVERED + MERGED (w13b6, lane tip `8c36df3`, merge `6a0d1ed`): `docs/evidence/F331B/report.md` — the startedAt seam threaded through all 27 journeys with byte-identity machine-proven at every batch; the D12 census machine-measured 27x8 at the 7-delta grid; 2 transition-class responders at +365d ONLY (crossing ~+206.4d, OUTSIDE the frozen D9 schedule) — schedule-excluded; 6 echo-uniform non-responders; 19 byte-identical invariants; the D10 parameterization set is EMPTY (zero security journeys carry per-epoch tables) — security stays 27 journeys single-counted at T0, no law weakened. TL gates at `8c36df3`: security 166/166, typecheck 0, oxlint 0w/0e, boundary CLEAN.
Owner: B. Add the security runner time seam (zero behavior change at T0, 151/151 green); record the security census (F330 §1.1 method, full table in the lane report); parameterize census-certified responders per D10. Acceptance: seam + census + any variants machine-proven; security suite green; exact SHA + evidence.

### F331C — marketplace transactions + tenant billing + commerce seam
Owner: C. Row 34 marketplace transaction flow package; row 35 tenant billing/invoicing package; commerce time seam + census (D12) + parameterize responders; new journeys per corpus laws. Acceptance: real APIs, refusals, determinism, ≥5 assertions each; commerce suite green; exact SHA + evidence.

### F332 — TL convergence, counting-gate activation and disposition
Owner: TL. Depends on F330 + all F331 lane evidence. Adjudicate every epoch variant against D2/D8–D13; merge; land the adoption counting gate + D9 schedules; recompute the 30-workspace ledger; re-pin; full clean-checkout gates on the frozen candidate; browser-verify; verdict per the B-3 closure condition (every fully-applicable firm at 100; per-size honesty — small firms bounded by single journeys). Do not lower the target or broaden masks.
DELIVERED (TL-delegated worker session, two phases): `docs/evidence/F332/report.md` — D9 schedules + the counting gate landed INACTIVE (phase 1 `7471a9c`, INACTIVE-parity machine-proven), activation flipped as its own commit (`889bb75`), ACTIVE ledger machine-measured (2,847 counted; 8 census-certified journey IDs; 10 firms at 100+; every shortfall structural), adoption/release re-pinned, security stays TODO-F332-SECURITY (F331B platform-blocked); TL retains merge gates + verdict + browser verification. TL VERDICT (2026-10-12, merged main `6a0d1ed`): phase-1 merged `d462dd0`, final merged `8497044`; the TODO-F332-SECURITY marker's substance satisfied by the F331B census result (EMPTY parameterization set — security contributes 27 T0-counted journeys, epochs inapplicable); all six suites + maintenance GREEN at the converged tree (field 97, security 166, commerce 115, adoption 120, release 88, convergence 82, maintenance 99). WAVE-13 VERDICT: CONVERGED. B-3 per F330 §3 (unlowered): medium/large fully-applicable firms CLOSED at 100+ (102-110; the F330 arithmetic held and commerce epochs added beyond it); small firms NOT closed (94 — the 6-single-journey §3.6-c remainder, named as the post-Wave-13 gap, NOT fabricated); masked industries NOT closed (structural masks byte-identical to base). RELEASE DISPOSITION: NOT READY — every fully-applicable firm has not honestly reached 100 (small at 94), public production deployment + durable operational persistence remain undemonstrated (sandbox/static + fixture-composed only), and Aurum/ADCOS/Arena remain CONTRACT_ONLY.

### Standing rules (Wave 13)
- F323 stays DEFERRED (providers CONTRACT_ONLY; no lane drives provider APIs; row 38 out of scope).
- Row 37 (validated predictive model) deferred to Wave 14.
- Workers may not touch TL-owned adoption/release paths (D11 — no grant issued).
