# F200C — Work + Commerce domain skeleton evidence

Work item F200C (FleetOS 2.0 Wave 0, lane C).
Owner: worker C (Work + Commerce).
Branch: `work/f200c`.
Base SHA: `35a65601b0be66fb084d841d06ad37603d20b5ef` (per `spec/work-items/WORK-ITEM-CATALOG.md` and the F200C dispatch packet).

## Packages created

| # | Path | Package name | One-line purpose |
|---|------|--------------|-------------------|
| 1 | `packages/work` | `@fleetos/work` | WorkItem, assignments, deadlines contracts + pure `advanceWorkItem` state machine + lane boundary scan test |
| 2 | `packages/projects` | `@fleetos/projects` | Project, milestone contracts + project lifecycle transitions + milestone gating (terminal-state requirement) |
| 3 | `packages/workloads` | `@fleetos/workloads` | Capacity/allocation/utilization contracts + pure allocation feasibility check (honest overload detection, never silent clamping) |
| 4 | `packages/procurement` | `@fleetos/procurement` | Need/Demand/Quote/Order/Fulfillment contracts (law A16 exchange identity) + pure vendor matching + quote/order/fulfillment lifecycles |
| 5 | `packages/vendors` | `@fleetos/vendors` | Vendor identity, capabilities, commercial scorecards, service-relationship contracts + pure worst-wins scorecard aggregation |
| 6 | `packages/software` | `@fleetos/software` | Software subscriptions, entitlements, allocations contracts + pure tenant-scoped entitlement check (over-allocation refused, never clamped) |
| 7 | `packages/agent-organizations` | `@fleetos/agent-organizations` | Agent roles, capability budgets, organization configuration + pure budget enforcement (organizations as UNTRUSTED actors — proposals only, never authorizations) |
| 8 | `packages/model-gateway` | `@fleetos/model-gateway` | Model routing, provider fallback, budget policies + deterministic reference `route()` + `ModelProviderPort` structural seam (law A7) |
| 9 | `packages/integrations/aurum` | `@fleetos/aurum` | `AurumPort` structural seam + deterministic reference adapter (no network) + honest degraded states |
| 10 | `packages/integrations/apify` | `@fleetos/apify` | `ApifyPort` structural seam + proposals-only actor jobs (Guardian path out-of-lane — structural seam) |
| 11 | `packages/integrations/vendors` | `@fleetos/external-vendors` | `ExternalVendorPort` structural seam + deterministic reference adapter + boundary tests asserting external systems never own domain truth |

## Public contract inventory

| Package | Exported types | Exported pure functions | Total exports |
|---------|---------------:|------------------------:|--------------:|
| `@fleetos/work` | 14 | 3 (`validateTenantScope`, `advanceWorkItem`, `assignTo`) | 17 |
| `@fleetos/projects` | 12 | 3 (`validateTenantScope`, `transitionProject`, `checkMilestoneGate`) | 15 |
| `@fleetos/workloads` | 8 | 3 (`validateTenantScope`, `checkAllocationFeasibility`, `computeUtilization`) | 11 |
| `@fleetos/procurement` | 17 | 5 (`validateTenantScope`, `matchVendors`, `transitionQuote`, `transitionOrder`, `transitionFulfillment`, `contractsAreDistinct`) | 22 |
| `@fleetos/vendors` | 9 | 3 (`validateTenantScope`, `aggregateScorecard`, `vendorHasCapability`) | 12 |
| `@fleetos/software` | 8 | 2 (`validateTenantScope`, `checkEntitlement`) | 10 |
| `@fleetos/agent-organizations` | 9 | 2 (`validateTenantScope`, `enforceBudget`) | 11 |
| `@fleetos/model-gateway` | 9 | 3 (`validateTenantScope`, `route`, `checkBudgetPolicy`) | 12 |
| `@fleetos/aurum` | 6 | 2 (`validateTenantScope`, `createDeterministicAurumAdapter`) | 8 |
| `@fleetos/apify` | 5 | 3 (`validateTenantScope`, `createDeterministicApifyAdapter`, `proposeActorJob`) | 8 |
| `@fleetos/external-vendors` | 6 | 4 (`validateTenantScope`, `createDeterministicExternalVendorAdapter`, `isExternalProjection`, `projectionDoesNotOwnDomainTruth`) | 10 |
| **Total** | **103** | **33** | **136** |

## Tests

| Package | Test file | Test count | All passing |
|---------|-----------|-----------:|-------------|
| `@fleetos/work` | `tests/work.test.ts` | 20 | yes |
| `@fleetos/work` | `tests/boundary-scan.test.ts` (lane boundary scan) | 3 | yes |
| `@fleetos/projects` | `tests/projects.test.ts` | 16 | yes |
| `@fleetos/workloads` | `tests/workloads.test.ts` | 13 | yes |
| `@fleetos/procurement` | `tests/procurement.test.ts` | 19 | yes |
| `@fleetos/vendors` | `tests/vendors.test.ts` | 12 | yes |
| `@fleetos/software` | `tests/software.test.ts` | 11 | yes |
| `@fleetos/agent-organizations` | `tests/agent-organizations.test.ts` | 11 | yes |
| `@fleetos/model-gateway` | `tests/model-gateway.test.ts` | 14 | yes |
| `@fleetos/aurum` | `tests/aurum.test.ts` | 8 | yes |
| `@fleetos/apify` | `tests/apify.test.ts` | 10 | yes |
| `@fleetos/external-vendors` | `tests/external-vendors.test.ts` | 9 | yes |
| **Total** | | **146** | **yes** |

Test coverage themes (machine-stable reason codes; illegal-transition refusals; tenant fail-closed behavior; determinism; exchange-identity separation):

- **Machine-stable reason codes**: every refusal returns a string-literal `reasonCode` (e.g. `ILLEGAL_TRANSITION`, `TENANT_SCOPE_MISSING`, `BUDGET_EXCEEDED`, `OVER_ALLOCATION`, `EXCEEDS_CAPACITY`, `NO_PROVIDER_AVAILABLE`, `PROPOSAL_UNAUTHORIZED`). Identical inputs always yield identical reason codes.
- **Illegal-transition refusals**: `advanceWorkItem`, `transitionProject`, `transitionQuote`, `transitionOrder`, `transitionFulfillment` all refuse illegal transitions with `ILLEGAL_TRANSITION` rather than silently coercing to a default next state.
- **Tenant fail-closed behavior**: every command and read path validates `TenantScope` first; missing/empty/malformed tenant ids always produce a refusal with `TENANT_SCOPE_MISSING` (or `TENANT_ID_EMPTY` / `TENANT_ID_TOO_LONG` / `TENANT_ID_INVALID_CHARS`) before any further processing.
- **Determinism**: each package has at least one explicit determinism test asserting identical inputs produce identical outputs across calls.
- **Exchange-identity separation (law A16)**: `@fleetos/procurement` exports branded id kinds for Need, Demand, Quote, Order, Fulfillment. `contractsAreDistinct(a, b)` proves pairwise distinctness at runtime; types prove it at compile time (a Quote cannot be assigned to an Order variable).
- **No silent clamping**: `checkAllocationFeasibility`, `checkEntitlement`, `aggregateScorecard`, `checkBudgetPolicy` all return the exact overshoot / out-of-range score / overshoot tokens rather than silently clamping.
- **Untrusted actor encoding (law A6)**: `@fleetos/agent-organizations` exports only `CapabilityProposal` outputs — there is no `Authorization` type in this package. Tests assert the success branch exposes no `authorized` field.
- **Provider neutrality (law A7)**: `@fleetos/model-gateway` exports `ModelProviderPort` (structural seam); provider SDK types never appear in domain contracts. `@fleetos/aurum`, `@fleetos/apify`, `@fleetos/external-vendors` export `AurumPort`, `ApifyPort`, `ExternalVendorPort` respectively — same structural-seam pattern.

## Boundary scan (machine-checked)

`packages/work/tests/boundary-scan.test.ts` walks every source file under the 11 worker-c owned paths and asserts:

1. **ZERO imports of any `@zcode/*` specifier** across all worker-c package sources — PASSED.
2. **ZERO imports of any `@fleetos/*` specifier outside the (intentionally empty in Wave 0) lane allowlist** — PASSED.
3. **Declares the expected 11 `@fleetos/*` packages** — PASSED.

This makes the "no business truth in ZCode runtime packages" acceptance clause of F200C machine-checked in this lane.

## Cross-worker seam rule (binding, Wave 0)

TenantScope / TenantScopeLike / GuardianDecisionRefLike / EvidenceRefLike are LOCAL structural types in worker-c packages. Sibling-lane concepts (identity/tenant scope, Guardian authorization, evidence, predictive advice) are referenced via these local interfaces — never via `@fleetos/*` runtime imports. TL convergence at F201 will replace these local seams with the canonical shared contracts.

## Gates (executed on `work/f200c` after `git fetch origin main:main` ref-sync)

| Gate | Baseline (35a6560) | `work/f200c` | Notes |
|------|---------------------|---------------|-------|
| `pnpm lint` (oxlint) | 70 warnings, 0 errors | 70 warnings, 0 errors | No new issues. My 11 packages each lint to 0 warnings, 0 errors when scoped with `pnpm lint` per package. |
| `pnpm typecheck` (`tsc -b` on `@zcode/*` list) | PASS | PASS | Unchanged; my packages' typecheck is invoked per-package and all pass. |
| `pnpm architecture:check` | **FAIL — baseline defect** | **FAIL — same baseline defect** | `architecture-policy.yaml` declares `version: 2`; `scripts/architecture/policy.mjs` validates `raw.version !== 1`. Both files are TL-owned (`architecture-policy.yaml` and `scripts/**` are explicitly forbidden to worker-c). Stop-the-line recorded; no fix attempted across ownership. No regression. |
| `pnpm fleetos:source-of-truth` | PASS | PASS | Canonical files unchanged. |
| `pnpm build` (`pnpm -r build`) | **FAIL — `@zcode/web` vite build Killed (exit 137 / OOM)** | **FAIL — same `@zcode/web` OOM** | The 4GB-RAM sandbox environment cannot complete the `@zcode/web` vite build. `pnpm run build:bootstrap` also fails at `@zcode/web` (it excludes `@zcode/desktop` only, not `@zcode/web`). My 11 packages' own `build` scripts (`tsc --noEmit`) all pass cleanly. Stop-the-line recorded; no regression. |
| `pnpm --filter @fleetos/<name> test` (per new package) | N/A | PASS for all 8 direct-child packages | 146 total tests, all passing. The 3 nested integration packages are invoked via `/home/z/.../node_modules/.bin/vitest run` directly inside each `packages/integrations/<name>` directory because `pnpm-workspace.yaml` does not include `packages/integrations/*` in its glob (TL-owned file; hand-edits forbidden). |

## Residual limitations

1. **`packages/integrations/*` not auto-discovered by the pnpm workspace.** `pnpm-workspace.yaml` declares only `packages/*` as a workspace glob. The 3 nested integration packages under `packages/integrations/{aurum,apify,vendors}` are therefore NOT workspace packages; `pnpm -r`/`pnpm --filter` do not reach them. Per-package tests for these three packages are run via direct vitest invocation from the root `node_modules/.bin/vitest`. Contract delta requested (see below) for the TL to add `packages/integrations/*` to the workspace yaml.
2. **`pnpm architecture:check` baseline defect.** `architecture-policy.yaml` declares `version: 2`; the validator in `scripts/architecture/policy.mjs` requires `version: 1`. This is a baseline failure present at `35a6560`, unrelated to F200C. Both files are TL-owned; no fix attempted.
3. **`pnpm build` baseline OOM.** The sandbox has 4GB RAM and 0 swap; the `@zcode/web` vite build is Killed (exit 137). This is environmental and unrelated to F200C. The `pnpm run build:bootstrap` fallback fails at `@zcode/web` for the same reason (it excludes `@zcode/desktop` only). All 11 of my packages' own `build` scripts (`tsc --noEmit`) pass cleanly.
4. **No real provider integrations in Wave 0.** The `AurumPort`, `ApifyPort`, `ExternalVendorPort` adapters ship as deterministic reference implementations only. Real provider SDK adapters (e.g. Apify SDK, Aurum SDK) are intentionally out-of-scope for Wave 0 lane C — the lane ships structural seams + reference adapters per the work-item contract.
5. **No real Guardian path.** Worker B owns the Guardian. Worker C references the Guardian via local structural interfaces (`GuardianDecisionRefLike`) only. Convergence happens at F201.
6. **ZCode runtime imports not yet lint-discovered in the lane.** The boundary scan test only inspects worker-c owned paths. It does not (and cannot, in lane scope) scan the `@zcode/*` substrate itself. The architecture policy explicitly marks all current `@zcode/*` modules as `managed: false`, so the architecture:check gate does not enforce boundaries on them yet — this is the TL's F201 work.
7. **TypeScript `vitest/globals` types loaded but no `vitest.config.ts` per package.** Each package's `tsconfig.json` lists `"types": ["vitest/globals"]`. The root `node_modules` has `vitest@1.6.1` installed (pulled in by my packages' `vitest` devDep). Tests run cleanly with default vitest config; explicit `vitest.config.ts` files are not required for the simple `vitest run` flow.

## Requested shared-contract deltas for TL adjudication

1. **Add `packages/integrations/*` to `pnpm-workspace.yaml`.** Without this, `pnpm -r` and `pnpm --filter @fleetos/aurum` / `@fleetos/apify` / `@fleetos/external-vendors` do not reach the 3 nested integration packages. The lane has placed them at `packages/integrations/<name>` per `spec/worker-ownership.yaml` (worker-c owns `packages/integrations/{aurum,apify,vendors}/**`). The workspace glob needs `+ packages/integrations/*` (or `+ packages/integrations/**`) added by the TL.
2. **Reconcile `architecture-policy.yaml` `version` field with `scripts/architecture/policy.mjs` validator.** The policy file declares `version: 2`; the validator requires `version: 1`. Either bump the validator to accept `version: 2`, or roll back the policy file's `version` to `1`. Both files are TL-owned.
3. **Register the 11 worker-c packages in `architecture-policy.yaml` as managed modules.** Wave 0 left the policy file with only `@zcode/*` modules (all `managed: false`). Worker-c packages are not registered; architecture:check does not enforce boundaries on them yet. This is consistent with the policy file's stated intent ("New FleetOS modules become managed as they land"), but should be done by the TL as part of F201.
4. **Consider promoting the lane `TenantScope` (and `TenantScopeLike`, `GuardianDecisionRefLike`, `EvidenceRefLike`, `VendorCapabilityRefLike`) to canonical shared contracts at F201.** Wave 0 lane C defines these as local structural types in each worker-c package to comply with the cross-worker seam rule. Convergence on canonical shapes should happen at F201 by the TL.

## Scope violations

None. All edits are inside paths owned by worker-c per `spec/worker-ownership.yaml`:

- `packages/work/**`
- `packages/projects/**`
- `packages/workloads/**`
- `packages/procurement/**`
- `packages/vendors/**`
- `packages/software/**`
- `packages/agent-organizations/**`
- `packages/model-gateway/**`
- `packages/integrations/aurum/**`
- `packages/integrations/apify/**`
- `packages/integrations/vendors/**`
- `docs/evidence/F200C/**` (granted carve-out)

Plus the regenerated `pnpm-lock.yaml` (allowed: "regenerating via `pnpm install` IS allowed"). No hand-edits to `pnpm-workspace.yaml`, root `package.json`, `architecture-policy.yaml`, `spec/**`, `scripts/**`, `AGENTS.md`, `docs/**` outside the F200C carve-out, or any `@zcode/*` / non-worker-c package path.
