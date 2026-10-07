/**
 * @fleetos/projects — Project/stage state machine with stage gates +
 * project archival rules + tenant fail-closed reads.
 *
 * Wave 2 lane C (F220C) operational-truth grade.
 *
 * Laws: A1, A4, A8 (tenant fail-closed), A19, A20.
 *
 * Pure and deterministic. Time is an explicit `number` input.
 */

import type { Project, ProjectStatus, TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import { PROJECT_TERMINAL_STATUSES } from "./contracts.js";

// ---------------------------------------------------------------------------
// Stage state machine with mandatory checkpoints (stage gates).
// ---------------------------------------------------------------------------

export type StageStatus = "planned" | "in_progress" | "closed";

export interface StageCheckpoint {
  readonly id: string;
  readonly mandatory: boolean;
  /** null until the checkpoint is completed; carries the completion time. */
  readonly completedAt: number | null;
}

export interface ProjectStage {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly projectId: string;
  readonly name: string;
  readonly status: StageStatus;
  readonly checkpoints: readonly StageCheckpoint[];
  /** Timestamp of the last lifecycle transition (explicit input). */
  readonly updatedAt: number;
}

export type StageTransitionCommand =
  | { type: "start" }
  | { type: "close" };

export type StageTransitionResult =
  | { readonly ok: true; readonly next: ProjectStage }
  | {
      readonly ok: false;
      readonly reasonCode: StageReasonCode;
      readonly openCheckpointIds: readonly string[];
    };

export type StageReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "OPEN_MANDATORY_CHECKPOINTS";

const STAGE_ALLOWED: Readonly<Record<StageStatus, readonly StageTransitionCommand["type"][]>> = {
  planned: ["start"],
  in_progress: ["close"],
  closed: [],
};

/**
 * transitionStage — a stage CANNOT close with open mandatory checkpoints.
 * The refusal carries the exact list of open mandatory checkpoint ids.
 */
export function transitionStage(
  current: ProjectStage,
  command: StageTransitionCommand,
  at: number,
): StageTransitionResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", openCheckpointIds: [] };
  const allowed = STAGE_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION", openCheckpointIds: [] };
  }
  if (command.type === "close") {
    const openMandatory = current.checkpoints
      .filter((c) => c.mandatory && c.completedAt === null)
      .map((c) => c.id);
    if (openMandatory.length > 0) {
      return { ok: false, reasonCode: "OPEN_MANDATORY_CHECKPOINTS", openCheckpointIds: openMandatory };
    }
    return { ok: true, next: { ...current, status: "closed", updatedAt: at } };
  }
  // start
  return { ok: true, next: { ...current, status: "in_progress", updatedAt: at } };
}

export type CompleteCheckpointResult =
  | { readonly ok: true; readonly next: ProjectStage }
  | { readonly ok: false; readonly reasonCode: CheckpointReasonCode };

export type CheckpointReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "UNKNOWN_CHECKPOINT"
  | "CHECKPOINT_ALREADY_COMPLETE"
  | "STAGE_CLOSED";

/**
 * completeStageCheckpoint — marks a checkpoint completed at time `at`.
 * Refuses unknown checkpoints, double completion, and mutation of a
 * closed stage.
 */
export function completeStageCheckpoint(
  stage: ProjectStage,
  checkpointId: string,
  at: number,
): CompleteCheckpointResult {
  const tenantCheck = validateTenantScope(stage.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (stage.status === "closed") {
    return { ok: false, reasonCode: "STAGE_CLOSED" };
  }
  const checkpoint = stage.checkpoints.find((c) => c.id === checkpointId);
  if (checkpoint === undefined) {
    return { ok: false, reasonCode: "UNKNOWN_CHECKPOINT" };
  }
  if (checkpoint.completedAt !== null) {
    return { ok: false, reasonCode: "CHECKPOINT_ALREADY_COMPLETE" };
  }
  return {
    ok: true,
    next: {
      ...stage,
      updatedAt: at,
      checkpoints: stage.checkpoints.map((c) =>
        c.id === checkpointId ? { ...c, completedAt: at } : c,
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Project archival rules + tenant fail-closed reads.
// ---------------------------------------------------------------------------

export interface ProjectArchivalRecord {
  readonly projectId: string;
  readonly tenant: TenantScope;
  readonly statusAtArchival: ProjectStatus;
  readonly archivedAt: number;
}

export type ArchivalResult =
  | { readonly ok: true; readonly record: ProjectArchivalRecord }
  | { readonly ok: false; readonly reasonCode: ArchivalReasonCode };

export type ArchivalReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "PROJECT_NOT_TERMINAL"
  | "ALREADY_ARCHIVED";

/**
 * archiveProject — only a TERMINAL project (completed/cancelled) may be
 * archived; double archival is refused. The archival record is tenant-
 * scoped.
 */
export function archiveProject(
  project: Project,
  existingArchives: readonly ProjectArchivalRecord[],
  archivedAt: number,
): ArchivalResult {
  const tenantCheck = validateTenantScope(project.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const duplicate = existingArchives.some(
    (a) =>
      a.projectId === project.id.value &&
      a.tenant.tenantId === project.tenant.tenantId,
  );
  if (duplicate) return { ok: false, reasonCode: "ALREADY_ARCHIVED" };
  if (!PROJECT_TERMINAL_STATUSES.includes(project.status)) {
    return { ok: false, reasonCode: "PROJECT_NOT_TERMINAL" };
  }
  return {
    ok: true,
    record: {
      projectId: project.id.value,
      tenant: project.tenant,
      statusAtArchival: project.status,
      archivedAt,
    },
  };
}

/**
 * readProjectForTenant — tenant fail-closed read. Returns null when the
 * project does not exist OR belongs to a different tenant; the caller
 * cannot distinguish the two cases (no existence leak).
 */
export function readProjectForTenant(
  projects: readonly Project[],
  tenant: TenantScope,
  projectId: string,
): Project | null {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return null;
  const found = projects.find((p) => p.id.value === projectId);
  if (found === undefined) return null;
  const foundTenant = validateTenantScope(found.tenant);
  if (!foundTenant.ok) return null;
  if (foundTenant.scope.tenantId !== tenantCheck.scope.tenantId) return null;
  return found;
}
