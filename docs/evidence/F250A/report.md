# F250A — Worker A (Edge + Asset) Wave 5 Adapter Lane Completion Evidence

- **Work item:** F250A — ADCOS + connectivity adapters at operational-truth grade (Wave 5 lane A)
- **Owner:** Worker A (edge-and-asset)
- **Base commit:** `15289ec` (TL dispatch: Wave 5 packets; main carries all Wave 0–4 work — 2937 tests at dispatch)
- **Branch:** `work/f250a` (worktree `/home/z/w-f250a`)
- **Date:** 2026-10-08

## Provenance note (honest)

The worktree contained **uncommitted WIP from a prior interrupted F250A session**
(no commit, no push, no worklog entry existed). This lane therefore: (1) machine-verified
the TRUE baseline at HEAD `15289ec` FIRST (WIP stashed away — see §2); (2) line-by-line
reviewed every inherited file against the packet; (3) completed the unfinished work —
the connectivity journal split was half-done (`intent-journal.ts` existed but
`intent-registry.ts` still carried a full duplicate of the journal and stood at 483
lines, over the 400-line law); (4) added missing packet-named coverage (reconciliation
digest tamper). Every test counted below was run by this session.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-a):

- `packages/integrations/adcos/**` — NEW: `command-journal.ts`, `command-lifecycle.ts`, `session-trust.ts`, `session-journal.ts`, `session-registry.ts`, `reconciliation.ts`, `health.ts` (+ 4 test files); `src/index.ts` +7 export lines
- `packages/connectivity/**` — NEW: `intent-lifecycle.ts`, `intent-journal.ts`, `intent-registry.ts`, `posture-rollup.ts` (+ 3 test files); `src/index.ts` +4 export lines
- `docs/evidence/F250A/**` (granted carve-out)

`git status` shows nothing outside these paths; no pnpm-lock.yaml / pnpm-workspace.yaml
mutations; no spec edits; no snapshot regen; `main` untouched.

## 2. Baselines re-verified BEFORE the first edit (machine-run, at HEAD)

WIP stashed (`git stash push -u`), both suites run at clean HEAD `15289ec`, then WIP restored:

```text
packages/integrations/adcos: Test Files 4 passed (4) / Tests 82 passed (82)   (packet: 82 ✓)
packages/connectivity:      Test Files 4 passed (4) / Tests 79 passed (79)   (packet: 79 ✓)
```

## 3. Deliverables (all pure deterministic TS; logical `now` + caller-supplied inputs everywhere)

### 3.1 `@fleetos/adcos` — command lifecycle + session registry + reconciliation + health

- **`command-journal.ts` (397 lines)** — the append-only dispatch journal: 8 typed event
  kinds (`issued`, `dispatched`, `dispatch-failed`, `acknowledged`, `resulted`,
  `reconciled`, `expired`, `dead-lettered`); state is a PURE FOLD (`applyCommandEvent`
  — out-of-order seq ignored); checkpoints (`checkpointCommandJournal` /
  `resumeCommandJournal` — suffix-only resume); **chained audit digests**
  (`chainedAuditDigest` covers the previous digest + event identity → tamper-evident);
  `verifyCommandJournal` replays legality (`LEGAL_PRIOR_PHASES`) + the chain.
- **`command-lifecycle.ts` (390 lines)** — the lifecycle machine over the journal:
  `issue → dispatch → ack → result → reconcile` + `expired`/`dead-letter` terminal
  paths. Idempotency-key dedup at issue (tenant-scoped, `duplicate=true` no-op);
  tenant fail-closed lookups (cross-tenant == `unknown-command`); deadline expiry
  sweep (deterministic commandId order); the deterministic backoff ladder reuses the
  F230A seams (`EdgeAdcosRetryPolicy` + `computeBackoffMs` — `backoffLadder(policy,
  class)`; permanent short-circuits to dead-letter, transient exhaustion dead-letters);
  refusal codes EXTEND `AdcosRejectionCode` (7 new lifecycle codes, no meaning
  duplicates).
- **`session-trust.ts` (128 lines)** — LOCAL STRUCTURAL mirror of the F230A trust
  ladder (`untrusted | low | standard | elevated`; low cannot `execute-routine`);
  evidence requirements per TARGET level (attestation / +behavior-record /
  +operator-authorization); downward transitions require a reason. No `apps/agent`
  import (verified by grep, §5).
- **`session-journal.ts` (219 lines) + `session-registry.ts` (292 lines)** —
  connection sessions as an event fold: enroll (trust-gated — `untrusted` refused;
  nonce-deduped, idempotent), heartbeat (posture fold: enrolled starts `degraded`,
  fresh heartbeat → `connected`, stale-gap → `degraded`, dead-gap → `offline` —
  F230A law "enrolled ≠ connected"), `expireSessions` sweep (deterministic sessionId
  order, per-session TTL classification `fresh|stale|expired`), `adjustSessionTrust`
  (evidence/reason gated), `revokeSession` (reason required, terminal); tenant
  fail-closed lookups; deterministic (enrolledAt, sessionId) listings.
- **`reconciliation.ts` (268 lines)** — deterministic set-diff by id + digest between
  adapter-observed and twin-authoritative records; classified outputs
  (`in-sync`/`adapter-ahead`/`twin-ahead`/`conflict` + overall outcome — mutual
  divergence is `conflict`); twin-authoritative resolution (conflict → adopt-twin,
  adapter-only → drop-adapter — the twin's omission is authoritative, F230A law;
  twin-only → adopt); `verifyReconciliationDiff` digest tamper detection;
  `verifyReconciliation` post-condition; fail-closed on cross-tenant adapter record
  (whole call refuses), invalid now, missing/duplicate ids or digests.
- **`health.ts` (335 lines)** — adapter health rollup: windowed command outcomes
  (integer-bps failure ratio, floored) + session expiry summary + posture signals
  (structural mirror — no connectivity import) + circuit state →
  `healthy | degraded | unavailable` with deterministic ordered reason codes; honest
  `no-observations` (never healthy without evidence); **deterministic circuit**
  (`closed | open | half-open`) driven ONLY by logical time + observed outcomes
  (`foldAdapterCircuit` per-outcome, `evaluateAdapterCircuit` open→half-open after
  cooldown, failed probe reopens, `circuitDispatchDecision` fail-closed while open);
  digest + audit + `verifyAdapterHealthReport`.

### 3.2 `@fleetos/connectivity` — intent lifecycle + registry + posture rollups

- **`intent-lifecycle.ts` (286 lines)** — `proposed → authorized → active → suspended
  → terminated` (+ `withdraw` from proposed, `resume` from suspended). **Guardian law:
  authorization is an INPUT, never minted** — `authorize` requires BOTH a caller-supplied
  `IntentPolicyCeiling` with effect `allow` (a ceiling is necessary, never sufficient;
  `deny` refuses with `policy-denied` even WITH a grant) AND a caller-supplied
  `AuthorizationGrant` (absent → `authorization-required`; expired vs logical now →
  `stale-authorization`; malformed/future → `invalid-grant`). Idempotency:
  re-applying a completed transition is `already-in-state`. Consequential transitions
  (suspend/terminate/withdraw) require a reason. Staleness classification:
  `fresh | stale | unknown` (unknown ≠ fresh) + `isAuthorizationStale`.
- **`intent-journal.ts` (219 lines)** — append-only journal (proposed / transitioned /
  superseded), pure fold + checkpoint/resume, per-event audit refs.
- **`intent-registry.ts` (316 lines)** — registry operations over the journal:
  `proposeIntent` (validated, tenant-scoped idempotency-key dedup, content-addressed
  deterministic intentId); `transitionRegistryIntent` (consults the lifecycle machine —
  the Guardian law is enforced end-to-end); `supersedeIntent` (non-active predecessors
  only; successor linked bidirectionally; PROVENANCE actor+reason+at required);
  `byDevice` index (tenant|device → intentIds); fail-closed cross-tenant lookups
  (== `unknown-intent`); deterministic (deviceId, proposedAt, intentId) ordering;
  `activeIntentForDevice`.
- **`posture-rollup.ts` (199 lines)** — asset + fleet rollups from the intent registry
  + observed status records via the F220A `honestPosture` law: desired comes from
  the ACTIVE intent only (suspended/terminated → `none`); absent record → `unknown`
  (never coerced online); alignment `aligned | divergent | unknown` (unknown whenever
  either side is unknown — degraded-honest); fleet aggregation with exact integer
  counters, deviceId-sorted assets, latest-record-wins dedup, tenant fail-closed
  record scoping; digest + `verifyFleetPostureDigest` tamper detection.

## 4. Tests (7 new files, 102 net-new)

| Package | New file | New tests |
| --- | --- | --- |
| @fleetos/adcos | `command-lifecycle.test.ts` | 17 |
| @fleetos/adcos | `session-registry.test.ts` | 18 |
| @fleetos/adcos | `reconciliation.test.ts` | 11 |
| @fleetos/adcos | `health.test.ts` | 15 |
| @fleetos/connectivity | `intent-lifecycle.test.ts` | 16 |
| @fleetos/connectivity | `intent-registry.test.ts` | 13 |
| @fleetos/connectivity | `posture-rollup.test.ts` | 12 |
| **total** | | **102** (adcos 61 ≥ 40 ✓, connectivity 41 ≥ 25 ✓) |

Themes (packet checklist, all machine-tested): idempotent re-issue / re-propose /
re-enroll (duplicate=true, no new event); fold replay == state (byte-identical
records, adcos both journals + connectivity registry); checkpoint resume == full
fold; tenant mismatch fail-closed (cross-tenant commandId == unknown-command;
session/intent lookups identical refusals; reconciliation tenant-mismatch refuses
the whole call); trust gating (untrusted cannot enroll; low cannot execute-routine;
upward needs evidence kinds, downward needs reason); reconciliation all four
classes in one diff + twin-authoritative resolution + digest tamper; health
transitions (healthy/degraded/unavailable, integer-bps thresholds, logical
windowing, honest no-observations); circuit state machine (open on Nth failure,
cooldown half-open, probe close/reopen, fail-closed dispatch); backoff ladder
determinism ([100,200,400], cap at maxDelayMs, permanent = []); lifecycle legal/
illegal transitions + already-in-state idempotency; staleness boundaries
(299_999/300_000/3_600_000); rollup determinism (input order independence, digest
stability) + digest tamper; supersede provenance + not-supersedeable; expired/
dead-letter terminal paths (deadline sweep ordering, permanent short-circuit,
transient exhaustion).

## 5. Exact gate outputs (package dir, per packet)

```text
ADDCOS  corepack pnpm run test        → Test Files 8 passed (8) / Tests 143 passed (143)
ADDCOS  corepack pnpm run typecheck   → exit code 0 (no diagnostics)
ADDCOS  corepack pnpm run lint        → Found 0 warnings and 0 errors (20 files)
CONN    corepack pnpm run test        → Test Files 7 passed (7) / Tests 120 passed (120)
CONN    corepack pnpm run typecheck   → exit code 0 (no diagnostics)
CONN    corepack pnpm run lint        → Found 0 warnings and 0 errors (16 files)
```

Post-edit baselines re-verified (last edit after all changes): 82 + 61 = 143;
79 + 41 = 120 — pre-existing suites untouched and green (Wave-1 test files
run UNMODIFIED).

Boundary self-check (packet command, ripgrep form):

```text
rg "from ['\"]@fleetos/" packages/integrations/adcos/src packages/connectivity/src
  → no matches (CLEAN — zero cross-lane @fleetos imports, incl. no @fleetos/agent)
rg "apps/agent|@fleetos/agent" (both src trees) → comments only, zero imports
```

Determinism sweep: no `Date.now` / `Math.random` / `setTimeout` / `setInterval` /
`fetch(` / `new Date` / `performance.now` in the 11 new source files or 7 new test
files (CLEAN; the F230A `edge-adapter.ts` baseline keeps its injectable default
sleeper, unchanged). Line-count law: max file 397 lines ≤ 400 (all others ≤ 390).

## 6. Contract deltas + seam findings for TL adjudication

- **S1 — trust-ladder structural mirror (packet's named seam):**
  `session-trust.ts` mirrors `apps/agent/src/trust-ladder.ts` (levels, capability
  grants, evidence requirements, downward-reason) as LOCAL structural types —
  cross-package import is forbidden. Identical semantics are machine-tested on my
  side; symbol-level equivalence with the canonical ladder is TL test-time
  composition. Converging the two definitions (or hoisting the ladder to a shared
  contract) is a TL decision.
- **S2 — intent policy vocabulary (`IntentPolicyCeiling`):** structural subset of the
  baseline `ConnectivityDecision` (`effect`, `reason`, optional
  `matchedRulePriority` vs `matchedRule`). `authorize` consumes the ceiling +
  `AuthorizationGrant` as INPUTS; the ceiling is explicitly a ceiling, not an
  authorization. If the TL prefers the registry to consume `evaluateIntent`'s real
  `ConnectivityDecision` directly, it is a one-type change at `transitionRegistryIntent`.
- **S3 — intent records are device-scoped** (no ADCOS-session correlation field).
  The registry indexes by `tenant|device` ("asset"); an intent↔session linkage would
  be a cross-package contract (adcos owns sessions) — flagged, not invented here.
- **S4 — session journal audit digests are deterministic per-event** (tenant,
  sessionId, kind, seq, at) but NOT chained like the command journal's
  (`chainedAuditDigest`); the packet's chaining requirement named the command
  dispatch journal specifically. TL may want chaining unified.
- **S5 — reconciliation operates on `(id, digest)` pairs** — generic over
  sessions/commands; the mapping from `AdcosCommandRecord`/`SessionRecord` to
  `ReconcileRecord` digests is caller composition (no canonical per-record digest
  exists yet in the baselines).
- **S6 — expired-deadline vs `command-expired`:** dispatch/ack past `expiresAt`
  refuse immediately (`command-expired`) in addition to the sweep path.

## 7. Honest residuals

- All state is caller-threaded pure values; no persistence, no runtime wiring —
  binding journals/registries to stores and real ADCOS transport is TL composition.
- `verifyAdapterHealthReport` / `verifyReconciliationDiff` /
  `verifyFleetPostureDigest` recompute from each artifact's own fields
  (tamper-evident), not a full re-derivation from source inputs.
- Identifier digests (commandId, sessionId, intentId) use FNV-1a 32-bit (lane
  convention); journal/audit/diff/rollup digests use sha-256 via `node:crypto`
  (baseline convention).
- Circuit "open + success" closes immediately (a success while open is treated as
  a valid probe result); some circuit-breaker flavors ignore outcomes until
  half-open. One-line policy choice if the TL disagrees.
- Root gates + full-suite `pnpm -r test` NOT run (TL merge-time gate per packet).
- The prior-session WIP provenance (§ note at top): the WIP was reviewed and
  completed by this session; nothing was committed unreviewed.

## 8. TL re-run commands

```bash
cd /home/z/w-f250a
corepack pnpm install --filter @fleetos/adcos --filter @fleetos/connectivity --prefer-offline --ignore-scripts  # only if needed
cd packages/integrations/adcos  && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd ../../connectivity           && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
```
