# F221 — Control-plane command bus + durable mission runtime (Wave 2 TL lane) — Completion Evidence

- **Work item:** F221 — Control Plane command bus + Mission runtime (Wave 2 TL lane)
- **Owner:** TL lane (executed by a TL-dispatched worker agent under the TL grant)
- **Base commit:** `2407ea1` (branch `work/f221` created from it; single comprehensive commit on top)
- **Branch:** `work/f221`
- **Date:** 2026-10-07
- **Execution note:** This is a CONTINUATION. The initial worker (Task ID `4-c`) left the
  packages uncommitted and partially complete; the continuation agent (Task ID `4-c2`)
  finished them. See section 3 for the exact found-vs-finished split.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (TL grant for F221):

- `packages/control-plane/**` (NEW package — did not exist at dispatch)
- `packages/mission/**` (NEW package — did not exist at dispatch)
- `docs/evidence/F221/**` (this report)

No file outside the above paths was modified. `pnpm-lock.yaml` gained 26 lines
(workspace linking for the two new packages) and is deliberately left **dirty and
uncommitted** per the packet's instructions — the TL runs `pnpm install` at
merge/adjudication time.

Package inventory:

- **control-plane** (10 src modules + 6 test files):
  `src/queue.ts`, `src/retry.ts`, `src/ledger.ts`, `src/sla.ts`,
  `src/assignment.ts`, `src/transport.ts`, `src/ids.ts`, `src/digest.ts`,
  `src/result.ts`, `src/index.ts`; tests: `queue`, `retry`, `ledger`, `sla`,
  `assignment`, `transport` (+ `helpers`).
- **mission** (8 src modules + 4 test files):
  `src/definition.ts`, `src/journal.ts`, `src/runtime.ts`, `src/outbox.ts`,
  `src/ids.ts`, `src/digest.ts`, `src/result.ts`, `src/index.ts`; tests:
  `definition`, `journal`, `outbox`, `runtime` (+ `helpers`).

Both packages: private, Apache-2.0, `type: module`, sibling-style exports maps,
`dependencies: { "@fleetos/kernel": "workspace:*" }`, devDependencies TypeScript
+ vitest only. No new runtime dependencies.

## 2. What was built

### 2.1 `packages/control-plane` — the tenant-scoped command bus

- **Command envelope contracts** (`queue.ts`): `CommandId` (branded,
  `cmd_<10+ chars>`), `CommandEnvelope` (tenant scope, kind, payload,
  idempotency key, issuedAt as `number`, actor, submittedAt/availableAt,
  sha256 audit digest over the submit boundary), `CommandAck` (with
  `duplicate` marker), `CommandOutcome` (completed/dead-lettered + reason
  codes), `CommandSubmitRejection` vocabulary.
- **Command queue** (`queue.ts`): submit (idempotency-key dedupe — a duplicate
  submit returns the ORIGINAL ack and never double-executes; ids are
  per-tenant monotonic `cmd_0000000001`-style) → ack/claim (idempotent,
  attempts increment ONCE per claim) → complete (idempotent) / fail.
  **Drain semantics**: `due()` is a pure read of everything currently due at a
  logical `now` (queued-with-arrived-availability + retry-scheduled-with-open-
  retry-window, submission order); `drain()` claims everything due in one pass —
  a second drain at the same `now` returns an empty array.
- **Retry policy as a pure deterministic function** (`retry.ts`):
  `attemptDelayMs(policy, failedAttempt)` — integer basis-point math
  (`backoffBps`: 10000 = 1.0x, 15000 = 1.5x), overflow-safe multiplication,
  `maxDelayMs` cap, `null` when the policy is exhausted (the caller MUST
  dead-letter). `attemptSchedule` computes the exact cumulative attempt times.
  `validateRetryPolicy` with stable rejection codes.
- **Dead-letter**: after the maxAttempts-th failure the command transitions to
  `dead-lettered` with reason `max-attempts-exceeded`; dead-lettered commands
  are excluded from `due()` forever.
- **Execution ledger** (`ledger.ts`): append-only, per-tenant, hash-CHAINED
  entries (each digest covers its predecessor's digest) with kinds
  submitted/duplicate-suppressed/acknowledged/attempt-failed/retry-scheduled/
  completed/dead-lettered/transport-timeout; entries frozen on append;
  `verifyChain` detects tamper/removal/reorder; tenant chains independent.
- **SLA/deadline tracker** (`sla.ts`): register a deadline (command + dueAt);
  the severity ladder is a PURE function of (dueAt, config) — level k breaches
  at `dueAt + (k-1) * windowMs` with the fixed mapping warning → critical →
  escalation → executive; evaluation at a logical `now` is idempotent
  (re-evaluation records nothing new); one live deadline per (tenant, command);
  cross-tenant access fails closed.
- **Assignment + handoff records** (`assignment.ts`): assignment lifecycle
  offered → accepted | declined | revoked (one ACTIVE assignment per command);
  handoff initiated → acknowledged (assignment REBINDS to the receiving agent)
  | expired (deadline-gated); every transition idempotent where meaningful;
  full rejection-code vocabulary; tenant fail-closed.
- **Reference transport** (`transport.ts`): `InMemoryCommandTransport` models
  ack/timeout paths — dispatch = submit (dedupe) + ledger entry
  (submitted/duplicate-suppressed) + outbox-shaped event through
  `TransportEventSink` (at-least-once with idempotency-key dedupe);
  deterministic fault injection via `timeoutKeys` (claim + fail with reason
  `transport-ack-timeout` → deterministic retry schedule or dead-letter).
- **Composition seam**: `queueAsSubmitPort(queue)` adapts the queue to the
  mission package's `CommandSubmitPort` structural contract — compile-pinned
  in `queue.test.ts` ("satisfies the mission CommandSubmitPort structural
  mirror").

### 2.2 `packages/mission` — the durable mission runtime

- **Mission definition validation** (`definition.ts`): stages (ordered,
  optional parallel groups forming contiguous blocks), per-stage guards
  (capability/predicate refs), explicit `dependsOn`; validation is pure with
  stable rejection codes (no-stages, invalid/duplicate stage ids, invalid/
  unknown guards, unknown/self dependencies, intra-parallel-group
  dependencies, cycle detection over the COMBINED graph of explicit edges +
  block-sequence edges). `isStageReady` = deps completed + previous block
  fully completed + not started.
- **Event-sourced journal** (`journal.ts`): append-only entries
  (mission-created/started, stage-started, checkpoint-recorded,
  stage-completed/failed, mission-suspended/resumed/completed/failed/
  cancelled, work-order-issued, guard-rejected), each sha256 digest CHAINED
  to its predecessor (per-mission genesis). **The mission state is a pure
  FOLD over the journal** — `foldMission` is mechanical and total; replaying
  the journal reproduces the state exactly (machine-tested at 200 entries and
  through the runtime path). `MissionJournal.replay` verifies the whole chain
  (digests + seqs + tenant + mission identity) before appending VERBATIM into
  a fresh store — tampered/gapped chains are refused with `chain-invalid`.
- **Instance state machine** (`runtime.ts`): `pending → running → suspended →
  completed | failed | cancelled` (+ per-stage pending/running/completed/
  failed/cancelled). Legal-transition enforcement with stable rejection codes
  (illegal-transition, not-suspended, unknown-stage, stage-not-running,
  mission-not-found, mission-exists, invalid-input, invalid-definition,
  command-submit-rejected, outbox-rejected, commit-failed) and idempotent
  re-application of every legal transition (duplicate markers).
- **Resume-from-checkpoint**: a suspended mission resumes from the last
  recorded checkpoint; completed stages are NEVER re-executed and their work
  orders are NEVER re-issued; only in-flight (running) stages get their work
  order re-submitted with the SAME deterministic idempotency key
  (`wo:{missionId}:{stageId}`) — the port dedupes, so nothing executes twice.
- **Work-order issuance via the TYPE seam**: a stage's execution intent is
  emitted as a command envelope (kind `work-order`) through
  `CommandSubmitPort` — a structural TYPE defined in mission, satisfied by the
  control-plane queue through the TL's composition. **Mission never imports
  control-plane at runtime** (verified in section 5).
- **Outbox seam** (`outbox.ts`): mission state changes emit outbox events
  through the kernel's `OutboxPort` TYPE. The in-memory reference adapter
  (`InMemoryMissionOutbox`) + `MissionTransactionSession` (implements the
  kernel's `TransactionalSession` TYPE with real staged writes, rollback, and
  savepoints) are mission-owned and structurally pinned via `implements`.
  **Dual-write law (A14)**: journal entries and outbox events are staged in
  the SAME session and become durable at the SAME commit — a rejected
  operation leaves NO journal entry and NO outbox event (machine-tested).
- **Determinism laws**: every function pure; `now` always an explicit input;
  no `Date.now`, no `Math.random`, no timers, no network (verified in
  section 5).

## 3. Found (partial) vs finished (continuation)

The initial agent (Task ID `4-c`) left uncommitted work:

- **Found near-complete:** control-plane src (all 10 modules) + all 6 test
  files — 119 tests green, typecheck clean at hand-off; mission src (all 8
  modules) + tests for definition/journal/outbox (53 passing, 1 failing).
- **Found broken:** `foldMission`'s `mission-cancelled` case cancelled BOTH
  pending and running stages, while its own test expected untouched stages to
  stay pending (the failing test).
- **Found missing:** the entire mission runtime test suite; one typecheck
  error in `journal.test.ts` (`noUncheckedIndexedAccess` on a hand-built
  sparse array).

Finished by the continuation (Task ID `4-c2`):

1. Resolved the fold ambiguity in favor of the test's stated intent: on
   `mission-cancelled` only IN-FLIGHT (running) stages fold to `cancelled`;
   never-started stages stay `pending` (the fold distinguishes "aborted
   mid-flight" from "never began"). Strengthened the test so the title's
   "in-flight stages cancelled" claim is actually exercised.
2. Wrote `packages/mission/tests/runtime.test.ts` — 64 tests: the full
   legal-transition matrix (6 states × 4 operations, every rejection code),
   work-order issuance through the CommandSubmitPort seam, the atomic
   boundary (rejected submit → no journal/outbox residue), suspend/resume
   from checkpoint, the 50-cycle resume storm, journal-replay == folded state
   through the runtime path, guard rejection semantics, tenant fail-closed,
   and cross-stack digest determinism.
3. Fixed the `journal.test.ts` typecheck error (sparse array → `.filter`).
4. Normalized `GUARDED_DEF` guard refs to bare refs (`ingest:run`,
   `data-ready`) so `guardKey` composition (`kind:ref`) is unambiguous — the
   refs were previously kind-prefixed, producing doubled prefixes.
5. This evidence report; the commit; the push.

## 4. Gates (exact outputs)

### 4.1 control-plane — `corepack pnpm run test` — PASS

```text
 ✓ tests/queue.test.ts (34 tests)
 ✓ tests/assignment.test.ts (27 tests)
 ✓ tests/sla.test.ts (20 tests)
 ✓ tests/transport.test.ts (9 tests)
 ✓ tests/ledger.test.ts (11 tests)
 ✓ tests/retry.test.ts (18 tests)

 Test Files  6 passed (6)
      Tests  119 passed (119)
```

### 4.2 control-plane — `corepack pnpm run typecheck` — CLEAN

```text
> @fleetos/control-plane@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no diagnostics)
```

### 4.3 mission — `corepack pnpm run test` — PASS

```text
 ✓ tests/runtime.test.ts (64 tests)
 ✓ tests/outbox.test.ts (22 tests)
 ✓ tests/journal.test.ts (16 tests)
 ✓ tests/definition.test.ts (16 tests)

 Test Files  4 passed (4)
      Tests  118 passed (118)
```

### 4.4 mission — `corepack pnpm run typecheck` — CLEAN

```text
> @fleetos/mission@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no diagnostics)
```

### 4.5 Test totals

| package        | tests | target |
| -------------- | ----- | ------ |
| control-plane  | 119   | ≥ 60 ✓ |
| mission        | 118   | ≥ 60 ✓ |
| **lane total** | **237** | ≥ 120 ✓ |

### 4.6 Must-include coverage (packet checklist)

- **duplicate-submit idempotency** — control-plane: "double-submit returns the
  ORIGINAL ack with duplicate=true"; "THE DUPLICATE-SUBMIT STORM — 100
  identical submits → exactly ONE command"; mission: the resume re-submission
  dedupe + "THE RESUME STORM — 50 suspend/resume cycles → ONE distinct
  command per stage".
- **deterministic retry schedule** — exact integer bps ladders (1.0x/1.5x/
  2.0x/0.5x series, cap behavior, overflow safety, cumulative attempt times,
  byte-identical schedules); queue failures schedule `now + delay(failures)`
  EXACTLY (1000/1500/2250 ladder under the default policy).
- **dead-letter path** — queue: dead-letter after maxAttempts with reason
  `max-attempts-exceeded`; transport: `maxAttempts=1` dead-letters the
  timed-out dispatch immediately; mission outbox: exhausting the policy moves
  the event to DEAD_LETTER and excludes it from `pending()`.
- **journal-replay == folded state** — the 200-ENTRY deterministic journal
  replay (digests + seqs preserved verbatim, fold identical); plus the
  runtime-path replay test (full lifecycle journal → fresh store → folded
  view equals the live view).
- **suspend/resume from checkpoint** — "THE RESUME TEST": resumes from the
  last recorded checkpoint (the mission-resumed journal entry carries it);
  re-issues ONLY the in-flight stage with the SAME idempotency key; completed
  stages never re-issued.
- **tenant fail-closed** — control-plane: queue/ledger/SLA/assignment all
  fail closed cross-tenant (`command-not-found` / `deadline-not-found` /
  `assignment-not-found`, no existence leak); mission: every runtime
  operation + outbox drain fail closed cross-tenant
  (`mission-not-found`); same mission id under two tenants are fully
  independent missions.

Root-level gates were NOT run (packet instruction — memory-constrained box;
the TL runs them at merge time). No snapshot regeneration, no spec edits.

## 5. Boundary verification (machine-tested)

```text
$ grep -rEn "import .* from ['\"]@fleetos/" packages/control-plane/src packages/mission/src | grep -v "@fleetos/kernel" || echo CLEAN
CLEAN
```

Only `@fleetos/kernel` imports exist, and every one of them is
`import type` (verified: the only non-`import type` grep hit is the closing
line of a multi-line `import type { … } from "@fleetos/kernel"` statement in
`mission/src/outbox.ts`).

- **mission does NOT import control-plane** — no `@fleetos/control-plane`
  import anywhere in mission src or tests; control-plane is referenced only
  in comments documenting the TYPE seam. The work-order issuance contract is
  the `CommandSubmitPort` structural interface; the TL composes the concrete
  queue behind it (`queueAsSubmitPort`).
- **No worker-lane package imports** — zero `@fleetos/security`,
  `@fleetos/policy`, … references.
- **Test files** also import only `import type` from `@fleetos/kernel`.
- **Determinism laws** — `grep -rEn "Date\.now|Math\.random|setInterval|
  setTimeout|new Date\(|fetch\(|…"` over both packages' src matches only
  doc-comment text (the laws themselves); zero actual usages. All `now`
  values are explicit inputs; all schedules are integer math.
- **No stubs/TODOs** — `grep -rEn "TODO|FIXME|XXX|stub|not implemented"`
  over both src trees: no matches.

## 6. Contract deltas / seams for TL adjudication

1. **`CommandSubmitPort` TYPE seam (mission) ↔ `queueAsSubmitPort` adapter
   (control-plane).** Mission defines the port structurally; control-plane
   provides the adapter and compile-pins it in its own test suite against a
   structural mirror of the mission port. Composition site for the TL:
   `new MissionRuntime({ store, outbox, commandSubmit: queueAsSubmitPort(queue) })`.
   Note: the adapter derives the queue's submit-time from
   `command.issuedAt` (the port contract carries no `now`); if the TL wants
   submission wall-time to differ from issuance intent time, extend the port
   with an explicit `now` field.
2. **Kernel TYPE pins in mission.** `MissionTransactionSession implements
   TransactionalSession` and `InMemoryMissionOutbox implements OutboxPort`
   (kernel types). Both are swappable with the kernel's own driver or a
   future Postgres driver at composition time without touching mission code.
   The mission store's session `commit()` stamps `committedAt = openedAt + 1`
   (deterministic, since the session has no clock) — a cosmetic contract
   wrinkle the TL may want to align with the kernel driver.
3. **Local `Result` + `digestOf` duplicates.** Both packages define local
   `Result<T,E>`/`digestOf` semantically identical to the kernel's (the F221
   grant permits kernel TYPE imports only, and these are value exports).
   Same pattern as the F200A/F220A structural-seam convention; the TL may
   converge them into shared contracts later.
4. **`TransportEventSink`** (control-plane) is shaped after the kernel
   `OutboxEvent` record (type/payload/idempotencyKey/occurredAt/
   causationId) — the seam the TL binds to the kernel's real `OutboxPort` at
   composition time.
5. **Mission stage-cancelled fold semantics (decided by this agent).** On
   `mission-cancelled`, only in-flight (running) stages fold to `cancelled`;
   never-started stages remain `pending` (distinguishing "aborted" from
   "never began"). This resolved a title-vs-implementation inconsistency in
   the partial work. If the TL prefers cancelling all non-completed stages,
   it is a one-line fold change plus two test expectations.
6. **`createMission` idempotency stance.** A create with an existing mission
   id is fail-closed `mission-exists` (not idempotent-return-existing). The
   idempotency burden sits at the command-bus layer (the envelope's
   idempotency key). Flagging for adjudication in case the TL wants
   create-level idempotency.

## 7. Residual limitations (honest list)

1. **`pnpm-lock.yaml` is dirty and uncommitted** (26 added lines linking the
   two new workspace packages) — deliberate, per the packet. The TL must run
   `pnpm install` when verifying/merging.
2. **Reference implementations only.** The command queue, ledger, SLA
   tracker, assignment registry, transport, mission store, journal, and
   outbox are deterministic in-memory references. Real Postgres-backed
   persistence, network transports, and schedulers are later deployment
   work items (the kernel's driver seam is the swap point).
3. **No drain-loop / scheduler.** Drain is a pure function of a logical
   `now` supplied by the caller; there is no background worker (correct for
   a deterministic kernel — the application layer owns the clock).
4. **`outbox-rejected` / `commit-failed` mission rejection codes are
   defensive branches** not exercised by tests — they are unreachable
   through the reference driver without additional fault injection beyond
   the `failKeys` port scripting (which covers `command-submit-rejected`).
5. **Guard-rejected stages stay pending until another issuance event** (a
   stage completing elsewhere, or a resume of an in-flight stage). There is
   no public "re-poke pending stages" operation yet — a small future
   addition if the TL wants operator-driven re-issuance.
6. **`createMission` does not validate a caller-supplied `missionId` format**
   (ids are branded without pattern checks and used as tenant-scoped store
   keys). No isolation impact (keys are tenant-scoped), but a format gate
   would be stricter.
7. **`InMemoryMissionOutbox.publish` returns a staged snapshot with
   `recordedAt: -1`** — the durable record's `recordedAt` is set at commit.
   Cosmetic contract wrinkle flagged in section 6.2.
8. **Root-level gates not run** (lint, architecture:check, snapshot,
   source-of-truth, full `pnpm -r test`) — packet instruction; TL's at merge
   time. Build artifacts (`dist/tsconfig.tsbuildinfo`, vitest cache) exist in
   the worktree but are gitignored and excluded from the commit.

## 8. Stop-the-line events

None. Both packages' gates green; no baseline regressions encountered; no
processes killed; the port-3000 dev server was left untouched; no daemons
started.

## 9. Verification commands for TL re-run

```bash
git fetch origin work/f221:work/f221
git checkout work/f221
pnpm install                                     # regenerates lockfile; allowed
(cd packages/control-plane && pnpm test)         # expect 119/119
(cd packages/control-plane && pnpm typecheck)    # expect exit 0
(cd packages/mission && pnpm test)               # expect 118/118
(cd packages/mission && pnpm typecheck)          # expect exit 0
# boundary self-check:
grep -rEn "import .* from ['\"]@fleetos/" packages/control-plane/src packages/mission/src \
  | grep -v "@fleetos/kernel" || echo CLEAN      # expect CLEAN
# determinism self-check:
grep -rEn "Date\.now|Math\.random|setInterval|setTimeout" \
  packages/control-plane/src packages/mission/src # expect doc-comment text only
```
