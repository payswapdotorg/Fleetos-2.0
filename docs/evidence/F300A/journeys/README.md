# F300A browser-journey scripts — asset/field HostSurface routes

**Status:** ready for TL execution against the F301 shell (`packages/web`).
**Surface under test:** `@fleetos/experience-asset-field/host` — surfaceId
`asset-field`, surfaceKind `lane-experience`.

## Routes under test (the seam's route manifest)

| Route id | Path | Title |
| --- | --- | --- |
| `fleet-overview` | `/field` | Fleet Overview |
| `asset-discovery` | `/field/assets` | Asset Discovery |
| `device-360` | `/field/assets/:assetId` | Device 360 |
| `health-timeline` | `/field/health` | Health & Evidence Timeline |
| `field-workflow` | `/field/workflow` | Field Workflow |

## How to run

1. Deploy the shell at the exact commit under test and record the deployed
   commit sha + build identity (the records bind to it — never to a stale
   build).
2. Seed the composed state using the REAL composition pattern of
   `packages/acceptance/field` (the machine-run corpus is the seeding
   recipe; each script names its seeding journey).
3. Walk each script in order. Every step states the URL, the action, and
   the EXPECTED outcome — all expectations are the machine-verified
   readings of the corresponding `@fleetos/acceptance-field` journey, so
   a browser deviation is a real defect, not a judgment call.
4. Record per step: URL, screenshot (or DOM/log excerpt), and expected vs
   actual. Save records under `docs/evidence/F300A/runs/` bound to the
   deployed commit.
5. Honesty gates: refusal steps must render as refusals (never as
   success); honest markers (`offline-read:last-known`,
   `offline-write-sync:not-implemented`, `live-telemetry:not-implemented`)
   must be visible on the routes that declare them.

## Scripts

- `01-fleet-overview.md` — fleet overview route over real composed state.
- `02-asset-discovery-device-360.md` — discovery → Device 360 drill-down
  (the `host-discovery-device-360` machine journey, in the browser).
- `03-health-evidence-timeline.md` — health board + recovery evidence
  timeline (the `host-health-evidence-timeline` machine journey).
- `04-device-360-recovery-intent.md` — UI intent → real command path →
  verification (the `host-recovery-intent-to-verification` machine
  journey — F301 acceptance item 3, lane A contribution).
- `05-field-workflow-mobile-offline.md` — phone-shaped field workflow,
  offline last-known rendering, honest markers, role-lens refusals.

## Not covered by these scripts (honest)

- Offline **write** sync (capture-and-replay) is NOT implemented in the
  product; scripts verify the honest marker, never a simulated sync.
- Live telemetry push is NOT implemented; views reflect composed slice
  state at render time.
- Binding drafts to the control-plane queue is TL work — script 04 stops
  at the boundary the lane owns and expects the TL-bound execution path
  to take over from there.
