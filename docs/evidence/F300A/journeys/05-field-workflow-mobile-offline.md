# 05 — Field Workflow, mobile + offline (route `field-workflow`, path `/field/workflow`)

**Machine-verified reference:** `host-field-workflow-mobile-offline` and
`host-role-lens-tenant-fail-closed` journeys (F300A corpus).

**Seeding:** run the `host-field-workflow-mobile-offline` journey's
domain ops: truck + trailer assets, telemetry + gateway devices, three
`health.error` observations on the telemetry device (triage escalates to
1 critical finding), one online heartbeat for the gateway; render at
logical `now` = T0+300_000 (five minutes later — offline).

## Steps — mobile shape (phone viewport)

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/field/workflow` at a phone viewport (390×844) | The phone-shaped field view renders: top alerts, recovery-in-progress, next maintenance, connectivity — priority-ordered sections |
| 2 | Inspect the top alert | The escalated critical fault is the top alert; its last-known provenance is declared "stale" (NEVER claimed fresh) |
| 3 | Inspect the last-known declaration | Sections rendering non-fresh data are listed: ["top-alerts", "connectivity-status"] |
| 4 | Inspect connectivity entries | Postures are honest: the stale heartbeat degrades to "degraded"; the absent record stays "unknown" — order ["degraded", "unknown"] |
| 5 | Verify phone-shape bounds | Every section is size-bounded; attribute excerpts are bounded (machine-checked in the reference journey) |
| 6 | Inspect honesty markers | The route declares `offline-read:last-known` AND `offline-write-sync:not-implemented` — offline command capture/sync does NOT exist and the UI says so (never a simulated sync) |

## Steps — role lens (fail-closed)

| # | Action | Expected |
| --- | --- | --- |
| 7 | As `field-technician`, look for "schedule maintenance" | NOT offered — firing it refuses `intent-not-offered-to-role` |
| 8 | As `field-technician`, fire request-recovery (event `field-workflow:request-recovery`) | Offered: an inert `recovery.request` draft builds under the technician's actor id |
| 9 | Switch to `maintenance-planner` | The field maintenance affordance becomes available (offeredTo role lens) |

## Not implemented (honest, do not test as success)

- Offline WRITE sync: no capture-and-replay queue exists; commands
  require a live control-plane binding (marker on the route).
- Reconnect re-pull automation: the view renders the supplied slice
  as-of the context's logical time; a host re-render with a fresh slice
  is how new data appears (marker `live-telemetry:not-implemented`).

## Record

URLs, deployed commit, screenshots at the phone viewport of steps 2, 3,
6 (markers), and the role-lens refusal of step 7.
