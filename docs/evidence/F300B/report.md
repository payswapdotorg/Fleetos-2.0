# F300B — Worker B (Safety + Intelligence) Evidence Report

- **Work item:** F300B — Security, Guardian and predictive experience (Wave 10 lane B; catalog: `spec/work-items/WORK-ITEM-CATALOG.md`)
- **Owner:** Worker B (safety-and-intelligence; grants per `spec/worker-ownership.yaml`)
- **Base commit:** `a5e18f5` (TL Wave 10 dispatch — origin/main HEAD, verified with `git log --oneline -1` before branching)
- **Branch:** `work/f300b` (from `origin/main` HEAD)
- **Packet:** `docs/tech-lead/packets/f300b.md`; integration contract: `spec/integration/WAVE10-HOST-CONTRACT.md` (read FIRST)
- **Final commit:** recorded in the final report message (gates machine-run at that exact commit, §5)

## 1. Owned paths touched

ONLY lane packages + this evidence dir:

- `packages/experiences/safety-intel/**` — NEW `src/host/` (8 files: `contract.ts` 199, `honesty.ts` 212, `evidence-view.ts` 198, `execution-view.ts` 216, `advisory-route.ts` 207, `view-models.ts` 355, `intents.ts` 167, `index.ts` 49 — subpath export `./host` + root re-export); NEW tests `tests/host-surface.test.ts` (29 tests), `tests/host-honesty.test.ts` (22), shared `tests/host-fixture.ts`; `package.json` (+1 export), `src/index.ts` (+4).
- `packages/acceptance/security/**` — NEW journeys `guardian-e2e.ts` (364), `mission-replay.ts` (249), `predictive-honesty.ts` (237), `host-surface.ts` (241) + shared composition `wave10-world.ts` (323); `journeys/index.ts` (corpus 13 → 17); `journey-contracts.ts` (capability vocabulary 13 → 17, header law updated); `fixture-world.ts` (latent-defect fix D-2); tests `contracts.test.ts` / `report.test.ts` / `journeys.test.ts` / `runner.test.ts` (pins + spot checks, one index-based lookup made id-based).
- `docs/evidence/F300B/**` — this report + `journeys/` (README + 4 browser-journey scripts).

Untouched: all other lane packages (re-run green, §5), no spec edits, no TL-owned paths, no new runtime dependencies (package.json deps unchanged in both packages).

## 2. Baselines — machine-run BEFORE first edit, re-verified AFTER last edit

BEFORE (at `a5e18f5`, before any edit):

```text
acceptance/security 4 files / 90 tests   safety-intel 6 files / 113 tests
```

AFTER (last code edit; full test+typecheck+lint per touched package, all green):

```text
acceptance/security 4 files / 103 tests  safety-intel 8 files / 164 tests
```

Lane packages re-verified green at this tree (test counts, unchanged by this lane):
security 147 · policy 131 · actions 73 · execution 118 · evidence 82 · predictive 74 ·
world-model 147 · world-context 34 · learning 78 · simulation 103 · arena 94.

## 3. Deliverables

### D1 — HostSurface adapter (`packages/experiences/safety-intel/src/host/`, subpath `./host`)

`SAFETY_INTEL_HOST_SURFACE` per WAVE10-HOST-CONTRACT §2 — LOCAL structural
mirror of the TL's seam (no TL-owned import; compile-pinned like the
`SubmitCommandInputMirror` precedent — decision D-4):

- **`surfaceId: "safety-intel"`**, `surfaceKind: "lane-experience"`;
- **routes** — the 7 packet routes with titles + drill refs (no dangling —
  machine-tested): findings-board, evidence-chain, guardian-decision,
  action-authorization, execution-results, inspect-why, advisory-board;
- **`buildViewModels(slice, ctx)`** — pure, deterministic projection over
  the lane's REAL read-models (the slice is TL-composed; the adapter never
  caches, derives-new-truth, or embeds a store): findings views, rule
  catalog + capability ceilings, action-plan board (dead-letter
  visibility), execution ledger + REAL verification/replay outcomes
  verbatim, decision provenance (chain-digest-covered), advisory board with
  the honesty join. Same slice + ctx ⇒ byte-identical views + stable
  `viewModelsDigest` (FNV-1a) — machine-tested; input arrival order never
  leaks (derived orderings only);
- **intents** — 3 catalogued UI events → the lane's EXISTING inert
  CommandDraft builders (`requestRemediation`, `proposeActionPlanStep`,
  `requestAdvisoryRefresh`) via `buildHostIntentDraft` (typed) and
  `buildHostIntentDraftUntyped` (untrusted event ids: catalog-validated,
  required-input presence-checked, then builder-validated). The surface
  exports NO submit/execute member — machine-tested (inert intents);
- **tenant fail-closed (A8)** — every cross-tenant input family (findings,
  remediations, policy, grants, queue, ledger, audit events, action,
  evidence entries/records/trace, predictions, world contexts) refuses the
  WHOLE view with route + code + offender detail — the two HOST-level
  checks the existing builders lacked (predictions, world contexts) are new
  and machine-tested;
- **honest not-composed sections** — optional slices (plan/lifecycle/queue,
  action/evaluation/trace, zero advisory inputs) render explicit
  `composed: false` markers with reasons — never fabricated views (D-5).

### D2 — The Guardian journey end to end (machine-run: journey 14, `security.guardian-e2e`)

finding (REAL `runFindingIntake`) → evidence (REAL A13
`buildCompleteChain` + `appendEvidence` + `verifyEvidenceChain`) → Guardian
decision (REAL `evaluateCapability` + `evaluateRulesOrdered` +
`buildDecisionRecord` + `buildDecisionAuditRef`) → authorized action intent
(REAL `authorizeCommand` — the ONLY AuthorizedCommand constructor; the
inert `requestRemediation` draft submits through the seam into the REAL
`submitCommand`; duplicate submit is an idempotent no-op) → execution
result (REAL queue submit/ack/complete + the A4 action chain with
execution + verification records) → verification + audit trail (REAL
evidence-gated remediation to `verified` + `verifyRemediationHistory` +
`verifyExecutionLedger` + `emitAuditTrail` + `buildIncidentAuditTrail` +
`verifyIncidentAuditTrail`). 51 assertions, all passing.

### D3 — Inspect-why + mission replay on REAL package outputs (journey 15, `security.mission-replay`)

REAL reasoning traces (`buildDecisionRecord` + `buildDecisionAuditRef` over
the REAL ordered evaluation) and REAL replay records: `replayIncident`
merges the REAL execution ledger + REAL action audit journal into the
canonical timeline (per-step digests, whole-replay digest); re-replay
byte-identical; a reordered ledger copy produces the identical INCIDENT
timeline (recorded index is the truth) while the RAW
`replayExecutionLedger` honestly refuses a reversed copy (`ledger.index_gap`
— layering documented in the journey); `diffIncidentReplays` pins the first
divergence with field class (kind / source); cross-tenant journal/ledger
entries refuse (`replay.tenant-mismatch`, offender named); a structurally
broken ledger refuses (`replay.ledger-refused` — never a fabricated
timeline). HONEST SCOPE (D-3): the durable MissionJournal replay is
TL-owned (`@fleetos/mission`, kernel-only dep) — this journey replays this
lane's real records; the mission-package replay view is TL shell proposal
S-3.

### D4 — Predictive honesty (journey 16, `security.predictive-honesty` + the host honesty layer)

- `advisory: true` machine-carried end-to-end (card → board → route;
  a marker-stripped prediction refuses at the card boundary);
- provenance (modelVersion + method + inputDigest + observation refs),
  uncertainty (integer bps / honest null for world-context) and model
  identity surfaced on the host view models;
- **the JEPA structural analogue is labeled deterministic structural/
  reference — NEVER claimed trained/validated**: `classifyModelHonesty`
  discloses `modelClass: "deterministic-structural-reference"`,
  `trainedValidated: false`, `structuralAnalogue: true`, with a statement
  that explicitly names the hash-derived structural nature and denies
  training/validated accuracy — machine-tested against the REAL
  `predictJepa` output (space version `jepa-1.0.0`, uncertainty method
  `jepa.latent-sqrt`, deterministic re-prediction);
- **structural-vs-trained differentiation MACHINE-READABLE**:
  `ModelHonestyDisclosure.modelClass` is a closed two-value vocabulary
  carried per-card and as a registry view on the route
  (`modelHonestyRegistryView`); the trained/validated list is HONESTLY
  EMPTY (no trained models shipped — pinned);
- **fail-closed honesty**: an UNKNOWN model identity is REFUSED
  (`honesty.unknown-model-identity` at classification;
  `advisory.model-honesty-refused` refuses the whole route) — the class is
  never guessed, and no advisory renders without its honest class (D-6).

### D5 — Security corpus extension (13 → 17 distinct journeys)

Four genuinely distinct journeys, each driving REAL surfaces no other
journey covers (identical reruns never count — the corpus invariant tests
pin uniqueness of journey ids; the four new capability vocabulary entries
mirror the F300B deliverable list, D-1):

| # | journey | persona | capabilities (new in bold) |
|---|---------|---------|---------------------------|
| 14 | security.guardian-e2e | tenant-operator | **guardian-e2e-authorization**, guardian-decision, understand-evidence, execution-ledger |
| 15 | security.mission-replay | compliance-auditor | **mission-replay**, decision-provenance, execution-ledger |
| 16 | security.predictive-honesty | ml-engineer | **predictive-honesty**, predictive-advice |
| 17 | security.host-surface | security-analyst | **host-surface-integration**, decision-provenance, tenant-isolation |

Corpus ledger: **13 → 17 distinct machine-run journeys** (security
acceptance suite 90 → 103 tests). The per-firm counted-journey ceiling for
security grows 13 → 17; Worker C owns the adoption ledger update under the
scoped grant — recorded here for C's honest re-count (F271 shortfall law:
threshold never silently weakened).

### D6 — Browser-journey scripts

`docs/evidence/F300B/journeys/` — README + 4 scripts (guardian-e2e,
inspect-why-mission-replay, advisory-honesty,
refusals-tenant-fail-closed) with steps over the HostSurface routes,
expected-vs-actual recording template, negative checks, and the
contract's honesty law (browser runs complete at F301 against the
deployed shell; machine-run corpus + scripts constitute lane evidence
until then — never fabricated).

## 4. Test accounting — 64 net-new (packet floor: the corpus grows)

```text
safety-intel         host-surface 29 + host-honesty 22      = +51  (113 → 164)
acceptance/security  4 journeys + updated pins/spot checks   = +13  ( 90 → 103)
                                                        total +64
```

Every test was run and passed in this session (HONESTY LAW) — outputs in §5.

## 5. Gates — machine-run exact (final code state)

```bash
cd packages/experiences/safety-intel && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
# Tests 164 passed (164) · tsc exit 0 · Found 0 warnings and 0 errors
cd ../../packages/acceptance/security && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
# Tests 103 passed (103) · tsc exit 0 · Found 0 warnings and 0 errors
```

All six acceptance suites machine-run at this tree (grow-only law held):

```text
field 61 · security 103 (was 90, grew with the corpus) · commerce 65 ·
adoption 90 · release 88 · convergence 82
```

Monorepo total: lane deltas +64 (safety-intel +51, acceptance/security
+13); the full `pnpm -r test` total (baseline 4,742) is the TL merge-time
gate — arithmetic expectation 4,806, NOT claimed as machine-run here.

Boundary scan (touched packages): imports ONLY from the 12 lane packages
(`rg 'from "@fleetos/..."'` — allow-list exact). Purity sweep: no
Date.now/Math.random/new Date/setInterval/setTimeout/fetch in src (comment
mentions only). File law: all touched src files ≤ 400 lines (max:
view-models.ts 355). `git status` shows only owned paths (§1).

## 6. Decisions (smallest-compliant, recorded per AGENTS.md)

- **D-1 vocabulary extension:** `JOURNEY_CAPABILITIES` 13 → 17 mirroring
  the F300B deliverable list (the F270B precedent: the vocabulary mirrors
  the lane's deliverable lists, grow-only; header law updated).
- **D-2 latent-defect fix:** `fixture-world.ts` `isoOfEpochMs` computed the
  seconds field in MILLISECONDS (missing `/1000`) — sub-minute offsets
  produced malformed ISO strings (`18:50:500.000Z`). Invisible to the F270B
  corpus (nothing re-parsed those strings); surfaced by the F300B
  mission-replay journey (`isoToMs`). Fixed with real ms-fraction output;
  all three existing ISO pins still pass; the 13 original journeys remain
  green.
- **D-3 mission-replay scope:** the durable MissionJournal replay is
  TL-owned; this lane's replay-of-record surfaces are the execution-ledger
  + incident replays — journey 15 drives them over real records. TL
  proposal S-3.
- **D-4 host contract mirror:** `HostTenantContext` is a LOCAL structural
  mirror of the kernel `TenantContext` (no cross-context import;
  `cross-tenant-forbidden` rejected by construction upstream, so the mirror
  accepts only legal scopes).
- **D-5 honest not-composed:** optional route sections carry explicit
  `composed: false` markers instead of fabricated views.
- **D-6 fail-closed honesty:** unknown model identities refuse rather than
  guess a class; the trained registry is honestly empty.

## 7. Negative / refusal fixture inventory (all machine-asserted with reason codes)

```text
guardian-e2e      authorizeCommand refuses BLOCK       refused.block_verdict
                  irreversible policy refusal           BLOCK / block.policy_fail_closed
                  cross-tenant policy decision          BLOCK / block.cross_tenant
                  unmatched capability (no rule)        BLOCK / block.no_matching_rule
                  tampered ledger entry                 verified=false, brokenAt=1, ledger.entry_digest_mismatch
mission-replay    cross-tenant journal entry            replay.tenant-mismatch (journal:<eventId>)
                  cross-tenant ledger entry             replay.tenant-mismatch (ledger#<index>)
                  structurally broken ledger            replay.ledger-refused (no fabricated timeline)
                  reversed ledger, raw replay           ledger.index_gap (layering documented)
                  divergence detection                  field class kind/source + timeline-length
predictive-honesty unknown model identity (classify)    honesty.unknown-model-identity
                  unknown model identity (route)        advisory.model-honesty-refused
                  stripped advisory marker              advisory.card-refused / card.non-advisory-input
host-surface      empty tenant id                       host.missing-tenant
                  malformed context                    host.invalid-context
                  cross-tenant finding (whole view)     route findings-board / views.cross-tenant-finding
                  cross-tenant prediction (host)        route advisory-board / advisory.cross-tenant-prediction
                  unknown intent event                  intent.unknown-event
                  missing required input               intent.missing-required-input
host tests        cross-tenant policy/grant/queue/ledger/audit/action/evidence/context — each refuses the whole view
                  honest not-composed ×3                plan-not-composed / action-not-composed / no-advisory-cards
```

## 8. Shell-change proposals to TL (TL-owned paths — proposals only)

- **S-1 mount:** mount `@fleetos/experience-safety-intel/host`
  (`SAFETY_INTEL_HOST_SURFACE`) in the F301 shell; route the 7 routeIds at
  TL-chosen URLs; bind the 3 intent events to the control-plane
  `CommandQueue.submit` through the CommandDraft seam
  (`toSubmitInput`-class binding — TL work per the contract).
- **S-2 self-scope:** `HostTenantContext.scope` is carried verbatim on the
  view models; record-level self-scope filtering must happen in the
  identity domain's read side (the lane's read-models carry no per-record
  ownership fields — documented residual).
- **S-3 mission replay view:** compose the TL-owned
  `buildMissionReplayView` (control-tower) / MissionJournal replay into the
  shell's navigation if mission-level replay is wanted; this lane's
  inspect-why + execution-results routes already present its replay
  records.
- **S-4 registry panel:** render the route-carried model-honesty registry
  verbatim ("no trained/validated models shipped").
- **S-5 named refusal states:** render `advisory.model-honesty-refused`,
  `host.missing-tenant`, `host.invalid-context`, and the whole-view tenant
  refusals as distinct named states (never generic errors, never partial
  views).

## 9. Honest residuals

- Browser journeys are SCRIPTS ONLY at this commit — the F301 shell is not
  yet deployed; browser evidence completes at F301/F302 (contract §4
  honesty law; nothing fabricated here).
- The monorepo-wide `pnpm -r test` total is NOT machine-run by this lane
  (TL merge-time gate); the arithmetic expectation is stated in §5.
- `predictJepa`'s `readouts` surface (latent decodings) is asserted for
  determinism + provenance only — no accuracy claims anywhere (the packet
  law; the honesty registry enforces it structurally).
- The F271 adoption ledger is NOT updated by this lane (Worker C's scoped
  grant); §3-D5 records the honest corpus delta (13 → 17) for C's re-count.
- `evidence-view.ts` joins `EvidenceMetadata` records to chain entries but
  presents artifact counts only (no artifact bytes cross the view boundary
  — content stays in the object store).

## 10. TL re-run commands (at the nominated commit)

```bash
git checkout work/f300b
corepack pnpm install --filter @fleetos/experience-safety-intel... --filter @fleetos/acceptance-security... --prefer-offline --ignore-scripts
cd packages/experiences/safety-intel && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd ../../packages/acceptance/security  && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint
cd ../../acceptance/field     && corepack pnpm run test   # 61
cd ../security                && corepack pnpm run test   # 103
cd ../commerce                && corepack pnpm run test   # 65
cd ../adoption                && corepack pnpm run test   # 90
cd ../release                 && corepack pnpm run test   # 88
cd ../convergence             && corepack pnpm run test   # 82
```
