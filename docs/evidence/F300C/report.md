# F300C — Work, Commerce, Integration Reality and Adoption Coverage (Wave 10 lane C)

- **Work item:** F300C — Wave 10 lane C (`spec/work-items/WORK-ITEM-CATALOG.md`).
- **Worker:** C (work-and-commerce; `spec/worker-ownership.yaml` worker-c) + the
  scoped TL grant `packages/acceptance/adoption/**` (F300C only; existing runner
  contracts held — adoption 90 grew to 95, never weakened).
- **Base:** `3162f87` (origin/main HEAD at branch creation — verified, not assumed).
- **Branch:** `work/f300c`. **Final commit:** the branch tip this report is
  committed on (a commit cannot embed its own sha; the nominated sha is
  reported in the lane's FINAL REPORT message and the TL gates at it).
- **Date:** 2026-10-09.

## 1. Owned paths touched (boundary-verified)

- `packages/experiences/work-commerce/**` — the NEW `src/host/` seam
  (subpath export `./host`): `contract.ts` (157), `routes.ts` (173),
  `intents.ts` (285), `surface.ts` (338), `index.ts` (80) — all ≤ 400 code
  lines; `package.json` (+ the `./host` export map entry); 2 new test files.
- `packages/acceptance/commerce/**` — corpus extension 15 → 21 journeys:
  new `src/journeys/host.ts` (176), `src/journeys/gateway.ts` (142),
  `src/drivers-host.ts` (300), `src/drivers-gateway.ts` (208),
  `src/gateway-world.ts` (67); extended `journey-contracts.ts` (+3
  capabilities, +HostStep/+GatewayStep vocabularies),
  `journey-world.ts` (+assignments/gateway state),
  `drivers-work.ts` (+board-state log, blocked-reason/sentinel facts),
  `runner.ts` (+2 driver dispatches), `journeys/work.ts` (+1 journey),
  `journeys/index.ts`; 3 test files updated for the new corpus shape.
- `packages/acceptance/adoption/**` (scoped grant) — the ledger revisit:
  new `src/convergence-delta.ts` (128) + `tests/convergence.test.ts` (54);
  `industries.ts` (commerce masks for the new agent-operation journeys +
  header law), `adoption-run.ts` (count-honesty law + structural reasons
  updated to the real tree counts), `index.ts` (+export); 5 test files
  updated to the recomputed machine-run numbers.
- `docs/evidence/F300C/**` — this report + the browser-journey scripts.

`git status` at commit time shows exactly those paths. No TL-owned path
touched: `packages/acceptance/release/**`, `packages/web/**`,
`spec/**` (the contract snapshot was regenerated locally by the tool then
REVERTED — see §7/R-3), `packages/control-plane/**`, other lanes' paths —
all untouched.

## 2. Deliverable 1 — the HostSurface adapter (`./host` seam)

Per `spec/integration/WAVE10-HOST-CONTRACT.md` §2:

- **Surface:** `workCommerceHostSurface` — surfaceId `work-commerce`,
  surfaceKind `lane-experience`.
- **Routes (5, manifest order):** `work-board` (`/commerce/work`),
  `project-stage-gates` (`/commerce/projects`), `procurement-spine`
  (`/commerce/procurement`), `software-entitlements`
  (`/commerce/software`), `org-budgets` (`/commerce/organization`) — the
  packet's required coverage (work board; project/workload views;
  procurement demand→quote→order; org + gateway budgets) plus the
  entitlements view. Drill-down refs machine-verified
  (`verifyRouteManifest`), every route carries honest limitation markers.
- **`buildViewModels(slice, ctx)`:** pure projection over the lane's TEN
  REAL read-model assemblies (work board, per-project stage-gate sheets
  in projectId order, workload rollup, spine board, vendor KPI, seat
  view, role board, capability budgets, model-usage rollup + the
  caller-composed quote scoring). Same slice + ctx ⇒ byte-identical
  (machine-tested); `ctx.establishedAt` is the ONLY time source (derived
  ISO `computedAt`); bundle digest `wchost_*` with
  `verifyHostViewModelsDigest`.
- **No second business-truth store:** every field is a REAL assembly's
  own output; refusals surface VERBATIM per route.
- **Tenant fail-closed at the seam:** context/slice mismatch refuses the
  WHOLE bundle (`tenant-mismatch`); malformed context, invalid
  `establishedAt`, `cross-tenant-forbidden` scope refuse before any
  projection; foreign records inside the slice refuse the per-route
  assemblies with the domain's reason codes (machine-tested).
- **Intents (4):** UI events → the EXISTING inert `CommandDraft` builders
  (`work.create-work-order`, `procurement.approve-quote`,
  `procurement.place-order`, `org.allocate-budget`) with subject-derived
  idempotency keys, presentation role lenses over the lane's 7-persona
  vocabulary (fail-closed `intent-not-offered-to-role`), and honest
  builder refusals (`TITLE_REQUIRED`, `NEGATIVE_AMOUNT`, …) — never a
  submit/execute path (Guardian adjudicates; binding is TL work).
- **Honesty fields:** per-route machine-readable markers —
  `read-as-of:logical-time`, `intent-execution:not-at-lane`,
  `quote-scoring:caller-composed` (explicit not-composed state when the
  TL composed no scoring inputs — never a fabricated ranking),
  `external-adapters:contract-only`, `budgets-are-ceilings:not-authorizations`.
- LOCAL structural context (`HostTenantContext`) — no cross-lane import
  (the package does not depend on `@fleetos/identity`; law A20).

## 3. Deliverable 2 — composing workflows (machine-run, owned paths)

The corpus extension drives the REAL public APIs end to end (fresh
deterministic world per journey, latest-write-wins facts + sequence logs):

- **Work lifecycle:** `work-order-blocking` — block (recorded reason,
  visible blocked column) → unblock → complete, plus assignee redaction
  (sentinel + `redactedFields`, and the honest domain behavior that
  completion CLOSES the assignment — asserted, not hidden).
- **Projects/workloads:** the pre-existing stage-gate + workload journeys
  plus the host-surface journey's project sheet (frontier +
  `close-mandatory-checkpoints` unlock, workload rollup 5000 bps).
- **Procurement spine:** demand → quote → award/authorization → order →
  fulfillment states remain covered by the pre-existing journeys; the
  host journeys add the composed spine + scoring sheets.
- **Role handoffs + approval states:** `role-assignment-handoff` — REAL
  `assignRole`/`transitionRoleAssignment`: assign → activate → relieve
  with `DUPLICATE_ASSIGNMENT_ID`, `MAX_CONCURRENT_ROLES_EXCEEDED` (exact
  overshoot), `TENANT_MISMATCH`, `TERMINAL_STATE` refusals and the board
  projection.
- **Gateway budgets + authority limits (over-limit refusal VISIBLE):**
  `gateway-routing` — REAL `selectModel` (priority ordering rules
  `urgency-richness-first`/`urgency-cost-first`), `BUDGET_CEILING_EXCEEDED`
  (cheapest candidate recorded), `NO_MODEL_WITH_CAPABILITIES`, quota
  windows (`QUOTA_REQUESTS_EXHAUSTED` with overshoot 1,
  `REQUEST_OUTSIDE_WINDOW`), burn projection (assumptions verbatim,
  honest `warning`/`breach` severity, `projection: true` marker), provider
  cost comparison over REAL ledger sums (deltaBps 70000 exact), and the
  org-budget refusal behind usage appends
  (`BUDGET_REFUSED_BY_ORG:UNITS_EXHAUSTED`).

## 4. Deliverable 3 — integration status matrix (lane connectors)

Deterministic adapter contracts are NOT live connectivity. No network
calls, no `process.env`, no credentials exist or are committed anywhere
in the lane (machine-audited: `fetch|http|net|axios|WebSocket|process.env`
over `packages/integrations/{aurum,apify,vendors}/src` — zero hits).

| Connector | Package | Status | Provider/system | Exact operations tested | Environment | Sanitized evidence | Limitations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Aurum settlement | `@fleetos/aurum` | **CONTRACT_ONLY** | Aurum settlement/ledger provider (endpoint NOT reachable from this environment; no credentials exist) | `AurumPort.invoke` idempotency (fresh→cached), `AURUM_UNAVAILABLE` outage with attempts, tenant-scoped idempotency separation, `aurumDoesNotOwnDomainTruth` boundary, delta-sync sessions (open→fetch→apply→commit), delta-apply, sync-reconciliation repair actions | deterministic in-process machine run (vitest; no network) | `packages/integrations/aurum/tests`: 4 files / 61 tests green; commerce journey `aurum-settlement-seam` (fresh/cached/unavailable kindLog) | The deterministic reference adapter is the only implementation; a live binding needs a real endpoint + credential handling entirely outside this repo |
| Apify actor jobs | `@fleetos/apify` | **CONTRACT_ONLY** | Apify platform actor-run API (no token exists; none committed) | actor job lifecycle (propose → Guardian-decision INPUT → schedule under rate budget → start/complete/fail/expire), `RATE_BUDGET_EXCEEDED` with overshoot, result ingestion quarantine (`EVIDENCE_NOT_ATTACHED`, `PAYLOAD_MALFORMED`), evidence attach, rate ledger accounting | deterministic in-process machine run | `packages/integrations/apify/tests`: 4 files / 68 tests green; commerce journey `apify-actor-job` | Guardian decision refs are caller-supplied INPUTS (never minted); no live Apify API binding |
| External vendor catalog | `@fleetos/external-vendors` | **CONTRACT_ONLY** | external vendor/system feeds (no live feed reachable) | catalog import (within-batch dedupe + LWW stale skip), capability verification (`CAPABILITY_NOT_CLAIMED`), metric ingestion quarantines, scorecards with revocation propagation (`CAPABILITY_REVOKED`) | deterministic in-process machine run | `packages/integrations/vendors/tests`: 4 files / 51 tests green; commerce journey `external-catalog-sync` | Catalogs fold CALLER-SUPPLIED batches; the sync engine never fetches |
| Model-gateway providers surface | `@fleetos/model-gateway` | **CONTRACT_ONLY** (lane-internal surface, listed for completeness) | model provider records (metadata only) | provider registry validation, fallback ladders (`resolveFallbackLadder`), degraded-mode classification, usage ledger + quota + burn + routing (all deterministic, all machine-run in the F300C `gateway-routing` journey) | deterministic in-process machine run | `packages/model-gateway/tests`: 7 files / 107 tests green; journey `gateway-routing` | Provider records are data; no provider SDK, no network, no keys — routing is deterministic policy evaluation |

No connector in this lane is LIVE_VERIFIED or SANDBOX_VERIFIED: no
sandbox endpoint, token or credential exists in the environment, and the
honest classification of a deterministic in-process adapter behind a port
is CONTRACT_ONLY. The TL composes the full-repo matrix (incl. ADCOS /
Arena) at F302 from this lane matrix + the other lanes' evidence.

## 5. Deliverable 4 — commerce corpus extension (the counted journeys)

15 → **21 distinct journeys** (all genuinely distinct; identical reruns
never count):

| New journey | Capability | What is genuinely new |
| --- | --- | --- |
| `host-surface` | host-integration | the HostSurface bundle over REAL composed state: all 5 route assemblies, purity, digests, markers, not-composed→composed quote scoring |
| `host-intents` | host-integration | UI events → inert drafts: role-lens gates, subject idempotency, builder refusals |
| `host-tenant-edges` | host-integration | host-boundary fail-closed: context probes + foreign-record per-assembly refusals |
| `gateway-routing` | model-gateway-routing | REAL routing/quota/burn/cost-comparison with over-limit refusals visible |
| `role-assignment-handoff` | role-assignment | REAL assignRole/transition lifecycle with ceiling/terminal/tenant refusals |
| `work-order-blocking` | create-work | the uncovered block/unblock lifecycle states + assignee redaction |

Corpus ledger: work 4→5, commerce 6, org 5, host 3, gateway 2 = **21**
(unique ids, persona/capability vocabulary membership, ≥5 assertions each
— machine-tested). Suite: **commerce 65 → 71** (+6 journey tests).

## 6. Deliverable 5 — adoption ledger revisit (the scoped grant)

Machine-run at this branch's tree (field 14 / commerce 21 / security 13):

- **COUNTED journey executions: 1,275** (field 375 + commerce **549** +
  security 351) — was 1,113; the delta is the commerce extension
  (+162 = 54 new applicable commerce executions across the 30
  workspaces).
- **Fully-applicable firm cap on THIS tree: 48** (14+21+13) — was 42.
- **Aggregate shortfall: 1,725** (30×100 − 1275), every firm's exact
  shortfall recorded with structural reasons (5 reasons — the runner-shape
  reasons unchanged verbatim + the updated numbers + the convergence
  expectation reason).
- **Honest masks:** the new `gateway-routing` and `role-assignment-handoff`
  journeys are masked for the three industries that record no in-house
  autonomous agents (agriculture, healthcare-facilities,
  facilities-management — mirroring their `security.agent-safety`
  rationales); the host-integration journeys are PLATFORM journeys and
  stay unmasked everywhere; tenant-isolation journeys are never masked.
- **Convergence expectation (`src/convergence-delta.ts`, machine-checked
  internal consistency):** the sibling lanes' extensions are pushed but
  NOT mergeable into this lane branch (ownership law): F300A field 14→20
  (`origin/work/f300a` @ `e221c07`), F300B security 13→17
  (`origin/work/f300b` @ `b5be8e4`). At convergence a fully-applicable
  firm reaches **20+21+17 = 58** counted journeys — still **42 short of
  the 100-per-firm target**. The threshold is NEVER silently weakened;
  the shortfall stays structural (runner/corpus shape, re-runs never
  counted) and is flagged for the documented TL/user decision the F271
  record already carries. The TL recomputes the ledger at F301/F302.
- Adoption suite: **90 → 95** tests (existing runner contracts held; the
  new `convergence.test.ts` machine-checks the parameterization against
  the REAL corpus lengths in this tree).

## 7. Quality gates at the final commit (machine-run)

| Gate | Result |
| --- | --- |
| `corepack pnpm -r --no-bail test` | **4,771 tests total (+29 over the 4,742 baseline — grow-only held); 4,768 passed; 3 failed in the TL-owned release suite's recorded-baseline assertions** (see R-1) |
| Six acceptance suites | commerce **71** (was 65 — grows), adoption **95** (was 90 — grows), field **61** (held), security **90** (held), release **88 tests: 85 green + 3 superseded-baseline failures** (R-1), convergence **82** (held) |
| Own packages typecheck | `@fleetos/experience-work-commerce`, `@fleetos/acceptance-commerce`, `@fleetos/acceptance-adoption` — `tsc --noEmit` clean |
| Own packages lint | oxlint 0 warnings / 0 errors (each package) |
| Root `pnpm lint` | 71 warnings + 1 error — **identical to origin/main** (inherited ZCode substrate: `no-unsafe-finally` in `packages/services/src/session/tasksDatabase/startup.ts`); 0 new |
| Root `pnpm typecheck` | 201 errors — **identical to origin/main** (pre-existing TS5097 class in the substrate project build; the FleetOS packages typecheck per-package); 0 new |
| `fleetos:source-of-truth` | OK (3 workers, fleetos-2.0, lock 2.0.0) |
| `architecture:check` | OK — violations 0, boundary scan clean |
| `fleetos:snapshot:check` | DRIFT — **pre-existing on origin/main** (snapshot head `27c75c9` < main `3162f87`); extended by all three lanes' Wave 10 host exports. The regenerated snapshot was REVERTED (spec/ is TL-owned — sibling lanes left it untouched too); the TL regenerates at convergence (R-3) |
| File law (≤400) | all NEW src files ≤ 400 lines (max: `surface.ts` 338); test files above 400 match repo norms (largest existing: 541) |

**R-1 (recorded failure — root cause, owner, repair item):**
`packages/acceptance/release` (TL-owned, F281) —
`tests/integration.test.ts:206` expects adoption `journeyExecutions`
1113 (now 1275), `tests/release-gate.test.ts:177-180` expects commerce
corpus 15 (now 21), `tests/release-gate.test.ts:469` expects the
short-corpus blocker text `expected 15` (now `expected 21`). These
RECORDED baselines predate Wave 10 and are superseded by the lanes'
sanctioned corpus extensions (WAVE10-HOST-CONTRACT §5: "Each lane
extends ITS corpus"); the identical class of failure exists on
`origin/work/f300a` (field 14→20) and `origin/work/f300b` (security
13→17). Owner: TL. Repair: re-baseline the recorded counts at F301/F302
convergence. Per the handoff law this is recorded — never relabeled as
passing.

## 8. Browser-journey scripts (deliverable 6)

`docs/evidence/F300C/journeys/` — README + 5 scripts (one per route),
each seeding from the named machine-run journey, with expected values
that are the journeys' machine-verified actuals, refusal steps
(fail-closed renderings) and honesty-marker checks. Ready for TL
execution against the F301 shell; records bind to the deployed commit.

## 9. Shell-change proposals for the TL (TL-owned paths — proposals only)

- **S-1 (bind the seam):** mount `@fleetos/experience-work-commerce/host`
  in the F301 shell — `workCommerceHostSurface.routes` (5 paths under
  `/commerce/*`), `buildViewModels` over the composed slice (composition
  recipe: `composeSlice` in `packages/acceptance/commerce/src/drivers-host.ts`),
  and `buildIntentForEvent` bound to the control-plane `CommandQueue.submit`
  (the draft's `requiredCapability` is the Guardian request).
- **S-2 (role lenses):** the surface's 7-persona role vocabulary is
  presentation-only; the shell's role switcher can pass the role to
  `buildIntentForEvent` to gate affordances fail-closed.
- **R-1 (release re-baseline):** update the TL-owned release suite's
  recorded acceptance baselines to the converged corpus counts at F301
  (expected: field 20 / commerce 21 / security 17; adoption counted total
  recomputed by the machine-run).
- **R-3 (snapshot regeneration):** `pnpm fleetos:snapshot` + commit at
  convergence (pre-existing drift + the three lanes' host exports).
- **R-4 (adoption target decision):** the 100-per-firm target remains
  structurally unreachable (58 at convergence); the documented TL/user
  decision the F271 record carries stands — either accept the structural
  shortfall ledger or fund corpus/runner parameterization work. NEVER
  weakened silently.

## 10. Residuals / honest limitations

- The host surface renders logical-time state only (`read-as-of`); no
  live telemetry/push at the seam (by design, WAVE10 §2).
- Quote scoring renders only caller-composed analysis — the bundle never
  fabricates a ranking.
- All lane connectors remain CONTRACT_ONLY (§4); no live connectivity
  claim is made anywhere in this lane.
- The convergence expectation for field/security is recorded data from
  the sibling branch tips — the machine-run on THIS branch counts them at
  main's sizes (14/13); the TL recomputes at convergence.
- Browser journeys are delivered as scripts (TL executes at F301 per the
  contract §4); no browser-run evidence is claimed here.
