# F210B — FleetOS 2.0 Wave 1 Lane B Evidence

**Work item:** F210B — Guardian/Capability/Action/Evidence kernel (Wave 1 lane B)
**Worker:** B (Safety + Intelligence)
**Branch:** `work/f210b`
**Base SHA:** `686d9bd875a906aaaa9ee3a06c987daf86a93e6c`
**Delivered SHA:** see `git rev-parse HEAD` on the branch tip

## 1. What became kernel-grade

Wave 0 shipped contracts + pure skeletons. Wave 1 (F210B) delivers the REAL
kernel — the authority spine of FleetOS (laws A4/A5/A13/A19):

### packages/policy — the Guardian kernel

- **PolicyRepositoryPort** + **InMemoryPolicyRepository** — structural port
  for policy storage with tenant-scoped isolation (law A8: cross-tenant
  reads return null, fail-closed).
- **DecisionRecord** — full justification chain carrying rule id, matched
  facts, tenant scope, capability version, actor authority, actor autonomy
  flag. Stable record digest for dedup/ledger.
- **Append-only decision ledger** — `appendDecision` + `verifyDecisionLedger`
  with hash-chain verification over a structural `Sha256Port` seam + in-memory
  reference. Tamper detection proven by test (law A19).
- **Precedence resolution** — `resolvePrecedence` implements deny-overrides-
  allow by default, with an `explicitOverride` escape hatch for rare operator
  overrides. Deterministic: same inputs => same output.
- **Capability-adoption authorization workflow** — `authorizeAdoptionWorkflow`
  implements the proposal -> Guardian decision -> adoption record flow. The
  adoption record NEVER self-executes.
- **A5 invariant machine-tested**: `authorizeAdoptionWorkflow` refuses
  agent/workflow/model actors without an explicit human delegation chain with
  machine-stable reason codes (`refused.self_authorization_no_human_chain`,
  `refused.self_authorization_delegation_chain_missing_human`). The
  `assertNoSelfExecutionPath` probe verifies no forbidden function names exist
  on the module surface.

### packages/actions — the action-protocol kernel

- **Idempotency ledger** — `InMemoryIdempotencyLedger` + `dispatchWithIdempotency`
  implementing duplicate dispatch = identical ack, never double execution
  (law A4 + A14). First call executes; second call returns cached ack.
- **Audit-event emission** — `ActionAuditEvent` + `emitAuditEvent` +
  `emitAuditTrail` + `verifyAuditTrail` at EVERY consequential state
  transition. Every transition in the protocol produces a machine-stable audit
  event with a transition digest (law A19).
- **Compensation/cancellation contracts** — `buildCompensationContract` +
  `cancelAction` + `attemptCompensation`. Compensation is PROPOSAL-only —
  it never self-executes. The Guardian path authorizes compensating actions.
- **Authorization refusal at the right states** — the existing `advanceActionState`
  machine refuses execute-without-authorization, dispatch-without-confirmation,
  verify-without-execution, record-without-verification, learn-without-record.
  These are kept and extended with audit emission.

### packages/execution — the execution kernel

- **Queue contracts** — `ExecutionQueuePort` + `InMemoryExecutionQueue` +
  `makeQueueEntry` + `drainQueue`. FIFO queue with at-least-once delivery
  (failed entries re-enqueued up to `maxAttempts`).
- **At-least-once + idempotency intersection** — `verifyAtLeastOnceIdempotencyIntersection`
  machine-tests that duplicates are deduplicated and the effective execution
  count equals the unique command count.
- **Result verification hooks** — `VerificationHook` + `executeWithVerification`
  + `makeReferenceVerificationHook`. The executor calls the verification hook
  and records the result — it does not decide what "verified" means.
- **Honest timeout/degraded states** — `ExecutionDegradedState` with
  `timeout`, `transport_unavailable`, `unknown_failure`, `capability_empty`.
  The executor NEVER claims success when it didn't verify.
- **Type-encoded boundary machine-tested** — `assertExecutionNeverAuthorizes`
  verifies the execution module surface contains no `authorize`,
  `evaluateCapability`, `authorizeAdoption`, or `makeGuardianDecision` function.

### packages/evidence — the evidence kernel

- **Content-addressed artifact store** — `ArtifactStorePort` +
  `InMemoryArtifactStore`. Artifacts are keyed by sha-256 digest. Dedup is
  automatic — storing the same bytes twice returns the same artifactId.
- **Bundle assembly with completeness verification** — `verifyBundleCompleteness`
  + `assembleBundle`. Fail-closed: a bundle referencing a missing artifact is
  invalid with sorted missing paths.
- **Hash-chain verification** — the existing `verifyEvidenceChain` is kept
  and extended with the artifact store + bundle completeness.
- **A13 traceability contract** — `TraceabilityChain` + `TraceabilityLink` +
  `buildTraceabilityChain` + `buildCompleteChain` + `verifyTraceabilityChain`.
  The chain encodes actor -> intent -> authorization -> execution ->
  verification -> capability/model version as a typed causal chain a user can
  inspect. Machine-tested: the chain shape (6 required links in canonical
  order) is verified, with tamper detection (digest mismatch), tenant mismatch
  detection, and missing-link detection.

### packages/security — the security kernel

- **Finding lifecycle with suppression discipline** — `FindingLifecycleState`
  (open/suppressed/resolved/expired_suppression) + `FindingSuppression` +
  `suppressFinding` + `resolveFinding` + `expireSuppressions`. Suppressed !=
  resolved; suppressions expire and transition to `expired_suppression`
  (which is treated as `open` for posture purposes).
- **Posture aggregation (worst-wins, honest unknown)** —
  `computePostureWorstWins` uses the worst (highest-severity) OPEN finding to
  determine the posture. Suppressed findings are excluded. Tentative findings
  set `degraded: true` (honest unknown, law A12).
- **Remediation proposal workflow tied to action-protocol** —
  `proposeRemediation` sets `requiresGuardianAuthorization: true` for high+
  severity findings. Remediation is PROPOSAL-only — it never auto-applies.

### packages/predictive + world-model + world-context — advisory kernel depth

- **REAL feature-set projection** — `projectWindowedFeatures` implements
  sliding-window feature computation (mean, min, max, stddev, count, range)
  with per-observation provenance refs (law A3).
- **Prediction + counterfactual issuance with A11 type distinctness** —
  `buildCounterfactualWithWidenedUncertainty` + `widenUncertainty`. A11 type
  distinctness machine-tested via `@ts-expect-error` checks: HYPOTHETICAL is
  not assignable to OBSERVED.
- **Uncertainty that WIDENS for counterfactuals** — `widenUncertainty` +
  `counterfactualUncertaintyIsWider` machine-test that counterfactual
  uncertainty is strictly wider than baseline prediction uncertainty.
- **Honest degraded states** — `predictWithDegradation` returns
  `model_unavailable`, `insufficient_history`, `feature_missing`,
  `tenant_isolated` honestly (law A12).
- **A2 invariant machine-tested** — `assertNoAuthoritativeWritePath` scans
  the module surface for forbidden write function names (`writeDevice`,
  `setDeviceState`, `updateTwin`, `mutateAsset`, etc.) and verifies none
  exist. The package exports NO write path to device state.
- **World-model counterfactual widening** — `widenUncertaintyForCounterfactual`
  + `makeWideningReferenceAdapter` ensure counterfactuals always have wider
  uncertainty than baseline predictions.
- **World-context windowing + horizon discipline** — `projectWindowedWorkload`
  + `projectWindowedProject` + `isObservationMature` + `filterMatureObservations`.
  Horizon discipline: never join before producedAt + horizonMs.

### packages/learning + simulation + integrations/arena — evaluation kernel depth

- **Outcome-observation joins with horizon discipline** —
  `joinOutcomesWithPredictions` joins observed outcomes with predicted
  values. Horizon discipline: predictions are marked `mature: false` until
  `producedAt + horizonMs` has elapsed. Error is computed when both observed
  and predicted are numeric.
- **Adoption PROPOSAL generation from evaluation cases** —
  `generateAdoptionProposalFromEvaluation` generates proposals only when
  success rate meets threshold. The proposal status is always `pending` —
  the Guardian path adopts. `assertNoAdoptFunction` verifies no `adopt`
  function exists on the module surface.
- **Simulation adoption proposals + degraded states** —
  `runSimulationWithDegradation` returns honest degraded states
  (world_not_found, scenario_tenant_mismatch, empty_scenario,
  runner_unavailable). `generateSimulationAdoptionProposal` produces
  PROPOSALS only — kind `SIMULATION_ADOPTION_PROPOSAL`.
- **Arena adapter with honest degraded states** — `evaluateWithDegradation`
  returns degraded states (capability_missing, empty_case_set).
  `generateArenaAdoptionProposal` produces PROPOSALS only — kind
  `ARENA_ADOPTION_PROPOSAL`. `assertNoSubmitOrAdopt` verifies no
  submit/adopt/authorize/execute methods exist on the adapter.

## 2. Per-package test counts

| Package | Wave 0 tests | Wave 1 tests | Delta |
|---------|------------:|------------:|------:|
| `@fleetos/policy` | 23 | 65 | +42 |
| `@fleetos/security` | 13 | 36 | +23 |
| `@fleetos/actions` | 13 | 37 | +24 |
| `@fleetos/execution` | 12 | 31 | +19 |
| `@fleetos/evidence` | 21 | 46 | +25 |
| `@fleetos/predictive` | 12 | 32 | +20 |
| `@fleetos/world-model` | 11 | 19 | +8 |
| `@fleetos/world-context` | 9 | 19 | +10 |
| `@fleetos/learning` | 10 | 25 | +15 |
| `@fleetos/simulation` | 10 | 20 | +10 |
| `@fleetos/integrations/arena` | 14 | 24 | +10 |
| **Lane B total** | **148** | **354** | **+206** |

All test targets met:
- policy/actions/evidence/execution >= 25 each: YES (65/37/46/31)
- advisory trio (predictive + world-model + world-context) >= 15 total: YES (32+19+19 = 70)
- rest >= 10 each: YES (security 36, learning 25, simulation 20, arena 24)
- lane total >= 220: YES (354)

## 3. Gate outputs (exact results)

### `pnpm lint` (oxlint) — PASS, zero NEW issues vs base

```
Found 70 warnings and 0 errors.
Finished in 523ms on 2728 files using 2 threads.
```

Baseline at `686d9bd` reported 70 warnings + 0 errors. After delivery: 70
warnings + 0 errors. **Zero new issues.** All 12 initial new-package warnings
(unused imports/variables) were fixed before delivery.

### `pnpm typecheck` (root `tsc -b`) — PASS

The root `tsc -b` invocation targets TL-owned substrate packages only
(`packages/rpc packages/provider ... packages/desktop/tsconfig.host.json`).
Passes unchanged.

### Per-package `pnpm --filter @fleetos/<pkg> typecheck` — ALL 11 PASS

Each package typechecks under `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, `allowImportingTsExtensions`,
`verbatimModuleSyntax` (inherited from `tsconfig.base.json`).

### `pnpm architecture:check` — PASS

```
architecture: OK
violations: 0
baseline: 0
new: 0
```

### `pnpm fleetos:source-of-truth` — PASS

```
FleetOS source-of-truth check PASSED
Canonical architecture, ownership, work catalog, TL handoff and continuation files are present.
Exactly three implementation workers are registered.
Product identity: fleetos-2.0
Architecture lock: 2.0.0
```

### `pnpm fleetos:snapshot` — PASS (regenerated)

```
contract snapshot written: 32 packages, 629 exported symbols
```

Baseline was 500 exported symbols. After delivery: 629 exported symbols (+129
new exports across the 11 worker-b packages). Snapshot file
`spec/snapshots/fleetos-contracts.json` committed with the lane.

### `pnpm fleetos:snapshot:check` — PASS

```
contract snapshot unchanged (32 packages)
```

### `pnpm -r test` — ALL PASS

```
pnpm -r test total: 684 tests (baseline 478 + 206 new)
```

All 32 workspace packages green. Arena runs standalone (24 tests, not in
`pnpm -r test` because `packages/integrations/arena` is not yet in
`pnpm-workspace.yaml` — see Wave 0 stop-the-line item).

### `pnpm build` (full recursive) — FAIL (ENVIRONMENTAL, NOT A REGRESSION)

```
packages/web build: Killed
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @zcode/web@ build: `vite build`
Exit status 137
```

OOM exit 137 on `@zcode/web` (vite build, 7737 modules). Container memory
limit is 4.1 GiB. **This failure is identical at base `686d9bd`** — my
delivery does not regress it. All 11 worker-b packages build successfully
individually (`tsc -p tsconfig.json --noEmit` — no-emit typecheck).

## 4. Invariants machine-tested

| Invariant | Law | Test | Status |
|-----------|-----|------|--------|
| A5 no-self-authorization | A5 | `authorizeAdoptionWorkflow` refuses agent/workflow/model without human delegation chain | PASS |
| A4 protocol | A4 | `advanceActionState` refuses illegal jumps; full protocol with audit + idempotency | PASS |
| A13 chain | A13 | `verifyTraceabilityChain` verifies 6-link causal chain with tamper detection | PASS |
| A11 distinctness | A11 | `@ts-expect-error` HYPOTHETICAL not assignable to OBSERVED; runtime guards | PASS |
| A2 no-authoritative-write | A2 | `assertNoAuthoritativeWritePath` scans for forbidden write functions | PASS |
| Idempotency | A4/A14 | `dispatchWithIdempotency` duplicate = identical ack, never double execution | PASS |
| Tamper detection | A19 | `verifyDecisionLedger` detects tampered entryDigest; `verifyTraceabilityChain` detects digest mismatch | PASS |
| Chain completeness | A13 | `verifyBundleCompleteness` fail-closed with sorted missing paths | PASS |
| Precedence determinism | A5 | `resolvePrecedence` deny-overrides-allow unless explicit override | PASS |
| Tenant fail-closed | A8 | `InMemoryPolicyRepository` cross-tenant load returns null; `appendDecision` throws on tenant mismatch | PASS |
| Degradation honesty | A12 | `predictWithDegradation` returns model_unavailable/insufficient_history; `runSimulationWithDegradation` returns honest degraded states | PASS |

## 5. Scope violations

**None.** All work was confined to Worker-B-owned paths:

- `packages/security/**`
- `packages/policy/**`
- `packages/actions/**`
- `packages/execution/**`
- `packages/evidence/**`
- `packages/predictive/**`
- `packages/world-model/**`
- `packages/world-context/**`
- `packages/learning/**`
- `packages/simulation/**`
- `packages/integrations/arena/**`
- `docs/evidence/F210B/**` (granted carve-out)
- `spec/snapshots/fleetos-contracts.json` (generated — updated via `pnpm fleetos:snapshot`)

No edits to:
- root `package.json`
- `pnpm-workspace.yaml`
- `architecture-policy.yaml`
- `spec/**` (except the generated snapshot)
- `docs/**` outside the carve-out
- `scripts/**`
- `AGENTS.md`
- any `@zcode/*` package
- any Worker-A or Worker-C owned path

## 6. Contract deltas requested (for TL adjudication)

The following are the assumptions made in this lane that the TL should
adjudicate. All existing Wave 0 contract shapes are PRESERVED — no existing
exported symbol was removed or renamed. New exports were ADDED:

### 6.1 PolicyRepositoryPort (new)

`packages/policy/src/repository.ts` adds:
- `PolicyRepositoryPort` (interface) — structural port for policy storage
- `InMemoryPolicyRepository` (class) — deterministic in-memory reference

Assumption: production injects a PostgreSQL-backed repository; the in-memory
reference is for tests. Please confirm the port shape composes with the
TL-owned persistence layer at F211.

### 6.2 DecisionRecord + DecisionLedger (new)

`packages/policy/src/decision-record.ts` + `ledger.ts` add:
- `DecisionRecord` (interface) — full justification chain
- `DecisionLedgerEntry` (interface) — append-only hash-chain entry
- `Sha256Port` (type) — re-exported from the evidence package's seam shape

Assumption: the decision ledger's `Sha256Port` shape matches
`@fleetos/evidence`'s `Sha256Port`. At F201, please confirm these should be
unified into a single shared `Sha256Port` contract.

### 6.3 Adoption workflow (new)

`packages/policy/src/adoption.ts` adds:
- `ActorKind` (type) — `"human" | "agent" | "workflow" | "model"`
- `DelegationChainEntry` (interface) — human delegation chain
- `AdoptionAuthorizationRequest` (interface)
- `AdoptionRecord` (interface) — produced only by Guardian path
- `AdoptionRefusalReason` (type) — machine-stable

Assumption: `ActorKind` is a new concept. Worker A owns identity/actors and
may want to define the canonical `ActorKind`. Please adjudicate.

### 6.4 Actions idempotency + audit + compensation (new)

`packages/actions/src/idempotency.ts` + `audit.ts` + `compensation.ts` add:
- `IdempotencyLedgerPort` (interface) + `InMemoryIdempotencyLedger` (class)
- `ActionAuditEvent` (interface) + `ActionAuditSinkPort` (interface) +
  `InMemoryActionAuditSink` (class)
- `CompensationContract` (interface) + `CompensationResult` (interface)

Assumption: the `IdempotencyLedgerPort` and `ActionAuditSinkPort` will be
backed by PostgreSQL + the transactional outbox at F211. Please confirm the
port shapes compose with the TL-owned persistence layer.

### 6.5 Execution queue + verification (new)

`packages/execution/src/queue.ts` + `verification.ts` add:
- `ExecutionQueuePort` (interface) + `InMemoryExecutionQueue` (class)
- `VerificationHook` (type) + `VerifiedExecution` (interface)
- `ExecutionDegradedState` (type)

Assumption: the `ExecutionQueuePort` will be backed by Redis/queue at F211.
Please confirm the port shape composes with the TL-owned infrastructure.

### 6.6 Evidence artifact store + traceability (new)

`packages/evidence/src/artifact-store.ts` + `traceability.ts` add:
- `ArtifactStorePort` (interface) + `InMemoryArtifactStore` (class)
- `TraceabilityChain` (interface) + `TraceabilityLink` (interface)
- `REQUIRED_LINK_KINDS` (constant) — the 6 canonical A13 link kinds

Assumption: `ArtifactStorePort` will be backed by R2/object storage at F211.
Please confirm the port shape. The `REQUIRED_LINK_KINDS` list is the canonical
A13 causal chain — please confirm this is the frozen contract.

### 6.7 Cross-worker structural interfaces

All Wave 0 LOCAL STRUCTURAL seams (`TenantScopeLike`, `MissionRefLike`,
`EvidenceRefLike`) are PRESERVED. No cross-worker `@fleetos/*` imports were
added. The boundary scanner (`packages/policy/src/boundary.ts`) continues to
enforce zero forbidden imports across all 11 worker-b packages.

## 7. Honest residual limitations

1. **`packages/integrations/arena` is still not a pnpm workspace package.**
   Same as Wave 0 — `pnpm-workspace.yaml` needs `packages/integrations/*`
   added (TL-owned stop-the-line). Arena's tests run via relative-path
   vitest invocation.

2. **`@zcode/web` build OOMs in this 4 GiB container.** Pre-existing
   environmental limit. Same failure at base `686d9bd`. No regression. A
   larger-memory CI runner is required for full `pnpm build`.

3. **Root `tsc -b` does not include `@fleetos/*` packages.** Same as Wave 0 —
   TL composition task. Each `@fleetos/*` package has its own `typecheck`
   script and they all pass.

4. **The decision ledger uses `require("node:crypto")` in the default sha256
   port.** This is inside a function body and works in the vitest/node
   environment, but is not pure ESM. The `Sha256Port` seam allows test
   substitution; production should inject a proper ESM-compatible sha256
   implementation.

5. **`pnpm fleetos:snapshot` was regenerated.** The snapshot now records 629
   exported symbols (up from 500). This is an intentional contract expansion —
   all 129 new exports are new types/functions/interfaces added by F210B.

## 8. Reproduction

```bash
git clone https://github.com/payswapdotorg/Fleetos-2.0.git
cd Fleetos-2.0
git fetch origin work/f210b:work/f210b
git checkout work/f210b
corepack enable && corepack prepare pnpm@10.33.2 --activate
pnpm install

# Per-package gates (all 11):
pnpm --filter @fleetos/policy test        # 65 tests
pnpm --filter @fleetos/security test      # 36 tests
pnpm --filter @fleetos/actions test       # 37 tests
pnpm --filter @fleetos/execution test     # 31 tests
pnpm --filter @fleetos/evidence test      # 46 tests
pnpm --filter @fleetos/predictive test    # 32 tests
pnpm --filter @fleetos/world-model test   # 19 tests
pnpm --filter @fleetos/world-context test # 19 tests
pnpm --filter @fleetos/learning test      # 25 tests
pnpm --filter @fleetos/simulation test    # 20 tests
(cd packages/integrations/arena && node ../../../node_modules/vitest/vitest.mjs run) # 24 tests

# Repo-wide gates:
pnpm lint                     # 70 warnings, 0 errors (baseline)
pnpm typecheck                # passes (TL-owned substrate only)
pnpm architecture:check       # OK, 0 violations
pnpm fleetos:source-of-truth  # PASSED
pnpm fleetos:snapshot         # 32 packages, 629 exported symbols
pnpm fleetos:snapshot:check   # unchanged
pnpm -r test                   # 684 tests, all passing
pnpm build                    # FAILS — pre-existing OOM on @zcode/web, not a regression
```
