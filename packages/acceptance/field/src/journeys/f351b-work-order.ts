/**
 * @fleetos/acceptance-field — F351B journey 2: the work-order shift
 * supersession discipline (Wave 16 lane A — the masked-industry coverage
 * tranche 1; mining-primary persona: shift-scoped work orders).
 *
 * CENSUS CITATION (F351B report §1, machine-measured at base `4f59ffe`;
 * zero grep matches across the field/security/commerce corpora):
 *   - advanceWorkItem — packages/work/src/lifecycle.ts:31
 *   - assignTo — packages/work/src/lifecycle.ts:148
 *   - reassignTo — packages/work/src/lifecycle.ts:199
 *   - progressEventForTransition — packages/work/src/progress.ts:58
 *   - progressEventForAssignment — packages/work/src/progress.ts:112
 *   - computeProgressDigest — packages/work/src/progress.ts:186
 *
 * The REAL capability is @fleetos/work's shift discipline: the pure
 * advance state machine (illegal transitions, required reasons,
 * assignee-required completion), the assignment SUPERSESSION law (one
 * live assignee; the old record closes with a supersededBy ref, never
 * mutated in place; idempotent same-assignee no-ops), and the typed
 * progress events with stable replay digests (law A19).
 *
 * Vocabulary law: persona `field-technician` + capability `maintenance`
 * (the field work-order family of the frozen 14-capability vocabulary;
 * no vocabulary change, F331A precedent).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";

export const workOrderShiftSupersessionJourney: AcceptanceJourney = {
  id: "work-order-shift-supersession",
  persona: "field-technician",
  capability: "maintenance",
  goal: "Run the shift's work order honestly: the REAL advance law refuses illegal moves and reason-less blocks, assignment is a SUPERSESSION (the old record closes with a supersededBy ref, never mutated), same-assignee moves are idempotent no-ops, and every transition emits a typed progress event with a stable replay digest.",
  steps: [
    { id: "w1", summary: "open the shift's work order (brake inspection on the haul truck)", op: { kind: "wo.open", itemId: "wo_shift-0001", title: "Haul truck brake inspection", deadline: "shift-2026-10-14-day" } },
    { id: "w2", summary: "start the work order", op: { kind: "wo.transition", itemId: "wo_shift-0001", command: "start", emittedAt: "2026-10-14T06:05:00Z" } },
    { id: "w3", summary: "try to complete with no assignee (must refuse — one accountable owner)", expectRefusal: true, op: { kind: "wo.transition", itemId: "wo_shift-0001", command: "complete", emittedAt: "2026-10-14T06:10:00Z" } },
    { id: "w4", summary: "assign the order to the shift technician", op: { kind: "wo.assign", itemId: "wo_shift-0001", assignmentId: "asg_shift-0001-a", assigneeId: "tech-ada", assignedAt: "2026-10-14T06:15:00Z" } },
    { id: "w5", summary: "try assigning a SECOND live owner (must refuse — one live assignee)", expectRefusal: true, op: { kind: "wo.assign", itemId: "wo_shift-0001", assignmentId: "asg_shift-0001-b", assigneeId: "tech-ben", assignedAt: "2026-10-14T06:20:00Z" } },
    { id: "w6", summary: "re-assign to the SAME technician (idempotent no-op)", op: { kind: "wo.assign", itemId: "wo_shift-0001", assignmentId: "asg_shift-0001-a2", assigneeId: "tech-ada", assignedAt: "2026-10-14T06:25:00Z" } },
    { id: "w7", summary: "try blocking without a reason (must refuse — the reason law)", expectRefusal: true, op: { kind: "wo.transition", itemId: "wo_shift-0001", command: "block", emittedAt: "2026-10-14T06:30:00Z" } },
    { id: "w8", summary: "block with the honest reason (parts on backorder)", op: { kind: "wo.transition", itemId: "wo_shift-0001", command: "block", reason: "brake pads on backorder until 16:00", emittedAt: "2026-10-14T06:35:00Z" } },
    { id: "w9", summary: "unblock once the parts arrive", op: { kind: "wo.transition", itemId: "wo_shift-0001", command: "unblock", emittedAt: "2026-10-14T16:05:00Z" } },
    { id: "w10", summary: "reassign to the afternoon technician (SUPERSESSION: the morning record closes)", op: { kind: "wo.reassign", itemId: "wo_shift-0001", assignmentId: "asg_shift-0001-c", assigneeId: "tech-ben", reassignedAt: "2026-10-14T16:10:00Z" } },
    { id: "w11", summary: "reassign to the same afternoon technician again (idempotent no-op)", op: { kind: "wo.reassign", itemId: "wo_shift-0001", assignmentId: "asg_shift-0001-d", assigneeId: "tech-ben", reassignedAt: "2026-10-14T16:15:00Z" } },
    { id: "w12", summary: "complete the work order (the live assignment closes with work_completed)", op: { kind: "wo.transition", itemId: "wo_shift-0001", command: "complete", emittedAt: "2026-10-14T17:45:00Z" } },
    { id: "w13", summary: "try completing again (must refuse — done is terminal)", expectRefusal: true, op: { kind: "wo.transition", itemId: "wo_shift-0001", command: "complete", emittedAt: "2026-10-14T17:50:00Z" } },
    { id: "w14", summary: "recompute the completion event's digest from its inputs (law A19 replay)", op: { kind: "wo.progress-digest", kindOf: "work.completed", itemId: "wo_shift-0001", emittedAt: "2026-10-14T17:45:00Z", fromStatus: "in_progress", toStatus: "done" } },
  ],
  assertions: [
    { id: "s1", description: "a fresh work order opens in todo with no assignee", reading: "w1.wo.status", op: "deep-equals", expected: "todo" },
    { id: "s2", description: "a fresh work order has an empty assignment history", reading: "w1.wo.historyCount", op: "deep-equals", expected: 0 },
    { id: "s3", description: "start moves the order to in_progress and emits the REAL started event", reading: "w2.wo.progressKind", op: "deep-equals", expected: "work.started" },
    { id: "s4", description: "completion without an assignee refuses with the REAL reason", reading: "w3.wo.reasonCode", op: "deep-equals", expected: "ASSIGNEE_REQUIRED_FOR_COMPLETION" },
    { id: "s5", description: "the refused completion left the order in progress", reading: "w3.wo.status", op: "deep-equals", expected: "in_progress" },
    { id: "s6", description: "the first assignment lands the technician as the live assignee", reading: "w4.wo.assignee", op: "deep-equals", expected: "tech-ada" },
    { id: "s7", description: "a second live owner refuses with the REAL reason (one live assignee)", reading: "w5.wo.reasonCode", op: "deep-equals", expected: "ALREADY_ASSIGNED" },
    { id: "s8", description: "re-assigning the SAME owner is an idempotent no-op (history unchanged)", reading: "w6.wo.historyCount", op: "deep-equals", expected: 1 },
    { id: "s9", description: "the idempotent no-op superseded nothing", reading: "w6.wo.supersededRecordId", op: "is-null" },
    { id: "s10", description: "blocking without a reason refuses with the REAL reason", reading: "w7.wo.reasonCode", op: "deep-equals", expected: "BLOCK_REASON_REQUIRED" },
    { id: "s11", description: "blocking with a reason records the blocked status", reading: "w8.wo.status", op: "deep-equals", expected: "blocked" },
    { id: "s12", description: "the blocked reason is carried verbatim", reading: "w8.wo.blockedReason", op: "deep-equals", expected: "brake pads on backorder until 16:00" },
    { id: "s13", description: "blocking emits the REAL blocked event", reading: "w8.wo.progressKind", op: "deep-equals", expected: "work.blocked" },
    { id: "s14", description: "unblocking clears the reason and returns to in_progress", reading: "w9.wo.status", op: "deep-equals", expected: "in_progress" },
    { id: "s15", description: "the supersession keeps ONE live record and appends the new one (history 2)", reading: "w10.wo.historyCount", op: "deep-equals", expected: 2 },
    { id: "s16", description: "the supersession closed the morning record by its id", reading: "w10.wo.supersededRecordId", op: "deep-equals", expected: "asg_shift-0001-a" },
    { id: "s17", description: "the closed record carries the REAL reassigned close reason", reading: "w10.wo.supersededCloseReason", op: "deep-equals", expected: "reassigned" },
    { id: "s18", description: "the live record after supersession is the afternoon assignment", reading: "w10.wo.liveRecordId", op: "deep-equals", expected: "asg_shift-0001-c" },
    { id: "s19", description: "the same-owner reassignment is an idempotent no-op (history stays 2, nothing superseded)", reading: "w11.wo.supersededRecordId", op: "is-null" },
    { id: "s20", description: "completion closes the live assignment and moves the order to done", reading: "w12.wo.status", op: "deep-equals", expected: "done" },
    { id: "s21", description: "the completed order has no live assignee (it closed with work_completed)", reading: "w12.wo.assignee", op: "is-null" },
    { id: "s22", description: "completion emits the REAL completed event", reading: "w12.wo.progressKind", op: "deep-equals", expected: "work.completed" },
    { id: "s23", description: "a second completion refuses — done is terminal", reading: "w13.wo.reasonCode", op: "deep-equals", expected: "ILLEGAL_TRANSITION" },
    { id: "s24", description: "the recomputed digest equals the emitted event's digest (byte-identical replay, law A19)", reading: "w14.wo.recomputedDigest", op: "reading-equals", expected: "w12.wo.progressDigest" },
    { id: "s25", description: "the shift emitted exactly the declared progress events (started, blocked, unblocked, completed)", reading: "w12.wo.progressCount", op: "deep-equals", expected: 6 },
  ],
};
