/**
 * @fleetos/work — Progress events (typed) for mission-runtime subscription.
 *
 * The work kernel emits typed progress events as work items transition
 * state. A mission runtime (composed by the TL at F211) subscribes to
 * these events to update mission progress. The events are STRUCTURAL —
 * they carry the work item id, the new status, and a stable digest.
 *
 * Laws: A4 (machine-stable), A10 (durable missions — events are
 * replayable; identical inputs produce identical events), A19 (audit
 * records are append-only).
 */

import type { TenantScope } from "./tenant.js";
import type { WorkItem, WorkItemStatus } from "./contracts.js";

/**
 * ProgressEventKind — typed discriminator for every progress event the
 * work kernel emits. Never localized, never reordered.
 */
export type ProgressEventKind =
  | "work.started"
  | "work.blocked"
  | "work.unblocked"
  | "work.completed"
  | "work.cancelled"
  | "work.assigned"
  | "work.reassigned"
  | "work.deadline-approaching"
  | "work.deadline-breached";

/**
 * ProgressEvent — the typed event payload. Carries enough information
 * for a mission runtime to update mission progress without re-reading
 * the work item. Stable digest (law A19) supports idempotent replay.
 */
export interface ProgressEvent {
  readonly kind: ProgressEventKind;
  readonly tenant: TenantScope;
  readonly workItemId: string;
  readonly missionRef: { readonly missionId: string } | null;
  readonly workflowRef: { readonly workflowRunId: string } | null;
  readonly emittedAt: string;
  readonly fromStatus: WorkItemStatus | null;
  readonly toStatus: WorkItemStatus | null;
  /** Stable digest — byte-identical for byte-identical inputs. */
  readonly digest: string;
  readonly reason: string | null;
}

/**
 * progressEventForTransition — pure factory. Maps a WorkItem transition
 * to its typed ProgressEvent. Returns null for transitions that do not
 * produce a progress event (none currently, but reserved for future).
 *
 * Determinism: same inputs produce the same event (same digest).
 */
export function progressEventForTransition(inputs: {
  readonly tenant: TenantScope;
  readonly workItem: WorkItem;
  readonly fromStatus: WorkItemStatus;
  readonly toStatus: WorkItemStatus;
  readonly emittedAt: string;
  readonly reason?: string | null;
}): ProgressEvent {
  const kind = progressKindForTransition(inputs.fromStatus, inputs.toStatus);
  return {
    kind,
    tenant: inputs.tenant,
    workItemId: inputs.workItem.id.value,
    missionRef: inputs.workItem.missionRef
      ? { missionId: inputs.workItem.missionRef.missionId }
      : null,
    workflowRef: inputs.workItem.workflowRef
      ? { workflowRunId: inputs.workItem.workflowRef.workflowRunId }
      : null,
    emittedAt: inputs.emittedAt,
    fromStatus: inputs.fromStatus,
    toStatus: inputs.toStatus,
    digest: computeProgressDigest({
      kind,
      workItemId: inputs.workItem.id.value,
      tenantId: inputs.tenant.tenantId,
      emittedAt: inputs.emittedAt,
      fromStatus: inputs.fromStatus,
      toStatus: inputs.toStatus,
    }),
    reason: inputs.reason ?? null,
  };
}

/**
 * progressKindForTransition — pure mapping from (from, to) status pair
 * to the ProgressEventKind. Exposed for tests.
 */
export function progressKindForTransition(
  from: WorkItemStatus,
  to: WorkItemStatus,
): ProgressEventKind {
  if (to === "in_progress" && from === "todo") return "work.started";
  if (to === "in_progress" && from === "blocked") return "work.unblocked";
  if (to === "blocked") return "work.blocked";
  if (to === "done") return "work.completed";
  if (to === "cancelled") return "work.cancelled";
  // Default: a generic "started" event for any non-terminal transition.
  return "work.started";
}

/**
 * progressEventForAssignment — pure factory for assignment events.
 */
export function progressEventForAssignment(inputs: {
  readonly tenant: TenantScope;
  readonly workItem: WorkItem;
  readonly kind: "work.assigned" | "work.reassigned";
  readonly assigneeId: string;
  readonly emittedAt: string;
}): ProgressEvent {
  const kind = inputs.kind;
  return {
    kind,
    tenant: inputs.tenant,
    workItemId: inputs.workItem.id.value,
    missionRef: inputs.workItem.missionRef
      ? { missionId: inputs.workItem.missionRef.missionId }
      : null,
    workflowRef: inputs.workItem.workflowRef
      ? { workflowRunId: inputs.workItem.workflowRef.workflowRunId }
      : null,
    emittedAt: inputs.emittedAt,
    fromStatus: inputs.workItem.status,
    toStatus: inputs.workItem.status,
    digest: computeProgressDigest({
      kind,
      workItemId: inputs.workItem.id.value,
      tenantId: inputs.tenant.tenantId,
      emittedAt: inputs.emittedAt,
      fromStatus: inputs.workItem.status,
      toStatus: inputs.workItem.status,
    }),
    reason: inputs.assigneeId,
  };
}

/**
 * progressEventForDeadlineEscalation — pure factory for deadline
 * escalation events.
 */
export function progressEventForDeadlineEscalation(inputs: {
  readonly tenant: TenantScope;
  readonly workItem: WorkItem;
  readonly kind: "work.deadline-approaching" | "work.deadline-breached";
  readonly emittedAt: string;
  readonly millisUntilDeadline: number;
}): ProgressEvent {
  const kind = inputs.kind;
  return {
    kind,
    tenant: inputs.tenant,
    workItemId: inputs.workItem.id.value,
    missionRef: inputs.workItem.missionRef
      ? { missionId: inputs.workItem.missionRef.missionId }
      : null,
    workflowRef: inputs.workItem.workflowRef
      ? { workflowRunId: inputs.workItem.workflowRef.workflowRunId }
      : null,
    emittedAt: inputs.emittedAt,
    fromStatus: inputs.workItem.status,
    toStatus: inputs.workItem.status,
    digest: computeProgressDigest({
      kind,
      workItemId: inputs.workItem.id.value,
      tenantId: inputs.tenant.tenantId,
      emittedAt: inputs.emittedAt,
      fromStatus: inputs.workItem.status,
      toStatus: inputs.workItem.status,
    }),
    reason: `millisUntilDeadline=${inputs.millisUntilDeadline}`,
  };
}

/**
 * computeProgressDigest — stable deterministic digest. Pure. Same inputs
 * always produce the same digest. Used by tests to assert determinism.
 */
export function computeProgressDigest(inputs: {
  readonly kind: ProgressEventKind;
  readonly workItemId: string;
  readonly tenantId: string;
  readonly emittedAt: string;
  readonly fromStatus: WorkItemStatus | null;
  readonly toStatus: WorkItemStatus | null;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.workItemId,
    inputs.emittedAt,
    inputs.fromStatus ?? "",
    inputs.toStatus ?? "",
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `progress_${hash.toString(16).padStart(8, "0")}`;
}
