# 02 — Asset Discovery → Device 360 (routes `asset-discovery` → `device-360`)

**Machine-verified reference:** `host-discovery-device-360` journey
(F300A corpus) — every expectation below is a machine-verified actual
of that journey.

**Seeding:** same composed state as script 01 (the
`host-discovery-device-360` journey's domain ops).

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/field/assets` | Asset Discovery renders over the SAME real overview read-model (no second store): 2 asset cards |
| 2 | Inspect the enroll affordance | Present for operator/site-manager role lenses: "Enroll a new asset" (intent event `asset-discovery:enroll-asset`, builder `asset.enroll`, capability REQUEST `assets.enroll`) |
| 3 | Switch role lens to `field-technician` | The enroll affordance is NOT offered — the intent is refused at the seam (`intent-not-offered-to-role`) |
| 4 | As operator, submit the enroll form for `ast_host-new-01` / `dev_host-new-01` | An inert `CommandDraft` is built (kind `asset.enroll`, capability request `assets.enroll`, deterministic idempotency key) — the UI shows the draft as PENDING TL binding, never as executed/succeeded |
| 5 | Click the trailer card | Navigates to `/field/assets/ast_trailer-beta-02` — Device 360 |
| 6 | Inspect the Device 360 sheet | device serial "SN-2002"; staleness "fresh"; posture "clear"; findings count 0; twin provenance (revision count 1, head digest present) |
| 7 | Inspect honesty markers | Device 360 declares `offline-read:last-known`, `live-telemetry:not-implemented` AND `offline-write-sync:not-implemented` (commands cannot be captured offline — honestly stated) |
| 8 | Drill to Health & Evidence Timeline | Navigates to `/field/health` |

## Refusals to verify (fail-closed)

- Unknown asset id in the URL (`/field/assets/ast_not-there`): the sheet
  refuses `unknown-asset` — an explicit not-found refusal, never a blank
  page or a guessed asset.
- Technician firing the enroll intent: refusal `intent-not-offered-to-role`.

## Record

URLs, deployed commit, screenshots of steps 3, 4 (the inert draft state),
6, and both refusals.
