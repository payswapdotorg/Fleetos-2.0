# F240A — Worker A (Edge + Asset) Wave 4 Experience Lane Completion Evidence

- **Work item:** F240A — Asset/field/mobile experiences (Wave 4 lane A)
- **Owner:** Worker A (edge-and-asset)
- **Base commit:** `9a5207c` (TL dispatch: Wave 4 packets + experience-plane ownership grants; main carries all Wave 0–3 work)
- **Branch:** `work/f240a` (worktree `/home/z/w-f240a`)
- **Date:** 2026-10-07

## 1. Owned paths touched

Per `spec/worker-ownership.yaml` (worker-a, new grant):

- `packages/experiences/asset-field/**` — NEW package `@fleetos/experience-asset-field` (private, Apache-2.0, type: module; conventions copied from `packages/mission` / `packages/integrations/convergence`; `exports` map: `.` + `./asset-views` + `./field-mode` + `./ops-views` + `./command-intents`; `workspace:*` deps ONLY on the 8 own-lane packages)
- `docs/evidence/F240A/**` (granted carve-out)

`pnpm-lock.yaml` + `pnpm-workspace.yaml` are dirty in the worktree but NOT committed
(packet instruction for the lockfile; see §6 seam S1 for the workspace file).
`main` untouched; no spec edits; no snapshot regen.

## 2. Baselines re-verified BEFORE the first edit (machine-run, worktree)

| consumed package | tests (all passing) |
| --- | --- |
| @fleetos/assets | 99 |
| @fleetos/observations | 134 |
| @fleetos/health | 89 |
| @fleetos/recovery | 60 |
| @fleetos/maintenance | 69 |
| @fleetos/connectivity | 79 |
| @fleetos/identity | 89 |
| @fleetos/tenancy | 67 |
| **total** | **686** |

## 3. Deliverables (all pure deterministic TS; logical `now` + caller-supplied inputs everywhere)

Package layout (16 src files, every file ≤ 342 physical lines — well under the 400 max-lines law):

- **`src/state.ts` + `src/indexes.ts`** — `ExperienceStateSlice` (tenant-scoped domain state from the 8 public entries: assets/devices/twins/observations/findings/recovery cases/plans/orders/connectivity records) + `guardExperienceState`: TENANT FAIL-CLOSED over the whole slice — invalid-now, missing/malformed tenant, cross-tenant-ref (names the offender record), unknown-asset/device/plan-ref (names offender), duplicate-ref; findings carry no tenant of their own, so their tenant association is PROVEN via the device directory (unprovable → `unknown-device-ref`, never assumed). `buildStateIndexes` builds deterministically-ordered read-model indexes (latest-observedAt wins for connectivity records).
- **`src/staleness.ts`** — the repo's fresh/stale/unknown vocabulary reused with integer-ms thresholds (`freshWithinMs`/`staleWithinMs`, defaults 60s/5min); never-observed → unknown; beyond the staleness window → unknown (honest degradation); `invalid-thresholds` refusal.
- **`src/redaction.ts`** — declarative per-purpose redact-lists (`DEFAULT_VIEW_REDACTION_RULES` reference policy), `[REDACTED]` sentinel, redacted field NAMES visible, scalar-only attribute surfacing (nested structures never leak).
- **`src/digest.ts`** — FNV-1a (lane convention) + canonical key-sorted `stableStringify` + `viewDigestOf`.
- **`./asset-views`** (`asset-views.ts` barrel over `asset-overview.ts` + `asset-detail.ts`, f230b-lint split precedent) — fleet overview: one card per asset (identity, health posture + severity rollups from findings, honest connectivity postures via the domain's `honestPosture`, recency counts, bounded redacted attribute excerpt), fleet counters, assetId order; asset detail sheets: identity refs (device serials), observation recency + twin provenance (revision count, lastSeq, headDigest), posture + finding summaries, redacted attributes; `unknown-asset` fail-closed refusal.
- **`./field-mode`** — `assembleFieldView(state, options)`: phone-shaped field operator view, priority-ordered size-bounded sections (top alerts — severity, then newest, then deviceId/code; recovery in progress — longest-open first; next maintenance — soonest `nextRun` first, order entries before bare plans; connectivity status — every device, honest postures). **OFFLINE TOLERANCE LAW is structural:** every observed-data entry carries explicit `lastKnown` provenance (at + staleness + ageMs); any section with non-fresh data is declared in `lastKnownSections`; no serialized entry claims `"staleness":"fresh"` for stale data; maintenance entries are declared intents and make NO freshness claim.
- **`./ops-views`** (barrel over `ops/health-board.ts`, `ops/recovery-timeline.ts`, `ops/maintenance-board.ts`) — health posture board (worst-posture-first rows, fleet counters, devicesWithNoFindings); open-recovery timeline (open/investigating/proposal cases only, step-ordered history, age accounting); maintenance schedule board (state columns + upcoming plan runs through the domain's own `nextRun`).
- **`./command-intents`** — typed intent builders (`asset.enroll`, `recovery.request`, `maintenance.schedule`) producing frozen inert `CommandDraft` records via a LOCAL STRUCTURAL mirror of the control-plane submit contract (see §6 seam S2); capability REQUIREMENT (never an authorization — ceilings are not authorizations) + mandatory audit reason; subject-keyed deterministic idempotency keys (FNV-1a over tenant+kind+subject — never random); `validateCommandDraft` mirrors the queue's submit rejection vocabulary; `toSubmitInput` projects the exact submit-boundary shape.

## 4. Test themes (4 files, 69 tests — net-new, target ≥45)

- Ordering invariants (cards, alerts, recoveries, maintenance, board columns), rollups and counters, honest unknowns (never-observed device, absent connectivity record).
- Redaction proofs: redacted names visible, values PROVEN absent from serialized output (`+15550100`, `site-A` never serialized for fleet-overview; location visible for field-mode/asset-detail per purpose), non-scalar structures never surface, caller-supplied rules override defaults.
- OFFLINE TOLERANCE LAW: stale entry → `lastKnown.staleness === "stale"`, section declared, no fresh claim in serialized entry; all-fresh state → empty `lastKnownSections`; maintenance makes no freshness claim.
- Determinism: byte-identical repeated assemblies AND input-order independence (reversed record arrays → identical digests); digest tamper detection for every view + drafts (tamper displayName/posture/counters/sections/steps/reason → verify false).
- Tenant fail-closed exact refusals: missing-tenant, malformed-tenant-id, cross-tenant-ref (asset/device/twin/observation/recovery case/plan/order/connectivity — each naming the offender), unknown-asset-ref, unknown-device-ref (incl. unprovable findings), unknown-plan-ref, duplicate-ref, invalid-now, invalid-thresholds, unknown-asset (detail).
- Command intents: happy paths (frozen drafts, capability requests, payloads), idempotency key stability across issuances + subject separation, every refusal code with exact cases (tenant/actor/reason/issuedAt/notBefore/assetId/deviceId/planId/schedule variants), the structural mirror (exact key set incl. notBefore presence/absence), mirrored rejection vocabulary, digest tamper.

## 5. Exact gate outputs (package dir, per packet)

```text
corepack pnpm run test        → Test Files 4 passed (4) / Tests 69 passed (69)
corepack pnpm run typecheck   → exit code 0 (no diagnostics)
corepack pnpm run lint        → Found 0 warnings and 0 errors (16 files, src)
oxlint src tests              → Found 0 warnings and 0 errors (21 files)
```

Boundary self-check (packet command, rg-equivalent):

```text
rg "from ['\"]@fleetos/" packages/experiences/asset-field/src
  | rg -v "@fleetos/(assets|observations|health|recovery|maintenance|connectivity|identity|tenancy)['\"]"
→ no matches (CLEAN)
```

Import inventory (public entry points only, no deep paths): assets×8, connectivity×8,
health×6, maintenance×7, recovery×4, identity×2, observations×2, tenancy×1.

Determinism sweep: no `Date.now` / `Math.random` / timers / `fetch` / `new Date` in
src or tests (CLEAN). `git status` shows only `packages/experiences/` untracked +
the two intentionally-uncommitted install files.

## 6. Contract deltas + seam findings for TL adjudication

- **S1 — pnpm-workspace.yaml is missing `packages/experiences/*`** (HEADLINE): the
  packet-mandated `pnpm install --filter @fleetos/experience-asset-field` fails with
  "No projects matched the filters" because only `packages/*` + `packages/integrations/*`
  are workspace patterns. I added `- packages/experiences/*` LOCALLY (uncommitted —
  the TL owns that file) so the install could run; **the TL must add the pattern at
  merge** (F240B/F240C need it too). The lane commit contains neither the workspace
  edit nor the lockfile.
- **S2 — CommandDraft ↔ control-plane submit contract (the packet's named seam):**
  `CommandDraft.{kind, payload, idempotencyKey, issuedAt, notBefore?}` mirrors
  control-plane `SubmitCommandInput` field-for-field; `{tenantId, actorId}` mirror
  the TenantContext the queue binds; `validateCommandDraft` mirrors the queue's
  submit rejection vocabulary (`missing-kind`, `missing-idempotency-key`,
  `invalid-issued-at`, `invalid-not-before`) plus intent-specific codes. NO
  `@fleetos/control-plane` import (cross-lane). `toSubmitInput(draft)` emits the
  exact submit-boundary shape; binding it to a real `CommandQueue.submit({ctx,
  command})` is TL composition (convergence-package precedent). The mirror is
  shape-checked on my side only — machine-verifying symbol-level equivalence is a
  TL test-time composition.
- **S3 — subject-keyed idempotency policy:** idempotency keys derive from
  (tenant, kind, subject) — the same logical intent always dedupes at the queue,
  including a re-request after a terminal case. Deliberate reference-policy choice;
  alternative (per-issuance keys) is a one-line change if the TL prefers.
- **S4 — Findings carry no tenantId** (health contracts are device-keyed): the state
  guard proves finding tenancy via the device directory and refuses unprovable
  findings. If health ever carries tenant on findings, this simplifies.
- **S5 — maintenance entries make no freshness claim** (declared schedule intents,
  not observations); offline-tolerance stamps apply to observed sections only.
- Snapshot: the new package is NOT a tracked module in architecture-policy.yaml, so
  `fleetos:snapshot:check` is unaffected (mission/control-plane precedent); TL
  registration is a follow-up, not this lane.

## 7. Honest residuals

- Read-models only — no persistence, adapters, or UI; the state slice is
  caller-assembled (store → slice mapping is TL composition).
- `verify*Digest` recomputes from the view's own fields (tamper-evident), not a
  full re-derivation from source state.
- FNV-1a 32-bit digests (lane convention; evidence-grade sha-256 lives in
  @fleetos/evidence).
- Redaction defaults are a reference policy — the production privacy policy belongs
  to the policy lane.
- Root gates + full-suite `pnpm -r test` NOT run (TL merge-time gate per packet).
- `DeepWritable` test-only helper type exists because the slice + domain records
  are deeply readonly and tests mutate fixtures.

## 8. TL re-run commands

```bash
cd /home/z/w-f240a/packages/experiences/asset-field
corepack pnpm install --filter @fleetos/experience-asset-field --prefer-offline --ignore-scripts  # requires S1
corepack pnpm run test
corepack pnpm run typecheck
corepack pnpm run lint
```
