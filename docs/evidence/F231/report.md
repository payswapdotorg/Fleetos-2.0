# F231 — Intelligence/application convergence (Wave 3 TL lane) — Completion Evidence

- **Work item:** F231 — Wave 3 convergence (catalog: `spec/work-items/WORK-ITEM-CATALOG.md` — "Intelligence/application convergence, TL, after F230A/B/C")
- **Owner:** TL lane (executed by a TL-dispatched worker agent under the TL grant, Task ID `7-a`)
- **Base commit:** `7981216` ("TL: dispatch packet for F231 — Wave 3 convergence (composition site packages/integrations/convergence)")
- **Branch:** `work/f231` (worktree `/home/z/w-f231`)
- **Date:** 2026-10-07
- **Packet:** `docs/tech-lead/packets/f231.md`

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (TL owns `packages/integrations/convergence/**`) and the packet's hard boundary:

- `packages/integrations/convergence/**` — NEW package `@fleetos/convergence` (did not exist at dispatch; verified at baseline)
- `docs/evidence/F231/**` (this report)

No file outside the above paths was modified or committed. `pnpm-lock.yaml` IS dirty
(workspace linking for the new package) and is deliberately left **uncommitted**
per the packet — the TL runs `pnpm install` at merge/adjudication time.

Package inventory (13 files, all ≤ 400 oxlint-counted lines — max file 348):

```text
packages/integrations/convergence/package.json          (new; exports map: ., ./mission-assembly, ./model-stack-assembly, ./advisory-assembly)
packages/integrations/convergence/tsconfig.json         (new; mission-style, + the seam-gap `paths` bridge, §6.1)
packages/integrations/convergence/vitest.config.ts     (new; the seam-gap runtime alias bridge, §6.1)
packages/integrations/convergence/src/index.ts          (new, barrel)
packages/integrations/convergence/src/mission-assembly.ts   (new, 164 lines)
packages/integrations/convergence/src/mission-drive.ts       (new, 281 lines — the lint-law split of driveMission)
packages/integrations/convergence/src/model-stack-assembly.ts (new, 348 lines)
packages/integrations/convergence/src/advisory-assembly.ts   (new, 266 lines)
packages/integrations/convergence/tests/helpers.ts           (new, shared deterministic fixtures)
packages/integrations/convergence/tests/mission-stack.test.ts   (new, 11 tests)
packages/integrations/convergence/tests/model-stack.test.ts      (new, 16 tests)
packages/integrations/convergence/tests/advisory-loop.test.ts    (new, 20 tests)
packages/integrations/convergence/tests/convergence.test.ts      (new, 4 tests)
```

Private, Apache-2.0, `type: module`, package conventions copied from
`packages/mission`. `workspace:*` TYPE/runtime dependencies on exactly the
eight composed packages (kernel, control-plane, mission, predictive,
world-model, world-context, model-gateway, agent-organizations). No new
runtime dependencies (devDependencies: typescript + vitest only).

## 2. What was built — the composition assemblies

THIS PACKAGE IS THE SANCTIONED COMPOSITION SITE (AGENTS.md: "cross-context
tests may bind real implementations at test composition sites; application
composition belongs to tl"). Every seam below binds REAL implementations
from the composed packages' public entry points — never deep paths.

### 2.1 `mission-assembly.ts` — `assembleMissionStack(options)`

One factory producing a fully-wired durable mission stack:

- `MissionRuntime` (mission) over its own `MissionStore` +
  `InMemoryMissionOutbox` — the mission-owned in-memory drivers that
  `implements` the KERNEL's `TransactionalSession` / `OutboxPort` TYPEs;
- the control-plane `CommandQueue` bound behind the mission package's
  `CommandSubmitPort` TYPE seam through the control-plane's own
  `queueAsSubmitPort` adapter (the F221 composition point — pinned here at
  runtime, not just structurally: duplicate submits return the ORIGINAL ack);
- the control-plane `ExecutionLedger` (hash-chained, law A19);
- the KERNEL's `InMemoryKernelDriver` + `InMemoryOutbox` +
  `unitOfWorkFactory` — exposed as `stack.kernel` with a keyspace registry,
  so the application layer opens real kernel UnitOfWork sessions over the
  kernel drivers (used by the drive helper below).

**`driveMission(stack, scenario)`** (in `mission-drive.ts`, re-exported
through `./mission-assembly`): the deterministic drive helper — submits a
mission, pumps the queue at explicit logical ticks, runs scripted
per-attempt outcomes (complete → `queue.complete` + `runtime.completeStage`;
fail → `queue.fail` with the deterministic retry ladder; dead-letter →
`runtime.failStage` so the mission journal records the failure ATOMICALLY),
records `submitted/acknowledged/completed/attempt-failed/retry-scheduled/
dead-lettered` ledger entries, and writes a per-tick run-log record + kernel
outbox event through a kernel UnitOfWork session. Produces the final
journal + folded view + queue records + ledger chain + outbox events +
kernel run-log/outbox state.

### 2.2 `model-stack-assembly.ts` — `assembleModelStack(options)`

Budget-gated model selection with reason-code propagation, wiring:

- model-gateway ROUTING (`selectModel`: capability → context → cost filter
  + recorded priority ordering) over a validated registry;
- PROVIDER FALLBACK (`resolveFallbackLadder`) — reason code at every hop;
- DEGRADED-MODE classification (`classifyDegradedMode`) surfaced on every
  decision;
- the agent-organizations budget as the authoritative gate, bound through
  the gateway's `BudgetCheckPort` TYPE seam: **the port's concrete binding
  is the org package's REAL `checkAgentBudget`** (the F230C §6.1 seam —
  machine-verified by a byte-identical-answer test against the direct org
  call);
- usage accounting through the gateway's `appendUsage` (chained ledger,
  duplicate-requestRef dedupe) — the winner's usage is recorded through the
  SAME port (which re-checks the budget), and the org budget record is
  consumed via the org package's pure `consumeFromBudget` so subsequent
  selections see the true remaining ceiling;
- `replenish` raises an agent budget ceiling through the org package's
  `replenishBudget` (consumption preserved, generation bumped — never a
  stealth reset), restoring the primary model.

Selection semantics: candidates are tried in the gateway's ranked order;
the org budget is checked through the port BEFORE any usage is recorded; an
org-refused candidate routes selection to the next-ranked model with the
ORG's reason code propagated verbatim as `budgetReasonCode` (never a silent
drop, law A4). The request's `budgetCeilingMinor` is an explicit
application input (like `estimatedUnits`) — the gateway's routing filter and
the org budget are two independent policies composing at this site.

### 2.3 `advisory-assembly.ts` — `assembleAdvisoryLoop(options)`

world-context context assembly → predictive `ModelPort` reference adapter →
advisory predictions with provenance + integer-bps confidence:

- folds the authoritative world journal with the world-model PURE FOLD
  (`foldWorldState`), classifies staleness (`projectEntity`);
- maps the folded world entities into the world-context LOCAL snapshot
  shapes and assembles the context (`assembleContext`, purpose
  `model-input`, caller-supplied redaction rules honored, digest-stamped
  and digest-verifiable);
- projects the target entity's observation log through the caller-supplied
  `ModelPort` (default: the predictive package's REAL
  `makeReferenceModelPort()`), producing an advisory `Prediction` with full
  provenance (observationRefs, modelVersion, inputDigest).

**The advisory law is STRUCTURAL in the composition** (packet requirement).
Mechanism (each layer machine-tested):

1. `AdvisoryLoopOutput` carries the machine-carried `advisory: true` marker
   PLUS a module-private **unique-symbol brand** (`ADVISORY_ONLY`) — the
   output type is not assignable to `WorldJournalEntry`, `TwinStateInput`
   or `WorldEntitySnapshot` (compile-pinned with `@ts-expect-error`
   proofs);
2. the embedded `Prediction` structurally cannot become a `TwinStateInput`
   (no observation-ref history) nor a `WorldEvent` (its `kind` is
   `"PREDICTION"`, not a `WorldEventKind`) — compile-pinned;
3. a `ProjectedPoint` cannot become a `WorldObservationPoint` (no
   `observationRef`) — compile-pinned;
4. the loop exposes **NO function that writes authoritative state** — it
   only reads the world journal; extending the journal remains the
   world-model public surface (`nextWorldEntry` over `WorldEvent`), which
   advisory outputs cannot satisfy;
5. the runtime guard `isAdvisoryLoopOutput` verifies BOTH markers (outer +
   inner `isAdvisoryPrediction`) survive untrusted transit.

## 3. Tests

**51 composition tests** (target ≥ 50), across 4 files, all binding REAL
implementations at the composition site:

| file | tests | themes |
| ---- | ----- | ------ |
| `tests/mission-stack.test.ts` | 11 | full wiring; work orders through the bus; queue+ledger+journal+outbox consistency at every step; journal replay == folded state; determinism (byte-identical); dead-letter atomicity; retry ladder pre-dead-letter; kernel UoW+outbox; submit-port idempotency; tenant fail-closed; kernel tenant gate |
| `tests/model-stack.test.ts` | 16 | REAL checkAgentBudget behind the port (byte-identical); primary selection; budget-short fallback with org reason codes (SPEND/UNITS); total-exhaustion honest refusals; replenishment restores primary (consumption kept); consumption reflected; degraded mode + ladder hops; all-down refusal; no-budget refusal; cross-tenant fail-closed; chained usage ledger; duplicate requestRef; priority policy; routing refusals; determinism |
| `tests/advisory-loop.test.ts` | 20 | context-from-world-state + prediction provenance; determinism; staleness fresh/stale/unknown; redaction + digest; unknown entity; empty history; invalid horizon; invalid thresholds; missing tenant; cross-tenant refusal; mixed-tenant fold; caller-supplied ModelPort stub seam; reference default; runtime guard; 6 compile-time advisory-law proofs |
| `tests/convergence.test.ts` | 4 | budget-gated model selection INSIDE a mission stage (mission completes after the selections); suspend/resume across a RESTART (new runtime instance, same journal, deduped re-issue, exactly-once execution); missing-tenant fail-closed across EVERY context; whole-composition determinism |

Every packet scenario is machine-tested:
- ✔ a mission that issues work orders through the bus; queue + ledger +
  journal + outbox all consistent at every logical step; journal replay
  across the composition equals folded state;
- ✔ budget-gated model selection inside a mission stage: exhaustion routes
  to fallback with propagated reason codes; replenishment restores primary;
- ✔ advisory loop: context assembled from world state, advisory projection,
  provenance + determinism (same inputs → byte-identical outputs);
- ✔ dead-letter mid-mission: a failing work order dead-letters after max
  attempts while the mission journal records the failure atomically
  (stage-failed + mission-failed as contiguous seqs at the same `at` — one
  session commit; no dual-write gap);
- ✔ tenant fail-closed across every context in the composition (missing
  tenant → refusal everywhere, no partial state);
- ✔ suspend/resume of a composed mission across a "restart" (new runtime
  instance, same journal) — resume from checkpoint.

## 4. Gate outputs (exact)

Per the packet — run in `packages/integrations/convergence`. Root-level
gates were NOT run (packet instruction — memory-constrained box; the TL runs
them at merge time).

### 4.1 `corepack pnpm run test` — PASS

```text
 ✓ tests/convergence.test.ts (4 tests)
 ✓ tests/advisory-loop.test.ts (20 tests)
 ✓ tests/model-stack.test.ts (16 tests)
 ✓ tests/mission-stack.test.ts (11 tests)

 Test Files  4 passed (4)
      Tests  51 passed (51)
```

### 4.2 `corepack pnpm run typecheck` — CLEAN

```text
> @fleetos/convergence@2.0.0-alpha.0 typecheck
> tsc -p tsconfig.json --noEmit
(exit 0, no diagnostics)
```

### 4.3 `corepack pnpm run lint` (self-check) — 0 warnings / 0 errors

```text
Found 0 warnings and 0 errors.
Finished in 10ms on 5 files using 2 threads.
```

## 5. Boundary verification (machine-tested)

The packet's self-check:

```text
$ grep -rEn "import .* from ['\"]@fleetos/(kernel|control-plane|mission|predictive|world-model|world-context|model-gateway|agent-organizations)" packages/integrations/convergence/src | grep -vE "from ['\"]@fleetos/[a-z-]+(['\"]|$)"
CLEAN
```

Every `@fleetos/*` import in src AND tests is from a package ROOT specifier
(`@fleetos/mission`, `@fleetos/model-gateway`, …) — zero deep paths.

Determinism sweep:

```text
$ rg -n "Date\.now\(|Math\.random\(|setInterval|setTimeout\(|fetch\(" packages/integrations/convergence/{src,tests}
(no matches)  -> CLEAN
```

All `now`/`at`/`asOfMs` values are explicit inputs; the advisory loop's
`computedAt` is a caller-supplied string; no network, no timers, no new
runtime deps. `git status` at commit time shows exactly
`packages/integrations/convergence/` (new) + `docs/evidence/F231/` (new) +
`pnpm-lock.yaml` (dirty, deliberately uncommitted).

## 6. Seam-gap findings / contract deltas for TL adjudication

### 6.1 SEAM GAP (the headline finding): two Wave 1 packages have NO public entry point

`@fleetos/model-gateway` and `@fleetos/agent-organizations` (both Wave 1,
additively extended by F230C) have **no `exports` map, no `main`, no
`types`** in their package.json — the F230C report's "src/index.ts +4/+5
export lines" were SOURCE-level exports; the package.json entry maps were
never added (no consumer existed until this composition). With
`moduleResolution: nodenext`, `import … from "@fleetos/model-gateway"`
cannot resolve (TS2307) — node-style resolution finds no entry.

**How this was composed WITHOUT touching the lane packages** (the packet
forbids editing them, and the import law forbids deep-path imports):

- the SOURCE imports use the package-ROOT specifiers only;
- a **tsconfig `paths` bridge** (`packages/integrations/convergence/tsconfig.json`)
  maps the two specifiers to `./node_modules/@fleetos/<pkg>/src/index.ts` —
  the symlinked location of the packages' actual public entry sources
  (mirroring exactly what an `exports` map would do; the node_modules
  symlink keeps the files under this package's rootDir);
- a matching **vitest `resolve.alias` bridge**
  (`packages/integrations/convergence/vitest.config.ts`) for the test
  runtime.

Both bridges live INSIDE this TL-owned package; no lane file was touched and
the boundary grep stays CLEAN. **TL action at merge time:** add the additive
2-line `exports` maps to the two packages' package.json (the same change
every other composed package already has), then DELETE both bridges — no
source import changes are needed. This is the honest workaround, not a
hack around the seam: the public SURFACE (src/index.ts exports) was always
complete; only the entry-point DECLARATION was missing.

### 6.2 WorldModelAdapter vs ModelPort dual seam (F230B's flagged adjudication — remains UNRESOLVED, composed around)

The world-model package still carries BOTH adapter seams: the pre-existing
Wave 1 `WorldModelAdapter` (represent/predict/counterfactual over
`WorldModelRepresentation`, string-timestamped) and the F230B `ModelPort`
(project/runCounterfactual over `TwinStateInput`, integer-ms). Per the
packet's advisory-assembly spec — "world-context context assembly →
predictive `ModelPort` reference adapter" — this composition binds **ONLY
the `ModelPort` seam** (`makeReferenceModelPort()`), which is the seam the
F230B report designated for the Wave 5/F290B JEPA family. `WorldModelAdapter`
is NOT consumed here and remains additive-but-unused at this composition
site. The convergence decision (bless both, deprecate one, or bridge them)
remains TL adjudication; nothing in this package forecloses either outcome.

### 6.3 MissionRuntime binds its OWN drivers, not the kernel's

`MissionRuntime`'s constructor takes the CONCRETE mission-owned
`MissionStore` / `InMemoryMissionOutbox` types, not the kernel port
interfaces — so the mission stack cannot be bound to the kernel's own
`InMemoryKernelDriver`/`InMemoryOutbox` without a mission-package change.
The mission drivers DO `implements` the kernel `TransactionalSession` /
`OutboxPort` TYPEs (structurally swappable). This composition therefore
binds the kernel's driver + UnitOfWork **alongside** the mission stack (as
`stack.kernel`, used by `driveMission` for application-level writes) rather
than underneath it. If the TL wants the kernel drivers UNDER the mission
runtime, the mission package's constructor needs a port-typed seam (a
mission-lane change owned by the TL).

### 6.4 `budgetCeilingMinor` is an explicit request input

The gateway's routing ceiling and the org budget are two independent
policies in this composition (§2.2). Deriving the routing ceiling from the
org budget's remaining spend would make the org check unreachable on the
spend axis (mathematically identical filters); the explicit input keeps
both policies meaningful and the org refusals observable.

### 6.5 Composed digests are FNV-1a (`mstack_`)

The composition-level selection digest follows the lane convention
(FNV-1a 32-bit). The mission journal/ledger digests remain the
mission/control-plane sha256 convention. No attempt was made to unify hash
families — a cross-cutting TL decision if wanted.

## 7. Residual limitations (honest list)

1. **`pnpm-lock.yaml` is dirty and uncommitted** (workspace linking for the
   new package) — deliberate per the packet. The TL must run
   `corepack pnpm install` when verifying/merging.
2. **Reference/in-memory implementations only.** The composition wires the
   deterministic in-memory drivers of every composed package. Real Postgres
   drivers, network transports and schedulers are later deployment work;
   the kernel driver seam is the swap point.
3. **The restart test models a runtime-instance restart, not a process
   restart.** The queue's in-memory claim state survives because the
   composition shares it; a REAL process restart needs a persistent queue
   plus a claim-visibility/reclaim mechanism the control-plane queue does
   not expose yet (flagged for a future control-plane work item — the
   mission side is already durable).
4. **`driveMission`'s executor is scripted, not a real agent.** The drive
   helper is a test/demo determinism harness; production executors are
   application-owned (the composition deliberately does not ship an
   autonomous executor — agents are untrusted actors, law A6).
5. **The advisory loop assembles context over a DERIVED field projection**
   (lifecycle/observationCount/lastValue/tags) of world entities — the
   world-context snapshot shape is structural, and richer field mappings
   belong to future application wiring.
6. **Kernel UnitOfWork writes are composition-level run-log records only** —
   no kernel repository of business records is projected yet (§6.3 explains
   why the mission side cannot ride the kernel session).
7. **Model-stack state (budgets, usage ledger) is closure-held in-memory
   state** — a persistence-backed BudgetCheckPort/usage store is the
   production binding (the port TYPE is the seam; the F230C report's §7.1
   residual applies here too).
8. **Root-level gates not run** (lint over the whole repo, architecture
   check, snapshot check, full `pnpm -r test`) — packet instruction; the
   TL runs them at merge time. Lane-local `oxlint` was run as a self-check
   (0/0). The exported surface of THIS package is new (4 export paths) —
   `fleetos:snapshot:check` will report drift until the TL regenerates.
9. **The two seam-gap bridges (§6.1) must be deleted by the TL after the
   lane packages gain `exports` maps** — tracked above; they are inert once
   real exports exist.

## 8. Stop-the-line events

None. All gates green on the final run (51/51 tests, typecheck exit 0, lint
0/0). During development, 6 test-construction iterations were needed (wrong
parallel-group fixture; a ranking/units-axis test design that assumed
per-model units; the advisory brand needed a runtime symbol instead of an
ambient `declare const`; three union-narrowing typecheck errors in tests) —
all fixed in TEST/fixtures or in the composition's own source; no lane
package was touched; no processes killed; the port-3000 dev server was left
alone; no daemons started.

## 9. Verification commands for TL re-run

```bash
git fetch origin work/f231:work/f231
git checkout work/f231
corepack pnpm install --filter @fleetos/convergence --filter @fleetos/kernel --filter @fleetos/control-plane --filter @fleetos/mission --filter @fleetos/predictive --filter @fleetos/world-model --filter @fleetos/world-context --filter @fleetos/model-gateway --filter @fleetos/agent-organizations --prefer-offline --ignore-scripts
# (the extra filters link the composed packages' own workspace deps so tsc
#  can follow their public entries; node_modules only — lockfile untouched)
(cd packages/integrations/convergence && corepack pnpm run test)       # expect 51/51
(cd packages/integrations/convergence && corepack pnpm run typecheck)  # expect exit 0
(cd packages/integrations/convergence && corepack pnpm run lint)       # expect 0 warnings / 0 errors
# boundary self-check (expect CLEAN):
grep -rEn "import .* from ['\"]@fleetos/(kernel|control-plane|mission|predictive|world-model|world-context|model-gateway|agent-organizations)" packages/integrations/convergence/src | grep -vE "from ['\"]@fleetos/[a-z-]+(['\"]|$)" || echo CLEAN
# determinism self-check (expect no matches):
rg -n "Date\.now\(|Math\.random\(|setInterval|setTimeout\(|fetch\(" packages/integrations/convergence
# TL merge-time follow-ups:
#  1. add exports maps to packages/{model-gateway,agent-organizations}/package.json
#     (additive 2-line change each), then DELETE the tsconfig paths bridge +
#     the vitest alias bridge in packages/integrations/convergence (§6.1);
#  2. pnpm fleetos:snapshot (new export surface) + full root gates.
```
