# F343 — the ka6 fix + micro re-convergence

- **Work item:** F343 (`spec/work-items/WORK-ITEM-CATALOG.md`, Wave 14; packet
  `docs/tech-lead/packets/f343.md` — the binding contract; the TL-root-caused
  2-line fix).
- **Worker:** D (the fix runner). **Date:** 2026-10-13.
- **Base:** `e9c7b40` (main HEAD at clone — the post-F342 merge main carrying
  the F343 packet `863800b` + the Wave-15 freeze docs; newer than the packet's
  expected `0f70ffb`, exactly the "or newer" case).
- **Branch:** `work/f343` (pushed to origin; the final tip SHA is in the FINAL
  REPORT message — the repository is the source of truth).
- **Canonical context read in order:** `docs/evidence/F342/report.md` §5 (the
  ka6 defect record — the binding law), the f343 packet, the F342 §3 re-pin
  table (the tripwire inventory this delivery resolves).

## 1. The fix (the TL-root-caused 2 lines, exactly as the packet specifies)

The packet's 2-line form HELD at implementation time — no divergence:

```diff
--- packages/acceptance/field/src/ops/f341a-kernel.ts
+        "kern.ctxTenant": ctx.tenantId,
```
(added in the `kern.admit` opOk readings, adjacent to `"kern.auditTenant"`)

```diff
--- packages/acceptance/field/src/journeys/f341a-kernel.ts
-    { id: "ka6", description: "the audit ref carries the admitting tenant", reading: "k4.kern.auditTenant", op: "deep-equals", expected: TENANT },
+    { id: "ka6", description: "the audit ref carries the admitting tenant", reading: "k4.kern.auditTenant", op: "reading-equals", expected: "k4.kern.ctxTenant" },
```
(the description unchanged; the reading stays `k4.kern.auditTenant`)

**One mechanical third line, recorded honestly (not a divergence):** the same
journeys file's import line drops the now-unused `TENANT` identifier
(`import { AST_TRUCK, DEV_TELEMETRY, FOREIGN_TENANT, T0 } from "../fixtures.js"`)
— `TENANT` had exactly one use in this file (ka6's old `expected`), so the
packet's own acceptance law "typecheck + lint clean on touched packages"
(`no-unused-vars`) requires the drop. No semantic change; the full diff is
`+1/−1` in ops + `+2/−2` in journeys across 3 changed lines total.

**Regime honesty, machine-reasoned and machine-measured:** the kernel's audit
ref tenant comes from the admission input's `tenantId`, which the op builds
from `ctx.tenantId` — so `k4.kern.auditTenant` and the new `k4.kern.ctxTenant`
reading are both the RUN-CONTEXT tenant. In the field fixture regime both
sides are `tnt_field-accept-01` (green preserved); in the adoption-composition
regime both sides are the firm's REAL `tnt_<industry>-<size>` (the 30 failures
resolve). The assertion still proves the real law — the audit ref carries the
admitting tenant — in every regime, which the fixture-tenant pin could not.

## 2. The before/after transition (machine-measured at this tree, never assumed)

Probe pattern: the F332 out-of-repo probe — an UNTRACKED measurement script
inside the adoption package, run with tsx, deleted before commit. Both states
measured on THIS branch tree (before = base `e9c7b40` worktree pre-fix;
after = the fixed worktree; the probe's own byte-identical rerun proves
determinism).

| measure | before (base `e9c7b40`) | **after (the fix)** |
|---|---:|---:|
| failing execution facts (30 firms) | **30** (one per firm, all `observations-kernel-immutability-audit`, note `assertion ka6 failed: expected "tnt_field-accept-01", actual "tnt_<industry>-<size>"`) | **0** (every `failureNote` null) |
| `allJourneysPassed` | false | **true** |
| manufacturing verdict | MAIN-INTERFACE, 99/100, ratio 0.99, `failingJourneys=[ka6 journey]` | **SWITCH-ONLY, 100/100, ratio 1.0, `failingJourneys=[]`** |
| verdict distribution | 0 SWITCH-ONLY / 6 MAIN / 4 COMPL / 0 RETAIN | **1 / 5 / 4 / 0** (the F332-era distribution restored) |
| journeyExecutions / fieldExecutions | 3027 / 1179 | **3027 / 1179 — UNCHANGED** |
| commerceExecutions / securityExecutions | 1017 / 831 | **1017 / 831 — UNCHANGED** |
| uniqueApplicableJourneys | 931 | **931 — UNCHANGED** |
| fieldEpochReRuns / commerceEpochReRuns (raw) | 406 / 897 | **406 / 897 — UNCHANGED** |
| honest counts (at/above 100 / max / shortfall) | 17 / 116 / 97 | **17 / 116 / 97 — UNCHANGED** |
| determinismVerified | true | **true** (byte-identical probe rerun) |
| field suite (fixture regime) | 102/102 green | **102/102 green — preserved** |

**The count law held:** the fix flips pass/fail states, never counts —
3027/1179/1017/831/931 byte-identical across the transition, as do the raw
re-run transparency metrics and the whole honest-counts ledger.

## 3. The digest transition record (grow-only except the fix target)

The intended transitions — machine-measured by the probe's per-journey digest
maps (field regime: all 35 journeys; adoption regime: the representative firm
`firm-manufacturing-small`'s all 100 counted facts; plus the D17 per-firm set):

| digest | before | **after** | scope |
|---|---:|---:|---|
| D17 field-regime outcome | `544c03ea` | **`4defcfa2`** | the new `kern.ctxTenant` reading enters the outcome |
| D17 adoption, mfg small/medium/large | `4b410b75` / `cbdce287` / `a9898639` | **`d5efac15` / `273840ff` / `e6e0ae61`** | the same transition, tenant-scoped per firm (30/30 firms) |
| adoption report digest | `b4094bbb` | **`ff96d224`** | allJourneysPassed + verdicts + failingJourneys resolve |
| every OTHER field journey (34) | — | **byte-identical** | the grow-only law holds |
| every OTHER adoption fact of the representative firm (99 of 100) | — | **byte-identical** | only `field:observations-kernel-immutability-audit:0` moved |

No test pins a literal digest value anywhere in the touched suites (the
digests are verified structurally: shape, verification, determinism,
tamper-detection) — so the digest transitions carry ZERO pin churn; the
transition record above is the measured evidence.

## 4. The re-pin table (file → old → new; every value machine-measured)

Exactly the F342 tripwire set flips back (plus the verdict-posture prose);
nothing else moved:

| file | pin | old (F342) | **new (F343, measured)** |
|---|---|---:|---:|
| `adoption/tests/simulation.test.ts` | all-passed | `false` + exact 30-failing-fact loop | **`true` + zero-failing loop (all notes null)** |
| 〃 | verdict table | MAIN 6 / COMPL 4; coverage (n−1)/n; mfg failing `[ka6]` | **SWITCH 1 / MAIN 5 / COMPL 4; coverage n/n; mfg failing `[]`** |
| 〃 | RETAIN/ka6 visibility | every industry carries exactly 1 ka6 failure | **zero failing journeys anywhere (RETAIN still negative-fixture-proven)** |
| `adoption/tests/f332.test.ts` | ACTIVE all-passed | `false` | **`true`** |
| `adoption/tests/adoption-run.test.ts` | healthcare single-firm | exactly 1 failing fact, note pinned verbatim | **0 failing facts, all notes null** |
| 〃 | construction+mining subset | `allJourneysPassed false` | **`true`** (counts 633/195 unchanged) |
| 〃 | water-waste sizes | exactly 1 ka6 failing fact per firm | **0 failing facts per firm** |
| `adoption/tests/report.test.ts` | manufacturing verdict | MAIN-INTERFACE, 99/100, 0.99, `[ka6]` | **SWITCH-ONLY, 100/100, 1.0, `[]`** |
| 〃 | aggregate all-passed | `false` | **`true`** |
| `release/tests/release-gate.test.ts` | REAL-stack verdict | NOT-READY, `[ACCEPTANCE_FAILED / acceptance.adoption / allJourneysPassed=false … 3027]` | **READY, blockers `[]`** |
| 〃 | adoption baseline pin | `allJourneysPassed false` | **`true`** (corpora 35/29/36 + 30 workspaces unchanged) |
| 〃 | custom-requiredLanes posture | NOT-READY from ONLY the adoption blocker | **READY, blockers `[]`** (no phantom LANE_MISSING — mechanics law intact) |
| 〃 | warning-cost posture | NOT-READY from ONLY the adoption blocker | **READY, blockers `[]`** (zero CEILING_BREACHED — cost law intact) |
| 〃 | adoption tamper fixture | forged `allJourneysPassed=true` | **forged `allJourneysPassed=false`** (the honest direction at a green REAL baseline) |
| 〃 | multi-degradation codes | 6 codes (+ACCEPTANCE_FAILED) | **5 codes** (the deliberate degradations only) |
| 〃 | verdict tamper fixture | forged `"READY"` | **forged `"NOT-READY"`** (the honest direction at a READY base) |
| `release/tests/integration.test.ts` | REAL-stack verdict | NOT-READY, the named adoption blocker | **READY, blockers `[]`** |
| 〃 | adoption baseline | `false`; 3027 | **`true`; 3027 unchanged** |
| 〃 | warning posture | NOT-READY, ONLY the adoption blocker | **READY, blockers `[]`** |

`adoption/src/convergence-delta.ts`, `industries.test.ts`,
`verdicts.test.ts`, `convergence.test.ts`: **UNTOUCHED** — every pin there is
count-based (35/36/29, cap 100, shortfall 0, denominators 100/82/97…) and the
counts did not move. The digest-consistent FAILING adoption fixture
(`failingAdoptionReport`, resealed) keeps its purpose unchanged at a green
baseline: a valid failing report still blocks with ACCEPTANCE_FAILED.

## 5. The measured release-gate verdict

Machine-measured at the fixed tree, both entry points:
`release-gate.test.ts`'s REAL baseline path and `integration.test.ts`'s
full-REAL-stack run — the gate's verdict is **READY with zero blockers**
(`blockers.length === 0` is the gate's only READY path; `verifyReleaseGateVerdict`
true both times). The F342 §5 blocker
`ACCEPTANCE_FAILED / acceptance.adoption / allJourneysPassed=false
determinismVerified=true journeyExecutions=3027` is **RESOLVED by the fix** —
the tripwire pins flipped red at this tree (9 adoption tests + 10 release
tests, exactly the ka6 pin set, zero collateral) and were re-pinned from
measured runs, never by assumption.

## 6. The full battery (machine-run, all green)

| gate | command | result |
|---|---|---|
| field | `pnpm --filter @fleetos/acceptance-field test` | **102/102 (7 files)** — the fixture regime unchanged |
| security | `pnpm --filter @fleetos/acceptance-security test` | **179/179 (8 files)** |
| commerce | `pnpm --filter @fleetos/acceptance-commerce test` | **115/115 (6 files)** |
| convergence | `pnpm --filter @fleetos/acceptance-convergence test` | **82/82 (4 files)** |
| maintenance | `pnpm --filter @fleetos/maintenance test` | **99/99 (5 files)** |
| adoption (new pins) | `pnpm --filter @fleetos/acceptance-adoption test` | **120/120 (9 files)** |
| release (new pins) | `pnpm --filter @fleetos/acceptance-release test` | **88/88 (4 files)** |
| typecheck | `tsc --noEmit` (field + adoption + release) | exit 0, all three |
| lint | `oxlint` / `oxlint src tests` | **0 warnings / 0 errors** (field 55 files, adoption 19, release 10) |
| determinism | probe byte-identical rerun + suite determinism laws | **byte-identical** |
| file law | no new source/test file created; the new evidence report ≤400 lines | passes |

## 7. Honest limitations

- **L-1 (the delegated fix):** the 2-line fix is the TL's root cause, delivered
  verbatim under the packet; the TL gates every line at merge and owns the
  release verdict. The third mechanical line (the unused-import drop) is
  recorded in §1 for that gate.
- **L-2 (the verdict inputs, not a verdict):** the measured gate output at
  this tree is READY-with-zero-blockers. The TL's standing qualifications are
  untouched by this delivery: masked industries remain structural
  (agriculture/healthcare-facilities/facilities-management/
  telecommunications/mining/water-waste/construction/
  transportation-logistics shortfalls unchanged), production deployment +
  durable persistence remain undemonstrated (the F350 §Q freeze), and model
  providers remain CONTRACT_ONLY. The final release disposition is the TL's
  alone (F352).
- **L-3 (pins are tree-scoped):** every re-pinned expectation is exact for
  THIS tree (`e9c7b40` + this delivery); any corpus change re-triggers the
  documented pin-transition class, re-pinned only from machine-measured runs.
- **L-4 (sandbox scope):** all gates ran in this sandbox (the §6 battery);
  the 16 GB builder full clean-checkout gates (root typecheck/build, the
  monorepo test plane) and browser verification remain TL-owned (the F322 §5
  doctrine). A filtered `pnpm install` (the full dependency closure of all
  seven suites + root) was used — every pinned suite ran.
- **L-5 (the digest record):** no suite pins literal digest values; the §3
  transition table is the measured record for the TL's adjudication, quoted
  from the probe snapshots (before/after JSON retained only in this session's
  scratch space, never committed).

## 8. Boundary

`git diff --name-only main...HEAD` lists ONLY (5 code paths + 2 doc paths):

- `packages/acceptance/field/src/ops/f341a-kernel.ts` (the fix line 1)
- `packages/acceptance/field/src/journeys/f341a-kernel.ts` (the fix line 2 +
  the mechanical import drop)
- `packages/acceptance/adoption/tests/{adoption-run,f332,report,simulation}.test.ts`
- `packages/acceptance/release/tests/{release-gate,integration}.test.ts`
- `docs/evidence/F343/report.md` (this file)
- the one-line catalog append to `spec/work-items/WORK-ITEM-CATALOG.md`

No domain package, no release/adoption SOURCE file, no shared contract, no
security/commerce corpus, no convergence-delta (counts unchanged — nothing to
re-pin there). The measurement probe ran in-tree UNTRACKED and was deleted
before commit (the F332 out-of-repo probe pattern).
