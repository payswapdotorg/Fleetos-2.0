# 01 — Work Board (route `work-board`, path `/commerce/work`)

**Machine-verified reference:** `create-work-order` + `work-order-blocking`
journeys (corpus) and `host-surface` / `host-intents` journeys (F300C
corpus) — the readings below are their machine-verified actuals.

**Seeding (TL composition, real state only):** two work orders —
`wo-b1` "Repair conveyor belt" assigned to `agent-11`, driven start →
block (reason "waiting on belt splice kit") → unblock → complete, and
`wo-b2` "Lubricate dock hinges" assigned to `agent-12`, started and live;
logical context `establishedAt` = 1_774_000_000_000 (the host builder's
derived `computedAt` is its ISO instant).

## Steps

| # | Action | Expected (machine-verified) |
| --- | --- | --- |
| 1 | Open `/commerce/work` | The Work Board renders: surface identity is FleetOS work/commerce (surfaceId `work-commerce`), title "Work Board" |
| 2 | Inspect the columns | All five domain status columns in order: todo, in_progress, blocked, done, cancelled |
| 3 | Inspect the done column | `wo-b1` card: title "Repair conveyor belt", NO assignee (completion closes the assignment — the domain clears it, never hidden) |
| 4 | Inspect the in-progress column | `wo-b2` card: assignee `agent-12` |
| 5 | Toggle assignee redaction (if the shell exposes it) | `wo-b2`'s assignee renders as the `[REDACTED]` sentinel and the board records `redactedFields: ["assigneeId"]` — WHAT was hidden, never the value |
| 6 | Look for the honest limitation markers | The route declares `read-as-of:logical-time` + `intent-execution:not-at-lane` (visible, not hidden) |
| 7 | Trigger "Create work order" as operations-manager | An inert `CommandDraft` of kind `work.create-work-order` with capability REQUEST `work.order.create` and subject-derived idempotency key — it enqueues nothing by itself; the TL binding submits it to the control plane (Guardian adjudicates) |

## Refusals to verify (fail-closed)

- A vendor-manager role lens triggering "Create work order": the intent is
  NOT offered to that role — the affordance refuses at the seam
  (`intent-not-offered-to-role`), never renders a live action.
- A blank title in the create form: the draft builder refuses
  (`TITLE_REQUIRED`) — an explicit error, never a silently-empty card.
- Tenant switch to a foreign tenant context: the WHOLE bundle refuses
  (`tenant-mismatch`) — an explicit refusal state, never an empty board.

## Record

URL, deployed commit, screenshots of steps 3–7, refusal renderings.
