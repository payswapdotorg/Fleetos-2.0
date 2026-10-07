# F220B — Worker B (Safety + Intelligence) Wave 2 Completion Evidence

- **Work item:** F220B — Security/Policy/Actions/Execution/Evidence composition at operational-truth grade (Wave 2 lane B)
- **Owner:** Worker B (Safety + Intelligence)
- **Base commit:** `2407ea1` (branch `work/f220b` created from the TL's Wave-2-remainder dispatch commit)
- **Branch:** `work/f220b`
- **Date:** 2026-10-07
- **Continuation note (honest):** this item was executed across two agent
  sessions. Task `4-a` produced the implementation (~30 files) but hit its
  context deadline before gates/evidence/commit. Task `4-a2` (this report)
  assessed the uncommitted worktree, verified every module against the packet
  deliverables, validated the exports maps against real files, ran all
  per-package test + typecheck gates, ran the boundary self-check, and wrote
  this evidence. All code below was reviewed line-by-line by `4-a2`; the
  implementation itself is `4-a`'s work. Nothing was claimed that was not run.

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-b), the F220B-relevant owned paths:

- `packages/security/**`
- `packages/policy/**`
- `packages/actions/**`
- `packages/execution/**`
- `packages/evidence/**`
- `docs/evidence/F220B/**` (this report)

No file outside the above paths was modified. `pnpm-lock.yaml` is NOT dirty
(no dependency changes were made) and is NOT committed. 30 files changed,
`+6311 / -5` — every changed file lives under the five owned packages:

```text
packages/security/{package.json, src/index.ts}            (modified, additive)
packages/security/src/{intake,posture-fold,remediation}.ts          (new)
packages/security/tests/{intake,posture-fold,remediation}.test.ts   (new)
packages/policy/{package.json, src/index.ts}               (modified, additive)
packages/policy/src/{rules-engine,grant-chain}.ts                   (new)
packages/policy/tests/{rules-engine,grant-chain}.test.ts            (new)
packages/actions/{package.json, src/index.ts}              (modified, additive)
packages/actions/src/plan.ts                                        (new)
packages/actions/tests/plan.test.ts                                 (new)
packages/execution/{package.json, src/index.ts}            (modified, additive)
packages/execution/src/{command-queue,ledger,reference-transport}.ts (new)
packages/execution/tests/{command-queue,ledger,reference-transport}.test.ts (new)
packages/evidence/{package.json, src/index.ts}            (modified, additive)
packages/evidence/src/canonical-bundle.ts                           (new)
packages/evidence/tests/canonical-bundle.test.ts                    (new)
```

All existing public shapes are preserved: the five `src/index.ts` edits are
pure `export * from "<new-module>.ts"` additions appended below a
`Wave 2 (F220B) operational extensions` marker; the five `package.json`
edits are pure additive entries in the `exports` map (validated: every
exports-map path resolves to a real file — see §6).

## 2. What became operational-truth grade

Wave 1 (F210B) shipped kernel-grade state machines, the canonical Capability
vocabulary, the reference Guardian, and pure verification functions. Wave 2
(F220B) makes the safety lane *operational*: staged admission pipelines,
event-sourced folds with checkpoints, queue semantics with deterministic
retry/dead-letter, evidence-gated lifecycle transitions, revocation
propagation, hash-chained append-only ledgers, content-addressed evidence
bundles — tenant fail-closed and idempotent at every consequential boundary.

### 2.1 `packages/security` — findings intake + posture as an operational fold

- **`intake.ts` (448 lines)** — the findings admission pipeline:
  `validate → dedupe → correlate → triage`, one typed rejection code per
  stage (`validate.missing-tenant`, `validate.unknown-kind`,
  `validate.invalid-severity`, `validate.invalid-confidence`,
  `validate.invalid-detected-at`, `validate.invalid-asset-ids`,
  `validate.missing-description`, `dedupe.duplicate-finding`,
  `correlate.tenant-mismatch`, `triage.insufficient-signals`).
  Dedupe uses a deterministic FNV-1a fingerprint over the canonical
  `(tenant|kind|sorted-assets|detectedAt|description)` string; correlation
  uses `tenant|kind|sorted-assets` (deliberately WITHOUT time/description —
  repeats are new detections of the same problem) with a window; per-candidate
  acks never abort the batch (same discipline as F220A's observation
  admission). **Severity escalation is deterministic and stepwise**:
  `medium` ×3 within the window → `high`; `high` ×5 → `critical`
  (`DEFAULT_ESCALATION_RULES`, overridable); loop-guarded so escalation
  terminates. Tentative confidence with <2 signals degrades honestly to
  `info` (law A12 — an honest unknown, never a fabricated severity).
  Tenant fail-closed at validation (A8).
- **`posture-fold.ts` (363 lines)** — posture as an **event-sourced fold with
  checkpoint**: `foldPostureEvents` reduces a `PostureEvent` stream
  (`finding.opened/escalated/suppressed/suppression_expired/resolved`) into a
  `PostureFoldState`; the checkpoint (`lastAppliedSeq` + content-addressed
  digest) lets a caller resume by replaying only `seq > checkpoint`. Seq is
  the authority (the fold sorts by seq, never array position); duplicate seqs
  collapse (idempotent replay); cross-tenant events refuse the fold
  (`fold.tenant-mismatch` / `fold.missing-tenant`).
  `verifyPostureFoldDeterminism` and `verifyPostureFoldResume` are
  machine-tested contracts (full fold ≡ prefix fold + resumed remainder).
  `readPostureForTenant` projects the fold state into a worst-wins posture
  snapshot — fail-closed reads (A8): posture is NEVER returned cross-tenant.
  Posture is derived from the findings stream, never stored as mutable truth.
- **`remediation.ts` (269 lines)** — the remediation proposal lifecycle
  `proposed → approved → applied → verified` with **evidence-gated
  transitions**: `approved` requires a Guardian approval ref;
  `applied` requires a verification evidence ref (a proposal is NEVER applied
  without one); `verified` requires a passing verification outcome — a failed
  outcome REFUSES (`remediation.verification-failed`) and the record stays
  `applied` (honest failure, law A12). Legal-transition table exported;
  cross-tenant advance refuses (A8); `verifyRemediationHistory` is a
  post-mortem walk that reconstructs the gating from the transition history.

### 2.2 `packages/policy` — Guardian decision engine at operational grade

- **`rules-engine.ts` (258 lines)** — **deterministic ordered rule
  evaluation**: `evaluateRulesOrdered` evaluates EVERY matching rule in
  DECLARED order (the full adjudication trace — the Wave-1 reference Guardian
  picked only the best match), each decision carrying a machine-stable reason
  code (`allow.rule.<id>` / `deny.rule.<id>` / `escalate.rule.<id>` /
  `soft-allow.rule.<id>`), priority and matched facts. The final verdict is
  resolved by the existing `resolvePrecedence` (deny-overrides-allow, ties by
  priority then first-declared). **No floats in outputs**: a policy carrying a
  non-integer priority refuses (`evaluate.non-integer-priority`). Malformed
  policies refuse (`duplicate-rule-id`); tenant fail-closed
  (`evaluate.missing-tenant` / `evaluate.tenant-mismatch`, A8). **Decision
  audit refs**: `buildDecisionAuditRef` produces a content-addressed
  `audit-<inputsDigest>-<evaluatedAt>` ref — the digest-of-inputs evidence
  pointer (A13/A19), deterministic byte-for-byte.
  `verifyOrderedEvaluationDeterminism` is the machine test.
- **`grant-chain.ts` (302 lines)** — **capability grant chains**:
  `issueGrant → verifyGrantChain → revokeGrant` with **revocation
  propagation**: revoking an intermediate invalidates every derived grant,
  recursively, via deterministic BFS over children sorted by grantId;
  descendants carry `revocationReason: "propagated:<rootGrantId>"` so the
  audit trail names the root cause. A derived grant can never outlive its
  ancestor (`grant.ancestor-revoked` at verify time). Issuing under a revoked
  parent refuses (`grant.parent-revoked`); cross-tenant parentage refuses
  (A8); expiry and cycle detection (`grant.cycle`) at verify time; revocation
  is idempotent (re-revoking returns byte-identical records — no double
  timestamps). `activeGrantsForActor` is a tenant fail-closed read;
  `assertGrantTenantIsolation` is the machine-testable isolation harness.

### 2.3 `packages/actions` — action-plan composition

- **`plan.ts` (380 lines)** — action plan → authorized command pipeline:
  `validatePlan` (typed codes: `plan.missing-plan-id`, `plan.missing-tenant`,
  `plan.empty-steps`, `plan.missing-step-id`, `plan.duplicate-step-id`,
  `plan.empty-capability-id`, `plan.missing-idempotency-nonce`), then
  **Guardian-gated emission** `emitPlanCommands`: every step must carry
  exactly one `GuardianDecision` with verdict ALLOW or REQUIRE_APPROVAL —
  BLOCK refuses (`emission.step-blocked`), WARN refuses
  (`emission.step-warn` — WARN means escalated-to-human, not authorized);
  capability and tenant must match (A8). Emission is all-or-nothing: a plan
  never partially executes. **Per-action idempotency keys**:
  `${planId}|${stepId}|${nonce}` — different plans never collide.
  **Plan lifecycle** `draft → authorized → dispatched → settled
  (completed/failed/voided)` with legal-transition enforcement
  (`legalPlanTransitions` exported): `authorized` requires EVERY step
  authorized (`plan-refused.steps-not-authorized`); `dispatched` requires a
  dispatch ref; `completed` requires a completion evidence ref
  (evidence-gated); `failed` requires a failure reason (honest failure);
  voiding is legal pre-dispatch only. Cross-tenant advance refuses (A8).

### 2.4 `packages/execution` — the command queue at truth grade

- **`command-queue.ts` (341 lines)** — **submit (idempotency-key dedupe) →
  ack → complete/fail with deterministic retry and dead-letter**. Submit is
  idempotent (A4/A14): a duplicate key returns the ORIGINAL command with
  `duplicate: true` — state unchanged, no second enqueue. `backoffDelayMs` is
  a PURE schedule: `base * 2^(N-1)` capped at `maxBackoffMs` (exponent capped
  at 30; no jitter, no randomness — all integers). `failCommand` re-queues
  with `nextAttemptAt = at + backoffDelayMs(attempts+1)` or dead-letters
  after `maxAttempts` with the failure reason preserved. The queue is a PURE
  VALUE (every operation returns a new state). Tenant fail-closed at every
  operation and at reads (`read.missing-tenant` / `read.tenant-mismatch`).
  `dueCommands` drains in arrival order (submissionSeq); execution NEVER
  decides authorization (boundary unchanged).
- **`ledger.ts` (298 lines)** — the **execution ledger: append-only,
  hash-chained, replayable**. Every consequential queue operation appends one
  entry (`submitted/acked/completed/failed/retried/dead-lettered`) with an
  **audit digest per entry** (FNV-1a over the canonical entry fields) chained
  to the previous entry's digest. `verifyExecutionLedger` checks contiguous
  indexes, tenant consistency, previous-digest linkage and every entry digest
  — tamper detection machine-tested (`tamperExecutionEntry` test helper).
  `replayExecutionLedger` rebuilds the per-command view deterministically;
  `verifyExecutionLedgerReplayDeterminism` is the machine test. Appends
  refuse on tenant mismatch (A8), missing key, invalid `at`, invalid index.
- **`reference-transport.ts` (249 lines)** — the **transport port KEPT
  unchanged** (`ScriptedReferenceTransport implements CommandTransportPort`,
  the existing seam): the reference transport is extended to model the real
  paths — `ack` (state `dispatched`, completion arrives later),
  `complete` (`succeeded`), `fail` (`failed`), **`timeout`** (an honest
  degraded state, never a silent success — A12; `"timeout"` is a pre-existing
  `ExecutionState` union member, so no contract change). The transport
  consumes a DETERMINISTIC SCRIPT (dispatch N consumes step N;
  script-exhausted fails deterministically); timestamps derive from an
  explicit `baseAt` input (no wall-clock). **`pumpCommandQueue`** composes
  queue + ledger + transport into the operational drain loop: for each due
  command — ack (+ ledger entry), dispatch, settle
  (complete/fail/retry/dead-letter, each with its ledger entry); ack-path
  commands stay in-flight for later `completeCommand`.

### 2.5 `packages/evidence` — canonical evidence bundles

- **`canonical-bundle.ts` (392 lines)** — **content-addressed evidence
  entries (sha-256), bundle integrity verification, chain-of-custody refs,
  and signer-free verification records**. `canonicalJson` is the deterministic
  serialization (keys sorted recursively, arrays ordered, undefined dropped).
  `buildCanonicalEntry` computes `payloadDigest = sha-256(canonicalJson(payload))`
  via the package's EXISTING `Sha256Port` seam (node:crypto default) — the
  same approach F230A used in `apps/agent` (`createHash("sha256")`), mirrored
  as instructed. **Chain of custody**: non-empty, first holder is the
  `collector`, non-empty actor ids, non-decreasing timestamps (hands pass
  forward in time) — each refusal typed (`custody.empty`,
  `custody.missing-actor`, `custody.missing-collector`, `custody.unordered`).
  `sealCanonicalBundle` sorts entries by entryId and computes the bundle
  digest as sha-256 over `(bundleId, tenantId, sorted entryId:payloadDigest
  pairs)` — **insertion order of entries NEVER affects the digest**.
  Cross-tenant entries refuse the seal (A8). `verifyCanonicalBundle` is
  fail-closed: tenant match, uniqueness, custody validity, well-formed
  sha-256 digests, exact bundle-digest recomputation. **Verification
  records** (`verifyBundleAndRecord`) are signer-free and deterministic:
  `verifiedAt` is an explicit input, the record digest is sha-256 over the
  canonical record fields — same bundle + same time ⇒ byte-identical record.
  No wall-clock anywhere in outputs.

## 3. Tests

| Package | New test files | Tests (baseline → final, +new) | Status |
|---------|----------------|-------------------------------|--------|
| `@fleetos/security` | `intake.test.ts` (32), `posture-fold.test.ts` (25), `remediation.test.ts` (23) | 36 → 116 (+80) | all passing |
| `@fleetos/policy` | `rules-engine.test.ts` (19), `grant-chain.test.ts` (28) | 65 → 112 (+47) | all passing |
| `@fleetos/actions` | `plan.test.ts` (36) | 37 → 73 (+36) | all passing |
| `@fleetos/execution` | `command-queue.test.ts` (26), `ledger.test.ts` (20), `reference-transport.test.ts` (13) | 31 → 90 (+59) | all passing |
| `@fleetos/evidence` | `canonical-bundle.test.ts` (36) | 46 → 82 (+36) | all passing |
| **Lane total** | **10 files, 2978 lines** | **215 → 473 (+258)** | all passing |

Packet target: `~280+ lane total (215 baseline + ~70+ net-new)` — achieved
473 total with +258 net-new (3.7× the net-new floor). All existing tests
remain green (additive-only change).

### Test themes covered (meaningful, not shape-only)

- **Pipeline stage failures**: every intake rejection code is asserted
  individually (7 validate codes, dedupe duplicate-with-original-id,
  correlate tenant-mismatch, triage insufficient-signals); per-candidate
  acks prove a refused candidate never aborts the batch; metrics
  `failedByStage` counters asserted.
- **Deterministic escalation**: `medium` ×3 in-window → `high`; `high` ×5 →
  `critical`; below-threshold does NOT escalate; out-of-window repeats reset
  the count; custom rule tables honored; property-style loop asserting
  escalating bursts never exceed the rule-table targets; declared severity
  stays on the record when escalation fires (audit honesty).
- **Fold determinism + checkpointing**: two folds of the same stream are
  canonically identical; full fold ≡ prefix + resumed remainder at multiple
  split points; seq (not array position) is the authority — shuffled input
  folds identically; duplicate seqs collapse idempotently.
- **Tenant fail-closed everywhere (A8)**: fold refusals, posture read
  refusals, remediation advance refusals, grant issue/verify/read refusals,
  queue submit/ack/complete/fail/read refusals, ledger append refusal,
  bundle seal/integrity refusals, plan advance refusals — each asserted with
  its exact reason code, never a silent default.
- **Evidence-gated transitions**: remediation `applied` without verification
  evidence refuses; `verified` with a failed outcome refuses (record stays
  `applied`); plan `authorized` with uncovered steps refuses; `completed`
  without a completion ref refuses; post-mortem history walk flags the exact
  missing evidence.
- **Illegal transitions**: every illegal transition in both the remediation
  and plan tables is asserted (including terminal states and post-dispatch
  void attempts), plus the legal happy paths.
- **Revocation propagation**: revoking a mid-chain grant invalidates all
  descendants (verified with `ancestor-revoked` at the leaf); descendants
  carry `propagated:<root>`; revocation is idempotent (byte-identical
  re-revoke); a revoked parent cannot derive new grants.
- **Idempotency**: duplicate queue submit returns the ORIGINAL command with
  `duplicate: true` and unchanged state; dedupe fingerprints are
  order-insensitive over assets; per-action plan idempotency keys never
  collide across plans.
- **Deterministic backoff + dead-letter**: the pure schedule asserted
  attempt-by-attempt (1s/2s/4s… capped at 30s; exponent cap);
  fail→retry→fail→dead-letter sequences asserted; dueCommands only returns
  commands whose backoff has elapsed.
- **Hash-chain tamper detection**: ledger entry tampering breaks verification
  at the exact index with `entry_digest_mismatch`; digest chain linkage
  asserted; replay of the same ledger is byte-identical; pump composition
  asserts acked/completed/retried/deadLettered counters and ledger
  consistency.
- **Transport paths**: ack (stays in-flight), complete, fail, timeout (honest
  degraded state), script-exhausted deterministic failure; dispatch log
  records every command; pump threads acks through the ledger.
- **Canonical digests**: canonical JSON key-order independence (nested),
  array order preserved, payload digests are true sha-256 (64 lowercase hex,
  recomputed independently in the test); bundle digest insertion-order
  independence; tampered digests fail integrity; verification records are
  byte-identical for identical inputs.

## 4. Gate outputs (exact)

Per packet §Gates — run in each package dir of the worktree. Root-level
lint/typecheck/build/snapshot were NOT run (packet instruction:
memory-constrained box; TL gates at merge time).

### 4.1 `packages/security`

```text
$ corepack pnpm run test
 ✓ tests/intake.test.ts (32 tests) 11ms
 ✓ tests/posture-fold.test.ts (25 tests) 10ms
 ✓ tests/remediation.test.ts (23 tests) 7ms
 ✓ tests/kernel.test.ts (23 tests) 6ms
 ✓ tests/triage.test.ts (13 tests) 5ms
 Test Files  5 passed (5)
      Tests  116 passed (116)

$ corepack pnpm run typecheck
> @fleetos/security@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)
```

### 4.2 `packages/policy`

```text
$ corepack pnpm run test
 ✓ tests/kernel.test.ts (42 tests) 13ms
 ✓ tests/grant-chain.test.ts (28 tests) 10ms
 ✓ tests/rules-engine.test.ts (19 tests) 8ms
 ✓ tests/guardian.test.ts (13 tests) 5ms
 ✓ tests/boundary.test.ts (10 tests) 8ms
 Test Files  5 passed (5)
      Tests  112 passed (112)

$ corepack pnpm run typecheck
> @fleetos/policy@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)
```

### 4.3 `packages/actions`

```text
$ corepack pnpm run test
 ✓ tests/kernel.test.ts (24 tests) 9ms
 ✓ tests/plan.test.ts (36 tests) 9ms
 ✓ tests/state-machine.test.ts (11 tests) 5ms
 ✓ tests/structural.test.ts (2 tests) 3ms
 Test Files  4 passed (4)
      Tests  73 passed (73)

$ corepack pnpm run typecheck
> @fleetos/actions@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)
```

### 4.4 `packages/execution`

```text
$ corepack pnpm run test
 ✓ tests/reference-transport.test.ts (13 tests) 9ms
 ✓ tests/command-queue.test.ts (26 tests) 9ms
 ✓ tests/kernel.test.ts (19 tests) 8ms
 ✓ tests/ledger.test.ts (20 tests) 7ms
 ✓ tests/executor.test.ts (10 tests) 5ms
 ✓ tests/structural.test.ts (2 tests) 2ms
 Test Files  6 passed (6)
      Tests  90 passed (90)

$ corepack pnpm run typecheck
> @fleetos/execution@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)
```

### 4.5 `packages/evidence`

```text
$ corepack pnpm run test
 ✓ tests/kernel.test.ts (25 tests) 10ms
 ✓ tests/canonical-bundle.test.ts (36 tests) 10ms
 ✓ tests/chain.test.ts (21 tests) 10ms
 Test Files  3 passed (3)
      Tests  82 passed (82)

$ corepack pnpm run typecheck
> @fleetos/evidence@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no output)
```

## 5. Boundary verification (machine-tested)

The packet's exact self-check, run verbatim:

```text
$ grep -rEn "import .* from ['\"]@fleetos/" packages/{security,policy,actions,execution,evidence}/src | grep -v "@fleetos/policy" || echo CLEAN
CLEAN
```

The only `@fleetos/*` imports in the lane are the permitted intra-lane
`@fleetos/policy` TYPE imports (all pre-existing seams, all type-only):

```text
packages/execution/src/index.ts:  import type ... from "@fleetos/policy/capability"
                                  import type ... from "@fleetos/policy/policy"
packages/actions/src/index.ts:    import type ... from "@fleetos/policy/capability"
                                  import type ... from "@fleetos/policy/policy"
packages/actions/src/plan.ts:     import type ... from "@fleetos/policy/capability"
                                  import type ... from "@fleetos/policy/policy"
```

Determinism sweep (run over all five packages' `src` AND `tests`):

```text
$ rg -n "Date\.now|Math\.random|performance\.now|fetch\(|net\.connect" packages/{security,policy,actions,execution,evidence}
packages/execution/src/verification.ts:86:  const startTime = Date.now();   # PRE-EXISTING baseline file — NOT touched by F220B (verified: empty diff vs base 2407ea1)
packages/execution/src/verification.ts:99:  new Date(startTime).toISOString()
packages/execution/src/verification.ts:100: new Date(Date.now()).toISOString()
```

The only `new Date(...)` in F220B-new code is
`reference-transport.ts:69`: `new Date(this.baseAt + this.cursor * 1_000).toISOString()`
— deterministic (explicit `baseAt` input, default 0; deterministic cursor),
producing the ISO strings the pre-existing `ExecutionResult` shape requires.
No wall-clock, no randomness, no network, no new runtime deps anywhere in
F220B code. The `verification.ts` wall-clock usage is a Wave-1 baseline
behavior flagged in §7 (residuals) for the TL — out of F220B's grant to fix
without need (it is a reference verification helper whose timeout budget
measures elapsed wall time by design).

## 6. Contract deltas requested (for TL adjudication)

**The Wave 1 contract surface is preserved — all existing exports unchanged.
All Wave 2 additions are ADDITIVE.** The five `exports` maps gained:

- `@fleetos/security`: `+ ./intake`, `+ ./posture-fold`, `+ ./remediation`
- `@fleetos/policy`: `+ ./rules-engine`, `+ ./grant-chain`
- `@fleetos/actions`: `+ ./plan`
- `@fleetos/execution`: `+ ./command-queue`, `+ ./ledger`, `+ ./reference-transport`
- `@fleetos/evidence`: `+ ./canonical-bundle`

Every exports-map entry was machine-validated against the filesystem (all
resolve to real files; 6/11/5/6/4 export entries per package respectively).

1. **`spec/snapshots/fleetos-contracts.json` was NOT regenerated** — the
   packet forbids it (TL gate at merge time). The exported surface grew by
   the 10 new module exports above; `fleetos:snapshot:check` will report
   drift until the TL regenerates at merge. This is expected, not an error.

2. **FNV-1a (32-bit) vs sha-256 seam**: `security` (posture-fold
   checkpoints), `policy` (inputs digest / audit refs) and `execution`
   (ledger entry digests) use a local FNV-1a 32-bit hex digest —
   deterministic and collision-safe enough for in-process audit refs and
   checkpoint comparison, but NOT cryptographically strong. `evidence`
   canonical bundles use true sha-256 via the existing `Sha256Port` seam
   (mirroring F230A's `apps/agent` approach), which is where
   tamper-resistance actually matters. If the TL wants sha-256 strength on
   the ledger/policy digests too, that is a small follow-up (the `Sha256Port`
   pattern exists; the decision is a TL adjudication on dependency direction
   — security/policy/execution do not import evidence today, and cross-package
   imports inside the lane are limited to `@fleetos/policy` by packet rule).

3. **`rules-engine.ts` re-implements the rule matcher locally** (mirroring
   `guardian.ts`'s matching semantics: risk floor/ceiling, tenant scope,
   required authority) rather than importing it, to keep the module
   self-contained and avoid changing `guardian.ts`. The two matchers must
   stay in sync — a candidate future convergence is extracting one shared
   matcher inside `@fleetos/policy`. Informational; behavior is
   test-covered on both sides.

4. **`ScriptedReferenceTransport` models `"timeout"` as an `ExecutionState`**
   — this state is pre-existing in the Wave-1 union (no contract change);
   F220B merely exercises the timeout path through the existing
   `CommandTransportPort` seam, which is kept unchanged.

## 7. Residual limitations (honest list)

1. **Pre-existing wall-clock in `packages/execution/src/verification.ts`**
   (`Date.now()` for timeout budgeting). Present at base `2407ea1`, NOT
   touched by F220B (empty diff vs base). Flagged for the TL: it is the one
   remaining non-deterministic input in the lane's baseline surface.

2. **Digest strength asymmetry** (see §6.2): FNV-1a 32-bit digests guard the
   posture fold checkpoint, policy inputs digest and execution ledger chain.
   Deterministic and internally consistent, but a 32-bit space is not
   adversarial-tamper-resistant. Evidence bundles are sha-256-protected.

3. **No persistence, no daemons, no real transports** — per packet law, all
   new modules are pure deterministic TS over immutable values and injected
   ports. The pump is an async function over a `CommandTransportPort`
   instance, not a runtime loop; the real drain scheduling is
   application-owned. Durable stores / transactional outbox are the TL's
   F211 lane.

4. **In-batch correlation only flows forward**: intake correlation counts
   priors within the window whose `detectedAt` precedes the candidate's —
   out-of-order arrivals do not retroactively correlate (documented in the
   module header, test-covered). A streaming deployment that receives
   out-of-order detections would need a windowed reconciliation pass
   (deliberately out of scope for a pure batch pipeline).

5. **Remediation post-mortem trusts record immutability**:
   `verifyRemediationHistory` reconstructs evidence gating from the record's
   final field values + transition list; a caller that externally mutated a
   record's `approvalRef`/`verificationEvidenceRef` after the fact could
   pass the post-mortem. Records are expected to be treated as immutable
   values (the API never mutates), but there is no cryptographic binding
   between a transition and the evidence that authorized it (that is what
   evidence bundles in `@fleetos/evidence` are for — the composition point
   is application-owned today).

6. **Grant-chain tenant consistency checks the root grant's tenant**:
   `verifyGrantChain` compares every ancestor's tenant to the TARGET grant's
   tenant (fail-closed on mismatch), and `issueGrant` refuses cross-tenant
   parents — but the grants array itself is caller-supplied; a hand-built
   array with forged intermediate tenants is detected only along the walked
   chain. `assertGrantTenantIsolation` is the harness for the read path.

7. **Root-level gates not run here** (packet instruction): root
   lint/typecheck/build, `architecture:check`, `source-of-truth`,
   `snapshot:check` are TL merge-time gates and were NOT executed in this
   worktree. Lane-local `oxlint` was also not run (packet gates list only
   test + typecheck per package; both green above).

## 8. Cross-worker seam compliance

Per `spec/worker-ownership.yaml` rule `cross_worker_imports:
forbidden_in_implementation` and the packet's boundary rule:

- **No cross-LANE `@fleetos/*` imports** — verified by grep in §5 (CLEAN).
- **Intra-lane imports are type-only `@fleetos/policy`** (the packet's
  explicit allowance; the pre-existing Wave-1 seams in `actions` and
  `execution`, plus `plan.ts` following the same pattern).
- **`security`, `policy`, `evidence` import NO `@fleetos/*` package at all.**
- Cross-context concepts remain LOCAL structural interfaces / explicit
  inputs (time as `number`, digests as strings) — the Wave 0/1 pattern.

## 9. Stop-the-line events

None. All five packages were green on first assessment run (the `4-a`
implementation was functionally complete when `4-a2` picked it up — the
continuation work was verification, exports-map validation, boundary checks,
gates, and this evidence). No reverts, no scope drops, no failed gate that
required code changes.

## 10. Verification commands for TL re-run

```bash
git fetch origin work/f220b:work/f220b
git checkout work/f220b
corepack pnpm install                             # if needed; lockfile unchanged by this branch
(cd packages/security && corepack pnpm run test)  # expect 116/116
(cd packages/policy   && corepack pnpm run test)  # expect 112/112
(cd packages/actions  && corepack pnpm run test)  # expect 73/73
(cd packages/execution && corepack pnpm run test) # expect 90/90
(cd packages/evidence && corepack pnpm run test)  # expect 82/82
# lane total: 473/473 (215 baseline + 258 new)
(cd packages/security && corepack pnpm run typecheck)   # expect exit 0
(cd packages/policy   && corepack pnpm run typecheck)   # expect exit 0
(cd packages/actions  && corepack pnpm run typecheck)   # expect exit 0
(cd packages/execution && corepack pnpm run typecheck)  # expect exit 0
(cd packages/evidence && corepack pnpm run typecheck)   # expect exit 0
# boundary self-check (expect CLEAN):
grep -rEn "import .* from ['\"]@fleetos/" packages/{security,policy,actions,execution,evidence}/src | grep -v "@fleetos/policy" || echo CLEAN
# TL merge-time gates (NOT run in the worktree per packet):
pnpm fleetos:snapshot      # regenerate — 10 new export subpaths (see §6.1)
pnpm fleetos:snapshot:check
pnpm lint && pnpm typecheck && pnpm architecture:check && pnpm fleetos:source-of-truth
```
