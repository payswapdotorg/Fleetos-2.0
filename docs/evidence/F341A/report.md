# F341A — Wave-14 lane A: the three field remainder journeys

- **Work item:** F341A (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 14; the
  F340 §4 lane contract).
- **Worker:** A (edge-and-asset). **Lane packet:**
  `docs/tech-lead/packets/f341a.md` (the contract); binding law:
  `docs/evidence/F340/report.md` (D14–D17 + the machine census).
- **Base:** `81be8e7` (main HEAD at clone — the F340/F341 packets dispatch
  commit; the packet's expectation `7aa3327` is an ancestor of it, recorded
  per the packet's "or newer" clause).
- **Branch:** `work/f341a` — published to origin (the push-channel
  resolution is recorded in §7-L1); the TL-adjudicated D17 sixth-slot
  delivery rides the same branch as a follow-up push. Lane tip: see the
  FINAL REPORT message (the repository is the source of truth).

## 1. What this lane delivers

1. **A1 `observations-backpressure-discipline`** — the F340 §1 census
   candidate A1: `packages/observations/src/backpressure.ts` (verified
   exports: OverflowPolicy refuse/shed-oldest, BackpressurePolicy,
   QueueState, EnqueueDecision, BackpressureLevel ok/warn/critical), zero
   prior corpus coverage (machine-verified again at this base: zero grep
   matches in acceptance/field). The journey exercises the REAL public
   surface re-exported through `@fleetos/observations` (ingestion.ts):
   `enqueue`, `dequeue`, `evaluateBackpressureLevel`,
   `defaultBackpressurePolicy` (§3.1).
2. **A2 `observations-retention-projections`** — census candidate A2:
   `packages/observations/src/retention.ts` (ImmutableObservationStore,
   InMemoryImmutableStore, buildDeviceSummary, ProjectionMetadata,
   RetentionPolicy, projectionStale), zero prior coverage. The journey
   exercises the store + projection + retention-boundary law through the
   REAL public re-exports (§3.2).
3. **A3 `sim-worlds-checkpoint-determinism`** — census candidate A3:
   `packages/sim-worlds/src/world-engine.ts` — the engine's own law ("a run
   resumed from a checkpoint is byte-identical to the uninterrupted full
   run (journal + final state)"), previously only incidental matches
   (mission-mirror/cross context; the domain tests cover it in
   sim-worlds' own suite, never in the acceptance corpus). The journey
   exercises checkpoint/resume/fold byte-identity end-to-end through the
   REAL public APIs (§3.3).
4. **D17 sixth slot `observations-kernel-immutability-audit`** — the
   TL-adjudicated addition (F340 §2 D17; adjudication: "APPROVED … the
   census evidence, the distinctness-from-A2 note, and the three real
   refusal reasons check out"): the Wave 1 `kernel.ts` family —
   `admitToLog` (audit refs + the idempotent duplicate path), the
   fail-closed `listObservationsForDevice`, and
   `assertObservationImmutable`'s three REAL refusal reasons — zero prior
   acceptance-corpus coverage (machine-verified). The journey exercises
   the family end-to-end through the REAL public root-index re-exports
   (§3.4).

No candidate turned out already-covered (D16 honesty check): the A1/A2/A3
grep census was re-run at this base before implementation — all three
families had zero acceptance-corpus coverage; all three journeys were
delivered. The D17 sixth slot was likewise census-evidenced (zero
coverage) and — per the TL's adjudication — delivered as the lane's
fourth journey.

## 2. Machine-run evidence (this tree, exact commands + numbers)

| gate | command | result |
|---|---|---|
| field suite (owned) | `pnpm --filter @fleetos/acceptance-field test` | **102 tests / 7 files, all green** (base at `81be8e7`: 97 / 6 — grow-only: +3 remainder journey tests, +1 F341A epoch-law test, +1 D17 sixth-slot test; 0 tests removed or edited-red; the sixth-slot test lives in its own file — journeys.test.ts sits at the 400-line file-law ceiling) |
| corpus (machine-measured, both trees) | `assembleAcceptanceReport(FIELD_JOURNEYS)` on the lane tree; the same probe on a base worktree at `81be8e7` | base **31 journeys / 390 steps / 607 assertions** → three remainders **34 / 429 / 680** (machine-proven: every base journey byte-identical) → + D17 sixth slot **35 / 444 / 708** (machine-probe re-run on the delivery tree: journeys=35 steps=444 assertions=708 passed=35 passedAssertions=708; the 34 prior journey definitions untouched — nothing removed, nothing weakened) |
| typecheck (owned) | `pnpm --filter @fleetos/acceptance-field typecheck` | exit 0 |
| lint (owned) | `pnpm --filter @fleetos/acceptance-field lint` | 0 warnings, 0 errors (55 files; file law ≤400 enforced — every touched/created file passes, max 392 raw lines) |
| determinism | inside the field suite | corpus re-run byte-identical (runner digests); the four F341A journeys are additionally machine-verified byte-identical across the whole D9 frozen schedule (single-epoch invariance — `tests/epochs.test.ts` F341A block, all four ids) |
| consumed domain suites (read-only sanity — no domain file was touched) | `pnpm --filter @fleetos/observations test` / `pnpm --filter @fleetos/sim-worlds test` | 157/157 green / 84/84 green at this tree |
| boundary | `git diff --name-only main...HEAD` | ONLY `packages/acceptance/field/**`, `docs/evidence/F341A/report.md`, and the one-line catalog append (§5) |

## 3. The journeys (census citations + machine-checked laws)

### 3.1 A1 `observations-backpressure-discipline`

Census citation (F340 §1 row, verbatim): "observations backpressure |
`packages/observations/src/backpressure.ts` (OverflowPolicy
refuse/shed-oldest, BackpressurePolicy, QueueState, EnqueueDecision,
BackpressureLevel ok/warn/critical) | NO journey exercises it (grep: zero
matches in acceptance/field) | CANDIDATE A1".

- Persona `edge-operator`, capability `trustworthy-state` (the frozen
  vocabulary's trustworthy-state family — the ingestion queue guards
  observation admission; no vocabulary change).
- 13 steps, **25 assertions** (D14: ≥5 substantive incl. ≥1 refusal).
- REAL APIs driven: `enqueue`/`dequeue` threading a REAL `QueueState`
  under a REAL `BackpressurePolicy`; `evaluateBackpressureLevel` at the
  real thresholds; `defaultBackpressurePolicy` (provenance pins).
- Laws asserted: the ok→warn→critical transitions fire exactly at
  warnDepth/criticalDepth (the level-probe pins the boundary inclusive);
  refuse-and-retry overflow returns the REAL `overflow-refused` decision
  with the depth UNCHANGED and the refused counter accumulating honestly
  (a refused item is never silently dropped — the two `expectRefusal`
  steps prove the refusal path end-to-end); dequeue recovers the level
  critical→warn→ok; the shed-oldest DIVERGENCE at the same full depth
  (admitted=2 + shed=2 + depth still bounded vs the refuse queue's
  refused=2 at depth 8); the package defaults (1000/100/500/refuse).

### 3.2 A2 `observations-retention-projections`

Census citation (F340 §1 row, verbatim): "observations retention/projection
| `packages/observations/src/retention.ts` (ImmutableObservationStore,
InMemoryImmutableStore, buildDeviceSummary + projections) | NO journey
exercises it | CANDIDATE A2".

- Persona `fleet-operator`, capability `trustworthy-state`.
- 17 steps, **28 assertions** (D14: ≥5 incl. refusal/negative).
- REAL APIs driven: `createInMemoryImmutableStore` + `append` over
  observations admitted through the REAL ingestion pipeline
  (`observation.ingest` → `runPipeline`); `findByKey`/`listByDevice`/
  `lastSeqForDevice`; `buildDeviceSummary` (+ ProjectionMetadata);
  `projectionStale` + `defaultRetentionPolicy`.
- Laws asserted: idempotent re-append grows nothing; the fail-closed
  foreign-tenant read is refused (`tenant-fail-closed` — an
  `expectRefusal` step) with an empty foreign listing; an unknown key is
  refused (`unknown-observation-key` — honest absence, never fabricated);
  the stored record is unchanged (deep-equality of the REAL stored record
  vs the REAL admitted record after every subsequent append/read —
  immutability); the device-summary projection counts/kinds/lastSeq/
  lastObservedAt over the real stored set with honest metadata (kind,
  builtAt, sourceHash); the REAL TTL boundary is exclusive (fresh at
  exactly 300_000 ms, stale at 300_001); the rebuilt projection is
  content-identical but identity-distinct (disposable, rebuildable); the
  default policy ages projections only (immutable store TTL null =
  forever, rebuildOnDrift true).

### 3.3 A3 `sim-worlds-checkpoint-determinism`

Census citation (F340 §1 row, verbatim): "sim-worlds checkpoint/resume |
`packages/sim-worlds/src/world-engine.ts` ("a run resumed from a
checkpoint is byte-identical") | incidental matches only
(mission-mirror/cross context — no distinct journey) | CANDIDATE A3".

- Persona `sim-engineer`, capability `simulation` (same pair as the
  existing simulation-driven-experiment journey — the F300A
  multi-journey-per-cell precedent; no vocabulary change).
- 9 steps, **20 assertions** (D14: ≥5).
- REAL APIs driven: `runWorld`, `advanceWorldSteps` (from
  `genesisWorldState`), `checkpointWorldRun`, `advanceWorldSteps` from the
  checkpointed state, `resumeWorldRun`, `foldWorldEvents`,
  `verifyWorldJournal` — the engine's own public checkpoint law.
- Laws asserted: the full 24-step run's journal verifies; the 9-step
  prefix is a real mid-run state; the checkpoint records EXACTLY the
  folded prefix (foldedSeq == the prefix state's own seq — nothing folded
  away); the resumed 15-step segment lands byte-identically on the full
  run: journal (prefix+tail deep-equals the full journal), chained state
  digest, event seq, and the hidden per-device observation counters
  (carried, never reset — asserted equal to the full run's and ≥ 1); the
  fold-based resume over the full journal lands on the full state head
  and is replay-stable (re-feeding the already-folded prefix is a no-op);
  the pure-fold rebuild of the full journal reproduces the full state
  (same events ⇒ same state); the engine's own identity refusals are
  honest: `invalid-step-count`, `state-world-mismatch` (a foreign world's
  state), `state-tenant-mismatch` (the same worldId under a foreign
  tenant) — three `expectRefusal` steps against REAL engine refusals.
- Fixtures: the existing `FIELD_LAB_WORLD` + `FIELD_LAB_SCENARIO`; two
  new VALID probe worlds (`FIELD_LAB_WORLD_FOREIGN`,
  `FIELD_LAB_WORLD_TENANT_PROBE`) engineered to trip the engine's own
  state-identity refusals — same fixture discipline (id-sorted, bps in
  [1,10000], fail-closed validation).

### 3.4 D17 sixth slot `observations-kernel-immutability-audit`

Census evidence (F340 §2 D17, machine-verified at this base; TL-adjudicated
APPROVED): the Wave 1 `packages/observations/src/kernel.ts` admitted-log +
immutability family — `admitToLog` / `emptyAdmittedLog` /
`listObservationsForDevice` / `assertObservationImmutable` — exported
through `@fleetos/observations`' public root index with ZERO
acceptance-corpus coverage (grep over `packages/acceptance/field/**` =
zero matches; the four grep runs are recorded in the lane log).

- Persona `fleet-operator`, capability `trustworthy-state` (A2's cell
  under the F300A multi-journey-per-cell precedent; no vocabulary
  change).
- 15 steps, **28 assertions** (D14: ≥5 incl. refusals — 4
  `expectRefusal` steps).
- REAL APIs driven: `emptyAdmittedLog`, `admitToLog` (with its REAL
  `AuditEventRef` outputs — intent/actor/tenant/digest — and the
  idempotent duplicate path), `listObservationsForDevice` (fail-closed),
  `assertObservationImmutable` (the three typed mismatch reasons).
- Laws asserted: a fresh REAL admitted log is empty; the first admission
  is accepted (not a duplicate) with the REAL audit intent
  `observation:admit`, the device as audit actor, the admitting tenant,
  and a digest-backed audit ref; the log holds exactly the three
  admissions with the device high-water seq 3; the own-tenant listing
  counts all three in admission order with no foreign-tenant record
  ever leaking; the identical re-presentation is an idempotent
  duplicate — `ack.duplicate` true, the log returned UNTOUCHED (the same
  object reference), nothing grown, the duplicate ack naming the SAME
  admitted observation, and the audit trail distinguishing the path
  honestly (`observation:admit:idempotent`); the stale seq-0
  re-ordering attempt is refused (`non-monotonic-seq` — monotonic
  discipline, never silently re-ordered); the foreign tenant's listing
  is fail-closed (empty, nothing fabricated); the untampered
  re-presentation verifies as immutable — returning the SAME stored
  observation with the stored REAL payload digest; the three tamper
  refusals fire in isolation (`device-mismatch` on a forged deviceId,
  `seq-mismatch` on a forged seq, `digest-mismatch` on a forged payload
  digest — the stored record is the source of truth); and after every
  probe the log is unchanged (the listing still counts three at
  high-water seq 3 — tamper probes never mutate the source of truth).

### 3.5 D14 form compliance (all four journeys)

Unique IDs; real domain public entry points (the census-verified /
TL-adjudicated APIs); ≥5 substantive assertions each (25/28/20/28) incl.
positive, negative, refusal (2/2/3/4 `expectRefusal` steps on REAL API
refusals) and provenance (the package-default pins in A1/A2 and the
audit-ref pins in the sixth slot); deterministic rerun (byte-identity
machine-verified in-suite and across the frozen schedule); no mask
broadening (no adoption/industry file touched — D15: the journeys claim
the universal queueing/storage/determinism mechanics, no mask change at
all); no epochs declared (D14's single-epoch default — machine-verified
byte-identical across the D9 frozen schedule in `tests/epochs.test.ts`,
all four ids).

## 4. D17 sixth slot — DELIVERED per the TL's adjudication

Per F340 §2 D17, one additional journey was proposed from a genuinely
unexercised public API in worker-A owned paths with census evidence; the
TL adjudicated: "APPROVED. … genuine — the census evidence, the
distinctness-from-A2 note, and the three real refusal reasons check
out." Delivered as **`observations-kernel-immutability-audit`** (§3.4)
on this branch as a follow-up push, exactly as proposed:

- **Candidate (delivered):** `observations-kernel-immutability-audit`
  over `packages/observations/src/kernel.ts`'s admitted-log +
  immutability family: `admitToLog` / `emptyAdmittedLog` /
  `listObservationsForDevice` / `assertObservationImmutable` (Wave 1
  surface, exported through `@fleetos/observations`' public index).
- **Census evidence (machine-verified at this base):** the API exists
  (kernel.ts exports, re-exported by index.ts) and had ZERO
  acceptance-corpus coverage: grep for `assertObservationImmutable`,
  `admitToLog`, `listObservationsForDevice`, `emptyAdmittedLog` over
  `packages/acceptance/field/**` returned zero matches (the four grep
  runs are recorded in the lane log).
- **Delivered shape (exactly as proposed):** admission through the REAL
  `admitToLog` (with its audit refs + idempotent duplicate path),
  per-device listing through the fail-closed `listObservationsForDevice`,
  and probes of all three `assertObservationImmutable` refusal reasons
  (`device-mismatch`, `seq-mismatch`, `digest-mismatch` — tampered
  re-presentations detected by identity/digest cross-check) — plus the
  kernel's own monotonic-seq admission refusal.
- **Distinctness (the TL's adjudicated point):** the verification
  semantics (cross-checking a RE-PRESENTED candidate against the stored
  record, with typed mismatch reason codes) are distinct from A2's
  store-immutability law (the store never mutates stored records).
- **Count effect:** field corpus 34 → 35 journeys (+15 steps, +28
  assertions; §2/§6). Per F340's honest arithmetic the D17 slot grows
  the fully-applicable small-firm count on TL-adjudicated genuine
  coverage (the F342 TL convergence re-pins the ledger).

## 5. Boundary + laws

- `git diff --name-only main...HEAD` lists ONLY: `packages/acceptance/
  field/**` (11 new files: journey-contracts-f341a.ts, ops/f341a-
  {backpressure,retention,worlds,kernel}.ts, journeys/f341a-{backpressure,
  retention,worlds,field-remainder,kernel}.ts, tests/f341a-kernel.test.ts;
  8 edited: context.ts, fixtures.ts, journey-contracts.ts,
  journeys/index.ts, runner.ts, tests/epochs.test.ts, tests/journeys.test.ts,
  tests/report.test.ts), `docs/evidence/F341A/report.md` (new), and the
  one-line catalog append to the F341A section of
  `spec/work-items/WORK-ITEM-CATALOG.md` — 21 paths total.
- NO domain package was touched (the F340 §4 carve-out — "unless a test
  fixture requires an export already present" — was NOT needed: the
  backpressure and retention surfaces are already re-exported through
  `@fleetos/observations`' public index via ingestion.ts, and
  sim-worlds' checkpoint law is public through its root index).
- No adoption/release/pin file touched (TL-owned); the vocabulary
  (PERSONAS/CAPABILITIES) is unchanged; providers remain CONTRACT_ONLY.
- File law: every new file ≤400 lines (max 128 — ops/f341a-kernel.ts);
  every edited file stays ≤400 (max 392 — journey-contracts.ts,
  journeys.test.ts); oxlint clean.

## 6. Verification battery (machine-run, exact numbers)

| gate | command | base `81be8e7` | lane `work/f341a` |
|---|---|---|---|
| field suite | `pnpm --filter @fleetos/acceptance-field test` | 97 / 97 (6 files) | **102 / 102 (7 files)** |
| corpus journeys / steps / assertions | `assembleAcceptanceReport` probe | 31 / 390 / 607 | **35 / 444 / 708** (grow-only: 31 → 34 remainders → 35 sixth slot) |
| typecheck (owned) | `pnpm --filter @fleetos/acceptance-field typecheck` | clean | exit 0 |
| lint (owned) | `pnpm --filter @fleetos/acceptance-field lint` | clean | 0 warnings / 0 errors |
| observations (consumed, read-only) | `pnpm --filter @fleetos/observations test` | 157 / 157 | 157 / 157 (no change) |
| sim-worlds (consumed, read-only) | `pnpm --filter @fleetos/sim-worlds test` | 84 / 84 | 84 / 84 (no change) |

## 7. Honest limitations

- **L-1 (the push channel) — RESOLVED post-lane:** the original dispatch
  grant embedded in the dispatch URL was redacted at the gateway in this
  execution environment (`[REDACTED:github_token]` — never echoed);
  anonymous clone/ls-remote worked (the repository is public) but every
  lane-time authenticated push attempt was refused (`remote: Invalid
  username or token`) — recorded here as it happened. The TL later
  supplied a live push grant through the same token-URL channel form;
  `git push <token-embedded-url> HEAD:work/f341a` published the lane tip
  unchanged, verified by `git ls-remote` returning the identical SHA on
  `refs/heads/work/f341a` (no force-push, no history rewrite; the token
  is never echoed in chat, reports, or file contents). The D17 sixth-slot
  delivery (this commit) is pushed to the same branch the same way.
- **L-2 (the epoch dimension):** the four F341A journeys declare no epochs
  and are machine-verified byte-identical across the D9 frozen schedule. The
  backpressure/retention/determinism/kernel-audit mechanics genuinely do
  not respond at epoch anchors (queue states, store content, world draws
  and the admitted log's content are
  anchor-independent by construction); any future claim otherwise would
  need the D10 proof + census — none is made here.
- **L-3 (the A2 immutability probe's shared-reference caveat):** the
  in-memory store returns the same object references it stored, so the
  deep-equality proof demonstrates the store performs no transformation
  at append/read/re-append time (and the probe pins the record's own
  seq/observedAt/identity against the journey's known literals). A
  mutation of a shared reference between readings would be caught by the
  literal pins; a hypothetical in-place mutation with a simultaneous
  journey-side read would not be distinguishable by value comparison
  alone in this substrate.
- **L-4 (the A3 byte-identity scope):** byte-identity is proven on the
  journal (deep-equality of REAL event arrays), the chained state digest
  (the engine's own tamper-evident fold of every state mutation), the
  event seq, and the per-device observation counters — the state head
  the engine's own law names. A field-by-field canonical serialization
  of the full `WorldEngineState` (Maps included) is not part of the
  package's public surface; the events + chained digest + pure-fold
  rebuild together are the strongest machine proof available from REAL
  public outputs.
- **L-5 (sandbox scope):** all gates ran in this sandbox; the 16 GB
  builder full clean-checkout gates (root typecheck/build, the monorepo
  test plane) and browser verification remain TL-owned (the F322 §5
  doctrine). The adoption count-pin transition was NOT run (TL-owned at
  F342; no adoption file was touched — the corpus grew by 4 journeys
  (3 remainders + the TL-adjudicated D17 sixth slot),
  the documented F321A-precedent pin-transition class).
- **L-6 (the D17 sixth slot):** DELIVERED per the TL's adjudication (§4)
  — the proposal's census evidence stood (zero coverage, machine-verified)
  and the journey was built exactly as proposed; the F342 TL convergence
  re-pins the counting ledger for the +1 journey.
