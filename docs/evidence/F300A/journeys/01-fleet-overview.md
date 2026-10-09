# 01 — Fleet Overview (route `fleet-overview`, path `/field`)

**Machine-verified reference:** `enroll-new-asset` journey (corpus) and
`host-discovery-device-360` journey (F300A corpus) — the readings below
are their machine-verified actuals.

**Seeding (TL composition, real state only):** run the
`host-discovery-device-360` journey's domain ops on the composed slice
(two assets — `ast_truck-alpha-01` (vehicle, active) and
`ast_trailer-beta-02` (handheld), one enrolled device per asset, one
ingested observation + twin revision for `dev_gate-2002`, one warning
finding on `dev_telem-1001`, logical `now` = T0+5_000).

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/field` | The Fleet Overview renders: surface identity is FleetOS asset/field (surfaceId `asset-field`), title "Fleet Overview" |
| 2 | Inspect the asset cards | 2 cards, `assetId` order: `ast_trailer-beta-02` first, then `ast_truck-alpha-01` |
| 3 | Inspect card 0 (trailer) | deviceCount 1; last-observed staleness badge "fresh"; posture "clear"; connectivity "unknown" (honest — no record) |
| 4 | Inspect card 0 attributes excerpt | `location` and `operatorContact` are REDACTED (redacted fields list surfaces them) |
| 5 | Inspect card 1 (truck) | posture "warning" (the triaged finding); last-observed staleness "unknown" (no twin for `dev_telem-1001`) |
| 6 | Look for the offline-read honesty marker | The route declares `offline-read:last-known` + `live-telemetry:not-implemented` (visible limitation, not hidden) |
| 7 | Click card 1 | Drill-down navigates to `/field/assets/ast_truck-alpha-01` (Device 360) |

## Refusals to verify (fail-closed)

- Tenant switch to a foreign tenant context: the WHOLE overview refuses
  (`tenant-mismatch`) — an explicit refusal state, never an empty table.
- A cross-tenant record inside the slice: overview refuses with
  `cross-tenant-ref` (whole-view refusal, no partial state).

## Record

URL, deployed commit, screenshots of steps 3–6, refusal rendering.
