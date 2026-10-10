/**
 * @fleetos/acceptance-commerce — lifecycle step drivers (F310C, Wave 11
 * lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/work (assignment supersession + deadline surface + integrity
 * invariant), @fleetos/projects (the ProjectDirectory: hold/resume, the
 * milestone verification gate with honest blocking reports, the completion
 * gate, the portfolio read model — over the REAL in-memory
 * ProjectRepositoryPort) and @fleetos/workloads (rebalance PROPOSALS).
 *
 * Every step namespaces its facts under `factKey` so multiple steps of the
 * same kind stay independently assertable (the runner's facts map is
 * latest-write-wins). A domain refusal is recorded honestly as facts
 * (`ok: false` + the domain's reason code) — never swallowed.
 */

import type { FactValue, LifecycleStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK } from "./journey-world.js";
import {
  assignmentIntegrityHolds,
  evaluateDeadline,
  markDeadlineMet,
  produceDeadlineEscalation,
  removeAssignee,
} from "@fleetos/work";
import type { Project, Milestone, ProjectDirectory, ProjectRepositoryPort } from "@fleetos/projects";
import { createInMemoryProjectRepository, createProjectDirectory } from "@fleetos/projects";
import { proposeRebalance } from "@fleetos/workloads";

export type DriverFacts = Record<string, FactValue>;

/**
 * Per-journey-state projects seam: ONE repository + ONE directory bound to
 * it (a fresh world per run keeps every run pure and deterministic).
 */
interface ProjectsSeam {
  readonly repo: ProjectRepositoryPort;
  readonly directory: ProjectDirectory;
}

const seams = new WeakMap<JourneyState, ProjectsSeam>();

function projectsSeamFor(state: JourneyState): ProjectsSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    const repo = createInMemoryProjectRepository();
    seam = { repo, directory: createProjectDirectory(repo) };
    seams.set(state, seam);
  }
  return seam;
}

/** Compose WorkItemStatusRefLike[] from the REAL work directory state. */
async function realWorkItemRefs(state: JourneyState) {
  const items = await state.work.directory.list(state.tenant);
  return items.map((w) => ({ id: w.id.value, status: w.status }));
}

export async function runLifecycleStep(step: LifecycleStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "work-reassign": {
      const result = await state.work.directory.reassign(
        state.tenant,
        { kind: "work-item", value: step.itemId },
        step.newAssignmentId,
        step.newAssigneeId,
        CLOCK.iso2,
        { occurredAt: CLOCK.iso2 },
      );
      if (result.ok) {
        state.work.items.set(step.itemId, result.workItem);
        const superseded = result.workItem.assignmentHistory.find(
          (r) => r.supersededBy === step.newAssignmentId,
        ) ?? null;
        const live = result.workItem.assignmentHistory.find(
          (r) => r.supersededBy === null && r.closedAt === null,
        ) ?? null;
        return {
          [`work.reassign.${step.factKey}.ok`]: true,
          [`work.reassign.${step.factKey}.assigneeId`]: result.workItem.assignee?.assigneeId ?? null,
          [`work.reassign.${step.factKey}.historyLength`]: result.workItem.assignmentHistory.length,
          [`work.reassign.${step.factKey}.supersededCloseReason`]: superseded?.closeReason ?? null,
          [`work.reassign.${step.factKey}.supersededBy`]: superseded?.supersededBy ?? null,
          [`work.reassign.${step.factKey}.liveAssignmentId`]: live?.assignmentId ?? null,
          [`work.reassign.${step.factKey}.idempotentNoOp`]: superseded === null,
          [`work.reassign.${step.factKey}.integrityHolds`]: assignmentIntegrityHolds(result.workItem),
          [`work.reassign.${step.factKey}.auditEvents`]: (result.auditEvents ?? []).length,
          [`work.reassign.${step.factKey}.progressEvents`]: result.progressEvents.length,
          [`work.reassign.${step.factKey}.reasonCode`]: null,
        };
      }
      return {
        [`work.reassign.${step.factKey}.ok`]: false,
        [`work.reassign.${step.factKey}.reasonCode`]: result.reasonCode,
      };
    }
    case "work-remove-assignee": {
      const item = state.work.items.get(step.itemId) ?? null;
      if (item === null) {
        return { [`work.remove.${step.factKey}.ok`]: false, [`work.remove.${step.factKey}.reasonCode`]: "WORK_ITEM_NOT_FOUND" };
      }
      const result = removeAssignee(item, CLOCK.iso3);
      if (result.ok) {
        await state.work.repo.store(state.tenant, result.next);
        state.work.items.set(step.itemId, result.next);
        const closed = result.next.assignmentHistory.find(
          (r) => r.assignmentId === result.closedRecordId,
        ) ?? null;
        return {
          [`work.remove.${step.factKey}.ok`]: true,
          [`work.remove.${step.factKey}.closedRecordId`]: result.closedRecordId,
          [`work.remove.${step.factKey}.closeReason`]: closed?.closeReason ?? null,
          [`work.remove.${step.factKey}.assigneeNull`]: result.next.assignee === null,
          [`work.remove.${step.factKey}.historyLength`]: result.next.assignmentHistory.length,
          [`work.remove.${step.factKey}.integrityHolds`]: assignmentIntegrityHolds(result.next),
          [`work.remove.${step.factKey}.reasonCode`]: null,
        };
      }
      return {
        [`work.remove.${step.factKey}.ok`]: false,
        [`work.remove.${step.factKey}.reasonCode`]: result.reasonCode,
      };
    }
    case "work-integrity-holds": {
      const item = state.work.items.get(step.itemId) ?? null;
      if (item === null) {
        return { [`work.integrity.${step.factKey}.ok`]: false, [`work.integrity.${step.factKey}.reasonCode`]: "WORK_ITEM_NOT_FOUND" };
      }
      const live = item.assignmentHistory.filter((r) => r.supersededBy === null && r.closedAt === null);
      return {
        [`work.integrity.${step.factKey}.holds`]: assignmentIntegrityHolds(item),
        [`work.integrity.${step.factKey}.historyLength`]: item.assignmentHistory.length,
        [`work.integrity.${step.factKey}.liveRecordCount`]: live.length,
        [`work.integrity.${step.factKey}.liveAssigneeMatches`]:
          item.assignee === null ? live.length === 0 : live[0]?.assigneeId === item.assignee.assigneeId,
      };
    }
    case "work-deadline": {
      const item = state.work.items.get(step.itemId) ?? null;
      if (item === null) {
        return { [`work.deadline.${step.factKey}.ok`]: false, [`work.deadline.${step.factKey}.reasonCode`]: "WORK_ITEM_NOT_FOUND" };
      }
      if (step.mode === "met") {
        const met = markDeadlineMet(item.deadline);
        return {
          [`work.deadline.${step.factKey}.status`]: met.status,
          [`work.deadline.${step.factKey}.millisUntilDeadline`]: met.millisUntilDeadline,
          [`work.deadline.${step.factKey}.escalation`]: null,
        };
      }
      const evaluated = evaluateDeadline(item.deadline, step.now, step.approachingWindowMillis);
      const escalation = produceDeadlineEscalation({
        workItemId: step.itemId,
        tenantId: state.tenant.tenantId,
        deadline: item.deadline,
        now: step.now,
        approachingWindowMillis: step.approachingWindowMillis,
      });
      return {
        [`work.deadline.${step.factKey}.status`]: evaluated.status,
        [`work.deadline.${step.factKey}.millisUntilDeadline`]: evaluated.millisUntilDeadline,
        [`work.deadline.${step.factKey}.approaching`]: evaluated.approaching,
        [`work.deadline.${step.factKey}.breached`]: evaluated.breached,
        [`work.deadline.${step.factKey}.escalationKind`]: escalation?.kind ?? null,
        [`work.deadline.${step.factKey}.escalationWorkItemId`]: escalation?.workItemId ?? null,
        [`work.deadline.${step.factKey}.escalationTenantId`]: escalation?.tenantId ?? null,
        [`work.deadline.${step.factKey}.escalationObservedAt`]: escalation?.observedAt ?? null,
      };
    }
    case "project-directory-seed": {
      const seam = projectsSeamFor(state);
      let projectCount = 0;
      let milestoneCount = 0;
      for (const spec of step.projects) {
        const project: Project = {
          id: { kind: "project", value: spec.projectId },
          tenant: state.tenant,
          name: spec.name,
          status: "draft",
          milestoneIds: spec.milestones.map((m) => m.milestoneId),
        };
        await seam.repo.storeProject(state.tenant, project);
        projectCount += 1;
        for (const m of spec.milestones) {
          const milestone: Milestone = {
            id: { kind: "milestone", value: m.milestoneId },
            tenant: state.tenant,
            projectId: spec.projectId,
            name: m.name,
            status: "open",
            workItemIds: m.workItemIds,
          };
          await seam.repo.storeMilestone(state.tenant, milestone);
          milestoneCount += 1;
        }
      }
      return {
        "projectDirectory.seed.projects": projectCount,
        "projectDirectory.seed.milestones": milestoneCount,
      };
    }
    case "project-directory-transition": {
      const seam = projectsSeamFor(state);
      const command =
        step.command === "hold"
          ? { type: "hold" as const, reason: step.reason ?? "" }
          : step.command === "cancel"
            ? { type: "cancel" as const, reason: step.reason ?? "" }
            : { type: step.command as "activate" | "resume" };
      const result = await seam.directory.transitionProject(
        state.tenant,
        { kind: "project", value: step.projectId },
        command,
        { occurredAt: CLOCK.iso1 },
      );
      return {
        [`projectDirectory.transition.${step.factKey}.ok`]: result.ok,
        [`projectDirectory.transition.${step.factKey}.status`]: result.ok ? (result.project?.status ?? null) : null,
        [`projectDirectory.transition.${step.factKey}.reasonCode`]: result.ok ? null : result.reasonCode,
        [`projectDirectory.transition.${step.factKey}.auditEvents`]: (result.auditEvents ?? []).length,
      };
    }
    case "project-milestone-verify": {
      const seam = projectsSeamFor(state);
      const refs = await realWorkItemRefs(state);
      const result = await seam.directory.verifyMilestoneGate(
        state.tenant,
        { kind: "milestone", value: step.milestoneId },
        refs,
        { occurredAt: CLOCK.iso2 },
      );
      return {
        [`projectDirectory.verify.${step.factKey}.ok`]: result.ok,
        [`projectDirectory.verify.${step.factKey}.status`]: result.ok ? (result.milestone?.status ?? null) : null,
        [`projectDirectory.verify.${step.factKey}.reasonCode`]: result.ok ? null : result.reasonCode,
        [`projectDirectory.verify.${step.factKey}.blockingCount`]: result.ok ? 0 : (result.blockingItems?.length ?? 0),
        [`projectDirectory.verify.${step.factKey}.blockingItems`]: (result.blockingItems ?? []).map(
          (b) => `${b.workItemId}:${b.currentStatus}:${b.reasonCode}`,
        ),
        [`projectDirectory.verify.${step.factKey}.auditEvents`]: (result.auditEvents ?? []).length,
      };
    }
    case "project-complete": {
      const seam = projectsSeamFor(state);
      const refs = await realWorkItemRefs(state);
      const result = await seam.directory.completeProject(
        state.tenant,
        { kind: "project", value: step.projectId },
        refs,
        { occurredAt: CLOCK.iso3 },
      );
      return {
        [`projectDirectory.complete.${step.factKey}.ok`]: result.ok,
        [`projectDirectory.complete.${step.factKey}.status`]: result.ok ? (result.project?.status ?? null) : null,
        [`projectDirectory.complete.${step.factKey}.reasonCode`]: result.ok ? null : result.reasonCode,
        [`projectDirectory.complete.${step.factKey}.blockingCount`]: result.ok ? 0 : (result.blockingItems?.length ?? 0),
        [`projectDirectory.complete.${step.factKey}.auditEvents`]: (result.auditEvents ?? []).length,
      };
    }
    case "project-portfolio": {
      const seam = projectsSeamFor(state);
      const portfolio = await seam.directory.readPortfolio(state.tenant);
      return {
        "projectDirectory.portfolio.totalProjects": portfolio.totalProjects,
        "projectDirectory.portfolio.activeProjects": portfolio.activeProjects,
        "projectDirectory.portfolio.completedProjects": portfolio.completedProjects,
        "projectDirectory.portfolio.totalMilestones": portfolio.totalMilestones,
        "projectDirectory.portfolio.achievedMilestones": portfolio.achievedMilestones,
        "projectDirectory.portfolio.entryIds": portfolio.entries.map((e) => e.projectId),
        "projectDirectory.portfolio.firstEntryStatus": portfolio.entries[0]?.status ?? null,
        "projectDirectory.portfolio.firstEntryAchieved": portfolio.entries[0]?.achievedMilestoneCount ?? -1,
      };
    }
    case "workload-rebalance": {
      const capacities = step.capacities.map((c) => ({ owner: c.owner, tenant: state.tenant, maxUnits: c.maxUnits, unitCost: 100 }));
      const allocations = step.allocations.map((a) => ({ owner: a.owner, tenant: state.tenant, allocatedUnits: a.allocatedUnits, reservedCost: 0 }));
      const before = JSON.stringify(allocations);
      const proposal = proposeRebalance(state.tenant, capacities, allocations, step.generatedAt);
      const after = JSON.stringify(allocations);
      return {
        [`wl.rebalance.${step.factKey}.kind`]: proposal.kind,
        [`wl.rebalance.${step.factKey}.moveCount`]: proposal.moves.length,
        [`wl.rebalance.${step.factKey}.moves`]: proposal.moves.map((m) => `${m.fromOwner}->${m.toOwner}:${m.units}`),
        [`wl.rebalance.${step.factKey}.firstRationale`]: proposal.moves[0]?.rationale ?? null,
        [`wl.rebalance.${step.factKey}.reasonCode`]: proposal.reasonCode,
        [`wl.rebalance.${step.factKey}.digest`]: proposal.digest,
        [`wl.rebalance.${step.factKey}.inputsUnmutated`]: before === after,
      };
    }
  }
}
