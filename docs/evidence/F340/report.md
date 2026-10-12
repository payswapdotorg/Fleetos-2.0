# F340 — Wave-14 preflight: the small-firm remainder freeze

- **Work item:** F340 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 14).
- **Owner:** TL. **Date:** 2026-10-13 (post-Wave-13 convergence `15a4f4b`; base
  = main HEAD at freeze).
- **Mission:** freeze the Wave-14 remainder-mining law BEFORE any lane
  dispatch — the same preflight discipline as F320/F330. Wave 14 mines the
  F310C §3.6 row-42 families for genuinely distinct single journeys to close
  the small-firm gap (B-3 per F330 §3: small fully-applicable firms at 94,
  residual 6).

## 1. Machine-measured census (this freeze's ground truth; run at `15a4f4b`)

The row-42 families, verified against the tree (API existence + corpus
coverage grep):

| family | package/API (verified exports) | corpus status | verdict |
|---|---|---|---|
| observations ingestion-limits | `packages/observations/src/ingestion-limits.ts` | COVERED — `ingestion-limits-admission-discipline` (F321A) | closed |
| observations backpressure | `packages/observations/src/backpressure.ts` (OverflowPolicy refuse/shed-oldest, BackpressurePolicy, QueueState, EnqueueDecision, BackpressureLevel ok/warn/critical) | NO journey exercises it (grep: zero matches in acceptance/field) | **CANDIDATE A1** |
| observations retention/projection | `packages/observations/src/retention.ts` (ImmutableObservationStore, InMemoryImmutableStore, buildDeviceSummary + projections) | NO journey exercises it | **CANDIDATE A2** |
| journal compaction | `packages/connectivity/src/intent-journal.ts` — NO compaction/segment/trim API exists | — | NOT remainder (new capability if ever built) |
| command storm guard | grep storm/flood/burst in connectivity: NO API exists | — | NOT remainder (new capability) |
| sim-worlds checkpoint/resume | `packages/sim-worlds/src/world-engine.ts` ("a run resumed from a checkpoint is byte-identical" — the determinism guarantee is in the engine) | incidental matches only (mission-mirror/cross context — no distinct journey) | **CANDIDATE A3** |
| evidence artifact store | `packages/evidence/src/artifact-store.ts` (ArtifactStorePort, InMemoryArtifactStore, verifyBundleCompleteness, assembleBundle) | NO journey in acceptance/security exercises it (grep: zero) | **CANDIDATE B1** |
| posture-fold determinism | — | COVERED — `security.posture-fold-determinism` (F321B) | closed |
| world-context windowing | `packages/world-context/src/windowing.ts` (projectWindowedWorkload, projectWindowedProject, isObservationMature, filterMatureObservations) | staleness-window assertions exist (reasoning.ts) but WINDOWING (context assembly windows) is NOT exercised — distinct semantics | **CANDIDATE B2** |
| simulation replay/benchmark | `packages/simulation/src/*` | COVERED — `benchmark-trust`, `mission-replay` (F321B era) | closed |
| store-and-forward / offline-buffer | connectivity offline-buffer + storeforward ops | COVERED — `store-and-forward-redelivery` (F321A) | closed |

**Census result: 5 verified candidates** (A1 backpressure, A2
retention/projection, A3 sim-worlds checkpoint determinism, B1 evidence
artifact-store, B2 world-context windowing). Journal compaction and command
storm guard have NO API surface today — they are new-capability items
(F310C §3.5 class), NOT remainder mining; mining them would violate the
no-fabrication law.

## 2. The Wave-14 count law (frozen)

1. **D14 (journey form):** every new journey follows the standing corpus
   laws — unique ID, real domain public entry points (the verified APIs
   above), ≥5 substantive assertions incl. positive/negative/refusal/
   provenance where applicable, deterministic rerun (byte-identity),
   no mask broadening, ≥1 refusal asserted.
2. **D15 (applicability):** the five candidates are fleet-universal
   mechanics — journeys are created fully-applicable ONLY if their domain
   is genuinely universal (queueing, storage, determinism, evidence,
   context windows apply to every industry); any narrower claim must
   narrow the mask with evidence, never broaden.
3. **D16 (no fabrication):** if a candidate family turns out to be
   already-covered by an existing journey's semantics at execution time
   (a false census negative), the lane records the honest finding and the
   journey is NOT delivered — the count only grows on genuine coverage.
4. **D17 (sixth-slot mining):** during execution, a worker MAY propose ONE
   additional journey from a genuinely unexercised public API in its OWNED
   paths only, with the same census evidence (API exists + zero corpus
   coverage), cited in the lane report; the TL gates it at merge. No
   speculative capability inflation (rows 37/38/40/41 remain out of
   scope; the count-honesty law is absolute).
5. **Epoch law carryover:** D7–D13 stand unchanged. Wave-14 journeys are
   single-epoch (T0) unless a candidate genuinely responds at frozen
   anchors (unlikely for these mechanics; any per-epoch claim requires the
   D10 proof + census — default is single-count).
6. **Pins:** TL re-pins at F342 convergence only (the standing
   TL-owned-transition rule); lanes run grow-only vs base.

## 3. Honest arithmetic at freeze

- Fully-applicable industries (zero masks): manufacturing, energy-utilities
  (machine-verified at F332 §4 per-firm table). Their small firms: **94**.
- All 5 candidates landing fully-applicable: small firms reach **99**
  (94+5) — ONE short of 100. With a D17 sixth slot: **100** — B-3 closes
  for fully-applicable firms (medium/large already closed at 102-110).
- The wave verdict at F342 states exactly which landed; if 5, the release
  stays NOT READY with a named 1-journey remainder. NOT fabricated.

## 4. Lane contracts (frozen)

### F341A — worker A (edge-and-asset): 3 journeys
A1 `observations-backpressure-discipline` (queue states, shed-oldest vs
refuse, level transitions, honest refusal); A2 `observations-retention-
projections` (immutable store semantics, device-summary projection,
retention boundaries); A3 `sim-worlds-checkpoint-determinism` (checkpoint,
resume, byte-identical resumed run, the engine's own guarantee exercised).
Owned paths: `packages/acceptance/field/**` + the A-owned domain packages'
existing APIs (NO domain package changes — journeys only, unless a test
fixture requires an export already present).

### F341B — worker B (safety-and-intelligence): 2 journeys
B1 `evidence-artifact-store-completeness` (port contract, bundle assembly,
completeness verification, refusal on incomplete); B2 `world-context-
windowing` (windowed workload/project projections, observation maturity,
filter semantics). Owned paths: `packages/acceptance/security/**` same rule.

### F342 — TL convergence
Recount the 30-workspace ledger; re-pin; full gate battery at the converged
tree; the honest verdict per §3. TL-owned.

## 5. Boundary (strict)

Lanes touch ONLY their acceptance corpus packages (+ lane evidence dirs +
the catalog one-liner). No adoption/release/pin files (TL-owned). No
domain-package behavior changes. File law ≤400 lines per new file.
