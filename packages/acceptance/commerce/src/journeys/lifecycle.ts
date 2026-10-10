/**
 * @fleetos/acceptance-commerce — lifecycle journeys (F310C, Wave 11 lane C).
 *
 * Four genuinely distinct journeys over REAL public APIs:
 *   1. assignment-supersession — the work directory's supersession
 *      discipline (append-only history, supersededBy refs, idempotent
 *      no-ops, assignee removal, the integrity invariant).
 *   2. deadline-escalation — the pure deadline surface (scheduled /
 *      approaching / breached / none, exact millis, escalation records,
 *      met-on-completion).
 *   3. workload-release-rebalance — reservation restoration on release,
 *      and deterministic rebalance PROPOSALS (never mutations).
 *   4. project-completion-portfolio — the ProjectDirectory completion gate
 *      (honest blocking-item refusals with audit events, hold/resume with
 *      the reason law, milestone verification, the portfolio read model).
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { CLOCK } from "../journey-world.js";

const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

export const assignmentSupersessionJourney: AcceptanceJourney = {
  id: "assignment-supersession",
  persona: "operations-manager",
  capability: "work-assignment-management",
  goal: "Reassign a live work order through SUPERSESSION (append-only history, supersededBy ref), remove an assignee honestly, and hold the one-live-assignment integrity invariant at every state.",
  steps: [
    { stepId: "s1", kind: "work-create", itemId: "wo-sup", title: "Relocate charger bank", projectId: null, deadline: CLOCK.later },
    { stepId: "s2", kind: "work-assign", itemId: "wo-sup", assignmentId: "asg-1", assigneeId: "agent-7", factKey: "first" },
    { stepId: "s3", kind: "work-reassign", factKey: "sup", itemId: "wo-sup", newAssignmentId: "asg-2", newAssigneeId: "agent-9" },
    { stepId: "s4", kind: "work-reassign", factKey: "noop", itemId: "wo-sup", newAssignmentId: "asg-3", newAssigneeId: "agent-9" },
    { stepId: "s5", kind: "work-remove-assignee", factKey: "remove", itemId: "wo-sup" },
    { stepId: "s6", kind: "work-reassign", factKey: "nolive", itemId: "wo-sup", newAssignmentId: "asg-5", newAssigneeId: "agent-4" },
    { stepId: "s7", kind: "work-assign", itemId: "wo-sup", assignmentId: "asg-5", assigneeId: "agent-4", factKey: "reassign" },
    { stepId: "s8", kind: "work-create", itemId: "wo-sup-2", title: "Swap telemetry module", projectId: null, deadline: null },
    { stepId: "s9", kind: "work-assign", itemId: "wo-sup-2", assignmentId: "asg-b1", assigneeId: "agent-2", factKey: "second" },
    { stepId: "s10", kind: "work-assign", itemId: "wo-sup-2", assignmentId: "asg-b2", assigneeId: "agent-3", factKey: "occupied" },
    { stepId: "s11", kind: "work-integrity-holds", factKey: "final", itemId: "wo-sup" },
  ],
  assertions: [
    eq("a1", "work.assign.first.ok", true, "the first assignment through the REAL directory succeeds"),
    eq("a2", "work.assign.first.assigneeId", "agent-7", "the first live assignee is agent-7"),
    eq("a3", "work.reassign.sup.ok", true, "supersession through the REAL directory succeeds"),
    eq("a4", "work.reassign.sup.assigneeId", "agent-9", "the live assignee is now agent-9"),
    eq("a5", "work.reassign.sup.historyLength", 2, "the supersession APPENDS a record (history length 2)"),
    eq("a6", "work.reassign.sup.supersededCloseReason", "reassigned", "the old record closes with closeReason reassigned"),
    eq("a7", "work.reassign.sup.supersededBy", "asg-2", "the old record carries the supersededBy ref"),
    eq("a8", "work.reassign.sup.liveAssignmentId", "asg-2", "exactly one live record remains: asg-2"),
    eq("a9", "work.reassign.sup.integrityHolds", true, "the integrity invariant holds after supersession"),
    eq("a10", "work.reassign.sup.auditEvents", 1, "supersession emits exactly one audit event"),
    eq("a11", "work.reassign.noop.idempotentNoOp", true, "re-assigning to the SAME assignee is an idempotent no-op"),
    eq("a12", "work.reassign.noop.historyLength", 2, "the no-op appends nothing (history stays 2)"),
    eq("a13", "work.reassign.noop.liveAssignmentId", "asg-2", "the live record is unchanged by the no-op"),
    eq("a14", "work.remove.remove.ok", true, "assignee removal through the REAL lifecycle succeeds"),
    eq("a15", "work.remove.remove.closedRecordId", "asg-2", "the live record asg-2 is the one closed"),
    eq("a16", "work.remove.remove.closeReason", "assignee_removed", "the close reason is recorded verbatim"),
    eq("a17", "work.remove.remove.assigneeNull", true, "the work item has no live assignee after removal"),
    eq("a18", "work.remove.remove.integrityHolds", true, "zero live records + null assignee holds the invariant"),
    eq("a19", "work.reassign.nolive.ok", false, "supersession with NO live assignee refuses (use assign)"),
    eq("a20", "work.reassign.nolive.reasonCode", "ALREADY_ASSIGNED", "the refusal carries the domain reason code"),
    eq("a21", "work.assign.reassign.ok", true, "a first assignment after removal succeeds (assign, not supersession)"),
    eq("a22", "work.assign.occupied.ok", false, "assigning over a LIVE assignee refuses on the second item"),
    eq("a23", "work.assign.occupied.reasonCode", "ALREADY_ASSIGNED", "first-assignment refuses with ALREADY_ASSIGNED when live"),
    eq("a24", "work.integrity.final.holds", true, "the final state (3 records, 1 live) holds the invariant"),
    eq("a25", "work.integrity.final.historyLength", 3, "the history is append-only: asg-1, asg-2, asg-5"),
    eq("a26", "work.integrity.final.liveRecordCount", 1, "exactly one live assignment record"),
    eq("a27", "work.integrity.final.liveAssigneeMatches", true, "the live record's assignee matches the item's assignee"),
  ],
};

export const deadlineEscalationJourney: AcceptanceJourney = {
  id: "deadline-escalation",
  persona: "operations-manager",
  capability: "work-deadlines",
  goal: "Work-order deadlines evaluate honestly — scheduled, approaching (inside the window), breached (exact negative millis), none — escalate with machine-stable kinds, and mark met on completion.",
  steps: [
    { stepId: "s1", kind: "work-create", itemId: "wo-dl-1", title: "Pre-winter inspection", projectId: null, deadline: "2026-10-06T00:00:00Z" },
    { stepId: "s2", kind: "work-create", itemId: "wo-dl-2", title: "Quarterly recalibration", projectId: null, deadline: "2026-10-05T06:00:00Z" },
    { stepId: "s3", kind: "work-create", itemId: "wo-dl-3", title: "Spill containment check", projectId: null, deadline: "2026-10-04T00:00:00Z" },
    { stepId: "s4", kind: "work-create", itemId: "wo-dl-4", title: "Standing review", projectId: null, deadline: null },
    { stepId: "s5", kind: "work-deadline", factKey: "approaching", itemId: "wo-dl-1", mode: "evaluate", now: CLOCK.now, approachingWindowMillis: 172_800_000 },
    { stepId: "s6", kind: "work-deadline", factKey: "scheduled", itemId: "wo-dl-2", mode: "evaluate", now: CLOCK.now, approachingWindowMillis: 3_600_000 },
    { stepId: "s7", kind: "work-deadline", factKey: "breached", itemId: "wo-dl-3", mode: "evaluate", now: CLOCK.now, approachingWindowMillis: 3_600_000 },
    { stepId: "s8", kind: "work-deadline", factKey: "none", itemId: "wo-dl-4", mode: "evaluate", now: CLOCK.now, approachingWindowMillis: 3_600_000 },
    { stepId: "s9", kind: "work-assign", itemId: "wo-dl-3", assignmentId: "asg-dl", assigneeId: "agent-5" },
    { stepId: "s10", kind: "work-transition", itemId: "wo-dl-3", command: "start" },
    { stepId: "s11", kind: "work-transition", itemId: "wo-dl-3", command: "complete" },
    { stepId: "s12", kind: "work-deadline", factKey: "met", itemId: "wo-dl-3", mode: "met", now: CLOCK.now, approachingWindowMillis: 3_600_000 },
  ],
  assertions: [
    eq("a1", "work.deadline.approaching.status", "approaching", "a deadline inside the window is approaching"),
    eq("a2", "work.deadline.approaching.millisUntilDeadline", 86_400_000, "the exact millis until the deadline (1 day)"),
    eq("a3", "work.deadline.approaching.approaching", true, "the approaching flag is set"),
    eq("a4", "work.deadline.approaching.breached", false, "the breached flag is not set"),
    eq("a5", "work.deadline.approaching.escalationKind", "deadline.approaching", "an approaching deadline escalates"),
    eq("a6", "work.deadline.approaching.escalationWorkItemId", "wo-dl-1", "the escalation names the work item"),
    eq("a7", "work.deadline.approaching.escalationObservedAt", CLOCK.now, "the escalation carries the observation time verbatim"),
    eq("a8", "work.deadline.scheduled.status", "scheduled", "a deadline outside the window stays scheduled"),
    eq("a9", "work.deadline.scheduled.escalationKind", null, "a scheduled deadline escalates nothing"),
    eq("a10", "work.deadline.breached.status", "breached", "a past deadline is breached"),
    eq("a11", "work.deadline.breached.millisUntilDeadline", -86_400_000, "breached millis are exact and negative (never clamped)"),
    eq("a12", "work.deadline.breached.escalationKind", "deadline.breached", "a breached deadline escalates with its kind"),
    eq("a13", "work.deadline.none.status", "none", "a work item without a deadline is honestly none"),
    eq("a14", "work.deadline.none.escalationKind", null, "no deadline means no escalation"),
    deq("a15", "work.transition.log", ["true:in_progress", "true:done"], "the breached work item starts then completes through the REAL directory"),
    eq("a16", "work.deadline.met.status", "met", "a completed work item's deadline marks met"),
    eq("a17", "work.deadline.met.escalation", null, "a met deadline never escalates"),
  ],
};

export const workloadReleaseRebalanceJourney: AcceptanceJourney = {
  id: "workload-release-rebalance",
  persona: "operations-manager",
  capability: "workload-allocation",
  goal: "Capacity reservations restore EXACTLY on release, the allocation lifecycle reaches its terminal state with the reason recorded, and over-allocation produces a deterministic rebalance PROPOSAL — never a mutation.",
  steps: [
    { stepId: "s1", kind: "workload-apply", demandKey: "demand-key-rb-1", units: 4, owner: "crew-a" },
    { stepId: "s2", kind: "workload-lifecycle", recordId: "alloc-1", command: "commit", factKey: "commit" },
    { stepId: "s3", kind: "workload-lifecycle", recordId: "alloc-1", command: "activate", factKey: "activate" },
    { stepId: "s4", kind: "workload-rebalance", factKey: "healthy", generatedAt: CLOCK.iso1, capacities: [{ owner: "crew-a", maxUnits: 10 }, { owner: "crew-b", maxUnits: 10 }], allocations: [{ owner: "crew-a", allocatedUnits: 4 }, { owner: "crew-b", allocatedUnits: 2 }] },
    { stepId: "s5", kind: "workload-lifecycle", recordId: "alloc-1", command: "release", reason: "seasonal demand withdrawn", factKey: "release" },
    { stepId: "s6", kind: "workload-rebalance", factKey: "over", generatedAt: CLOCK.iso1, capacities: [{ owner: "crew-a", maxUnits: 10 }, { owner: "crew-b", maxUnits: 10 }], allocations: [{ owner: "crew-a", allocatedUnits: 12 }, { owner: "crew-b", allocatedUnits: 2 }] },
    { stepId: "s7", kind: "workload-rebalance", factKey: "noheadroom", generatedAt: CLOCK.iso1, capacities: [{ owner: "crew-a", maxUnits: 10 }, { owner: "crew-b", maxUnits: 10 }], allocations: [{ owner: "crew-a", allocatedUnits: 12 }, { owner: "crew-b", allocatedUnits: 10 }] },
    { stepId: "s8", kind: "workload-rebalance", factKey: "multihop", generatedAt: CLOCK.iso1, capacities: [{ owner: "crew-a", maxUnits: 10 }, { owner: "crew-b", maxUnits: 10 }, { owner: "crew-c", maxUnits: 10 }], allocations: [{ owner: "crew-a", allocatedUnits: 15 }, { owner: "crew-b", allocatedUnits: 7 }, { owner: "crew-c", allocatedUnits: 6 }] },
  ],
  assertions: [
    eq("a1", "wl.apply.ok", true, "the demand application succeeds"),
    eq("a2", "wl.lifecycle.commit.status", "committed", "committing the allocation reserves units"),
    eq("a3", "wl.lifecycle.commit.reservedUnits", 4, "the ledger reserves exactly the record's 4 units"),
    eq("a3b", "wl.lifecycle.activate.status", "active", "activation is reservation-neutral"),
    eq("a3c", "wl.lifecycle.activate.reservedUnits", 4, "activation does not double-count the reservation"),
    eq("a4", "wl.rebalance.healthy.kind", "rebalance-proposal", "the rebalancer emits a proposal record"),
    eq("a5", "wl.rebalance.healthy.reasonCode", "NO_OVER_ALLOCATED_OWNERS", "healthy capacity proposes zero moves with the honest reason"),
    eq("a6", "wl.rebalance.healthy.moveCount", 0, "no moves when nobody is over-allocated"),
    eq("a7", "wl.lifecycle.release.status", "released", "release reaches the terminal released state"),
    eq("a8", "wl.lifecycle.release.reservedUnits", 0, "the reservation restores EXACTLY (4 -> 0, never partial)"),
    eq("a9", "wl.lifecycle.release.terminalReason", "seasonal demand withdrawn", "the release reason is recorded verbatim on the record"),
    eq("a10", "wl.rebalance.over.moveCount", 1, "an over-allocated owner produces exactly one move here"),
    deq("a11", "wl.rebalance.over.moves", ["crew-a->crew-b:2"], "the move relieves the exact 2-unit overshoot to the headroom owner"),
    eq("a12", "wl.rebalance.over.reasonCode", null, "a real move leaves the reason null"),
    eq("a13", "wl.rebalance.over.inputsUnmutated", true, "the proposal NEVER mutates the input allocations"),
    eq("a14", "wl.rebalance.noheadroom.reasonCode", "INSUFFICIENT_HEADROOM", "over-allocated with zero headroom refuses honestly"),
    eq("a15", "wl.rebalance.noheadroom.moveCount", 0, "no moves are invented without headroom"),
    eq("a16", "wl.rebalance.multihop.moveCount", 2, "a 5-unit overshoot over two headroom owners is two moves"),
    deq("a17", "wl.rebalance.multihop.moves", ["crew-a->crew-c:4", "crew-a->crew-b:1"], "moves follow descending-headroom order (c:4 then b:1)"),
    eq("a18", "wl.rebalance.multihop.firstRationale", "move 4 units from over-allocated crew-a (overshoot 5) to crew-c (headroom 4)", "the rationale records the exact arithmetic"),
    eq("a19", "wl.rebalance.multihop.inputsUnmutated", true, "multi-hop proposals leave inputs untouched too"),
  ],
};

export const projectCompletionPortfolioJourney: AcceptanceJourney = {
  id: "project-completion-portfolio",
  persona: "project-manager",
  capability: "stage-gated-projects",
  goal: "The project DIRECTORY gates completion on achieved milestones — non-terminal work blocks with named items and audited refusals, hold/resume honors the reason law, and the portfolio read model rolls up achievement honestly.",
  steps: [
    { stepId: "s1", kind: "project-directory-seed", projects: [
      { projectId: "proj-dir-1", name: "Depot Automation Rollout", milestones: [{ milestoneId: "ms-site", name: "Site readiness", workItemIds: ["wo-p1", "wo-p2"] }] },
      { projectId: "proj-dir-2", name: "Yard Expansion", milestones: [{ milestoneId: "ms-yard", name: "Groundwork done", workItemIds: ["wo-p3"] }] },
    ] },
    { stepId: "s2", kind: "project-directory-transition", factKey: "activate", projectId: "proj-dir-1", command: "activate" },
    { stepId: "s3", kind: "project-directory-transition", factKey: "hold-noreason", projectId: "proj-dir-1", command: "hold" },
    { stepId: "s4", kind: "project-directory-transition", factKey: "hold", projectId: "proj-dir-1", command: "hold", reason: "permit pending" },
    { stepId: "s5", kind: "project-directory-transition", factKey: "resume", projectId: "proj-dir-1", command: "resume" },
    { stepId: "s6", kind: "work-create", itemId: "wo-p1", title: "Install conveyor sensors", projectId: "proj-dir-1", deadline: CLOCK.later },
    { stepId: "s7", kind: "project-complete", factKey: "early", projectId: "proj-dir-1", realWorkItems: true },
    { stepId: "s8", kind: "project-milestone-verify", factKey: "blocked", milestoneId: "ms-site", realWorkItems: true },
    { stepId: "s9", kind: "work-assign", itemId: "wo-p1", assignmentId: "asg-p1", assigneeId: "agent-7" },
    { stepId: "s10", kind: "work-transition", itemId: "wo-p1", command: "start" },
    { stepId: "s11", kind: "work-transition", itemId: "wo-p1", command: "complete" },
    { stepId: "s12", kind: "work-create", itemId: "wo-p2", title: "Commission gate controller", projectId: "proj-dir-1", deadline: CLOCK.later },
    { stepId: "s13", kind: "work-assign", itemId: "wo-p2", assignmentId: "asg-p2", assigneeId: "agent-8" },
    { stepId: "s14", kind: "work-transition", itemId: "wo-p2", command: "start" },
    { stepId: "s15", kind: "work-transition", itemId: "wo-p2", command: "complete" },
    { stepId: "s16", kind: "project-milestone-verify", factKey: "achieve", milestoneId: "ms-site", realWorkItems: true },
    { stepId: "s17", kind: "project-directory-transition", factKey: "activate2", projectId: "proj-dir-2", command: "activate" },
    { stepId: "s18", kind: "project-complete", factKey: "final", projectId: "proj-dir-1", realWorkItems: true },
    { stepId: "s19", kind: "project-portfolio" },
  ],
  assertions: [
    eq("a1", "projectDirectory.seed.projects", 2, "two projects seeded through the REAL repository"),
    eq("a2", "projectDirectory.seed.milestones", 2, "two milestones seeded"),
    eq("a3", "projectDirectory.transition.activate.ok", true, "draft -> active through the REAL directory"),
    eq("a4", "projectDirectory.transition.activate.status", "active", "the project is active"),
    eq("a5", "projectDirectory.transition.hold-noreason.ok", false, "hold without a reason refuses"),
    eq("a6", "projectDirectory.transition.hold-noreason.reasonCode", "HOLD_REASON_REQUIRED", "the hold reason law carries its reason code"),
    eq("a7", "projectDirectory.transition.hold.ok", true, "hold with a reason succeeds"),
    eq("a8", "projectDirectory.transition.hold.status", "on_hold", "the project is on hold"),
    eq("a9", "projectDirectory.transition.resume.status", "active", "resume returns the project to active"),
    eq("a10", "projectDirectory.complete.early.ok", false, "completion with open work REFUSES (gate enforcement)"),
    eq("a11", "projectDirectory.complete.early.reasonCode", "MILESTONES_NOT_ACHIEVED", "the refusal carries the gate's reason code"),
    eq("a12", "projectDirectory.complete.early.blockingCount", 2, "both milestone work items block (one todo, one unknown)"),
    eq("a13", "projectDirectory.complete.early.auditEvents", 1, "the refusal is AUDITED (law A19 — refusals too)"),
    eq("a14", "projectDirectory.verify.blocked.ok", false, "milestone verification refuses while work is open"),
    eq("a15", "projectDirectory.verify.blocked.reasonCode", "WORK_ITEMS_NOT_TERMINAL", "the verify refusal names the law"),
    deq("a16", "projectDirectory.verify.blocked.blockingItems", ["wo-p1:todo:WORK_ITEM_NOT_TERMINAL", "wo-p2:unknown:WORK_ITEM_UNKNOWN"], "each blocking item is named with its status and reason"),
    eq("a17", "projectDirectory.verify.blocked.auditEvents", 1, "the blocked verification is audited"),
    deq("a18", "work.transition.log", ["true:in_progress", "true:done", "true:in_progress", "true:done"], "both work items start then complete through the REAL directory"),
    eq("a19", "projectDirectory.verify.achieve.ok", true, "verification passes once every work item is terminal"),
    eq("a20", "projectDirectory.verify.achieve.status", "achieved", "the milestone is persisted achieved"),
    eq("a21", "projectDirectory.verify.achieve.auditEvents", 1, "achievement is audited"),
    eq("a22", "projectDirectory.transition.activate2.status", "active", "the second project activates independently"),
    eq("a23", "projectDirectory.complete.final.ok", true, "completion passes once the milestone is achieved"),
    eq("a24", "projectDirectory.complete.final.status", "completed", "the project is completed"),
    eq("a25", "projectDirectory.portfolio.totalProjects", 2, "the portfolio read model sees both projects"),
    eq("a26", "projectDirectory.portfolio.completedProjects", 1, "exactly one project is completed"),
    eq("a27", "projectDirectory.portfolio.activeProjects", 1, "exactly one project remains active"),
    eq("a28", "projectDirectory.portfolio.totalMilestones", 2, "both milestones are in the rollup"),
    eq("a29", "projectDirectory.portfolio.achievedMilestones", 1, "exactly one milestone is achieved"),
    deq("a30", "projectDirectory.portfolio.entryIds", ["proj-dir-1", "proj-dir-2"], "entries are ordered by project id (lexical)"),
    eq("a31", "projectDirectory.portfolio.firstEntryStatus", "completed", "the first entry is the completed project"),
    eq("a32", "projectDirectory.portfolio.firstEntryAchieved", 1, "its achieved-milestone count is exact"),
  ],
};

export const LIFECYCLE_JOURNEYS: readonly AcceptanceJourney[] = [
  assignmentSupersessionJourney,
  deadlineEscalationJourney,
  workloadReleaseRebalanceJourney,
  projectCompletionPortfolioJourney,
];
