# F341B — Wave-14 lane B: the two security remainder journeys

- **Work item:** F341B (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 14; the
  F340 §4 lane contract; packet `docs/tech-lead/packets/f341b.md` — the
  binding lane contract).
- **Worker:** B (safety-and-intelligence). **Date:** 2026-10-13.
- **Base:** `5c2ba68` (main HEAD at clone — NEWER than the task brief's
  `81be8e7`: it carries the F341A merge `8268897` and the F342 pre-staged
  packet; recorded per the base-check law). The base's security suite is
  **166/166 (7 files)** — machine-verified at the base worktree.
- **Branch:** `work/f341b` (published to origin; the final tip SHA is in the
  FINAL REPORT message — the repository is the source of truth). WIP push:
  `955323f` (both journeys + corpus registration + census + tests).
- **Ownership:** every changed path lies in `packages/acceptance/security/**`
  (worker-B owned, `spec/worker-ownership.yaml`) plus this report file and
  the one-line catalog append. No adoption/release/pin file touched; no
  domain package touched.

## 1. What this lane delivers

1. **B1 `security.evidence-artifact-store-completeness`** — the F340 §1
   census candidate B1: `packages/evidence/src/artifact-store.ts`
   (ArtifactStorePort, InMemoryArtifactStore, verifyBundleCompleteness,
   assembleBundle), zero prior acceptance-corpus coverage (re-verified at
   this base by grep: `verifyBundleCompleteness` / `assembleBundle` /
   `InMemoryArtifactStore` / `ArtifactStorePort` over `packages/acceptance/**`
   = zero matches; the understand-evidence journey drives the
   canonical-bundle.ts family — a distinct surface).
2. **B2 `security.world-context-windowing`** — census candidate B2:
   `packages/world-context/src/windowing.ts` (projectWindowedWorkload,
   projectWindowedProject, isObservationMature, filterMatureObservations),
   zero prior journey coverage (re-verified: the security corpus drives the
   assembly.ts family and classifyStaleness but has zero windowing
   references). Honest census nuance recorded in §6-L3: the TL-owned
   convergence suite binds projectWindowedWorkload's happy path as
   scenario-seeding composition glue (F290B) — no journey anywhere exercised
   the windowing LAWS (the project projector, the maturity gate, the window
   boundaries, the windowing-vs-staleness distinction), so the candidate
   stood and was delivered.

No candidate turned out already-covered (the D16 honesty check was re-run
at this base BEFORE implementation — both families delivered).

## 2. The async-API law extension (B1's engineering decision, documented)

The F321B precedent (`tests/async-dispatch.test.ts`) established that the
corpus runner executes synchronous steps by contract — the TL-owned adoption
seam consumes `runJourney(j).outcome` synchronously — so async-signature
APIs are driven outside the counted corpus as supporting evidence. B1's
census-named surface is ENTIRELY Promise-signature (store/retrieve/exists on
the ArtifactStorePort I/O seam; verifyBundleCompleteness; assembleBundle):
there is NO synchronous surface for a corpus journey to drive.

This lane extends the law rather than weakening it: the REAL APIs are
driven to completion at MODULE EVALUATION TIME via **top-level await** over
deterministic in-memory ports (fixed bytes, sha-256 content addressing, no
clock/randomness/network/timers — the promises resolve on pure microtasks).
ESM evaluation-order semantics guarantee the results are complete before ANY
consumer's module body runs — including fully-synchronous module-scope
consumers (the release family's `runAllJourneys(SECURITY_JOURNEYS)` at
module scope — machine-verified green, §5) and the adoption seam's
synchronous consumption (machine-verified: zero new adoption failures, §5).
The resolved values are frozen as module constants; the sync steps record
them as facts; the runner's determinism law holds byte-identically
(runner-determinism test green; the census measures the journey
byte-identical across the whole 7-Δ grid). The law and its rationale are
documented in the journey module doc, cited in the census row.

## 3. The journeys (census citations + machine-checked laws)

### 3.1 B1 `security.evidence-artifact-store-completeness`

Census citation (F340 §1 row, verbatim): "evidence artifact store |
`packages/evidence/src/artifact-store.ts` (ArtifactStorePort,
InMemoryArtifactStore, verifyBundleCompleteness, assembleBundle) | NO
journey in acceptance/security exercises it (grep: zero) | CANDIDATE B1".

- Persona `compliance-auditor`, capability `understand-evidence` (the
  evidence family's cell — the multi-journey-per-cell precedent; no
  vocabulary change).
- 4 steps, **40 assertions** (D14: ≥5 substantive incl. the refusal).
- REAL APIs driven: `new InMemoryArtifactStore()` + `store` (4 stores incl.
  a duplicate re-presentation) + `retrieve` + `exists` + `size`;
  `verifyBundleCompleteness` (complete + incomplete); `assembleBundle`
  (complete + incomplete); `computeBundleDigest` / `sha256Hex` / `utf8Bytes`
  (the canonical-parts cross-check); plus a second REAL port implementation
  (`PreloadedObjectStore` — the production shape the port doc names:
  "production injects an object-store-backed repository").
- Laws asserted: content addressing (artifactId = `art-` + first 16 hex of
  the sha-256; 64-hex digests); automatic dedup (same bytes → the SAME
  artifactId and sha, the original description wins, the store never grows
  — size stays 3 over 4 stores); traceability (retrieve round-trips the
  stored artifact verbatim; an unknown digest retrieves null; exists()
  answers true/false honestly); a COMPLETE bundle verifies (3 unique digests
  over 4 references — cross-entry digest dedup); an INCOMPLETE bundle NEVER
  verifies — 5 unique referenced, 3 present, exactly the 2 lost digests
  reported MISSING, SORTED (deterministic; not input order — the
  lexicographically-later digest was referenced first), with the first
  missing digest pinned to its machine-measured prefix (`8c7a1b46…`);
  assembly returns the completeness result + the canonical bundle digest
  (equals `computeBundleDigest` over the same parts — port-blind, proven:
  the identical digest through the second port; an empty port reports ALL
  3 digests missing sorted, verified=false); the incomplete input NEVER
  verifies through assembly either while its digest remains the canonical
  envelope (completeness is the gate, not the digest). Refusals asserted:
  as-24, as-26, as-37 (three distinct refusal paths).

### 3.2 B2 `security.world-context-windowing`

Census citation (F340 §1 row, verbatim): "world-context windowing |
`packages/world-context/src/windowing.ts` (projectWindowedWorkload,
projectWindowedProject, isObservationMature, filterMatureObservations) |
staleness-window assertions exist (reasoning.ts) but WINDOWING (context
assembly windows) is NOT exercised — distinct semantics | CANDIDATE B2".

- Persona `site-reliability-engineer`, capability `reasoning-context` (the
  context family's cell; no vocabulary change).
- 5 steps, **53 assertions** (D14: ≥5 incl. refusals).
- REAL APIs driven: `projectWindowedWorkload` (5 projections incl. the
  composition with the maturity filter), `projectWindowedProject`,
  `isObservationMature` (the exact boundary, both sides),
  `filterMatureObservations`, `verifyWindowIntegrity` (genuine + forged),
  and `classifyStaleness` (@fleetos/world-model — the staleness side of
  the distinction).
- Laws asserted: windowed workload AND project projections carry ONLY
  in-window provenance with the window and computedAt echoed verbatim;
  the boundaries are INCLUSIVE at both edges and honest to the millisecond
  (one ms past windowStart / before windowEnd excludes the edge
  observation); the empty window degrades; negative utilization degrades;
  a FORGED projection carrying an out-of-window provenance entry is caught
  (ok=false, outOfWindow=1) while the genuine one verifies; MATURITY GATING
  — mature exactly at producedAt+horizon, immature one ms short; the filter
  keeps exactly the at-or-past-horizon set; the immature observation NEVER
  joins the composed projection even when it sits INSIDE the window
  (in-window 4, joined 3 — ww-30/ww-32, the immature-observation refusal);
  WINDOWING ≠ STALENESS asserted in BOTH directions (ww-38: a
  staleness-unknown 10-minute-old observation is legitimately included in a
  historical window — windowing selects by interval; ww-42: a
  staleness-fresh 10-second-old observation is REFUSED by the 60s horizon
  — staleness is not the join gate).
- Determinism: all clocks derive from the run anchor through the fixture
  world's `isoOfEpochMs` (the reasoning.ts pattern) while every asserted
  value is relative — the journey is byte-identical at any anchor by
  construction (machine-verified across the whole census grid).

## 4. D17 sixth slot — NOT proposed (the honest restraint)

The lane surveyed its owned paths for a genuinely unexercised public API
with census evidence. Machine-verified zero-coverage families found:
`projectWindowedFeatures` / `toFeatureProjection` /
`assertNoAuthoritativeWritePath` (@fleetos/predictive feature-projection)
and `runSimulationWithDegradation` / `generateSimulationAdoptionProposal` /
`assertNoAdoptFunction` (@fleetos/simulation adoption); `widenUncertainty`
and `joinOutcomesWithPredictions` are already covered
(degradation-staleness / evaluation-adoption). NO proposal is made this
lane: the B-3 arithmetic already closes at 100 with the six in-flight
journeys (A lane's 3 census + 1 TL-adjudicated D17; this lane's 2 —
§5's machine-measured 3027 = the F342 packet's pre-staged expectation, and
manufacturing/energy-utilities small firms at exactly 100), so a seventh
journey is not a Wave-14 remainder — proposing one would be count-inflation
pressure against the count-honesty law. The surveyed families are recorded
here as future-wave candidates for the TL's backlog (TL-gated).

## 5. Machine-run evidence (verification battery)

| gate | command | base `5c2ba68` | lane `work/f341b` |
|---|---|---|---|
| security suite (owned) | `pnpm --filter @fleetos/acceptance-security test` | **166/166 (7 files)** | **179/179 (8 files)** — grow-only: +4 journeys.test it.each rows, +2 census F341B rows, +7 F341B spot checks; nothing removed or edited-red |
| corpus (machine probe) | `runAllJourneys` + report assembly | 27 journeys / 70 steps / 933 assertions | **29 / 79 / 1026** (B1: 4/40; B2: 5/53) — every base journey digest byte-identical (probe + seam test) |
| typecheck (owned) | `pnpm --filter @fleetos/acceptance-security typecheck` | clean | exit 0 (TLA included) |
| lint (owned) | `pnpm --filter @fleetos/acceptance-security lint` | 0w/0e (35 files) | 0 warnings / 0 errors (37 files) |
| file law | raw line count | — | max new file 380 (`world-windowing.ts`); 364 (`artifact-store-completeness.ts`); 98 (`f341b.test.ts`); every edited file ≤244 — ≤400 ✓ |
| boundary | `git diff --name-only main...HEAD` | — | ONLY `packages/acceptance/security/**` + this report + the one-line catalog append (§8) |
| 30-workspace simulation (probe, both trees) | `runAdoptionSimulation()` | 2967 executions / field 1179 / commerce 1017 / security 771 / uniqueApplicable 911 / shortfall 130 | **3027 / 1179 / 1017 / 831 / 931 / 97** — +60 (2 journeys × 30 workspaces), +20 applicable pairs (2 × 10 industries), determinismVerified true |
| B-3 closure (per-firm, machine) | honest-counts ledger | manufacturing/small 98, energy-utilities/small 98 | **manufacturing/small 100, energy-utilities/small 100 — shortfall 0** (F340 §3's arithmetic realized; medium/large already ≥100) |
| adoption (TL-owned, evidence only) | `pnpm --filter @fleetos/acceptance-adoption test` | 100/120 (the F341A-era pin transition) | 100/120 — **the identical 20-test failure set** (diff-verified); the 30 failing executions in the simulation are ALL the A-lane `observations-kernel-immutability-audit` ka6 tenant pin (pre-existing at base, §6-L4); zero security-corpus failures — both B journeys pass through the adoption seam |
| release (TL-owned, evidence only) | `pnpm --filter @fleetos/acceptance-release test` | 77/88 | 76/88 — every failure identical to base except ONE new count-pin: the short-corpus probe pins the message "expected 27" while the REAL gate now correctly reports "expected 29 (REAL corpus length)" — the documented count-pin transition class (TL-owned at F342); the module-scope synchronous security run reports all 29 journeys passing (the TLA proof) |
| convergence / field / commerce | `pnpm --filter … test` | — | 82/82, 102/102, 115/115 — green, unaffected |
| consumed domain suites (read-only sanity — no domain file touched) | `pnpm --filter @fleetos/{evidence,world-context,world-model} test` | — | 82/82, 34/34, 147/147 — green |

## 6. Honest limitations

- **L-1 (the TLA drive):** B1's REAL Promise-signature APIs execute at
  module-evaluation time (top-level await) rather than inside the sync step
  bodies — mechanically unavoidable (native Promises cannot be synchronously
  unwrapped in JS) and documented as the async-dispatch law's extension in
  the journey module and census row. The trade is verified everywhere it
  can fail: the release family's synchronous module-scope corpus run (the
  harshest consumer) passes all 29 journeys; the adoption seam adds zero
  failures; the census measures the journey byte-identical across the whole
  7-Δ grid; the runner-determinism test passes. A consumer that somehow
  evaluated the journey's steps without the module graph having evaluated
  first is not constructible in ESM (evaluation order is normative).
- **L-2 (an honest docstring divergence found by driving the API):**
  `assembleBundle`'s doc comment says "stores all artifacts and verifies
  completeness", but the implementation only VERIFIES (it never calls
  `store`). The journey asserts the REAL behavior (completeness result +
  the canonical envelope digest; an incomplete input never verifies) and
  this divergence is recorded here for the TL's adjudication — fixing the
  docstring is a domain-package change outside this lane's boundary.
- **L-3 (the census nuance):** the TL-owned convergence suite's
  integration test binds `projectWindowedWorkload` + `verifyWindowIntegrity`
  happy paths as scenario-seeding composition glue (F290B). The F340 census
  row's claim ("windowing NOT exercised") holds at the journey-corpus level
  — no journey exercised the windowing laws, and `projectWindowedProject`,
  `isObservationMature` and `filterMatureObservations` had zero coverage
  anywhere — but the nuance is recorded here rather than left implicit
  (D16 honesty: the delivered journey's semantics — maturity gating,
  boundary honesty, the staleness distinction, the project projector —
  were genuinely unexercised).
- **L-4 (a pre-existing defect surfaced, not this lane's):** in the
  adoption simulation the A-lane's D17 journey
  `observations-kernel-immutability-audit` fails assertion `ka6` in all 30
  workspaces (it pins the fixture tenant `tnt_field-accept-01` while the
  adoption runner threads the real firm tenantIds). Identical at base and
  lane (diff-verified failure-for-failure). Recorded for the TL's F342
  adjudication; the field acceptance suite itself is green (102/102) — the
  pin fails only in the adoption-composition regime.
- **L-5 (sandbox scope):** all gates ran in this sandbox (per-package
  suites + cross-suite evidence runs + the two-tree simulation probes at
  `5c2ba68` and the lane tip); the 16 GB builder full clean-checkout gates
  and browser verification remain TL-owned (the F322 §5 doctrine). The
  adoption/release count re-pins (29-journey security corpus; 3027
  aggregate; the A-lane ka6 adjudication) are TL-owned at F342 per the
  pre-staged packet.
- **L-6 (pins are tree-scoped):** the two digests pinned in
  `tests/seam.test.ts` for the new journeys (`43f7fa34`, `e1792e6d`) were
  machine-measured on THIS tree (the journeys did not exist at the
  base); the 27 base entries are untouched and byte-identical.

## 7. Delivery record

- Branch `work/f341b`, base `5c2ba68`. WIP push `955323f` (both journeys +
  registration + census + tests, gates green at push time). The final
  nominated commit (this report + the catalog one-liner) is the branch tip
  at delivery time — the FINAL REPORT message records the exact SHA; the
  repository is the source of truth.
- The two journeys' digests are pinned in `tests/seam.test.ts`; their
  census invariance is machine-enforced by `tests/census.test.ts` (the
  F341B block: declared non-responders, byte-identical across the grid);
  the corpus grow-only law by the seam test's 27 base digests + the
  machine probe recorded in §5.

## 8. Boundary

`git diff --name-only main...HEAD` lists ONLY: `packages/acceptance/
security/src/census.ts`, `src/index.ts`, `src/journeys/index.ts`,
`src/journeys/artifact-store-completeness.ts` (NEW),
`src/journeys/world-windowing.ts` (NEW), `tests/census.test.ts`,
`tests/seam.test.ts`, `tests/f341b.test.ts` (NEW) — all under
`packages/acceptance/security/**` — plus `docs/evidence/F341B/report.md`
(this file) and the one-line catalog append to
`spec/work-items/WORK-ITEM-CATALOG.md`. No domain package, no
adoption/release/pin file, no shared contract.
