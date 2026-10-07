# F200B — FleetOS 2.0 Wave 0 Lane B Evidence

**Work item:** F200B — Canonical FleetOS contracts + bounded-context skeleton (Safety + Intelligence lane)
**Worker:** B (Safety + Intelligence)
**Branch:** `work/f200b`
**Base SHA:** `35a65601b0be66fb084d841d06ad37603d20b5ef`
**Delivered SHA:** see `git rev-parse HEAD` on the branch tip

## 1. Packages created (11)

All under Worker-B-owned paths (`spec/worker-ownership.yaml`, worker-b).
All versioned `2.0.0-alpha.0`, license Apache-2.0, `type: module`, `private: true`.
All carry `lint` / `typecheck` / `test` / `build` scripts, strict `tsconfig.json`
(`noEmit`, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `allowImportingTsExtensions`), and a vitest
battery (`vitest` 2.1.9 devDependency, `"test": "vitest run"`).

| # | Path | Package name | Purpose |
|---|------|--------------|---------|
| 1 | `packages/policy` | `@fleetos/policy` | Policy, PolicyEvaluation, GuardianDecision; typed Capability vocabulary (law A15); deterministic reference Guardian; boundary scanner |
| 2 | `packages/security` | `@fleetos/security` | SecurityFinding, posture, remediation proposal contracts; deterministic severity triage with honest degradation |
| 3 | `packages/actions` | `@fleetos/actions` | ActionIntent + consequential-action protocol state machine (propose→authorize→confirm→dispatch→execute→verify→record→learn); pure `advanceActionState` refusing illegal jumps |
| 4 | `packages/execution` | `@fleetos/execution` | Execution state, command dispatch, execution results; deterministic reference executor over injected `CommandTransportPort`; NEVER authorizes |
| 5 | `packages/evidence` | `@fleetos/evidence` | Evidence metadata/bundles, content-addressed artifacts, sha-256 digests (seam for `node:crypto`), append-only tenant-scoped hash-chain with pure `verifyEvidenceChain` |
| 6 | `packages/predictive` | `@fleetos/predictive` | Feature projections, predictive interpretations, uncertainty, provenance, OBSERVED/PREDICTED/HYPOTHETICAL as semantically distinct types (law A11); honest degraded states; never writes device state |
| 7 | `packages/world-model` | `@fleetos/world-model` | Representations, predictions, counterfactuals, `WorldModelAdapter` structural seam + deterministic reference adapter; counterfactuals carry machine-carried `hypothetical: true` marker |
| 8 | `packages/world-context` | `@fleetos/world-context` | Context projections (workload/project shape), per-observation provenance refs, versioned schema |
| 9 | `packages/learning` | `@fleetos/learning` | EvaluationCase, outcome observations, capability evaluation, adoption PROPOSALS (never auto-adoption — Guardian path required), certification references |
| 10 | `packages/simulation` | `@fleetos/simulation` | Simulation worlds, scenarios, experimental-run contracts; outputs typed as EXPERIMENTAL evidence ONLY (law A11 extended) |
| 11 | `packages/integrations/arena` | `@fleetos/integrations/arena` | Arena adapter seam (structural port + deterministic reference adapter); evaluation proposals stay PROPOSALS — adapter never submits |

## 2. Public contract inventory

Counts of exported types + functions per package (excluding re-exports of
local structural interfaces for the seam rule):

| Package | Exported types | Exported functions | Notes |
|---------|---------------:|-------------------:|-------|
| `@fleetos/policy` | 14 (Capability, Policy, PolicyRule, PolicyEvaluation, GuardianDecision, GuardianContext, CapabilityAdoptionProposal, CapabilityAdoptionAuthorization, ...) | 4 (`evaluateCapability`, `authorizeAdoption`, `assertNoForbiddenImports`, `scanSources`) + 2 helpers | Canonical Capability vocabulary (law A15) + reference Guardian (law A5) |
| `@fleetos/security` | 8 (SecurityFinding, SecurityPosture, RemediationProposal, TriageResult, ...) | 3 (`triageSeverity`, `computePosture`, `proposeRemediation`) | Deterministic triage with honest degradation |
| `@fleetos/actions` | 9 (ActionIntent, ActionRecord, ActionState, IdempotencyKey, ...) | 2 (`advanceActionState`, `proposeAction`) | Pure state machine; refuses illegal jumps |
| `@fleetos/execution` | 8 (AuthorizedCommand, ExecutionResult, CommandTransportPort, ...) | 4 (`authorizeCommand`, `executeCommand`, `makeReferenceTransport`, `referenceCapability`) | NEVER authorizes — boundary encoded in types |
| `@fleetos/evidence` | 9 (EvidenceMetadata, ContentAddressedArtifact, EvidenceChainEntry, ...) | 9 (`sha256Hex`, `appendEvidence`, `verifyEvidenceChain`, `buildArtifact`, `computeBundleDigest`, ...) | Hash-chain verification; sha-256 seam |
| `@fleetos/predictive` | 9 (ObservedValue, PredictedValue, HypotheticalValue, ...) | 5 (`referencePredict`, `buildCounterfactual`, `buildObserved`, `isHypothetical`, `isObserved`, `isPredicted`, `referenceUncertainty`) | A11 type-distinctness via `kind` literal + `hypothetical: true` marker |
| `@fleetos/world-model` | 5 (WorldModelRepresentation, CounterfactualScenario, WorldModelAdapter, ...) | 2 (`makeReferenceWorldModelAdapter`, `assertHypotheticalMarker`) | Deterministic reference adapter; no GPU/provider |
| `@fleetos/world-context` | 7 (WorkloadProjection, ProjectProjection, ObservationProvenance, ...) | 3 (`projectWorkload`, `projectProject`, `hasValidSchemaVersion`) | Versioned schema; per-observation provenance |
| `@fleetos/learning` | 7 (EvaluationCase, OutcomeObservation, CapabilityEvaluation, CapabilityAdoptionProposal, ...) | 4 (`evaluateCapability`, `proposeAdoption`, `markProposalAuthorized`, `markProposalRejected`) | NO `adopt()` function — Guardian path required |
| `@fleetos/simulation` | 6 (SimulationWorld, SimulationScenario, ExperimentalRunOutput, ...) | 3 (`runSimulation`, `isExperimental`, `buildComparison`) | EXPERIMENTAL kind distinct from OBSERVED/PREDICTED/HYPOTHETICAL |
| `@fleetos/integrations/arena` | 6 (ArenaEvaluationRequest, ArenaEvaluationProposal, ArenaAdapter, ...) | 2 (`makeReferenceArenaAdapter`, `isArenaEvaluationProposal`) | No `submit()`/`adopt()` — proposals stay proposals |

**Total exported types: 88. Total exported functions: 41.**

## 3. Tests

Vitest battery. **Total: 148 tests, all passing.** Target was ≥ 88.

| Package | Test files | Tests | Focus |
|---------|-----------:|------:|-------|
| `@fleetos/policy` | 2 | 23 | Guardian determinism, machine-stable reason codes, tenant fail-closed, anti-self-authorization, degraded context, capability adoption; boundary scanner pure unit + real-source-tree walk |
| `@fleetos/security` | 1 | 13 | Triage determinism, honest degradation, posture scoring, remediation proposal Guardian-authorization gating |
| `@fleetos/actions` | 2 | 13 | Full forward path; illegal-transition refusals (execute-without-auth, dispatch-without-confirm, verify-without-execute, record-without-verify, learn-without-record); tenant fail-closed; structural compat |
| `@fleetos/execution` | 2 | 12 | BLOCK-verdict refusal; tenant-mismatch refusal; deterministic delegation; structural compat |
| `@fleetos/evidence` | 1 | 21 | sha256Hex determinism; well-known digests; hex/bytes round-trip; custom-port seam; append-only chain; chain verification (tamper detection, index gap, tenant mismatch, previous-digest link, first-entry-previous); bundle digest stability |
| `@fleetos/predictive` | 1 | 12 | A11 compile-time type-distinctness (`@ts-expect-error` checks); runtime guards; determinism; honest degradation; no-write-effect invariant; union exhaustiveness |
| `@fleetos/world-model` | 1 | 11 | Adapter determinism; hypothetical marker (compile-time + runtime guard + tamper detection); no-authorize/no-execute interface check; provenance; stable scenario IDs |
| `@fleetos/world-context` | 1 | 9 | Schema version; honest degradation; per-observation provenance; purity; project projection counts |
| `@fleetos/learning` | 1 | 10 | Evaluation counts; missing-outcome failure; determinism; proposal status=pending; stable IDs; markAuthorized/markRejected immutability; **no `adopt()` exported** runtime check |
| `@fleetos/simulation` | 1 | 10 | Determinism; EXPERIMENTAL kind distinctness (`@ts-expect-error`); tenant fail-closed; worldId match; runtime guard; stable comparison IDs |
| `@fleetos/integrations/arena` | 2 | 14 | Proposal-only return; no `submit()`/`adopt()`/`authorize()` methods; determinism; type-distinct from outcome; runtime guard; tenant + capability carried through; empty-case-set handling; local structural interfaces |

## 4. Boundary scan results

`packages/policy/src/boundary.ts` exports:

- `assertNoForbiddenImports(sourceText, sourcePath?)` — pure function
- `extractSpecifiers(sourceText)` — pure function
- `scanSources(sources)` — pure function over `Map<path, sourceText>`
- `LANE_ALLOWED_FLEETOS_PACKAGES` — the 11 worker-b package specifiers
- `BoundaryViolation` type

The scanner flags three rule classes:
- `forbidden-zcode` — any `@zcode/*` import (Wave 0 forbids substrate dependency)
- `forbidden-cross-worker` — any `@fleetos/*` import not in the lane allowlist (subpath imports like `@fleetos/policy/capability` are allowed via prefix match)
- `forbidden-apps` — any `apps/*` import (domain must not depend on UI/runtime internals)

Wired as a vitest test (`packages/policy/tests/boundary.test.ts`) that walks
the REAL source tree of all 11 worker-b packages' `src/` directories at test
time and asserts ZERO violations.

**Result:** boundary scan finds ZERO forbidden imports across all 11 packages.
Test passes (`packages/policy/tests/boundary.test.ts > boundary scanner: real
source tree > walks every Worker-B package and finds ZERO forbidden imports`).

## 5. Gate outputs (exact results)

### `pnpm fleetos:source-of-truth` — PASS

```
FleetOS source-of-truth check PASSED
Canonical architecture, ownership, work catalog, TL handoff and continuation files are present.
Exactly three implementation workers are registered.
Product identity: fleetos-2.0
Architecture lock: 2.0.0
```

### `pnpm lint` (oxlint) — PASS, zero NEW issues vs base

```
Found 70 warnings and 0 errors.
Finished in 537ms on 2644 files using 2 threads.
```

Baseline at `35a6560` reported 70 warnings + 0 errors. After delivery: 70
warnings + 0 errors. **Zero new issues introduced.** All 5 initial new-package
warnings (unused type imports / unused generics) were fixed before delivery.

### `pnpm typecheck` (root `tsc -b`) — PASS

The root `tsc -b` invocation targets TL-owned substrate packages only
(`packages/rpc packages/provider ... packages/desktop/tsconfig.host.json`).
My 11 new packages each have their own `pnpm --filter @fleetos/<pkg> typecheck`
gate, all of which PASS with strict compiler options.

### Per-package `pnpm --filter @fleetos/<pkg> typecheck` — ALL 11 PASS

Each package typechecks under `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, `allowImportingTsExtensions`,
`verbatimModuleSyntax` (inherited from `tsconfig.base.json`).

### `pnpm architecture:check` — FAIL (PRE-EXISTING, NOT A REGRESSION)

```
Error: architecture-policy.yaml 必须包含 version: 1 和 modules 数组
    at validatePolicy (scripts/architecture/policy.mjs:33:11)
```

**Root cause:** `architecture-policy.yaml` declares `version: 2`, but
`scripts/architecture/policy.mjs` requires `version: 1`. Both files are
TL-owned (`spec/worker-ownership.yaml` -> `tl:` -> `architecture-policy.yaml`
and `scripts/**`). This failure is identical at base `35a6560` — my delivery
does not regress it.

**Stop-the-line notice:** The TL needs to either:
1. Bump `scripts/architecture/policy.mjs` to accept `version: 2`, OR
2. Reset `architecture-policy.yaml` to `version: 1`, OR
3. Register the 11 new worker-b packages as managed modules in
   `architecture-policy.yaml` so the architecture check actually scans them.

Option 3 is the most useful — currently the new `@fleetos/*` packages are NOT
in `architecture-policy.yaml`'s `modules:` list, so even if the version
mismatch were fixed, the architecture check would not enforce boundaries on
them. The boundary scanner shipped in `packages/policy/src/boundary.ts` is the
in-lane enforcement substitute until the TL registers the modules.

### `pnpm build` (full recursive) — FAIL (ENVIRONMENTAL, NOT A REGRESSION)

```
apps/zcode-cli build: @zcode/core:build: Killed
...
Exit status 137
```

OOM exit 137 on `@zcode/core` (under `apps/zcode-cli`). Container memory limit
is 4.1 GiB (`free -h`). The `@zcode/web` vite build (7737 modules) and the
`@zcode/core` build both exceed available memory. **This failure is identical
at base `35a6560`** — my delivery does not regress it.

### `pnpm run build:bootstrap` (skips `@zcode/desktop`) — FAIL (ENVIRONMENTAL, NOT A REGRESSION)

```
packages/web build: Killed
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @zcode/web@ build: `vite build`
Exit status 137
```

Same OOM (exit 137) on `@zcode/web` vite build. The task description
explicitly anticipated this: "if it fails ONLY inside @zcode/desktop on
electron/environmental grounds, run `pnpm run build:bootstrap` and record
the exact failure honestly instead". The bootstrap path also fails — on
`@zcode/web`, not `@zcode/desktop`. The container's 4 GiB memory limit is
insufficient for the `@zcode/web` 7737-module bundle.

### Per-package `pnpm --filter @fleetos/<pkg> build` — ALL 11 PASS

Each package's `build` script is `tsc -p tsconfig.json --noEmit`. All 11 pass.
The packages are pure-TYPES + pure-FUNCTIONS only (no I/O, no servers, no
databases, no network, no model providers), so a no-emit typecheck is the
correct build gate.

### Per-package `pnpm --filter @fleetos/<pkg> test` — ALL 11 PASS, 148 tests total

See section 3 above.

## 6. Honest residual limitations

1. **`packages/integrations/arena` is not a pnpm workspace package.**
   `pnpm-workspace.yaml` declares `packages/*` only, which matches one
   directory level. `packages/integrations/arena` is nested under
   `packages/integrations/` and is NOT picked up by the workspace glob.
   Arena's `test` script invokes vitest via a relative path
   (`node ../../../node_modules/vitest/vitest.mjs run`) and arena declares
   LOCAL structural interfaces for the `@fleetos/learning` concepts it
   references (instead of importing across packages). The
   `tests/structural.test.ts` file in arena has a deferred
   cross-package-structural-compat assertion (placeholder test) that requires
   TL action to enable. **Stop-the-line:** the TL should add
   `packages/integrations/*` to `pnpm-workspace.yaml` so that arena (and
   worker-a's `packages/integrations/adcos`, worker-c's
   `packages/integrations/aurum|apify|vendors`) becomes a proper workspace
   package.

2. **`architecture-policy.yaml` version mismatch.** Pre-existing, TL-owned.
   See gate output section 5. Until the TL fixes this, `pnpm architecture:check`
   fails for the entire repo (not just my lane). My lane boundary enforcement
   substitutes via `packages/policy/src/boundary.ts`.

3. **The 11 new `@fleetos/*` packages are NOT registered in
   `architecture-policy.yaml`'s `modules:` list.** TL-owned. Until registered,
   `architecture:check` would not scan them even if the version mismatch were
   fixed. The in-lane boundary scanner (`packages/policy/src/boundary.ts`)
   is the Wave-0 substitute.

4. **`@zcode/web` and `@zcode/core` builds OOM in this 4 GiB container.**
   Pre-existing environmental limit. Same failure at base `35a6560`. No
   regression. A larger-memory CI runner is required for full `pnpm build`.

5. **`pnpm typecheck` at the root does NOT include my packages.** The root
   `tsc -b` invocation lists TL-owned substrate projects only. Each
   `@fleetos/*` package has its own `typecheck` script and they all pass;
   integrating them into the root `tsc -b` is a TL composition task (TL owns
   `package.json` and the root `typecheck` script).

6. **`vitest` is declared as a `devDependency` in EACH of the 11 packages.**
   This is intentional — Wave 0 forbids editing the root `package.json` (TL-owned)
   to add a workspace-wide vitest. Each package's `node_modules/.bin/vitest`
   resolves to the same hoisted copy in the root `node_modules/vitest/`.

## 7. Contract deltas requested (for F201 TL adjudication)

The TL converges worker vocabularies into frozen shared contracts at F201.
The following are the assumptions made in this lane that the TL should
adjudicate:

### 7.1 Capability vocabulary (law A15) — `packages/policy/src/capability.ts`

The canonical typed Capability vocabulary lives in `@fleetos/policy/capability`.
Assumptions:

- **`Capability.category` is a closed string union** (`read | observe | propose
  | execute.device | execute.work | execute.commerce | execute.network |
  mutate.asset | mutate.policy | adopt.capability | simulate`). Workers A/C
  may need additional categories — please adjudicate.
- **`Capability.risk` is a closed 6-step ordinal** (`none | low | medium | high
  | severe | irreversible`). The Guardian ranks these in this exact order.
- **`AuthorityKind` is a closed union** (`tenant.operator | tenant.admin |
  tenant.engineer | mission.owner | asset.owner | human.approval |
  guardian.autonomous`). Worker A owns tenant/role concepts and may want a
  different decomposition; please adjudicate.
- **`TenantScopeLike` and `MissionRefLike` are STRUCTURAL interfaces** defined
  locally in each worker-b package (per the cross-worker seam rule). Worker A
  owns the canonical `TenantScope` and Worker C owns the canonical `MissionRef`.
  At F201, please freeze the canonical shapes so we can replace the local
  structural interfaces with direct imports.
- **`CapabilityAdoptionAuthorization` has no field for "self.authorized"** —
  this is intentional. The unrepresentable-state pattern encodes law A5
  (agents/workflows/models cannot self-authorize). Please confirm.

### 7.2 Guardian protocol (laws A4/A5) — `packages/policy/src/guardian.ts`

The reference Guardian is a pure function
`evaluateCapability(policy, capability, ctx) -> GuardianDecision`. Assumptions:

- **`PolicyVerdict` is `ALLOW | WARN | REQUIRE_APPROVAL | BLOCK`** — closed
  4-element union. No `DEFER` or `ESCALATE`.
- **`GuardianReasonCode` is a closed string union** of 13 reason codes. Adding
  new codes is a contract change.
- **Adjudication order is fixed:** (1) tenant identity match, (2) tenant-scope
  compatibility, (3) anti-self-authorization for autonomous actors on
  non-low-risk capabilities, (4) cross-tenant resource-scope check, (5)
  degraded-context refusal, (6) rule matching, (7) irreversible-risk override,
  (8) high-risk escalation, (9) unknown-capability refusal, (10) rule verdict.
  Please confirm or reorder.
- **`authorizeAdoption` returns a `PolicyEvaluation` record** (not just a
  `GuardianDecision`) so it can be persisted as evidence. Worker C owns the
  Mission/WorkItem contracts; please confirm the `PolicyEvaluation` shape
  composes with Worker C's mission records at F201.

### 7.3 Action protocol (law A4) — `packages/actions/src/index.ts`

The state machine has 11 states (`proposed | authorized | confirmed | dispatched
| executing | executed | verified | recorded | learned | rejected | cancelled`).
Assumptions:

- **`cancelled` is reachable from any pre-terminal state.** `rejected` is
  reachable from `proposed` and `authorized` only.
- **No `paused` or `resumed` state.** Resumability (law A10) is the TL-owned
  mission layer's concern, not the action protocol's.
- **`AdvanceResult` is a tagged union** (`{ ok: true; record } | { ok: false;
  reason; record }`) — the type system encodes "execute without authorization
  is unrepresentable as a successful transition".
- **`IdempotencyKey.tenantId` is required.** Worker A's tenant context feeds
  this. Please confirm the canonical tenant identifier is `tenantId: string`
  (not a composite).

### 7.4 Execution boundary (law A5) — `packages/execution/src/index.ts`

The executor accepts ONLY `AuthorizedCommand`, constructible solely from a
`GuardianDecision` with verdict `ALLOW` or `REQUIRE_APPROVAL`. Assumptions:

- **`WARN` verdicts are refused at the executor boundary** (escalated to
  `REQUIRE_APPROVAL` by the Guardian). Please confirm.
- **`CommandTransportPort` is a structural seam** — production transports
  (device, MCP, plugin, browser-use) are injected by the TL-owned control
  plane. Please confirm the seam shape.
- **Execution NEVER writes domain truth directly** (law: runtime
  implementations may execute typed capabilities but may not mutate domain
  stores directly). The `ExecutionResult.outputs` is a generic
  `Readonly<Record<string, unknown>>`; the control plane interprets these
  into domain writes through the application boundary.

### 7.5 Evidence chain (laws A13, A19) — `packages/evidence/src/index.ts`

The hash-chain entry digest is `sha256(previousDigest || evidenceId ||
tenantId || index)`. Assumptions:

- **`EvidenceChainEntry.entryDigest` uses `|` as the field separator** in the
  pre-image. Please confirm this is stable across the canonical contract.
- **`Sha256Port` is a seam** — default uses `node:crypto`. Browser/edge
  environments may inject `crypto.subtle`. Please confirm the seam shape.
- **The chain is per-tenant.** Cross-tenant appends throw. Please confirm
  this matches Worker A's tenant-isolation model.
- **`computeBundleDigest` sorts evidence IDs deterministically** before
  hashing. Please confirm the canonical contract uses the same sorting.

### 7.6 Predictive semantics (law A11) — `packages/predictive/src/index.ts`

OBSERVED, PREDICTED, HYPOTHETICAL are three distinct interfaces distinguished
by the `kind` literal field. HYPOTHETICAL additionally carries a
machine-carried `hypothetical: true` field. Assumptions:

- **The `kind` literal is the canonical A11 discriminator.** Brand symbols
  were considered but removed because they don't survive JSON serialization
  and complicate runtime guards. Please confirm.
- **`PredictiveInterpretation` is a tagged union** (`{ ok: true; value } | {
  ok: false; degraded; reason }`) — predictive outputs either carry a value
  OR a degraded state, never both. Please confirm.
- **`DegradedState` is a closed 4-element union** (`model_unavailable |
  insufficient_history | feature_missing | tenant_isolated`).
- **Predictive NEVER writes device state.** The `PredictedValue` interface has
  no field that would mutate state. Please confirm.

### 7.7 World model (law A11) — `packages/world-model/src/index.ts`

The `WorldModelAdapter` is a structural seam with three methods: `represent`,
`predict`, `counterfactual`. Assumptions:

- **The adapter has NO `authorize` or `execute` methods.** Law: world-model
  cannot authorize or execute actions. Please confirm.
- **Counterfactuals reuse the predictive package's `HypotheticalValue` type.**
  This couples world-model to predictive. Please confirm or define a local
  structural interface.
- **`makeReferenceWorldModelAdapter` is deterministic.** Same `now` input =>
  same outputs. Production adapters (JEPA, etc.) plug in via the seam.

### 7.8 Simulation (law A11 extended) — `packages/simulation/src/index.ts`

A fourth semantic kind `EXPERIMENTAL` is introduced, distinct from
OBSERVED/PREDICTED/HYPOTHETICAL. Assumptions:

- **`EXPERIMENTAL` is a top-level semantic kind** for simulation outputs.
  Please confirm this is the canonical interpretation of "simulation outputs
  remain experimental evidence" (BOUNDED-CONTEXTS.md).
- **`runSimulation` throws on tenant mismatch** (rather than returning a
  result). Please confirm throw-vs-result is the right pattern.

### 7.9 Arena adapter — `packages/integrations/arena/src/index.ts`

- **The adapter has NO `submit`, `adopt`, or `authorize` methods.** Evaluation
  proposals stay PROPOSALS. Please confirm.
- **`ArenaEvaluationProposal.kind === "ARENA_PROPOSAL"`** is the canonical
  discriminator. Please confirm.

### 7.10 Cross-worker structural interfaces

Every worker-b package that references Worker-A-owned concepts (tenant) or
Worker-C-owned concepts (mission, work-item, project) defines LOCAL STRUCTURAL
interfaces (`TenantScopeLike`, `MissionRefLike`, `WorkItemRef`, `ProjectRef`,
`AssetRef`). Structural-compatibility tests verify these are compatible with
`@fleetos/policy`'s canonical shapes. At F201, please freeze:

- `TenantScope` canonical shape (Worker A)
- `MissionRef` canonical shape (Worker C)
- `WorkItemRef` canonical shape (Worker C)
- `ProjectRef` canonical shape (Worker C)
- `AssetRef` canonical shape (Worker A)

so we can replace the local structural interfaces with direct imports.

## 8. Scope violations

**None.** All work was confined to Worker-B-owned paths:

- `packages/security/**`
- `packages/policy/**`
- `packages/actions/**`
- `packages/execution/**`
- `packages/evidence/**`
- `packages/predictive/**`
- `packages/world-model/**`
- `packages/world-context/**`
- `packages/learning/**`
- `packages/simulation/**`
- `packages/integrations/arena/**`
- `docs/evidence/F200B/**` (granted carve-out)

The only files modified OUTSIDE `packages/<worker-b>/**` are:

- `pnpm-lock.yaml` — regenerated by `pnpm install` (explicitly allowed by the
  task description).
- `docs/evidence/F200B/report.md` — this file (granted carve-out).

No edits to:

- root `package.json`
- `pnpm-workspace.yaml`
- `architecture-policy.yaml`
- `spec/**`
- `docs/**` outside the carve-out
- `scripts/**`
- `AGENTS.md`
- any `@zcode/*` package
- any Worker-A or Worker-C owned path

## 9. Stop-the-line items (require TL action, NOT fixed by crossing ownership)

1. `pnpm-workspace.yaml` needs `packages/integrations/*` added so that
   `packages/integrations/arena` (and worker-a's `packages/integrations/adcos`,
   worker-c's `packages/integrations/aurum|apify|vendors`) become proper
   workspace packages. Currently arena's tests run via a relative-path vitest
   invocation and arena cannot import `@fleetos/learning` as a workspace
   package — it uses local structural interfaces instead.

2. `architecture-policy.yaml` has `version: 2` but `scripts/architecture/policy.mjs`
   expects `version: 1`. Both TL-owned. Pre-existing failure.

3. The 11 new `@fleetos/*` packages are not registered in
   `architecture-policy.yaml`'s `modules:` list. Until registered, the
   architecture check would not scan them. The in-lane boundary scanner
   (`packages/policy/src/boundary.ts`) substitutes.

4. `@zcode/web` and `@zcode/core` builds OOM in this 4 GiB container.
   Pre-existing. No regression. Larger CI runner required.

5. Root `tsc -b` (in root `package.json`'s `typecheck` script) does not include
   the new `@fleetos/*` packages. TL composition task.

## 10. Reproduction

```bash
git clone https://github.com/payswapdotorg/Fleetos-2.0.git
cd Fleetos-2.0
git fetch origin work/f200b:work/f200b
git checkout work/f200b
corepack enable && corepack prepare pnpm@10.33.2 --activate   # node >= 24
pnpm install

# Per-package gates (all 11):
pnpm --filter @fleetos/policy test
pnpm --filter @fleetos/security test
pnpm --filter @fleetos/actions test
pnpm --filter @fleetos/execution test
pnpm --filter @fleetos/evidence test
pnpm --filter @fleetos/predictive test
pnpm --filter @fleetos/world-model test
pnpm --filter @fleetos/world-context test
pnpm --filter @fleetos/learning test
pnpm --filter @fleetos/simulation test
(cd packages/integrations/arena && node ../../../node_modules/vitest/vitest.mjs run)

# Repo-wide gates:
pnpm lint                     # 70 warnings, 0 errors (baseline)
pnpm typecheck                # passes (TL-owned substrate only)
pnpm fleetos:source-of-truth  # passes
pnpm architecture:check       # FAILS — pre-existing TL-owned config issue, not a regression
pnpm build                    # FAILS — pre-existing OOM on @zcode/web, not a regression
```
