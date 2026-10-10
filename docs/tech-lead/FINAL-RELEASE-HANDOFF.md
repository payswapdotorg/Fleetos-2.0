# FleetOS 2.0 — Final TL Handoff: Wave 12

**Disposition: NOT READY.** This handoff supersedes the stale Wave-10-oriented execution instructions in this file. The repository is the sole source of truth; do not rely on conversation history.

**Current evidence baseline**
- Last tested source candidate: `8c97ac8a08faa735dae1bbb3c638dfba44ec9470`.
- Wave-11 documentation closeout: `1cc99703aaa706dedc5ad8c6f06ac3c642d6d33d` (documentation-only; do not treat it as a newly tested source candidate).
- Final gate workflow: [run 38022898223](https://github.com/payswapdotorg/Fleetos-2.0/actions/runs/38022898223).
- Final Wave-11 report: [F302 report](../evidence/F302/report.md).
- Adoption mapping and constraints: [F310C report](../evidence/F310C/report.md).
- Work ledger: [WORK-ITEM-CATALOG.md](../../spec/work-items/WORK-ITEM-CATALOG.md).

Before dispatch, the TL MUST inspect actual `main` HEAD, compare it with the tested candidate, inspect the working tree and workflow results, and record the exact SHA to be tested next. A documentation commit is not itself evidence that source gates passed at that commit.

## 1. Current verified position

### Closed at Wave 11
- **B-1 root typecheck: CLOSED.** Dedicated FleetOS shell TypeScript project and genuine shell fixes; root typecheck captured as exit 0 on a 16 GB builder.
- **B-2 full monorepo build: CLOSED.** Full build passed with lifecycle scripts on: 75/75 packages.
- Tests at the Wave-11 candidate: 4,872 monorepo tests and six green acceptance suites (field 69, security 103, commerce 81, adoption 95, release 88, convergence 82).
- All previously reported results must be revalidated if code changes; do not copy old green ticks onto a new SHA without testing.

### Open acceptance blocker
- **B-3 adoption coverage: OPEN.** Converged corpus = 1,848 counted executions across 30 workspaces; fully-applicable firm cap = **68**, against the retained target of **100 counted, genuinely distinct journeys per firm where applicable**; shortfall = 32 for the fully-applicable firm. The target is not to be lowered silently. See F310C §5–§7.

### Provider and deployment status — explicitly NOT READY
The user has clarified that the **Aurum, ADCOS, and Arena providers/integrations are not ready yet**. Respect that as an execution boundary:
- Aurum, ADCOS and Arena must remain **CONTRACT_ONLY / provider not ready** until upstream readiness is evidenced and a real or supported sandbox binding is exercised.
- A local adapter, deterministic reference path, mock, fixture, unit test or contract test is not a live or sandbox integration.
- Do not claim provider connection, live data, successful remote transactions, live learning/evaluation or external synchronization for these three providers.
- Do not make Wave-12 adoption expansion depend on those providers being ready. Use real domain capabilities that can be exercised locally without those providers. Defer provider-dependent journeys and replace them only with equally genuine, non-provider-dependent scenarios that the lane owner can substantiate.
- Apify and other external adapters also remain CONTRACT_ONLY wherever the evidence says there is no live endpoint or credential. Exercising a local lifecycle is permitted only if it is described as contract-level behavior, never as a live provider success.
- The current shell is a sandbox-hosted static build with fixture-composed in-browser state. Public production deployment and durable operational persistence are not evidenced. Preserve this qualification even after B-3 closes.

Therefore, “B-3 is the remaining Wave-11 counted-journey gate” must not be misrepresented as “all production readiness is otherwise achieved.” Full production/provider acceptance is still not evidenced.

## 2. Read first

1. `FLEETOS-SOURCE-OF-TRUTH.md`
2. `AGENTS.md`
3. `spec/ARCHITECTURE-LOCK.md`
4. `spec/BOUNDED-CONTEXTS.md`
5. `spec/DEPENDENCY-GRAPH.md`
6. `spec/worker-ownership.yaml`
7. `spec/work-items/WORK-ITEM-CATALOG.md`
8. `docs/tech-lead/CONCURRENCY-PROTOCOL.md`
9. `docs/evidence/F302/report.md`
10. `docs/evidence/F310C/report.md`
11. This handoff and `docs/tech-lead/RESIDUAL-RISKS.md`.

The TL must inspect the current source before implementing. Do not treat this handoff or the prior report as a substitute for a current checkout.

## 3. Execution order

### F320 — TL pre-dispatch decision: time-parameterization and the count-honesty law

**Owner: TL. Must be completed before F321A/B/C start implementation.**

Row 36 in F310C §3.5 identifies honest corpus time-parameterization as potentially high leverage. The report's ceiling of 170 is theoretical, not a guaranteed count. The TL must publish a concise, testable decision in a TL-owned evidence file before dispatch:

1. Define when two time/epoch cases are semantically distinct journeys.
2. Require a meaningful behavioral distinction: for example, expiry, deadline, staleness, window boundary or state transition that changes an asserted domain outcome. A changed timestamp alone is not sufficient.
3. Preserve the existing law: byte-identical reruns, synthetic telemetry, duplicated steps, altered labels and count-only parameter variations never become new journeys.
4. Define deterministic per-epoch expected outcomes and the tests that prove both the changed outcome and reproducibility.
5. Decide which runner/law changes are necessary and identify their TL-owned integration points. Workers must not modify TL-owned adoption-ledger or release-pin files without a written path grant.
6. If honest, meaningfully distinct cases cannot be proven, record that conclusion and proceed with the non-parameterized journey plan; do not force the count upward.

Freeze this contract and communicate it to all three workers. No worker may independently redefine “distinct.”

### F321A — Worker A: field, edge and asset journey expansion

**Owned lane:** A's existing edge/asset/field paths and A-owned acceptance corpus/evidence.

Start from the F310C §3.3 map. Implement and machine-run the ten-slot plan using genuine, currently implemented domain behavior:
- Candidate coverage includes store-and-forward redelivery, offline-buffer capture/replay, diagnosis lifecycle, anomaly confidence/triage, evidence-gated recovery, maintenance-calendar scale, asset/material lineage, identity/session lifecycle and tenant lifecycle gating.
- **Do not count `adcos-session-trust` as a provider-ready/live integration journey.** ADCOS is not ready. Replace that slot with a distinct journey on a non-ADCOS domain API, or leave the slot uncounted and document the shortfall.
- Discover any replacement through code inspection of a real public API and absence from current acceptance corpora. The worker must not invent a domain behavior that does not exist.

Acceptance:
- Each accepted journey drives real public domain entry points and asserts meaningful outcomes plus honest refusal/negative cases.
- At least five meaningful assertions per journey, unique journey ID, relevant vocabulary/step-kind law, tenant/security boundaries, deterministic behavior and justified industry applicability.
- Run the field acceptance suite, affected package tests, typecheck and lint. Provide exact SHA, commands/counts, changed paths and limitations.

### F321B — Worker B: safety, execution, audit and predictive-honesty journey expansion

**Owned lane:** B's existing safety/intelligence paths and B-owned acceptance corpus/evidence.

Start from the F310C §3.4 map. Implement and machine-run ten genuinely distinct slots from real local domain capabilities:
- Candidate coverage includes tamper-evident audit ledger, finding-storm triage, suppression lifecycle, verified execution dispatch, action compensation/rollback, capability-store disaster recovery, outcome evaluation/adoption, JEPA-family honesty and degradation/staleness honesty.
- **Do not count `arena-evaluation-runs` as a provider-ready/live integration journey.** Arena is not ready. Replace that slot with a non-Arena journey over an existing safety/intelligence API and prove its behavior, or leave the slot uncounted.
- JEPA-family work must keep predictive output labeled as deterministic structural reference unless a genuinely trained and validated model is supplied. Do not claim predictive accuracy.

Acceptance:
- Positive, negative, refusal, revocation, tenant-isolation and provenance paths are asserted where relevant.
- Unique IDs, meaningful assertions, deterministic behavior, no fake success, honest masks and exact evidence SHA.
- Run the security/convergence-relevant suites, affected package tests, typecheck and lint. Report changed-path ownership and results.

### F321C — Worker C: work, commerce and non-provider adoption expansion

**Owned lane:** C's existing work/commerce/project/vendor/procurement paths and C-owned acceptance corpus/evidence.

Implement the three currently deferred coverage slots from F310C §3.2–§3.3, while maintaining the provider boundary:
- `marketplace-publication-lifecycle`: may proceed against the existing local vendor-marketplace APIs.
- `actor-job-failure-expiry`: may proceed only as a locally exercised contract/lifecycle journey; this does not establish an Apify live binding.
- **Do not count `aurum-delta-sync-session` as an Aurum-ready/live integration journey.** Aurum is not ready. Replace it with a genuine non-Aurum work/commerce journey backed by an existing public domain API, or leave the slot uncounted and record the gap.
- No real-provider journey is accepted merely because a local adapter accepts the same shape.

Acceptance:
- Journeys cover real APIs, unique scenario identities, meaningful outcomes/refusals and at least five substantive assertions each.
- No rerun inflation, fake remote success, widened masks, modified target or changes to TL-owned ledger/pins.
- Run commerce and affected suites, typecheck and lint; provide exact SHA, commands/counts, owned-path diff and evidence.

### Parallel execution rule

After F320 freezes the shared counting contract, F321A, F321B and F321C MUST run concurrently. Use exactly three implementation workers (A/B/C); exploit non-conflicting work fully. Workers may not write to each other's owned paths or TL-owned adoption/release files. If a candidate slot depends on Aurum, ADCOS or Arena readiness, replace it with a substantiated provider-independent candidate instead of blocking the other lanes.

## 4. F322 — TL convergence and acceptance decision

**Owner: TL. Starts after all three lane reports are available.**

1. Inspect latest `main`, exact lane SHAs, clean working tree and changed-path ownership.
2. Review every new journey against F310C's API mapping; reject journeys supported only by prose, fixtures pretending to be remote results, or superficial timestamp changes.
3. Merge/converge only after exact lane commits and relevant tests are verified. TL alone updates the adoption ledger, per-industry masks where justified, convergence deltas and release count pins, unless a written scoped grant says otherwise.
4. Recompute the entire adoption ledger machine-wise across all 30 workspaces. Report the count by industry/firm, counted journey IDs, masks and shortfalls. Identical reruns are excluded by law; masks may narrow applicability only when evidence justifies them.
5. Run the affected suites after each integration and then the full clean-checkout gates on the final candidate:
   ```bash
   corepack pnpm install --frozen-lockfile
   corepack pnpm fleetos:source-of-truth
   corepack pnpm fleetos:snapshot:check
   corepack pnpm architecture:check
   corepack pnpm lint
   corepack pnpm typecheck
   corepack pnpm -r --no-bail test
   # Field, security, commerce, adoption, release and convergence acceptance suites
   corepack pnpm -r --no-bail build
   ```
6. Use a high-memory builder appropriate to the tested command. Preserve CI exit-status capture (including `PIPESTATUS` where output is piped); a green log without the real command exit code does not pass.
7. Browser-verify the final FleetOS shell and bind the evidence to the exact candidate SHA. Continue to state that the current hosting/state model is sandbox-static and fixture-composed unless public deployment and durable persistence evidence exists.
8. Update F302, product acceptance, residual risks, runbook if needed, work catalog, and AI continuation. Record an explicit NOT READY/READY verdict and name each remaining blocker. **B-3 remains open unless the machine-run ledger establishes the 100 target under the approved count law.** Do not lower the target to close the wave.

## 5. F323 — provider readiness and live integration lane (DEFERRED)

**Status: BLOCKED ON UPSTREAM READINESS; do not dispatch implementation against imaginary endpoints.**

This work is separate from F321 adoption journeys and does not block locally testable Wave-12 work. Before opening live integration work for a provider, the TL must record:
- the provider project's explicit readiness/release evidence and exact version or commit;
- a versioned API/event schema and supported operations;
- a real or documented provider sandbox endpoint that can be exercised;
- approved credential provisioning through runtime secrets/environment configuration (never commit credentials);
- authentication, tenancy, idempotency, retries/timeouts, rate limits, error/refusal mapping, reconciliation, observability and audit expectations;
- a runnable smoke-test procedure and the success/failure evidence that will determine SANDBOX_VERIFIED or LIVE_VERIFIED.

Once the upstream provider is actually ready, dispatch the provider lanes concurrently within existing ownership:
- Worker A: ADCOS live/sandbox binding and evidence.
- Worker B: Arena live/sandbox binding and evidence.
- Worker C: Aurum live/sandbox binding and evidence.
- TL: shared integration health, retries/idempotency, secrets/configuration, contract convergence, deployment and end-to-end acceptance.

Do not mark F323 complete because an adapter contract or unit test passes. Each connector stays **CONTRACT_ONLY / provider not ready** until the relevant end-to-end evidence passes. If upstream is still not ready, keep F323 deferred and continue unrelated product work.

## 6. Release and reporting rules

- Current release disposition remains **NOT READY**.
- Keep B-1/B-2 marked closed based on their recorded evidence; rerun the gates for the new candidate.
- Keep B-3 open until it closes honestly at the retained target.
- Keep Aurum, ADCOS and Arena explicitly provider-not-ready and CONTRACT_ONLY; they are not implicitly promoted by acceptance journeys that exercise local APIs.
- Do not claim fully production-ready status while public deployment, durable operational persistence and required live integrations are not evidenced.
- Keep deterministic structural JEPA/world-model outputs advisory-only unless a validated trained model is actually supplied.
- No target changes without explicit, recorded TL/user authorization. No silent scope reductions, placeholder successes, duplicate journey counts, fabricated endpoints or committed secrets.

**Handoff completion requirement:** the repository must contain the work orders, exact commits, test evidence, recomputed ledger, provider readiness matrix and final release verdict. The next TL must be able to continue using repository files alone.
