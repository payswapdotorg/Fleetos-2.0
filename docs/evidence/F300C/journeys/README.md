# F300C browser-journey scripts — work/commerce HostSurface routes

**Status:** ready for TL execution against the F301 shell (`packages/web`).
**Surface under test:** `@fleetos/experience-work-commerce/host` — surfaceId
`work-commerce`, surfaceKind `lane-experience`.

## Routes under test (the seam's route manifest)

| Route id | Path | Title |
| --- | --- | --- |
| `work-board` | `/commerce/work` | Work Board |
| `project-stage-gates` | `/commerce/projects` | Projects & Workloads |
| `procurement-spine` | `/commerce/procurement` | Procurement Spine |
| `software-entitlements` | `/commerce/software` | Software Entitlements |
| `org-budgets` | `/commerce/organization` | Agent Organization & Gateway Budgets |

## How to run

1. Deploy the shell at the exact commit under test and record the deployed
   commit sha + build identity (the records bind to it — never to a stale
   build).
2. Seed the composed state using the REAL composition pattern of
   `packages/acceptance/commerce` (the machine-run corpus is the seeding
   recipe; each script names its seeding journey).
3. Walk each script in order. Every step states the URL, the action, and
   the EXPECTED outcome — all expectations are the machine-verified
   readings of the corresponding `@fleetos/acceptance-commerce` journey,
   so a browser deviation is a real defect, not a judgment call.
4. Record per step: URL, screenshot (or DOM/log excerpt), and expected vs
   actual. Save records under `docs/evidence/F300C/runs/` bound to the
   deployed commit.
5. Honesty gates: refusal steps must render as refusals (never as
   success); honest markers (`read-as-of:logical-time`,
   `intent-execution:not-at-lane`, `quote-scoring:caller-composed`,
   `external-adapters:contract-only`, `budgets-are-ceilings:not-authorizations`)
   must be visible on the routes that declare them.

## Scripts

- `01-work-board.md` — the work board route + the create-work-order intent.
- `02-project-stage-gates.md` — stage-gate frontier, milestone gates, workload rollup.
- `03-procurement-spine.md` — the Need→Demand→Quote→Order→Fulfillment spine, vendor KPI, composed quote scoring, approve/place intents.
- `04-software-entitlements.md` — subscription seats with honest over-allocation.
- `05-org-budgets.md` — role assignments, capability budget ceilings, gateway usage + the over-limit refusal.

## Seeding note (the composed slice)

The host surface's `buildViewModels(slice, ctx)` is pure over the
TL-composed `WorkCommerceSlice`. The seeding journeys below accumulate
REAL domain records (work items through the REAL work directory, projects
through the REAL project lifecycle, procurement through the REAL spine,
role assignments through the REAL assignRole lifecycle, usage through the
REAL gateway ledger). The slice fields map one-to-one onto those records
— see `packages/acceptance/commerce/src/drivers-host.ts` `composeSlice`
for the exact composition the machine-run verifies.
