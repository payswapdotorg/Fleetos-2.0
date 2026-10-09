# 03 — Health & Evidence Timeline (route `health-timeline`, path `/field/health`)

**Machine-verified reference:** `host-health-evidence-timeline` journey
(F300A corpus) — the expectations are its machine-verified actuals.

**Seeding:** run the `host-health-evidence-timeline` journey's domain
ops: one truck asset + telemetry device, two `health.warn` observations,
triage (1 warning finding), recovery case `rc_host-tl-0001` opened and
investigated; then propose + evidence-backed resolve DURING the walk
(the script drives both halves).

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/field/health` | Health & Evidence Timeline renders: health board + open-recovery evidence timeline |
| 2 | Inspect the health board | 1 row (the truck); posture "warning"; fleet warning count 1; worst finding code `health.warn` |
| 3 | Inspect the evidence timeline | 1 open case `rc_host-tl-0001`, state "investigating"; the case's REAL command history renders as timeline steps: ["investigate"]; case age is displayed against the view's logical asOf |
| 4 | Propose the resolution (UI action) | Case moves to "proposal" (reason recorded) |
| 5 | Resolve WITH evidence (UI action) | Case resolves; the finding evidence (1 evidence ref) and root cause "battery replaced and verified" attach to the case |
| 6 | Re-render `/field/health` (verification) | The resolved case LEFT the open timeline (open count 0); the board still records the finding history (fleet warning 1) — honest history, not erasure |
| 7 | Inspect honesty markers | The route declares `offline-read:last-known` + `live-telemetry:not-implemented` |

## Refusals to verify (fail-closed)

- Resolve WITHOUT evidence: refused (`missing-evidence`) — rendered as
  an explicit refusal, never a silent success.
- Re-resolving a resolved case: refused (state law + evidence law).

## Record

URLs, deployed commit, screenshots of steps 3, 5, 6 and the
missing-evidence refusal.
