# F240C — Worker C (Work + Commerce) Wave 4 Experience Lane Evidence

- **Work item:** F240C — Work/Projects/Commerce experiences (Wave 4 lane C)
- **Owner:** Worker C (Work + Commerce)
- **Base commit:** `9a5207c` (dispatch tip — Wave 4 packets + experience-plane ownership grants)
- **Branch:** `work/f240c`
- **Date:** 2026-10-07

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-c, the new
`packages/experiences/work-commerce/**` grant):

- `packages/experiences/work-commerce/**` — NEW package
  `@fleetos/experience-work-commerce` (private, Apache-2.0, type: module;
  conventions copied from `packages/mission`): `package.json` (exports map:
  `.` + `./work-views` + `./commerce-views` + `./org-views` +
  `./command-intents`; `workspace:*` deps on the eight own-lane domain
  packages), `tsconfig.json`, `vitest.config.ts` (the §6.2 bridge), `src/`
  (6 modules), `tests/` (4 files, 49 tests).
- `docs/evidence/F240C/**` (this file).

NOTHING else. `git status` at commit time shows exactly the package path
plus this evidence file; `pnpm-lock.yaml` is dirty from the packet's
filtered-install instruction and is left UNCOMMITTED per the packet.
`pnpm-workspace.yaml` was touched only as an UNCOMMITTED, machine-reverted
local bridge (§6.1) — the committed diff does not contain it. No spec
edits, no snapshot regen, `main` untouched.

## 2. What the experience plane became

Pure, deterministic, tenant-scoped PRESENTATION read-models over the eight
own-lane domain surfaces (the plane sits ABOVE the domain kernel,
projected read-only — nothing here writes domain truth or mutates inputs),
plus typed command INTENT drafts that never execute. Style exemplar:
`packages/world-context/src/assembly.ts` (fail-closed tenant, declarative
redaction, provenance, audit digests).

### 2.1 `src/work-views.ts` — work/project boards

- `buildWorkBoard`: cards grouped into the domain's five canonical status
  columns (`WORK_ITEM_STATUSES` order), lexical card order within columns,
  input-order independence (byte-identical boards + digests), provenance
  refs on every card, mission/deadline/blocked-reason surfaced, and
  declarative assignee redaction: the `[REDACTED]` sentinel replaces the
  value, `redactedFields` records WHAT was hidden — the original value is
  proven absent from the serialized board (test-asserted).
- `buildProjectStageGateView`: per-stage gate state (open mandatory
  checkpoint ids, completed/total counts), the frontier stage, and exactly
  WHAT UNLOCKS THE NEXT STAGE (`requires: "start-stage"` for a planned
  frontier; `"close-mandatory-checkpoints"` + the open ids for an
  in-progress one; null when all closed). Milestone gates are computed by
  the DOMAIN's own `checkMilestoneGate` — blocking items reported
  honestly, never coerced to achieved.
- `buildWorkloadRollup`: per-owner integer-bps utilization (floored),
  exact remainders, honest over-allocation (remaining goes NEGATIVE,
  never clamped), totals, 0-bps at zero capacity.

### 2.2 `src/commerce-views.ts` — the procurement spine + rollups

- `buildSpineBoard`: Need→Demand→Quote→Order→Fulfillment status board
  with lineage parent-links up the spine, per-status counts, superseded
  quote visibility, provenance per card (law A16 — the five contract
  identities are never conflated). Integer minor-unit money enforced at
  the view boundary: non-integer/negative quote costs refuse the whole
  board (`MONEY_MUST_BE_INTEGER_MINOR`).
- `buildQuoteScoreView`: the DOMAIN's `compareQuotes` surfaced verbatim —
  full integer-bps score decomposition, tie-break rules recorded on the
  lower-ranked tied entry, weights echoed, domain refusal codes propagated
  verbatim (never swallowed).
- `buildVendorKpiRollup`: per-vendor lifecycle status, quote outcome
  counts, `acceptanceBps = floor(accepted*10000/(accepted+rejected))` (0
  with no decided outcomes), reinstatement counts, exposure ledgers in
  integer minor units with utilization bps + exact remainders; vendors
  without a ledger report `exposure: null` (never zero-filled).
- `buildSeatView`: seats allocated vs revoked, over-allocation honest,
  utilization bps floored, expiry via the DOMAIN's
  `computeSubscriptionCompliance`.
- `buildBudgetLedgerRollup`: spend rollups in integer minor units with
  exact remainders and bps, domain phase classification, and every row
  stamped `ceiling-satisfied-not-authorization` — budgets are CEILINGS,
  never authorizations. Invalid budget records refuse the rollup with the
  DOMAIN's reason code embedded in the detail.

### 2.3 `src/org-views.ts` — agent-organization views

- `buildRoleAssignmentBoard`: assigned/active/relieved columns, relief
  reasons, the domain record digests carried as provenance.
- `buildCapabilityBudgetBoard`: unit + spend utilization in integer bps
  (unit axis via the DOMAIN's `budgetUtilizationBps`), domain phases,
  generations, ceilings-not-authorizations note on every row.
- `buildModelUsageRollup`: per-agent + per-model rollups with integer
  totals, and CHAIN INTEGRITY surfaced via the DOMAIN's
  `verifyUsageLedgerChain` — tampering shows (earliest broken seq named),
  never hides.
- `summarizeSelectionReasonCodes`: every model-selection decision counted
  with its reason code (selections by ordering rule, refusals by reason
  code); `accountedFor === decisions` is the nothing-silent invariant.

### 2.4 `src/command-intents.ts` — typed intent builders (the seam)

Four builders (`draftCreateWorkOrder`, `draftApproveQuote`,
`draftPlaceOrder`, `draftAllocateBudget`) produce `CommandDraft` records:
inert data (recursively function-free — test-asserted), each carrying
`requiredCapability` + `reason`, a canonical-serialization FNV-1a
`draftDigest` (key-order independent), and a `command` field that is a
LOCAL structural mirror of the control-plane submit contract. There is NO
submit/execute function in this module — drafts never execute and never
bypass Guardian (§6.3). `validateCommandDraft` re-checks the full
contract incl. digest and is reusable by the composition site.

## 3. Tests

4 files / **49 net-new tests** (target ≥ 45):

- `tests/work-views.test.ts` — 13
- `tests/commerce-views.test.ts` — 11
- `tests/org-views.test.ts` — 11
- `tests/command-intents.test.ts` — 14

Themes: every refusal code with exact cases (tenant missing/empty/chars/
mismatch naming the offender; money-integer; payload codes; the four
mirrored submit-contract codes); tenant fail-closed everywhere (no
partial state); determinism (byte-identical boards/drafts/summaries for
identical inputs incl. input-order independence and payload key-order
independence); redaction proof (value absent from serialized output);
ordering invariants (columns, lexical cards, sorted rollup rows, sorted
reason codes); bps exactness at the view boundary (3333/6666/7500/2500
floored cases; negative remaining under over-allocation); lineage up the
spine; supersession visibility; chain tamper detection; nothing-silent
summaries; digest recomputation + tamper detection.

## 4. Gate outputs (exact, in the package dir)

- `corepack pnpm run test` → `Test Files  4 passed (4)` / `Tests  49
  passed (49)` — PASS.
- `corepack pnpm run typecheck` → exit 0, no diagnostics — PASS.
- `corepack pnpm run lint` → `Found 0 warnings and 0 errors. Finished in
  12ms on 10 files using 2 threads.` — PASS (max-lines ≤ 400 everywhere;
  largest counted file: commerce-views.ts).

Baseline re-verified BEFORE first edit and re-run after (unchanged, all
green): work 71/71, projects 63/63, workloads 69/69, procurement 94/94,
vendors 56/56, software 62/62, agent-organizations 107/107, model-gateway
81/81 — 603 domain tests.

## 5. Boundary verification (machine-tested)

- Packet's exact grep → `CLEAN` (own-lane package roots only, public
  entry points only, no deep paths).
- Determinism sweep over src → `CLEAN` (no `Date.now`, `Math.random`,
  timers, `fetch`, `new Date`); logical `now`/`computedAt`/`issuedAt` are
  caller-supplied throughout.
- `git status`: only `packages/experiences/` (untracked, new) + this
  evidence file; `pnpm-lock.yaml` dirty and left uncommitted per packet;
  `pnpm-workspace.yaml` byte-identical to HEAD (local bridge reverted);
  `main` untouched; push target `origin work/f240c` only.

## 6. Contract deltas / seams for TL adjudication

### 6.1 `pnpm-workspace.yaml` has no `packages/experiences/*` glob (HEADLINE)

The packet's instructed
`corepack pnpm install --filter @fleetos/experience-work-commerce` fails
with "No projects matched the filters" against HEAD — the workspace globs
cover `packages/*` and `packages/integrations/*` only, so the whole
`packages/experiences/**` plane (F240A/B/C) is invisible to pnpm. Bridge
used locally (never committed): temporarily add `- packages/experiences/*`
to the workspace packages list, run the packet's filtered install
(it links `node_modules/@fleetos/*` and writes the importer into the
dirty-uncommitted lockfile), then `git checkout -- pnpm-workspace.yaml`.
Gates run against the on-disk links afterwards. **TL merge step: add the
glob (one line, TL-owned file), re-run the filtered install, and commit
the lockfile.**

### 6.2 Six Wave-1 lane-C packages have no package.json entry points

`@fleetos/work`, `projects`, `workloads`, `procurement`, `vendors`,
`software` have no `exports`/`main`/`types`, so package-root imports do
not resolve under nodenext (the F231 finding, which the TL fixed for
model-gateway + agent-organizations only). Bridge INSIDE the owned
package (F231 precedent, committed): `tsconfig.json` `paths` entries
through `./node_modules/@fleetos/<pkg>/src/index.ts` + a
`vitest.config.ts` alias map to the same real public entry sources.
**TL merge step: add the two-line additive exports maps to the six
packages and delete both bridges** (the tsconfig `paths` block and
`vitest.config.ts`).

### 6.3 CommandDraft ↔ control-plane submit contract

`CommandSubmitContract` is a LOCAL structural mirror of
`packages/control-plane/src/queue.ts`'s `SubmitCommandInput`
(kind/payload/idempotencyKey/issuedAt/notBefore?) — field-for-field and
validation-order identical (non-empty kind; non-empty idempotencyKey;
finite positive issuedAt; finite positive notBefore when present). The
four lowercase refusal literals (`missing-kind`, `missing-idempotency-key`,
`invalid-issued-at`, `invalid-not-before`) are byte-identical to the
control-plane `CommandSubmitRejection` union, so `draft.command` submits
without translation at the composition site. DECISIONS FOR TL: (a) unify
this mirror with the canonical contract (a shared contract module or a
type-only import once experiences may depend on control-plane types);
(b) whether drafts should also carry the kernel `TenantContext` actor
fields (actorId/sessionId) the queue's submit takes as `ctx` — currently
the draft carries tenantId only, and the composition site must supply the
actor context; (c) the canonical payload schemas per command kind
(currently defined by the builders + tests, not a shared registry).

### 6.4 Read-only plane assertion

The experience package consumes the eight domain packages through their
public entries (type + function imports only: `WORK_ITEM_STATUSES`,
`checkMilestoneGate`, `compareQuotes`, `DEFAULT_SCORING_WEIGHTS`,
`computeSubscriptionCompliance`, `classifyBudget`,
`validateBudgetRecord`, `budgetUtilizationBps`,
`verifyUsageLedgerChain`, `appendUsage`-built fixtures) and exports zero
write paths into any domain.

## 7. Residual limitations (honest list)

1. **Un-runnable from a clean checkout until the §6.1/§6.2 TL steps** —
   the pushed branch needs the workspace glob + (optionally) the six
   exports maps before `pnpm install --filter` + un-bridged resolution
   work; the committed bridges keep the package green in THIS worktree.
2. Views are computed per call over caller-supplied record arrays — no
   caching, no pagination, no persistence (presentation plane only).
3. `buildVendorKpiRollup`'s `acceptanceBps` denominator is
   accepted+rejected (decided outcomes); superseded/withdrawn quotes are
   counted separately and excluded from the rate — a documented
   deterministic choice, not a domain mandate.
4. `SpineCard` is intentionally minimal (stage/id/parent/status/
   provenance); richer per-document detail (authorization refs,
   verification evidence) is not projected yet.
5. `commerce-views.ts` is the largest module (~395 oxlint-counted lines,
   5-line headroom) — next addition should split it (the f230b-lint
   barrel pattern).
6. Digests are FNV-1a 32-bit (the lane convention, evidence-grade — not
   crypto).
7. Root gates (full `pnpm -r test`, snapshot:check, architecture:check)
   NOT run — per packet, TL merge-time. The contract snapshot will drift
   by exactly this new package once registered in architecture-policy
   (TL registration, as with mission/control-plane before).
8. No runtime proof that a `CommandDraft` can never reach a queue — the
   guarantee is structural (no submit function exported; inert data
   verified function-free) plus the Guardian law vocabulary.

## 8. Stop-the-line events

- The packet's filtered-install command failed against HEAD (§6.1) —
  handled by the documented local bridge, never committed.
- One vitest transform warning banner on first run (esbuild notice for
  `internal-view.ts` header comment) — transient, zero test impact, all
  runs since are clean.

## 9. Verification commands for TL re-run

```bash
cd /home/z/w-f240c
# 1. add `- packages/experiences/*` to pnpm-workspace.yaml packages (TL-owned)
corepack pnpm install --filter @fleetos/experience-work-commerce --prefer-offline --ignore-scripts
cd packages/experiences/work-commerce
corepack pnpm run test        # 4 files / 49 tests
corepack pnpm run typecheck   # exit 0
corepack pnpm run lint        # 0 warnings, 0 errors
grep -rEn "from ['\"]@fleetos/" src | grep -vE "@fleetos/(work|projects|workloads|procurement|vendors|software|agent-organizations|model-gateway)['\"]" || echo CLEAN
# baseline spot-check (unmodified domain suites):
cd /home/z/w-f240c/packages/work && corepack pnpm run test   # 71/71
```
