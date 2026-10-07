/**
 * @fleetos/projects — Audit event contract + structural refs (law A19).
 */

import type { TenantScope } from "./contracts.js";

export type AuditEventKind =
  | "project.transitioned"
  | "milestone.achieved"
  | "milestone.skipped"
  | "milestone.blocking-reported";

export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly projectId: string;
  readonly milestoneId: string | null;
  readonly occurredAt: string;
  readonly digest: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly blockingItemCount: number | null;
  readonly reasonCode: string | null;
}

/**
 * LOCAL structural mission reference. Same shape as worker B's
 * MissionRefLike — composed by the TL at F211.
 */
export interface MissionRefLike {
  readonly missionId: string;
  readonly runId?: string;
  readonly workItemId?: string;
}

/**
 * LOCAL structural workflow reference.
 */
export interface WorkflowRefLike {
  readonly workflowRunId: string;
  readonly missionId?: string;
  readonly workItemId?: string;
}

/**
 * LOCAL structural Guardian decision reference.
 */
export interface GuardianDecisionRefLike {
  readonly decisionId: string;
  readonly authorized: boolean;
  readonly reasonCode: string;
}

/**
 * LOCAL structural evidence reference.
 */
export interface EvidenceRefLike {
  readonly evidenceId: string;
  readonly tenantId: string;
}

export function computeAuditDigest(inputs: {
  readonly kind: AuditEventKind;
  readonly tenantId: string;
  readonly projectId: string;
  readonly milestoneId: string | null;
  readonly occurredAt: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.projectId,
    inputs.milestoneId ?? "",
    inputs.occurredAt,
    inputs.fromStatus ?? "",
    inputs.toStatus ?? "",
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `audit_${hash.toString(16).padStart(8, "0")}`;
}

export function makeAuditEvent(inputs: {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly projectId: string;
  readonly milestoneId?: string | null;
  readonly occurredAt: string;
  readonly fromStatus?: string | null;
  readonly toStatus?: string | null;
  readonly blockingItemCount?: number | null;
  readonly reasonCode?: string | null;
}): AuditEvent {
  const digest = computeAuditDigest({
    kind: inputs.kind,
    tenantId: inputs.tenant.tenantId,
    projectId: inputs.projectId,
    milestoneId: inputs.milestoneId ?? null,
    occurredAt: inputs.occurredAt,
    fromStatus: inputs.fromStatus ?? null,
    toStatus: inputs.toStatus ?? null,
  });
  return {
    kind: inputs.kind,
    tenant: inputs.tenant,
    projectId: inputs.projectId,
    milestoneId: inputs.milestoneId ?? null,
    occurredAt: inputs.occurredAt,
    digest,
    fromStatus: inputs.fromStatus ?? null,
    toStatus: inputs.toStatus ?? null,
    blockingItemCount: inputs.blockingItemCount ?? null,
    reasonCode: inputs.reasonCode ?? null,
  };
}
