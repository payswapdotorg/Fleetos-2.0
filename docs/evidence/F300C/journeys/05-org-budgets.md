# 05 — Agent Organization & Gateway Budgets (route `org-budgets`, path `/commerce/organization`)

**Machine-verified reference:** `org-optimization-review`,
`gateway-routing` and `role-assignment-handoff` journeys (the F300C
corpus extension) plus the `host-surface` journey — the readings below
are their machine-verified actuals.

**Seeding (TL composition, real state only):** org budget `bud-agent-1`
(agent-1, capability model_invoke, 600 units / 24_000 minor allocated,
500 units / 20_000 minor consumed, generation 1); one REAL role
assignment `ra-5` (agent-3 → role-ops, created through assignRole and
activated through transitionRoleAssignment); gateway usage ledger with
one committed entry (100 units, 4_000 minor, provider-one, chain
verified).

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/commerce/organization` | The Agent Organization & Gateway Budgets route renders three assemblies: role board, capability budget board, gateway usage rollup |
| 2 | Inspect the role board | `ra-5` in the active column; relieved assignments (if any) in the relieved column with their relief reason — the REAL lifecycle states, never a flat list |
| 3 | Inspect the capability budget board | `bud-agent-1`: unitUtilizationBps 8333 (floor(500×10000/600)), phase `consumed`, and the `ceiling-satisfied-not-authorization` note on EVERY row — budgets are ceilings, they authorize NOTHING |
| 4 | Inspect the gateway usage rollup | 1 entry, 100 units, 4_000 minor, chain `ok: true` (the domain's own chain verification, surfaced) |
| 5 | Compose a usage append over the unit ceiling (agent-1, 150 units) | The REAL budget port refuses `BUDGET_REFUSED_BY_ORG:UNITS_EXHAUSTED` — the over-limit refusal is VISIBLE, the append never lands (the rollup totals stay at 4_000 minor) |
| 6 | Compose a model selection with a tight budget ceiling (summarize+analytics, 100 units, ceiling 300 minor) | The REAL routing refuses `BUDGET_CEILING_EXCEEDED` with the cheapest candidate cost recorded — an honest refusal with the evidence, never a silent downgrade |
| 7 | Trigger "Allocate budget" as org-optimizer | An inert `CommandDraft` of kind `org.allocate-budget` with integer units + minor spend and subject-derived idempotency — a CEILING change request, Guardian adjudicates |
| 8 | Look for the honest limitation markers | The route declares `read-as-of:logical-time`, `intent-execution:not-at-lane` and `budgets-are-ceilings:not-authorizations` |

## Refusals to verify (fail-closed)

- Assigning a role beyond the concurrency ceiling: the domain refuses
  `MAX_CONCURRENT_ROLES_EXCEEDED` with the exact overshoot — visible.
- Assigning to a foreign tenant: `TENANT_MISMATCH` naming the existing
  assignment — visible, never a partial board.
- Transitioning a RELIEVED assignment: `TERMINAL_STATE` — terminal is
  terminal, never resurrected.
- The quota window after two accepted requests: the third in-window
  request refuses `QUOTA_REQUESTS_EXHAUSTED` with the exact overshoot of
  one request; outside-window traffic refuses `REQUEST_OUTSIDE_WINDOW`.
- The "Allocate budget" affordance for a procurement-lead role lens: not
  offered (`intent-not-offered-to-role`).

## Record

URL, deployed commit, screenshots of steps 2–8, refusal renderings.
