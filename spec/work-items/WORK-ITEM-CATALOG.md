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
DONE on `work/f341a` (base `81be8e7`; published to origin — the push-channel record is in the lane report §7-L1): the three F340-census remainder journeys + the TL-adjudicated D17 sixth slot (observations kernel immutability-audit, delivered exactly as proposed) — field suite 97→102 green, corpus 31/390/607 → 35/444/708 grow-only, boundary clean (acceptance/field + evidence + this line); evidence at `docs/evidence/F341A/report.md`.

### F341B — worker B: the two security remainder journeys
Owner: B. Per F340 §4: B1 artifact-store completeness, B2 world-context windowing. Acceptance: same laws; security suite green grow-only. Optional D17 sixth-slot proposal with census evidence.
DONE on `work/f341b` (base `5c2ba68`, NEWER than the packet's reference — recorded per the base-check law): B1 evidence-artifact-store-completeness (4 steps / 40 assertions; the Promise-signature family driven at module evaluation via top-level await, the F321B async-dispatch law extended) + B2 world-context-windowing (5 steps / 53 assertions; maturity gating, inclusive boundary honesty, windowing≠staleness both directions) — security suite 166→179 green grow-only (8 files), corpus 27/70/933 → 29/79/1026 machine-probed (every base digest byte-identical), simulation 2967→3027 with manufacturing/energy-utilities small firms AT 100 (the B-3 closure, exactly the F342 pre-staged arithmetic); D17 NOT proposed (restraint recorded with census evidence); boundary clean; evidence at `docs/evidence/F341B/report.md`.

### F342 — TL convergence, recount + verdict
Owner: TL. Recount the ledger at the converged tree; re-pin; full battery; the honest verdict per F340 §3 (if 5 land: 99/100, NOT READY with a named 1-journey remainder; if a D17 sixth lands: 100, B-3 closes for fully-applicable firms; medium/large already closed at 102-110).
DONE on `work/f342` (base `1103acf`, exactly the packet's expected post-F341B base): the recount + re-pins + verdict inputs, every number machine-measured on the converged tree — simulation 2847→3027 (+180 = the 6 Wave-14 journeys × 30 firms: field 1059→1179, commerce 1017 unchanged, security 771→831, uniqueApplicable 871→931; the epoch-count ledger unchanged at 234 — the Wave-14 journeys are single-epoch T0); every firm +6 counted, B-3 arithmetic machine-realized (manufacturing + energy-utilities small firms AT exactly 100 = 94+6; 17 firms ≥ 100; aggregate shortfall 205→97 with every remaining shortfall mask-structural); re-pins in adoption/** (7 test files + convergence-delta.ts: LANE_EXTENSIONS +F341A @e954ec8 / +F341B @46e948c, CURRENT_TREE_COUNTS 35/36/29, cap 94→100 = the B-3 closure with the anti-inflation invariant) + the release test expectations (corpora 35/29; the ka6-driven NOT-READY verdict pins) — expectation values only, never logic; the measured ka6 record: the A-lane D17 journey `observations-kernel-immutability-audit` asserts the FIXTURE tenant (`tnt_field-accept-01`) while the adoption runner threads each firm's REAL tenant → 30 failing execution facts, one per firm (pre-existing per F341B §6-L4, regime-specific — the field suite itself is green 102/102), pinned honestly as tripwires: allJourneysPassed=false with the exact 30-fact set, manufacturing SWITCH-ONLY→MAIN-INTERFACE (distribution 0/6/4/0), and the release gate's REAL-stack verdict NOT-READY with the NAMED ACCEPTANCE_FAILED/acceptance.adoption blocker — recorded for the TL's adjudication (the fix is a field-package change outside the F342 boundary), in addition to the standing qualifications (masked industries structural, production deployment + persistence undemonstrated, providers CONTRACT_ONLY); full battery ALL GREEN at the converged tree (adoption 120/120 with the new pins, field 102, security 179 — the packet's stale pre-F341B 168 corrected to the measured 179, commerce 115, release 88/88 with the new pins, convergence 82, maintenance 99; typecheck exit 0 + oxlint 0w/0e on adoption + release; boundary CLEAN — 11 code paths + the evidence report + this line); the verdict per F340 §3 is the TL's — the measured inputs support B-3 CLOSED for fully-applicable firms and the release REMAINING NOT READY; evidence at `docs/evidence/F342/report.md`.

### F343 — the ka6 fix + micro re-convergence
Owner: A (the fix runner; the defect is TL-root-caused, the packet specifies the EXACT 2-line fix). Base `863800b` (the packet). The 2-line regime-honest fix (ops/f341a-kernel.ts `kern.ctxTenant` reading + journeys/f341a-kernel.ts ka6 `reading-equals`), the D17 digest-transition re-pins, adoption allJourneysPassed/ratio resolutions, the measured release-gate verdict; counts must NOT change (3027/1179/1017/831/931). DISPATCHED (w14d3): the packet pushed; the worker dispatch fought the afternoon GLM-5.3 capacity peak 13:22Z-15:33Z without landing when sandbox recycle #13 killed the poller — no branch, no wedge state; RE-DISPATCH queued post-recovery.
DELIVERED on `work/f343` (base `e9c7b40`, the post-recycle main carrying the packet + the Wave-15 freeze): the 2-line fix landed EXACTLY as packeted (kern.admit readings + `"kern.ctxTenant": ctx.tenantId`; ka6 `reading-equals` vs `k4.kern.ctxTenant`, description/reading unchanged — plus one mechanical third line, the now-unused `TENANT` import drop required by the lint-clean law, recorded in the evidence §1) — regime-honest in BOTH regimes; the measured transition: 30 failing execution facts → 0 (all 30 firms' ka6 notes cleared), allJourneysPassed false → true, manufacturing 99/100 MAIN-INTERFACE ratio 0.99 → 100/100 SWITCH-ONLY ratio 1.0 (distribution back to 1/5/4/0), the release gate's REAL-stack verdict NOT-READY with the NAMED ACCEPTANCE_FAILED/acceptance.adoption blocker → READY with zero blockers (both entry points); COUNTS UNCHANGED 3027/1179/1017/831/931 (+ raw 406/897, honest counts 17/116/97); the D17 digest transitions machine-recorded (field `544c03ea`→`4defcfa2`; report `b4094bbb`→`ff96d224`; every OTHER journey byte-identical — the grow-only law holds except the fix target; zero literal-digest pins existed, so zero digest pin churn); the F342 tripwire re-pins in 4 adoption test files + 2 release test files (expectation values only, incl. the honest tamper-direction flips back to forged-false/forged-NOT-READY at the green baseline and the multi-degradation list back to 5 codes), convergence-delta/industries/verdicts/convergence UNTOUCHED (count-based); full battery ALL GREEN (field 102/102 fixture regime preserved, security 179/179, commerce 115/115, convergence 82/82, maintenance 99/99, adoption 120/120 + release 88/88 with the new pins; typecheck exit 0 + oxlint 0w/0e on field+adoption+release; byte-identical reruns); boundary CLEAN (5 code paths + the evidence report + this line); evidence at `docs/evidence/F343/report.md`.

## Wave 15 — deployment + durable-persistence qualification (F350 freeze, 2026-10-13)

### F350 — Wave-15 preflight: the qualification-law freeze
Owner: TL. DONE at dispatch time — `docs/evidence/F350/report.md` (the machine census: the F301/F312 shell composition — 8 files / 1,463 lines, fixture-composed world, REAL in-browser command queue, the :3105 deployment of record dead since recycle #13; the F302 §10 honest gap restated; the qualification law Q1-Q5: service-owned operational state, SIGKILL restart-recovery machine-proven, browser E2E at the exact candidate, honest scoping never overclaim, zero corpus/count motion; the F351A lane contract with the D11-analog grant — deployment/composition are TL-owned, granted for exactly this item; the masked-industry F351B disposition: capability-backed plan, NOT dispatched this wave).

### F351A — deployment + durable-persistence qualification lane
Owner: A (under the F350 §3 grant; TL gates every line at merge). One Node service :3106 (static shell + durable API; append-only JSONL segments commands/audit/assets; write-before-ack; replay-on-start; idempotency + tenant-scoping exactly as the in-process contracts), the shell durable-mode adapter (same port contracts; fixture WORLD stays the domain-input convention), the restart-recovery proof script (seed → kill -9 → restart → byte-exact digest match), browser E2E at the lane-tip SHA incl. restart-survival. Acceptance: Q1-Q5 machine-run; six suites green with pins untouched; boundary strict (packages/web/src/fleetos/** + infrastructure/fleetos-durable/** + evidence + this line); evidence at `docs/evidence/F351A/report.md`.
DELIVERED on `work/f351a` (base `761161b`, the post-F343 merge; code commit `ab3a85d` — the SHA the shell was built at, footer-proven): the service (node:http only, fixed :3106, no new top-level deps — the REAL @fleetos domain packages composed through ESM resolve hooks over the workspace's raw-TS exports) serving the static shell + the durable API over three append-only fsync-before-ack JSONL segments (commands = REAL control-plane records, one line per UNIQUE enqueue; audit = one line per submission attempt incl. duplicates and refusals, +tenantId for fail-closed scoped reads; assets = REAL EnrollmentRecords + their kernel AuditEventRefs), replay-on-start re-driving every segment through the same REAL CommandQueue/EnrollmentDirectory with canonical-JSON byte-exact verification per record (mismatch = fail-closed refusal to start), idempotency exactly the REAL queue's law (duplicate logical intent → the ORIGINAL ack, duplicate=true, never a second enqueue — machine-observed live), tenant-scoping fail-closed end to end; the shell adapter (port.ts/durable.ts/durable-panel.tsx + main/pages rework; ?mode=durable toggle, in-process default with zero acceptance-path changes, service-unreachable reported honestly, fixture WORLD untouched); the supervisor-keep script (restart-survival as a deployment property) + the Q2 proof script (seed 2 enrollments across 2 tenants + 3 commands incl. one duplicate and one refused → digest → kill -9 → restart → re-digest): exit 0, all four digests byte-exact (commands b525423f…, audit bfd3e5cf…, assets 3c53205f…, total 51136351…), raw segment sha256s unchanged, tenant-scoped state reads identical; browser E2E at `ab3a85d` through the DURABLE service via the UI: all six routes render, the enroll → submit → ack(cmd_0000000001) → duplicate=true(same id) → out-of-vocabulary-refusal-verbatim journey, tenant/role switching re-composing per-tenant durable state (no cross-tenant leak — Meridian reads the empty-set digests), and the in-browser restart-survival demo (kill -9 under the supervisor while the page stays open, refresh → identical in-page digests 4bd00f76/3b9ee2b5/9bcb1669/ad7c11fe, records and enrollment timestamps intact, footer SHA unchanged, zero console errors); the in-process mode regression-verified unchanged; the battery: field 102/102, security 179/179, commerce 115/115, convergence 82/82, maintenance 99/99, adoption 120/120 + release 88/88 — counts 3027/1179/1017/831/931 UNCHANGED with zero acceptance paths in the diff; root typecheck exit 0 + service tsc exit 0 + oxlint 0w/0e on the lane's paths (6 pre-existing dead-import warnings removed); file law ≤381 lines max; boundary CLEAN (4 new+3 modified shell files + 12 service files + evidence + this line); honest limitations recorded (sandbox-hosted on localhost:3106 — no public-internet claim; process-crash durability via fsync, not power-loss; providers CONTRACT_ONLY; fixture world = domain-input convention — only the operational plane is durable; actor shape/scope validation, not authentication); evidence at `docs/evidence/F351A/report.md`.

### F352 — TL convergence, deployment re-verification + final disposition
Owner: TL. After F351A merges: full battery at the converged tree; Q2/Q3 re-run by the TL at the exact converged SHA; counts ledger confirmed unchanged (3027/1179/1017/831/931); the wave verdict + release disposition per FINAL-RELEASE-HANDOFF §11; documentation updates (catalog rows, AI_CONTINUATION.md, the issue-#3 disposition comment, RESIDUAL-RISKS.md).
DONE 2026-10-13 at the converged tree `88b8506` (the F351A merge; identical tree to the gated lane tip `be46b01`): the full battery machine-run by the TL — field 102/102, security 179/179, commerce 115/115, convergence 82/82, maintenance 99/99, adoption 120/120, release 88/88; counts 3027/1179/1017/831/931 machine-locked in three green suites; typecheck exit 0 on all 13 projects (sequential per-project under the 4GB ceiling) + service tsc exit 0; oxlint 0w/0e on the 19 lane files. Q2 re-run at `88b8506` (service log commit-proven): exit 0, all four digests byte-exact across SIGKILL+restart. Q3 re-run at `88b8506`: shell rebuilt footer-proven at the merge SHA, isolated supervisor + fresh data dir, E2E through the UI (ENQUEUED cmd_0000000001, duplicate=true original ack), SIGKILL → supervisor generation 2 → browser reload → audit digest `58e85f85…a4a06` byte-identical. DISPOSITION per FINAL-RELEASE-HANDOFF §11: **READY with named standing qualifications** (sandbox-hosted single-port; fsync process-crash durability; fixture WORLD = domain-input convention — the operational plane is what is durable; providers CONTRACT_ONLY; masked industries structural). Evidence: `docs/evidence/F352/report.md`.

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

## Wave 16 — masked-industry coverage (F351B capability tranches, opened by operator word 2026-10-14)

### F351B — masked-industry coverage, tranche 1 (mining + construction)
Owner: A. Per F350 §4 (the binding disposition): close the two single-mask industries' small-firm shortfall with NEW genuinely-applicable journeys — mining −2, construction −3 → both at ≥100 counted (B-3 closes for both; medium/large already ≥100). Capability-backed: REAL unexercised public APIs in the persona-relevant packages (assets/work/workloads/projects/procurement/health/connectivity per the TL pre-scan); EXISTING masks byte-identical; per-industry applicability honestly declared (D15-strict; industries.ts granted for NEW journey-id mask entries only — the F350-pattern D11-analog grant). Acceptance: census citations, D14 journey form, field suite green grow-only, measured closure arithmetic, exact SHA + owned-path diff + evidence at `docs/evidence/F351B/report.md`.
DELIVERED (work/f351b, base `4f59ffe`): `docs/evidence/F351B/report.md` — the machine census over the 9 persona-relevant packages (unexercised 42/16/11/9/14/20/37/22/16; the stage-ADVANCEMENT family recorded covered per D16, the closeout/archival mechanic delivered instead); 5 census-certified D14 journeys (67 steps / 100 assertions / 21 REAL refusal steps) over assets registry lifecycle, work-order supersession, project closeout, procurement Guardian-law ordering, health threshold escalation; industries.ts +4 NEW mask lines, 0 removed (byte-identical existing); field suite 102 → 107 green grow-only, corpus barrel 35 → 40, typecheck + lint exit 0; MEASURED (not pinned): mining small 98 → 103, construction small 97 → 102 (B-3 closes for both; ledger 3027 → 3171 counted, shortfall 97 → 47, 23 firms ≥ 100, determinismVerified true, allJourneysPassed true); adoption pins honestly stale for the F353 TL re-pin.
ACCEPTED + MERGED (F353, main `5d74b5c` via merge `10de683`): TL lane gate at `da6a8e9` machine-green (field 107/107 grow-only; corpus barrel 40; industries.ts 0 removals / exactly 4 NEW entries, existing byte-identical; typecheck exit 0; oxlint 0w/0e; file law max 245; determinism byte-identical; boundary CLEAN 24 paths). Independent recount at the integrated tree reproduces the lane report exactly — see `docs/evidence/F353/report.md`.

### F353 — TL convergence, tranche-1 recount + re-pin + disposition update
Owner: TL. Packet: `docs/tech-lead/packets/f353.md`. After F351B merges: recompute the 30-workspace ledger at the converged tree; re-pin (corpus counts, simulation ledger, cap, per-firm expectations — TL-owned transitions only); full battery (six suites + release; typecheck + lint); grow-only + never-weaken verified on every counted number; the disposition update (which standing qualifications converted; the masked-industries remainder restated honestly); documentation (catalog rows, AI_CONTINUATION.md, issue #3 comment, RESIDUAL-RISKS.md). Do not lower the target or broaden masks.
DONE (2026-10-14, converged candidate `5d74b5c`): `docs/evidence/F353/report.md` — the full battery green at the exact tree (field 107/107, security 179/179, commerce 115/115, convergence 82/82, maintenance 99/99, adoption 120/120 re-pinned from measured values, release 88/88; typecheck exit 0 on all root substrate projects sequentially + the durable service; oxlint 0w/0e); MEASURED ledger 3171/1323/1017/831/979, determinismVerified true, allJourneysPassed true, 23 firms >= 100, aggregateShortfall 97 -> 47; B-3 closes for mining (98->103) + construction (97->102), honest bonus telecom/water-waste small AT 100 + agriculture large 102; the anti-inflation tripwire evolved to the never-regress form (cap >= 100 + cap == corpus sum; F350 §4 sanctioned growth); masks: existing byte-identical, only the lane's +4 NEW entries; remaining masked-industry residual restated (agriculture -20, healthcare -13, facilities -11, transportation -3).

### F351C — masked-industry coverage, tranche 2 (telecommunications + water-waste)
DELIVERED (worker C, branch `work/f351c`, base `cb572b8`): `docs/evidence/F351C/report.md` — census-first over procurement/vendors/software/work (12 candidate rows, grep-proven zero coverage, D16 screen); 5 fleet-universal commerce journeys over the REAL unexercised public APIs (ProcurementDirectory.createOrder law-A5 authorization, matchVendors, compareQuotes, rollupVendorKpis + capabilityCatalogSummary, createDocumentIdempotent + computeRequestDigest); commerce suite 115 → 133 green grow-only, corpus 36 → 41 machine-verified, byte-identical determinism incl. the full simulation; lane-local measured: telecom small 95 → 100 and water-waste small 95 → 100 (B-3 closes for both; every firm +5, shortfall 97 → 44); zero mask changes, zero declarative proposals (all five universal); recorded-not-delivered candidates honestly logged; TL re-pins at F354.
ACCEPTED + MERGED (F354, main `1033be5` via merge `678c7bf`): TL lane gate at `0207559` machine-green (commerce 133/133 grow-only; corpus 41; ZERO industries.ts motion; typecheck exit 0; oxlint 0w/0e; file law max 384; determinism byte-identical; boundary CLEAN 16 paths). The parallel-lane id collision with F351B's field journey resolved by renaming the commerce journey to `procurement-quote-to-order-authorization` (its distinct quote-acceptance/audit/cross-tenant angle); the report date typo corrected to 2026-10-14 per the commit timestamp. See `docs/evidence/F354/report.md`.
Owner: C. Per F350 §4, tranche 2 (dispatched in parallel with F351B — owned paths disjoint by construction: this lane owns the COMMERCE corpus, never touches the field corpus or industries.ts): close telecom −5 + water-waste −5 small-firm shortfall with NEW genuinely-applicable commerce journeys → both at ≥100 (B-3 closes for both). Census-first over the commerce-relevant unexercised surface (procurement/vendors/software/work per the TL pre-scan); D14-D17 carryover; D15-strict with the path-disjointness rule (universal-preferred; targeted applicability recorded as declarative proposal tables — the TL applies at F354). Acceptance: census citations, commerce suite green grow-only, measured lane-local closure arithmetic, exact SHA + owned-path diff + evidence at `docs/evidence/F351C/report.md`.

### F354 — TL convergence, tranche-2 recount + re-pin + disposition update
Owner: TL. Packet: `docs/tech-lead/packets/f354.md`. After F351C merges (following F353): recompute the 30-workspace ledger at the converged tree; re-pin; full battery; adjudicate + apply any declarative applicability proposals from the F351C report (honesty-gated); grow-only + never-weaken verified; the disposition update + documentation (catalog rows, AI_CONTINUATION.md, issue #3 comment, RESIDUAL-RISKS.md). Do not lower the target or broaden masks.
DONE (2026-10-14, converged candidate `1033be5`): `docs/evidence/F354/report.md` — WAVE-16 CLOSE. Combined measured ledger 3321/1323/1167/831/1029, determinismVerified + allJourneysPassed true, 26/30 firms >= 100, aggregateShortfall 19 (the packet's 18 projection corrected by measurement: agriculture medium at 99, shortfall 1). Zero applicability proposals to adjudicate (all-universal lane); the parallel-lane procurement id-collision adjudicated + the commerce journey renamed transparently; the F351C report date typo corrected; full battery green at the exact tree (field 107, security 179, commerce 133, convergence 82, maintenance 99, adoption 120, release 88); B-3 holds for all four Wave-16 industries (mining 108, construction 107, telecom 105, water-waste 105 smalls).


## Post-Wave-16 product mission roadmap — planned, not dispatched

Canonical product target: `docs/product/UBER-FOR-COMPANY-IT-EQUIPMENT.md`. These items are the roadmap after F354. They are **PLANNED**, not implementation-complete and not dispatchable ahead of their stated dependencies. Every item must retain its own packet, evidence report and exact-candidate acceptance.

### Wave 17 — equipment marketplace contract and integration

#### F360 — TL product/transaction contract freeze
**Status: DONE (2026-10-14); packet:** `docs/tech-lead/packets/f360.md`; freeze decision `docs/product/MARKETPLACE-MVP-FREEZE.md`; evidence `docs/evidence/F360/report.md`.  
Owner: TL. Dependency: Wave-16 disposition F354; contract discovery may overlap only if the TL records a non-conflicting scope. Freeze the one-market live-pilot boundary, real customer/supplier feasibility, supported equipment categories, participant roles, state machines, bounded-context ownership, authoritative persistence decision, provider/manual-ingestion seams, idempotency/reconciliation, Guardian/tenant rules, success metrics and exact end-to-end acceptance. Deliver `docs/product/MARKETPLACE-MVP-FREEZE.md`, evidence at `docs/evidence/F360/report.md`, standalone F361A/B/C packets and the full Wave-17 catalog detail. Do not invent suppliers, stock, availability, APIs, or payment capabilities. If real customer/supplier access cannot be evidenced, record the pilot blocker and onboarding actions. Follow explicit operator gates for architecture-lock, authentication/security invariant, new authoritative persistence, money movement/licensing or materially changed product contracts.

#### F361A — receiving and asset lifecycle link
**Status: DISPATCHED 2026-10-14 (w17a); Worker A; packet:** `docs/tech-lead/packets/f361a.md` (the F360-authored standalone contract).  
Implement equipment receiving/inspection, serial/tag and duplicate guards, tenant/site/custody, warranty/condition, enrollment/link into authoritative asset truth, discrepancies and lifecycle evidence. Own only A-authorized asset/device/observation/field paths and evidence. Acceptance includes deterministic domain tests, tenant/refusal cases, evidence-linked state changes, field-corpus extension where justified, and an end-to-end contract for TL composition. No fabricated physical delivery claim.
ACCEPTED+MERGED `d347a63` (TL gate: assets 221/221 + field 111/111 green grow-only, corpus 42, typecheck/lint clean, file law 282<=400, boundary CLEAN 18 paths, industries.ts zero motion, determinism byte-identical); re-pinned at F362 (217c9e8 first-half, 756a040 final).
DELIVERED (work/f361a, base `cefd588`): `docs/evidence/F361A/report.md` — the F360 §3.5 state machines as REAL public APIs (ReceiptEvidence recorded→verified|discrepancy with the frozen fields; AssetEnrollment candidate→enrolled consuming the EXISTING AssetDirectory/applyTwinRevision registry, never a second asset truth); duplicate-serial guard idempotent keyed tenant+serial (the ORIGINAL returns with duplicate=true, registry count machine-proved at 1); discrepancy path un-enrolled until a verified re-record; tenant fail-closed reads (foreign tenant sees NOTHING); census-first with grep proof (ids `marketplace-receipt-enrollment`/`marketplace-receipt-discrepancy` + `mre.*` — zero matches at base, the F354 lesson); 2 D14 field journeys (28 steps / 41 assertions / 5 REAL refusal steps), corpus barrel 40 → 42 grow-only; assets suite 207 → 221, field suite 107 → 111, both green + typecheck + oxlint 0w/0e; determinism byte-identical; boundary CLEAN (16 code paths, all owned); adoption/release pins honestly stale for the F362 TL re-pin.

#### F361B — marketplace trust, Guardian and evidence controls
**Status: DISPATCHED 2026-10-14 (w17b); Worker B; packet:** `docs/tech-lead/packets/f361b.md`.  
Implement supplier/offer evidence requirements, verification status and freshness policy, authorization, budget/role gates, consequential-action approval/refusal, audit/evidence references, untrusted or duplicate provider-event handling and secure failure states. Own only B-authorized security/policy/action/evidence paths and security corpus. Guardian remains the sole consequential-action authority. Do not own supplier/order source-of-truth state or claim identity authentication until production auth is actually wired and tested.
ACCEPTED+MERGED `87fb95b` (TL gate: policy 158 + actions 86 + evidence 105 + security 156 + acceptance-security 194 green grow-only, corpus 31, typecheck/lint clean, file law 308<=400, boundary CLEAN 22 paths, industries.ts zero motion, determinism byte-identical); re-pinned at F362 (217c9e8 first-half, 756a040 final).
DELIVERED (work/f361b, base `cefd588`): `docs/evidence/F361B/report.md` — the Guardian approval contract composing the EXISTING evaluateCapability (zero new authority truth; 8 limit checks; 14 reason codes; advisory NEVER self-authorizes, digest-excluded and machine-asserted via the public `assertAdvisoryNeverAuthorizes`); the A4 action composition through the EXISTING proposeAction/advanceActionState (refused approvals NEVER authorize; refusals leave the `rejected` audit trail); the evidence-retention contract (4 frozen kinds, source+capturedAt freshness, tenant fail-closed reads/writes, duplicate provider events return the ORIGINAL record — never a second conclusion); tenant-isolation security tests; 2 census-certified D14 journeys (`security.marketplace-order-approval-discipline` 48 assertions/6 refusal steps, `security.marketplace-evidence-dedup-discipline` 41 assertions/3 refusal steps; corpus 29 → 31, census grep proofs at base); suites green grow-only (policy 131 → 158, actions 73 → 86, evidence 82 → 105, security 147 → 156, acceptance-security 179 → 194); typecheck + lint exit 0; determinism byte-identical; boundary clean (owned paths + lockfile only).

#### F361C — supplier catalogue, offers, procurement and fulfilment state
**Status: DISPATCHED 2026-10-14 (w17c); Worker C; packet:** `docs/tech-lead/packets/f361c.md`.  
Implement supplier profiles/catalogue, source and freshness of availability, request/RFQ, offers/quotes, transparent comparison, purchase/rental/lease/service-order state, provider/manual acknowledgement, delivery/service milestones, reconciliation, cancellation/return/dispute for the frozen pilot. Own only C-authorized vendor/procurement/work/commerce paths and evidence. Start provider-neutral; Aurum/ADCOS/Arena remain `CONTRACT_ONLY` until separately evidenced.
ACCEPTED+MERGED `2521cba` (TL gate: commerce 153/153 + procurement 171/171 + vendors 108/108 + work 80/80 green grow-only, corpus 45, typecheck/lint clean, file law 341<=400, boundary CLEAN 33 owned paths, industries.ts zero motion, determinism byte-identical incl. the FULL 45-corpus re-run); re-pinned at F362 final (756a040: +120 executions, 29/30 firms >=100, cap 118).
DELIVERED (work/f361c, base `203f077`): `docs/evidence/F361C/report.md` — the F360 §3.1–§3.4 chain as REAL public APIs: the equipment-request machine (13 frozen states, typed reason codes, idempotent create/submit keyed tenant+natural-key — the ORIGINAL returns on replay, drifted content refuses NATURAL_KEY_CONFLICT); the offer schema with THE FRESHNESS LAW (manual-only source kinds + captured-at, validity window, the current-offer sheet excludes-and-reports — an expired offer NEVER silently appears current) and the comparison composing the EXISTING compareQuotes/matchVendors kernels (hard-constraint vs preference-weight separation, per-offer explainable rationale); supplier verification (pending→verified|expired|suspended, evidence laws, verified-only matching gate) + the PLAINLY-LABELLED manual catalogue import seam (never a live-API claim); the §3.4 order lifecycle with the manual provider-ack seam (same-event replay idempotent returning the ORIGINAL evidence, different-event ALREADY_ACKNOWLEDGED refusal) composed with the work package's service-completion accept gate; 4 census-certified D14 commerce journeys (grep proofs at base; corpus barrel 41 → 45; commerce suite 133 → 153 green); suites green grow-only (procurement 136 → 171, vendors 94 → 108, work 72 → 80); typecheck + lint exit 0; determinism byte-identical; boundary clean (31 owned paths).

#### F362 — TL convergence: live-pilot transaction spine
**Status: PLANNED; Owner TL.**  
Integrate F361A/B/C with the real web UI, control plane, authoritative persistence and supported supplier seam. Prove request → source-verified offer(s) → governed approval → real supplier commitment → fulfilment/receipt evidence → authoritative asset enrollment/link. Run all relevant acceptance suites, typecheck/lint/architecture/dependency checks, clean-checkout root gates, browser E2E and exact-deployment verification. Create `docs/evidence/F362/report.md`; preserve all provider, tenant/security, durability and live-versus-fixture boundaries.
DELIVERED (work/f362e2e, the TL-delegated E2E worker lane w17l, base d714616): `docs/evidence/F362/report.md` — the deterministic E2E transaction-spine journey through the REAL public APIs of ALL THREE Wave-17 lanes (ONE journey `marketplace-transaction-spine`, 66 steps / 116 assertions, ≥5 per segment with ≥1 refusal at EVERY gate: natural-key conflict + order-before-approval illegal transition, the verified-only gate exclusion, the post-lapse freshness refusals (NO_ELIGIBLE_OFFERS + the EMPTY sheet with verdicts expired), the over-ceiling + missing-human-approval authorization denials with the advisory-never-authorizes law machine-asserted, ALREADY_ACKNOWLEDGED + future-dated-capture ack refusals, the terminal receipt re-decision, the duplicate-serial guard + serial-tag-conflict, and foreign-tenant reads seeing NOTHING); the cross-lane bindings machine-proved as facts (the approval's offerSnapshotRef IS the retained snapshot's evidence id; the verificationRef IS the §3.3 evidence id; the order-side ack cites the SAME reference as the retained provider-ack record); commerce corpus 45 → 46 grow-only (suite 153 → 171 green, typecheck exit 0, oxlint 0w/0e, file law max 294 ≤ 400, determinism byte-identical incl. the FULL 46-corpus rerun); the F361B/F361A surfaces driven from the commerce corpus for the first time (three workspace deps — lockfile motion recorded); adoption/release pins honestly stale at 46 for the TL re-pin (the F361A/B/C precedent); fixture-labelled, never live (the F369 gate stays BLOCKED).

### Wave 18 — production and live-pilot evidence

#### F370 — production pilot hardening
**Status: PLANNED; Owner TL with work scoped to A/B/C ownership.**  
Productionize the pilot's authoritative business persistence, identity/authentication and server-side tenant authorization, secret management, integration health, observability, idempotency/retries/reconciliation, backup/restore, incident/rollback runbooks and verified deployment. Any new authoritative store or material security/persistence change requires the Architecture Lock/operator-gate protocol. Do not use the F351A JSONL qualification service as blanket authorization for marketplace transaction state. Evidence: `docs/evidence/F370/report.md`.

#### F371 — real customer + supplier pilot acceptance
**Status: PLANNED; Owner TL.**  
Demonstrate a real customer request and real supplier participation in the selected market. Capture verified offers, approval/commitment, actual delivery or service completion, customer acceptance/exceptions, and asset linkage when equipment is involved. Measure quote response time, request-to-decision, fill rate, on-time fulfilment/service, cost baseline, exception/dispute rate and customer/supplier feedback. A manual operator-verified adapter is permitted only when clearly labelled and auditable. No real customer/provider evidence means the live-pilot gate stays BLOCKED. Evidence: `docs/evidence/F371/report.md`; disposition must name the exact candidate SHA and all residual qualifications.

**Dispatch rule:** only F360 may freeze F361A/B/C contracts and author their complete packets. Do not start F361 from this roadmap prose alone. Do not describe Wave 17/18 as implemented before evidence and exact-tree convergence.
