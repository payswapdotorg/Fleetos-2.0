# Wave 10 Host Integration Contract (TL-owned)

**Status:** active — the shared integration contract F300A/F300B/F300C depend on.
**Owner:** TL (application composition belongs to TL per `spec/worker-ownership.yaml`).
**Change law:** workers propose changes; only TL edits this file.

## 0. Purpose

The Wave 4 experience packages already expose pure, deterministic view-model
builders and inert `CommandDraft` intents over their lane's real domain state.
Wave 10 connects them to the actual application host. This contract defines the
single seam through which lanes integrate, so that TL composition (F301) can
mount every lane without per-lane special cases.

## 1. The actual host

- The web host is `packages/web` (`@zcode/web`, Vite + React) — the inherited
  ZCode substrate. The ZCode runtime remains the substrate; it is not rewritten.
- For Wave 10 the TL takes ownership of `packages/web/**` (documented extension
  of the existing TL grant over `apps/web/**`; "application composition belongs
  to tl") and builds the FleetOS application shell there:
  FleetOS product identity, navigation (Control Tower, Device 360/field,
  safety/intelligence, work/commerce, Engineering Lab), tenant/role scoping,
  universal command/search, and honest empty/loading/error/refusal states.
- Workers do NOT edit `packages/web/**`, `packages/experiences/control-tower/**`,
  `packages/experiences/engineering-lab/**`, `packages/control-plane/**`,
  `packages/kernel/**`, or any other TL-owned path. Shell-change needs go to TL
  as written proposals in the lane's evidence report.

## 2. The seam: `src/host/` subpath export

Each lane adds a `host` module to its experience package
(`@fleetos/experience-asset-field/host`, `.../safety-intel/host`,
`.../work-commerce/host`), exporting a **HostSurface** adapter:

```ts
export interface HostSurface<Slice, VM> {
  surfaceId: string;                 // stable, e.g. "asset-field"
  surfaceKind: "lane-experience";
  routes: HostRouteManifest;         // route id -> title, drill-down refs
  buildViewModels(slice: Slice, ctx: TenantContext): VM;  // pure, deterministic
  intents: HostIntentCatalog;        // UI event -> CommandDraft builder id
}
```

Laws (machine-tested in the lane's own tests):

- **Pure and deterministic**: same slice + ctx ⇒ byte-identical view models
  (existing experience law extended to the host boundary).
- **No second business-truth store**: the adapter reads the lane's REAL domain
  read-models only; it never caches, derives-new-truth, or embeds a store.
- **Inert intents**: command intents remain inert `CommandDraft` records; the
  TL app binds them to the real control-plane `CommandQueue.submit` — the
  existing `toSubmitInput`-class binding is TL work, never lane work.
- **Tenant fail-closed**: cross-tenant records refuse the whole view (existing
  lane law, surfaced to the host verbatim).
- **Honesty fields**: unsupported/undeployed capabilities carry machine-readable
  limitation markers (e.g. advisory provenance, offline-capability flags), never
  simulated success.

## 3. State source and command path (TL provision)

- The TL app composes real domain state per the acceptance-suite composition
  pattern (real builders, real repositories; F211 persistence where wired).
- UI intent → lane `CommandDraft` → TL binding → control-plane submit →
  Guardian adjudication → execution → verification records rendered with
  outcome + audit trail. Failures, refusals, tenant mismatch, stale state and
  failed verification render as such — no fabricated success.

## 4. Journeys and browser evidence

- Each lane delivers, in its owned paths:
  1. **machine-run journey corpus extensions** — genuinely distinct, real
     journeys through the lane's REAL public APIs (these are the counted
     adoption journeys; identical reruns never count);
  2. **browser-journey scripts** in the lane's evidence folder — steps over
     the deployed shell using the lane's HostSurface routes (TL executes them
     against the F301 shell; records bind to the deployed commit).
- TL will stand up the shell at `packages/web` (dev server) early during F301
  so lanes can dry-run their scripts against it in their final phase; if the
  shell is not yet reachable, machine-run corpus + scripts constitute lane
  evidence and the browser runs complete at F301/F302 — recorded honestly,
  never fabricated.

## 5. Adoption counted-journeys extension (the F271 shortfall)

- Current recorded state: 1,113 counted executions across 30 workspaces;
  a fully-applicable firm caps at 42 (field 14 + commerce 15 + security 13)
  against the 100-counted-journeys-per-firm target.
- Each lane extends ITS corpus (field → `packages/acceptance/field`,
  security → `packages/acceptance/security`, commerce →
  `packages/acceptance/commerce`) with genuinely distinct journeys where the
  REAL product capability supports them. Worker C owns the adoption ledger
  update (`packages/acceptance/adoption/**`, scoped TL grant) and records the
  new honest counts; shortfalls are preserved with structural reasons and a
  documented TL/user decision — the threshold is never silently weakened.

## 6. Baselines to hold (grow-only, machine-run at the lane's exact commit)

field 61 · security 90 · commerce 65 · adoption 90 · release 88 ·
convergence 82 · monorepo total 4,742. A lane's merge re-runs ALL six
acceptance suites plus its own package suites (post-merge re-runs mandatory).

## 7. Ownership grants specific to Wave 10

- Worker C: `packages/acceptance/adoption/**` (F300C only; existing runner
  contracts held — adoption 90 grows only).
- TL: `packages/web/**` (F301/F302 shell work; this file documents the grant).
- Everything else stays exactly as `spec/worker-ownership.yaml` records.
