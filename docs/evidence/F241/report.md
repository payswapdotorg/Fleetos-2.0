# F241 — TL Lane (FleetOS Control Tower + Universal Command/Search) Completion Evidence

- **Work item:** F241 (Wave 4 TL lane) — catalog `spec/work-items/WORK-ITEM-CATALOG.md`
- **Agent:** fleetos-worker-f241 (TL-dispatched worker, worklog Task ID `11-a`)
- **Branch:** `work/f241` at base `6464e24` (post-Wave-4-merge main: A/B/C merged, `packages/experiences/*` workspace glob + six Wave-1 exports maps committed)
- **Worktree:** `/home/z/w-f241`

## 1. Owned paths touched

- `packages/experiences/control-tower/**` — NEW package `@fleetos/control-tower` (private, Apache-2.0, type: module; exports map `.` + one subpath per deliverable: `./tower-assembly`, `./command-registry`, `./search`, `./mission-replay-view`)
  - `src/tower-core.ts` — tower-local FNV-1a digest (32-bit, ␟-join convention) + canonical JSON + lane vocabulary
  - `src/tower-refs.ts` — typed drill-down refs (lane, entityKind, id, provenance) + the deterministic cross-lane attention ladder
  - `src/tower-assembly.ts` — `assembleControlTower(state, options)` + `verifyControlTowerDigest`
  - `src/command-registry.ts` — `TOWER_COMMAND_REGISTRY` (10 entries) + `TowerCommandBus` over the REAL queue
  - `src/search.ts` — `searchTower` + `towerSearchCorpus` + `verifyTowerSearchDigest`
  - `src/mission-replay-view.ts` — `buildMissionReplayView` + `verifyMissionReplayDigest`
  - `src/index.ts`, `package.json`, `tsconfig.json`, `vitest.config.ts`
  - `tests/helpers.ts` + 4 test files (61 tests)
- `docs/evidence/F241/report.md` — this file
- `pnpm-lock.yaml` — MUTATED (uncommitted per packet: the filtered install links the six composed packages); **not committed**

## 2. Baselines re-verified BEFORE the first edit (machine-run, worktree)

| Package | Result |
| --- | --- |
| `@fleetos/experience-asset-field` | 4 files, **69/69 passed** |
| `@fleetos/experience-safety-intel` | 5 files, **104/104 passed** |
| `@fleetos/experience-work-commerce` | 4 files, **49/49 passed** |

Re-verified AFTER the last edit (no source outside the tower was touched): 69/69, 104/104, 49/49 — unchanged. Composed-plane sanity in the same worktree: mission 118/118, control-plane 119/119, kernel 76/76.

## 3. Deliverables (all pure deterministic TS; logical `now`/caller-supplied inputs everywhere)

1. **tower-assembly.ts** — `assembleControlTower(state, options)`: tenant-scoped cockpit composing the lanes' REAL read-model outputs — `assembleFleetOverview` (lane A), `buildFindingViews` + `buildAdvisoryBoard` (lane B), `buildWorkBoard` (lane C). Global rollups, typed drill-down refs per lane entity, deterministic attention queue (fixed severity ladder; tie-breaks priority asc → lane asc → id asc), one tower-level FNV-1a digest chaining every section digest (fleet, safety rollup + remediation, work, advisory) + rollups + attention ids; `verifyControlTowerDigest` recomputes. Fail-closed tenancy across the WHOLE tower: missing tenant / tower↔slice tenant mismatch / any lane refusal (lane code surfaced verbatim in `laneCode`) / cross-tenant advisory board refuse with NO partial tower.
2. **command-registry.ts** — the universal command surface: `TOWER_COMMAND_REGISTRY` with one entry per lane intent kind (3 lane-A + 3 lane-B + 4 lane-C), each carrying capability requirement (lane-fixed for A/C; `draft-declared` for B, mirroring the lane's caller-supplied `requiredCapabilityId`), a reason vocabulary, and the machine-carried `capability-ceiling-not-authorization` Guardian marker. `TowerCommandBus` binds the REAL `CommandQueue` through `queueAsSubmitPort` (F221 seam, F231 precedent) and validates tower-level contract (tenant match, registered kind, capability, reason vocabulary) before enqueueing; `queueOf()`/`submitPortOf()` expose the bus so missions and tower commands share ONE queue; `deadLetters(ctx)` gives tower-level dead-letter visibility; `commandStatus` is tenant fail-closed.
3. **search.ts** — universal search: deterministic ranked token lookup over the tower's drill-down refs (assets, findings, work items) producing typed refs with provenance. Fixed scoring ladder (title exact 3 > id exact 2 > title prefix 2 > id prefix 1 > kind 1), AND semantics across query tokens, stable tie-breaks (score desc → lane → entityKind → id), own FNV-1a result digest + verify. Fail-closed: missing tenant, empty query, and tampered-tower (`tower-digest-invalid` — search only runs over a VERIFIED tower) refusals; cross-tenant tokens yield ZERO results (the corpus is built exclusively from the tenant-scoped tower — no partial results possible).
4. **mission-replay-view.ts** — the "replay important missions" surface from `@fleetos/mission` public surfaces: journal entries chain-verified with the mission package's OWN `entryDigest` (tamper/gap/tenant/mission mismatch refuse fail-closed), snapshot presented via the mission package's OWN `foldMission` (replay view == folded state by construction), journal timeline (seq/event/stage/at/digest) + head digest, checkpoint visibility (per-stage counts + lastCheckpoint), resume point (first running stage in definition order — completed stages skipped) + machine-carried `resumePolicy: "completed-stages-never-re-execute"`, replay digest + verify.

## 4. Test themes (4 files, 61 tests — net-new, target ≥50)

- `tower-assembly.test.ts` (18): sections derived from the lanes' real outputs (digests/counts equal direct lane calls); rollups; typed refs; attention ladder order; advisory marker carried; advisory-cannot-feed-back structural proof (`@ts-expect-error` AdvisoryCardView→TowerFindingRecord); fail-closed: missing tenant, tower↔slice mismatch, invalid now, lane A/B/C real refusal codes surfaced (`cross-tenant-ref`, `views.cross-tenant-finding`, `TENANT_MISMATCH` detail), cross-tenant advisory board, empty-advisory presentation; byte-identical determinism; input order-independence (identical digest); tower digest verify + tamper; section digests chained (rollup vs remediation vs advisory).
- `command-registry.test.ts` (16): registry completeness (10 entries, 3/3/4); ceiling marker on EVERY entry; lane-fixed vs draft-declared capabilities; draft projections per lane shape; real-bus submit + queue record (kind/payload/actor/tenant); idempotent re-submission (duplicate ack, ONE queue record); lane B + C drafts; tenant-mismatch, unknown-kind, reason-not-in-vocabulary, empty-reason, capability-mismatch, queue-rejected (real `missing-idempotency-key` through the seam); dead-letter visibility after the 5-attempt policy exhausts; cross-tenant status fail-closed; **one shared bus for missions AND tower commands** (MissionRuntime over `bus.submitPortOf()`: 2 work orders + 1 tower command = 3 records; suspend→resume re-issuance deduped — the shared idempotency law).
- `search.test.ts` (15): tokenization; title/id/kind matching; AND semantics; ranking + tie-breaks; id-prefix below exact; matched tokens; missing-tenant; tampered-tower refusal; cross-tenant token → zero results; empty query; result digest verify + tamper; byte-identical determinism; identical results over reordered-input towers.
- `mission-replay-view.test.ts` (12): view == `foldMission` state (verbatim fields); timeline + head digest; checkpoint visibility; resume point for suspended; completed stages skipped by the resume point (REAL runtime driven inline: create→start→complete→suspend); empty journal; tampered digest / seq gap / tenant mismatch / missing tenant / mixed missions refusals; byte-identical determinism (entry order irrelevant); replay digest verify + tamper.

All fixtures bind REAL implementations: lane builders (`buildEnrollAssetIntent`, `requestRemediation`, `draftCreateWorkOrder`, `buildPredictionAdvisoryCard`), the REAL `MissionRuntime`/`MissionStore`/`InMemoryMissionOutbox`, the REAL `CommandQueue`/`queueAsSubmitPort`, kernel `makeTenantContext`. Domain record shapes are type-EXTRACTED from the composed packages' own builder signatures (`Parameters<typeof buildFindingViews>[0]["findings"][number]` etc.) — no deep-path imports.

## 5. Exact gate outputs (package dir, per packet)

```
corepack pnpm run test
  Test Files  4 passed (4)
  Tests       61 passed (61)

corepack pnpm run typecheck
  tsc -p tsconfig.json --noEmit     (no output, exit 0 — clean)

corepack pnpm run lint
  Found 0 warnings and 0 errors. Finished in 12ms on 12 files using 2 threads.

boundary self-check (packet command):
  CLEAN (only the six sanctioned @fleetos/* entry points appear in src)

purity grep (Date.now|Math.random|setTimeout|setInterval|fetch(|require():
  only a documentation comment; no code hits
```

File-size law: every source/test file ≤ 400 lines (max: `src/tower-assembly.ts` at 396).

## 6. Seam findings for TL adjudication

- **(S1) The three CommandDraft shapes remain structurally divergent.** Lane A: flat draft + `toSubmitInput()` projection exported. Lane B: submit fields at top level + `intent` metadata (capability is DRAFT-DECLARED per intent — the registry records `capabilitySource: "draft-declared"` for lane B entries). Lane C: nested `command` envelope + `recordType` marker, NO actor id anywhere. The tower binds all three through local shape guards (`draftTenantOf`/`draftReasonOf`/`draftCapabilityOf`/`draftSubmitCommandOf`), but the F240B-flagged CommandDraft↔SubmitCommandInput contract unification is still open — the tower is a working reference binding, not the adjudication.
- **(S2) Lane C drafts carry no actor id.** The submission `TenantContext` (actor/session) is bound by the tower at submit time, which is correct composition-layer behavior — but it means lane C drafts cannot round-trip an actor without the tower. Noted for the contract unification.
- **(S3) Reason vocabulary is a tower-level narrowing policy.** The lanes accept any non-empty reason; the tower registry closes each command's reason to a vocabulary (`reason-not-in-vocabulary` refusal). This is presentation-plane policy, deliberately narrow for determinism; TL may widen or remove it when adjudicating S1.
- **(S4) `buildAdvisoryBoard` validates card-to-card tenant consistency but NOT against an expected tenant** — the tower adds that check (advisory board tenant ≠ tower scope → fail-closed refusal). If the board ever becomes a trust boundary, the lane should own this check.
- **(S5) tsconfig/`outDir` quirk (environmental):** with `"outDir": "dist"` + the repo base's `composite/declaration` options, tsc 6.0.2 reports a phantom `TS7006` in `@fleetos/actions`' `compensation.ts` when compiling THIS package's program (the file's callback param loses contextual typing). Removing the (noEmit-meaningless) `outDir` from the tower's tsconfig resolves it; sibling packages keep `outDir` because their programs don't include that file. No source outside the tower was touched; flagged for TL awareness at root-gate time.
- **(S6) `pnpm-lock.yaml` mutation uncommitted** (per packet): the filtered install links the six composed packages into `packages/experiences/control-tower/node_modules`. A clean-checkout root install will regenerate this.

## 7. Honest residuals

- Per-call assemblies (no caching/persistence); the store→tower-state mapping (loading domain slices) remains application composition below this package.
- The tower presents lane views it is handed; verify functions recompute digests from presented fields, not full re-derivation (established lane convention).
- FNV-1a digests (lane convention), not sha256 — consistent with all three Wave-4 lanes.
- Attention ladder is tower-local policy (six rungs); the packet's "deterministic priority ordering" law is satisfied, but the exact ladder values are a TL-tunable choice.
- Search indexes the three primary entity kinds (assets, findings, work items) — advisory cards, spine cards, vendor/org views are searchable surfaces left for follow-up.
- Mission replay view consumes journals handed to it (or read via `MissionJournal.committedEntries` in tests); no tower-side mission LIST discovery (which missions are "important" is a selection policy above this package).
- Root gates (`pnpm -r test`, architecture snapshot, contract-snapshot regen) NOT run — TL merge-time per packet; package unregistered in `architecture-policy.yaml` so the snapshot is unaffected.
- `TowerCommandBus` creates a `CommandQueue` by default; a real deployment injects the shared queue (as the tests do).

## 8. TL re-run commands

```bash
cd /home/z/w-f241/packages/experiences/control-tower
corepack pnpm install --filter @fleetos/control-tower... --prefer-offline --ignore-scripts
corepack pnpm run test        # 61/61
corepack pnpm run typecheck   # clean
corepack pnpm run lint        # 0 warnings, 0 errors
grep -rEn "from ['\"]@fleetos/" src | grep -vE "@fleetos/(experience-asset-field|experience-safety-intel|experience-work-commerce|control-plane|mission|kernel)['\"]" || echo CLEAN
```
