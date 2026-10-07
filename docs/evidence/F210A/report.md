# F210A — Worker A (Edge + Asset) Wave 1 Completion Evidence

- **Work item:** F210A — Identity/Tenancy/Actor kernel (Wave 1 lane A)
- **Owner:** Worker A (Edge + Asset)
- **Base commit:** `686d9bd` (the merged Wave 0 tree — F200A packages are in it)
- **Branch:** `work/f210a`
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
- `docs/evidence/F210A/**` (granted carve-out)
- `spec/snapshots/fleetos-contracts.json` (generated — updated via `pnpm fleetos:snapshot`)

The 10 owned `src/index.ts` files gained one new line each
(`export * from "./kernel.js";`). No file outside the above paths was
modified.

## 2. What became kernel-grade

The Wave 0 contracts shipped pure types + pure state-machine evaluators.
Wave 1 makes them REAL kernels: deep state machines with audit-event
emission contracts, deterministic in-memory reference implementations over
structural PORT interfaces, tenant-scoped reads, honest degradation, and
supersession/idempotency discipline. Every consequential kernel operation
emits a structural `AuditEventRef { actor, intent, tenant, timestamp, digest }`
(A19) and is tenant-scoped.

### 2.1 `packages/identity` — the Actor kernel

- **Session lifecycle** (`evaluateSessionTransition`): `issued -> active ->
  expired/revoked` with machine-stable reason codes
  (`illegal-transition`, `already-in-target-state`, `missing-reason`,
  `unknown-command`) and monotonic per-actor sequence (`issueSession` refuses
  `seq <= lastSeq`).
- **Session validation** (`validateSession`): fail-closed predicate over
  `(context, session, now)` — refuses `tenant-mismatch`, `actor-mismatch`,
  `revoked`, `expired`, `not-yet-active`.
- **Membership state machine** (`bindRole`, `unbindRole`): integrity
  invariants — refuses duplicate `(actor, role)` pairs (`duplicate-binding`),
  refuses orphan bindings (`orphan-actor`, `orphan-role`), refuses
  tenant-mismatch. Unbind is idempotent — re-unbinding returns
  `idempotent=true` with an audit-emitted `unbind:idempotent` event.
- **`ActorDirectory`** over a structural `ActorRepositoryPort` +
  deterministic `InMemoryActorRepository` reference implementation.
  Tenant-scoped reads fail-closed (cross-tenant lookup returns null).
  Audit-emitting `registerActor`, `lookupActor`, `listActors`,
  `bindActorToRole`, `unbindActorFromRole`, `listActiveRoles`.

File split (the kernel exceeds the 400-line `maxFileLines` lint limit when
in one file): `kernel.ts` (session + membership, 324 lines),
`kernel-directory.ts` (ActorRepositoryPort + InMemoryActorRepository +
ActorDirectory, 245 lines), `kernel-audit.ts` (AuditEventRef + digestOf,
23 lines).

### 2.2 `packages/tenancy` — the Tenant kernel

- **Provisioning workflow** with full legal-transition table
  (`evaluateTenantTransition` from Wave 0, now wrapped with audit emission
  via `TenantRegistry.executeTransition`):
  `provisioning -> active -> suspended -> closing -> closed` with refusal
  reasons (`illegal-transition`, `missing-reason`, `already-in-target-state`,
  `unknown-command`, `duplicate-tenant`, `unknown-tenant`,
  `malformed-tenant-id`, `missing-display-name`, `invalid-created-at`).
- **Monotonic transition sequence** — `transitionSeq` increments on every
  transition; the audit digest includes the sequence so it changes between
  identical commands at different positions in the timeline.
- **`TenantRegistry`** over a structural `TenantRegistryPort` +
  deterministic `InMemoryTenantRegistry` reference.
- **Suspension propagation contract** — `evaluateTenantOperation(tenant,
  op)` returns a typed refusal surface:
  - `provisioning`: refuses writes (`tenant-provisioning-no-writes`), allows
    reads and `provision`.
  - `active`: allows all operations.
  - `suspended`: refuses writes/admit/mutate/provision
    (`tenant-suspended-read-only`), allows reads and `close`.
  - `closing`: refuses new writes (`tenant-closing-no-new-writes`), allows
    reads and `close`.
  - `closed`: refuses ALL operations including reads
    (`tenant-closed-no-operations`).
- **`establishTenant`** — fail-closed tenant establishment helper that pairs
  validation + lookup; refuses `unknown-tenant`, `tenant-suspended`,
  `tenant-closed`, `tenant-provisioning` (unless `allowTransitional=true`).

### 2.3 `packages/assets` — the DeviceTwin kernel

- **Append-only revision log with REAL admission** (`admitTwinRevision`):
  - Digest verification of the source `ObservationRef.payloadDigest` (refuses
    `invalid-observation-digest` if not a 64-char hex string).
  - Monotonic sequence enforcement (refuses `non-monotonic-seq`).
  - Conflict refusal via a content-addressed `revisionDigest` chain
    (`conflict-parent-digest-mismatch` when the supplied `parentDigest`
    doesn't match the head's `revisionDigest`). Genesis uses `"genesis"`
    sentinel.
  - Tamper-evident: identical inputs produce identical digests; differing
    attributes produce differing digests.
- **Twin projection engine** (`projectTwin(revisions, deviceId, tenantId)`):
  folds to current state with honest degradation:
  - `unknown`: no revisions.
  - `pending`: only `manual`-source revisions (the twin is not authoritative
    until at least one observation lands).
  - `current`: at least one `observation`-source revision.
  Carries `headDigest`, `lastSeq`, `lastObservedAt`.
- **Lifecycle admission** (`AssetDirectory`) over a structural
  `AssetRepositoryPort` + `InMemoryAssetRepository` reference:
  - `admitAsset`: tenant-scoped, refuses `duplicate-asset`,
    `malformed-asset-id`, `missing-display-name`, `invalid-created-at`.
  - `transitionAsset`: `admitted -> active -> retired` (Wave 0 contract
    preserved), audit-emitting, tenant-fail-closed.
  - Same asset id allowed across tenants (no collision).

File split: `kernel.ts` (twin admission + projection, 264 lines),
`kernel-directory.ts` (AssetRepositoryPort + InMemoryAssetRepository +
AssetDirectory, 180 lines), `kernel-audit.ts` (AuditEventRef + digestOf,
22 lines).

### 2.4 `packages/observations` — the ingestion kernel

- **Idempotent admission** with ack/rejection contracts (Wave 0
  `admitObservation` baseline, now wrapped with audit emission via
  `admitToLog`). Double-admission acks are identical (`ack.duplicate=true`,
  same id, same digest); the log is untouched on idempotent acks.
- **`(deviceId, seq)` dedup** (Wave 0 baseline preserved).
- **Back-pressure signaling types** (`evaluateBackpressure`): typed
  `BackpressureSignal` with `ok/warn/critical` levels and
  `accept/shed/reject` suggested actions. Informational, not an error — the
  caller decides how to react.
- **Raw immutability** (`assertObservationImmutable`): an attempt to
  present a candidate observation whose digest differs from the stored
  observation is refused by construction (`digest-mismatch`,
  `device-mismatch`, `seq-mismatch`). The store's observation is the source
  of truth; the candidate is rejected.
- **Normalization pipeline** (`normalizeObservation`): pure 5-stage fold
  (`validate-shape -> validate-kind -> decode-payload ->
  canonicalize-fields -> emit-canonical`) with per-stage failure reason
  codes:
  - `validate-shape`: `missing-tenant-id`, `missing-device-id`,
    `invalid-observed-at`.
  - `validate-kind`: `missing-kind`, `unknown-kind` (the kernel accepts
    `telemetry.*`, `event.*`, `state.*`, `health.*` and rejects other
    prefixes).
  - `decode-payload`: `payload-empty`, `payload-not-json`,
    `payload-not-object`.
  - `canonicalize-fields`: sorts keys for deterministic digest.
  - `emit-canonical`: produces a `CanonicalObservation` with a content-
    addressed `canonicalDigest`.
  - `AdmittedObservationLog` + `listObservationsForDevice` — tenant
    fail-closed log.

### 2.5 `packages/health` — the diagnosis kernel

- **Triage over admitted observations** with confidence + insufficient-data
  degradation (`triageWithConfidence`): each `FindingWithConfidence` carries
  a 0..1 confidence derived from the count of supporting observations
  (linear up to 5 observations, saturates at 1.0). Honest degradation
  preserved (`insufficient-data`, `unknown-signal-vocabulary`).
- **Diagnosis hypothesis lifecycle** (`proposeDiagnosis`,
  `applyDiagnosisCommand`): `proposed -> corroborated -> resolved/
  superseded` with full legal-transition table:
  - `corroborate`: `proposed -> corroborated`, `corroborated -> corroborated` (illegal — terminal transition).
  - `resolve`: requires `newEvidence` (refuses `missing-evidence`); refuses
    `already-in-target-state` on resolved hypotheses.
  - `supersede`: terminal — refuses `already-in-target-state` on already-
    superseded hypotheses.
- **Supersession discipline** (`supersedeDiagnosis`): a superseded diagnosis
  is NEVER mutated — a new successor record carries the prior id in
  `supersedes`; the prior record gets a `supersededBy` pointer (a separate,
  audited transition). The prior's `evidence` list is preserved untouched.
- **`DiagnosisRegistry`** (`emptyDiagnosisRegistry`, `registerDiagnosis`,
  `lookupDiagnosis`, `listDiagnosesForDevice`, `currentDiagnosisForDevice`):
  tenant-scoped in-memory chain of diagnoses per device. The current
  diagnosis is the live (non-superseded) hypothesis with the highest
  `transitionSeq`.

File split: `kernel.ts` (triage + lifecycle + supersession, 353 lines),
`kernel-registry.ts` (DiagnosisRegistry helpers, 72 lines),
`kernel-audit.ts` (AuditEventRef + digestOf, 22 lines).

### 2.6 `packages/recovery` + `packages/maintenance` — deepened state machines

- **`packages/recovery`**:
  - Audit-emitting transition wrapper `applyRecoveryCommandAudited` over the
    Wave 0 `evaluateRecoveryTransition` (full legal-transition table
    preserved: `open -> investigating -> proposal -> resolved | closed`, with
    `reopen`).
  - **`RecoveryCaseDirectory`** over a structural `RecoveryCaseRegistryPort`
    + `InMemoryRecoveryCaseRegistry`. Tenant-scoped reads fail-closed.
  - **Scheduling contracts for maintenance windows**
    (`declareRecoveryWindow`, `windowActiveAt`): typed
    `RecoveryWindow { caseId, tenantId, startsAt, endsAt, reason }` with
    refusal codes (`missing-reason`, `invalid-window`, `ends-before-start`).

- **`packages/maintenance`**:
  - Audit-emitting transition wrapper `applyMaintenanceCommandAudited` over
    the Wave 0 `evaluateMaintenanceTransition` (full legal-transition table
    preserved: `scheduled -> in-progress -> completed`, `scheduled/in-
    progress -> cancelled`).
  - **Scheduling contracts for maintenance windows**
    (`declareMaintenanceWindow`, `windowNextRun`, `windowContainsAt`):
    typed `MaintenanceWindow` (one-time OR recurring with `intervalMs` and
    `durationMs`); `windowNextRun` returns the next valid run time, or null
    when the window has expired (recurring windows also refuse runs where
    `candidate + durationMs > endsAt` — the run would not fit).
  - **`MaintenanceOrderDirectory`** over a structural
    `MaintenanceOrderRegistryPort` + `InMemoryMaintenanceOrderRegistry`.

### 2.7 `packages/connectivity` + `packages/integrations/adcos` + `apps/agent` — advanced seams

- **`packages/connectivity`**:
  - **`ConnectivityDirectory`** over a structural `ConnectivityDirectoryPort`
    + `InMemoryConnectivityDirectory` reference. Tenant-scoped status
    records (`TenantStatusRecord` pairs the device with its tenant for
    fail-closed reads — cross-tenant `status()` returns `unknown`).
  - Audit-emitting `recordStatus` and `evaluate` (intent reflects the
    decision effect: `connectivity:evaluate:allow` vs
    `connectivity:evaluate:deny`).
  - Honest degraded state preserved from Wave 0 (no status recorded ->
    `unknown`).

- **`packages/integrations/adcos`**:
  - **Token lifecycle** for command-auth (`CommandToken`:
    `issued -> verified -> expired`). The kernel validates the token BEFORE
    consulting the device map; expired or unverified tokens are rejected
    with `token-not-verified` / `token-expired` / `token-tenant-mismatch`.
  - **`AuditedAdcosProvider`** wraps a base `AdcosProviderPort` with audit
    emission AND tenant-scoped device visibility: a device not registered
    for THIS tenant is treated as `device-not-found` (fail-closed —
    identical to "device unknown").
  - **`HealthCheckCache`** with TTL: a recent health check is reused within
    the TTL rather than re-queried; the audit intent distinguishes
    `adcos:health:<state>` (fresh) vs `adcos:health:cached:<state>` (cache
    hit). `invalidate()` forces a re-query on the next call.
  - Honest degradation preserved from Wave 0 (`device-not-found`,
    `command-unsupported`, `provider-unavailable`, `degraded`).

- **`apps/agent`**:
  - **Enrollment/trust REAL transitions with token lifecycle**:
    `EnrollmentToken` (`issued -> verified -> expired`) pairs with the Wave
    0 `AgentLoop` enroll/establish-trust transitions. `enrollWithToken`
    validates the token (tenant + agent + state + expiry) before stepping
    the loop. `validateEnrollmentToken` refuses `token-not-verified`,
    `token-expired`, `token-tenant-mismatch`, `token-agent-mismatch`.
  - **Command-inbox ack contracts** (`ackCommand`): typed
    `CommandAck { commandId, state, ackedAt }` with
    `received/duplicate/rejected` states. Idempotent — re-acking an
    already-acked command id returns `state=duplicate` with the same audit
    digest (the log is untouched). Refuses `missing-command-id` and
    `missing-kind`.
  - **Reconciliation diff types** (`computeDiff`): typed
    `ReconciliationDiff { localHead, remoteHead, drift, diff }` derived
    from the ReconciliationPort's heads; `drift=true` when heads differ.
  - Audit-emitting `auditedStep` wrapper around the Wave 0 `step`
    function.

## 3. Tests

| Package | Test files | Tests (total / new) | Status |
|---------|------------|---------------------|--------|
| `@fleetos/identity` | `src/identity.test.ts`, `src/kernel.test.ts` | 64 (17 + 47) | all passing |
| `@fleetos/tenancy` | `src/tenancy.test.ts`, `src/kernel.test.ts` | 54 (21 + 33) | all passing |
| `@fleetos/assets` | `src/assets.test.ts`, `src/kernel.test.ts` | 54 (20 + 34) | all passing |
| `@fleetos/observations` | `src/observations.test.ts`, `src/kernel.test.ts` | 46 (16 + 30) | all passing |
| `@fleetos/health` | `src/health.test.ts`, `src/kernel.test.ts` | 38 (11 + 27) | all passing |
| `@fleetos/recovery` | `src/recovery.test.ts`, `src/kernel.test.ts` | 44 (24 + 20) | all passing |
| `@fleetos/maintenance` | `src/maintenance.test.ts`, `src/kernel.test.ts` | 50 (22 + 28) | all passing |
| `@fleetos/connectivity` | `src/connectivity.test.ts`, `src/kernel.test.ts` | 31 (12 + 19) | all passing |
| `@fleetos/adcos` | `src/adcos.test.ts`, `src/kernel.test.ts` | 35 (16 + 19) | all passing |
| `@fleetos/agent` | `src/agent.test.ts`, `src/kernel.test.ts` | 50 (25 + 25) | all passing |
| **Lane total** | | **466 (184 + 282)** | all passing |
| **`pnpm -r test` total** | | **760 (478 + 282)** | all passing |

Threshold: >= 20 per core package (identity, tenancy, assets, observations) — all four meet it (64/54/54/46). >= 15 for the others (health 38, recovery 44, maintenance 50, connectivity 31, adcos 35, agent 50) — all six meet it. >= 200 total for the lane — 466 >> 200. >= 200 NEW tests for the lane — 282 >> 200.

### Test themes covered (meaningful, not shape-only)

- **AuditEventRef shape**: every consequential kernel operation emits an audit with all five fields (`actor`, `intent`, `tenant`, `timestamp`, `digest`); digest is a 64-char sha256 hex.
- **Audit digest determinism**: identical inputs produce identical digests (proven via cross-instance equality).
- **Audit digest tamper-evidence**: digest changes when inputs change (revision digest changes when attributes change; transition audit digest changes with `transitionSeq`).
- **Legal/illegal transitions with reason codes**: every state machine has explicit refusal tests with machine-stable reason codes (`illegal-transition`, `already-in-target-state`, `missing-reason`, `missing-evidence`, `non-monotonic-seq`, etc.).
- **Idempotency (double-admission acks identical)**: observations, agent command-inbox, membership unbind — all return idempotent acks on duplicate calls; the underlying state is untouched.
- **Tenant fail-closed**: cross-tenant reads return `null`/`unknown`/empty in every registry (Actor, Tenant, Asset, Maintenance, Recovery, Connectivity, Diagnosis).
- **Determinism**: identical inputs to two fresh instances produce identical outputs (verified for tenants, assets, connectivity, observations).
- **Degradation honesty**: triage `insufficient-data` / `unknown-signal-vocabulary`; twin projection `unknown` / `pending` / `current`; suspended/closed tenant refusal surfaces; adcos `device-not-found` / `command-unsupported` / `provider-unavailable` / `degraded`.
- **Supersession discipline**: the prior diagnosis record's `evidence` list is NOT mutated by supersession; the successor starts in `proposed` with `supersedes` pointing at the prior; the prior's `supersededBy` pointer is set on a separate audited transition.
- **Monotonic sequence enforcement**: session issuance (`seq > lastSeq`); twin revisions (`seq > lastSeq`); tenant transitions (`transitionSeq` increments per transition).
- **Token lifecycle**: enrollment tokens and ADCOS command tokens refuse `token-not-verified` / `token-expired` / `token-tenant-mismatch` / `token-agent-mismatch`; verification and expiry are idempotent.
- **Back-pressure signaling**: `evaluateBackpressure` returns `ok`/`warn`/`critical` with `accept`/`shed`/`reject` suggested actions.
- **Conflict refusal**: twin revision log rejects `conflict-parent-digest-mismatch` when the supplied `parentDigest` doesn't match the head's `revisionDigest`.
- **Maintenance windows scheduling**: `windowNextRun` returns the next valid run for one-time and recurring windows; recurring windows refuse runs that would not fit (`candidate + durationMs > endsAt`).
- **Suspension propagation**: `evaluateTenantOperation` returns a typed refusal surface per tenant state (`provisioning`/`active`/`suspended`/`closing`/`closed`) per operation kind (`read`/`write`/`admit`/`mutate`/`provision`/`close`).

## 4. Gate outputs (exact)

### 4.1 `pnpm lint` — PASS (no NEW issues vs base)

```
Found 70 warnings and 0 errors.
Finished in 543ms on 2724 files using 2 threads.
```

Baseline at `686d9bd` was `70 warnings, 0 errors` on `2698 files`. After
F210A: `70 warnings, 0 errors` on `2724 files` (26 new files from F210A —
13 kernel source files + 13 kernel test files; +0 new warnings; +0 new
errors). The single transient `no-unused-vars` warning for the unused `e`
parameter in `apps/agent/src/kernel.test.ts` was fixed before final commit
(renamed to `_e`).

Exit code: 0.

### 4.2 `pnpm typecheck` — PASS (root typecheck unchanged)

```
> tsc -b packages/rpc packages/provider packages/provider-node packages/shared packages/services packages/client packages/server packages/zcode-server-cli packages/ui packages/web packages/desktop/tsconfig.host.json
```

The root `typecheck` script only includes the ZCode substrate packages
(hardcoded in root `package.json`, owned by TL). It exits 0 — no
regression. Per-package `pnpm typecheck` (`tsc --noEmit`) for each of the 10
new `@fleetos/*` packages: all PASS.

### 4.3 `pnpm architecture:check` — PASS (0 violations)

```
architecture: OK
violations: 0
baseline: 0
new: 0
```

Exit code: 0. F201's policy fix (architecture-policy.yaml version 1 with
all 32 FleetOS bounded-context modules registered as transitional
`managed: false`) is in the merged Wave 0 tree at `686d9bd`. My new kernel
files are subject only to the file-line / lint-disable checks (which they
all pass).

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
contract snapshot written: 32 packages, 664 exported symbols
```

Baseline at `686d9bd` was 32 packages / 500 exported symbols. After F210A:
32 packages / 664 exported symbols (+164 new exported symbols across my 10
owned packages). The snapshot is committed alongside the lane
(`spec/snapshots/fleetos-contracts.json`).

### 4.6 `pnpm fleetos:snapshot:check` — PASS

```
contract snapshot unchanged (32 packages)
```

Exit code: 0.

### 4.7 `pnpm -r test` — PASS (760 tests, +282 vs base)

```
Total tests: 760
```

Baseline at `686d9bd` was 478 tests passing. After F210A: 760 tests passing
(478 + 282 new). Per-package test counts in §3 above. All 32 packages
green.

### 4.8 `pnpm build` (full recursive) — FAILS AT BASELINE (environmental — `@zcode/web` / `@zcode/server` OOM)

```
packages/server build: Failed
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @zcode/server@ build: `tsup && pnpm run build:remote`
Command failed with signal "SIGTERM"
```

`@zcode/server` (TL-owned substrate) tsup-builds and runs out of memory in
the build container before reaching the new `@fleetos/*` packages.
**Pre-existing at base `686d9bd`.** Per the stop-the-line rule, I did NOT
modify `@zcode/server` or `@zcode/web` or any substrate build config.

`pnpm build:bootstrap` fails the same way (the OOM halts the recursive
build before it reaches the new `@fleetos/*` packages). This is identical
to the F200A baseline behavior.

To verify the new `@fleetos/*` packages build cleanly in isolation, I ran
`pnpm build` from inside each package directory. All 10 succeeded:

```
=== build @fleetos/identity ===   tsc --noEmit   → exit 0
=== build @fleetos/tenancy ===    tsc --noEmit   → exit 0
=== build @fleetos/assets ===     tsc --noEmit   → exit 0
=== build @fleetos/observations === tsc --noEmit → exit 0
=== build @fleetos/health ===     tsc --noEmit   → exit 0
=== build @fleetos/recovery ===   tsc --noEmit   → exit 0
=== build @fleetos/maintenance === tsc --noEmit  → exit 0
=== build @fleetos/connectivity === tsc --noEmit → exit 0
=== build @fleetos/adcos ===      tsc --noEmit   → exit 0
=== build @fleetos/agent ===      tsc --noEmit   → exit 0
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

Zero cross-worker `@fleetos/*` imports across all 10 `@fleetos/*` packages.
Every cross-context concept is modeled as a LOCAL structural interface
(`TenantIdLike`, `DeviceIdLike`, `ObservationLike`, `ObservationRefLike`,
`EvidenceRefLike`, `AssetIdLike`, etc.) — exactly the Wave 0 pattern.

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

The Wave 0 contract surface is preserved — all Wave 0 exports remain
unchanged. The kernel additions are ADDITIVE: new types, new functions,
new classes, new structural ports. The snapshot grew from 500 to 664
exported symbols (+164 across my 10 packages).

No structural seam deltas are requested. The cross-worker seam pattern
from F200A continues to hold: structural `TenantIdLike`, `DeviceIdLike`,
etc. local to each package, structurally compatible with the canonical
shapes the TL converges at F201.

Two notes for TL awareness (NOT deltas — informational):

1. **`AuditEventRef` is structurally defined in every package** (identity,
   tenancy, assets, observations, health, recovery, maintenance,
   connectivity, adcos, agent) with the same shape
   `{ actor, intent, tenant, timestamp, digest }`. This is the F200A
   structural-seam pattern (each package defines its own local structural
   type). The TL may wish to converge `AuditEventRef` into the shared
   contracts at F211 (the TL's transactional-persistence lane) when
   cross-worker audit emission needs a single canonical type.

2. **File split convention**: the kernel additions to identity, assets,
   and health exceeded the 400-line `maxFileLines` lint limit when written
   as a single `kernel.ts`. I split each into `kernel.ts` + `kernel-*.ts`
   companion files (audit / directory / registry) — each under 400 lines.
   The public surface is unchanged (the `kernel.ts` re-exports from the
   companion files via `export * from "./kernel-*.js"`). If the TL prefers
   a different split convention (e.g., one kernel file per concern), I'll
   refactor at the TL's request.

## 7. Residual limitations (honest list)

1. **`pnpm build` (recursive) is broken at baseline by `@zcode/web` /
    `@zcode/server` OOM.** Pre-existing at base `686d9bd`. The new
    `@fleetos/*` packages are never reached by the recursive build, but
    each one's own `pnpm build` (`tsc --noEmit`) passes cleanly when run
    in isolation. See §4.8.

2. **Kernel contracts are TYPES + PURE functions over injected PORT
    interfaces only — no I/O, no servers, no databases.** Per Wave 1
    spec, none of the new packages implement persistence, network, or
    scheduling primitives. The `InMemoryActorRepository`,
    `InMemoryTenantRegistry`, `InMemoryAssetRepository`,
    `InMemoryRecoveryCaseRegistry`, `InMemoryMaintenanceOrderRegistry`,
    `InMemoryConnectivityDirectory`, and `HealthCheckCache` are
    deterministic in-memory references, not production adapters. Real
    persistence + transactional outbox lands at F211 (the TL's lane).

3. **`@fleetos/agent` kernel is a state-machine + audit wrapper, not a
    runtime.** The kernel pairs the Wave 0 `AgentLoop` with token lifecycle,
    command-inbox ack, and reconciliation diff contracts. The actual
    runtime that polls a real command inbox, emits telemetry to a real
    sink, and reconciles with a real remote head is F230A (Wave 3).

4. **`@fleetos/observations` uses `node:crypto` for SHA-256 digest
    computation.** This is a computational primitive (no I/O, no network,
    no process spawn) and is consistent with the A3 immutability +
    content-addressing law and A19 audit. The `scripts/architecture/policy.mjs`
    `domain-io` rule rejects `node:*` imports in domain layers — but my
    packages are registered as `managed: false` (transitional) so the rule
    is not enforced on them yet. The TL may wish to register a policy
    exception for `node:crypto` (and similar computational primitives
    like `node:util`/`node:assert`) at F211 when adopting the packages as
    managed modules.

5. **The `AuditedAdcosProvider` and `ConnectivityDirectory` are
    deterministic wrappers, not real adapters.** They wrap a base port
    (which may be backed by a real network adapter in production) with
    audit emission and tenant scoping. Real ADCOS / connectivity adapters
    land at F250A (Wave 5).

6. **`HealthCheckCache` is in-memory and per-process.** A real
    distributed health-check cache would live outside the kernel (the
    kernel exposes the TTL behavior; the cache storage is an
    infrastructure concern owned by the TL).

## 8. Cross-worker seam compliance

Per `spec/worker-ownership.yaml` rule `cross_worker_imports:
forbidden_in_implementation` and the F210A spec's binding seam rule:

- **No `@fleetos/*` package imports any other `@fleetos/*` package.**
  Verified by grep in §5.
- **No `@zcode/*` package is imported by any `@fleetos/*` package.**
  Verified by grep in §5. Zero substrate dependencies — pure TypeScript
  domain packages.
- **Cross-context concepts are modeled as LOCAL STRUCTURAL interfaces**
  in the owning package. The Wave 0 seams are unchanged.

The TL converges all seams at F201 (already merged into `686d9bd`).

## 9. Stop-the-line events

- **`pnpm build` / `pnpm build:bootstrap` baseline failure** (see §4.8).
  Stop-the-line triggered; root cause is `@zcode/web`/`@zcode/server`
  build OOM in the container (TL-owned substrate). Not fixed by F210A.
  Reported verbatim above. Identical to the F200A baseline behavior.

No other stop-the-line events occurred.

## 10. Verification commands for TL re-run

```bash
git fetch origin work/f210a:work/f210a
git checkout work/f210a
pnpm install                                    # regenerates lockfile; allowed
pnpm lint                                       # expect 70 warnings / 0 errors
pnpm typecheck                                  # expect exit 0 (substrate only)
pnpm architecture:check                         # expect OK / 0 violations
pnpm fleetos:source-of-truth                    # expect PASSED
pnpm fleetos:snapshot                           # regenerate the snapshot
pnpm fleetos:snapshot:check                     # expect "unchanged (32 packages)"
pnpm --filter @fleetos/identity test            # expect 64/64
pnpm --filter @fleetos/tenancy test             # expect 54/54
pnpm --filter @fleetos/assets test               # expect 54/54
pnpm --filter @fleetos/observations test         # expect 46/46
pnpm --filter @fleetos/health test               # expect 38/38
pnpm --filter @fleetos/recovery test             # expect 44/44
pnpm --filter @fleetos/maintenance test          # expect 50/50
pnpm --filter @fleetos/connectivity test         # expect 31/31
(cd packages/integrations/adcos && pnpm test)   # expect 35/35
(cd apps/agent && pnpm test)                     # expect 50/50
pnpm -r test                                     # expect 760/760 total
pnpm build                                       # expect @zcode/server OOM (see §4.8)
pnpm build:bootstrap                            # expect @zcode/server OOM (see §4.8)
# per-package builds (all 10 owned packages):
for p in identity tenancy assets observations health recovery maintenance connectivity; do
  (cd packages/$p && pnpm build)
done
(cd packages/integrations/adcos && pnpm build)
(cd apps/agent && pnpm build)
```
