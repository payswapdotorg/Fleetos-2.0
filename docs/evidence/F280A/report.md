# F280A — Worker A (Edge + Asset) Edge Hardening / Offline / Fleet-Scale Ingestion Evidence

- **Work item:** F280A — Edge hardening / offline / fleet-scale ingestion, A (Wave 8 lane A; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker A (edge-and-asset)
- **Base commit:** `fb13b94` (TL dispatch: Wave 8 packets F280A/B/C)
- **Branch:** `work/f280a` (created from `origin/main` HEAD, verified `git log --oneline -1`)
- **Date:** 2026-10-09
- **Task ID:** `9-a`

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-a grants):

- `packages/observations/**` — NEW sibling module `src/ingestion-limits.ts` (+ `src/ingestion-limits.test.ts`),
  export added in `src/index.ts`.
- `packages/connectivity/**` — NEW sibling module `src/offline-buffer.ts` (+ `src/offline-buffer.test.ts`),
  export added in `src/index.ts`.
- `packages/integrations/adcos/**` — NEW sibling modules `src/command-storm-guard.ts` (+ test) and
  `src/journal-compaction.ts` (+ test); ONE surgical edit in `src/command-journal.ts`
  (`verifyCommandJournal` gained an OPTIONAL `options` parameter — `anchor` / `firstSeq` — backward
  compatible: every existing call site passes one argument and behaves identically); exports added in `src/index.ts`.
- `packages/recovery/**` — NEW sibling module `src/pagination.ts` (+ `src/pagination.test.ts`), export added in `src/index.ts`.
- `packages/maintenance/**` — NEW sibling module `src/scheduling-scale.ts` (+ `src/scheduling-scale.test.ts`),
  export added in `src/index.ts`.
- `docs/evidence/F280A/**` (this report).

`git status` at commit time shows exactly the six lane packages above — no other lane's path, no spec
edits, no `package.json` changes (ZERO new runtime or dev dependencies), no lockfile mutation
(the sandbox's filtered pnpm install left `pnpm-lock.yaml` untouched; `git status` clean of it).

All imports are intra-package (`./ingestion.js`, `./command-journal.js`, `./posture-machine.js`, …) —
public entry points of my own lane's packages only; no cross-context imports added.

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

Filtered pnpm install (`corepack pnpm install --filter "@fleetos/acceptance-adoption..." --filter
"@fleetos/acceptance-field..." --filter <each lane pkg>... --prefer-offline --ignore-scripts`) was required
to link the full workspace closure (sim-worlds → simulation → world-model; adoption → security/commerce
acceptance). One install-order note: pnpm's `--filter` (without `...`) does not link transitive workspace
deps — the `...` recursive form fixed three suites that failed to RESOLVE modules at first run (a
dependency-linking artifact, not code failures; documented honestly here).

All THIRTEEN suites at clean `fb13b94` before any edit, and again after the last edit (identical counts
for untouched packages — pre-existing suites untouched and green):

```text
BEFORE (clean fb13b94)                     AFTER (working tree)
identity 3 files/89     89    (same)       identity 3/89
tenancy  3/67           67                 tenancy  3/67
assets   3/99           99                 assets   3/99
observations 4/134     134                 observations 5/157   (+23 net-new)
health   4/89           89                 health   4/89
recovery 3/60           60                 recovery 4/77        (+17 net-new)
maintenance 3/69        69                 maintenance 4/86     (+17 net-new)
connectivity 7/120     120                 connectivity 8/138   (+18 net-new)
integrations/adcos 8/143  143             integrations/adcos 10/178 (+35 net-new)
sim-worlds 5/84         84                 sim-worlds 5/84
experiences/asset-field 4/69  69           experiences/asset-field 4/69
acceptance/field 5/61   61  ✓ baseline     acceptance/field 5/61   ✓ held
acceptance/adoption 7/90 90  ✓ baseline    acceptance/adoption 7/90 ✓ held
```

**Wave-7 acceptance baselines held exactly: field 61, adoption 90.** Net-new tests: **110** (requirement ≥ 60).
Lane total: 1023 → 1133.

## 3. Deliverables (all pure deterministic TS; logical `now` / caller-supplied inputs everywhere)

### 3.1 Fleet-scale ingestion hardening — `packages/observations/src/ingestion-limits.ts`

- **Bounded ingestion buffers** with caller-chosen overflow policy — `drop-oldest` (evicted entry
  SURFACED in the outcome; `droppedOldest` counter) vs `reject-newest` (`buffer-full` refusal,
  `rejectedNewest` counter). BOTH tested at the limit. Byte-accounting bound
  (`maxTotalPayloadBytes`) enforced alongside the entry-count bound; a single entry larger than the
  whole byte budget refuses `payload-too-large`. FIFO law: `sequence` is per-buffer monotonic; FIFO
  order survives drop-oldest shedding.
- **Per-tenant admission caps** — `checkTenantAdmission` fail-closed `tenant-cap-exceeded` carrying
  the REAL numbers (cap, used, requested); `recordTenantAdmissions` advances only actually-admitted
  volume; per-tenant isolation (tenant A's burst never consumes tenant B's cap — tested both ways);
  `missing-tenant-id` fails closed.
- **Batch-size limits with honest partial-accept** — `admitBatchWithLimits`: a batch larger than
  `maxBatchSize` (default 256) refuses WHOLE (`batch-too-large`, honest size + limit numbers);
  within an accepted batch each item is admitted or refused independently — over-cap items refuse
  `tenant-cap-exceeded` while earlier items STAY admitted; per-item payload limit
  (`payload-too-large`); duplicates (re-delivered `(deviceId, seq)` already known to the admission
  store) consume NO cap budget — the cap gate only applies to genuinely-new items; the batch's
  running usage counts against the tenant cap across the WHOLE batch.
- **Memory-shape bounds** (documented worst case for a max batch, in the module doc): at the
  defaults (256 × 8192 B) one call touches ≤ 2 MiB caller-supplied payload bytes + 256 ack records
  + ≤ 256 new admission-store entries + one transient canonical-field map at a time. Machine-tested:
  a max-size batch at exactly the per-item payload limit admits fully with the store growing by
  exactly the admitted volume.

### 3.2 Offline tolerance hardening — `packages/connectivity/src/offline-buffer.ts`

- **Deterministic offline queue with replay-in-order** — entries carry a per-buffer monotonic
  `sequence`; `replayOfflineBuffer` emits strictly in capture (FIFO) order (tested with interleaved
  posture stamping); the replay report carries a sha-256 `replayDigest` over the ordered entry ids +
  divergences (machine-checked determinism).
- **Divergence accounting across posture changes** — every entry is stamped with the runtime
  `PostureState` at CAPTURE; the replayed batch lands against the CURRENT posture (stamped
  `replayedPosture` on the report); every entry whose capture posture differs gets a typed
  `OfflineDivergenceRecord` (capture posture, replay posture, the posture transitions observed while
  pending, the truncation count when the posture log overflowed, reason `posture-changed-while-offline`)
  — divergence is RECORDED, never hidden. The posture log is bounded (`maxPostureTransitions`) with
  the eviction COUNTED (`postureLogTruncated`) and attached to every divergence record.
- **Expiry of stale offline entries with reason-coded eviction** — `sweepExpiredOfflineEntries`
  evicts entries with `now >= capturedAt + ttlMs` (boundary inclusive — tested at the exact edge);
  every evicted entry is surfaced with reason `offline-entry-expired`; the sweep is idempotent.
- **Bounds + fail-closed scope** — `reject-newest` (`offline-buffer-full`) or `drop-oldest`
  (evicted surfaced); `tenant-mismatch` / `device-mismatch` fail-closed on foreign capture inputs;
  duplicate entry ids refused.

### 3.3 Edge command lifecycle hardening — `packages/integrations/adcos/`

`src/command-storm-guard.ts`:
- **Retry-storm protection — idempotency dedup under repeated delivery** — `DeliveryDedupWindow`
  dedups `(tenant, commandId)` deliveries in a LOGICAL-TIME window: a delivery at T suppresses
  re-deliveries in (T, T + windowMs); at exactly T + windowMs the entry is stale and a re-delivery
  counts as first (documented + boundary-tested). A duplicate hit returns the RECORDED outcome
  digest (idempotent — not re-executed). Bounded memory (`maxEntries`) with the OLDEST evicted under
  pressure and the eviction COUNTED (`pressureEvicted`). Fail-closed tenant keying
  (`${tenantId}|${commandId}`): a foreign tenant's identical commandId does NOT dedup.
- **Dispatch rate guard** — `admitDispatchAttempt` consulted BEFORE `dispatchAdcosCommand`:
  per-command backoff enforcement (`retry-backoff-not-elapsed` + honest `eligibleAt`; at exactly
  `nextRetryAt` admitted — boundary-tested); per-command attempt budget per logical window
  (`command-dispatch-rate-exceeded` + in-window count + limit); per-tenant dispatch budget
  (`tenant-dispatch-rate-exceeded`) — a storming tenant cannot consume another tenant's budget
  (fail-closed isolation tested BOTH directions); deterministic sliding-window prune; budget resets
  after the window passes.
- **Expiry sweeps under fleet-scale volumes** — `expireAdcosCommandsBounded`: at most `maxPerSweep`
  due commands expired per call, due-ordered deterministically (expiresAt asc, commandId asc);
  `remainingDue` reports the honest backlog; `invalid-sweep-bound` for bounds < 1; each expiry
  appends exactly one chained `expired` journal event via the journal's own primitives
  (`makeEventAudit` + `applyCommandEvent`) so the digest chain stays verifiable after every sweep
  (tested). The existing unbounded `expireAdcosCommands` is unchanged (no regression).

`src/journal-compaction.ts` — **journal compaction SAFE mode**:
- `compactCommandJournal` removes a contiguous event prefix (seq ≤ cutoff) and is REFUSED unless
  every command touched in the prefix is TERMINAL at the cutoff (`non-terminal-in-prefix` with the
  offending command ids surfaced; `invalid-cutoff` for out-of-range cutoffs). Retained events are
  byte-identical to the full journal's — nothing is re-chained or rewritten. The checkpoint carries
  `byId` + `byIdempotencyKey` forward (post-compaction idempotency dedup still works — tested).
- **Verifies identically — same digest chain semantics**: `verifyCompactedCommandJournal` uses the
  FULL journal's own `verifyCommandJournal` (extended with an optional `anchor`/`firstSeq`) so the
  chain rule is literally the same function. Tamper-tested: forged anchor → `audit-chain-broken`;
  mutated retained audit digest → `audit-chain-broken`; dropped retained event → `seq-out-of-order`;
  tampered checkpoint records → `summary-mismatch` (the compaction record's `summaryDigest` over the
  terminal command records is recomputed from the checkpoint).
- **Chain prefix invariance + state equivalence (THE SAFE property, machine-tested)**: appending
  identical new events to the full journal and to the compacted journal yields the IDENTICAL final
  chain digest and identical `byId` / `byIdempotencyKey` / `seq` / `lastAuditDigest`.
- `cutoffSeq: 0` is a well-defined no-op (anchor = genesis). Post-compaction idempotency stays
  tenant-scoped (same key from another tenant issues a NEW command — tested).

### 3.4 Recovery/maintenance scale readiness

`packages/recovery/src/pagination.ts` — **case-volume pagination laws**:
- Deterministic total order `(openedAt DESC, id ASC)`; shuffled inputs yield byte-identical pages
  (page digest machine-checked). Keyset pagination (cursor = last item's sort key, canonical
  base64-encoded JSON, validated on decode).
- **Stable pages under new inserts between reads — documented snapshot semantics**: the function
  paginates the array the caller passes (snapshot vs live read is the caller's choice); with keyset
  cursors: (a) pre-existing cases are never skipped/duplicated regardless of inserts (tested);
  (b) inserts BEHIND the cursor may appear on later pages of a live view (tested); (c) inserts AHEAD
  of the cursor are not visible to the current walk; a fresh walk sees them (tested).
- Exhaustive walk at fleet scale (1000 cases, limit 37): every case exactly once. Fail-closed:
  `invalid-limit` (0 / negative / fractional / > MAX_PAGE_LIMIT=256; exactly 256 admitted — boundary
  tested), `invalid-cursor` (malformed base64/JSON/fields).
- Tenant-scoped `paginateCasesForTenant`: `missing-tenant-id` fail-closed; a cursor minted by
  ANOTHER tenant refuses `cursor-tenant-mismatch` (cross-tenant probe — a foreign cursor never walks
  this tenant's cases); an injected foreign-tenant record never appears in a page.

`packages/maintenance/src/scheduling-scale.ts` — **schedule conflicts at fleet scale**:
- `MaintenanceCalendar` — windows indexed per `(tenantId, assetId)` slot, sorted `(startsAt, id)`;
  conflict checks consult one slot (O(slot), not O(fleet)); 500-window conflict detection tested with
  exact overlap bounds.
- `findNextFreeSlot` — deterministic earliest-fit within a horizon; honest `no-free-slot-in-horizon`
  refusal (never an invented slot); exact-fit boundary tested.
- `scheduleWindowsBatch` — bounded batch (over `maxProposalsPerBatch` refuses the WHOLE batch
  `batch-too-large`); per-proposal acks; caller-chosen deterministic conflict resolution:
  `refuse-conflicts` (fail-closed per-proposal refusal with the conflict record — honest partial
  accept) or `reallocate-next-free` (deterministic RESOLUTION: the conflicting proposal moves to its
  next free slot; the ack carries the original conflict AND the new slot; horizon exhaustion refuses
  `no-free-slot-in-horizon` — never silently dropped). Determinism law: input order is the tie-break
  (first proposal wins a contested slot — byte-identical re-runs tested). Honest time law:
  `window-in-past`, `non-positive-duration`, `invalid-window`, `ends-before-start`.
- Tenant isolation: a foreign tenant's window on the SAME assetId never conflicts; slots stay
  isolated (tested). `calendarWindowFromScheduled` bridges the F220A `ScheduledWindow` shape.

### 3.5 Tenant isolation hardening (cross-tenant probes on every NEW code path)

Every new module above carries fail-closed tenant probes with asserted reason codes:
ingestion buffer scope + cap isolation + cross-tenant batches (§3.1); offline-buffer
`tenant-mismatch`/`device-mismatch` (§3.2); dedup-window tenant keying + rate-guard budget isolation
both directions + tenant-scoped bounded sweeps (§3.3); pagination `cursor-tenant-mismatch` +
tenant-scoped walks (§3.4); calendar slot isolation + cross-tenant no-conflict (§3.4).

## 4. Machine-verified gate outputs (exact commands, run in each touched package dir)

```text
observations:    test  → Test Files 5 passed (5); Tests 157 passed (157)
                 typecheck → tsc --noEmit, clean (no output)
                 lint → Found 0 warnings and 0 errors. Finished in 15ms on 13 files using 2 threads.
connectivity:    test  → Test Files 8 passed (8); Tests 138 passed (138)
                 typecheck → clean; lint → 0w/0e, 11ms on 18 files
integrations/adcos: test → Test Files 10 passed (10); Tests 178 passed (178)
                 typecheck → clean; lint → 0w/0e, 16ms on 24 files
recovery:        test  → Test Files 4 passed (4); Tests 77 passed (77)
                 typecheck → clean; lint → 0w/0e, 11ms on 9 files
maintenance:     test  → Test Files 4 passed (4); Tests 86 passed (86)
                 typecheck → clean; lint → 0w/0e, 12ms on 9 files
```

File law: every production file ≤ 400 code lines under the repo lint rule
(`max-lines: 400, skipBlankLines, skipComments` — enforced by the green lint gate; largest raw:
`ingestion-limits.ts` 424 total lines incl. blanks/doc-comments). No `Date.now`, no `Math.random`,
no network, no timers, no new runtime deps (grep-audited; only doc-comment mentions).

## 5. Seam findings (TL-relevant)

- **S1 — `verifyCommandJournal` optional-parameter extension:** the compaction verifier needed to
  seed the chain with an anchor. Rather than duplicating the chain rule, `verifyCommandJournal`
  (`command-journal.ts`) gained an OPTIONAL `{ anchor?, firstSeq? }` second parameter. All
  pre-existing call sites are one-argument and byte-identical in behavior. If the TL prefers a
  separate function, the move is mechanical.
- **S2 — bounded sweep appends events directly:** `expireAdcosCommandsBounded` constructs `expired`
  events via the journal's exported `makeEventAudit` + `applyCommandEvent` (the same append path the
  lifecycle uses internally) because the lifecycle's own sweep is all-or-nothing and unbounded.
  The events are shape-identical to the lifecycle's; an eventual single-command expiry primitive in
  the lifecycle module would let this seam disappear.
- **S3 — dispatch-storm enforcement is opt-in-by-composition, not embedded in
  `dispatchAdcosCommand`:** the existing lifecycle tests dispatch at `NOW+attempt` (before the
  backoff ladder elapses), so embedding nextRetryAt enforcement in `dispatchAdcosCommand` would
  change existing semantics/regress Wave-7 journeys. The guard is therefore a caller-consulted
  pre-check (`admitDispatchAttempt`) — the packet's "new sibling module" pattern. TL may later make
  the guard mandatory inside the lifecycle as a deliberate behavior change.
- **S4 — offline replay divergence is recorded at the connectivity layer only:** the replayed batch
  "lands against the CURRENT posture" in the replay report; the observations receiving side
  (`store-forward.ts`) is posture-unaware by design. Binding replay divergence into the admission
  pipeline's audit trail is a TL composition decision.
- **S5 — dedup-window pressure eviction is honest but lossy by definition:** when the delivery dedup
  window is full, the OLDEST entries are evicted (counted, surfaced) — a re-delivery of an evicted
  command would count as first. The windowMs bound (default 10 logical minutes) is the documented
  mitigation; fleet tuning is an operator policy decision.

## 6. Honest residuals

- The offline buffer's replay is a REPORT (ordered entries + divergence records + digest); wiring
  the replayed entries through `admitBatchWithLimits` in a live composition (agent → gateway) is
  TL/application integration — the observations-side cap semantics for a replayed backlog are
  tested standalone (§3.1 "replayed offline batch composition").
- Journal compaction bounds the EVENT list only; the command-record index (`byId`,
  `byIdempotencyKey`) still grows with command count (documented in the module). A record-index
  bound would drop idempotency history — a deliberate TL policy decision, not taken here.
- The dispatch rate guard's sliding windows are per-guard-state; the caller threads the guard
  (persisting it across process restarts is application plumbing, not domain semantics).
- `pnpm -r test` (full monorepo) NOT run — TL merge-time gate per packet; all THIRTEEN lane +
  acceptance suites were machine re-run instead (§2).
- Pagination snapshot semantics are enforced at the pure-function level; a persisted cursor store
  (cursor TTL, reuse limits) is application policy.

## 7. TL re-run commands

```bash
cd <repo>
corepack pnpm install --filter "@fleetos/acceptance-adoption..." --filter "@fleetos/acceptance-field..." \
  --filter "@fleetos/observations..." --filter "@fleetos/connectivity..." --filter "@fleetos/adcos..." \
  --filter "@fleetos/recovery..." --filter "@fleetos/maintenance..." --prefer-offline --ignore-scripts
for p in observations connectivity integrations/adcos recovery maintenance \
         identity tenancy assets health sim-worlds experiences/asset-field acceptance/field acceptance/adoption; do
  (cd packages/$p && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint)
done
```
