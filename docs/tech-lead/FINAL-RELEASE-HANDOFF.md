# FleetOS 2.0 — Final Release Handoff to the Tech Lead

**Current decision:** NOT READY. Do not change the decision based on documentation-only commits.

**Latest inspected closeout:** `831ef400ed8fd0f9352836b68ed932bf2fb05419` (Wave 10 acceptance report and residual-risk register update). Always inspect the actual `main` HEAD before dispatch or gate runs.

**Authoritative evidence:**
- `docs/evidence/F302/report.md`
- `docs/tech-lead/PRODUCT-ACCEPTANCE-REPORT.md`
- `docs/tech-lead/RESIDUAL-RISKS.md`
- `docs/tech-lead/RUNBOOK.md`
- `spec/work-items/WORK-ITEM-CATALOG.md`
- `spec/worker-ownership.yaml`

This is the final execution handoff after Wave 10. Waves 0–10 remain completed in the repository ledger. The task is to resolve or explicitly adjudicate the release blockers and verify the actual product deployment. Never rewrite completed history or weaken an acceptance target merely to obtain a green result.

## Release blockers at handoff

1. **B-1 — root typecheck:** `corepack pnpm typecheck` exited 137 (OOM) on the recorded 4 GB environment. The equivalent per-package gate passed for 47/47 FleetOS domain packages, but the required full root gate has not passed.
2. **B-2 — full build:** the recorded recursive build left four inherited substrate targets failing: ZCode web OOM; desktop/server tooling ENOENT under the recorded `--ignore-scripts` install; ZCode CLI SEA tooling. The standalone FleetOS shell built, but that does not replace the full build gate.
3. **B-3 — adoption coverage:** 1,575 counted executions across 30 workspaces; the fully applicable corpus cap is 58 journeys per firm against the 100-counted-journey target. The 42-journey shortfall is explicit and must not be hidden by counting byte-identical reruns or masking valid journeys.
4. **Production deployment/persistence qualification:** F301 evidence reports the shell served locally on `:3105` with fixture-input composition. Do not describe that as a publicly accessible production system with durable operational persistence unless current evidence proves those properties. This is an acceptance qualification to resolve or explicitly scope, not a reason to falsify the existing report.

The connector matrix is also still entirely `CONTRACT_ONLY`. Do not claim live external connectivity without real endpoint and credential-handling evidence. Predictive output must remain labeled as a deterministic structural reference unless a trained model is actually validated.

## Concurrency plan — exactly three implementation workers

Dispatch F310A, F310B and F310C concurrently. They must respect current ownership and must not edit TL-owned files or one another's paths. TL owns gate composition, cross-lane repairs, adoption-ledger integration, deployment and final disposition.

### F310A — Full root typecheck on a suitable builder (Worker A)

Goal: close B-1 with an actual successful root typecheck, not an inferred equivalent.

1. Use a clean checkout at the actual candidate commit on a builder with at least 8 GB RAM and without the resident stack that exhausted the recorded 4 GB sandbox.
2. Run the documented frozen install and full root typecheck:
   `corepack pnpm install --frozen-lockfile`
   `corepack pnpm typecheck`
3. Capture machine output, exit codes, memory/builder facts, branch and exact commit. Do not commit generated files or change TypeScript options simply to suppress the failure.
4. If it still fails, produce a minimal reproduction and a repair proposal; leave B-1 OPEN until the root command passes.

Delivery: `docs/evidence/F310A/report.md` on the worker's owned evidence path through TL coordination, or a TL-approved equivalent, including the exact tested SHA.

### F310B — Full monorepo build with the complete toolchain (Worker B)

Goal: close B-2 on a suitable builder.

1. Start from a clean checkout at the candidate SHA and provision a full supported toolchain. Do not use `--ignore-scripts` if doing so leaves required Electron, server, or SEA tooling unavailable.
2. Run `corepack pnpm install --frozen-lockfile`, followed by `corepack pnpm -r --no-bail build`.
3. Record every package's result, including the inherited ZCode web, desktop, server and CLI targets. A standalone FleetOS build is reported separately and is not a substitute for the full gate.
4. If a real code failure remains after the environment is correct, identify the path owner and create a scoped repair packet. Do not patch files outside ownership.
5. Leave B-2 OPEN until the required full build passes or a formally approved, narrowly scoped release policy supersedes it. No such policy is currently recorded.

Delivery: `docs/evidence/F310B/report.md`, machine output and exact candidate SHA.

### F310C — Adoption coverage closure packet (Worker C)

Goal: resolve B-3 honestly and create a defensible decision for the TL/user.

1. Start with the converged figures in F302: 1,575 counted executions; 58 applicable journeys per fully applicable firm; target 100; shortfall 42.
2. Map the missing 42 journey slots to concrete product capabilities and personas. Classify each proposal as (a) supported by a real implementation today, (b) requiring genuine new capability work, or (c) not applicable to that industry with a reason and equivalent scenario where appropriate.
3. Add genuinely distinct journeys only when they exercise real behavior. Never count identical reruns, synthetic telemetry, dummy success, or a broadened applicability mask as new coverage.
4. Respect worker ownership: C may implement and test additions under C-owned work/commerce paths. Adoption-ledger code remains TL-owned unless a written scoped grant is issued. Any A/B-owned journey work must be separately dispatched to that owner.
5. If the existing product cannot truthfully supply the remaining journeys, do not fabricate them. Deliver a decision packet with options and trade-offs for the TL/user: build genuine missing capability, retain the 100 target and remain NOT READY, or obtain an explicit recorded decision to revise the acceptance criterion. The worker cannot change the target on its own.

Delivery: `docs/evidence/F310C/report.md` with journey-to-capability mapping, actual new counted journeys, applicability/mask justifications, recomputed firm-by-firm shortfalls and a recommended decision. No decision is assumed by this handoff.

## TL release convergence — F311

Run non-conflicting integration work while workers execute, then converge after all three deliveries.

1. Inspect actual `main` HEAD, clean working tree and lockfile.
2. Reconcile worker deliveries by exact commit and owned paths; verify their evidence, don't accept prose-only completion.
3. If F310C adds journeys, update the TL-owned adoption ledger and release-gate fixtures/count pins, recompute all industry masks and per-firm results, and re-run affected baselines. Do not change the 100 target without an explicit recorded decision.
4. Resolve deployment/persistence qualification: establish whether a public deployment exists and identify its exact commit and URL. Confirm whether operational state is fixture-derived or durably persisted. If only the fixture-composed demonstration exists, keep production deployment/persistence unverified and include it in the final disposition.
5. Preserve honest connector statuses. All currently recorded connectors remain CONTRACT_ONLY until a real integration environment is independently exercised.
6. Refresh the contract snapshot and update acceptance evidence only from the actual converged tree.

## F312 — Final clean-checkout release gate and disposition (TL)

Run on the exact final candidate in a clean checkout and record machine output:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm fleetos:source-of-truth
corepack pnpm fleetos:snapshot:check
corepack pnpm architecture:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm -r --no-bail test
# Run each of field, security, commerce, adoption, release and convergence
# acceptance suites and capture the individual counts.
corepack pnpm -r --no-bail build
```

Then verify the FleetOS product build and deployed URL in a browser. Evidence must bind the browser-tested build to the exact tested commit. Record the environment, command, exit status, results, and any failure. A gate is not green just because an alternative or per-package check passed.

Update:
- `docs/evidence/F302/report.md` with the final candidate, gate results and disposition;
- `docs/tech-lead/PRODUCT-ACCEPTANCE-REPORT.md`;
- `docs/tech-lead/RESIDUAL-RISKS.md`;
- `docs/tech-lead/RUNBOOK.md` if the gate/deployment procedure changes;
- `AI_CONTINUATION.md` with the actual latest state;
- the Wave 11 work-item statuses/evidence links.

## Final verdict rule

Declare **READY** only when all required release gates have passed, the target decision is recorded, and the required user-facing deployment acceptance is evidenced. Otherwise declare **NOT READY** and list each remaining blocker with owner, reproduction, repair and next decision.

The desired closeout is not “more green ticks.” It is a technically honest, reproducible release decision from the latest clean checkout, with no silent skips, no invented live integrations, and no hidden adoption shortfall.
