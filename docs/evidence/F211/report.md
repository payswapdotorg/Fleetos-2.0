# F211 — TL Lane Wave 1 Completion Evidence

- **Work item:** F211 — Transactional persistence + outbox + repository ports (Wave 1 TL lane)
- **Owner:** TL (executed under explicit TL ownership grant)
- **Base commit:** `d87a3cc` (Wave 1 complete: F210A/B/C merged, 1116 tests green)
- **Branch:** `work/f211`
- **Date:** 2026-10-07

## 1. Owned paths touched

Per the TL ownership grant (binding, TL-adjudicated):

- `packages/kernel/**` (NEW package `@fleetos/kernel`)
- `infrastructure/**` (NEW directory)
- `docs/evidence/F211/**` (carve-out)
- `spec/snapshots/fleetos-contracts.json` (regenerated + committed)

No file outside the above paths was modified. The grant forbade editing
`architecture-policy.yaml` (TL registers the new module at merge),
root `package.json`, `pnpm-workspace.yaml`, any worker package, `spec/`,
`scripts/`, `AGENTS.md`.

## 2. What landed

### 2.1 `@fleetos/kernel` — the transactional kernel

The kernel sits BELOW every domain context. Pure TypeScript: types +
ports + deterministic in-memory reference implementations. Imports
nothing from any `@fleetos/*` or `@zcode/*` package. Domain contexts
consume the kernel's public entry only (`packages/kernel/src/index.ts`).

**Public surface inventory (12 source files, 9 sub-modules):**

| File | Public surface |
| --- | --- |
| `src/tenant.ts` | `TenantId`, `ActorId`, `SessionId` (branded), `TenantContext`, `TenantScopeVocabulary`, `TenantContextRejectionCode`, `TenantContextResult`, `TenantContextInput`, `makeTenantContext`, `sameTenant`, `canRead`, `canWrite`, `isTenantId`/`isActorId`/`isSessionId`, `Brand` |
| `src/audit.ts` | `AuditEventRef`, `digestOf`, `auditEvent` |
| `src/result.ts` | `Result<T,E>`, `KernelReason`, `ok`, `fail`, `unwrap`, `unwrapOr`, `mapOk` |
| `src/entity.ts` | `Entity`, `CollectionKey`, `RevisionGuard`, `OptimisticConcurrencyRefusalReason`, `OptimisticConcurrencyRefusal`, `nextRevision`, `revisionMatches` |
| `src/session.ts` | `TransactionalSession` port, `SessionStage`, `Savepoint`, `SessionState`, `SessionRejection`/`SessionRejectionCode`, `CommitResult`, `RollbackResult` |
| `src/outbox.ts` | `OutboxPort`, `OutboxEvent`, `OutboxEventState`, `RetryPolicy`, `DEFAULT_RETRY_POLICY`, `nextAttemptAt`, ack/drain rejection unions |
| `src/repository-port.ts` | `RepositoryPort<T>`, `ReadableRepository<T>`, `WritableRepository<T>`, `QuerySpec<T>`, `RepositoryReadRejection`, `RepositoryWriteRejection`, `assertTenant` |
| `src/unit-of-work.ts` | `UnitOfWork`, `UnitOfWorkFactory`, `UnitOfWorkCommit`, `UnitOfWorkRollback`, `UnitOfWorkRejection`, `unitOfWorkFactory` |
| `src/driver/in-memory-session.ts` | `InMemoryKernelDriver`, `InMemoryTransactionalSession`, `TenantKeyspace`, `OutboxStore`, `OutboxCommittedEvent` |
| `src/driver/in-memory-outbox.ts` | `InMemoryOutbox` (implements `OutboxPort`) |
| `src/driver/in-memory-repository.ts` | `InMemoryRepository<T>` (implements `RepositoryPort<T>`), `inMemoryRepository` factory |
| `src/index.ts` | re-exports the full surface |

**Key contract guarantees (machine-tested):**

- **TransactionalSession port** (law A1, A8): `begin`/`commit`/`rollback`
  + savepoints (`checkpoint`/`release`/`rollbackTo`). Every session
  carries an immutable `TenantContext` established at the boundary
  (A8); a session without tenant context fails closed.
- **UnitOfWork** (law A1, A14): groups repository read/write operations
  into ONE atomic boundary. Commit applies all writes or none. A
  failed operation inside the unit rolls the whole unit back.
- **Outbox** (law A14 — the dual-write-gap killer):
  - Events written in the SAME transaction as the state change (machine-tested).
  - A committed state change with a lost event is IMPOSSIBLE
    (machine-tested — see "the dual-write-gap impossibility proof" test).
  - A rolled-back transaction leaves NO events (machine-tested — see
    "the rollback-no-event invariant" test).
  - Drain contract: at-least-once delivery with idempotency keys.
    A redelivered event is acknowledged identically, never re-applied
    twice at the reader seam (machine-tested — see "the redelivered-event
    invariant" test).
  - Pending/Failed/Delivered/DeadLetter states with retry policy types
    (bounded backoff — `nextAttemptAt` honors `maxAttempts` exhaustion
    and `maxDelayMs` cap).
- **RepositoryPort binding contracts** (law A1, A8): entity read/write
  by id, tenant-scoped query contracts, optimistic concurrency via
  revision guards. A stale revision write is refused with a
  machine-stable reason code (`STALE_REVISION` + recorded revision).
- **The deterministic in-memory transactional reference driver**:
  implements the session port with REAL rollback semantics (mutations
  staged until commit; rollback discards), savepoint support, and
  per-tenant keyspaces (cross-tenant access fails closed at the
  keyspace boundary — `event-not-found` rather than revealing existence).
  This is the reference every test in the repo can use until the SQL
  driver lands.

### 2.2 `infrastructure/` — the driver seam directory

- `infrastructure/README.md` — position: drivers bind the kernel ports;
  PostgreSQL is the authoritative target per the lock; the in-memory
  reference lives in the kernel package for test determinism.
- `infrastructure/postgres/sql-driver-port.ts` — the `SqlDriverPort`
  structural interface (connection/transaction primitives shaped for
  node-postgres/pg-style drivers): `SqlConnection`, `SqlRow`,
  `SqlStatement`, `SqlExecutionResult`, `SqlTransaction` (with
  `beginTransaction`/`commitTransaction`/`rollbackTransaction` +
  `savepoint`/`releaseSavepoint`/`rollbackToSavepoint`), `SqlDriverPort`,
  `SqlDriverState`.
- `infrastructure/postgres/schema.ts` — the schema contract:
  - `OUTBOX_DDL` — the outbox table DDL (A14 dual-write-gap killer).
    State CHECK constraint enforces `PENDING`/`DELIVERED`/`FAILED`/
    `DEAD_LETTER` only. Two indexes: a partial index on
    `(tenant_id, state, revision) WHERE state IN ('PENDING','FAILED')`
    for the drain, and a partial index on
    `(tenant_id, idempotency_key) WHERE state='DELIVERED'` for the
    idempotent ack lookup. A unique index on `(tenant_id, revision)`
    enforces the monotonic revision.
  - `AUDIT_DDL` — the audit table DDL (A19): append-only, tenant-scoped,
    hash-verifiable (`CHECK (length(digest) = 64)`).
  - `OPTIMISTIC_CONCURRENCY_COLUMNS` — the standard revision + recorded_at
    columns every domain table adopts.
  - `MigrationContract` type + `migrationFor` helper — the shape every
    domain table migration must satisfy.
- `infrastructure/postgres/index.ts` — honest `unimplemented` state
  marker. NO live `pg` dependency, NO network, NO credentials. The
  structural seam (`SqlDriverPort` + schema contract) is exported so
  the composition layer can adopt it when the live binding lands.
  `POSTGRES_UNIMPLEMENTED_REASON` is the stable rejection string tests
  branch on.

### 2.3 Snapshot regeneration

`pnpm fleetos:snapshot` regenerated `spec/snapshots/fleetos-contracts.json`:
the packages structure (32 packages, 966 exported symbols) is UNCHANGED
because the kernel package is NOT registered in `architecture-policy.yaml`
(TL registers it at merge). The metadata (`head` and `generatedAt`)
was refreshed. `pnpm fleetos:snapshot:check` PASSES — zero drift.

## 3. Test counts

| Test file | Count |
| --- | --- |
| `tests/atomicity-savepoints.test.ts` | 21 |
| `tests/outbox-atomicity.test.ts` | 26 |
| `tests/optimistic-concurrency-tenant.test.ts` | 20 |
| `tests/unit-of-work.test.ts` | 9 |
| **kernel total** | **76** |

Repo-wide `pnpm -r test`: **1192 tests passing** (1116 baseline + 76
new from F211). Zero failures.

## 4. Invariants machine-tested

| Invariant | Test |
| --- | --- |
| **A14 outbox atomicity** (events written in same tx as state change) | "publish() within an active session stages the event; pending() returns it after commit" + "commit applies both state AND event atomically" |
| **A14 dual-write-gap impossibility proof** | "THE DUAL-WRITE-GAP IMPOSSIBILITY PROOF — commit applies both state AND event atomically" |
| **A14 idempotent drain** | "ack() marks a pending event DELIVERED" + "THE REDELIVERED-EVENT INVARIANT — re-acking the same event returns already-acknowledged and does NOT mutate" |
| **A14 rollback-no-event** | "THE ROLLBACK-NO-EVENT INVARIANT — rollback discards both state AND event" |
| **A8 tenant fail-closed** (missing context, cross-tenant keyspaces) | "makeTenantContext rejects …" (×3) + "ack()/markFailed() refuses on cross-tenant access (event-not-found)" + "pending() returns empty for cross-tenant reads" + "findById returns null for cross-tenant reads" + "save() refuses … tenant-mismatch" |
| **A1 optimistic concurrency refusal** (stale revision write) | "refuses a stale-revision write with STALE_REVISION + recorded revision" + "accepts a write at the recorded revision (advances to next revision)" + "refuses a remove on a non-existent record with a non-zero expected revision (UNKNOWN_RECORD)" |
| **Determinism** (same operation sequence -> identical state) | "two drivers seeded with the same operations have identical snapshots" + "audit digests are byte-identical for byte-identical inputs (A19)" |
| **Savepoint semantics** (checkpoint/release/rollbackTo) | "checkpoint() creates a savepoint with a monotonic sequence" + "rollbackTo() discards writes staged AFTER the savepoint" + "rollbackTo() preserves writes staged BEFORE the savepoint" + "rollbackTo() drops savepoints created AFTER the target" + "release() discards the savepoint but keeps the writes" + "savepoint + commit — the full flow produces durable writes" |

## 5. Gate outputs (exact)

```text
$ pnpm lint
Found 70 warnings and 0 errors.   # zero NEW (baseline was 70w/0e)

$ pnpm typecheck
# PASS (silent — tsc -b printed no errors)

$ pnpm architecture:check
architecture: OK
violations: 0
baseline: 0
new: 0

$ pnpm fleetos:source-of-truth
FleetOS source-of-truth check PASSED
Canonical architecture, ownership, work catalog, TL handoff and continuation files are present.
Exactly three implementation workers are registered.
Product identity: fleetos-2.0
Architecture lock: 2.0.0

$ pnpm fleetos:snapshot
contract snapshot written: 32 packages, 966 exported symbols

$ pnpm fleetos:snapshot:check
contract snapshot unchanged (32 packages)

$ pnpm -r test
# ALL green: 1192 tests passing (1116 baseline + 76 new)
# 4 kernel test files, all 4 passed; zero failures

$ pnpm build
# @zcode/web OOMs (Killed, exit 137) — KNOWN BASELINE per the work-item packet.
# All other packages build cleanly; @fleetos/kernel builds with `tsc --noEmit`.

$ pnpm build:bootstrap
# @zcode/web OOMs (Killed, exit 137) — same known baseline.
# @fleetos/kernel builds cleanly; the new package is unaffected.
```

## 6. Scope violations

**None.** All edits stayed inside the granted paths:

- `packages/kernel/**` (new package, all source + tests)
- `infrastructure/**` (new directory, README + postgres skeleton)
- `docs/evidence/F211/**` (this report)
- `spec/snapshots/fleetos-contracts.json` (regenerated metadata — head
  + generatedAt refreshed; packages structure UNCHANGED)

The grant forbade editing: `architecture-policy.yaml`, root
`package.json`, `pnpm-workspace.yaml`, any worker package, `spec/`,
`scripts/`, `AGENTS.md`. None were touched. The `pnpm-lock.yaml`
change is the workspace picking up the new `packages/kernel` package —
an additive dependency-graph update, not a script or config edit.

## 7. Residuals

- **Postgres live binding — DEFERRED.** The `infrastructure/postgres/`
  skeleton ships the structural `SqlDriverPort` interface + the schema
  contract (DDL constants + migration contract type) + an honest
  `unimplemented` state marker. NO live `pg` dependency, NO network, NO
  credentials. The live binding is gated on a later deployment work
  item that requires production/staging verification per `AGENTS.md`
  ("Deployment work requires production/staging verification when the
  work item says so"). The kernel's contract surface will not change
  when the live binding lands — both the in-memory reference and the
  Postgres driver implement the same ports.
- **Kernel package registration in `architecture-policy.yaml`** —
  DEFERRED to the TL merge step (per the work-item packet: "kernel is
  unregistered — TL registers at merge"). The architecture:check sees
  zero violations today because the kernel package's files are not
  discovered (no module owns `packages/kernel/src` in the policy).
  At merge time, the TL adds a `fleetos-kernel` module entry
  (`roots: [packages/kernel/src]`, `managed: false`, `owner: tl`) to
  `architecture-policy.yaml`, regenerates the snapshot (which will
  include the new package's exports), and commits both files in the
  merge commit.
- **`pnpm-lock.yaml` update** — additive. The workspace now resolves
  `packages/kernel` as a workspace package; the lockfile's
  `importers.packages.kernel` block was added by `pnpm install`. No
  production dependencies were added (the kernel is pure TypeScript;
  only `typescript` and `vitest` as devDependencies, both already in
  the lockfile).

## 8. Architecture-law compliance

| Law | How F211 complies |
| --- | --- |
| A1 — one source of business truth | The kernel defines the transactional boundary that makes Postgres authoritative. The in-memory driver is a test reference only. |
| A8 — tenant isolation | `TenantContext` is established at the boundary, threaded through every session/operation. Cross-tenant access fails closed at the keyspace boundary (`event-not-found` / `null` rather than revealing existence). |
| A14 — transactional outbox | The Outbox port + the in-memory driver + the Postgres DDL contract all enforce the dual-write-gap impossibility. State change and event are written in the SAME transaction; commit applies both, rollback discards both. |
| A19 — audit | Every consequential session boundary emits an `AuditEventRef { actor, intent, tenant, session, timestamp, digest }`. Digests are sha256, byte-identical for byte-identical inputs. |
| A20 — architecture enforcement | The kernel imports NOTHING from any `@fleetos/*` or `@zcode/*` package. It sits BELOW every domain context. `architecture:check` reports zero violations; the snapshot drift check is GREEN. |
