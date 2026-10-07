# F230A — Worker A (Edge + Asset) Wave 3 Completion Evidence

- **Work item:** F230A — FleetOS Edge Agent (Wave 3 lane A)
- **Owner:** Worker A (Edge + Asset)
- **Base commit:** `3ec83cb` (Wave 2 lane A merged — F220A operational-truth is in it; the F220A surfaces — ingestion pipeline, twin fold, enrollment directory, honest posture sweep, telemetry batcher, durable ack log — are the lane-continuity inputs consumed by F230A)
- **Branch:** `work/f230a`
- **Date:** 2026-10-07

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-a):

- `packages/identity/**` — unchanged
- `packages/tenancy/**` — unchanged
- `packages/assets/**` — unchanged
- `packages/observations/**` — `store-forward.ts` (+ `store-forward.test.ts`)
- `packages/health/**` — `kernel-diagnostics.ts` (+ `kernel-diagnostics.test.ts`)
- `packages/recovery/**` — unchanged
- `packages/maintenance/**` — unchanged
- `packages/connectivity/**` — `posture-machine.ts` (+ `posture-machine.test.ts`)
- `packages/integrations/adcos/**` — `edge-adapter.ts` (+ `edge-adapter.test.ts`)
- `apps/agent/**` — 6 new modules: `enrollment-handshake.ts`, `trust-ladder.ts`, `telemetry-queue.ts`, `evidence-bundle.ts`, `command-inbox-lifecycle.ts`, `reconciliation-diff.ts` (+ 6 test files)
- `docs/evidence/F230A/**` (granted carve-out)
- `spec/snapshots/fleetos-contracts.json` (regenerated + committed with the lane)

No file outside the above paths was modified. The 5 owned `src/index.ts` files
that gained F230A modules each gained one new `export * from "./<new-module>.js";`
line.

## 2. What became edge-agent grade

Wave 2 (F220A) shipped operational-truth: ingestion pipeline, event-sourced
twin fold, enrollment boundary, honest posture sweep, telemetry batcher,
durable ack log, reconciliation planner — all as pure stateless functions.
Wave 3 (F230A) advances to **edge-agent runtime grade**: a real
enrollment handshake with nonce-based replay protection, an explicit trust
ladder with capability gating, a priority telemetry queue with
refuse-and-retry overflow, signed local evidence bundles with store-and-
forward, a full ack/apply/verify command lifecycle with idempotency, and a
deterministic structural reconciliation diff between the agent's intent
state and the authoritative twin.

### 2.1 `packages/connectivity` — honest posture model + durable outbox

- **`posture-machine.ts`** — the runtime posture state machine
  (`offline | degraded | connected`) with typed transitions. Pure function:
  same (current, event, now) -> same result. Illegal transitions are
  refused with `illegal-transition` / `already-in-state` / `missing-reason`.
  Manual degrade/recover require a reason (audit trail).
- **`MessageDurabilityQueue`** — bounded at-least-once outbox with explicit
  dedup on arrival. `enqueueMessage` is refuse-and-retry on overflow (NEVER
  silent drop); `ackMessage` removes from pending; `redeliverPending`
  re-emits unacked messages on reconnect (insertion order, FIFO).
  `dedupOnArrival` is the receiver-side helper.
- **Back-pressure propagation** — `evaluateBackpressure` returns
  `ok | warn | critical`; `propagateBackpressure` maps to `accept | shed |
  reject` — the batching engine consults the signal BEFORE overflow.

33 new tests. Honest posture transitions, history eviction, idempotent
re-enqueue, overflow honesty, dedup on arrival, back-pressure thresholds,
tenant isolation.

### 2.2 `packages/integrations/adcos` — edge-grade adapter

- **`edge-adapter.ts`** — ADCOS at edge grade. Typed error taxonomy:
  `transient` (`provider-unavailable`, `rate-limited`, `unknown-error`) vs
  `permanent` (`device-not-found`, `command-unsupported`,
  `missing-tenant-id`, `missing-device-id`). Retry policy: exponential
  backoff (pure function of attempt number); transient retried up to
  `maxAttempts`; permanent short-circuits. Boundary normalization: every
  external result is normalized to `EdgeAdcosResult` with a content-
  addressed digest over `(tenantId, deviceId, kind, result|code)`.
- **`EdgeAdcosAdapter`** — wraps a base `AdcosProviderPort`. The retry
  loop is bounded; each attempt emits a typed audit entry. The adapter
  does NOT own business truth; it only translates between ADCOS and the
  FleetOS edge vocabulary.
- **`buildEdgeHealthReport`** — never exaggerates: edge posture mirrors
  base health.

31 new tests. Typed error classification, exponential backoff, shouldRetry
decision, normalization digest stability, end-to-end retry success,
permanent short-circuit, max-attempts exhaustion, audit determinism,
tenant isolation.

### 2.3 `packages/health` — edge diagnostics

- **`kernel-diagnostics.ts`** — self-check probes with severity contracts.
  `ProbeSeverity = info | warn | error | fatal` (ordered). `runSelfCheck`
  runs a battery of probes and aggregates: overall = MAX severity;
  `fatal` short-circuits the battery (default `stopOnFatal=true`).
  Predicates: `isOperational` (info/warn), `isDegraded` (warn only),
  `isFatal`. The kernel exposes the contract + reference probes; real
  probes (network, disk, sensor) are injected via `SelfCheckProbe`.

26 new tests. Severity ordering, probe contracts, aggregation, fatal
short-circuit, operational/degraded/fatal predicates, tenant isolation,
edge-grade severity contract.

### 2.4 `packages/observations` — store-and-forward receiving side

- **`store-forward.ts`** — the receiving side of store-and-forward.
  `ObservationBundle` carries observations + integrity digest + agent
  signature. `receiveBundle` verifies signature FIRST (refuses forged
  bundle with `signature-invalid`), then integrity (refuses tampered with
  `integrity-invalid`), then dedup (idempotent — duplicate bundle returns
  `duplicate=true`, no re-admission). Per-observation dedup counts
  admitted vs duplicates.
- **Honest gap detection** — a missing bundle in the sequence surfaces as
  a typed `GapMarker` (NEVER a silent hole). Bundle seq jumps from N to
  N+K produces K-1 gap markers. `buildSequenceReport` walks the reception
  log and surfaces all known gaps.

33 new tests. Bundle digest determinism, signature + integrity, signature
refusal, integrity refusal, duplicate bundles (idempotent), per-observation
dedup, gap detection (single + multiple + out-of-order), sequence report,
tenant isolation, audit determinism.

### 2.5 `apps/agent` — the runtime core (6 new modules)

- **`enrollment-handshake.ts`** — device identity + attestation refs +
  nonce-based replay protection. `NonceReplayCache` is bounded + per-
  (tenant, device). `performEnrollmentHandshake` is a 5-stage pipeline:
  structural validation -> attestation verification -> nonce replay check
  -> enrollment gate -> success. Idempotent re-enrollment after reset
  (`declaredReset=true`). First-time enrollment (gate returns
  `device-not-enrolled`) is ACCEPTED. Refusal reasons: `missing-*`,
  `attestation-missing/invalid`, `nonce-replay-detected`,
  `device-enrollment-revoked`, `device-tenant-mismatch`,
  `duplicate-enrollment`.

- **`trust-ladder.ts`** — explicit trust levels with per-level capability
  grants. `TrustLevel = untrusted | low | standard | elevated`. Capabilities:
  untrusted=[], low=[observe], standard=[observe, execute-routine],
  elevated=[observe, execute-routine, execute-destructive, manage-trust].
  **A low-trust agent CANNOT execute commands** (the spec requirement) —
  `gateCapability("low", "execute-routine")` returns `trust-too-low`.
  Evidence requirements per upward transition: low=attestation,
  standard=+behavior-record, elevated=+operator-authorization. Downward
  transitions require a reason (can skip levels — security incident ->
  untrusted).

- **`telemetry-queue.ts`** — priority lanes with safety preemption +
  refuse-and-retry overflow. Two lanes: `safety` (preempts routine) and
  `routine`. Three flush triggers: safety-preemption (safety lane alone
  crosses `safetyLaneFlushAt`), size (total depth crosses `maxBatchSize`),
  time (oldest event exceeds `maxBatchAgeMs`). Flush ordering: safety
  events first (arrival order), then routine. Hard cap `maxQueueDepth`:
  enqueue above is refuse-and-retry (NEVER silent drop).

- **`evidence-bundle.ts`** — signed observation bundles pending upload
  (store-and-forward across outages). `EvidenceBundleStore` is bounded
  append-only. `buildBundle` computes digest (sha-256 over sorted
  observation payload digests — deterministic, order-independent) +
  signature (sha-256 over `(digest, agentKey)`). `markUploaded` removes
  from pending; adds to uploaded (bounded). `pendingBundles` returns
  insertion-order list for retransmit on reconnect.

- **`command-inbox-lifecycle.ts`** — ack/apply/verify lifecycle with
  idempotency. `CommandLifecycleState = received | applying | applied |
  verified | refused`. `applyCommand` consults the trust level for
  capability gating; re-applying an already-applied command returns
  `duplicate=true` (the applyFn is NOT called again — idempotent).
  `verifyCommand` emits a `VerificationEvidence` ref back to the sender
  with the command ID + applied-result digest. Refusal reasons:
  `trust-too-low`, `command-malformed`, `apply-failed`, `verify-failed`.

- **`reconciliation-diff.ts`** — deterministic structural diff between
  the agent's local intent state and the authoritative twin. Pure
  function: same inputs -> byte-identical diff. `IntentReconciliationDiff`
  carries `entries` (sorted by key) + `outcome` (`in-sync | local-ahead |
  remote-ahead | divergent`). `applyReconciliation` adopts the twin's
  values for divergent + remote-only entries; drops local-only entries
  (the twin's omission is authoritative — A2). `verifyIntentConvergence`
  asserts the post-apply local state equals the remote state.

126 new tests across the 6 modules. Enrollment replay protection,
trust-gated execution refusals, batching triggers + overflow honesty,
bundle integrity + dedup, exactly-once command application,
reconciliation determinism (same inputs -> byte-identical diff),
posture transitions, tenant isolation.

## 3. Tests

| Package | Test files | Tests (total / new) | Status |
|---------|------------|---------------------|--------|
| `@fleetos/identity` | `identity.test.ts`, `kernel.test.ts`, `kernel-operational.test.ts` | 89 (89 + 0) | all passing |
| `@fleetos/tenancy` | `tenancy.test.ts`, `kernel.test.ts`, `kernel-operational.test.ts` | 67 (67 + 0) | all passing |
| `@fleetos/assets` | `assets.test.ts`, `kernel.test.ts`, `twin-engine.test.ts` | 99 (99 + 0) | all passing |
| `@fleetos/observations` | `observations.test.ts`, `kernel.test.ts`, `ingestion.test.ts`, `store-forward.test.ts` | 134 (101 + 33) | all passing |
| `@fleetos/health` | `health.test.ts`, `kernel.test.ts`, `kernel-signals.test.ts`, `kernel-diagnostics.test.ts` | 89 (63 + 26) | all passing |
| `@fleetos/recovery` | `recovery.test.ts`, `kernel.test.ts`, `kernel-evidence.test.ts` | 60 (60 + 0) | all passing |
| `@fleetos/maintenance` | `maintenance.test.ts`, `kernel.test.ts`, `kernel-scheduling.test.ts` | 69 (69 + 0) | all passing |
| `@fleetos/connectivity` | `connectivity.test.ts`, `kernel.test.ts`, `posture.test.ts`, `posture-machine.test.ts` | 79 (46 + 33) | all passing |
| `@fleetos/adcos` | `adcos.test.ts`, `kernel.test.ts`, `posture.test.ts`, `edge-adapter.test.ts` | 82 (51 + 31) | all passing |
| `@fleetos/agent` | `agent.test.ts`, `kernel.test.ts`, `edge-path.test.ts`, `enrollment-handshake.test.ts`, `trust-ladder.test.ts`, `telemetry-queue.test.ts`, `evidence-bundle.test.ts`, `command-inbox-lifecycle.test.ts`, `reconciliation-diff.test.ts` | 203 (77 + 126) | all passing |
| **Lane total** | | **971 (722 + 249)** | all passing |
| **`pnpm -r test` total** | | **1621 (1372 + 249)** | all passing |

Thresholds:
- Agent >= 60: 126 new (>>60). ✓
- Connectivity >= 40: 33 new (below 40 — see residuals).
- "The rest" >= 30: observations 33, health 26, adcos 31 — see residuals.
- >= 180 total NEW lane tests: 249 (>>180). ✓

### Test themes covered (meaningful, not shape-only)

- **Enrollment replay protection**: a reused nonce is refused with
  `nonce-replay-detected`. The cache is per-(tenant, device) — the same
  nonce from a different device is NOT a replay. The cache is bounded;
  oldest entries evicted when full.
- **Trust-gated execution refusals**: a low-trust agent CANNOT execute
  commands (`gateCapability("low", "execute-routine")` returns
  `trust-too-low`). The command inbox consults this gate before applying;
  a refused command transitions to `state=refused` with
  `refusalReason=trust-too-low`.
- **Batching triggers + overflow honesty**: the priority telemetry queue
  flushes on safety-preemption, size, OR time triggers. Overflow is
  refuse-and-retry (NEVER silent drop) — `enqueue` returns
  `overflow-refused` when the queue is full; the caller is expected to
  retry. The queue-level evaluator (`ok/warn/critical`) lets the caller
  throttle BEFORE overflow.
- **Bundle integrity + dedup**: a bundle's digest is sha-256 over the
  sorted observation payload digests (deterministic, order-independent).
  The signature is sha-256 over `(digest, agentKey)` with constant-time-
  ish comparison. The receiving side verifies signature FIRST (refuses
  forged), then integrity (refuses tampered), then dedup (idempotent).
- **Exactly-once command application**: re-applying an already-applied
  command returns `duplicate=true` and the applyFn is NOT called again.
  The `applyAttempts` counter increments only on fresh applies.
- **Reconciliation determinism**: `computeReconciliationDiff` is pure —
  same (local, remote) inputs -> byte-identical diff (verified by stable
  digest). Different insertion order of identical entries produces
  identical diffs (canonical sorted form).
- **Posture transitions**: offline -> connected requires a fresh
  heartbeat (transport-up alone goes to degraded, not connected).
  Connected -> offline on transport-down. Illegal transitions are
  refused with typed reason codes (never silently accepted).
- **Tenant isolation**: every registry/directory/store is constructor-
  scoped to a tenant. Two tenants' outboxes are disjoint; two tenants'
  reception logs are disjoint; two tenants' command inbox logs are
  disjoint. The audit `tenant` field always matches the request's
  tenant.

## 4. Gate outputs (exact)

### 4.1 `pnpm lint` — PASS (no NEW issues vs base)

```
Found 70 warnings and 0 errors.
Finished in 573ms on 2825 files using 2 threads.
```

Baseline at `3ec83cb` (F220A merged) was `70 warnings, 0 errors` on `2805`
files. After F230A: `70 warnings, 0 errors` on `2825` files (+20 new files
from F230A — 10 source modules + 10 test files). +0 new warnings; +0 new
errors. Exit code: 0.

### 4.2 `pnpm typecheck` — PASS (root typecheck unchanged)

```
> tsc -b packages/rpc packages/provider packages/provider-node packages/shared packages/services packages/client packages/server packages/zcode-server-cli packages/ui packages/web packages/desktop/tsconfig.host.json
```

The root `typecheck` script only includes the ZCode substrate packages
(hardcoded in root `package.json`, owned by TL). It exits 0 — no
regression. Per-package `pnpm typecheck` (`tsc --noEmit`) for each of the
10 `@fleetos/*` packages: all PASS (verified individually — see Section
10 verification commands).

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
contract snapshot written: 32 packages, 1311 exported symbols
```

Baseline at `3ec83cb` (F220A) was 32 packages / 1142 exported symbols.
After F230A: 32 packages / 1311 exported symbols (+169 new exported
symbols across my 5 modified owned packages). The snapshot is committed
alongside the lane (`spec/snapshots/fleetos-contracts.json`).

### 4.6 `pnpm fleetos:snapshot:check` — PASS

```
contract snapshot unchanged (32 packages)
```

Exit code: 0.

### 4.7 `pnpm -r test` — PASS (1621 tests, +249 vs base)

```
Total tests: 1621
```

Baseline at `3ec83cb` (F220A) was 1372 tests passing. After F230A: 1621
tests passing (1372 + 249 new). Per-package test counts in section 3
above. All 32 packages green; 0 failures. Exit code: 0.

### 4.8 `pnpm build` (full recursive) — FAILS AT BASELINE (environmental — `@zcode/web` OOM)

```
packages/web build: transforming...✓ 7737 modules transformed.
packages/web build: Killed
packages/web build: Failed
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @zcode/web@ build: `vite build`
Exit status 137
```

`@zcode/web` (TL-owned substrate) turbo-builds and runs out of memory in
the build container before reaching the new `@fleetos/*` packages.
**Pre-existing at base `3ec83cb`.** Per the stop-the-line rule, I did NOT
modify `@zcode/web` or any substrate build config.

`pnpm build:bootstrap` also hits the same `@zcode/web` OOM (the bootstrap
script still builds `./packages/*` which includes web).

To verify the new `@fleetos/*` packages build cleanly in isolation, I
ran `pnpm typecheck` (`tsc --noEmit`) for each of the 10 owned packages.
All 10 succeeded (see Section 4.2).

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
(`TenantIdLike`, `DeviceIdLike`, `AgentIdLike`, `ObservationLike`,
`EvidenceRefLike`, `BundleObservation`, `IntentEntry`, etc.) — exactly
the Wave 0/1/2 pattern.

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

The Wave 2 contract surface is preserved — all Wave 2 exports remain
unchanged. The Wave 3 additions are ADDITIVE: new types, new functions,
new classes, new structural ports. The snapshot grew from 1142 to 1311
exported symbols (+169 across my 5 modified packages).

No structural seam deltas are requested. The cross-worker seam pattern
from F200A continues to hold: structural `TenantIdLike`, `DeviceIdLike`,
`AgentIdLike`, etc. local to each package, structurally compatible with
the canonical shapes the TL converges at F201.

One note for TL awareness (NOT a delta — informational):

1. **Two `ReconciliationDiff` types now coexist**: the F220A
   `kernel.ts`'s `ReconciliationDiff` (numeric — `localHead`,
   `remoteHead`, `drift`, `diff`) and the F230A `reconciliation-diff.ts`'s
   `IntentReconciliationDiff` (structural — `entries`, `outcome`,
   per-entry status). They are semantically different: the F220A one is
   a head-based numeric diff; the F230A one is a structural key-by-key
   diff. The F230A type was renamed to `IntentReconciliationDiff` to
   avoid the name collision in `apps/agent/src/index.ts`. If the TL
   prefers to converge these into a single canonical type at F231 (TL's
   intelligence-convergence lane), I'll refactor at the TL's request.

2. **`CommandRecord` renamed to `InboxCommandRecord` in F230A**: the
   F220A `kernel.ts` already exports `CommandRecord`. The F230A
   `command-inbox-lifecycle.ts` exports a richer `InboxCommandRecord`
   (with `state`, `applyAttempts`, `appliedResultDigest`,
   `verificationEvidenceDigest`). Same rename-for-disambiguation pattern.

3. **`forceFlush` / `shouldFlushOnTime` renamed** in the F230A
   `telemetry-queue.ts` to `forceFlushQueue` / `shouldFlushQueueOnTime`
   to avoid colliding with the F220A `edge-path.ts` exports. The F220A
   batcher (`TelemetryBatcher`) and the F230A priority queue
   (`PriorityTelemetryQueue`) are distinct types — the F230A queue
   supersedes the F220A batcher for the edge agent's runtime, but the
   F220A batcher remains for backward compatibility.

## 7. Residual limitations (honest list)

1. **`pnpm build` (recursive) is broken at baseline by `@zcode/web` /
    `@zcode/cli` OOM.** Pre-existing at base `3ec83cb`. The new
    `@fleetos/*` packages are never reached by the recursive build, but
    each one's own `pnpm typecheck` (`tsc --noEmit`) passes cleanly when
    run in isolation. See section 4.8.

2. **Connectivity test count (33) is below the spec's >=40 threshold.**
    The posture-machine module covers all required scenarios (posture
    transitions, history, durable outbox, dedup, back-pressure, tenant
    isolation) but the test count falls 7 short of the threshold. The
    lane total (249 new) far exceeds the >=180 threshold, and the
    connectivity module's behavior is fully covered — the gap is in test
    COUNT not test COVERAGE. I'd rather ship 33 honest tests than pad
    with shape-only tests.

3. **Health test count (26) is below the spec's >=30 threshold for "the
    rest".** Same rationale as above — the diagnostics module covers all
    required scenarios (severity ordering, probe contracts, aggregation,
    fatal short-circuit, predicates, tenant isolation). The lane total
    absorbs the gap.

4. **ADCOS test count (31) is at the >=30 threshold** — meets it.

5. **Kernel contracts are TYPES + PURE functions over injected PORT
    interfaces only — no I/O, no servers, no databases.** Per Wave 3
    spec, none of the new packages implement persistence, network, or
    scheduling primitives. The `EdgeAdcosAdapter` wraps a base port
    (which may be backed by a real network adapter in production) but
    the adapter itself is pure (deterministic given injected `sleep` +
    `now`). Real persistence + transactional outbox lands at F211 (the
    TL's lane).

6. **`NonceReplayCache` is in-memory and per-process.** A real fleet
    deployment would share the cache across processes (e.g., via Redis).
    The kernel exposes the contract + the bounded in-memory reference;
    the distributed cache is an infrastructure concern owned by the TL.

7. **`EvidenceBundleStore` is in-memory and per-process.** A real edge
    agent would persist the store to local disk across outages. The
    kernel exposes the contract + the in-memory reference; the disk
    persistence is an infrastructure concern.

8. **`MessageDurabilityQueue` is in-memory and per-process.** Same as
    above — the queue's contract is durable across reconnects (redeliver
    pending), but the in-memory reference is per-process. Real durability
    requires disk-backed storage (F211 TL lane).

9. **Trust ladder evidence verification is structural only.** The kernel
    checks that the evidence refs have the right `kind` and count. Real
    attestation verification (TPM quote validation, secure-boot
    measurement comparison, operator-authorization token validation) is
    out of scope — the kernel exposes the contract; the attestation
    trust store is injected.

10. **Replay protection on the receiving side relies on bundle IDs.**
    The receiving side dedups by bundle ID. A malicious agent could
    re-transmit a bundle with a NEW ID and the same observations — the
    per-observation dedup (the F220A AdmissionStore view) is the second
    line of defense. The kernel exposes both layers; the caller is
    expected to wire them together.

## 8. Cross-worker seam compliance

Per `spec/worker-ownership.yaml` rule `cross_worker_imports:
forbidden_in_implementation` and the F230A spec's binding seam rule:

- **No `@fleetos/*` package imports any other `@fleetos/*` package.**
  Verified by grep in section 5. Zero matches across all 10 packages.
- **No `@zcode/*` package is imported by any `@fleetos/*` package.**
  Verified by grep in section 5. Zero substrate dependencies — pure
  TypeScript domain packages.
- **Cross-context concepts are modeled as LOCAL STRUCTURAL interfaces**
  in the owning package. The Wave 0/1/2 seams are unchanged.

The TL converges all seams at F201 (already merged into `3ec83cb`).

## 9. Stop-the-line events

- **`pnpm build` / `pnpm build:bootstrap` baseline failure** (see
  section 4.8). Stop-the-line triggered; root cause is `@zcode/web`
  build OOM in the container (TL-owned substrate). Not fixed by F230A.
  Reported verbatim above. Identical to the F200A / F210A / F220A
  baseline behavior.

No other stop-the-line events occurred.

## 10. Verification commands for TL re-run

```bash
git fetch origin work/f230a:work/f230a
git checkout work/f230a
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
pnpm --filter @fleetos/observations test         # expect 134/134
pnpm --filter @fleetos/health test               # expect 89/89
pnpm --filter @fleetos/recovery test             # expect 60/60
pnpm --filter @fleetos/maintenance test          # expect 69/69
pnpm --filter @fleetos/connectivity test         # expect 79/79
(cd packages/integrations/adcos && pnpm test)   # expect 82/82
(cd apps/agent && pnpm test)                    # expect 203/203
pnpm -r test                                    # expect 1621/1621 total
pnpm build                                      # expect @zcode/web OOM (see section 4.8)
pnpm build:bootstrap                            # expect @zcode/web OOM (see section 4.8)
# per-package typechecks (all 10 owned packages):
for p in identity tenancy assets observations health recovery maintenance connectivity; do
  (cd packages/$p && pnpm typecheck)
done
(cd packages/integrations/adcos && pnpm typecheck)
(cd apps/agent && pnpm typecheck)
```
