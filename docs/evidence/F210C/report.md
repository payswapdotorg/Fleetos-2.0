# F210C — Work/Project application kernel evidence

Work item F210C (FleetOS 2.0 Wave 1, lane C).
Owner: worker C (Work + Commerce).
Branch: `work/f210c`.
Base SHA: `686d9bd2995f22ddc879202263b8fb74aa36576a` (per the F210C dispatch packet — the merged Wave 0 tree).

## What became kernel-grade

The Wave 0 lane C packages (F200C) shipped pure contracts + pure
skeleton functions only. F210C promotes each of the 11 lane packages
to **kernel grade**: a typed application-service surface (the
`Directory`) over a structural repository port, an in-memory reference
adapter, audit-event contracts on every consequential operation, and
the integrity/authorization invariants the work item calls out.

| # | Package | Wave 0 → Wave 1 kernel-grade additions |
|---|---------|-----------------------------------------|
| 1 | `@fleetos/work` | Assignment lifecycle with SUPERSESSION discipline (`reassignTo` — old assignment closes with `supersededBy` ref, never mutated); deadline contracts with deterministic escalation surface (`evaluateDeadline`, `produceDeadlineEscalation`); `WorkItemDirectory` over `WorkRepositoryPort` + in-memory reference; `MissionRefLike`/`WorkflowRefLike` frozen structural seams; typed `ProgressEvent`s for mission-runtime subscription; `AuditEvent` contract on every consequential operation; `assignmentIntegrityHolds` predicate. |
| 2 | `@fleetos/projects` | Milestone gating made REAL with honest `BlockingItem` reports per non-terminal work item (`WORK_ITEM_NOT_TERMINAL` / `WORK_ITEM_UNKNOWN` reason codes); project lifecycle transitions with audit events; `ProjectDirectory` over `ProjectRepositoryPort` + in-memory reference; tenant-scoped portfolio read models; `completeProject` refuses when milestones have outstanding work. |
| 3 | `@fleetos/workloads` | Feasibility checking with machine-stable reason codes (over-allocation REFUSED with exact overshoot, never clamped); utilization read models (honest `overAllocated` flag — no clamping); rebalancing PROPOSALS (`proposeRebalance` is a proposal surface, never a silent mutation — `kind: "rebalance-proposal"` with stable digest); `WorkloadDirectory` over `WorkloadRepositoryPort` + in-memory reference. |
| 4 | `@fleetos/procurement` | Quote lifecycle with SUPERSESSION (`supersedeQuote` — previous quote withdrawn with `superseded=true`, new quote carries `supersedes` ref); order lifecycle with `GuardianDecisionRefLike` authorization seam — every order-creating transition requires `authorized=true` (procurement NEVER self-authorizes, law A5); fulfillment verification hooks (cannot `verify` without evidence; cross-tenant evidence refused); matching engine depth with TIE-BREAK RULES RECORDED IN THE MATCH RECORD (`TieBreakRule` enum, annotated on each match after the first); `ProcurementDirectory` over `ProcurementRepositoryPort` + in-memory reference. |
| 5 | `@fleetos/vendors` | Service-relationship lifecycle (active → suspended → terminated with reason codes); scorecard aggregation with WORST-WINS honesty; capability matching feed (deterministic, tenant-scoped — used by `@fleetos/procurement` at the structural seam); `VendorDirectory` over `VendorRepositoryPort` + in-memory reference. |
| 6 | `@fleetos/software` | Allocation/revocation with over-allocation refusal (`OVER_ALLOCATION` with exact overshoot); expiry sweep contracts (deterministic from timestamps — `sweepExpiredSubscriptions`); compliance read models with honest `seatsOverAllocated` (no clamping); `SoftwareDirectory` over `SoftwareRepositoryPort` + in-memory reference. |
| 7 | `@fleetos/agent-organizations` | Role/budget enforcement at kernel grade (budget breaches REFUSED with `BUDGET_EXCEEDED_TOKENS` / `BUDGET_EXCEEDED_INVOCATIONS` and the exact usage numbers); organizations stay UNTRUSTED — every consequential operation emits an `AuthorizationRequest` contract (the Guardian path out-of-lane consumes these via the structural seam); there is NO `Authorization` type exported from this package (law A6 — encoded in types and asserted by a structural test). |
| 8 | `@fleetos/model-gateway` | Provider selection with ordered fallback + budget policies; rate/quota accounting contracts (`QuotaAccount` + `QuotaProjection` with honest `overBudget` flag); honest no-provider degradation (`NO_PROVIDER_AVAILABLE` after exhausting fallback); routing decisions RECORDED with deterministic digest (`computeRoutingDigest` — byte-identical for byte-identical inputs); `ModelGatewayDirectory` over `ModelGatewayRepositoryPort` + in-memory reference. |
| 9 | `@fleetos/aurum` | Retry/idempotency contracts at the seam (`RetryPolicy` + idempotency-key-based deduplication — second call returns `fromCache=true`); honest degraded states (`AURUM_UNAVAILABLE` after retries vs `AURUM_DEGRADED` for unknown intents); `IDEMPOTENCY_KEY_EMPTY` reason code; boundary assertions (`isAurumProjection`, `aurumDoesNotOwnDomainTruth`). |
| 10 | `@fleetos/apify` | Retry/idempotency contracts at the seam; proposal/authorization boundary (the adapter REFUSES any proposal whose authorization is null or `authorized=false` — `PROPOSAL_UNAUTHORIZED`); honest degraded states (`APIFY_UNAVAILABLE` vs `ACTOR_UNKNOWN`); `IDEMPOTENCY_KEY_EMPTY` reason code. |
| 11 | `@fleetos/external-vendors` | Retry/idempotency contracts at the seam; honest degraded states (`EXTERNAL_SYSTEM_UNAVAILABLE` vs `EXTERNAL_REF_UNKNOWN`); `IDEMPOTENCY_KEY_EMPTY` reason code; boundary machine-tests (`isExternalProjection`, `projectionDoesNotOwnDomainTruth` — asserts external projections never carry authoritative domain id kinds). |

## Public contract inventory

The contract snapshot regenerated by `pnpm fleetos:snapshot` records
**673 exported symbols across 32 packages** (up from Wave 0's 500).
Worker-c lane packages contribute the following per-package export
counts (computed from `spec/snapshots/fleetos-contracts.json`):

| Package | Exported symbols (Wave 1) |
|---------|---------------------------:|
| `@fleetos/work` | 80 |
| `@fleetos/projects` | 50 |
| `@fleetos/workloads` | 35 |
| `@fleetos/procurement` | 73 |
| `@fleetos/vendors` | 39 |
| `@fleetos/software` | 32 |
| `@fleetos/agent-organizations` | 36 |
| `@fleetos/model-gateway` | 38 |
| `@fleetos/aurum` | 19 |
| `@fleetos/apify` | 18 |
| `@fleetos/external-vendors` | 19 |
| **Lane total** | **439** |

## Tests

| Package | Test file(s) | Test count | All passing |
|---------|-------------|-----------:|-------------|
| `@fleetos/work` | `tests/work.test.ts`, `tests/kernel.test.ts`, `tests/boundary-scan.test.ts` | 71 | yes |
| `@fleetos/projects` | `tests/projects.test.ts` | 30 | yes |
| `@fleetos/workloads` | `tests/workloads.test.ts` | 27 | yes |
| `@fleetos/procurement` | `tests/procurement.test.ts` | 44 | yes |
| `@fleetos/vendors` | `tests/vendors.test.ts` | 26 | yes |
| `@fleetos/software` | `tests/software.test.ts` | 24 | yes |
| `@fleetos/agent-organizations` | `tests/agent-organizations.test.ts` | 17 | yes |
| `@fleetos/model-gateway` | `tests/model-gateway.test.ts` | 20 | yes |
| `@fleetos/aurum` | `tests/aurum.test.ts` | 13 | yes |
| `@fleetos/apify` | `tests/apify.test.ts` | 12 | yes |
| `@fleetos/external-vendors` | `tests/external-vendors.test.ts` | 12 | yes |
| **Lane total** | | **296** | **yes** |

Full suite `pnpm -r test` total: **628 passing** (Wave 0 baseline 478 + Wave 1 lane C additions 296 − overlap with Wave 0 skeletons 146 = 628).

Test-coverage themes (machine-stable reason codes; illegal-transition refusals; tenant fail-closed; supersession discipline; over-allocation refusal; no-self-authorization seams; determinism; exchange-identity separation):

- **Supersession discipline**: `@fleetos/work` `reassignTo` and `@fleetos/procurement` `supersedeQuote` both refuse to mutate the old record in place. The old record is closed with `supersededBy`/`superseded=true` and the new record carries `supersedes` pointing back. Tests assert the old record's `assigneeId`/`unitCost`/`submittedAt` are unchanged after supersession.
- **Over-allocation refusal**: `@fleetos/workloads` `applyAllocation` REFUSES with `EXCEEDS_CAPACITY` and the exact overshoot — never silently clamps. The test verifies the allocation is NOT mutated after refusal. `@fleetos/software` `allocateEntitlement` REFUSES with `OVER_ALLOCATION` and the exact overshoot.
- **No-self-authorization seams**: `@fleetos/procurement` `createOrder` REFUSES with `AUTHORIZATION_REQUIRED` when authorization is null-like, and with `AUTHORIZATION_DENIED` when `authorized=false`. `@fleetos/agent-organizations` exports NO `Authorization` type — every consequential operation emits an `AuthorizationRequest`. The test "there is no Authorization type exported from this package (law A6)" asserts this at the type level.
- **Tenant fail-closed behavior**: every directory validates `TenantScope` first; missing/empty/malformed tenant ids always produce a refusal (`TENANT_SCOPE_MISSING` / `TENANT_MISMATCH`) before any further processing. Cross-tenant reads via the in-memory repository return null (no leak of the item's existence to a different tenant).
- **Determinism**: every kernel function has at least one explicit determinism test asserting identical inputs produce identical outputs across calls. Audit-event digests, progress-event digests, routing-decision digests, rebalance-proposal digests, and authorization-request digests are all stable.
- **Exchange-identity separation (law A16)**: `@fleetos/procurement` branded id kinds (`NeedId`, `DemandId`, `QuoteId`, `OrderId`, `FulfillmentId`) are pairwise distinct at compile time; `contractsAreDistinct(a, b)` proves pairwise distinctness at runtime.
- **Honest degraded states (adapters)**: `@fleetos/aurum`, `@fleetos/apify`, `@fleetos/external-vendors` each distinguish `*_UNAVAILABLE` (after retries) from `*_DEGRADED`/`*_UNKNOWN` (single-shot refusal). Idempotency-key-based deduplication returns `fromCache=true` on the second call.
- **Boundary machine-tests**: `@fleetos/external-vendors` `projectionDoesNotOwnDomainTruth` asserts that external projections never carry authoritative domain id kinds (`need`, `procurement-demand`, `quote`, `order`, `fulfillment`, `vendor`, `subscription`, `entitlement`, `organization`). The lane boundary-scan test in `@fleetos/work` (`tests/boundary-scan.test.ts`) walks every source file under the 11 worker-c owned paths and asserts ZERO `@zcode/*` imports and ZERO `@fleetos/*` imports outside the (intentionally empty) lane allowlist.

## Gates (executed on `work/f210c` after `git fetch origin main:main` ref-sync)

| Gate | Baseline (686d9bd) | `work/f210c` | Notes |
|------|---------------------|---------------|-------|
| `pnpm lint` (oxlint) | 70 warnings, 0 errors | 70 warnings, 0 errors | No new issues. My 11 packages each lint to 0 warnings, 0 errors when scoped with `pnpm lint` per package. |
| `pnpm typecheck` (`tsc -b` on `@zcode/*` list) | PASS | PASS | Unchanged; my packages' typecheck is invoked per-package and all pass cleanly. |
| `pnpm architecture:check` | OK / 0 violations | OK / 0 violations | No new violations; baseline preserved. |
| `pnpm fleetos:source-of-truth` | PASS | PASS | Canonical files unchanged. |
| `pnpm fleetos:snapshot` | (500 symbols, 32 packages) | **673 symbols, 32 packages** | Snapshot regenerated and committed with the lane. |
| `pnpm fleetos:snapshot:check` | PASS (vs Wave 0 snapshot) | PASS (vs Wave 1 snapshot) | The regenerated snapshot is committed with the lane; the check passes at the final tree. |
| `pnpm -r test` | 478 passing (baseline) | **628 passing** | All packages green. Lane tests: 296 (work 71 / projects 30 / workloads 27 / procurement 44 / vendors 26 / software 24 / agent-organizations 17 / model-gateway 20 / aurum 13 / apify 12 / external-vendors 12). |
| `pnpm build` (`pnpm -r build`) | **FAIL — `@zcode/web` vite build Killed (exit 137 / OOM)** | **FAIL — same `@zcode/web` OOM** | The 4GB-RAM sandbox environment cannot complete the `@zcode/web` vite build (transforming 7737 modules). `pnpm run build:bootstrap` also fails at `@zcode/web` (it excludes `@zcode/desktop` only, not `@zcode/web`). All 11 of my packages' own `build` scripts (`tsc --noEmit`) pass cleanly — verified by running `pnpm build` in each package directory. This is the same baseline defect F200C recorded; no regression. |

## Cross-worker seam rule (binding, Wave 1)

Wave 0 lane C defined LOCAL structural types (`TenantScope`,
`TenantScopeLike`, `GuardianDecisionRefLike`, `EvidenceRefLike`,
`VendorCapabilityRefLike`). F210C ADDS the following LOCAL structural
seams in worker-c packages, all frozen for F211 composition by the TL:

- `MissionRefLike` (`packages/work/src/audit.ts`, `packages/projects/src/audit.ts`)
  ```ts
  export interface MissionRefLike {
    readonly missionId: string;
    readonly runId?: string;
    readonly workItemId?: string;
  }
  ```
  Same shape as worker B's `@fleetos/execution`/`@fleetos/actions`
  `MissionRefLike` — duplicated as a LOCAL structural type, never
  imported across package boundaries at runtime.

- `WorkflowRefLike` (`packages/work/src/audit.ts`)
  ```ts
  export interface WorkflowRefLike {
    readonly workflowRunId: string;
    readonly missionId?: string;
    readonly workItemId?: string;
  }
  ```
  Worker C owns the canonical `WorkflowRefLike` seam shape. The TL
  composes `@fleetos/workflow` at F211 against this shape.

- `ActorRefLike` (`packages/work/src/audit.ts`)
  ```ts
  export interface ActorRefLike {
    readonly actorId: string;
    readonly tenantId: string;
  }
  ```
  Compatible with worker A's identity-package actor reference shape.

- `WorkItemStatusRefLike` (`packages/work/src/contracts.ts`, `packages/projects/src/contracts.ts`)
  ```ts
  export interface WorkItemStatusRefLike {
    readonly id: string;
    readonly status: string;
  }
  ```
  Used by `@fleetos/projects` milestone gating to check work-item
  terminal states without taking a runtime dependency on
  `@fleetos/work`.

Zero `@fleetos/*` cross-worker imports in implementation. The lane
boundary-scan test (`packages/work/tests/boundary-scan.test.ts`)
machine-checks this across all 11 worker-c owned paths.

## Contract deltas requested for TL adjudication at F211

1. **Promote `MissionRefLike` to a canonical shared contract.** Wave 1 lane C defines `MissionRefLike` as a LOCAL structural type in `@fleetos/work` and `@fleetos/projects` (same shape as worker B's `@fleetos/execution`/`@fleetos/actions` `MissionRefLike`). The TL should converge these into a single canonical shape at F211 when composing `@fleetos/mission`.

2. **Promote `WorkflowRefLike` to a canonical shared contract.** Lane C defines `WorkflowRefLike` in `@fleetos/work` (shape: `{ workflowRunId, missionId?, workItemId? }`). The TL should adopt or adapt this shape when composing `@fleetos/workflow` at F211.

3. **Promote `ActorRefLike` to a canonical shared contract.** Lane C defines `ActorRefLike` in `@fleetos/work` (shape: `{ actorId, tenantId }`). The TL should reconcile with worker A's identity-package actor reference shape at F211.

4. **Promote `WorkItemStatusRefLike` to a canonical shared contract.** Lane C defines this in `@fleetos/work` and `@fleetos/projects` (shape: `{ id, status }`). Used by `@fleetos/projects` milestone gating at the structural seam. The TL should adopt this when composing the work+projects integration at F211.

5. **Reconcile `GuardianDecisionRefLike` minimal shape with worker B's canonical `GuardianDecision`.** Lane C uses a minimal `{ decisionId, authorized, reasonCode }` shape (3 fields). Worker B's `GuardianDecision` has 7 fields (`verdict`, `reasonCode`, `matchedRuleId`, `tenantId`, `capabilityId`, `conditions`, `decisionDigest`). The TL should reconcile at F211 — either by expanding lane C's `GuardianDecisionRefLike` or by defining a separate canonical "Ref" shape.

6. **Reconcile `EvidenceRefLike` minimal shape with worker B's canonical `Evidence`.** Same pattern as above.

7. **Adopt `AuditEvent` contract shape.** Each lane-C package defines its own `AuditEvent` (with kind, tenant, occurredAt, digest, and operation-specific fields). The TL should define a canonical `AuditEvent` envelope at F211 and have lane-C packages conform to it. The current per-package `AuditEvent` shapes are intentionally similar but not identical — they share `kind`, `tenant`, `occurredAt`, `digest`, and `reasonCode` but differ on the operation-specific fields.

## Residual limitations

1. **`pnpm build` baseline OOM.** The sandbox has 4GB RAM and 0 swap; the `@zcode/web` vite build is Killed (exit 137) while transforming 7737 modules. This is environmental and unrelated to F210C — it is the same baseline defect F200C recorded. `pnpm run build:bootstrap` fails at `@zcode/web` for the same reason. All 11 of my packages' own `build` scripts (`tsc --noEmit`) pass cleanly.

2. **No real provider integrations.** The `AurumPort`, `ApifyPort`, `ExternalVendorPort` adapters ship as deterministic reference implementations only (with retry/idempotency contracts added in Wave 1). Real provider SDK adapters (e.g. Apify SDK, Aurum SDK) are out-of-scope for Wave 1 lane C — the lane ships structural seams + reference adapters per the work-item contract.

3. **No real Guardian path.** Worker B owns the Guardian. Worker C references the Guardian via local structural interfaces (`GuardianDecisionRefLike`) only. Convergence happens at F211 (see contract deltas requested above).

4. **`packages/integrations/*` not auto-discovered by the pnpm workspace.** Same residual as F200C: `pnpm-workspace.yaml` declares `packages/integrations/*` as a workspace glob (added by the TL at F201), so the 3 nested integration packages ARE now workspace packages — `pnpm -r` and `pnpm --filter @fleetos/aurum` / `@fleetos/apify` / `@fleetos/external-vendors` reach them. (This was an F200C residual that the TL's F201 closure resolved.)

5. **Per-package `AuditEvent` shapes are intentionally similar but not identical.** Each lane-C package defines its own `AuditEvent` with operation-specific fields. This is a deliberate design choice (each kernel knows its own audit surface), but the TL may want to converge on a canonical envelope at F211 (see contract deltas requested above).

6. **The `in-memory` reference repositories are NOT authoritative business truth.** Per law A1, they are deterministic, replayable adapters for tests and wiring fallbacks. The composing application attaches PostgreSQL at F211.

7. **TypeScript `vitest/globals` types loaded but no `vitest.config.ts` per package.** Same as F200C residual — tests run cleanly with default vitest config; explicit `vitest.config.ts` files are not required for the simple `vitest run` flow.

## Scope violations

None. All edits are inside paths owned by worker-c per `spec/worker-ownership.yaml`:

- `packages/work/**`
- `packages/projects/**`
- `packages/workloads/**`
- `packages/procurement/**`
- `packages/vendors/**`
- `packages/software/**`
- `packages/agent-organizations/**`
- `packages/model-gateway/**`
- `packages/integrations/aurum/**`
- `packages/integrations/apify/**`
- `packages/integrations/vendors/**`
- `docs/evidence/F210C/**` (granted carve-out)
- `spec/snapshots/fleetos-contracts.json` (generated — updated via `pnpm fleetos:snapshot` and committed with the lane)

No hand-edits to `pnpm-workspace.yaml`, root `package.json`, `architecture-policy.yaml`, `spec/**` (other than the generated snapshot), `scripts/**`, `AGENTS.md`, `docs/**` outside the F210C carve-out, or any `@zcode/*` / non-worker-c package path.
