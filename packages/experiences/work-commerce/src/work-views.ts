/**
 * @fleetos/experience-work-commerce — work/project boards (F240C, Wave 4
 * lane C).
 *
 * Presentation read-models over the work/projects/workloads domain
 * surfaces, projected READ-ONLY (the experience plane sits ABOVE the
 * domain kernel — ARCHITECTURE-LOCK; these views never write domain
 * truth and never mutate their inputs).
 *
 *   - work-order/task boards grouped by deterministic status, every card
 *     carrying provenance refs back to the domain work-item record, with
 *     optional declarative assignee redaction (the sentinel replaces the
 *     value; WHAT was hidden is recorded, never the value);
 *   - project stage-gate views: gate state per stage + exactly what
 *     unlocks the next stage (open mandatory checkpoints, milestone
 *     blocking items — reported honestly via the domain's own gate);
 *   - workload rollups with integer-bps utilization and honest
 *     over-allocation flags.
 *
 * Laws: A4 (no silent clamping/dropping), A8 (tenant fail-closed — any
 * cross-tenant record refuses the WHOLE view naming the offender), A12
 * (deterministic; `computedAt` is caller-supplied), A19 (digest-stamped
 * views). Pure deterministic TS: no clock, no randomness, no I/O.
 */

import type { WorkItem, WorkItemStatus } from "@fleetos/work";
import { WORK_ITEM_STATUSES } from "@fleetos/work";
import type { Project, Milestone, ProjectStage } from "@fleetos/projects";
import { checkMilestoneGate } from "@fleetos/projects";
import type { WorkloadCapacity, WorkloadAllocation } from "@fleetos/workloads";
import type {
  TenantScopeLike,
  ProvenanceRef,
  TenantViewReasonCode,
} from "./internal-view.js";
import {
  checkTenantScope,
  failClosedOnRecords,
  fnv1a32,
  provenance,
  bpsOf,
  REDACTED_VALUE,
} from "./internal-view.js";

// ---------------------------------------------------------------------------
// Work board
// ---------------------------------------------------------------------------

export interface WorkBoardCard {
  readonly workItemId: string;
  readonly title: string;
  readonly status: WorkItemStatus;
  /** Assignee id, the "[REDACTED]" sentinel when redacted, or null. */
  readonly assigneeId: string | null;
  readonly deadline: string | null;
  readonly blockedReason: string | null;
  readonly projectId: string | null;
  readonly missionRefId: string | null;
  readonly provenance: readonly ProvenanceRef[];
}

export interface WorkBoardColumn {
  readonly status: WorkItemStatus;
  readonly cards: readonly WorkBoardCard[];
}

export interface WorkBoard {
  readonly kind: "work-board";
  readonly tenantId: string;
  readonly computedAt: string;
  readonly columns: readonly WorkBoardColumn[];
  readonly totals: { readonly status: WorkItemStatus; readonly count: number }[];
  /** Field names whose values were redacted on cards (never the values). */
  readonly redactedFields: readonly string[];
  readonly digest: string;
}

export type WorkBoardResult =
  | { readonly ok: true; readonly board: WorkBoard }
  | { readonly ok: false; readonly reasonCode: TenantViewReasonCode; readonly detail: string };

export function buildWorkBoard(input: {
  readonly tenant: TenantScopeLike;
  readonly workItems: readonly WorkItem[];
  readonly redactAssignees?: boolean;
  readonly computedAt: string;
}): WorkBoardResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const records = input.workItems.map((w) => ({ id: w.id.value, tenant: w.tenant }));
  const closed = failClosedOnRecords(tenant.tenantId, records);
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  const redact = input.redactAssignees === true;
  const cards = input.workItems.map((w) => {
    const assigneeId =
      w.assignee === null ? null : redact ? REDACTED_VALUE : w.assignee.assigneeId;
    return {
      workItemId: w.id.value,
      title: w.title,
      status: w.status,
      assigneeId,
      deadline: w.deadline,
      blockedReason: w.blockedReason,
      projectId: w.projectId,
      missionRefId: w.missionRef === null ? null : w.missionRef.missionId,
      provenance: [provenance("work-item", w.id.value)],
    } satisfies WorkBoardCard;
  });

  // Deterministic ordering: cards within a column by workItemId lexical;
  // columns in the domain's canonical status order (input order irrelevant).
  const columns: WorkBoardColumn[] = WORK_ITEM_STATUSES.map((status) => ({
    status,
    cards: cards
      .filter((c) => c.status === status)
      .sort((a, b) => a.workItemId.localeCompare(b.workItemId)),
  }));

  const digest = `workboard_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    columns.map((col) => `${col.status}:${col.cards.map((c) => c.workItemId).join(",")}`),
  ])}`;

  return {
    ok: true,
    board: {
      kind: "work-board",
      tenantId: tenant.tenantId,
      computedAt: input.computedAt,
      columns,
      totals: columns.map((col) => ({ status: col.status, count: col.cards.length })),
      redactedFields: redact ? ["assigneeId"] : [],
      digest,
    },
  };
}

// ---------------------------------------------------------------------------
// Project stage-gate view — gate state + what unlocks the next stage
// ---------------------------------------------------------------------------

export interface StageGateEntry {
  readonly stageId: string;
  readonly name: string;
  readonly status: ProjectStage["status"];
  readonly totalCheckpoints: number;
  readonly completedCheckpoints: number;
  readonly openMandatoryCheckpointIds: readonly string[];
}

export interface MilestoneGateEntry {
  readonly milestoneId: string;
  readonly name: string;
  readonly achieved: boolean;
  /** The domain gate's reason code; null when achieved. */
  readonly reasonCode: string | null;
  readonly blockingItems: readonly {
    readonly workItemId: string;
    readonly currentStatus: string;
    readonly reasonCode: string;
  }[];
}

export interface ProjectStageGateView {
  readonly kind: "project-stage-gates";
  readonly tenantId: string;
  readonly computedAt: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectStatus: Project["status"];
  readonly stages: readonly StageGateEntry[];
  /** The first stage (id order) not yet closed — the active frontier. */
  readonly frontierStageId: string | null;
  /** Exactly what unlocks the frontier stage's next transition. */
  readonly nextUnlock:
    | {
        readonly stageId: string;
        readonly requires: "start-stage" | "close-mandatory-checkpoints";
        readonly openMandatoryCheckpointIds: readonly string[];
      }
    | null;
  readonly milestoneGates: readonly MilestoneGateEntry[];
  readonly provenance: readonly ProvenanceRef[];
  readonly digest: string;
}

export type StageGateResult =
  | { readonly ok: true; readonly view: ProjectStageGateView }
  | { readonly ok: false; readonly reasonCode: TenantViewReasonCode; readonly detail: string };

export function buildProjectStageGateView(input: {
  readonly tenant: TenantScopeLike;
  readonly project: Project;
  readonly stages: readonly ProjectStage[];
  readonly milestones: readonly Milestone[];
  readonly workItems: readonly WorkItem[];
  readonly computedAt: string;
}): StageGateResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const closed = failClosedOnRecords(tenant.tenantId, [
    { id: input.project.id.value, tenant: input.project.tenant },
    ...input.stages.map((s) => ({ id: s.id, tenant: s.tenant })),
    ...input.milestones.map((m) => ({ id: m.id.value, tenant: m.tenant })),
    ...input.workItems.map((w) => ({ id: w.id.value, tenant: w.tenant })),
  ]);
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  const stages = [...input.stages]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => {
      const openMandatory = s.checkpoints
        .filter((c) => c.mandatory && c.completedAt === null)
        .map((c) => c.id);
      return {
        stageId: s.id,
        name: s.name,
        status: s.status,
        totalCheckpoints: s.checkpoints.length,
        completedCheckpoints: s.checkpoints.filter((c) => c.completedAt !== null).length,
        openMandatoryCheckpointIds: openMandatory,
      } satisfies StageGateEntry;
    });

  const frontier = stages.find((s) => s.status !== "closed") ?? null;
  const nextUnlock =
    frontier === null
      ? null
      : frontier.status === "planned"
        ? {
            stageId: frontier.stageId,
            requires: "start-stage" as const,
            openMandatoryCheckpointIds: frontier.openMandatoryCheckpointIds,
          }
        : {
            stageId: frontier.stageId,
            requires: "close-mandatory-checkpoints" as const,
            openMandatoryCheckpointIds: frontier.openMandatoryCheckpointIds,
          };

  // Milestone gates via the DOMAIN's own gate — blocking items reported
  // honestly, never silently coerced to achieved.
  const statusRefs = input.workItems.map((w) => ({ id: w.id.value, status: w.status }));
  const milestoneGates = [...input.milestones]
    .sort((a, b) => a.id.value.localeCompare(b.id.value))
    .map((m) => {
      const gate = checkMilestoneGate(m, statusRefs);
      return gate.ok
        ? {
            milestoneId: m.id.value,
            name: m.name,
            achieved: true,
            reasonCode: null,
            blockingItems: [],
          }
        : {
            milestoneId: m.id.value,
            name: m.name,
            achieved: false,
            reasonCode: gate.reasonCode,
            blockingItems: gate.blockingItems,
          };
    });

  const digest = `stagegates_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    input.project.id.value,
    stages.map((s) => `${s.stageId}:${s.status}:${s.openMandatoryCheckpointIds.join(",")}`),
    milestoneGates.map((m) => `${m.milestoneId}:${m.achieved}:${m.reasonCode ?? ""}`),
  ])}`;

  return {
    ok: true,
    view: {
      kind: "project-stage-gates",
      tenantId: tenant.tenantId,
      computedAt: input.computedAt,
      projectId: input.project.id.value,
      projectName: input.project.name,
      projectStatus: input.project.status,
      stages,
      frontierStageId: frontier === null ? null : frontier.stageId,
      nextUnlock,
      milestoneGates,
      provenance: [
        provenance("project", input.project.id.value),
        ...input.stages.map((s) => provenance("project-stage", s.id)),
        ...input.milestones.map((m) => provenance("milestone", m.id.value)),
      ],
      digest,
    },
  };
}

// ---------------------------------------------------------------------------
// Workload rollup — integer bps utilization, honest over-allocation
// ---------------------------------------------------------------------------

export interface WorkloadOwnerRow {
  readonly owner: string;
  readonly usedUnits: number;
  readonly maxUnits: number;
  /** floor(used * 10000 / max); 0 when maxUnits is 0. */
  readonly utilizationBps: number;
  readonly overAllocated: boolean;
  /** max - used; negative when over-allocated (never clamped, law A4). */
  readonly remainingUnits: number;
}

export interface WorkloadRollupView {
  readonly kind: "workload-rollup";
  readonly tenantId: string;
  readonly computedAt: string;
  readonly owners: readonly WorkloadOwnerRow[];
  readonly totals: {
    readonly ownerCount: number;
    readonly usedUnits: number;
    readonly maxUnits: number;
    readonly utilizationBps: number;
    readonly overAllocatedOwners: number;
  };
  readonly provenance: readonly ProvenanceRef[];
  readonly digest: string;
}

export type WorkloadRollupResult =
  | { readonly ok: true; readonly view: WorkloadRollupView }
  | { readonly ok: false; readonly reasonCode: TenantViewReasonCode; readonly detail: string };

export function buildWorkloadRollup(input: {
  readonly tenant: TenantScopeLike;
  readonly capacities: readonly WorkloadCapacity[];
  readonly allocations: readonly WorkloadAllocation[];
  readonly computedAt: string;
}): WorkloadRollupResult {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) return { ok: false, reasonCode: tenant.reasonCode, detail: "tenant" };

  const closed = failClosedOnRecords(
    tenant.tenantId,
    [
      ...input.capacities.map((c) => ({ id: `capacity:${c.owner}`, tenant: c.tenant })),
      ...input.allocations.map((a) => ({ id: `allocation:${a.owner}`, tenant: a.tenant })),
    ],
  );
  if (!closed.ok) return { ok: false, reasonCode: closed.reasonCode, detail: closed.detail };

  const owners = new Map<string, { max: number; used: number }>();
  for (const c of input.capacities) owners.set(c.owner, { max: c.maxUnits, used: 0 });
  for (const a of input.allocations) {
    const entry = owners.get(a.owner) ?? { max: 0, used: 0 };
    entry.used += a.allocatedUnits;
    owners.set(a.owner, entry);
  }

  const rows = [...owners.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([owner, v]) =>
        ({
          owner,
          usedUnits: v.used,
          maxUnits: v.max,
          utilizationBps: bpsOf(v.used, v.max),
          overAllocated: v.used > v.max,
          remainingUnits: v.max - v.used,
        }) satisfies WorkloadOwnerRow,
    );

  const usedUnits = rows.reduce((sum, r) => sum + r.usedUnits, 0);
  const maxUnits = rows.reduce((sum, r) => sum + r.maxUnits, 0);

  const digest = `workload_${fnv1a32([
    tenant.tenantId,
    input.computedAt,
    rows.map((r) => `${r.owner}:${r.usedUnits}/${r.maxUnits}`),
  ])}`;

  return {
    ok: true,
    view: {
      kind: "workload-rollup",
      tenantId: tenant.tenantId,
      computedAt: input.computedAt,
      owners: rows,
      totals: {
        ownerCount: rows.length,
        usedUnits,
        maxUnits,
        utilizationBps: bpsOf(usedUnits, maxUnits),
        overAllocatedOwners: rows.filter((r) => r.overAllocated).length,
      },
      provenance: input.capacities.map((c) => provenance("workload-capacity", c.owner)),
      digest,
    },
  };
}
