# F300A — Asset/Field Experience & End-to-End Device Journeys — Evidence Report

**Work item:** F300A (Wave 10 lane A) · **Worker:** A (edge-and-asset) · **Branch:** `work/f300a`
**Final commit:** see §6 (Commit) · **Base:** `a5e18f5` (Wave 10 dispatch — carried the contract + packets)

## 1. Deliverables and owned-path diff

| Deliverable | Path | State |
| --- | --- | --- |
| HostSurface adapter (contract §2) | `packages/experiences/asset-field/src/host/` (`contract.ts`, `routes.ts`, `intents.ts`, `surface.ts`, `index.ts`) + `./host` subpath export | COMPLETE |
| Host machine tests | `packages/experiences/asset-field/tests/host.test.ts` | 19 tests, green |
| Host seam journey ops | `packages/acceptance/field/src/ops/host-ops.ts` (+ op types in `journey-contracts.ts`, dispatch in `runner.ts`, capability `host-integration`) | COMPLETE |
| End-to-end device journeys | `packages/acceptance/field/src/journeys/host-surface.ts`, `host-intents.ts`, `host-edges.ts` | 6 journeys, green |
| Corpus registration | `packages/acceptance/field/src/journeys/index.ts` (14 → 20) | COMPLETE |
| Corpus/report/negative tests | `tests/journeys.test.ts`, `tests/report.test.ts`, `tests/negative.test.ts` | updated, green |
| Browser-journey scripts | `docs/evidence/F300A/journeys/` (README + 5 scripts) | COMPLETE (TL executes at F301) |
| Evidence report | this file | COMPLETE |

No file outside worker-a ownership + `docs/evidence/F300A/` was touched (verified: `git diff --stat a5e18f5..<final>` shows only the paths above).

## 2. The HostSurface seam (WAVE10-HOST-CONTRACT §2)

- **surfaceId** `asset-field`, **surfaceKind** `lane-experience`.
- **Routes (5, machine-checked integrity):** `fleet-overview` (`/field`), `asset-discovery` (`/field/assets`), `device-360` (`/field/assets/:assetId`), `health-timeline` (`/field/health`), `field-workflow` (`/field/workflow`); drill-down graph validated by `verifyRouteManifest()`.
- **buildViewModels(slice, ctx):** pure projection of the REAL assemblies (`assembleFleetOverview`, per-asset `assembleAssetDetail` Device 360 sheets in assetId order, `assembleHealthBoard`, `assembleRecoveryTimeline`, `assembleMaintenanceBoard`, `assembleFieldView`); `asOf = ctx.establishedAt` — the only time source, never a clock; tamper-evident bundle digest (`verifyHostViewModelsDigest`).
- **Intents:** 5 UI events → the 3 EXISTING inert builders (`asset.enroll`, `recovery.request`, `maintenance.schedule`) via `buildIntentForEvent` — drafts stay frozen/inert; `toSubmitInput` binding remains TL work.
- **Tenant fail-closed at the seam:** context/slice tenant mismatch, malformed context, invalid establishedAt, forbidden scope → the WHOLE bundle refuses before projection; cross-tenant slice records keep refusing every per-route assembly (lane law surfaced verbatim).
- **Role lenses (presentation-only):** `offeredTo` per intent; a role not offered is refused `intent-not-offered-to-role` at the seam. Authorization stays with the control plane + Guardian (capabilityRequirement is a REQUEST).
- **Honesty markers per route:** `offline-read:last-known`, `live-telemetry:not-implemented`, `offline-write-sync:not-implemented` (device-360 + field-workflow).

Machine proofs (`tests/host.test.ts`): byte-identical purity (same slice+ctx ⇒ identical JSON + digest), input-order independence (reversed slice ⇒ same digest), real read-models verbatim (VM equals the standalone assemblies — no second truth store), digest tamper detection, all fail-closed paths, inert drafts (frozen, validate, digest-verified), role gates, markers.

## 3. End-to-end device journeys (machine-run, real composition per `packages/acceptance/field`)

| Journey (persona) | Chain proven |
| --- | --- |
| `host-discovery-device-360` (site-manager) | discovery cards → Device 360 drill-down → real serial/staleness/redaction; purity; enroll intent (site-manager offered) → validate |
| `host-health-evidence-timeline` (recovery-coordinator) | warnings → triage board → recovery case history as evidence timeline → evidence-backed resolution leaves the open board |
| `host-recovery-intent-to-verification` (fleet-operator) | Device 360 warning posture → `device-360:request-recovery` intent → mirrored submit boundary → real recovery command path (open→investigate→propose→resolve-with-evidence) → host + lane timeline both verify (open 0) |
| `host-maintenance-intent-to-verification` (maintenance-planner) | `device-360:schedule-maintenance` intent → validate → real plan/order/start/complete → maintenance board verifies completed + upcoming run |
| `host-field-workflow-mobile-offline` (field-technician) | phone-shaped field view offline: critical top alert stale-declared, last-known sections, bounded sections, degraded/unknown postures, honest markers |
| `host-role-lens-tenant-fail-closed` (field-technician) | role-lens refusals (enroll/maintenance not offered), offered recovery draft under the technician actor, foreign-tenant context refuses the WHOLE bundle (`tenant-mismatch`), malformed context refused (`malformed-context`) |

Fail-detection negatives added: an unmarked role-gate refusal fails the journey; a fake refusal (expectRefusal on an allowed op) fails.

## 4. Baselines before/after (exact, machine-run)

| Gate | Base `a5e18f5` | Final (this commit) | Law |
| --- | --- | --- | --- |
| `@fleetos/experience-asset-field` tests | 69 | **88** (+19 host) | grow-only ✓ |
| `@fleetos/acceptance-field` tests | 61 | **69** (+6 journey tests +2 negatives) | grows ✓ |
| security | 90 | **90/90 green** ✓ | held |
| commerce | 65 | **65/65 green** ✓ | held |
| convergence | 82 | **82/82 green** ✓ | held |
| adoption | 90 | **80/90 — 10 FAIL** (see §5) | pinned counts, F300C grant |
| release | 88 | **85/88 — 3 FAIL** (see §5) | pinned counts, TL gate constants |
| monorepo `pnpm run test` total | 4,742 | **4,769** (4,742 + 27) | grows-only ✓ |
| root `pnpm run lint` | 70 warnings/0 errors (substrate) | **0 errors; 0 new** (my packages: 0/0) | ✓ |
| root `pnpm run typecheck` | exit 0 | **exit 0** ✓ | held |
| `pnpm run architecture:check` | OK 0/0 | **OK, violations 0, new 0** ✓ | held |
| `pnpm run fleetos:snapshot:check` | **DRIFT at base** (pre-existing) | same pre-existing drift (see §5) | not mine |

## 5. Honest cross-lane residuals (never silently weakened)

1. **Adoption suite 10 failures — pinned field-corpus size.** `@fleetos/acceptance-adoption` pins the F270-era field corpus (14) and its derived counts: fully-applicable firm cap 42 → now 48 (20+15+13); counted executions 1,113 → 1,293 (exactly +180 = 6 new journeys × 30 workspaces); field raw executions 375 → 555. The adoption ledger is **Worker C's scoped F300C grant** (`packages/acceptance/adoption/**`); I did not touch it. All 10 failures are count pins, not structural; the new counts above give C the exact update values.
2. **Release suite 3 failures — pinned gate constants.** `@fleetos/acceptance-release` pins `field 14` and `adoption 1113` in gate-baseline tests (TL-owned package). Same class; same fix at F301 convergence.
3. **Contract snapshot DRIFT pre-exists my commit.** `pnpm fleetos:snapshot:check` fails identically at BASE `a5e18f5` (reproduced in a clean worktree): the Wave 9 asset-lineage exports (commit 7e519e2, `packages/assets/src/lineage/*`) were never re-snapshotted. My lane adds no registered-bounded-context exports (the host seam lives in `@fleetos/experience-asset-field`, not a registered module), and `spec/**` is TL-owned — regen is a TL decision.
4. **Honest unsupported list (never simulated):** offline WRITE sync / capture-and-replay (marker `offline-write-sync:not-implemented`); live telemetry push (`live-telemetry:not-implemented`); binding `CommandDraft`s to `CommandQueue.submit` (TL work — the mirrored submit boundary is validated, never executed by the lane); role lenses are presentation gating, not authorization (Guardian adjudicates).

## 6. Commit + TL re-run commands

- Final commit: `work/f300a` HEAD (see `git log -1` on the branch; message `F300A: asset/field experience host integration + end-to-end device journeys + field corpus extension (Wave 10 lane A)`).
- Owned paths in the diff: `packages/experiences/asset-field/**`, `packages/acceptance/field/**`, `docs/evidence/F300A/**`.

```bash
git fetch && git checkout work/f300a && git log --oneline -3
corepack pnpm install --frozen-lockfile
pnpm --filter @fleetos/experience-asset-field test && pnpm --filter @fleetos/experience-asset-field typecheck && pnpm --filter @fleetos/experience-asset-field lint
pnpm --filter @fleetos/acceptance-field test && pnpm --filter @fleetos/acceptance-field typecheck && pnpm --filter @fleetos/acceptance-field lint
pnpm --filter @fleetos/acceptance-security test && pnpm --filter @fleetos/acceptance-commerce test && pnpm --filter @fleetos/acceptance-convergence test
pnpm --filter @fleetos/acceptance-adoption test   # 80/90 until F300C updates the ledger
pnpm --filter @fleetos/acceptance-release test    # 85/88 until TL updates gate constants
pnpm run lint && pnpm run typecheck && pnpm run architecture:check
pnpm run test                                    # 4,769 total; see §4/§5
```

Browser journeys: execute `docs/evidence/F300A/journeys/` scripts against the F301 shell; records bind to the deployed commit.

## 7. Shell-change proposals to TL

None required for the seam: the host surface is mountable via `@fleetos/experience-asset-field/host` exactly per contract §2. Coordination items (not code proposals):
1. `packages/acceptance/adoption/**` count updates (C's F300C grant) — values in §5.1.
2. `packages/acceptance/release/**` gate-baseline constants (TL) — values in §5.2.
3. `spec/snapshots/fleetos-contracts.json` regen (TL; pre-existing drift, §5.3).
4. For the shell: render the route `limitations` markers verbatim, render intents as inert drafts pending binding, and render refusals (`tenant-mismatch`, `intent-not-offered-to-role`, `unknown-asset`, `cross-tenant-ref`) as explicit refusal states — per the browser scripts.
