# F301 — FleetOS application shell and product convergence (TL) — Phase 1 evidence

**Status:** phase 1 complete (skeleton + real composition + command path + six real
surfaces); phase 2 (HostSurface adapter binding from F300A/B/C) pending lane deliveries.

## Owned paths

`packages/web/fleetos.html`, `packages/web/src/fleetos/**`,
`packages/web/vite.fleetos.config.ts`, `packages/web/package.json` (workspace dep
links), `pnpm-lock.yaml` (materialized web links), `docs/evidence/F301/**`.

## What was built (commits `cf513f5`, `65e9250`)

1. **Standalone entry** — `fleetos.html` mounts its own React root; no ZCode boot, no
   OAuth, no server dependency (F301 acceptance #6: no private local services needed
   beyond static hosting).
2. **Real composed state** — `src/fleetos/world.ts`: two tenants (Acme Logistics,
   Meridian Health) with actors/roles; REAL `AssetDirectory` admissions + activations,
   REAL `EnrollmentDirectory` enrollments, REAL observation-pipeline ingestion
   (`runPipeline`), REAL health triage, REAL security posture (`computePosture`),
   REAL work-board records; the lane-A `ExperienceStateSlice` feeds the REAL
   `assembleFleetOverview` and `assembleControlTower`. No second business-truth store —
   state lives in the lane packages' own directories. Demo composition labeled
   honestly (footer: deterministic logical time T0, fixed fixture inputs).
3. **Real command path** — `src/fleetos/commandPath.ts`: UI intent → lane
   `CommandDraft` builders → `TowerCommandBus` → REAL control-plane `CommandQueue`
   via `queueAsSubmitPort`. Submissions enqueue for Guardian adjudication; capability
   ceilings are requests, never authorizations (machine-carried marker rendered).
4. **Six surfaces** — Control Tower (cross-lane cockpit with tower digest), Device
   360/Field (fleet overview, assets, devices, observation timeline, health findings),
   Safety & Intelligence (finding triage queue, severity rollup, evidence-gated
   remediation lifecycle with Guardian-approval-required markers), Work & Commerce
   (work board, honest integration-status disclosure), Engineering Lab (REAL
   deterministic simulation run — 86 events, state digest), Command Console
   (registry, queue records, submission audit log).
5. **Browser crypto shim** — `src/fleetos/crypto-shim.ts`: pure-TS sha256,
   test-vector-verified byte-identical to `node:crypto` (the domain packages hash
   synchronously; browsers have no sync crypto API).
6. **Standalone build** — `vite.fleetos.config.ts`: 236 modules, ~300KB (the full
   8k-module app build OOMs the 4GB box). Commit identity injected at build
   (`__FLEETOS_COMMIT__`) and rendered in the footer (F301 acceptance #1).

## Browser evidence (in-page, at the deployed build)

Deployment: `dist-fleetos/` served on `:3105` (supervisor-kept local service
`fleetos-server`). Screenshots: `screens/{tower,field,safety,commerce,lab,commands}.png`.

Verified at build commit `a5e18f5` (skeleton) and rebuilt at `cf513f5`/`65e9250`:

- **All six routes render, zero unexpected refusals.** Real digests observed in-page:
  tower `tower_40567aaf`, fleet overview `3f8cced3`, findings rollup `b0abc12e`,
  work board `workboard_5a994900`, lab state `3976fcd4`.
- **E2E command journey (UI → real queue):** `asset.enroll` → `cmd_0000000001`
  ENQUEUED; `recovery.request` → `cmd_0000000002` ENQUEUED; idempotent resubmit of
  the same logical intent → `duplicate=true` (the REAL queue's idempotency law
  observed through the UI).
- **Negative path (honest refusal):** out-of-vocabulary reason → `REFUSED
  reason-not-in-vocabulary` rendered verbatim + audit-logged; tenant-scope
  mismatch refuses the work board (`TENANT_SCOPE_MISSING` was observed and fixed
  during bring-up — the fail-closed boundary working).
- **Tenant/role switching:** two tenants with role-appropriate actors; switching
  re-composes all views.

## Honest limitations (phase 1)

- The lane surfaces currently consume the Wave-4 experience builders directly;
  the F300A/B/C `HostSurface` adapters (with their extended corpora + journey
  scripts) bind at phase-2 convergence.
- Procurement detail surfaces (demand→quote→order) and mission-replay views await
  the lane C/B deliveries.
- The Guardian adjudication DISPLAY shows enqueued state + remediation
  evidence-gates; a completed authorized-action execution journey renders after
  the lane B HostSurface lands.
- Demo world is fixture-input based (acceptance-suite convention) — production
  deployment composition (real persistence wiring) is an F302 residual to record.

## TL re-run commands

```bash
cd packages/web && npx vite build --config vite.fleetos.config.ts
# serve dist-fleetos/ on any static port; open fleetos.html#/tower
```
