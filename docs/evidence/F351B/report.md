# F351B — Wave-16 lane A: masked-industry coverage, tranche 1 (mining + construction)

- **Work item:** F351B (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 16; the
  f351b packet `docs/tech-lead/packets/f351b.md` is the binding contract).
- **Worker:** A. **Date:** 2026-10-14.
- **Base:** `4f59ffe` (main HEAD at clone — the F351B freeze commit,
  EXACTLY the packet's expectation; the TL pre-scan reference `67730ae` is
  its parent — verified in §1).
- **Branch:** `work/f351b` (pushed to origin; the final tip SHA is in the
  FINAL REPORT message — the repository is the source of truth).
- **Binding law read in order:** the f351b packet, F350 §4 (the F351B
  disposition — this lane IS that plan), F342 §2 (the honest per-firm
  ledger this lane grows from), F340 §2 D14–D17 (carryover).

## 1. The census (machine-measured FIRST, cited; the TL pre-scan verified)

Method (the F340 machine-census pattern): an untracked probe
(outside the repo, deleted before commit) enumerates every VALUE export
(function/class/const) of the persona-relevant packages and greps each
symbol across ALL THREE acceptance corpora (field + security + commerce,
src + tests). Zero matches = unexercised.

| package | value exports | unexercised | TL pre-scan at `67730ae` |
|---|---:|---:|---|
| assets | 59 | 42 | verified (zero/near-zero) |
| work | 23 | 16 | verified |
| workloads | 16 | 11 | verified |
| projects | 20 | 9 | verified |
| procurement | 31 | 14 | verified |
| health | 33 | 20 | verified |
| connectivity | 50 | 37 | verified |
| mission | 29 | 22 | verified (packet's extended list) |
| control-plane | 19 | 16 | verified (packet's extended list) |

The candidate table (the APIs the five delivered journeys drive; every
PRIMARY API has zero corpus coverage at base — grep proof: zero
word-boundary matches across all three corpora):

| journey | API (file:line at base) | zero-coverage proof | persona rationale |
|---|---|---|---|
| asset-registry-lifecycle-audit | `evaluateAssetTransition` assets.ts:76; `applyTwinRevision` assets.ts:169; `latestAttributes` assets.ts:238; `projectTwin` kernel.ts:231 | zero matches, all three corpora | mining haul fleets + construction site equipment are heavy-equipment-weighted personas (60%/45% heavyEquipment) — registry onboarding/classification is their daily mechanic |
| work-order-shift-supersession | `advanceWorkItem` work/lifecycle.ts:31; `assignTo` :148; `reassignTo` :199; `progressEventForTransition` progress.ts:58; `progressEventForAssignment` progress.ts:112; `computeProgressDigest` progress.ts:186 | zero matches, all three corpora | mining runs shift-scoped work orders (the classic mine-operations discipline); construction runs shift crews |
| project-closeout-archival | `archiveProject` projects/stages.ts:160; `readProjectForTenant` :192 | zero matches, all three corpora | the construction persona's core is the stage-gated project lifecycle — closeout/archival is its terminal discipline |
| procurement-order-authorization | `matchVendors` procurement/matching.ts:47; `createOrder` lifecycle.ts:180 | zero matches, all three corpora | both personas procure heavily (mining consumables/tires, construction subcontractors/materials) |
| equipment-health-threshold-escalation | `triageWithConfidence` health/kernel.ts:75; `emptyDiagnosisRegistry` kernel-registry.ts:24; `registerDiagnosis` :28; `lookupDiagnosis` :40; `listDiagnosesForDevice` :52; `currentDiagnosisForDevice` :63 | zero matches, all three corpora | equipment health monitoring + escalation is the mining persona's reliability discipline (posture-emphasis security-intelligence) |

**D16 record (covered candidates NOT delivered):** the packet's candidate
family 3 as literally stated — "project stage-gating" via
`transitionStage`/`completeStageCheckpoint`/`checkMilestoneGate` — is
ALREADY COVERED by the commerce corpus (the `stage-gated-project` and
`project-completion-portfolio` journeys drive exactly those APIs;
match counts 2/2/2). Per D16 the stage-ADVANCEMENT journey is NOT
delivered; the delivered projects mechanic is the genuinely unexercised
closeout/archival + fail-closed-read discipline — the packet's own
"different mechanic" clause. Substrate APIs honestly cited as covered:
`transitionProject` (projects/contracts.ts:165, commerce-covered — the
terminal-state path the archival law requires) and `transitionOrder`
(procurement/lifecycle.ts:211, commerce-covered — the order lifecycle
tail). Neither is claimed as new coverage.

Remaining unexercised surface NOT delivered this tranche (recorded for
tranche 2+): workloads (11), connectivity (37 — posture-machine, honest
posture, intent-lifecycle staleness), mission (22 — runtime engine,
outbox), control-plane (16 — queue/ledger/SLA), health kernel-diagnostics
(self-check ladder), assets twin-engine fold/verify + lineage method
registry, work audit events, projects accounting pins.

## 2. The five journeys (D14 form; pure DATA, declarative assertions)

| journey | id | persona / capability | steps | assertions | refusal steps |
|---|---|---|---:|---:|---:|
| asset registry lifecycle | `asset-registry-lifecycle-audit` | fleet-operator / enrollment | 14 | 21 | 4 (illegal-transition, already-in-target-state, non-monotonic-seq, stale-observed-at) |
| work-order shift supersession | `work-order-shift-supersession` | field-technician / maintenance | 14 | 25 | 4 (ASSIGNEE_REQUIRED_FOR_COMPLETION, ALREADY_ASSIGNED, BLOCK_REASON_REQUIRED, ILLEGAL_TRANSITION) |
| project closeout archival | `project-closeout-archival` | site-manager / trustworthy-state | 15 | 16 | 7 (PROJECT_NOT_TERMINAL ×2, ILLEGAL_TRANSITION, ALREADY_ARCHIVED, tenant-fail-closed, CANCEL_REASON_REQUIRED, unknown-project) |
| procurement order authorization | `procurement-order-authorization` | maintenance-planner / maintenance | 10 | 16 | 4 (AUTHORIZATION_REQUIRED, AUTHORIZATION_DENIED, ILLEGAL_TRANSITION ×2) |
| equipment health thresholds | `equipment-health-threshold-escalation` | maintenance-planner / investigation | 14 | 22 | 2 (tenant-fail-closed ×2) |

Totals: 67 steps, 100 assertions, 21 refusal steps — every refusal is a
REAL machine-stable reason code from the driven package (pinned
byte-exact in assertions); every assertion is runner-evaluated against
recorded REAL readings (never journey-side). Census citations are
carried verbatim in each journey file's module doc. No epochs declared
(D14's single-epoch default; the F330 census set is closed — the five
ids are pinned in `epochs.test.ts` POST_CENSUS_ADDITIONS).

## 3. Applicability (D15-strict; the packet's industries.ts grant)

| journey | applicability | mask set (NEW entries only) + rationale |
|---|---|---|
| asset-registry-lifecycle-audit | fully-applicable (10/10) | none — asset admission/classification is the FleetOS enrollment core; the enrollment family is never masked (all ten industries run field journeys) |
| work-order-shift-supersession | fully-applicable (10/10) | none — every industry runs field work orders (maintain-asset-schedule is unmasked for all ten; the commerce work journeys are unmasked everywhere) |
| project-closeout-archival | 8/10 | NEW mask entries: transportation-logistics + agriculture — the incumbent-PMO / contractor-run rationales, mirroring their own recorded stage-gated-project commerce masks verbatim in substance. The other eight (incl. mining + construction) run capital/facility projects honestly (their commerce stage-gate journeys are unmasked) |
| procurement-order-authorization | fully-applicable (10/10) | none — all ten industries procure (the commerce procurement family is unmasked everywhere) |
| equipment-health-threshold-escalation | fully-applicable (10/10) | none — equipment health triage is unmasked for all ten (healthcare's masks name edge-command/field-mode/offline, not health monitoring) |

**industries.ts diff-gate (machine-verified):** 4 lines added, **0
removed, 0 modified** — every existing mask record is byte-identical to
main (the TL's hard gate). The two NEW entries are journey-id keys
(`project-closeout-archival`) under the EXISTING per-industry field
records, exactly the F350-pattern D11-analog grant.

## 4. The measured closure arithmetic (machine-run at this tree; do NOT pin — TL re-pins at F353)

The full 30-workspace simulation over the REAL corpora (the F332
counting gate ACTIVE), machine-measured via the untracked probe (the
F332 out-of-repo pattern):

| measure | F342/F352 pin (base) | **F351B measured (this tree)** | delta |
|---|---:|---:|---|
| journeyExecutions (COUNTED) | 3,027 | **3,171** | +144 = 4 journeys × 30 firms + 1 journey × 24 firms (t-l/ag masked) |
| fieldExecutions | 1,179 | **1,323** | +144 |
| commerceExecutions | 1,017 | **1,017** | 0 (no commerce journeys) |
| securityExecutions | 831 | **831** | 0 (no security journeys) |
| fieldEpochReRuns (raw, never counted) | 406 | **406** | 0 — the new journeys declare no epochs |
| commerceEpochReRuns (raw, never counted) | 897 | **897** | 0 |
| uniqueApplicableJourneys | 931 | **979** | +48 = 4 × 10 + 1 × 8 |
| aggregateShortfall | 97 | **47** | −50 |
| determinismVerified | true | **true** | byte-identity holds on all 30 firms |
| allJourneysPassed | true | **true** | every journey passes in every firm regime (the F343 ka6 fix holds; the new journeys are tenant-regime-honest) |
| firms at/above 100 | 17 | **23** | +6 |

The per-firm closure table (measured; small-firm bold = the lane's
target arithmetic):

| industry | small | medium | large |
|---|---:|---:|---:|
| manufacturing | **105** (100+5) | 113 | 121 |
| construction | **102** (97+5) | 110 | 118 |
| energy-utilities | **105** | 113 | 121 |
| transportation-logistics | 97 (93+4, project mask) | 105 | 113 |
| agriculture | 86 (82+4, project mask) | 94 | 102 |
| healthcare-facilities | **90** | 97 | 104 |
| facilities-management | **91** | 98 | 105 |
| telecommunications | **100** (95+5) | 108 | 116 |
| mining | **103** (98+5) | 111 | 119 |
| water-waste | **100** (95+5) | 108 | 116 |

**The lane's arithmetic closes:** mining small 98 → **103** (≥100),
construction small 97 → **102** (≥100) — **B-3 closes for mining and
construction** (their medium/large were already ≥100 and grew to
111/119 and 110/118). Honest bonuses, never targets: telecommunications
and water-waste small firms reached 100; agriculture/healthcare/
facilities large firms crossed 100. Every count is grow-only (no
counted number decreased); the 100 target is untouched; every existing
mask is byte-identical (§3).

## 5. The verification battery (machine-run; exact numbers)

| gate | command | result |
|---|---|---|
| field suite (grow-only) | `pnpm --filter @fleetos/acceptance-field test` | **107/107 (8 files)** — base 102 → 107 (+5); all pre-existing tests green with in-place pin growth only (35→40 corpus shape, 35→40 report aggregate, POST_CENSUS_ADDITIONS +5 ids) |
| field corpus barrel | `FIELD_JOURNEYS.length` (pinned in journeys.test.ts + probed) | **35 → 40**, machine-verified, ids unique |
| typecheck (owned packages) | `tsc --noEmit` (field + adoption) | **exit 0, both** |
| lint (owned packages) | `oxlint` (field + adoption) | **0 warnings / 0 errors** (67 + 20 files) — the max-lines file law enforced by the same gate |
| file law | new files ≤400 lines | max new-file lines **296** (journey-contracts-f351b.ts); largest new journey 98; largest new ops file 196 |
| determinism | corpus double-run digest compare + full simulation re-run + `determinismVerified` | **byte-identical** on all three proofs (40 corpus digests identical; the 30-firm simulation re-runs to identical executed counts; determinismVerified=true) |
| tenant-regime honesty | each new journey run under `tnt_mining-small` (the adoption-composition regime) | all 5 pass (no ka6-class defect: no fixture-tenant pins; foreign-tenant probes use the corpus FOREIGN_TENANT fixture) |
| boundary | `git diff --name-only main...HEAD` | §7 — CLEAN (field journeys + ops + contracts + context + runner + barrel + package.json + lockfile + industries.ts NEW entries + tests + evidence + catalog) |

**Adoption suite at this tree (honest state, NOT in this lane's
battery):** 104/120 passing; the 16 failures are ALL stale F342-era
count pins (3,027/1,179/931/17-at-or-above/corpus-35 etc. vs the
measured 3,171/1,323/979/23/40) — the documented TL-owned re-pin
transition (F342 §3 precedent: lanes run grow-only vs base; pins are
tree-scoped; F353 re-pins). No adoption/release pin file was touched
(this lane's boundary forbids it).

## 6. How the journeys were built (the D14 mechanics)

- New typed operation contracts (`journey-contracts-f351b.ts`, 23 op
  types) joined the frozen `JourneyOperation` union; five op executors
  (`ops/f351b-*.ts`) drive the REAL package APIs and record readings
  from REAL outputs only; the runner dispatch table grew by five sets
  (grow-only; the default view path unchanged).
- The context gained seven REAL-state fields (twins, work items,
  progress events, projects + archives, orders, diagnosis registry) —
  no domain logic in the context (the A1/A12 laws of the driven
  packages).
- The five journey files are pure DATA (typed steps + declarative
  assertions incl. per-step `expectRefusal` flags); every refusal step
  passes ONLY when the REAL API refuses (fail-closed verification, the
  runner's own law).
- The field package's dependencies grew by the three driven packages
  (`@fleetos/work`, `@fleetos/projects`, `@fleetos/procurement`) — the
  lockfile delta is exactly those three workspace links (6 lines; no
  external/version changes).

## 7. Boundary

`git diff --name-only main...HEAD` lists ONLY (21 code paths + lockfile
+ 2 doc paths at lane tip):

- `packages/acceptance/field/src/journey-contracts-f351b.ts` (new)
- `packages/acceptance/field/src/journeys/f351b-{asset-registry,work-order,project-closeout,procurement-order,health-thresholds}.ts` (new ×5)
- `packages/acceptance/field/src/ops/f351b-{asset,work,project,procurement,health}-ops.ts` (new ×5)
- `packages/acceptance/field/src/{context.ts, journey-contracts.ts, runner.ts}`
- `packages/acceptance/field/src/journeys/index.ts` (barrel +5)
- `packages/acceptance/field/package.json` + `pnpm-lock.yaml` (the three workspace dependency links)
- `packages/acceptance/adoption/src/industries.ts` (NEW mask entries only — 4 added lines, 0 removed/modified)
- `packages/acceptance/field/tests/{f351b-masked-industry.test.ts (new), journeys.test.ts, report.test.ts, epochs.test.ts}` (in-place pin growth, nothing removed)
- `docs/evidence/F351B/report.md` (this file)
- `spec/work-items/WORK-ITEM-CATALOG.md` (the one-line append)

No domain-package source, no security/commerce corpus, no adoption
test/pin file, no release file, no shared contract outside the measured
new-journey surface. The census + measurement probes ran untracked
(outside the repo / deleted before commit — the F332 pattern).

## 8. Honest limitations

- **L-1 (the adoption pins are stale at this tree):** the 16 failing
  adoption expectations are exactly the F342-era count pins — the
  packet's own law reserves re-pinning to the TL at F353 (NO adoption
  test/pin files in this lane's boundary). Nothing silently flips; the
  tripwires fire exactly as designed (F342 §5's doctrine).
- **L-2 (census method):** coverage is symbol-name word-boundary grep
  across the three corpora's source + tests (the F340 machine-census
  method); internal transitive use inside a domain package does not
  count as corpus coverage — the same convention as F340 §1.
- **L-3 (the stage-gating candidate was covered):** the packet's family
  3 as literally stated rides commerce-covered APIs (§1's D16 record);
  the delivered mechanic is the genuinely unexercised closeout/archival
  discipline the packet's "different mechanic" clause anticipated.
- **L-4 (substrate honesty):** `transitionProject` and
  `transitionOrder` (both commerce-covered) are used as the REAL
  lifecycle substrate to reach the states the new laws require — cited,
  never claimed as new coverage; the WorkItem/Project/Order record
  types are constructed as journey data (the corpus convention).
- **L-5 (remaining surface):** workloads/connectivity/mission/
  control-plane/health-diagnostics remain unexercised (§1's table) —
  honest surface for tranche 2+, never padded into this tranche.
- **L-6 (D15 judgment):** the fully-applicable declarations rest on the
  corpus's own mask history (enrollment/work-order/procurement/health
  families are unmasked for all ten); the one non-universal mechanic
  (project closeout) masks exactly the two industries whose own
  recorded rationales say they do not run FleetOS-owned projects. The
  TL gates every mask at merge (D11-analog grant).
- **L-7 (sandbox scope):** all gates ran in this sandbox; the 16 GB
  builder clean-checkout gates and browser verification remain TL-owned
  (the F322 §5 doctrine).
