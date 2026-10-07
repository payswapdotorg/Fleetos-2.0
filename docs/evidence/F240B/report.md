# F240B — Worker B (Safety + Intelligence) Wave 4 Completion Evidence

- **Work item:** F240B — Security/Guardian/Predictive experiences (Wave 4 lane B)
- **Owner:** Worker B (Safety + Intelligence)
- **Base commit:** `9a5207c` (branch `work/f240b`, the TL's Wave-4 dispatch commit)
- **Branch:** `work/f240b`
- **Date:** 2026-10-07
- **Session note:** CONTINUATION session (`fleetos-worker-b-w4-cont`, Task `9-b`).
  The prior session wrote the full implementation but hit a context deadline
  BEFORE gating/committing. This session read every `src` + `tests` file,
  machine-assessed the WIP, re-verified the consumed-package baselines, ran
  every gate (ALL PASSED FIRST-RUN — **zero source edits were needed in this
  session**), verified boundary + determinism, wrote this report, committed and
  pushed. Nothing below was claimed that was not run (HONESTY LAW).

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-b, new grant in this dispatch):

- `packages/experiences/safety-intel/**` (new package)
- `docs/evidence/F240B/**` (this report)

Commit contents: 13 files — `package.json`, `tsconfig.json`, 6 `src/*.ts`,
5 `tests/*.test.ts` — plus this evidence directory. `dist/` and `node_modules/`
exist in the worktree (filtered install artifacts) and are covered by the
root `.gitignore` (lines 1–2) — verified with `git check-ignore` and NOT
committed. `pnpm-lock.yaml` and `pnpm-workspace.yaml` are tracked and
**byte-identical to HEAD** (`git diff HEAD --stat` empty); neither is in the
commit.

## 2. What was delivered

`packages/experiences/safety-intel` — `@fleetos/experience-safety-intel`
(private, Apache-2.0, `type: module`, mission-package conventions). `exports`
map covers `.` + exactly one subpath per deliverable module (additive only —
this is a new package; no existing surface touched):

```text
.                  -> ./src/index.ts
./finding-views    -> ./src/finding-views.ts
./guardian-views   -> ./src/guardian-views.ts
./inspect-views    -> ./src/inspect-views.ts
./advisory-cards   -> ./src/advisory-cards.ts
./command-intents  -> ./src/command-intents.ts
```

`workspace:*` dependencies on exactly the eight own-lane packages
(security, policy, actions, execution, evidence, predictive, world-model,
world-context). The experience plane sits ABOVE the domain kernel, projected
READ-ONLY.

### 2.1 `finding-views.ts` (316 lines) — deliverable 1

Security findings intake views:

- **Severity rollup** — total + by-severity + by-confidence counts, top-5
  finding kinds (count desc, kind asc), FNV-1a digest.
- **Triage queue** — ordered severity desc → confidence desc → findingId asc
  (all DERIVED orderings; input order never leaks — test-proven by reversed
  input); per-item evidence-ref and asset counts; queueRank.
- **Remediation progress, evidence-gated** — three explicit gates
  (approval-evidence, verification-evidence, verification-outcome) each with
  satisfied + evidenceRef. The stage FOLLOWS THE EVIDENCE, never the domain
  record's word: a record claiming `verified`/`applied`/`approved` without the
  supporting evidence refs is presented `evidence-inconsistent`, and
  `remediated: true` requires state=verified AND a verified outcome —
  remediation is never auto-done (test-proven with three FORGED cases).
- Refusals (each test-covered): `views.missing-tenant`,
  `views.cross-tenant-finding`, `views.cross-tenant-proposal`,
  `views.duplicate-finding-id`, `views.duplicate-proposal-id` — whole-view
  fail-closed, offender named in the detail, no partial state.

### 2.2 `guardian-views.ts` (399 physical / ~314 counted lines) — deliverable 2

Guardian/policy/action views:

- **Rule catalog** — policy rules ordered priority desc → ruleId asc with a
  deterministic applicability summary (`risks <floor>..<ceiling>,
  tenant-scope <s>, authority <kinds|none>`), verdict→flavor mapping and
  flavor counts.
- **Capability-ceiling board** — per capability: covered/missing authority
  (declared-order projections), active-grant count (only ACTIVE and
  unexpired-at-logical-now grants count), and `ceilingSatisfied`. The
  "ceilings are NOT authorizations" vocabulary (law A5 / AGENTS.md) is carried
  STRUCTURALLY: every entry machine-carries
  `ceilingSatisfiedIsNotAuthorization: true`, the type has NO `authorized` /
  `verdict` field at all, and non-assignability to `GuardianDecision` is
  compile-pinned (`@ts-expect-error`). No function in this module produces a
  GuardianDecision.
- **Action-plan board** — plan steps joined onto the execution command queue
  BY THE DOMAIN idempotency key (`stepIdempotencyKey` — the real
  `@fleetos/actions` function, not a re-implementation); per-step queue
  status (`not-submitted` when unjoined), attempts, last failure reason,
  completedAt, and DEAD-LETTER visibility (`deadLettered`, `deadLetteredAt`,
  board-level `deadLetterCount`).
- Refusals: `views.missing-tenant`, `views.cross-tenant-policy`,
  `views.cross-tenant-capability` (declared but structurally unreachable via
  the typed input — see §7), `views.cross-tenant-grant`,
  `views.cross-tenant-plan`, `views.cross-tenant-lifecycle`,
  `views.cross-tenant-queue`, `views.plan-lifecycle-mismatch`,
  `views.plan-step-count-mismatch`, `views.queue-command-foreign`,
  `views.duplicate-queue-key` — all test-covered except the declared-but-
  unreachable one (documented honestly in §7).

### 2.3 `inspect-views.ts` (321 lines) — deliverable 3

The "why did this happen" surface — decision provenance over the
actions/execution journals:

- Each presented decision links: the **guardian block** (verdict, reasonCode,
  matchedRuleId, decisionDigest), the **reason chain** (the ordered
  rule-evaluation with per-link ruleId/flavor/reasonCode/matchedFactCount),
  the **capability grants in force** (filtered to the action's capability,
  grantId-ordered, status visible), the **execution journal slice** (index
  order, per-entry audit digest), and **evidence refs** (the action's
  evidence ref + the A13 traceability chain links).
- **Honest degradation**: an action not yet authorized is presented with
  `authorizationPending: true` and a NULL guardian block — authorization is
  never invented (test-covered).
- **Tamper-evident chain digest** over the PRESENTED chain;
  `verifyDecisionProvenanceDigest` recomputes it — tampering with ANY
  presented field (verdict, reason code, reason-chain link, grant, journal
  digest, evidence ref, action state, intent id, pending flag) is detected
  (9 tamper cases test-covered).
- Refusals: `views.missing-tenant`, `views.cross-tenant-action`,
  `views.cross-tenant-evaluation`, `views.cross-tenant-grant`,
  `views.cross-tenant-journal`, `views.cross-tenant-trace`,
  `views.journal-out-of-order`, `views.evaluation-capability-mismatch`,
  `views.trace-intent-mismatch` — each with an exact test case.

### 2.4 `advisory-cards.ts` (303 lines) — deliverable 4

Predictive/world-context advisory presentation. The ADVISORY LAW (A2) is
enforced at the view boundary by FOUR mechanisms (documented for TL
adjudication):

1. `advisory: true` is machine-carried on every card AND on the board; the
   `isAdvisoryCard` runtime guard verifies it on untrusted input — a
   marker-stripped JSON copy is REJECTED (test-proven).
2. A module-private `unique symbol` brand makes `AdvisoryCardView`
   non-constructible outside the module (compile-pinned) — an authoritative
   record cannot be dressed up as a card, and a deserialized card cannot
   re-enter typed (compile-pinned).
3. Compile-pinned `@ts-expect-error` proofs: a card is NOT assignable to
   `SecurityFinding`, `FindingIntakeCandidate`, `WorldEntitySnapshot`, or
   `TwinStateInput` — a card feeding back as authoritative state is a TYPE
   ERROR.
4. The prediction-card builder VERIFIES the marker on its INPUT via the
   domain's real `isAdvisoryPrediction` guard — a stripped prediction is
   refused (`card.non-advisory-input`) before presentation.

Confidence is surfaced as INTEGER basis points (0..10000) validated on every
projected point, presented as the MINIMUM across points (conservative
headline). World-context cards carry `confidenceBps: null` — honest, never
invented. Staleness classification for world-derived items reuses the
world-model's pure `classifyStaleness` at a caller-supplied logical `nowMs`
(fresh/stale/unknown, `ageMs`, never-observed → unknown + null age). Redaction
proof: the world-context card presents COUNTS only — no feature key, value, or
`[REDACTED]` sentinel appears anywhere in the serialized card (test-proven).
Refusals: `card.missing-tenant`, `card.no-cards`, `card.non-advisory-input`,
`card.empty-projection`, `card.invalid-confidence-bps`,
`card.invalid-thresholds`, `card.cross-tenant-card` — each with an exact test.

### 2.5 `command-intents.ts` (261 lines) — deliverable 5

Typed intent builders (request remediation, propose action-plan step, request
advisory refresh) producing inert `CommandDraft` records:

- **The LOCAL structural seam** — `SubmitCommandInputMirror` mirrors
  `@fleetos/control-plane`'s `SubmitCommandInput`
  (`packages/control-plane/src/queue.ts`, lines 111–118) field-for-field:
  `kind` / `payload` / `idempotencyKey` / `issuedAt` / `notBefore?`. There is
  NO `@fleetos/control-plane` import (packet law); the mirror is local and a
  CommandDraft is STRUCTURALLY ASSIGNABLE to it with zero adaptation —
  compile-pinned WITHOUT `@ts-expect-error` (the positive-assignment proof).
  See seam §6.2.
- Every draft machine-carries `intent: { …, draft: true }`, a
  `requiredCapabilityId` (a capability REQUIREMENT, never an authorization)
  and a mandatory non-empty `reason` (A4's propose leg).
- **Never executes, never bypasses Guardian**: no submit/execute function is
  exported at all; compile-pinned proofs that a CommandDraft is NOT a
  `GuardianDecision` and NOT an `AuthorizedCommand` (the only input the
  executor accepts); no `authorization`/`verdict`/`authorizationDigest` field
  exists (runtime `in` checks test-proven).
- Deterministic idempotency keys (`kind|tenantId|intentId`), deduped+sorted
  payload collections. Refusals: all 14 codes with exact test cases
  (`intent.missing-{tenant,intent-id,actor,capability,reason,proposal,
  finding,plan,step,asset,metric}`, `intent.invalid-{issued-at,not-before,
  horizon}`).

## 3. Tests

Baselines machine-re-verified in this worktree session (the eight consumed
own-lane packages — untouched by this WIP, all green):

```text
packages/security       116 tests (5 files)
packages/policy         112 tests (5 files)
packages/actions         73 tests (4 files)
packages/execution       90 tests (6 files)
packages/evidence        82 tests (3 files)
packages/predictive      61 tests (3 files)
packages/world-model     42 tests (3 files)
packages/world-context   34 tests (3 files)
domain total            610 tests, 0 failures
```

Net-new in this work item (packet target ≥ 45):

```text
packages/experiences/safety-intel   104 tests (5 files) — ALL green first-run
  tests/finding-views.test.ts    23
  tests/guardian-views.test.ts   18
  tests/inspect-views.test.ts    19
  tests/advisory-cards.test.ts   18
  tests/command-intents.test.ts  26
```

### Test themes covered (meaningful, not shape-only)

- **finding-views**: severity/confidence rollup math; top-kind ordering
  (count desc, kind asc) + cap at 5; triage ordering (severity desc →
  confidence desc → findingId asc) with input-order-independence proof;
  evidence-gate presentation incl. three FORGED lifecycle states →
  `evidence-inconsistent` (never auto-done) and honest failed-verification;
  gate refs; summary counts; duplicate-id refusals; tenant fail-closed with
  offender-named details; byte-identical determinism + digest
  order-independence.
- **guardian-views**: catalog ordering + applicability summaries; verdict→
  flavor mapping + counts; covered/missing authority projection; only
  active+unexpired grants counted (revoked/expired/foreign-capability
  excluded); the machine-carried not-an-authorization marker + `in`-checks
  proving no `authorized`/`verdict` field; compile-pinned ceiling ↛
  GuardianDecision; queue join by the REAL domain idempotency key; dead-letter
  visibility (attempts, reason, deadLetteredAt) + deadLetterCount;
  not-submitted presentation; foreign queue command refused; duplicate queue
  key refused; lifecycle id/step-count mismatches refused; every cross-tenant
  input refused; determinism.
- **inspect-views**: full provenance linkage (guardian block, reason chain
  with matchedFactCount, grants filtered+ordered, journal slice, evidence
  refs incl. trace links); honest authorizationPending + null guardian;
  capability-scoped grant filtering; 9 tamper cases all detected by
  `verifyDecisionProvenanceDigest`; untouched view verifies; every refusal
  code with an exact case; byte-identical determinism.
- **advisory-cards**: predictions produced by the REAL deterministic
  reference model (`projectReferenceTwin` — intra-lane test composition
  site); advisory:true carried structurally; min-integer-bps confidence;
  provenance surfaced; staleness fresh/stale/unknown from the data anchor at
  caller-supplied logical now (incl. exact ageMs); stripped-input REFUSAL
  (marker verified on input); empty-projection + invalid-bps + invalid-
  thresholds refusals; world-context card honest null confidence; REDACTION
  PROOF (no feature key/value/sentinel in serialized output; counts only);
  never-observed → unknown; the four advisory-law mechanisms (compile-pinned
  non-assignability to 4 authoritative types, module-private brand,
  JSON-round-trip non-re-entry, runtime guard); board ordering + digest +
  cross-tenant/empty refusals; byte-identical determinism.
- **command-intents**: all three builders' exact draft shapes (kind,
  idempotency key, payload, intent metadata); dedupe+sort of finding ids;
  notBefore carried through the seam; the seam's positive structural
  assignability (NO `@ts-expect-error` — must compile); compile-pinned
  never-a-GuardianDecision / never-an-AuthorizedCommand; no authorization
  field (`in`-checks); ALL 14 refusal codes with exact cases; byte-identical
  determinism; distinct intents → distinct keys; advisory-shaped values
  cannot feed back as intent inputs (compile-pinned).

## 4. Gate outputs (exact)

Run in `packages/experiences/safety-intel` (package dir, per packet). Root
gates were NOT run (packet instruction; TL gates at merge time).

```text
$ corepack pnpm run test
 ✓ tests/guardian-views.test.ts (18 tests) 7ms
 ✓ tests/advisory-cards.test.ts (18 tests) 10ms
 ✓ tests/inspect-views.test.ts (19 tests) 9ms
 ✓ tests/finding-views.test.ts (23 tests) 10ms
 ✓ tests/command-intents.test.ts (26 tests) 7ms
 Test Files  5 passed (5)
      Tests  104 passed (104)

$ corepack pnpm run typecheck
> @fleetos/experience-safety-intel@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)

$ corepack pnpm run lint          # package script: oxlint src
Found 0 warnings and 0 errors.
Finished in 10ms on 6 files using 2 threads.

$ npx oxlint src tests            # max-lines applies to src; tests exempt per root .oxlintrc.json
Found 0 warnings and 0 errors.
Finished in 11ms on 11 files using 2 threads.
```

Lint law: max src file `guardian-views.ts` — 399 physical / ~314
blank-and-comment-skipped lines (limit 400, `skipBlankLines` +
`skipComments`). Largest test file 476 physical lines — test files are
exempt from `max-lines` by the repo's root `.oxlintrc.json` override
(`**/*.test.ts` → `max-lines: off`), and `oxlint src tests` reports 0 errors.
A root-repo `oxlint` run reports 70 warnings / 0 errors on 2969 files —
byte-identical to the TL's documented main baseline (my 11 files contribute
zero warnings; the package-dir runs above are the authoritative proof).

## 5. Boundary verification (machine-tested)

The packet's exact self-check:

```text
$ grep -rEn "from ['\"]@fleetos/" packages/experiences/safety-intel/src | grep -vE "@fleetos/(security|policy|actions|execution|evidence|predictive|world-model|world-context)['\"]" || echo CLEAN
CLEAN
```

Import census (public entry points only, no deep paths — every import is
`@fleetos/<pkg>` root form):

```text
src:    actions×3  evidence×1  execution×2  policy×2  predictive×2  security×1  world-context×1  world-model×2
tests:  actions×2  evidence×1  execution×3  policy×4  predictive×2  security×3  world-context×1
```

Three RUNTIME value imports only (`stepIdempotencyKey` from `@fleetos/actions`,
`isAdvisoryPrediction` from `@fleetos/predictive`, `classifyStaleness` from
`@fleetos/world-model`); all other src imports are TYPE imports. In tests,
the single runtime import is the reference model `projectReferenceTwin`
(`@fleetos/predictive` — the intra-lane test composition site). Zero imports
from `@fleetos/control-plane`,
`@fleetos/kernel`, TL or other lanes' packages. Zero non-`@fleetos` runtime
dependencies (devDependencies: typescript + vitest only).

Determinism sweep over `src` + `tests`:

```text
$ grep -rnE "Date\.now\(|Math\.random\(|setTimeout|setInterval\(|fetch\(|new Date\(" src tests
packages/experiences/safety-intel/src/index.ts:20: * Determinism laws: no Date.now(), no Math.random(), no network, no timers.
(1 hit — a documentation comment; ZERO code hits)
```

All `@fleetos/*` imports resolve through `node_modules` symlinks to the real
package roots and their REAL `exports` maps (all eight lane-B packages have
exports maps — unlike the F240C lane, NO tsconfig/vitest bridge was needed
here; verified `node_modules/@fleetos/security` → `/home/z/w-f240b/packages/security`).

`git status` at commit time: ONLY `packages/experiences/` untracked (+ this
evidence dir); `pnpm-lock.yaml` + `pnpm-workspace.yaml` clean vs HEAD;
`dist/` + `node_modules/` ignored (verified via `git check-ignore`).

## 6. Seam findings for TL adjudication

### 6.1 S1 — `pnpm-workspace.yaml` has no `packages/experiences/*` glob (HEADLINE, shared with F240A/F240C)

The packet's mandated filtered-install command
(`corepack pnpm install --filter @fleetos/experience-safety-intel …`) fails
at HEAD ("No projects matched the filters") because the workspace globs cover
`packages/*` and `packages/integrations/*` only. The PRIOR session bridged
the glob locally (uncommitted) and completed the filtered install — the
bridge was then REVERTED; `pnpm-workspace.yaml` is byte-identical to HEAD and
is NOT in my commit. This continuation session needed no re-install (the
worktree `node_modules` + symlinked deps remain). **TL action at merge: add
`packages/experiences/*` (or an explicit entry) to `pnpm-workspace.yaml` —
the same step F240A and F240C require.** `pnpm-lock.yaml` carries no mutation
from this lane (clean at HEAD).

### 6.2 S2 — `CommandDraft` ↔ control-plane submit contract

`SubmitCommandInputMirror` was copied field-for-field (incl. the optional
`notBefore` and its JSDoc) from `packages/control-plane/src/queue.ts`
`SubmitCommandInput` (read via git objects — never imported; packet law).
The compile-pinned test proves a `CommandDraft` is structurally assignable to
the mirror with zero adaptation (a POSITIVE proof — no `@ts-expect-error` on
that assignment). TL decisions requested:

1. **Contract unification** — keep the local mirror (experience plane stays
   control-plane-free) vs publish a shared contract type. If the
   control-plane contract changes, this seam must be re-adjudicated (the
   mirror is shape-checked only on my side; TL binds the real
   `submit(draft)` at the composition site).
2. **Actor context** — the draft carries `intent.actorId` locally; the real
   submit takes a kernel `TenantContext` (actorId/sessionId) at the boundary.
   Should the draft's actor metadata be authoritative or purely
   presentation? (F240C raised the same question.)
3. **Payload schema registry** — `payload: unknown` on the mirror matches the
   control plane; each builder emits a fixed payload shape
   (`security.remediation.request`, `actions.plan-step.propose`,
   `predictive.advisory.refresh-request`). A canonical per-kind payload
   schema registry is a TL composition-time decision.
4. **Validation strictness delta (honest)** — drafts validate `issuedAt` /
   `notBefore` as positive INTEGERS; the control-plane queue validates
   positive finite NUMBERS (`Number.isFinite`). Both reject ≤ 0 and every
   draft the builder accepts would pass the queue's check (integer ⊂ finite),
   so no draft can be built that the queue would reject on these fields —
   but the inverse is not guaranteed. Noted, not silently normalized.

### 6.3 S3 — advisory law at the view boundary (the proof mechanism)

Four mechanisms (see §2.4): (1) machine-carried `advisory: true` verified by
`isAdvisoryCard` on untrusted input (stripped copies rejected); (2)
module-private `unique symbol` brand — cards constructible only inside the
module; (3) compile-pinned non-assignability to `SecurityFinding`,
`FindingIntakeCandidate`, `WorldEntitySnapshot`, `TwinStateInput` (a card
feeding back as authoritative state is a type error); (4) input-marker
verification via the domain's real `isAdvisoryPrediction` before
presentation. LIMITS (honest): the brand is compile-time only (symbols do not
serialize); the RUNTIME boundary for deserialized data is the `advisory: true`
marker + `isAdvisoryCard` shape guard — a fully-formed forged JSON object
carrying `advisory: true` passes the runtime guard (it cannot, however, be
typed as `AdvisoryCardView` without a cast). TL may want a signed card
envelope if the view layer ever becomes a trust boundary.

### 6.4 S4 — ceilings-are-not-authorizations vocabulary (structural)

`CapabilityCeilingEntryView` carries
`ceilingSatisfiedIsNotAuthorization: true` machine-carried; the type has NO
`authorized`/`verdict` field; compile-pinned non-assignability to
`GuardianDecision`. The action-plan board surfaces the domain lifecycle's
`authorizedStepCount` (the Guardian's own record) but computes nothing
authorization-like itself.

## 7. Residual limitations (honest list)

- **Continuation provenance**: the implementation was written by the prior
  session; THIS session made ZERO source edits — every gate (104 tests,
  typecheck, lint) passed first-run on the inherited WIP. My changes are
  exactly: this evidence report, the commit, the push, and the worklog entry.
- Per-call views — no caching/persistence layer; store→slice mapping (live
  domain stores → builder inputs) is TL composition, per the experience-plane
  law.
- FNV-1a 32-bit digests (the lane's established presentation convention —
  same as F220B/F230B/F240A/F240C); collision resistance is not a claim.
- `verifyDecisionProvenanceDigest` recomputes from the PRESENTED fields, not
  a full re-derivation from domain journals (same honest caveat as F240A's
  verify functions).
- `views.cross-tenant-capability` is DECLARED in `GuardianViewRefusal` but
  structurally unreachable via the typed input (`Capability` carries no
  tenantId — capability definitions are tenant-independent in the policy
  domain; grants carry the tenancy and ARE checked). Declared for refusal-
  vocabulary completeness; documented rather than deleted. Not test-covered
  (cannot be constructed without a cast) — noted per the honesty law.
- World-context cards carry `confidenceBps: null` (observations, not model
  output — honest no-confidence) and `modelVersion` of the form
  `world-context@<schemaVersion>`.
- The package is NOT registered in `spec/architecture-policy.yaml` /
  architecture snapshot — contract snapshot unaffected (F240A precedent);
  TL registers at merge if required. Root gates (fleetos:verify, snapshot
  regen) not run per packet — TL merge-time.
- Advisory board digest covers card identity/staleness/confidence/provenance
  but not card TITLES (titles are presentation strings; ordering by cardId
  is digest-stable regardless).
- Only logical `now` — every builder takes `nowMs`/`issuedAt` from the
  caller; no wall-clock anywhere (machine-swept).

## 8. Stop-the-line events

None. No production bugs found during continuation assessment; no test
failures; no gate failures; no boundary violations.

## 9. Verification commands for TL re-run

```bash
# after TL adds packages/experiences/* to pnpm-workspace.yaml (§6.1):
corepack pnpm install --filter @fleetos/experience-safety-intel --prefer-offline --ignore-scripts

cd packages/experiences/safety-intel
corepack pnpm run test          # expect: 5 files / 104 tests passed
corepack pnpm run typecheck     # expect: exit 0, no output
corepack pnpm run lint          # expect: 0 warnings 0 errors (6 files)
npx oxlint src tests            # expect: 0 warnings 0 errors (11 files)

# boundary self-check (packet-exact):
cd /home/z/w-f240b
grep -rEn "from ['\"]@fleetos/" packages/experiences/safety-intel/src | grep -vE "@fleetos/(security|policy|actions|execution|evidence|predictive|world-model|world-context)['\"]" || echo CLEAN

# baselines (consumed packages, this worktree):
for p in security policy actions execution evidence predictive world-model world-context; do
  (cd packages/$p && corepack pnpm run test 2>&1 | grep -E "^\s+Tests")
done
# expect: 116 / 112 / 73 / 90 / 82 / 61 / 42 / 34 — 610 tests, 0 failures
```
