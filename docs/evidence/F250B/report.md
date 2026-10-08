# F250B — Worker B (Safety + Intelligence) Wave 5 Completion Evidence

- **Work item:** F250B — Arena + learning/evaluation adapters (Wave 5 lane B)
- **Owner:** Worker B (Safety + Intelligence)
- **Base commit:** `15289ec` (branch `work/f250b`, the TL's Wave-5 dispatch commit)
- **Branch:** `work/f250b`
- **Date:** 2026-10-07 (implementation) / 2026-10-08 (continuation verification)
- **Session note:** CONTINUATION session (Task `1-b`, agent `Worker B (F250B)`).
  The prior session wrote the full implementation, committed it as `a56f8f1`
  with the packet commit message and pushed — but hit its deadline BEFORE the
  worklog entry. This session inherited that state: `git status` clean, no
  stashes; it machine-verified the TRUE HEAD baseline from a clean state
  (both packages' full suites green at `a56f8f1`, counts below), re-ran the
  pre-existing (base-`15289ec`-identical) test files to re-verify the
  baselines (arena 24, learning 25 — green), reviewed EVERY committed file
  against the packet, re-ran every gate, made ONE comment-only precision fix
  (two doc lines in `adoption-lifecycle.ts` that misstated the legal
  rejection domain as "proposed|guardian-review"; the exported, machine-tested
  `ADOPTION_TRANSITIONS` table correctly allows rejection only from
  `guardian-review` — zero behavior change, §8), committed the follow-up and
  appended the worklog entry. Nothing below is claimed that was not run
  (HONESTY LAW).

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-b):

- `packages/integrations/arena/**`
- `packages/learning/**`
- `docs/evidence/F250B/**` (this report)

Commit contents: 18 files — 7 new arena `src`/`tests` files + 4 new learning
`src` files + 3 new learning `tests` files + 4 additively-modified files
(arena `package.json`, `src/index.ts`, `src/degraded.ts`; learning
`package.json`, `src/index.ts`) — plus this evidence directory. `join.ts` and
both packages' pre-existing test files are byte-identical to base (empty
diff). `pnpm-lock.yaml` + `pnpm-workspace.yaml` are tracked and byte-identical
to HEAD — NOT in the commit (no dependency changes; exports-map additions do
not touch the lockfile).

```text
packages/integrations/arena/src/case-registry.ts       (new, 322 lines)
packages/integrations/arena/src/evaluation-runs.ts      (new, 349 lines)
packages/integrations/arena/src/proposal-scoring.ts     (new, 161 lines)
packages/integrations/arena/src/certification.ts        (new, 285 lines)
packages/integrations/arena/tests/{case-registry,evaluation-runs,proposal-scoring,certification}.test.ts (new)
packages/learning/src/outcome-intake.ts                (new, 265 lines)
packages/learning/src/evaluation-summary.ts             (new, 184 lines)
packages/learning/src/adoption-lifecycle.ts             (new; 384 lines at `a56f8f1`, 387 after the continuation session's comment-precision fix — still ≤ 400)
packages/learning/tests/{outcome-intake,evaluation-summary,adoption-lifecycle}.test.ts (new)
packages/integrations/arena/{src/degraded.ts,src/index.ts,package.json} (modified, ADDITIVE)
packages/learning/{src/index.ts,package.json}           (modified, ADDITIVE)
```

All pre-existing exports are unchanged — Wave 5 additions are ADDITIVE only.
Lint law: largest new src file 384 lines (limit 400, `skipBlankLines` +
`skipComments`); `oxlint src` reports 0 warnings / 0 errors in both packages.

## 2. What was delivered

### 2.1 `packages/integrations/arena` — evaluation case registry + batch runs + scored proposals + certification

**`src/case-registry.ts`** — typed case intake: validate → dedupe by
deterministic case digest → correlate by capability version → case-set
assembly:

- `CaseIntakeCandidate` (an `EvaluationCase` + provenance: `source`,
  `submittedAtMs` integer logical ms) → `intakeCases`: validates (empty
  tenant/caseId/source, non-integer or negative submit time, non-string tags,
  cross-tenant case naming the offender, same caseId with DIFFERENT content),
  dedupes exact duplicates by the deterministic `caseDigest` (FNV-1a over a
  version-prefixed canonical serialization; tags sorted+deduped — tag order
  never changes identity), and reports dropped ids in `duplicates` (replay
  idempotence). Output ordering is deterministic (caseId asc) — input order
  never leaks (machine-tested with reversed input).
- `correlateByCapability` groups registered cases by `capabilityId@version`
  in deterministic order.
- `assembleCaseSet` — deterministic ordering + `caseSetDigest` over the
  ordered member digests + sorted unique `sources`; fail-closed on empty set,
  cross-tenant case, capability mismatch. `verifyCaseSetDigest` recomputes at
  TWO levels (each member case's digest from stored content — detects case
  tampering; the set digest — detects addition/removal/reorder/tenant/
  capability/time edits).

**`src/evaluation-runs.ts`** — batch run lifecycle `staged → running →
scored → reported` (+ `aborted`):

- `stageRun` builds a run manifest (runId, tenant, capability, case-set
  digest, ordered `caseIds` membership, adapter id, `runDigest` FNV-1a over
  the manifest fields). `RUN_TRANSITIONS` is the single legal-transition
  table; every op goes through it (illegal transitions rejected with the
  from/to pair in the reason).
- `scoreRun` (running → scored): aggregates caller-supplied `CaseVerdict`s
  with INTEGER-BPS scoring — `passRateBps = round(passed/total*10000)`;
  evidence confidence `min(10000, 4000 + 600*total)` (F230B integer-bps
  count-scaled convention, documented constants, no learned weights).
  Verdict input order never leaks (ordered by caseId). Fail-closed honest
  degraded states: missing verdicts → `partial_case_set` (missing ids named),
  foreign/duplicate verdict → `foreign_case_result`, empty case set →
  `empty_case_set`.
- The scored run emits a **PURE PROPOSAL** (`ArenaRunProposal`,
  `kind: "ARENA_RUN_PROPOSAL"`, machine-carried `advisory: true`,
  `isArenaRunProposal` runtime guard rejects marker-stripped copies). There
  is NO submit/report-to-domain function (module surface machine-checked via
  `assertNoSubmitOrAdopt`); compile-pinned proof that a run proposal is not a
  Wave-0 outcome shape.
- Determinism: the full pipeline re-run produces BYTE-IDENTICAL results
  (JSON.stringify equality, machine-tested); re-scoring with identical
  verdicts + logical time is IDEMPOTENT (equal record, no duplicate history
  entry); re-scoring with different content → `already-scored` (history is
  never rewritten). `reportRun` finalizes; reported runs cannot be aborted
  (rewriting history) — aborted runs are terminal.

**`src/proposal-scoring.ts`** — proposal scoring over run results:

- FIXED deterministic ladder (`SCORING_LADDER`, exported constants, no
  learned weights): `insufficient-evidence` below 5 cases or 6000 bps
  confidence; `high` ≥ 9000 bps pass + 8000 bps confidence; `medium` ≥
  7500/6000; `low` otherwise. Deterministic rationale strings.
- Honest degraded states via the EXTENDED `ArenaDegradedState` vocabulary
  (see §2.1.4): unscored run → `run_not_scored`, empty case set →
  `empty_case_set`.
- `rankProposals` — STABLE total tie-breaks: tier rank → passRateBps desc →
  confidenceBps desc → proposalId asc; duplicate proposalIds rejected
  fail-closed; empty ranking rejected.

**`src/certification.ts`** — certification REFERENCE minting from accepted
evaluations:

- `mintCertification` — ONLY from a REPORTED run whose scored proposal
  reached the ladder's `high` tier (accepted = reported + high; strictest
  reading, documented). Immutable `CertificationRef` records with CHAINED
  digests (per-tenant genesis `cert-genesis|tenant`; `prevDigest` → `digest`
  over canonical fields incl. issuer, validity window, evidence ref, run +
  proposal ids). Fail-closed: tenant mismatches, unreported runs, non-high
  tier (`insufficient_evidence`), invalid validity windows/fields.
- `revokeCertification` — separate immutable `CertificationRevocation` record
  with a closed reason vocabulary (`expired | superseded | evaluation-fraud |
  guardian-directive | capability-retired`); deterministic revocation digest;
  rejects revocations preceding issuance.
- `propagateRevocation` — dependent proposals citing the revoked
  certification are returned BLOCKED (`certification-revoked` + revocation
  digest) — never auto-executed, never deleted. Tenant fail-closed: a
  dependent from another tenant rejects the WHOLE propagation (offender
  named).
- `verifyCertificationChain` — audit: recomputes each record's digest and
  chain linkage from the per-tenant genesis; detects field tampering, broken
  links, skipped links, cross-tenant chains.
- LAW: a certification is a REFERENCE, not an authorization — no
  authorize/execute function exists (machine-checked module surface).

**`src/degraded.ts` (modified, additive)** — `ArenaDegradedState` EXTENDED
(never duplicated) with: `partial_case_set`, `foreign_case_result`,
`insufficient_evidence`, `run_not_scored`, `certification_revoked`.
Pre-existing members and consumers unaffected; existing tests unchanged and
green.

### 2.2 `packages/learning` — outcome intake + evaluation summaries + adoption lifecycle

**`src/outcome-intake.ts`** — outcome observation intake pipeline:

- `intakeOutcomes`: validate (empty tenant/observationId/caseId/observationRef,
  non-integer or negative `observedAtMs`, same observationId with different
  content) → dedupe by deterministic `observationDigest` (FNV-1a over a
  version-prefixed canonical serialization of the full observation) → accepted
  `IntakeOutcome`s stamped with the intake tenant. Deterministic ordering
  (observedAtMs asc, observationId asc); exact duplicates dropped and
  reported (replay idempotence).
- `correlateOutcomes`: buckets by capability version + logical-time window
  (`floor(observedAtMs / windowMs)` — pure integer arithmetic, NO `new
  Date`); `OutcomeWindowGroup`s with integer-bps `successRateBps`, window
  bounds, chained group digest; deterministic (capabilityId, version,
  windowIndex) ordering; rejects non-integer/non-positive windows and empty
  tenants.
- `classifyOutcomeTrend` — `improving | stable | degrading` from half-mean
  delta in integer bps: `|delta|` must EXCEED `TREND_DELTA_BPS` (500) —
  exactly ±500 is stable (boundary machine-tested both sides); odd sequences
  weight the second half heavier (documented); < 2 points default to `stable`
  (conservative-neutral, documented). `classifyGroupTrend` applies it to
  correlated groups.

**`src/evaluation-summary.ts`** — multi-case evaluation summaries (extends
the `computeEvaluationSummary` concept from join.ts to whole-evaluation
aggregation):

- `summarizeCapabilityEvaluations` aggregates `CapabilityEvaluation`s:
  totals, integer-bps `successRateBps`, per-evaluation provenance digests
  (`evaluationDigest`) + a chained `provenanceDigest`, trend classification
  (reuses `classifyOutcomeTrend` over the ordered per-evaluation success
  rates), and integer-bps score bands (`strong ≥ 9000 | adequate ≥ 7500 | weak
  | insufficient-evidence` below a 5-case floor). Evaluations ordered by
  (evaluatedAt asc, evaluationId asc) — input order never leaks (reversed ==
  identical, machine-tested). Fail-closed: empty tenant/list, invalid logical
  time, cross-tenant evaluation (offender named), mixed capabilities.
- **Advisory-only law STRUCTURAL**: summaries machine-carry `advisory: true`
  + `kind: "LEARNING_EVALUATION_SUMMARY"` + a module-private `unique symbol`
  brand (not constructible outside the module — compile-pinned test proves a
  forged literal fails to type); `isCapabilityEvaluationSummary` runtime
  guard accepts a JSON round-trip of a real summary and REJECTS
  marker-stripped copies; compile-pinned `@ts-expect-error` proofs that a
  summary is NOT assignable to `CapabilityEvaluation` and that an
  authoritative evaluation is NOT assignable to the advisory shape.

**`src/adoption-lifecycle.ts`** — adoption proposal lifecycle:

- `proposed → guardian-review → authorized | rejected → adopted | withdrawn`
  (`ADOPTION_TRANSITIONS` exported as the single legal-transition table;
  rejected/adopted/withdrawn are TERMINAL; withdrawal allowed from
  proposed/guardian-review/authorized).
- **Guardian authorization is an INPUT**: `authorizeAdoption` requires a
  caller-supplied `GuardianAuthorization` (id, integer decision time, actor,
  decision digest — shape-validated) and applies the EXISTING
  `markProposalAuthorized` law (the embedded proposal's status becomes
  `authorized`). Nothing in the module produces an authorization by itself —
  there is no self-authorization path (module surface machine-checked with
  `assertNoAdoptFunction`: no `adopt`/`execute`/`activate`/`install`).
- Idempotent transitions: re-applying the SAME transition (same
  authorization / rejection / evidence / withdrawal) returns an EQUAL record
  with no duplicate history entry; conflicting re-application
  (`already-authorized`, different rejection reason, different adoption
  evidence) is rejected — history is never rewritten.
- Rejection reason codes: `insufficient-evidence | policy-violation |
  guardian-rejected | certification-revoked | duplicate-proposal |
  proposer-withdrawal` (applied via the existing `markProposalRejected`).
- `completeAdoption` is evidence-gated (authorized → adopted requires a
  non-empty adoption evidence ref).
- `cascadeCertificationRevocation` — a revocation notice force-rejects
  DEPENDENT adoption proposals (citing the revoked certification) that have
  not completed adoption, with reason code `certification-revoked` and the
  revocation digest in the note; TERMINAL records (adopted/rejected/
  withdrawn) are returned UNCHANGED and listed in `skipped` (history never
  rewritten). Fail-closed: empty notice tenant or a record from another
  tenant rejects the WHOLE cascade (offender named) — no partial application.
- Determinism: `recordDigest` (FNV-1a over the canonical record incl.
  history) advances on every transition; the same operation sequence
  produces byte-identical records.

## 3. Tests

Baselines machine-re-verified in this worktree BEFORE the first edit
(established law: baseline before edit):

```text
packages/integrations/arena   24 tests (3 files) — all green; typecheck exit 0
packages/learning             25 tests (2 files) — all green; typecheck exit 0
```

After F250B (all run in this session, all green):

```text
packages/integrations/arena   24 -> 94   (+70 net-new; packet target >= 40)
packages/learning             25 -> 78   (+53 net-new; packet target >= 25)
lane total                    49 -> 172  (+123 net-new)
```

### Test themes covered (meaningful, not shape-only)

- **case-registry** (20): intake validation incl. every rejection code with
  offender-named details; digest determinism + tag-order normalization;
  exact-duplicate dedupe + replay idempotence; order-independence (reversed
  input, identical result); same-id-different-content conflict; capability
  correlation grouping/order; case-set assembly (ordering, digest, sorted
  sources, byte-identical determinism); empty-set/empty-tenant/capability-
  mismatch rejections; TWO-LEVEL tamper detection (case content edit, removed
  case, forged set digest, edited assembly time).
- **evaluation-runs** (22): manifest shape (case-set digest, adapter id, run
  digest, ordered case membership); staged-run purity (no scoring/proposal);
  tenant mismatch / empty adapter / invalid stagedAt; byte-identical staged
  runs; legal + illegal transitions incl. double-start, scoring a staged run,
  reported-is-terminal (report/abort/score all rejected), abort-from-staged;
  integer-bps scoring math (6000 bps for 3/5; confidence 4000+600*n; cap at
  10000); verdict-order independence; full-pipeline byte-identical
  determinism; idempotent re-score (equal record, no duplicate history);
  different-content re-score rejected; partial/foreign/duplicate-verdict
  degraded states with named ids; abort reason required; invalid logical
  times on every transition; PURE-PROPOSAL law (advisory marker, stripped
  marker rejected by runtime guard, no submit/adopt on the module surface,
  compile-pinned non-assignability to outcome shapes).
- **proposal-scoring** (15): ladder tiers incl. the EXACT medium boundary
  (7500 bps), low, insufficient-evidence (case floor), the fixed constants;
  deterministic scoring; `run_not_scored` + `empty_case_set` degraded states
  (the empty-set case is a hand-built FORGED input — the public pipeline
  refuses empty sets, documented in the test); rankProposals total ordering
  incl. full-tie proposalId asc, order-independence, duplicate-id and
  empty-list rejections; advisory marker + module surface; reporting does
  not mutate the proposal.
- **certification** (13): mint from reported+high run (genesis-anchored
  chained digest, deterministic re-mint byte-identical, second cert chains
  on the first); unreported run / non-high tier / tenant mismatch / foreign
  scored proposal / invalid window+fields rejections; chain verification
  (honest chain ok; tampered field, broken prevDigest link, skipped link,
  cross-tenant chain all detected); revocation with reason + deterministic
  digest + reject-before-issuance; propagation blocks only citing
  dependents (never auto-executes) and is tenant fail-closed with the
  offender named; module surface has no authorize/execute (a certification
  is a reference).
- **outcome-intake** (17): intake validation codes; duplicate-id conflict;
  digest determinism/content-sensitivity; dedupe + order-independence;
  (observedAtMs, observationId) ordering; window bucketing math (window
  bounds, integer-bps success rates); capability-separated groups; invalid
  window/tenant rejections; trend boundaries (±500 exactly → stable, ±501 →
  improving/degrading); half-mean semantics on odd counts; <2 points →
  stable; end-to-end group trend.
- **evaluation-summary** (14): aggregate totals + integer-bps rate (15/20 →
  7500); per-evaluation digests + chained provenance digest; trend from
  ordered evaluations (improving + degrading); evaluatedAt ordering with
  reversed-input byte-identity; re-run byte-identity; all four bands + the
  fixed constants; every rejection code (empty tenant/list/time,
  cross-tenant with offender, capability mismatch); the STRUCTURAL advisory
  law (machine marker, runtime guard incl. stripped-copy rejection,
  compile-pinned non-assignability BOTH directions, module-private brand
  makes external construction a type error); evaluationDigest
  determinism/content-sensitivity.
- **adoption-lifecycle** (22): open (pending-only, tenant fail-closed,
  deterministic digest); the exact packet transition table; review mandatory
  before authorization; adoption impossible without authorization/evidence;
  terminals immutable (all ops rejected); Guardian-authorization-as-input
  (shape validation, markProposalAuthorized applied, idempotent with the
  same decision, conflicting decision rejected); rejection reason codes +
  idempotency + malformed rejections; adoption evidence-gated + idempotent;
  withdrawal from all three pre-adoption stages + idempotency; determinism
  (byte-identical operation sequences; every transition advances the
  record digest); cascade (three non-terminal dependents force-rejected
  with certification-revoked + digest; terminal record skipped with
  unchanged digest; empty notice tenant / cross-tenant record / invalid
  notice rejections); law A5 module-surface checks + compile-pinned
  not-a-Guardian-decision.

## 4. Gate outputs (exact)

Run in each package dir of the worktree (per packet §Gates). Root-level
lint/typecheck/build/snapshot were NOT run (packet instruction:
memory-constrained box; TL gates at merge time).

### 4.1 `packages/integrations/arena`

```text
$ corepack pnpm run test
 ✓ tests/certification.test.ts (13 tests) 14ms
 ✓ tests/evaluation-runs.test.ts (22 tests) 72ms
 ✓ tests/proposal-scoring.test.ts (15 tests) 34ms
 ✓ tests/case-registry.test.ts (20 tests) 9ms
 ✓ tests/kernel.test.ts (10 tests) 5ms
 ✓ tests/arena.test.ts (10 tests) 27ms
 ✓ tests/structural.test.ts (4 tests) 5ms
 Test Files  7 passed (7)
      Tests  94 passed (94)

$ corepack pnpm run typecheck
> @fleetos/integrations/arena@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)

$ corepack pnpm run lint        # package script: oxlint src
Found 0 warnings and 0 errors.
Finished in 9ms on 6 files using 2 threads.
```

### 4.2 `packages/learning`

```text
$ corepack pnpm run test
 ✓ tests/adoption-lifecycle.test.ts (22 tests) 14ms
 ✓ tests/evaluation-summary.test.ts (14 tests) 9ms
 ✓ tests/kernel.test.ts (15 tests) 7ms
 ✓ tests/outcome-intake.test.ts (17 tests) 8ms
 ✓ tests/learning.test.ts (10 tests) 7ms
 Test Files  5 passed (5)
      Tests  78 passed (78)

$ corepack pnpm run typecheck
> @fleetos/learning@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)

$ corepack pnpm run lint        # package script: oxlint src
Found 0 warnings and 0 errors.
Finished in 12ms on 5 files using 2 threads.
```

Both packages' `test` + `typecheck` + `lint` gates were RE-RUN in the
continuation session at the final commit (after the comment-only fix) with
identical results: arena 94/94 + typecheck exit 0 + lint 0/0; learning 78/78
+ typecheck exit 0 + lint 0/0.

## 5. Boundary verification (machine-tested)

The packet's own-lane self-check, run exactly as specified:

```text
$ grep -rEn "from ['\"]@fleetos/" packages/integrations/arena/src packages/learning/src | grep -vE "@fleetos/(integrations-arena|learning)['\"]" || echo CLEAN
CLEAN
```

ZERO `@fleetos/*` imports in either package's `src` — both packages remain
fully self-contained with LOCAL structural interfaces (the arena package's
established law for the @fleetos/learning concepts it references; learning
imports nothing from @fleetos/* at all). All cross-module imports are
intra-package `./` relative imports (type-only between the new siblings,
runtime imports flow through `src/index.ts` exactly as the pre-existing
`join.ts`/`degraded.ts` pattern).

Determinism sweep over both packages' `src`:

```text
$ grep -rnE "Date\.now\(|Math\.random\(|setTimeout|setInterval\(|fetch\(|new Date\(" packages/integrations/arena/src packages/learning/src
packages/learning/src/join.ts:72:      const predictedTime = new Date(predicted.predictedAt).getTime();
packages/learning/src/join.ts:73:      const nowTime = new Date(now).getTime();
```

Both hits are the PRE-EXISTING Wave-1 `join.ts` horizon-discipline code
(parses caller-supplied timestamp strings — no wall clock; `join.ts` is
byte-identical to base `15289ec`, empty diff). All F250B code uses integer
logical ms exclusively. No clock, no randomness, no network, no timers, no
new runtime deps anywhere in F250B code.

`git status` at commit time: only the two owned package trees + this
evidence dir; `pnpm-lock.yaml` + `pnpm-workspace.yaml` clean vs HEAD.

## 6. Seam findings for TL adjudication

1. **Arena ↔ learning structural compatibility remains deferred (TODO(F201),
   pre-existing)** — `pnpm-workspace.yaml` now includes
   `packages/integrations/*` (the F200B gap is closed), but arena's
   `package.json` still declares no dependency on `@fleetos/learning`, and no
   workspace package depends on `@fleetos/learning` (no symlink exists
   anywhere arena code could resolve). Wiring the dependency would require a
   lockfile-touching install — forbidden to commit here. The
   `tests/structural.test.ts` placeholder stays; binding arena's local
   interfaces to learning's canonical types at a composition site is TL's
   call (add the workspace dependency, then re-run that TODO).
2. **Two `CertificationRef` shapes now coexist in lane B** — learning's
   Wave-0 `CertificationRef` (string dates: `issuedAt`/`validUntil`,
   no digests) and arena's new Wave-5 local `CertificationRef` (integer-ms
   `issuedAtMs`/`validUntilMs`, chained digests, kind marker). The integer-ms
   form follows the F230B discipline and is required for the digest chain;
   converging the learning Wave-0 shape (or formally blessing both) is a TL
   decision. Notably `mintCertification` in arena does NOT reuse learning's
   type — deliberate, documented in the module header.
3. **Learning's `CertificationRevocationNotice` (adoption-lifecycle) and
   arena's `CertificationRevocation` (certification) are structurally
   compatible local shapes** (`certificationId`, `tenantId`,
   `revokedAtMs`, digest — arena adds a closed reason enum). Neither imports
   the other (no dependency edge). A shared revocation contract is a TL
   composition candidate; today a composition site maps one onto the other
   field-for-field.
4. **Certification minting requires tier "high"** (strictest reading of
   "accepted evaluations"). If the TL wants `medium` to mint (with a weaker
   reference grade), it is a one-line ladder change in `mintCertification`'s
   guard.
5. **Revocation cascade skips TERMINAL records** (`adopted`/`rejected`/
   `withdrawn`) — an already-ADOPTED capability whose certification is later
   revoked is surfaced in `skipped`, not force-rejected: rewriting adoption
   history is a Guardian/operational concern, not a learning-module concern.
   If the TL wants a post-adoption quarantine marker, that is a separate
   lifecycle concept.
6. **Arena's `assembleCaseSet` returns a uniform ok-discriminated result**
   (`{ ok: true; caseSet } | RegistryRejection`) — a deliberate API-shape
   choice consistent with every other result in the new modules (and with
   degraded.ts's `ArenaEvaluationResult`); noted because the F230B-era
   modules sometimes returned bare unions.
7. **`spec/snapshots/fleetos-contracts.json` NOT regenerated** — packet
   forbids it (TL gate at merge). The two packages' `exports` maps gained 7
   new subpaths (4 arena, 3 learning); `fleetos:snapshot:check` will report
   drift until the TL regenerates at merge. Expected, not an error.

## 7. Residual limitations (honest list)

1. **FNV-1a 32-bit digests** for case/observation/set/run/score/
   certification/record chains — deterministic and internally consistent,
   not cryptographically strong (the lane's established convention; tamper
   resistance at evidence-bundle grade lives in `@fleetos/evidence`).
2. **The arena verdict source is a caller-supplied input** — `scoreRun`
   aggregates `CaseVerdict`s but does not execute capabilities (there is no
   model-execution port here; Arena provider execution arrives with the
   real Wave-5+ adapters). The reference adapter path from Wave 0/1 remains
   the package's only built-in adapter.
3. **`verifyCertificationChain` / `verifyCaseSetDigest` recompute from
   presented fields** — a fully forged object with a self-consistent digest
   chain verifies; authenticity of the GENESIS anchor is a
   persistence-layer concern (same posture as the mission/world journal
   replay trust model, F230B §7.6).
4. **Proposal-scoring's `empty_case_set` degraded branch is
   defensive-only** — the public pipeline refuses to stage an empty case
   set; the branch is reached only via hand-built (forged/legacy) run
   objects, and the test says so explicitly. Not silently reachable, not
   silently dead.
5. **Trend classification is a half-mean delta heuristic** — deterministic
   and boundary-tested, but deliberately simple (no regression, no
   seasonality); the thresholds (`TREND_DELTA_BPS = 500`) are exported
   constants, not learned.
6. **Arena's run proposal `caseCount` mirrors the manifest** (not
   `scoring.total`) — equal by construction on every public path; a forged
   mismatch would surface the manifest's count. Documented choice.
7. **Learning summaries aggregate `CapabilityEvaluation`s only** — joining
   them with `computeEvaluationSummary`'s joined-outcome stats (join.ts) is
   a composition step (different inputs: cases+outcomes+predictions vs.
   evaluations); both remain available side by side, additive.
8. **Guardian authorization is shape-validated, not cryptographically
   verified** — `authorizeAdoption` checks the `GuardianAuthorization`
   input's shape and applies it; binding the decision digest to the real
   @fleetos/policy Guardian record is the composition site's job (cross-
   package import forbidden in implementation).
9. **No persistence, no daemons, no network** — per packet law, all new
   modules are pure deterministic TS over immutable values. Wiring (case
   stores, run queues, certification registries, revocation feeds) is
   application-owned.
10. **Root-level gates not run here** (packet instruction): root
    lint/typecheck/build, `architecture:check`, `source-of-truth`,
    `snapshot:check` are TL merge-time gates. Package-local `oxlint src` was
    run (0 warnings / 0 errors in both packages).

## 8. Stop-the-line events

None material. Test-construction fixes during development (no production
behavior changes): (1) fixtures initially checked `!set.ok` on
`assembleCaseSet`'s success arm (which carries no `ok` field) — resolved by
making `assembleCaseSet` return the uniform ok-discriminated result (§6.6);
(2) certification fixtures initially used 5-case runs, which correctly
classify as `medium` (confidence 7000 < 8000) and were correctly REFUSED by
`mintCertification` — fixtures raised to 7+ passing cases; (3) the
evaluation-summary advisory brand initially used `declare const` (type-only)
and threw at runtime — fixed with a real module-private `Symbol()`; (4) two
fixture evaluationIds collided (the Wave-0 `evaluateCapability` derives ids
from tenant+capability) — fixtures now override `evaluationId`. All were
fixture/API-shape corrections caught by the tests themselves; no reverts, no
scope drops, no failed gate after the fixes. Continuation-session finding:
two doc-comment lines in `adoption-lifecycle.ts` misstated the legal
rejection domain ("proposed|guardian-review") vs the machine-tested
`ADOPTION_TRANSITIONS` table (rejection only from `guardian-review`) —
corrected comment-only; zero behavior change; all gates re-run green.

## 9. Verification commands for TL re-run

```bash
git fetch origin work/f250b:work/f250b
git checkout work/f250b
(cd packages/integrations/arena && corepack pnpm run test)        # expect 94/94 (7 files)
(cd packages/learning         && corepack pnpm run test)          # expect 78/78 (5 files)
(cd packages/integrations/arena && corepack pnpm run typecheck)   # expect exit 0
(cd packages/learning         && corepack pnpm run typecheck)     # expect exit 0
(cd packages/integrations/arena && corepack pnpm run lint)        # expect 0 warnings 0 errors
(cd packages/learning         && corepack pnpm run lint)          # expect 0 warnings 0 errors
# boundary self-check (packet-exact; expect CLEAN):
grep -rEn "from ['\"]@fleetos/" packages/integrations/arena/src packages/learning/src | grep -vE "@fleetos/(integrations-arena|learning)['\"]" || echo CLEAN
# TL merge-time gates (NOT run in the worktree per packet):
pnpm fleetos:snapshot        # regenerate — 7 new export subpaths (§6.7)
pnpm fleetos:snapshot:check
pnpm lint && pnpm typecheck && pnpm architecture:check && pnpm fleetos:source-of-truth
```
