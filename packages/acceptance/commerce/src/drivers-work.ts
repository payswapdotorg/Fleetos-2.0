/**
 * @fleetos/acceptance-commerce — work/project/workload step drivers.
 *
 * Each driver interprets ONE typed journey step against the REAL public
 * entry points of @fleetos/work, @fleetos/projects, @fleetos/workloads and
 * @fleetos/experience-work-commerce, and returns named FACTS extracted
 * verbatim from the REAL outputs. A domain refusal is recorded honestly
 * as facts (`ok: false` + the domain's reason code) — never swallowed.
 */

import type { FactValue, WorkStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, logPush } from "./journey-world.js";
import type { WorkItem, WorkItemTransitionCommand } from "@fleetos/work";
import { buildWorkBoard, buildProjectStageGateView, buildWorkloadRollup } from "@fleetos/experience-work-commerce";
import type { Project, ProjectStage, Milestone } from "@fleetos/projects";
import {
  completeStageCheckpoint,
  transitionStage,
  checkMilestoneGate,
  postLedgerEntry,
  computeBudgetPosition,
  verifyLedgerChain,
  transitionProject,
} from "@fleetos/projects";
import {
  applyDemandIdempotent,
  applyLifecycleToLedger,
  detectWindowOverlaps,
  validateWindow,
} from "@fleetos/workloads";

export type DriverFacts = Record<string, FactValue>;

export async function runWorkStep(step: WorkStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "work-create": {
      const item: WorkItem = {
        id: { kind: "work-item", value: step.itemId },
        tenant: state.tenant,
        title: step.title,
        assignee: null,
        assignmentHistory: [],
        deadline: step.deadline,
        status: "todo",
        blockedReason: null,
        missionRef: null,
        workflowRef: null,
        projectId: step.projectId,
      };
      await state.work.repo.store(state.tenant, item);
      state.work.items.set(step.itemId, item);
      return { "work.create.ok": true, [`work.create.${step.itemId}.status`]: "todo" };
    }
    case "work-assign": {
      const result = await state.work.directory.assign(
        state.tenant,
        { kind: "work-item", value: step.itemId },
        step.assignmentId,
        step.assigneeId,
        CLOCK.iso0,
        { occurredAt: CLOCK.iso0 },
      );
      if (result.ok) state.work.items.set(step.itemId, result.workItem);
      return {
        "work.assign.ok": result.ok,
        "work.assign.assigneeId": result.ok ? (result.workItem.assignee?.assigneeId ?? null) : null,
        "work.assign.reasonCode": result.ok ? null : result.reasonCode,
        "work.assign.auditEvents": result.ok ? result.auditEvents.length : -1,
        "work.assign.progressEvents": result.ok ? result.progressEvents.length : -1,
      };
    }
    case "work-transition": {
      const command: WorkItemTransitionCommand =
        step.command === "block"
          ? { type: "block", reason: step.reason ?? "waiting on parts" }
          : step.command === "cancel"
            ? { type: "cancel", reason: step.reason ?? "no longer needed" }
            : { type: step.command };
      const result = await state.work.directory.transition(
        state.tenant,
        { kind: "work-item", value: step.itemId },
        command,
        { occurredAt: CLOCK.iso1 },
      );
      if (result.ok) state.work.items.set(step.itemId, result.workItem);
      logPush(state, "work.transition.log", `${result.ok}:${result.ok ? result.workItem.status : result.reasonCode}`);
      return {
        "work.transition.ok": result.ok,
        "work.transition.status": result.ok ? result.workItem.status : null,
        "work.transition.reasonCode": result.ok ? null : result.reasonCode,
        "work.transition.auditEvents": result.ok ? result.auditEvents.length : -1,
      };
    }
    case "work-board": {
      const items = await state.work.directory.list(state.tenant);
      const result = buildWorkBoard({
        tenant: state.tenant,
        workItems: items,
        redactAssignees: step.redactAssignees === true,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "workBoard.ok": false, "workBoard.reasonCode": result.reasonCode };
      const counts = new Map(result.board.totals.map((t) => [t.status, t.count] as const));
      const firstTodo = result.board.columns.find((c) => c.status === "todo")?.cards[0] ?? null;
      const allCards = result.board.columns.flatMap((c) => c.cards);
      const blockedReason = result.board.columns.find((c) => c.status === "blocked")?.cards[0]?.blockedReason ?? null;
      logPush(
        state,
        "workBoard.state.log",
        `todo:${counts.get("todo") ?? 0}:ip:${counts.get("in_progress") ?? 0}:blocked:${counts.get("blocked") ?? 0}:done:${counts.get("done") ?? 0}:sentinel:${allCards.some((c) => c.assigneeId === "[REDACTED]")}:reason:${blockedReason ?? "-"}`,
      );
      return {
        "workBoard.ok": true,
        "workBoard.todoCount": counts.get("todo") ?? 0,
        "workBoard.inProgressCount": counts.get("in_progress") ?? 0,
        "workBoard.blockedCount": counts.get("blocked") ?? 0,
        "workBoard.doneCount": counts.get("done") ?? 0,
        "workBoard.cancelledCount": counts.get("cancelled") ?? 0,
        "workBoard.firstTodoId": firstTodo?.workItemId ?? null,
        "workBoard.firstTodoAssignee": firstTodo?.assigneeId ?? null,
        "workBoard.blockedReason": blockedReason,
        "workBoard.assigneeRedacted": firstTodo?.assigneeId === "[REDACTED]",
        "workBoard.anyAssigneeSentinel": allCards.some((c) => c.assigneeId === "[REDACTED]"),
        "workBoard.redactedFields": step.redactAssignees === true ? result.board.redactedFields : [],
        "workBoard.digest": result.board.digest,
      };
    }
    case "project-create": {
      const draft: Project = {
        id: { kind: "project", value: step.projectId },
        tenant: state.tenant,
        name: step.name,
        status: "draft",
        milestoneIds: [],
      };
      const result = transitionProject(draft, { type: "activate" });
      if (result.ok) state.projectState.project = result.next;
      return { "project.ok": result.ok, "project.status": result.ok ? result.next.status : null };
    }
    case "stage-create": {
      const stage: ProjectStage = {
        id: step.stageId,
        tenant: state.tenant,
        projectId: state.projectState.project?.id.value ?? "proj-1",
        name: step.name,
        status: "planned",
        checkpoints: step.checkpoints.map((c) => ({ id: c.id, mandatory: c.mandatory, completedAt: null })),
        updatedAt: CLOCK.t0,
      };
      state.projectState.stages = [...state.projectState.stages, stage];
      return { "stage.create.ok": true, [`stage.create.${step.stageId}.status`]: "planned" };
    }
    case "stage-checkpoint": {
      const stage = state.projectState.stages.find((s) => s.id === step.stageId);
      if (stage === undefined) return { "stage.checkpoint.ok": false, "stage.checkpoint.reasonCode": "STAGE_NOT_FOUND" };
      const result = completeStageCheckpoint(stage, step.checkpointId, CLOCK.t1);
      if (result.ok) {
        state.projectState.stages = state.projectState.stages.map((s) => (s.id === step.stageId ? result.next : s));
      }
      return {
        "stage.checkpoint.ok": result.ok,
        "stage.checkpoint.reasonCode": result.ok ? null : result.reasonCode,
        [`stage.checkpoint.${step.checkpointId}.completed`]: result.ok,
      };
    }
    case "stage-transition": {
      const stage = state.projectState.stages.find((s) => s.id === step.stageId);
      if (stage === undefined) return { "stage.transition.ok": false, "stage.transition.reasonCode": "STAGE_NOT_FOUND" };
      const result = transitionStage(stage, { type: step.command }, CLOCK.t2);
      if (result.ok) {
        state.projectState.stages = state.projectState.stages.map((s) => (s.id === step.stageId ? result.next : s));
      }
      logPush(
        state,
        "stage.transition.log",
        `${result.ok}:${result.ok ? result.next.status : result.reasonCode}`,
      );
      return {
        "stage.transition.ok": result.ok,
        "stage.transition.status": result.ok ? result.next.status : null,
        "stage.transition.reasonCode": result.ok ? null : result.reasonCode,
        "stage.transition.openCheckpoints": result.ok ? [] : [...result.openCheckpointIds],
      };
    }
    case "stage-gate-view": {
      const items = await state.work.directory.list(state.tenant);
      const project = state.projectState.project;
      if (project === null) return { "stageGate.ok": false, "stageGate.reasonCode": "PROJECT_NOT_CREATED" };
      const result = buildProjectStageGateView({
        tenant: state.tenant,
        project,
        stages: state.projectState.stages,
        milestones: state.projectState.milestones,
        workItems: items,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "stageGate.ok": false, "stageGate.reasonCode": result.reasonCode };
      const facts: DriverFacts = {
        "stageGate.ok": true,
        "stageGate.frontierStageId": result.view.frontierStageId,
        "stageGate.nextUnlockRequires": result.view.nextUnlock?.requires ?? null,
        "stageGate.openMandatory": result.view.nextUnlock?.openMandatoryCheckpointIds ?? [],
        "stageGate.digest": result.view.digest,
      };
      logPush(
        state,
        "stageGate.log",
        `${result.view.frontierStageId ?? "-"}:${result.view.nextUnlock?.requires ?? "-"}`,
      );
      for (const entry of result.view.milestoneGates) {
        facts[`stageGate.milestone.${entry.milestoneId}.achieved`] = entry.achieved;
        facts[`stageGate.milestone.${entry.milestoneId}.reasonCode`] = entry.reasonCode ?? null;
        facts[`stageGate.milestone.${entry.milestoneId}.blockingCount`] = entry.blockingItems.length;
      }
      return facts;
    }
    case "milestone-create": {
      const milestone: Milestone = {
        id: { kind: "milestone", value: step.milestoneId },
        tenant: state.tenant,
        projectId: state.projectState.project?.id.value ?? "proj-1",
        name: step.name,
        status: "open",
        workItemIds: step.workItemIds,
      };
      state.projectState.milestones = [...state.projectState.milestones, milestone];
      return { "milestone.create.ok": true };
    }
    case "milestone-gate": {
      const milestone = state.projectState.milestones[0];
      if (milestone === undefined) return { "milestone.gate.ok": false, "milestone.gate.reasonCode": "MILESTONE_NOT_FOUND" };
      const items = await state.work.directory.list(state.tenant);
      const result = checkMilestoneGate(
        milestone,
        items.map((w) => ({ id: w.id.value, status: w.status })),
      );
      logPush(state, "milestone.gate.log", `${result.ok}:${result.ok ? "-" : result.reasonCode}`);
      return {
        "milestone.gate.ok": result.ok,
        "milestone.gate.reasonCode": result.ok ? null : result.reasonCode,
        "milestone.gate.blockingCount": result.ok ? 0 : result.blockingItems.length,
      };
    }
    case "ledger-post": {
      const result = postLedgerEntry(state.projectState.ledger, state.projectState.envelope, {
        kind: step.entryKind,
        amountMinorUnits: step.amountMinorUnits,
        recordedAt: CLOCK.t1,
        note: step.note,
      });
      if (result.ok) state.projectState.ledger = result.ledger;
      return {
        "ledger.post.ok": result.ok,
        "ledger.post.reasonCode": result.ok ? null : result.reasonCode,
        "ledger.post.seq": result.ok ? (result.ledger.entries[result.ledger.entries.length - 1]?.seq ?? 0) : -1,
        "ledger.post.entryCount": result.ok ? result.ledger.entries.length : -1,
        "ledger.post.chainOk": result.ok ? verifyLedgerChain(result.ledger).ok : false,
      };
    }
    case "budget-position": {
      const result = computeBudgetPosition(state.projectState.ledger, state.projectState.envelope);
      if (!result.ok) return { "budget.ok": false, "budget.reasonCode": result.reasonCode };
      logPush(
        state,
        "budget.severityLog",
        `${result.position.severity}:${result.position.spentMinorUnits}`,
      );
      return {
        "budget.ok": true,
        "budget.severity": result.position.severity,
        "budget.spentMinorUnits": result.position.spentMinorUnits,
        "budget.utilizationBps": result.position.utilizationBps,
        "budget.remainingMinorUnits": result.position.remainingMinorUnits,
        "budget.breachAmountMinorUnits": result.position.breachAmountMinorUnits,
      };
    }
    case "workload-apply": {
      const result = applyDemandIdempotent(state.workload.idemLedger, {
        owner: step.owner,
        tenant: state.tenant,
        units: step.units,
        demandKey: step.demandKey,
      });
      if (result.ok) state.workload.idemLedger = result.ledger;
      logPush(
        state,
        "wl.apply.log",
        `${result.ok}:${result.ok ? result.duplicate : result.reasonCode}:${result.ok ? null : result.overshootUnits}`,
      );
      return {
        "wl.apply.ok": result.ok,
        "wl.apply.duplicate": result.ok ? result.duplicate : null,
        "wl.apply.allocatedUnits": result.ok ? result.ledger.allocatedUnits : -1,
        "wl.apply.reasonCode": result.ok ? null : result.reasonCode,
        "wl.apply.overshootUnits": result.ok ? null : result.overshootUnits,
      };
    }
    case "workload-lifecycle": {
      if (state.workload.lifecycle === null) {
        state.workload.lifecycle = {
          id: "alloc-1",
          tenant: state.tenant,
          owner: "crew-a",
          units: 4,
          status: "proposed",
          demandKey: "demand-key-1",
          createdAt: CLOCK.t0,
          updatedAt: CLOCK.t0,
          terminalReason: null,
        };
      }
      const command =
        step.command === "release"
          ? { type: "release" as const, reason: step.reason ?? "demand withdrawn" }
          : step.command === "retire"
            ? { type: "retire" as const, reason: step.reason ?? "obsolete" }
            : { type: step.command as "commit" | "activate" };
      const result = applyLifecycleToLedger(state.workload.capacityLedger, state.workload.lifecycle, command, CLOCK.t2);
      if (result.ok) {
        state.workload.lifecycle = result.next;
        state.workload.capacityLedger = result.ledger;
      }
      return {
        "wl.lifecycle.ok": result.ok,
        "wl.lifecycle.status": result.ok ? result.next.status : null,
        "wl.lifecycle.reservedUnits": result.ok ? result.ledger.reservedUnits : -1,
        "wl.lifecycle.reasonCode": result.ok ? null : result.reasonCode,
        "wl.lifecycle.overshootUnits": result.ok ? null : result.overshootUnits,
      };
    }
    case "workload-window-check": {
      const windows = step.windows.map((w) => ({ id: w.id, tenant: state.tenant, owner: "crew-a", start: w.start, end: w.end }));
      const invalidCount = windows.filter((w) => !validateWindow(w).ok).length;
      const overlaps = detectWindowOverlaps(windows);
      return {
        "wl.window.invalidCount": invalidCount,
        "wl.window.overlapCount": overlaps.length,
        "wl.window.overlapPairs": overlaps.map((o) => `${o.a}&${o.b}`),
        "wl.window.tieBreakRule": overlaps[0]?.tieBreakRule ?? null,
      };
    }
    case "workload-rollup-view": {
      const allocations = [
        {
          owner: state.workload.idemLedger.owner,
          tenant: state.tenant,
          allocatedUnits: state.workload.idemLedger.allocatedUnits,
          reservedCost: 0,
        },
      ];
      const result = buildWorkloadRollup({
        tenant: state.tenant,
        capacities: state.workload.capacities,
        allocations,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "wlRollup.ok": false, "wlRollup.reasonCode": result.reasonCode };
      const crewA = result.view.owners.find((o) => o.owner === "crew-a");
      return {
        "wlRollup.ok": true,
        "wlRollup.usedUnits": crewA?.usedUnits ?? -1,
        "wlRollup.maxUnits": crewA?.maxUnits ?? -1,
        "wlRollup.utilizationBps": crewA?.utilizationBps ?? -1,
        "wlRollup.remainingUnits": crewA?.remainingUnits ?? -99,
        "wlRollup.overAllocated": crewA?.overAllocated ?? false,
        "wlRollup.totalUsedUnits": result.view.totals.usedUnits,
        "wlRollup.digest": result.view.digest,
      };
    }
  }
}
