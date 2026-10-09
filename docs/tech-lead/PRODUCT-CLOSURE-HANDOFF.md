# FleetOS 2.0 — Product-Closure Handoff to the Tech Lead

**Purpose:** close the gap between the completed Wave 0–9 implementation ledger and independently evidenced, user-facing FleetOS product acceptance.

**Starting point:** inspect current `main` and use its actual HEAD as the baseline. The prior closeout commit is `d84e6854687845ef37b41848ff7c48e4bea5bb1d`; do not assume it is still HEAD without checking.

**Canonical context:** the architecture, contracts, ownership map and completed implementation remain defined in the repository. This handoff adds a product-closure phase; it does not erase or silently reopen Waves 0–9.

## Mission and stop condition

The TL must produce a verified answer to these questions:

1. Can a user launch the actual web (and supported desktop/mobile) application and recognize it as FleetOS, rather than only seeing inherited ZCode surfaces?
2. Do FleetOS experiences consume real domain read models and submit typed commands through the defined control plane and Guardian path?
3. Which external integrations are connected to live systems, and which are only contract/reference implementations?
4. Does industry acceptance meet the stated counted-journey target where the existing scenario model supports it, without duplicate executions being counted as new coverage?
5. Does the latest clean checkout pass the required gates, and is the exact tested commit the one deployed and browser-verified?

Do not declare production-ready until the applicable gates have evidence. If a gate fails, record the failing command, exact commit, reproduction, owner and repair item. Never relabel an unverified condition as complete.

## Required reading

Read, in order:
- `FLEETOS-SOURCE-OF-TRUTH.md`
- `AGENTS.md`
- `spec/ARCHITECTURE-LOCK.md`
- `spec/BOUNDED-CONTEXTS.md`
- `spec/DEPENDENCY-GRAPH.md`
- `spec/worker-ownership.yaml`
- `spec/work-items/WORK-ITEM-CATALOG.md`
- `docs/tech-lead/CONCURRENCY-PROTOCOL.md`
- `docs/tech-lead/PRODUCT-ACCEPTANCE-REPORT.md`
- `docs/tech-lead/RESIDUAL-RISKS.md`
- `docs/tech-lead/RUNBOOK.md`
- this handoff

## Execution model

Use exactly three implementation workers. Respect `spec/worker-ownership.yaml`; no worker edits another worker's paths. TL owns cross-lane composition, application shell, release gates and shared contracts.

### Parallel lanes

#### F300A — Asset/field experience and end-to-end device journeys (Worker A)

Inspect the real application entrypoints and connect the already-built asset/field experience to the actual host through the TL's agreed integration contract. Deliver verifiable journeys for:
- asset discovery and Device 360;
- health/observation/diagnosis/evidence timeline;
- approved recovery or maintenance command and its verification result;
- field workflow, including mobile layout and offline/sync behavior where supported;
- tenant separation and role-appropriate access.

Do not implement a second business-truth store in the UI. If an application-shell change is required, propose the exact boundary to TL instead of editing TL-owned application paths.

**Evidence:** owned-path diff, exact commit, package tests/typecheck/lint, browser-run journey records and honest unsupported-case list.

#### F300B — Security, Guardian and predictive experience (Worker B)

Connect the real safety/intelligence experience to the integrated product surfaces. Demonstrate:
- finding → evidence → Guardian decision → authorized action intent → execution result → verification/audit trail;
- inspect-why and mission replay on real package outputs;
- tenant fail-closed behavior and refusal visibility;
- predictive outputs marked as advisory, with uncertainty/provenance/model identity visible;
- clear differentiation between deterministic structural/reference models and genuinely trained/validated models.

Do not claim production predictive accuracy for the documented hash-derived JEPA structural analogue. Do not bypass Guardian or let a model/agent assert that an action succeeded without verification.

**Evidence:** owned-path diff, exact commit, tests/typecheck/lint, negative/refusal fixtures and browser-run journeys.

#### F300C — Work, projects, commerce and integration reality (Worker C)

Connect the work/commerce experience and verify that the operational workflows compose correctly:
- work item/project/workload creation and lifecycle;
- procurement demand → quote → authorization/acceptance → order/fulfillment state where implemented;
- role handoffs and approval states;
- Model Gateway/Agent Organization surfaces and budgets/authority limits;
- integration status and honest live-vs-reference capability disclosure.

For each external integration, record one explicit status: `LIVE_VERIFIED`, `SANDBOX_VERIFIED`, `CONTRACT_ONLY`, or `BLOCKED`. Include provider/system, exact operation tested, environment, sanitized evidence and limitations. A deterministic adapter contract is not live connectivity. Never commit credentials or private payloads.

Revisit the F271 adoption ledger. The recorded simulation has 1,113 counted executions across 30 workspaces and does not meet its 100-counted-journeys-per-firm target. Extend parameterizable scenarios and/or add genuinely distinct journeys only where the underlying product capability supports them. Identical reruns are not new coverage. If a target is structurally impossible for a specific firm/industry, preserve the shortfall and obtain a documented TL/user decision before changing the criterion; do not quietly weaken the gate.

**Evidence:** owned-path diff, exact commit, relevant suite tests/typecheck/lint, adapter-status matrix, updated honest-counts ledger and commerce browser journeys.

## TL convergence — F301

Run concurrently with worker implementation where paths are independent, then converge after the lanes deliver.

TL owns:
- inspecting the current web/desktop entrypoints and identifying the actual host path—do not infer product integration merely from the existence of an experience package;
- wiring the Control Tower, Device 360/field, security/intelligence, work/commerce and Engineering Lab into a coherent FleetOS navigation and application shell;
- visible FleetOS product identity, role switching where a user has multiple roles, tenant scoping, universal command/search and empty/loading/error/refusal states;
- connecting UI intents to real domain/control-plane APIs and showing execution verification; no fabricated success, mock data presented as operational truth, or inert primary actions;
- using the currently approved hosting/infrastructure setup; do not introduce a new paid dependency without a written ADR and user approval;
- collecting real browser evidence on the deployed build.

The ZCode runtime may remain the substrate. Do not rewrite it or move FleetOS domain logic into generic runtime/provider/UI/RPC packages just to make integration easier.

### F301 acceptance

1. A clean browser session can reach the deployed FleetOS application with an explicit build/commit identity.
2. A user can navigate through the supported FleetOS experiences using real composed state.
3. At least one end-to-end journey from each lane (A/B/C) completes from UI action through the real command/domain path to a recorded result.
4. Critical authorization denials, tenant mismatch, stale/conflicting state, adapter unavailable and failed verification are represented honestly in the UI.
5. Browser evidence records exact URL/environment, tested commit, steps, expected versus actual result, and screenshots/logs where useful.
6. The run does not depend on private local development services or a TL's browser profile.

## Final verification — F302 (TL)

Use a clean checkout of the final candidate. First check actual branch/HEAD and lockfile state. Then run and record the repository's supported gates, including as applicable:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm fleetos:source-of-truth
corepack pnpm fleetos:snapshot:check
corepack pnpm architecture:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm -r test
corepack pnpm build
```

Also run the six acceptance suites (field, security, commerce, adoption, release, convergence) after any relevant change. If a command is not supported in the clean checkout, record the exact error and repair the script/workspace configuration rather than skipping silently. Do not state that a gate passed unless its output was captured at the candidate commit.

The final evidence bundle must include:
- actual tested HEAD and branch;
- merged worker commits and owned paths;
- clean lockfile/install result;
- architecture/snapshot/typecheck/lint/test/build outcomes and counts;
- acceptance-suite results and adoption shortfall/coverage ledger;
- browser journeys with live URL and deployed commit;
- integration status matrix;
- updated residual risks;
- explicit READY / NOT READY conclusion with named blockers.

## Dependency graph

```text
F300A (Worker A) ──┐
F300B (Worker B) ──┼──> F301 (TL application/product convergence) ──> F302 (TL final gate)
F300C (Worker C) ──┘
```

All three lanes start concurrently. TL can inspect the shell, prepare non-conflicting integration scaffolding and provision deployment checks in parallel. No worker may modify TL-owned app-shell paths. Each delivery is gated by its exact commit, tests, architecture boundaries and evidence before integration.

## Completion rule

Do not mark this phase complete based solely on worker prose, green unit tests or a package existing in the monorepo. Mark each item complete only after the corresponding evidence is committed and reviewed. Preserve the completed Wave 0–9 record; this phase substantiates the remaining product-level claims.

The final closeout must update `AI_CONTINUATION.md`, this handoff's evidence links, the product acceptance report and residual-risk register. A future TL must be able to continue from those repository files without this conversation.
