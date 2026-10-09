# 04 — Software Entitlements (route `software-entitlements`, path `/commerce/software`)

**Machine-verified reference:** `software-entitlements` journey (corpus)
plus the `host-surface` journey (F300C corpus) — the readings below are
their machine-verified actuals.

**Seeding (TL composition, real state only):** subscription `sub-1`
(sku FLEET-OPS-PRO, 5 seats, active, valid 2026-01-01 → 2027-01-01) with
three live entitlements (`ent-1`..`ent-3` for agents 1–3) — the world's
REAL software records.

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/commerce/software` | The Software Entitlements route renders one seat row for `sub-1` |
| 2 | Inspect the seat row | sku FLEET-OPS-PRO, status active, seatsTotal 5, seatsAllocated 3, seatsRevoked 0, utilizationBps 6000 (floor(3×10000/5) — integer bps), expired false |
| 3 | Grant seats beyond the subscription (compose over-allocation) | The row reports `seatsOverAllocated` > 0 HONESTLY — the domain records the over-allocation, never silently clamps the count |
| 4 | Advance the logical `now` past `validUntil` (re-render with a later context) | `expired` flips true — expiry is computed against the context's logical time, never a wall clock |
| 5 | Look for the honest limitation markers | The route declares `read-as-of:logical-time` |

## Refusals to verify (fail-closed)

- A cross-tenant entitlement record in the slice: the seat view refuses
  the WHOLE rollup with `TENANT_MISMATCH` naming the offender.
- Revoking an already-revoked grant: the domain refuses with its own
  reason code (the corpus records it verbatim) — never a double-revoke.

## Record

URL, deployed commit, screenshots of steps 2–4, refusal renderings.
