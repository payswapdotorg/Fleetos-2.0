# 04 — Device 360 recovery intent → execution → verification (route `device-360`)

**Machine-verified reference:** `host-recovery-intent-to-verification`
journey (F300A corpus). This is lane A's contribution to F301 acceptance
item 3: an end-to-end journey from UI action through the real
command/domain path to a recorded result.

**Seeding:** run the `host-recovery-intent-to-verification` journey's
domain ops: one truck + telemetry device, two `health.warn` observations,
triage (1 warning finding).

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/field/assets/ast_truck-alpha-01` | Device 360 shows the degraded posture "warning" (the intent's trigger) |
| 2 | Fire the request-recovery intent (event `device-360:request-recovery`) | An inert `CommandDraft` builds: kind `recovery.request`, capability REQUEST `recovery.request`, issued under the acting operator's actor id, deterministic idempotency key — the UI presents it as a draft awaiting binding, never as executed |
| 3 | Draft validation | The draft validates against the mirrored control-plane submit boundary (kind/idempotencyKey/issuedAt/reason/capability all present); the submit projection carries kind `recovery.request` |
| 4 | TL binding submits the draft to the real command path | The control-plane/Guardian path adjudicates and executes: recovery case `rc_host-ui-0001` opens ("open"), investigation ("investigating"), proposal ("proposal") |
| 5 | Evidence-backed resolution | Case resolves with the finding evidence attached (1 evidence ref) and the recorded root cause |
| 6 | Verification read-back (UI) | The host timeline shows NO open case after resolution (open 0) — outcome rendered with its audit trail, never fabricated success |
| 7 | Cross-check | The lane's own recovery-timeline read-model AGREES (open 0, digest verifies) — one truth, two projections |
| 8 | Inspect honesty markers | Device 360 declares `offline-write-sync:not-implemented` — the intent needed a live control-plane binding (step 4), which the UI states honestly |

## Refusals to verify (fail-closed)

- Technician role lens firing a maintenance intent on Device 360:
  `intent-not-offered-to-role` (presentation gate).
- A foreign-tenant context: the whole view-model bundle refuses
  (`tenant-mismatch`).
- A runtime-malformed context: `malformed-context` (the seam re-validates).

## Record

URLs, deployed commit, screenshots of steps 2 (inert draft), 4
(execution + verification record), 6, and the refusal renderings.
