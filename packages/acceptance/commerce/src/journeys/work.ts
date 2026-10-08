/**
 * @fleetos/acceptance-commerce — work/project/workload journeys.
 *
 * Journeys 1-4 of the corpus: create work, approve + execute with budget
 * actuals + breach severity, the stage-gated project, and workload
 * allocation. Every assertion targets a fact extracted from the REAL
 * package outputs by the step drivers.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { CLOCK } from "../journey-world.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

export const createWorkOrderJourney: AcceptanceJourney = {
  id: "create-work-order",
  persona: "operations-manager",
  capability: "create-work",
  goal: "Create a work order and see it on the work board in the right stage.",
  steps: [
    { stepId: "s1", kind: "work-create", itemId: "wo-1", title: "Rotate depot batteries", projectId: null, deadline: CLOCK.later },
    { stepId: "s2", kind: "work-board", computedAt: CLOCK.now },
  ],
  assertions: [
    eq("a1", "work.create.wo-1.status", "todo", "the created work order starts in todo"),
    eq("a2", "workBoard.ok", true, "the REAL work board view builds"),
    eq("a3", "workBoard.todoCount", 1, "the board shows the card in the todo column"),
    eq("a4", "workBoard.firstTodoId", "wo-1", "the card carries the work item id"),
    eq("a5", "workBoard.doneCount", 0, "nothing is done yet"),
    eq("a6", "workBoard.firstTodoAssignee", null, "the card has no assignee yet"),
  ],
};

export const approveExecuteJourney: AcceptanceJourney = {
  id: "approve-execute-work-order",
  persona: "operations-manager",
  capability: "approve-execute-work",
  goal: "Assign, start and complete a work order while budget actuals move the project from warning to breach severity.",
  steps: [
    { stepId: "s1", kind: "work-create", itemId: "wo-2", title: "Replace inverter bank", projectId: "proj-9", deadline: CLOCK.later },
    { stepId: "s2", kind: "work-assign", itemId: "wo-2", assignmentId: "asg-1", assigneeId: "agent-7" },
    { stepId: "s3", kind: "work-transition", itemId: "wo-2", command: "start" },
    { stepId: "s4", kind: "ledger-post", entryKind: "actual", amountMinorUnits: 950_000, note: "inverter procurement" },
    { stepId: "s5", kind: "budget-position" },
    { stepId: "s6", kind: "ledger-post", entryKind: "actual", amountMinorUnits: 250_000, note: "installation labor" },
    { stepId: "s7", kind: "budget-position" },
    { stepId: "s8", kind: "work-transition", itemId: "wo-2", command: "complete" },
    { stepId: "s9", kind: "work-board", computedAt: CLOCK.now },
  ],
  assertions: [
    eq("a1", "work.assign.ok", true, "assignment through the REAL directory succeeds"),
    eq("a2", "work.assign.assigneeId", "agent-7", "the assignee is agent-7"),
    eq("a3", "work.assign.auditEvents", 1, "assignment emits exactly one audit event"),
    eq("a4", "work.assign.progressEvents", 1, "assignment emits exactly one progress event"),
    deq("a5", "budget.severityLog", ["warning:950000", "breach:1200000"], "severity moves warning (95%) then breach (120%)"),
    eq("a6", "budget.severity", "breach", "the final position breaches the envelope"),
    eq("a7", "budget.spentMinorUnits", 1_200_000, "actuals sum to 1,200,000 minor units"),
    eq("a8", "budget.utilizationBps", 12_000, "utilization is 12000 bps (120%)"),
    eq("a9", "budget.breachAmountMinorUnits", 200_000, "the breach overshoot is exactly 200,000"),
    eq("a10", "budget.remainingMinorUnits", -200_000, "remaining goes negative, never clamped"),
    eq("a11", "ledger.post.chainOk", true, "the actuals ledger chain verifies"),
    eq("a12", "ledger.post.entryCount", 2, "two actuals entries are posted"),
    deq("a13", "work.transition.log", ["true:in_progress", "true:done"], "the transitions move in_progress then done"),
    eq("a14", "work.transition.auditEvents", 1, "each transition emits exactly one audit event"),
    eq("a15", "workBoard.doneCount", 1, "the board shows the card in done"),
    eq("a16", "workBoard.inProgressCount", 0, "no card remains in progress"),
  ],
};

export const stageGatedProjectJourney: AcceptanceJourney = {
  id: "stage-gated-project",
  persona: "project-manager",
  capability: "stage-gated-projects",
  goal: "Run a project through stage gates: mandatory checkpoints block close, milestones gate on terminal work items, budget rolls up.",
  steps: [
    { stepId: "s1", kind: "project-create", projectId: "proj-1", name: "Depot Expansion" },
    { stepId: "s2", kind: "work-create", itemId: "wo-3", title: "Prepare site", projectId: "proj-1", deadline: null },
    { stepId: "s3", kind: "work-assign", itemId: "wo-3", assignmentId: "asg-2", assigneeId: "agent-4" },
    { stepId: "s4", kind: "milestone-create", milestoneId: "m-1", name: "Site prepared", workItemIds: ["wo-3"] },
    { stepId: "s5", kind: "stage-create", stageId: "st-1", name: "Preparation", checkpoints: [{ id: "cp-a", mandatory: true }, { id: "cp-b", mandatory: false }] },
    { stepId: "s6", kind: "stage-transition", stageId: "st-1", command: "start" },
    { stepId: "s7", kind: "stage-gate-view", computedAt: CLOCK.now },
    { stepId: "s8", kind: "stage-transition", stageId: "st-1", command: "close" },
    { stepId: "s9", kind: "stage-checkpoint", stageId: "st-1", checkpointId: "cp-a" },
    { stepId: "s10", kind: "stage-checkpoint", stageId: "st-1", checkpointId: "cp-a" },
    { stepId: "s11", kind: "ledger-post", entryKind: "commitment", amountMinorUnits: 400_000, note: "site commitment" },
    { stepId: "s12", kind: "budget-position" },
    { stepId: "s13", kind: "work-transition", itemId: "wo-3", command: "start" },
    { stepId: "s14", kind: "milestone-gate" },
    { stepId: "s15", kind: "work-transition", itemId: "wo-3", command: "complete" },
    { stepId: "s16", kind: "milestone-gate" },
    { stepId: "s17", kind: "stage-transition", stageId: "st-1", command: "close" },
    { stepId: "s18", kind: "stage-gate-view", computedAt: CLOCK.now },
  ],
  assertions: [
    eq("a1", "project.ok", true, "the project activates through the REAL lifecycle"),
    eq("a2", "project.status", "active", "the project status is active"),
    deq("a3", "stage.transition.log", ["true:in_progress", "false:OPEN_MANDATORY_CHECKPOINTS", "true:closed"], "the stage starts, refuses close with an open mandatory checkpoint, then closes"),
    eq("a5", "stage.checkpoint.reasonCode", "CHECKPOINT_ALREADY_COMPLETE", "double-completing a checkpoint is refused"),
    eq("a6", "budget.severity", "none", "the 400,000 commitment stays below the warning threshold"),
    eq("a7", "budget.spentMinorUnits", 400_000, "the commitment rolls into the budget position"),
    deq("a8", "milestone.gate.log", ["false:WORK_ITEMS_NOT_TERMINAL", "true:-"], "the milestone gate refuses while the work item is live, then achieves"),
    deq("a9", "stageGate.log", ["st-1:close-mandatory-checkpoints", "-:-"], "the gate view reports what unlocks the frontier, then no frontier"),
    eq("a10", "stageGate.frontierStageId", null, "with every stage closed there is no frontier"),
    eq("a11", "stageGate.milestone.m-1.achieved", true, "the milestone gate is achieved once the work item is done"),
    eq("a12", "stageGate.milestone.m-1.reasonCode", null, "no blocking reason remains"),
  ],
};

export const workloadAllocationJourney: AcceptanceJourney = {
  id: "workload-allocation",
  persona: "operations-manager",
  capability: "workload-allocation",
  goal: "Allocate a workload with capacity invariants, idempotent re-apply, scheduling-window overlap detection and the rollup view.",
  steps: [
    { stepId: "s1", kind: "workload-apply", demandKey: "wd-1", units: 6, owner: "crew-a" },
    { stepId: "s2", kind: "workload-apply", demandKey: "wd-1", units: 6, owner: "crew-a" },
    { stepId: "s3", kind: "workload-apply", demandKey: "wd-2", units: 6, owner: "crew-a" },
    { stepId: "s4", kind: "workload-apply", demandKey: "wd-2", units: 4, owner: "crew-a" },
    { stepId: "s5", kind: "workload-lifecycle", recordId: "alloc-1", command: "commit" },
    { stepId: "s6", kind: "workload-lifecycle", recordId: "alloc-1", command: "activate" },
    { stepId: "s7", kind: "workload-window-check", windows: [
      { id: "w-1", start: 100, end: 200 },
      { id: "w-2", start: 150, end: 250 },
      { id: "w-3", start: 300, end: 250 },
      { id: "w-4", start: 250, end: 300 },
    ] },
    { stepId: "s8", kind: "workload-rollup-view", computedAt: CLOCK.now },
  ],
  assertions: [
    eq("a1", "wl.apply.ok", true, "the final demand application succeeds"),
    deq("a2", "wl.apply.log", ["true:false:null", "true:true:null", "false:EXCEEDS_CAPACITY:2", "true:false:null"], "apply → idempotent duplicate → over-capacity refusal → apply"),
    eq("a3", "wl.apply.allocatedUnits", 10, "the ledger ends at the full 10 units"),
    eq("a4", "wl.lifecycle.status", "active", "the allocation lifecycle reaches active"),
    eq("a5", "wl.lifecycle.reservedUnits", 4, "committing reserved exactly the record's 4 units"),
    eq("a6", "wl.window.invalidCount", 1, "the inverted window is invalid"),
    eq("a7", "wl.window.overlapCount", 1, "exactly one overlap pair is detected"),
    eq("a8", "wl.window.overlapPairs", ["w-1&w-2"], "the overlap pair is reported lexically"),
    eq("a9", "wl.window.tieBreakRule", "window-id-lexical", "the overlap carries the deterministic tie-break rule"),
    eq("a10", "wlRollup.ok", true, "the REAL workload rollup view builds"),
    eq("a11", "wlRollup.usedUnits", 10, "the rollup shows 10 used units"),
    eq("a12", "wlRollup.utilizationBps", 10_000, "utilization is 10000 bps at full capacity"),
    eq("a13", "wlRollup.remainingUnits", 0, "zero units remain"),
    eq("a14", "wlRollup.overAllocated", false, "the capacity invariant held — never over-allocated"),
  ],
};

export const WORK_JOURNEYS: readonly AcceptanceJourney[] = [
  createWorkOrderJourney,
  approveExecuteJourney,
  stageGatedProjectJourney,
  workloadAllocationJourney,
];
