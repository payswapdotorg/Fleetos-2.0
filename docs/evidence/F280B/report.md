# F280B — Worker B (Safety + Intelligence) Security/Audit/Replay/DR Hardening Evidence

- **Work item:** F280B — security, audit, replay, disaster recovery (Wave 8 lane B; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker B (safety-and-intelligence)
- **Base commit:** `fb13b94` ("TL: dispatch packets for Wave 8 — production hardening lanes F280A/B/C", origin/main HEAD — verified with `git log --oneline -1` before branching)
- **Branch:** `work/f280b` (created from `origin/main` HEAD)
- **Packet:** `docs/tech-lead/packets/f280b.md`

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-b grants) — ONLY lane packages + this evidence dir:

- `packages/security/**` — NEW `src/audit-ledger.ts` (338 lines), NEW `src/finding-storms.ts` (319), `src/index.ts` (+3), `package.json` (exports `./audit-ledger`, `./finding-storms`); NEW tests `tests/audit-ledger.test.ts` (16), `tests/finding-storms.test.ts` (15).
- `packages/execution/**` — NEW `src/incident-audit.ts` (189), NEW `src/incident-replay.ts` (260), `src/index.ts` (+5), `package.json` (exports + NEW intra-lane deps `@fleetos/actions`, `@fleetos/security`, public entry points only — decision D-1 below); NEW tests `tests/incident-audit.test.ts` (14), `tests/incident-replay.test.ts` (14).
- `packages/policy/**` — NEW `src/capability-store.ts` (307), NEW `src/capability-store-dr.ts` (221), `src/index.ts` (+4), `package.json` (exports `./capability-store`, `./capability-store-dr`); NEW tests `tests/capability-store.test.ts` (19).
- `packages/simulation/**` — NEW `src/benchmark-integrity.ts` (267), `src/index.ts` (+4), `package.json` (exports `./benchmark-integrity`); NEW tests `tests/benchmark-integrity.test.ts` (12).
- `packages/predictive/**` — NEW `src/staleness-propagation.ts` (184), `src/index.ts` (+4), `package.json` (exports `./staleness-propagation`); NEW tests `tests/staleness-propagation.test.ts` (13).
- `packages/experiences/safety-intel/**` — NEW `src/staleness-cards.ts` (165), `src/index.ts` (+4), `package.json` (exports `./staleness-cards`); NEW tests `tests/staleness-cards.test.ts` (9).
- `docs/evidence/F280B/**` (this report).
- `pnpm-lock.yaml` — COMMITTED this time: the diff is exactly the two new `packages/execution` workspace dependency edges (6 lines, no other churn) — unlike the F270B filtered-install mutation, this change is semantic and belongs with the commit.

Untouched: actions, evidence, world-model, world-context, learning, integrations/arena (re-run green after the last edit, §2). No spec edits, no other lane's paths, no new top-level packages, no new runtime deps (vitest/typescript devDeps unchanged).

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

BEFORE (at `fb13b94`, before any edit) — identical counts to F270B §2:

```text
security 5/116   policy 5/112   actions 4/73    execution 6/90
evidence 3/82    predictive 3/61  world-model 3/42  world-context 3/34
learning 5/78    simulation 7/91  arena 7/94     safety-intel 5/104
acceptance/security 4/90        acceptance/adoption 7/90
```

AFTER (last edit; full test+typecheck+lint per package, all green):

```text
security 7/147   policy 6/131   actions 4/73    execution 8/118
evidence 3/82    predictive 4/74  world-model 3/42  world-context 3/34
learning 5/78    simulation 8/103  arena 7/94     safety-intel 6/113
acceptance/security 4/90        acceptance/adoption 7/90
```

**Wave-7 baselines preserved: security 90 (incl. the F270B journey corpus inside those 90), adoption 90 — both green before AND after.** Lane total 977 → 1089.

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

### 3.1 D1 — Immutable audit trail hardening (`security` + `execution`)

- `security/src/audit-ledger.ts` — the dependency-free tamper-evident engine: append-only, hash-chained `AuditLedgerEvent`s over the fixed surface vocabulary `guardian.evaluation | action.emission | execution.entry`; payload sealed content-addressedly (canonical JSON + FNV-1a — the caller cannot smuggle a pre-digested payload); `verifyAuditLedger` checks sequence continuity → tenant consistency → previous-digest linkage → payload digest → chain digest.
- **Documented GAP-DETECTION semantics:** a removed interior entry fails with `reason: "audit.gap"`, `gapAt: <removed position>` (the sequence jump names the missing entry's position precisely); a rewound sequence reports `audit.sequence-regressed`. **HONEST LIMIT:** tail truncation (removing the final entry) is inherently invisible to an unanchored hash chain — `sealAuditLedgerHead` + `verifyAuditLedgerAgainstAnchor` close it with an externally persisted head anchor (machine-tested: unanchored verify passes a truncated tail, the anchor check fails it).
- `execution/src/incident-audit.ts` — REAL-surface sealers: `sealGuardianEvaluation` (REAL `DecisionRecord` — verdict/reason/rule/decisionDigest/recordDigest), `sealActionEmission` (REAL `ActionAuditEvent` — kind/states/transitionDigest), `sealExecutionLedgerEntry` (REAL `ExecutionLedgerEntry` — its own `entryDigest` chains INTO the audit chain, nested tamper-evidence) + `buildIncidentAuditTrail` (canonical assembly order `(occurredAt, surface rank, subjectId)` — input order never leaks, machine-tested) — all under one tenant (A8: cross-tenant inputs refuse naming the offender surface+subject).

### 3.2 D2 — Replay / forensics hardening (`execution`)

- `execution/src/incident-replay.ts` — `replayIncident({tenantId, ledger, journal})`: merges the REAL execution ledger + REAL action-audit journal into a canonical timeline `(at, source rank, subject, kind)` with per-step digests (`decisionSequence`) and a whole-replay digest; the per-command view reuses the REAL `replayExecutionLedger` verbatim (ledger entries canonically ordered by their RECORDED index — a reordered copy replays identically). **Byte-identical re-replay** machine-tested (`verifyIncidentReplayDeterminism` + permutation tests). **Divergence detection:** `diffIncidentReplays(recorded, replayed)` pins the FIRST divergent entry with the field class (`at | source | subject | kind | step-digest | timeline-length`) and both values — machine-tested over a tampered journal kind, a dropped ledger entry, a shifted timestamp, and a swapped tail kind. Structural inconsistency surfaces the REAL refusal (`replay.ledger-refused` / `ledger.index_gap`).

### 3.3 D3 — Disaster recovery semantics (`policy`)

- `policy/src/capability-store.ts` — tenant-scoped store composing the REAL surfaces: enrolled `Policy`/`Capability` + grants through the REAL `issueGrant`/`revokeGrant`/`verifyGrantChain` + the REAL Guardian `evaluateCapability`. `decideCapability` composes Guardian verdict × grant gate into the allow/deny/escalate trichotomy (Guardian BLOCK → deny; REQUIRE_APPROVAL → escalate; ALLOW/WARN → valid-grant allow, grantless escalate `require_approval.no_grant`, REVOKED grant → deny `grant.revoked`).
- `policy/src/capability-store-dr.ts` — the DR protocol: `snapshotCapabilityStore` (content-addressed, FNV-1a over canonical state, `sealedAt` explicit) + `restoreCapabilityStore` (digest must recompute — tampered snapshot refuses `store.snapshot-digest-mismatch`; the append-only TOMBSTONE log replays OVER the snapshot). **REVOCATION PERMANENCE:** pre-snapshot revocations survive restore (tombstones are in the snapshot), post-snapshot revocations survive restore (tombstone-log replay) — machine-tested both ways, including propagation (derived grants stay revoked). **SNAPSHOT EQUIVALENCE LAW:** `verifySnapshotEquivalence(original, restored, corpus)` — every corpus case must decide byte-identically (verdict, reason, outcome, grantId); the divergence detector pins the first divergent case.

### 3.4 D4 — Security finding pipeline hardening (`security`)

- `security/src/finding-storms.ts` — built ON the REAL intake primitives (unchanged): `dedupeFindingStorm` (survivor set invariant under EVERY arrival permutation — machine-tested over all fixed permutations; duplicate acks name the surviving finding id; invalid candidates keep their REAL validation codes), `correlateFindingStorm` (groups keyed by the REAL correlation key, canonically ordered, members by (detectedAt, findingId) — insert-order stable, machine-tested; repeat-pressure escalation via the REAL stepwise `escalateSeverity` with window discipline), `buildStormTriageQueue` (bounded; over-bound REFUSES `triage.queue-overflow` with exact received/limit counts — never silently truncates; cross-tenant finding refuses `storm.tenant-mismatch` naming the offender), `runStormIntake` (the full pipeline; the queue carries the group-escalated severity — the storm's honest aggregate view).

### 3.5 D5 — Benchmark/predictive hardening (`simulation` + `predictive` + `safety-intel`)

- `simulation/src/benchmark-integrity.ts` — positioned, fail-loud benchmark verification (the boolean `verifyBenchmarkSetDigest` is untouched): six layers — set-manifest shape (addition/removal with both counts), per-case manifest row, per-case content digest recompute, per-case STRUCTURAL re-derivations (tenant-vs-journal law; expected-outcome atMs = journal at + step×stepMs law), set-manifest model-versions re-derivation, set-digest recompute — each failure names `level`, `caseIndex`, `caseId`, `component`, `detail`. Machine-tested over every tamper form (edited envelope, edited manifest row, removed case, edited outcome time, edited assembledAtMs, edited model versions, cross-tenant smuggled case).
- `predictive/src/staleness-propagation.ts` — the no-re-scoring aggregator: `ClassifiedInput`s (classified ONCE upstream by the world-model's REAL `classifyStaleness`) → worst-of headline (unknown > stale > fresh), canonical input order, propagation digest, machine-carried `rescored: false`. **Structurally clock-free** — there is no now anywhere in the module. `verifyStalenessPropagation` fails a FORGED headline (a "fresh" stamp over stale inputs) and digest tamper.
- `experiences/safety-intel/src/staleness-cards.ts` — the chain's end: `buildPropagatedStalenessAdvisoryCard` surfaces the propagated class verbatim in the card output (`staleness`, `ageMs` at classification time, `stalenessSource.rescored: false`). **The builder takes NO clock parameter — the structural no-re-scoring proof** (machine-tested: an input classified "fresh" whose naive re-score at a later logical now would say "unknown" still renders "fresh"). Advisory law A2 enforced with the sibling module's four mechanisms; the propagation integrity gate refuses forged propagations before they reach a card.

### 3.6 D6 — Tenant isolation hardening

Cross-tenant fail-closed probes with reason codes ASSERTED for every NEW code path (all machine-tested):

```text
audit-ledger      audit.tenant-mismatch (append into a foreign chain)
incident-audit    trail.tenant-mismatch ×3 (decision / emission / entry, offender named)
incident-replay   replay.tenant-mismatch ×2 (ledger#<index> / journal:<eventId>)
capability-store  store.tenant-mismatch (enroll / grant-issue / restore-log) +
                  REAL Guardian block.cross_tenant surfacing on cross-tenant decisions
finding-storms    storm.tenant-mismatch (offender findingId + tenant named)
benchmark-integrity case-structure/tenant tamper (offender case + both tenants named)
staleness chain   staleness.tenant-mismatch (offender ref) + card.tenant-mismatch
```

## 4. Test accounting — 112 net-new (packet floor ≥ 60)

```text
security    audit-ledger 16 + finding-storms 15            = +31  (116 → 147)
execution   incident-audit 14 + incident-replay 14         = +28  (90  → 118)
policy      capability-store 19 (incl. DR + permanence)    = +19  (112 → 131)
simulation  benchmark-integrity 12                         = +12  (91  → 103)
predictive  staleness-propagation 13                       = +13  (61  → 74)
safety-intel staleness-cards 9                             = +9   (104 → 113)
                                                            +112 total
```

Every test was run and passed in this session (HONESTY LAW) — exact outputs in §5/§2.

## 5. Gates (exact commands + outputs, in each touched package dir)

All six touched packages (and the six untouched lane packages + both acceptance packages re-verified after the last edit):

```text
corepack pnpm run test
  security: Tests 147 passed (147)   policy: Tests 131 passed (131)
  execution: Tests 118 passed (118)  simulation: Tests 103 passed (103)
  predictive: Tests 74 passed (74)   safety-intel: Tests 113 passed (113)
  (untouched, re-verified: actions 73, evidence 82, world-model 42,
   world-context 34, learning 78, arena 94 — all passed)
  (baselines: acceptance/security 90 passed (90), acceptance/adoption 90 passed (90))
corepack pnpm run typecheck   # exit 0 in every package above (tsc --noEmit, no output)
corepack pnpm run lint        # "Found 0 warnings and 0 errors." in every package above
```

Purity scan clean (no `Date.now`/`Math.random`/network/timers in the new modules — `new Date(iso).getTime()` for deterministic ISO parsing follows the existing world-context convention). File law: largest new file 338 raw lines (all ≤ 400 raw AND ≤ 400 lint-effective). Import law: new cross-package imports are intra-lane, public entry points only (`@fleetos/security`, `@fleetos/actions` roots from execution).

## 6. Decisions + seam findings (TL-relevant)

- **D-1 (new intra-lane dependency edges):** `execution` now depends on `@fleetos/actions` and `@fleetos/security` (public entry points only; acyclic; follows the existing actions→policy / execution→policy / safety-intel→all precedent). The unified audit trail needs all three REAL surfaces in one module; execution is the lane's natural composition point (policy → action → execution is the architecture's core flow). Flagged for TL adjudication since DEPENDENCY-GRAPH.md (TL-owned) doesn't enumerate intra-lane edges.
- **S1 — audit-ledger digest strength:** FNV-1a 32-bit (the lane's established audit-digest convention — execution ledger, transition digests). Tamper-EVIDENCE comes from the chain + content addressing; a stronger digest port is a TL hoisting decision (same family as the F270B S2 finding — the canonical-home question).
- **S2 — grant-gate composition semantics:** `decideCapability`'s ALLOW-without-grant → escalate (`require_approval.no_grant`) is a NEW store-level composition on top of the REAL Guardian verdict (the Guardian itself does not consult grants). Documented in-module; TL may want this adjudicated against the A5 authority boundary when composing the real runtime.
- **S3 — `verifyBenchmarkCaseIntegrity` synthetic view:** the per-case variant wraps the case in a single-case set view; its set-digest layer is skipped by construction (the synthetic digest is never genuine). The SET-level verifier is the complete one.
- **S4 — replay accepts reordered ledger copies by recorded index:** canonical-order-by-index means a hand-shuffled copy of the same entries replays identically. This is A14-aligned (the index is the authoritative sequence) but differs from the REAL `replayExecutionLedger`'s array-order strictness — surfaced verbatim when entries are structurally inconsistent.
- **S5 — advisory-cards' existing builders still re-classify staleness at card time** (classifyStaleness inside buildPredictionAdvisoryCard/buildWorldContextAdvisoryCard). My propagated-staleness card is the NEW no-re-scoring path; unifying the two card paths is TL composition. No existing behavior was touched (no regression risk).

## 7. Honest residuals

- All state is caller-threaded in-memory; binding the audit trail / DR protocol to persisted stores (PostgreSQL, object storage) is TL composition — the modules are the pure reference path (law A12).
- The audit ledger's tail-truncation detection requires the caller to persist the head anchor externally (e.g. seal it into an evidence bundle) — the anchor API exists and is tested, the composition is not built here.
- The storm pipeline's triage-queue escalation is the GROUP-aggregate view (all members of an escalated group enter the queue at the escalated severity); the per-occurrence stepwise view remains the intake pipeline's — both are deterministic and machine-tested.
- `pnpm -r test` (full monorepo) NOT run — TL merge-time gate per packet; the twelve lane packages + both acceptance packages were machine re-run instead (§2/§5).
- The worklog entry for Task ID 9-b is appended to the session worklog (`/home/z/my-project/worklog.md`).

## 8. TL re-run commands

```bash
git checkout work/f280b   # at the pushed commit
corepack pnpm install --filter @fleetos/execution... --filter @fleetos/acceptance-security... --filter @fleetos/acceptance-adoption... --prefer-offline --ignore-scripts  # only if needed
cd packages/security   && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd packages/execution  && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd packages/policy     && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd packages/simulation && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd packages/predictive && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd ../experiences/safety-intel && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd ../../acceptance/security  && corepack pnpm run test   # 90 — Wave-7 baseline
cd ../adoption                && corepack pnpm run test   # 90 — Wave-7 baseline
```
