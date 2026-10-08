# F260C — Worker C (Work + Commerce) Wave 6 Optimization Lane Evidence

- **Work item:** F260C — agent organization optimization (Wave 6 lane C)
- **Owner:** Worker C (Work + Commerce)
- **Base commit:** `987954f` (dispatch tip — Wave 6 packets; main @ `e175f54`
  Wave 5 complete, full suite 3371/0 TL-verified at dispatch)
- **Branch:** `work/f260c` (worktree `/home/z/w-f260c`)
- **Date:** 2026-10-08
- **Packet:** `docs/tech-lead/packets/f260c.md`

**Two-session history (honesty):** this lane was finished from an
interrupted prior agent session that left near-complete STAGED,
uncommitted WIP (5 src modules + 5 test files + fixtures +
package.json/index.ts edits + the packages/work boundary-scan delta +
a draft of this report; nothing committed). This completing session
followed the dispatch protocol strictly: (1) `git stash` →
machine-verify the TRUE baseline at clean HEAD `987954f` → record →
`git stash pop --index` (§3 — all green, counts below); (2) line-by-line
review of every WIP file against the packet; (3) every gate re-run
from scratch in the package dirs; (4) coverage themes + net-new test
floor verified; (5) full 8-package lane re-verification. Review found
ONE defect in the WIP and fixed it: a private fixture-constant typo
(`EXCRIPT_APPENDS` → `EXCERPT_APPENDS`, no API impact). The staged WIP
already carried five hardening measures over a naive first cut — each
VERIFIED PRESENT and machine-tested during this session's review
(attribution inside the prior session is not recoverable: everything
arrived staged, nothing committed):

1. **Local search could swap in a pair the greedy pass had REFUSED** —
   a budget-ceiling refusal is count-based and swaps are count-neutral,
   so the swap could be materially legal, but it would make the proposal's
   own `refusals` list contradict its `assignments` (ceilings softened in
   the record even if not in the numbers). Fixed with a refused-pairs
   guard (machine-tested, incl. an observable case where a strictly
   higher-fit agent is refused and NOT swapped in).
2. **Swaps carried the previous holder's stale `scoreBps`** — the swap
   target's score is now recomputed through the single score formula.
3. **The greedy comparator's `fitBps` tie-break made the local-search
   phase UNREACHABLE** (within a role, pairs arrived fit-descending, so no
   non-refused candidate could ever have strictly higher fit than a
   holder) — the "greedy + local-search" two-phase algorithm the packet
   demands was effectively dead code and the WIP's fit-blind test passed
   vacuously. The comparator is now pure (score desc, agentId, roleId)
   order, making the greedy genuinely fit-blind under cost-only goals and
   the local search a REAL repair phase. Every amendment is now recorded
   in `localSearchSwaps` (trace + swaps reconcile exactly to
   `assignments` — machine-tested).
4. **The problem digest did not cover budget `consumedUnits/SpendMinor`/
   `generation` or role `responsibilities`** — post-prepare tampering of
   consumption was undetectable; the digest now covers them (+2 tamper
   tests).
5. **`package.json`'s description had been re-serialized** (em-dash →
   `\u2014` escape) by the prior session's `pnpm add` — restored verbatim;
   the only intended package.json delta is the
   `@fleetos/model-gateway: workspace:*` dependency (§6.1).

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-c):

- `packages/agent-organizations/**` — NEW `src/optimization-inputs.ts`,
  `src/role-allocator.ts`, `src/role-allocator-search.ts` (internal
  search module; type re-exported through role-allocator),
  `src/budget-rebalancer.ts`, `src/routing-optimizer.ts`,
  `src/what-if.ts`; NEW `tests/optimization-inputs.test.ts`,
  `tests/role-allocator.test.ts`, `tests/budget-rebalancer.test.ts`,
  `tests/routing-optimizer.test.ts`, `tests/what-if.test.ts`,
  `tests/optimize-fixtures.ts`; `src/index.ts` +5 additive
  `export *` lines; `package.json` + the workspace dependency (see §6.1)
- `packages/work/tests/boundary-scan.test.ts` — ONE allowlist entry + ONE
  new scoping test, FORCED by the packet-authorized model-gateway import
  seam (see §6.1 — the packet's "ONLY touch" clause and its import clause
  collide here; this is the smallest compliant resolution, fully
  documented for TL adjudication). No other file in `packages/work` was
  touched.
- `docs/evidence/F260C/**` (this file)

`pnpm-lock.yaml` carries NO modification in the worktree relative to
HEAD (machine-verified: `git diff HEAD -- pnpm-lock.yaml` is empty) and
is NOT committed (packet law); the staged `package.json` dependency is
therefore not reflected in the committed lockfile — the TL's merge-time
install will relink it (same convergence precedent as the F251 lockfile
follow-up). No spec edits, no snapshot regen,
`main` untouched. All existing exports are unchanged — the Wave 1/3 test
files run UNMODIFIED (machine-verified in every gate run).

## 2. What became operational-truth grade

F230C shipped the org runtime (roles, budgets, ceilings, journal-folded
snapshots) and the model gateway (registry, routing, ladders, usage
ledger). F260C adds deterministic OPTIMIZATION over those REAL
implementations — with the law encoded everywhere: optimization PROPOSES,
never applies; ceilings are hard walls, never authorizations.

### 2.1 `src/optimization-inputs.ts` — the problem definition

One entry point for every optimizer: org snapshot (from the package's OWN
`foldOrgSnapshot` over a chain-verified journal), usage excerpt (the
gateway's REAL `UsageLedgerEntry[]`, chain-verified via
`verifyUsageLedgerChain` + tenant-checked), declared goals (FIXED
vocabulary — `costWeightBps`/`capabilityFitWeightBps`/`latencyWeightBps`,
integer bps, no learned weights; non-negative, integer, 0 < sum ≤ 10000)
and constraints (policy ceilings + budget floors + revoked capabilities).
Validation is total with reason codes (tenant fail-closed, journal/ledger
chain broken at the earliest seq, role/budget record validation, floor and
ceiling legality). `optin_` FNV-1a digest over the full semantic content
(see fix #4); `deriveUsageFacts` folds the excerpt into the per-capability
floored means + per-agent demonstrated capabilities every optimizer
shares.

### 2.2 `src/role-allocator.ts` (+ `role-allocator-search.ts`) — role allocation

Deterministic two-phase assignment over the REAL role/capability
allow-lists: (1) GREEDY — every (candidate agent × demanded role) pair
scored by the single weighted formula
`floor((fit×fitWeight + (10000−costBps)×costWeight)/weightSum)`, processed
in (score desc, agentId, roleId) order — deliberately fit-blind when the
fit weight is 0; (2) LOCAL SEARCH — fit-repair swaps under the live
concurrent-roles ceiling, budget-neutral by construction (role-level
projections; holder counts unchanged), score recomputed, terminated
(fit strictly increases). Constraint violations are REFUSED with EXACT
overshoots and recorded in BOTH the refusals list and the trace — a
refused pair is never re-admitted by the local search (guard, machine
tested). Removed agents are excluded (`AGENT_REMOVED`), never assigned.
`RoleAllocationProposal` carries assignments + refusals + unfilled demand
+ the full greedy `scoringTrace` (one outcome per pair) +
`localSearchSwaps` (the audit bridge) + `roalloc_` digest.

### 2.3 `src/budget-rebalancer.ts` — capability budget rebalancing proposals

Integer-bps utilization bands (fixed vocabulary: under < 2500 ≤ healthy <
7500 ≤ over < 10000 = exhausted) over per-budget usage scoped from the
REAL excerpt (agent-scoped budgets match (agentId, capability);
role-scoped budgets match the capability org-wide — the excerpt carries
no role attribution; documented). Adjustments aim at the 6000 bps target
band via exact integer ceil-division; EVERY wall refuses with the exact
overshoot: policy ceilings (`ROLE_BUDGET_UNITS/SPEND_CEILING_EXCEEDED`),
budget floors (`BUDGET_FLOOR_UNITS/SPEND`), live consumption
(`CONSUMPTION_EXCEEDS_ALLOCATION` — consumption is never reset), and
revocation (`CAPABILITY_REVOKED` — a revoked capability is never granted
more; reclaiming it remains possible and is marked `revoked: true`).
Per-budget atomicity: any axis refusal means NO adjustment for that
budget. Every adjustment carries a deterministic `rebal_` idempotency key
(sensitive to tenant/org/budget/generation/current+target — machine
tested).

### 2.4 `src/routing-optimizer.ts` — model routing optimization

Per request class: a deterministic tradeoff frontier over the REAL
registry — capability-richness/cost/latency(=degradation-history) bps per
model, feasibility (context, budget) with the GATEWAY's own refusal codes
(`MODEL_CONTEXT_EXCEEDED`, `BUDGET_CEILING_EXCEEDED`,
`NO_MODEL_WITH_CAPABILITIES`), ordering that MIRRORS the gateway's urgency
semantics (`URGENCY_RICHNESS_THRESHOLD`: richness-first ≤ 2, cost-first
≥ 3 — the gateway's own constants), and a weighted `scoreBps` using the
problem's FIXED goal weights. The `current` outcome IS the REAL
`selectModel` decision (ordering rule / refusal code verbatim); the
`proposed` outcome is the frontier top (`frontier-top-weighted-score`).
Fallback-ladder REORDERING proposals: chains sorted by degradation
history then provider health then id; both current and proposed hop sets
come from the REAL `resolveFallbackLadder` (per-hop reason codes);
`ladder-already-optimal` when the order is unchanged. Registry/provider
inputs are validated through the gateway's own validators.

### 2.5 `src/what-if.ts` — pure what-if projections

`projectWhatIf` applies a proposal set to an org snapshot PURELY — the
input snapshot and every proposal record are deep-equal unchanged
(machine-tested) — producing a NEW `OrgSnapshot` whose digest follows the
package's own fold convention, plus a delta report in integer bps
(allocated/consumed units+spend, utilization bps before/after,
per-agent concurrent roles, routing cost before/after with honest
`null` when not computable). The projected state refuses budget
invariant violations (`PROJECTED_BUDGET_INVALID`). The analysis is marked
`kind: "what-if-analysis"`, `state: "experimental-projection"`,
`note: "never-authoritative-org-state"` — NEVER authoritative org truth;
only the Guardian/governance path can turn a proposal into reality.

## 3. Tests

Baseline machine-verified BEFORE the first edit (stash → run → record →
pop): agent-organizations 107 / model-gateway 81 / work 71 / projects 63 /
workloads 69 / procurement 94 / vendors 56 / software 62 (lane total 603),
all passing; typecheck exit 0 × 8. Re-verified after the last edit:
identical results except agent-organizations 182 (+75) and work 72 (+1) —
see §4.

| Package | Test files | Tests (total / new) | Status |
|---------|------------|---------------------|--------|
| `@fleetos/agent-organizations` | 10 (5 Wave 1/3 + 5 new) | 182 (107 + 75) | all passing |
| `@fleetos/work` (boundary scan) | 3 | 72 (71 + 1) | all passing |
| **Net-new this lane** | | **76** | |

Net-new: **76 tests** (packet target ≥ 50). Per file:
optimization-inputs 24 / role-allocator 16 / budget-rebalancer 14 /
routing-optimizer 12 / what-if 9 / work boundary scoping 1.

### Test themes covered

- **Optimizer determinism**: byte-level `JSON.stringify` equality of full
  proposals (problem, allocation, rebalance, routing, what-if) on
  identical inputs, including digests and idempotency keys.
- **Constraint refusal, never softened**: units/spend/concurrent
  ceiling refusals with EXACT overshoots; revocation walls; floors;
  consumption walls; the refused-pair guard (a strictly higher-fit agent
  refused by the units ceiling is NOT swapped in by local search);
  projected-budget invariant refusal in what-if.
- **Hand-computed score correctness**: fit 5000 for 1-of-2 demonstrated
  capabilities, costBps 1700 = floor(8500×10000/50000), scoreBps 5490 =
  floor((5000×6000+8300×3000)/10000) — asserted exactly on assignments
  AND the trace; rebalancer targets ceil(used×10000/6000) with exact
  deltas; frontier bps (richness 6666, cost 4000, latency 10000, score
  5799) hand-computed.
- **Rebalancer bands + idempotency**: fixed band boundaries (2499/2500/
  7499/7500/9999/10000); healthy budgets skipped honestly; idempotency
  keys deterministic AND content-sensitive (generation change → different
  key).
- **Routing frontier ordering + reason codes**: richness-first vs
  cost-first ordering per the gateway's urgency threshold; gateway
  refusal codes propagated verbatim (`NO_MODEL_WITH_CAPABILITIES`,
  `BUDGET_CEILING_EXCEEDED`, `MODEL_CONTEXT_EXCEEDED`); ladder reordering
  with REAL per-hop reason codes (`PROVIDER_MISSING_MODEL`, `SELECTED`,
  `NOT_ATTEMPTED`); `ladder-already-optimal`.
- **What-if purity + deltas**: input snapshot + proposals deep-equal
  unchanged (structuredClone compare); projected snapshot is a NEW
  value with the package's own digest convention; before/after bps
  (allocated +150 = +1000 bps, utilization 2666 → 2424); no-proposal
  projection equals the baseline; routing cost deltas.
- **Tenant fail-closed everywhere**: journal/ledger/budget/what-if tenant
  mismatches with typed codes; the problem refuses a foreign journal AND
  a foreign excerpt.
- **Digests verify + tamper**: problem digest tamper (goals, budget
  consumption, role responsibilities); snapshot digest tamper in what-if;
  usage-ledger and journal-chain tamper detected at the earliest broken
  seq through the REAL verifiers.
- **End-to-end composition**: allocator → rebalancer → routing → what-if
  over REAL implementations in one test, asserting the optimizers never
  mutated the problem's snapshot.

## 4. Gate outputs (exact, in each package dir)

Per the packet — gates run INSIDE the package (root gates are TL gates).

### 4.1 `corepack pnpm run test` — PASS

```
=== agent-organizations === (10 files)
      Tests  182 passed (182)
=== work === (3 files)
      Tests  72 passed (72)
```

Post-edit lane re-verification (all 8 worker-c packages):
model-gateway 81 / agent-organizations 182 / work 72 / projects 63 /
workloads 69 / procurement 94 / vendors 56 / software 62 — lane total 679,
0 failures.

### 4.2 `corepack pnpm run typecheck` — PASS (exit 0 each)

```
agent-organizations TYPECHECK exit=0
work TYPECHECK exit=0
(+ model-gateway/projects/workloads/procurement/vendors/software exit=0)
```

### 4.3 Per-package `corepack pnpm run lint` — 0 warnings / 0 errors

```
=== agent-organizations ===  Found 0 warnings and 0 errors.  (25 files)
=== work ===                Found 0 warnings and 0 errors.  (12 files)
```

Max file length: 397 lines (`tests/role-allocator.test.ts`); largest src
file 371 (`routing-optimizer.ts`) — every file ≤ 400 (lint law).

## 5. Boundary verification (machine-tested)

```text
$ rg "Date\.now|Math\.random|setTimeout|setInterval|fetch\(|new Date" \
    packages/agent-organizations/src packages/agent-organizations/tests
  (no matches)  -> CLEAN
$ rg -n "from ['\"]@fleetos/" packages/agent-organizations/src
  @fleetos/model-gateway ONLY (public entry point, never deep paths)
  in optimization-inputs.ts + routing-optimizer.ts; tests import it for
  REAL fixtures (appendUsage) and REAL types
$ git status --short (at commit time)
  packages/agent-organizations/** + packages/work/tests/boundary-scan.test.ts
  + docs/evidence/F260C/** — pnpm-lock.yaml explicitly NOT committed
```

The lane boundary scan (`packages/work/tests/boundary-scan.test.ts`)
still enforces: zero `@zcode/*` imports lane-wide, zero `@fleetos/*`
imports outside the allowlist (now `["@fleetos/model-gateway"]`, §6.1),
the expected 11 lane package names, AND a NEW scoping test: only
agent-organizations may import model-gateway — every other lane package
stays self-contained (machine-checked).

## 6. Contract deltas / seams for TL adjudication

1. **The intra-lane runtime seam `agent-organizations →
   @fleetos/model-gateway` (packet-authorized, boundary-test-forced).**
   The F260C packet REQUIRES building on the REAL model-gateway
   implementations (usage-ledger excerpt verification, registry/routing/
   fallback-ladder reuse, gateway reason-code vocabulary) and its import
   rule enumerates model-gateway as importable. But the Wave-0 lane
   boundary scan in `packages/work/tests/boundary-scan.test.ts` (an
   F200C machine-checked acceptance clause, in MY owned path but OUTSIDE
   this work item's "ONLY touch" set) had `FLEETOS_ALLOWLIST = []` —
   "each worker-c package is self-contained and may not import even its
   sibling worker-c packages". These two clauses collide: without the
   import, the routing optimizer cannot run the REAL
   `selectModel`/`resolveFallbackLadder` (a type-only frozen seam cannot
   reuse FUNCTIONS, and re-implementing them locally would duplicate the
   gateway and violate "over the REAL implementations"). Resolution
   taken (smallest compliant decision, per AGENTS.md): added
   `"@fleetos/model-gateway"` to the allowlist + a NEW scoping test
   (only agent-organizations may import it) + this prominent record.
   **This is the one file touched outside `packages/agent-organizations`
   + `docs/evidence/F260C` — TL, please adjudicate.** Alternatives: (a)
   accept as-is; (b) move the scoping decision into a TL-owned shared
   boundary check; (c) direct a frozen-seam rewrite (degrades the
   "REAL implementations" requirement to type-mirrors).
2. **`package.json` gains `"@fleetos/model-gateway": "workspace:*"`** —
   the workspace dependency for the seam above. `pnpm-lock.yaml` was
   NOT committed (packet law); the TL's merge-time install will relink
   it (same convergence precedent as the F251 lockfile follow-up).
3. **`role-allocator-search.ts` internal module** — the local search
   extracted to keep `role-allocator.ts` ≤ 400 lines (lint law). It uses
   the frozen-seam pattern (a structural `SearchableAssignment`;
   `ProposedAssignment` is assignable at the call site) to avoid a
   module cycle. `LocalSearchSwap` is public (re-exported through
   role-allocator → index).
4. **Greedy comparator decision**: pure (score desc, agentId, roleId)
   order — fit is deliberately NOT a tie-break so the two-phase algorithm
   is real (see inherited-WIP fix #3). With fit-weighted goals the
   greedy is already fit-optimal and the local search records zero
   swaps (machine-tested); with cost-only goals it is fit-blind and the
   local search repairs fit (machine-tested, swap recorded).
5. **Revocation semantics in the rebalancer**: revoked capabilities
   refuse EXPANSION (`CAPABILITY_REVOKED`) but allow RECLAIM (marked
   `revoked: true`). If the TL prefers revoked capabilities to be frozen
   entirely (no reclaim proposals either), it is a one-line change in
   `planAxis`.
6. **`bpsChange` honesty convention**: integer-bps deltas return `null`
   when `before = 0` and `after ≠ 0` (not computable, never faked).
7. **What-if does not verify proposal digests** — the snapshot digest is
   verified, but `RoleAllocationProposal`/`BudgetRebalanceProposal`/
   `RoutingOptimizationProposal` digests are not re-verified inside
   `projectWhatIf` (verifying them requires the originating problem,
   which what-if deliberately does not receive). Recorded as a residual
   (§7.4).

## 7. Residual limitations (honest list)

1. **No persistence, I/O, network or daemons.** All modules are pure
   functions over value types; the composing application feeds real
   journals/ledgers/registries and routes proposals through the
   Guardian/governance path. Nothing in this lane executes a proposal.
2. **The optimizers are heuristics, not solvers.** Greedy + local search
   is deterministic and bounded but not optimal in general; the trace,
   swaps, refusals and digests make every decision auditable, which is
   the operational-truth requirement here.
3. **Role-scoped budget usage is capability-org-wide** — the gateway's
   usage ledger carries no role attribution (agentId + capability only),
   so role-scoped rebalance inputs aggregate the capability across the
   org. Documented in `scopedExcerptUsage`; fixing it needs a
   role-attributed usage seam in model-gateway (TL decision).
4. **What-if trusts proposal-record digests** (see §6.7) and projects at
   aggregate granularity (budget totals + concurrent roles + routing
   costs), not per-team membership.
5. **Latency in the routing frontier is degradation-history-derived**
   (down-event share, floored bps), not a measured latency — the gateway
   registry has no latency field. A latency field on `ModelDescriptor`
   would be the convergence seam.
6. **FNV-1a 32-bit digests** (lane convention) — deterministic and
   tamper-detecting within this lane's threat model, not cryptographic.
7. **`pnpm -r test` (full suite) was NOT run** — per the packet's
   memory-constrained-box rule, gates ran per-package (one vitest per
   package dir, repeated for the clean-HEAD baseline and the final
   verification). Cross-package breakage is impossible
   from this change set EXCEPT through the deliberate model-gateway
   import seam, which is type-checked in both directions
   (agent-organizations typecheck exit 0 with the real package linked).
8. **Root gates** (architecture:check, contract snapshot regen) NOT run —
   TL merge-time. The public-surface additions (5 new modules + 1
   re-exported type through role-allocator) may extend the snapshot;
   regen is the TL's gate.

## 8. Stop-the-line events

One, resolved with full disclosure: the packet-authorized
model-gateway import collides with the Wave-0 lane boundary scan
(empty `FLEETOS_ALLOWLIST`). Machine-reproduced in this completing
session by running the scan at its HEAD version against the final
code: `forbidden cross-lane @fleetos/* imports:`
`agent-organizations/src/{optimization-inputs,routing-optimizer}.ts →
@fleetos/model-gateway` — `1 failed | 70 passed (71)`. Investigated to
root cause (§6.1: the Wave-0 empty allowlist vs the F260C import
clause), resolved with the minimal allowlist + NEW scoping test, and
recorded here for TL adjudication. No other red state at any point in
this session; every gate run on the final committed state was green on
first execution.

## 9. Verification commands for TL re-run

```bash
cd /home/z/w-f260c   # (or: git fetch origin work/f260c && checkout)
# boundary:
rg -n "from ['\"]@fleetos/" packages/agent-organizations/src   # only @fleetos/model-gateway (root entry)
rg -n "Date\.now|Math\.random|setTimeout|setInterval|fetch\(|new Date" \
  packages/agent-organizations   # expect no matches
# gates (per package, per packet):
(cd packages/agent-organizations && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint)
(cd packages/work && corepack pnpm run test && corepack pnpm run typecheck && corepack pnpm run lint)
# expect: 182 tests / 72 tests, typecheck exit 0 x2, lint 0w/0e x2
# post-edit lane re-verification:
for p in model-gateway projects workloads procurement vendors software; do
  (cd packages/$p && corepack pnpm run test)   # 81/63/69/94/56/62
done
```
