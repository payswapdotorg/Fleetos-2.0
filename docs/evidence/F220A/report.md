# F220A — Worker A (Edge + Asset) Wave 2 Completion Evidence

- **Work item:** F220A — ManagedAsset + DeviceTwin + Observation ingestion (Wave 2 lane A)
- **Owner:** Worker A (Edge + Asset)
- **Base commit:** `d87a3cc` (Wave 1 lanes A+B+C merged — main @ d87a3cc; the F220A task spec referenced `905be41` = Wave 1 lanes A+B merged, but Wave 1 lane C has since been accepted and merged. F210C touches different packages — work/projects/procurement domain — and does not conflict with this lane.)
- **Branch:** `work/f220a`
- **Date:** 2026-10-07

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-a):

- `packages/identity/**`
- `packages/tenancy/**`
- `packages/assets/**`
- `packages/observations/**`
- `packages/health/**`
- `packages/recovery/**`
- `packages/maintenance/**`
- `packages/connectivity/**`
- `packages/integrations/adcos/**`
- `apps/agent/**`
- `docs/evidence/F220A/**` (granted carve-out)
- `spec/snapshots/fleetos-contracts.json` (generated — updated via `pnpm fleetos:snapshot`)

No file outside the above paths was modified. The 10 owned `src/index.ts`
files gained one new line each (`export * from "./<new-module>.js";`).

## 2. What became operational-truth grade

Wave 1 (F210A) shipped kernel-grade state machines with audit emission,
tenant fail-closed reads, idempotency, and structural ports. Wave 2 (F220A)
deepens them to operational-truth grade: real ingestion pipelines, event-
sourced folds with checkpointing, conflict detection, evidence-chain
requirements, hysteresis-based anomaly detection, durable command-inbox
contracts, and honest connectivity posture.

### 2.1 `packages/observations` — production-grade ingestion

- **Staged admission pipeline** (`ingestion.ts`): receive -> validate ->
  normalize -> dedup -> admit. Each stage is a pure function returning a
  typed `StageOutcome`. Each stage carries its own failure reason
  vocabulary (`ReceiveFailureCode`, `ValidateFailureCode`,
  `NormalizeFailureCode`, `DedupFailureCode`, `AdmitFailureCode`). The
  pipeline threads state immutably through a `PipelineCarrier` that
  accumulates the boundary-computed payload digest, the normalized
  fields, and the canonical digest.
- **Per-stage metrics contracts** (`StageMetrics`): typed counters per
  stage (`received`/`validated`/`normalized`/`deduped`/`admitted`) and
  per-stage failure counts (`failedByStage`). Pure values; emission
  into a metrics sink is the application's responsibility.
- **Raw payload digesting (sha-256) at receive time** (`stageReceive`):
  the payload digest is computed at the boundary, BEFORE any later
  stage touches the payload. This is the A3 immutability + content-
  addressing law.
- **Back-pressure policy types** (`backpressure.ts`): bounded queues
  with explicit overflow behavior. The policy is refuse-and-retry
  (default) or shed-oldest. NEVER silent drop — when the queue is full,
  the caller receives a typed `overflow-refused` decision and is
  expected to retry. Shed-oldest records the shed count so the caller
  can observe the shedding. The signal is `ok`/`warn`/`critical` with
  `accept`/`shed`/`reject` suggested actions.
- **Batch admission with per-item acks** (`admitBatch`): the batch is
  processed in order; each item's ack is independent. Failed items do
  not abort the batch — the per-item ack captures the failure stage +
  reason.
- **Retention/read-model projection contracts** (`retention.ts`): per
  the storage-authority table in DEPENDENCY-GRAPH.md, the immutable
  store is authoritative (PostgreSQL); projections are disposable
  (rebuildable). The kernel exposes `ImmutableObservationStore` +
  `InMemoryImmutableStore` + `DeviceSummaryProjection` +
  `RetentionPolicy` + `projectionStale`.

File split (the kernel exceeds the 400-line `maxFileLines` lint limit
when in one file): `ingestion.ts` (stages + pipeline + audit +
re-exports), `backpressure.ts` (queue policy), `retention.ts`
(immutable store + projections + retention policy), `ingestion.test.ts`
(55 new tests).

### 2.2 `packages/assets` — the twin projection engine at truth grade

- **Event-sourced fold over the revision log with checkpointing
  contracts** (`foldRevisions`): pure deterministic reduction. The fold
  accepts a `resumeFromSeq` parameter so the caller can resume from a
  checkpoint — only revisions with `seq > resumeFromSeq` are applied.
  Returns the new `TwinFoldState` + a `TwinFoldCheckpoint` carrying the
  `lastAppliedSeq`, `atRevisionIndex`, and a content-addressed
  `checkpointDigest`.
- **Deterministic replay** (`verifyDeterministicReplay`): two fresh
  folds over the same log MUST produce byte-identical state. The
  verifier computes both folds and compares them via canonical JSON
  (sorted keys + recursive descent).
- **Conflict detection** (`detectConflicts`): concurrent revision
  sequences on the same device. Two revisions sharing a parent digest
  but with different digests are flagged as a `ConflictMarker`.
  Identical revisions (same digest) sharing a parent are NOT flagged
  (idempotent re-application).
- **Managed-asset registry: lineage references (A17)**
  (`declareLineage`, `LineageRegistry`): typed relationships per A17 —
  relational model, NO graph DB. The 10 relation kinds cover asset-
  component, asset-asset, asset-vendor, asset-method, asset-failure-mode,
  asset-project, and asset-material relationships. Refuses self-reference,
  duplicate lineage, and unknown relation kinds. Tenant-fail-closed
  reads.
- **Lifecycle projections per asset** (`projectLifecycle`): pure
  function over the asset's audit history. Returns the current lifecycle
  state (admitted/active/retired) + enrolledAt + retiredAt +
  transitionCount. Ignores audit entries for other assets/tenants.
- **Enrollment boundary** (`enrollment.ts`): an observation from an
  unenrolled device is refused with a machine-stable reason
  (`device-not-enrolled` / `device-enrollment-revoked` /
  `device-tenant-mismatch`). The `EnrollmentDirectory` admits + revokes
  enrollments; `gateObservationOnEnrollment` is the canonical predicate
  the ingestion layer consults before admitting any observation. Refuses
  malformed device ids, missing tenant ids, duplicate enrollments, and
  already-revoked enrollments. Re-enrollment after a revocation is
  allowed.

File split: `twin-engine.ts` (fold + checkpointing + deterministic
replay + conflict detection + lineage + lifecycle projection +
re-exports), `enrollment.ts` (EnrollmentRecord + EnrollmentDirectory +
gateObservationOnEnrollment), `twin-engine.test.ts` (45 new tests).

### 2.3 `packages/identity` + `packages/tenancy` — operational depth

- **Identity**: session validation with expiry sweeps (`sweepSessions`)
  — deterministic from timestamps, partitions sessions into
  valid/expired/revoked per tenant. Role hierarchies with inheritance
  contracts (`RoleHierarchy`, `inheritCapabilities`,
  `actorCapabilities`) — a child role inherits capabilities from its
  parent role transitively. Cycle detection (`detectCycle`) refuses a
  hierarchy with a cycle. Cross-tenant read refusal machine-tests at
  the directory level (`machineTestCrossTenantRefusal`).
- **Tenancy**: tenant operation sweep (`sweepTenants`) — deterministic,
  time-based classification of tenants by state, sorted within each
  bucket for stable iteration. Tenant-scoped session sweep integration
  contract (`sessionSweepActionForTenant`) — closing/closed tenants
  must have their sessions expire on the next sweep. Cross-tenant
  isolation assertion (`assertTenantIsolation`).

File split: `kernel-operational.ts` per package. 25 new identity tests +
13 new tenancy tests.

### 2.4 `packages/health` — signal-grade health

- **Rolling windows over admitted observations** (`RollingWindow`,
  `pushToWindow`, `windowStats`): a fixed-size sliding window over a
  numeric time series. The window evicts the oldest values when it
  exceeds `maxSize`. Pure value type — operations return new windows.
- **Deterministic anomaly thresholds with hysteresis (no flap-flopping)**
  (`evaluateAnomaly`, `HysteresisThreshold`): the threshold to ENTER
  anomaly state is higher than the threshold to EXIT. Without
  hysteresis, a value hovering near the threshold causes the anomaly
  flag to oscillate (high flap count). With hysteresis, the flag
  holds its state between the two thresholds (flap count = 1).
  Misconfigured thresholds (`enterThreshold <= exitThreshold`) are
  treated as no-op.
- **Diagnosis confidence propagation rules** (`propagateConfidence`,
  `ConfidencePropagationRules`): when new evidence is added to a
  diagnosis, the confidence is updated according to typed rules.
  Corroborating evidence increases confidence by `corroborationStep`
  (capped at 1.0). Contradicting evidence decreases it by
  `contradictionStep` (floored at 0.0). The `minCorroboration` rule
  suppresses confidence rise until enough corroboration has
  accumulated.
- **Anomaly transition audit emission** (`anomalyTransitionAudit`):
  emits an `AuditEventRef` when the anomaly flag transitions
  (entered/exited).

File split: `kernel-signals.ts` (rolling window + anomaly + confidence +
audit). 25 new tests.

### 2.5 `packages/recovery` + `packages/maintenance` — case orchestration depth

- **Recovery**: case workflows with evidence-chain requirements
  (`kernel-evidence.ts`). Every consequential transition (resolve,
  close) requires a typed set of evidence refs; a transition without
  its required evidence refs is refused with
  `insufficient-evidence-count` or `missing-evidence-kind`. The default
  rules require verification + diagnosis for resolve, audit +
  verification for close-from-investigating, and audit for
  close-from-resolved. Post-mortem verification
  (`verifyCaseEvidenceChainPostMortem`) walks a fully-resolved case's
  history and flags transitions that had insufficient evidence.
  Transitions with no rule are treated as 'no requirement' (NOT a
  failure).
- **Maintenance**: scheduling windows with conflict detection
  (`kernel-scheduling.ts`). Two windows that overlap on the same
  (tenant, assetId) AND have intersecting time ranges are flagged as a
  conflict. The scheduler (`scheduleWindow`,
  `checkMaintenanceOrderConflict`) refuses to schedule a conflicting
  window. Different assets (same tenant) and same asset (different
  tenant) are NEVER conflicting (cross-tenant isolation preserved).
  `buildScheduleSlot` constructs a typed slot per (tenant, assetId)
  with a `blocked` flag that's true when any window is currently
  active.

File split: `kernel-evidence.ts` + `kernel-scheduling.ts` per package.
16 new recovery tests + 19 new maintenance tests.

### 2.6 `packages/connectivity` + `packages/integrations/adcos` + `apps/agent` — the edge path

- **Connectivity**: honest connectivity posture (`posture.ts`). An
  unknown state is reported as `unknown`, NOT `online`. A state whose
  heartbeat is stale (older than `staleMs`) is downgraded to
  `degraded`. Beyond `deadMs`, an `online` record is downgraded to
  `degraded` (we don't claim `offline` without explicit knowledge).
  The posture sweep (`sweepConnectivityPosture`) deterministically
  classifies a tenant's device records.
- **ADCOS**: provider-degradation posture (`posture.ts`). The kernel
  counts consecutive successes/failures. After `degradedAfterFailures`
  (default 2), the provider is `degraded`. After
  `unavailableAfterFailures` (default 5), it's `unavailable`. The
  circuit breaker (`circuitBreakerDecide`) opens when the provider is
  unavailable — the kernel refuses to dispatch commands (returning
  `circuit-open`) rather than attempting a doomed call.
  `honestAdcosHealth` maps postures to the ADCOS health vocabulary
  without exaggeration.
- **Agent**: telemetry batching contracts with size/time triggers
  (`edge-path.ts`). The batcher accumulates telemetry events and
  flushes when EITHER `maxBatchSize` items are queued OR `maxBatchAgeMs`
  has elapsed. `forceFlush` emits whatever is in the batcher regardless
  of triggers. `shouldFlushOnTime` checks the time trigger only.
  Command-inbox durability types (`DurableAckLog`, `ackDurableCommand`)
  — re-acking the same command id returns `state=duplicate`
  (idempotent). The ack carries a content-addressed digest.
  Reconciliation diff application (`planReconciliation`,
  `applyReconciliationPlan`, `verifyConvergence`) — given a local head
  and a remote head, the kernel computes a typed plan (no-op /
  catch-up / replay-from) that deterministically converges to the
  remote head. Honest connectivity posture (`reportConnectivity`) — if
  no heartbeat has been received, the posture is forced to `unknown`
  regardless of what the caller claimed.

File split: `posture.ts` (connectivity + adcos), `edge-path.ts` (agent).
15 new connectivity tests + 16 new adcos tests + 27 new agent tests.

## 3. Tests

| Package | Test files | Tests (total / new) | Status |
|---------|------------|---------------------|--------|
| `@fleetos/identity` | `identity.test.ts`, `kernel.test.ts`, `kernel-operational.test.ts` | 89 (64 + 25) | all passing |
| `@fleetos/tenancy` | `tenancy.test.ts`, `kernel.test.ts`, `kernel-operational.test.ts` | 67 (54 + 13) | all passing |
| `@fleetos/assets` | `assets.test.ts`, `kernel.test.ts`, `twin-engine.test.ts` | 99 (54 + 45) | all passing |
| `@fleetos/observations` | `observations.test.ts`, `kernel.test.ts`, `ingestion.test.ts` | 101 (46 + 55) | all passing |
| `@fleetos/health` | `health.test.ts`, `kernel.test.ts`, `kernel-signals.test.ts` | 63 (38 + 25) | all passing |
| `@fleetos/recovery` | `recovery.test.ts`, `kernel.test.ts`, `kernel-evidence.test.ts` | 60 (44 + 16) | all passing |
| `@fleetos/maintenance` | `maintenance.test.ts`, `kernel.test.ts`, `kernel-scheduling.test.ts` | 69 (50 + 19) | all passing |
| `@fleetos/connectivity` | `connectivity.test.ts`, `kernel.test.ts`, `posture.test.ts` | 46 (31 + 15) | all passing |
| `@fleetos/adcos` | `adcos.test.ts`, `kernel.test.ts`, `posture.test.ts` | 51 (35 + 16) | all passing |
| `@fleetos/agent` | `agent.test.ts`, `kernel.test.ts`, `edge-path.test.ts` | 77 (50 + 27) | all passing |
| **Lane total** | | **722 (466 + 256)** | all passing |
| **`pnpm -r test` total** | | **1372 (1116 + 256)** | all passing |

Threshold: >= 30 for observations/assets — both meet it (101/99). >= 20
for identity/health — both meet it (89/63). >= 15 for the others (recovery
60, maintenance 69, connectivity 46, adcos 51, agent 77, tenancy 67) —
all six meet it. >= 220 total NEW tests for the lane — 256 >> 220.

### Test themes covered (meaningful, not shape-only)

- **Pipeline stage failures**: each stage has its own typed refusal codes
  (`missing-tenant-id`, `missing-device-id`, `missing-payload`,
  `invalid-observed-at`, `invalid-received-at`, `missing-kind`,
  `unknown-kind`, `invalid-seq`, `payload-empty`, `payload-not-json`,
  `payload-not-object`, `non-monotonic-seq`, `duplicate-seq`). The
  end-to-end `runPipeline` threads metrics through and increments
  `failedByStage.<stage>` on each failure.
- **Replay determinism (byte-identical folds)**: `verifyDeterministicReplay`
  computes two fresh folds over the same log and asserts canonical JSON
  equality. Tested with empty logs, single-revision logs, complex nested
  attributes, and 50+ revision logs.
- **Conflict refusal**: `detectConflicts` flags forks in the revision
  log (two revisions sharing a parent but with different digests).
  Identical revisions sharing a parent are NOT flagged (idempotent
  re-application).
- **Back-pressure honesty**: refuse-and-retry NEVER silent drops — the
  caller receives a typed `overflow-refused` decision and is expected
  to retry. Shed-oldest records the shed count so the caller can
  observe the shedding.
- **Tenant isolation**: cross-tenant reads return `null`/empty/`unknown`
  in every registry (Actor, Tenant, Asset, Maintenance, Recovery,
  Connectivity, Diagnosis, Lineage, Enrollment). The
  `machineTestCrossTenantRefusal` harness is a deterministic test
  that asserts the directory refuses cross-tenant reads at the
  directory level.
- **Evidence-required transitions**:
  `applyRecoveryCommandWithEvidenceChain` refuses a transition without
  its required evidence refs. Post-mortem verification flags transitions
  that had insufficient evidence. Transitions with no rule are treated
  as 'no requirement' (NOT a failure).
- **Hysteresis behavior**: a value oscillating between 95 and 105
  (between exit=90 and enter=100) does NOT cause the anomaly flag to
  flap (1 transition). The same series without hysteresis produces 5
  transitions.
- **Enrollment boundary**: an observation from an unenrolled device is
  refused with `device-not-enrolled`. A revoked enrollment is refused
  with `device-enrollment-revoked`. A tenant-mismatched enrollment is
  refused with `device-tenant-mismatch`. Re-enrollment after a
  revocation is allowed.
- **Reconciliation convergence**: `applyReconciliationPlan` brings the
  local head to match the remote head deterministically.
  `verifyConvergence` asserts the new head equals the remote head.
- **Honest connectivity posture**: a null heartbeat with caller-claimed
  `online` is forced to `unknown`. A stale online record is downgraded
  to `degraded`.
- **Circuit breaker**: when the ADCOS provider is `unavailable`, the
  circuit opens and the kernel refuses to dispatch commands.

## 4. Gate outputs (exact)

### 4.1 `pnpm lint` — PASS (no NEW issues vs base)

```
Found 70 warnings and 0 errors.
Finished in 570ms on 2805 files using 2 threads.
```

Baseline at `d87a3cc` (Wave 1 fully merged) was `70 warnings, 0 errors`
on `2782 files`. After F220A: `70 warnings, 0 errors` on `2805 files`
(+23 new files from F220A — 10 source modules + 10 test files + 3 split
helper modules: backpressure/retention/enrollment). +0 new warnings; +0
new errors. Two transient `max-lines` errors (in `ingestion.ts` at 461
lines and `twin-engine.ts` at 417 lines) and 8 unused-import warnings
were fixed before final commit by splitting the over-limit files into
companion modules and removing unused imports.

Exit code: 0.

### 4.2 `pnpm typecheck` — PASS (root typecheck unchanged)

```
> tsc -b packages/rpc packages/provider packages/provider-node packages/shared packages/services packages/client packages/server packages/zcode-server-cli packages/ui packages/web packages/desktop/tsconfig.host.json
```

The root `typecheck` script only includes the ZCode substrate packages
(hardcoded in root `package.json`, owned by TL). It exits 0 — no
regression. Per-package `pnpm typecheck` (`tsc --noEmit`) for each of
the 10 `@fleetos/*` packages: all PASS.

### 4.3 `pnpm architecture:check` — PASS (0 violations)

```
architecture: OK
violations: 0
baseline: 0
new: 0
```

Exit code: 0.

### 4.4 `pnpm fleetos:source-of-truth` — PASS

```
FleetOS source-of-truth check PASSED
Canonical architecture, ownership, work catalog, TL handoff and continuation files are present.
Exactly three implementation workers are registered.
Product identity: fleetos-2.0
Architecture lock: 2.0.0
```

Exit code: 0.

### 4.5 `pnpm fleetos:snapshot` — REGENERATED (intentional — exported surfaces grew)

```
contract snapshot written: 32 packages, 1142 exported symbols
```

Baseline at `d87a3cc` was 32 packages / 664 exported symbols (after
Wave 1). After F220A: 32 packages / 1142 exported symbols (+478 new
exported symbols across my 10 owned packages). The snapshot is
committed alongside the lane (`spec/snapshots/fleetos-contracts.json`).

### 4.6 `pnpm fleetos:snapshot:check` — PASS

```
contract snapshot unchanged (32 packages)
```

Exit code: 0.

### 4.7 `pnpm -r test` — PASS (1372 tests, +256 vs base)

```
Total tests: 1372
```

Baseline at `d87a3cc` (Wave 1 fully merged: F210A 466 + F210B 354 +
F210C 296 = 1116). After F220A: 1372 tests passing (1116 + 256 new).
Per-package test counts in section 3 above. All 32 packages green; 0
failures.

### 4.8 `pnpm build` (full recursive) — FAILS AT BASELINE (environmental — `@zcode/web` / `@zcode/cli` OOM)

```
apps/zcode-cli build: Failed:    @zcode/core#build
ERROR  run failed: command  exited (137)
```

`@zcode/cli` (TL-owned substrate) turbo-builds and runs out of memory
in the build container before reaching the new `@fleetos/*` packages.
**Pre-existing at base `d87a3cc`.** Per the stop-the-line rule, I did
NOT modify `@zcode/cli` or `@zcode/web` or any substrate build config.

To verify the new `@fleetos/*` packages build cleanly in isolation, I
ran `pnpm build` from inside each package directory. All 10 succeeded:

```
=== identity ===      tsc --noEmit   -> exit 0
=== tenancy ===       tsc --noEmit   -> exit 0
=== assets ===        tsc --noEmit   -> exit 0
=== observations ===  tsc --noEmit   -> exit 0
=== health ===        tsc --noEmit   -> exit 0
=== recovery ===      tsc --noEmit   -> exit 0
=== maintenance ===   tsc --noEmit   -> exit 0
=== connectivity ===  tsc --noEmit   -> exit 0
=== adcos ===         tsc --noEmit   -> exit 0
=== agent ===         tsc --noEmit   -> exit 0
```

## 5. Boundary verification (machine-tested)

```text
$ for p in identity tenancy assets observations health recovery maintenance connectivity; do
    grep -rEn 'import .* from .@fleetos/' packages/$p/src
  done
  (no matches)
$ grep -rEn 'import .* from .@fleetos/' packages/integrations/adcos/src
  (no matches)
$ grep -rEn 'import .* from .@fleetos/' apps/agent/src
  (no matches)
```

Zero cross-worker `@fleetos/*` imports across all 10 `@fleetos/*`
packages. Every cross-context concept is modeled as a LOCAL structural
interface (`TenantIdLike`, `DeviceIdLike`, `ObservationLike`,
`ObservationRefLike`, `EvidenceRefLike`, `AssetIdLike`, etc.) — exactly
the Wave 0/1 pattern.

```text
$ for p in identity tenancy assets observations health recovery maintenance connectivity; do
    grep -rEn 'import .* from .@zcode/' packages/$p/src
  done
  (no matches)
$ grep -rEn 'import .* from .@zcode/' packages/integrations/adcos/src
  (no matches)
$ grep -rEn 'import .* from .@zcode/' apps/agent/src
  (no matches)
```

Zero `@zcode/*` substrate imports across all 10 `@fleetos/*` packages.

## 6. Contract deltas requested (for TL adjudication)

The Wave 1 contract surface is preserved — all Wave 1 exports remain
unchanged. The Wave 2 additions are ADDITIVE: new types, new functions,
new classes, new structural ports. The snapshot grew from 664 to 1142
exported symbols (+478 across my 10 packages).

No structural seam deltas are requested. The cross-worker seam pattern
from F200A continues to hold: structural `TenantIdLike`, `DeviceIdLike`,
etc. local to each package, structurally compatible with the canonical
shapes the TL converges at F201.

One note for TL awareness (NOT a delta — informational):

1. **`AuditEventRef` is structurally defined in every package**
   (identity, tenancy, assets, observations, health, recovery,
   maintenance, connectivity, adcos, agent) with the same shape
   `{ actor, intent, tenant, timestamp, digest }`. This is the F200A
   structural-seam pattern (each package defines its own local
   structural type). The TL may wish to converge `AuditEventRef` into
   the shared contracts at F211 (the TL's transactional-persistence
   lane) when cross-worker audit emission needs a single canonical
   type.

2. **File split convention**: the kernel additions to observations
   and assets exceeded the 400-line `maxFileLines` lint limit when
   written as a single file. I split each into companion files
   (`ingestion.ts` + `backpressure.ts` + `retention.ts` for
   observations; `twin-engine.ts` + `enrollment.ts` for assets) —
   each under 400 lines. The public surface is unchanged (the main
   file re-exports from the companion files). If the TL prefers a
   different split convention, I'll refactor at the TL's request.

## 7. Residual limitations (honest list)

1. **`pnpm build` (recursive) is broken at baseline by `@zcode/web` /
    `@zcode/cli` OOM.** Pre-existing at base `d87a3cc`. The new
    `@fleetos/*` packages are never reached by the recursive build,
    but each one's own `pnpm build` (`tsc --noEmit`) passes cleanly
    when run in isolation. See section 4.8.

2. **Kernel contracts are TYPES + PURE functions over injected PORT
    interfaces only — no I/O, no servers, no databases.** Per Wave 2
    spec, none of the new packages implement persistence, network, or
    scheduling primitives. The `InMemoryImmutableStore`,
    `InMemoryEnrollmentRegistry`, `InMemoryActorRepository` (Wave 1),
    and the various in-memory registry references are deterministic,
    not production adapters. Real persistence + transactional outbox
    lands at F211 (the TL's lane).

3. **The transactional kernel (F211, the TL lane) lands separately —
    your in-memory transactional references are the correct
    deliverable for this wave.** The ingestion pipeline's store
    updates are pure functional (returns a new store); the
    transactional outbox that guarantees atomic
    business-state/event-publication consistency is F211.

4. **`@fleetos/agent` edge-path is a stateless batching/diff/audit
    module, not a runtime.** The kernel exposes telemetry batching,
    durable command-inbox ack, reconciliation planning, and honest
    connectivity posture as pure functions. The actual runtime that
    polls a real command inbox, emits telemetry to a real sink, and
    reconciles with a real remote head is F230A (Wave 3).

5. **`AuditedAdcosProvider` and `ConnectivityDirectory` are
    deterministic wrappers, not real adapters.** They wrap a base
    port (which may be backed by a real network adapter in production)
    with audit emission and tenant scoping. Real ADCOS / connectivity
    adapters land at F250A (Wave 5).

6. **`HealthCheckCache` is in-memory and per-process.** A real
    distributed health-check cache would live outside the kernel
    (the kernel exposes the TTL behavior; the cache storage is an
    infrastructure concern owned by the TL).

7. **Anomaly hysteresis is configured per device.** A real fleet
    deployment would derive the hysteresis thresholds from per-device
    baselines (e.g., a rolling-window mean + N standard deviations).
    The kernel exposes the typed `HysteresisThreshold` so the
    application can supply computed thresholds; the kernel itself does
    not compute them.

## 8. Cross-worker seam compliance

Per `spec/worker-ownership.yaml` rule `cross_worker_imports:
forbidden_in_implementation` and the F220A spec's binding seam rule:

- **No `@fleetos/*` package imports any other `@fleetos/*` package.**
  Verified by grep in section 5.
- **No `@zcode/*` package is imported by any `@fleetos/*` package.**
  Verified by grep in section 5. Zero substrate dependencies — pure
  TypeScript domain packages.
- **Cross-context concepts are modeled as LOCAL STRUCTURAL interfaces**
  in the owning package. The Wave 0/1 seams are unchanged.

The TL converges all seams at F201 (already merged into `d87a3cc`).

## 9. Stop-the-line events

- **`pnpm build` / `pnpm build:bootstrap` baseline failure** (see
  section 4.8). Stop-the-line triggered; root cause is `@zcode/cli`
  build OOM in the container (TL-owned substrate). Not fixed by
  F220A. Reported verbatim above. Identical to the F200A / F210A
  baseline behavior.

No other stop-the-line events occurred.

## 10. Verification commands for TL re-run

```bash
git fetch origin work/f220a:work/f220a
git checkout work/f220a
pnpm install                                    # regenerates lockfile; allowed
pnpm lint                                       # expect 70 warnings / 0 errors
pnpm typecheck                                  # expect exit 0 (substrate only)
pnpm architecture:check                         # expect OK / 0 violations
pnpm fleetos:source-of-truth                    # expect PASSED
pnpm fleetos:snapshot                           # regenerate the snapshot
pnpm fleetos:snapshot:check                     # expect "unchanged (32 packages)"
pnpm --filter @fleetos/identity test            # expect 89/89
pnpm --filter @fleetos/tenancy test              # expect 67/67
pnpm --filter @fleetos/assets test               # expect 99/99
pnpm --filter @fleetos/observations test         # expect 101/101
pnpm --filter @fleetos/health test               # expect 63/63
pnpm --filter @fleetos/recovery test             # expect 60/60
pnpm --filter @fleetos/maintenance test          # expect 69/69
pnpm --filter @fleetos/connectivity test         # expect 46/46
(cd packages/integrations/adcos && pnpm test)   # expect 51/51
(cd apps/agent && pnpm test)                    # expect 77/77
pnpm -r test                                    # expect 1372/1372 total
pnpm build                                      # expect @zcode/cli OOM (see section 4.8)
pnpm build:bootstrap                            # expect @zcode/cli OOM (see section 4.8)
# per-package builds (all 10 owned packages):
for p in identity tenancy assets observations health recovery maintenance connectivity; do
  (cd packages/$p && pnpm build)
done
(cd packages/integrations/adcos && pnpm build)
(cd apps/agent && pnpm build)
```
