# F250C — Worker C (Work + Commerce) Wave 5 Integration Adapter Lane Evidence

- **Work item:** F250C — Aurum + Apify + vendor/external adapters at
  operational-truth grade (Wave 5 lane C)
- **Owner:** Worker C (Work + Commerce)
- **Base commit:** `15289ec` (dispatch tip — Wave 5 packets; main @
  `14c399f` Wave 4 complete, full suite 2937/0 TL-verified at dispatch)
- **Branch:** `work/f250c`
- **Date:** 2026-10-07

**Inherited-WIP note (honesty):** this lane was completed from an
interrupted prior session's UNCOMMITTED WIP. Per the dispatch protocol the
TRUE baseline was machine-verified from clean state first (`git stash` →
run → record → `git stash pop`: aurum 13 / apify 12 / vendors 12, all
passing, typecheck exit 0 × 3), then EVERY WIP file was reviewed against
the packet, re-gated (test/typecheck/lint) and completed. One hardening
fix was applied on top of the WIP: `verifyJobManifest` (apify) is now
TOTAL — a tampered non-JSON `inputCanonical` fails verification cleanly
(`false`) instead of throwing (a thrown `SyntaxError` would escape a
tamper-detection API); +1 net-new test covers it.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-c) — scoped to the three adapter
packages granted for this work item:

- `packages/integrations/aurum/**` — NEW `src/tenant.ts`, `src/digest.ts`,
  `src/delta-apply.ts`, `src/sync-session.ts`, `src/sync-reconciliation.ts`;
  NEW `tests/delta-apply.test.ts`, `tests/sync-session.test.ts`,
  `tests/sync-reconciliation.test.ts`; `src/index.ts` restructured
  (tenant block extracted + re-exported; +5 `export *` lines)
- `packages/integrations/apify/**` — NEW `src/seam.ts`, `src/digest.ts`,
  `src/job-lifecycle.ts`, `src/result-ingestion.ts`, `src/run-registry.ts`;
  NEW `tests/job-lifecycle.test.ts`, `tests/result-ingestion.test.ts`,
  `tests/run-registry.test.ts`; `src/index.ts` restructured (tenant +
  Guardian seam extracted + re-exported; +5 `export *` lines)
- `packages/integrations/vendors/**` — NEW `src/tenant.ts`,
  `src/digest.ts`, `src/catalog-sync.ts`, `src/verification.ts`,
  `src/scorecards.ts`; NEW `tests/catalog-sync.test.ts`,
  `tests/verification.test.ts`, `tests/scorecards.test.ts`;
  `src/index.ts` restructured (tenant block extracted + re-exported; +5
  `export *` lines)
- `docs/evidence/F250C/**` (this file)

NOTHING else. `git status` at commit time shows exactly the three package
paths + this evidence file. No spec edits, no snapshot regen, no
`pnpm-lock.yaml` / `pnpm-workspace.yaml` mutation, `main` untouched.

**Public-surface note:** the index restructurings are non-destructive —
the extracted tenant/Guardian definitions are re-exported verbatim
(`export * from "./tenant.js"` / `"./seam.js"`), so every Wave 1 export
(name + shape) is unchanged and the additions are purely additive. The
three Wave 1 test files run UNMODIFIED against the restructured indexes
(machine-verified in every gate run below).

## 2. What became operational-truth grade

Wave 1 (F200C/F210C) shipped kernel-grade seams: ports, deterministic
reference adapters, retry policies, idempotency dedup. Wave 5 (F250C)
makes the three external-system adapters OPERATIONAL: sync engines with
cursors and digest chains, job lifecycles with Guardian-gated
authorization and rate ceilings, verification workflows with revocation
propagation — all pure, deterministic, tenant-scoped, fail-closed, with
the F220C depth bar (typed refusal codes, atomic semantics, honest
quarantine, integer-bps math, digests with tamper detection) applied to
the adapter lane.

### 2.1 `@fleetos/aurum` — the delta-sync engine

- **`src/delta-apply.ts` — incremental projection application.** Documented
  LWW rule: last-writer-wins by (source, logical-time, id) tuple — newer
  logical time wins; older is SKIPPED as stale (recorded, never silent);
  equal tuple + identical payload = idempotent duplicate skip; equal tuple
  + different content = QUARANTINED
  (`CONFLICT_SAME_TUPLE_DIFFERENT_PAYLOAD`) — never silently resolved.
  Deletes leave tombstones (a stale upsert cannot resurrect a deleted
  projection — machine-tested). ATOMIC BATCH SEMANTICS: batch-envelope
  failures (invalid/cross tenant, source mismatch, kind, empty batch,
  within-batch idempotency-key conflict) change NOTHING. QUARANTINE
  HONESTY: malformed deltas (op/externalId/payload/logicalTime/key) and
  delete-unknown are recorded with reason codes + the original delta
  verbatim. Per-projection digests (`proj_`), input-order-independent
  batch digests (`batch_`), store digests (`store_`) recomputed by
  `verifyStoreDigest` (per-projection integrity + chain — payload
  tampering is detected).
- **`src/sync-session.ts` — cursor-based session lifecycle.**
  opened → fetching → applying → committed (+ failed/aborted from any
  non-terminal; terminal states refuse everything with `TERMINAL_STATE`).
  Logical-time cursor (source, logicalTime, sequence) that never
  regresses (`CURSOR_REGRESSION`, checked before any application —
  atomic). Per-batch idempotency-key dedup against the session's applied
  keys: a fully-duplicate re-delivery leaves store + sync digest
  byte-identical (idempotent batch re-apply — machine-tested with the
  same logical `now`). Sync digest chains batch digests (`sync_` prefix,
  `sync_genesis` anchor); `verifySyncDigest` detects chain tampering.
- **`src/sync-reconciliation.ts` — full-state reconciliation.**
  Deterministic set-diff external-snapshot-set vs local live projections;
  classification `in-sync` / `external-ahead` / `local-ahead` /
  `diverged` (mixed drift or same-id content divergence with BOTH digests
  reported); tombstones excluded from local drift. REPAIR PLANS ARE PURE
  PROPOSALS: every `RepairProposal` is inert data tagged
  `kind: "repair-proposal"` + `note: "adapter-never-executes"`
  (function-free — test-asserted); this module exports no executor.
  Deterministic ordering + report digests; malformed/duplicate snapshots
  fail the whole reconciliation (`SNAPSHOT_MALFORMED`).

### 2.2 `@fleetos/apify` — actor job lifecycle + evidence-gated ingestion

- **`src/job-lifecycle.ts`.**
  proposed → authorized → scheduled → running → completed | failed
  (+ expired from proposed/authorized/scheduled — never from running).
  GUARDIAN DECISIONS ARE INPUTS, NEVER MINTED: `authorizeActorJob`
  requires a caller-supplied `GuardianDecisionRefLike` with
  authorized=true (`AUTHORIZATION_REQUIRED` / `AUTHORIZATION_DENIED` /
  `AUTHORIZATION_DECISION_ID_EMPTY` refusals; `createActorJob` always
  sets `authorization: null` — test-asserted). RATE-BUDGET ACCOUNTING per
  logical window in integer units with integer-bps floored utilization
  and the `note: "ceiling-not-authorization"` vocabulary on EVERY
  accounting result; over-budget reservations refuse with the exact
  overshoot (never clamped); cross-tenant/cross-window reservations
  refuse (`RATE_BUDGET_MISMATCH`). Job manifests carry FNV-1a digests
  over canonical input (key-order independent) with `verifyJobManifest`
  tamper detection — TOTAL: a tampered non-parseable canonical input
  returns `false`, never a thrown exception. Idempotent creation:
  same key + same draft → the ORIGINAL job with `duplicate: true`;
  different draft → `IDEMPOTENCY_KEY_CONFLICT`. Expiry by logical time
  (`NOT_DUE_FOR_EXPIRY` before `expiresAt`).
- **`src/result-ingestion.ts` — evidence gate.** EVERY ingested result
  enters QUARANTINE (`EVIDENCE_NOT_ATTACHED`); only
  `attachEvidenceBundle` — requiring a sha-256-SHAPED digest (64
  lowercase hex, STRUCTURAL check only, documented as never claiming
  content verification) and a same-tenant bundle — makes it usable.
  Malformed payloads are quarantined with `PAYLOAD_MALFORMED` (original
  kept verbatim) and CANNOT be laundered by evidence
  (`RESULT_NOT_QUARANTINED`). Deterministic payload classification
  (structured/empty/malformed); result digests change when evidence
  attaches (provenance); tenant fail-closed reads with no existence
  leaks.
- **`src/run-registry.ts` — event fold.** Append-only single-tenant run
  journal with journal-assigned 1-based seqs + CHAINED per-event digests
  (`run_`, `run_genesis` anchor; `verifyRunJournalChain` reports the
  earliest broken seq); monotonic logical times enforced
  (`EVENT_TIME_REGRESSION`). `foldRunJournal` is a pure deterministic
  replay indexed by job/status/window with lexically sorted ids;
  `foldFromCheckpoint` folds only post-checkpoint events and CONVERGES
  to the identical full-replay state (machine-tested byte-identical).
  Fail-closed queries: cross-tenant status/window queries refuse
  (`TENANT_MISMATCH`); `lookupRun` returns null for unknown AND foreign
  job ids.

### 2.3 `@fleetos/external-vendors` — catalog sync + verification + scorecards

- **`src/catalog-sync.ts` — external catalog sync.** Batch import with
  DEDUPE BY EXTERNAL ID: identical within-batch duplicates collapse
  (counted); conflicting content refuses the WHOLE batch
  (`DUPLICATE_EXTERNAL_ID_CONFLICT`, atomic). Re-import LWW (documented):
  newer logical time replaces + RESETS claims to `claimed`; older is
  skipped as stale (recorded); equal + identical = idempotent skip;
  equal + different refuses (`ENTRY_LOGICAL_TIME_CONFLICT`, atomic).
  Imported capabilities become CLAIM records (claimed → verified →
  expired lifecycle; verification lives in `verification.ts`). Deterministic
  `entry_`/`catalog_` digests, input-order independent;
  `verifyCatalogDigest` detects both entry and chain tampering.
- **`src/verification.ts` — capability verification workflow.**
  `verifyCapability` moves a claim claimed → verified REQUIRING a
  same-tenant evidence ref (`VERIFICATION_EVIDENCE_REQUIRED`,
  `EVIDENCE_TENANT_MISMATCH`, `EVIDENCE_ID_EMPTY`); double verification
  and unknown pairs refuse with typed codes; `expiresAt` must be
  strictly after `verifiedAt`. EXPIRY BY LOGICAL TIME:
  `classifyVerificationExpiry` is a pure read (active/expired);
  `expireDueVerifications` enforces it on registry + catalog atomically;
  expired claims require a fresh import to re-claim (`CLAIM_EXPIRED`).
  REVOCATION: requires a reason, moves the record to `revoked`, forces
  the claim to `expired`, and returns an inert `RevocationNotice` for
  KPI-rollup propagation (the notice itself never executes anything).
- **`src/scorecards.ts` — commercial scorecards.** Metric ingestion with
  honest quarantine: structural failures refuse the batch atomically;
  semantic issues quarantine with reason codes (`VENDOR_UNKNOWN`,
  `CAPABILITY_NOT_VERIFIED`, `CAPABILITY_REVOKED`) — never silently
  dropped. KPI rollups: per-vendor weighted mean in INTEGER bps —
  floor(Σ(valueBps×weightBps)/Σ weightBps) — no floats in outputs;
  EXCLUSION HONESTY: every quarantined metric is excluded AND listed
  with metric id + reason (included + excluded counts account for every
  metric in the window); trend classification vs the previous logical
  window (improving/declining/stable/null without history); per-rollup
  `score_` digests + `verifyScorecardDigest`. REVOCATION PROPAGATION:
  `applyRevocationToMetrics` consumes the inert notice and quarantines
  every dependent metric — fail-closed, no partial application, other
  tenants' metrics untouched.

## 3. Tests

Baseline machine-verified BEFORE the first edit (per the packet's
baseline law): aurum 13 / apify 12 / vendors 12 = 37 tests, all passing;
typecheck exit 0 × 3. Re-verified after the last edit (identical original
suites still green inside the new totals).

| Package | Test files | Tests (total / new) | Status |
|---------|------------|---------------------|--------|
| `@fleetos/aurum` | `tests/aurum.test.ts`, `tests/delta-apply.test.ts`, `tests/sync-session.test.ts`, `tests/sync-reconciliation.test.ts` | 61 (13 + 48) | all passing |
| `@fleetos/apify` | `tests/apify.test.ts`, `tests/job-lifecycle.test.ts`, `tests/result-ingestion.test.ts`, `tests/run-registry.test.ts` | 68 (12 + 56) | all passing |
| `@fleetos/external-vendors` | `tests/external-vendors.test.ts`, `tests/catalog-sync.test.ts`, `tests/verification.test.ts`, `tests/scorecards.test.ts` | 51 (12 + 39) | all passing |
| **Lane total** | 12 files | **180 (37 + 143)** | all passing |

Net-new: **143 tests** (targets: aurum ≥ 25 → 48; apify ≥ 25 → 56;
vendors ≥ 20 → 39).

### Test themes covered

- **Lifecycle legality + typed refusals**: every state machine (sync
  session, actor job) has its full legal path + illegal-transition tables
  asserting the exact reason code, including `TERMINAL_STATE` on
  committed/failed/aborted sessions and completed/failed/expired jobs,
  and reason-required codes for fail/abort.
- **Atomicity**: malformed batch envelopes (aurum deltas, vendor catalog
  entries, metric drafts) change NOTHING — original store/catalog
  untouched; conflicting within-batch duplicates refuse the whole batch;
  cursor regression refused before application.
- **Quarantine honesty**: malformed/conflicting deltas, delete-unknown,
  malformed result payloads, unknown vendors, unverified/revoked
  capability dependencies — all recorded with reason codes + originals,
  never silently dropped; evidence cannot launder malformed payloads.
- **Idempotency**: aurum session re-apply of a fully-duplicate batch
  leaves store + sync digest byte-identical; catalog re-import at equal
  logical time + identical content is a no-op; metric id dedupe vs
  conflict; job creation dedupe vs `IDEMPOTENCY_KEY_CONFLICT`.
- **Determinism**: batch/store/catalog/scorecard digests are input-order
  and payload-key-order independent; fold replay == state; checkpoint
  fold == full fold (byte-identical `toEqual`); identical inputs →
  identical outputs throughout.
- **Integer-bps exactness**: rate utilization 3333 for 1/3; scorecard
  weighted mean 8250 for 8000@75%/9000@25% (floored, `Number.isInteger`
  asserted); overshoots carried exactly, never clamped.
- **Guardian-gating**: authorization is an input (null/denied/anonymous
  decisions refuse; created jobs always carry `authorization: null`;
  scheduling re-checks the attached decision).
- **Ceiling-not-authorization vocabulary**: asserted on rate-budget
  accounting results.
- **Digest chains + tamper detection**: sync digest chain, run journal
  chain, store/catalog integrity — tampering detected at the earliest
  broken seq/index.
- **Tenant fail-closed**: cross-tenant batches/stores/evidence/metrics/
  queries/revocations refuse or return null with no existence leaks, in
  all three packages.

## 4. Gate outputs (exact, in each package dir)

Per the packet — gates run INSIDE each package (root-level lint/
typecheck/build/snapshot are TL gates, not run here).

### 4.1 `corepack pnpm run test` — PASS (180 lane tests)

```
=== aurum ===
 Test Files  4 passed (4)
      Tests  61 passed (61)
=== apify ===
 Test Files  4 passed (4)
      Tests  68 passed (68)
=== vendors ===
 Test Files  4 passed (4)
      Tests  51 passed (51)
```

### 4.2 `corepack pnpm run typecheck` — PASS (3/3, exit 0 each)

```
aurum TYPECHECK exit=0
apify TYPECHECK exit=0
vendors TYPECHECK exit=0
```

(`tsc -p tsconfig.json --noEmit` — no diagnostics emitted.)

### 4.3 Per-package `corepack pnpm run lint` (self-check) — 0 warnings / 0 errors × 3

```
=== aurum ===    Found 0 warnings and 0 errors.  (10 files)
=== apify ===    Found 0 warnings and 0 errors.  (10 files)
=== vendors ===  Found 0 warnings and 0 errors.  (10 files)
```

Max file length: 395 lines (apify `job-lifecycle.ts`) — every file
≤ 400 (lint law).

## 5. Boundary verification (machine-tested)

```text
$ grep -rEn "from ['\"]@fleetos/" packages/integrations/{aurum,apify,vendors}/src
  (filtered per packet, own package names only)  -> CLEAN
$ grep -rEn "Date\.now|Math\.random|setTimeout|setInterval|fetch\(|new Date" \
  packages/integrations/{aurum,apify,vendors}/src   -> CLEAN
$ git status --short
  only packages/integrations/{aurum,apify,vendors}/** + docs/evidence/F250C/**
```

Zero cross-worker `@fleetos/*` imports (the three packages have no
`@fleetos` dependencies at all — their `package.json` devDependencies are
typescript + vitest only). Cross-context concepts remain LOCAL structural
types (`TenantScope`, `GuardianDecisionRefLike`, `EvidenceBundleRef`,
`VerificationEvidenceRef`) — the frozen seam pattern. NO import of
`@fleetos/vendors` (the DOMAIN package) anywhere in the adapter packages —
the adapter/domain direction is not inverted. `pnpm-lock.yaml` and
`pnpm-workspace.yaml` untouched (not in `git status`).

## 6. Contract deltas / seams for TL adjudication

1. **Index restructuring via extraction modules** (`tenant.ts` in aurum/
   vendors, `seam.ts` in apify): the Wave 1 inline tenant/Guardian
   definitions were moved verbatim into dedicated modules and re-exported
   from `src/index.ts` (`export * from ...`), following the domain
   packages' `contracts.ts` pattern. This avoids index↔module import
   cycles for the new modules. Public surface is unchanged (same exported
   names, same shapes — the original Wave 1 test files run unmodified);
   if the TL prefers, a future shared-contracts module could converge
   these three copies (and the domain packages' copies) into one place.

2. **FNV-1a 32-bit digests with `proj_/batch_/store_/sync_/recon_/
   manifest_/result_/run_/entry_/catalog_/verify_/score_` prefixes** —
   the established lane convention (evidence-grade, deterministic, no
   crypto dependency). The one deliberate SHA-256-adjacent surface is
   `isSha256Shaped` in apify (STRUCTURAL shape validation of evidence
   bundle refs only — documented as never claiming content verification).

3. **`ExternalCatalogEntry.logicalTime` vs ISO-string `observedAt`** on the
   Wave 1 `ExternalProjection` type: the new Wave 5 code takes logical
   time as an explicit epoch-`number` input; the Wave 1 record keeps its
   ISO-string field (untouched, non-destructive). Same string/number
   duality the TL already tracks from F220C §6.2.

4. **Revocation propagation split across two modules**: `revokeVerification`
   (verification.ts) returns the inert `RevocationNotice`;
   `applyRevocationToMetrics` (scorecards.ts) consumes it. Placement
   decision: the notice producer lives with the verification lifecycle,
   the metric-level consumer lives with the metric records it owns — no
   module cycle. If the TL prefers a single entry point, a small
   composition wrapper is additive.

5. **LWW tie semantics**: aurum delta-apply treats equal (source,
   logical-time, id) tuples with different content as a QUARANTINED
   conflict (never auto-resolved); vendor catalog re-import treats the
   same situation as an atomic batch refusal. Both are documented per
   module; a TL decision could unify them if a shared conflict-policy
   contract is ever wanted.

6. **Apify `ActorJobRecord` vs Wave 1 `ActorJobProposal`**: the Wave 1
   port/proposal surface is untouched; the Wave 5 lifecycle record is a
   NEW, richer type. The composing application links them (a proposal's
   Guardian decision + idempotency key feed `createActorJob` /
   `authorizeActorJob`). A future convergence could make the port return
   lifecycle records — deferred to avoid touching the Wave 1 contract.

## 7. Residual limitations (honest list)

1. **No persistence, I/O, network or daemons.** All modules are pure
   functions over value types. The "fetching" phase of a sync session is
   a state, not a network call — the composing application fetches
   batches through the Wave 1 `AurumPort` and feeds them to
   `applyFetchedBatch`.

2. **Guardian decisions are validated structurally only** (present,
   authorized=true, non-empty decisionId). Authenticity is worker B's
   context — the kernel cannot and must not verify Guardian decisions
   itself. Same seam pattern as Wave 1/F220C.

3. **Evidence-gate digests are shape-checked, not content-verified** —
   `isSha256Shaped` validates the 64-lowercase-hex form only; whether the
   bundle digest matches the remote evidence content belongs to the
   evidence context (worker B). Documented in the module header.

4. **FNV-1a 32-bit digests** — deterministic and tamper-detecting within
   this lane's threat model (accidental corruption / replay audits), not
   cryptographic. A stronger hash is a cross-cutting TL-owned swap.

5. **Rate budgets do not release units** — a window's reservations are
   permanent within the window (window-scoped budgets reset by moving to
   a new window id). No release API was required by the packet; adding
   one later is additive.

6. **`expireDueVerifications` requires the caller to pass `now`** — there
   is no automatic sweep; the composing application decides cadence.
   Pure-fold semantics make this replay-safe.

7. **`pnpm -r test` (full suite) was NOT run** — per the packet's
   memory-constrained-box rule, gates ran per-package only (6 vitest
   invocations across 3 packages). The three packages are fully
   self-contained (zero `@fleetos` imports), so cross-package breakage is
   not possible from this change set; the full-suite number is the TL's
   merge-time verification, not mine to claim.

8. **Root gates** (architecture:check, snapshot regen) NOT run — per
   packet, TL merge-time. The contract snapshot should not drift from
   this change set (no package registration changes, no dependency
   changes), but that claim is the TL's to verify.

## 8. Stop-the-line events

None on the final state. This lane was completed from an interrupted
session's uncommitted WIP; per the dispatch protocol the clean baseline
was re-verified first (37/37, typecheck ×3 exit 0), every WIP file was
individually reviewed, re-gated and completed — including ONE hardening
fix found during review (apify `verifyJobManifest` JSON.parse throw on
tampered canonical input → total `false` return, +1 test). The prior
session's transient-development-failure history is not independently
verifiable from the worktree and is therefore NOT claimed here; what is
claimed is the machine-verified record above: all gate runs on the
committed state are green on first execution.

## 9. Verification commands for TL re-run

```bash
cd /home/z/w-f250c   # (or: git fetch origin work/f250c && checkout)
# boundary:
grep -rEn "from ['\"]@fleetos/" packages/integrations/{aurum,apify,vendors}/src   # expect no matches
grep -rEn "Date\.now|Math\.random|setTimeout|setInterval|fetch\(|new Date" \
  packages/integrations/{aurum,apify,vendors}/src                                # expect no matches
# gates (per package, per packet):
for p in aurum apify vendors; do
  (cd packages/integrations/$p && corepack pnpm run test && corepack pnpm run typecheck)
done
# expect: 61 / 68 / 51 tests (180 lane total), typecheck exit 0 ×3
# optional self-check:
for p in aurum apify vendors; do (cd packages/integrations/$p && corepack pnpm run lint); done
# expect 0 warnings / 0 errors each
```
