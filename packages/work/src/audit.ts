/**
 * @fleetos/work — Audit event contract (law A19: append-only, tenant-scoped,
 * hash-verifiable, machine-readable).
 *
 * Every consequential kernel operation emits an AuditEvent. The event
 * carries structural refs (no @fleetos/* cross-package imports); the
 * composing application (TL at F211) attaches the canonical actor,
 * authorization, evidence, and execution refs.
 */

import type { TenantScope } from "./tenant.js";

/**
 * AuditEventKind — machine-stable string codes for every consequential
 * kernel operation in this package. Never localized, never reordered.
 */
export type AuditEventKind =
  | "work-item.transitioned"
  | "work-item.assigned"
  | "work-item.reassigned"
  | "work-item.deadline-breached"
  | "work-item.deadline-approaching"
  | "work-item.progress-emitted";

/**
 * Structural refs to sibling-lane concepts. These are intentionally
 * minimal — the composing application attaches the canonical refs at
 * F211. The hashes are stable digests of the inputs that produced the
 * event (law A19: hash-verifiable).
 */
export interface AuditEvent {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly workItemId: string;
  readonly occurredAt: string;
  /** Stable digest of the operation inputs — byte-identical for byte-identical inputs. */
  readonly digest: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly actorRef: ActorRefLike | null;
  readonly missionRef: MissionRefRefLike | null;
  readonly authorizationRef: GuardianDecisionRefLike | null;
  readonly evidenceRef: EvidenceRefLike | null;
  readonly reasonCode: string | null;
}

/**
 * LOCAL structural actor reference (compatible with worker A's identity
 * package). The composing application attaches the canonical ActorRef.
 */
export interface ActorRefLike {
  readonly actorId: string;
  readonly tenantId: string;
}

/**
 * LOCAL structural mission reference (compatible with worker C's
 * mission-package seam composed by the TL at F211). Frozen shape from
 * worker B's @fleetos/execution/@fleetos/actions: { missionId, runId?,
 * workItemId? } — duplicated here as a LOCAL structural type, never
 * imported across package boundaries at runtime.
 */
export interface MissionRefRefLike {
  readonly missionId: string;
  readonly runId?: string;
  readonly workItemId?: string;
}

/**
 * LOCAL structural mission reference used by WorkItem to point at a
 * mission. Renamed to MissionRefLike per the work-item F210C contract
 * ("work items reference missions via MissionRefLike"). Same shape as
 * MissionRefRefLike — both names are exported so callers can use the
 * most descriptive name in context.
 */
export interface MissionRefLike {
  readonly missionId: string;
  readonly runId?: string;
  readonly workItemId?: string;
}

/**
 * LOCAL structural workflow reference. Worker C owns the canonical
 * WorkflowRefLike seam shape (the TL composes @fleetos/workflow at
 * F211). Frozen shape aligned with worker B's MissionRefLike.
 */
export interface WorkflowRefLike {
  readonly workflowRunId: string;
  readonly missionId?: string;
  readonly workItemId?: string;
}

/**
 * LOCAL structural Guardian decision reference (law A5 — Guardian is
 * the sole policy authority). The composing application attaches the
 * canonical GuardianDecision (worker B) at F211.
 */
export interface GuardianDecisionRefLike {
  readonly decisionId: string;
  readonly authorized: boolean;
  readonly reasonCode: string;
}

/**
 * LOCAL structural evidence reference (law A13 — evidence
 * completeness). The composing application attaches the canonical
 * Evidence record (worker B) at F211.
 */
export interface EvidenceRefLike {
  readonly evidenceId: string;
  readonly tenantId: string;
}

/**
 * computeDigest — stable deterministic digest of the audit event inputs.
 * Pure: same inputs always produce the same digest. Used by tests to
 * assert determinism (law A19: hash-verifiable).
 */
export function computeAuditDigest(inputs: {
  readonly kind: AuditEventKind;
  readonly tenantId: string;
  readonly workItemId: string;
  readonly occurredAt: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
}): string {
  const parts = [
    inputs.kind,
    inputs.tenantId,
    inputs.workItemId,
    inputs.occurredAt,
    inputs.fromStatus ?? "",
    inputs.toStatus ?? "",
  ];
  // Simple deterministic string hash (FNV-1a 32-bit). Stable across runs
  // and JS engines; not cryptographically secure but adequate for audit-
  // event identity. The composing application may attach a stronger hash
  // at the persistence boundary.
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `audit_${hash.toString(16).padStart(8, "0")}`;
}

/**
 * makeAuditEvent — pure factory. Constructs an AuditEvent with a stable
 * digest computed from the operation inputs. Refs default to null when
 * not provided; the composing application attaches the canonical refs
 * at the persistence boundary (law A13).
 */
export function makeAuditEvent(inputs: {
  readonly kind: AuditEventKind;
  readonly tenant: TenantScope;
  readonly workItemId: string;
  readonly occurredAt: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly actorRef?: ActorRefLike | null;
  readonly missionRef?: MissionRefRefLike | null;
  readonly authorizationRef?: GuardianDecisionRefLike | null;
  readonly evidenceRef?: EvidenceRefLike | null;
  readonly reasonCode?: string | null;
}): AuditEvent {
  const digest = computeAuditDigest({
    kind: inputs.kind,
    tenantId: inputs.tenant.tenantId,
    workItemId: inputs.workItemId,
    occurredAt: inputs.occurredAt,
    fromStatus: inputs.fromStatus,
    toStatus: inputs.toStatus,
  });
  return {
    kind: inputs.kind,
    tenant: inputs.tenant,
    workItemId: inputs.workItemId,
    occurredAt: inputs.occurredAt,
    digest,
    fromStatus: inputs.fromStatus,
    toStatus: inputs.toStatus,
    actorRef: inputs.actorRef ?? null,
    missionRef: inputs.missionRef ?? null,
    authorizationRef: inputs.authorizationRef ?? null,
    evidenceRef: inputs.evidenceRef ?? null,
    reasonCode: inputs.reasonCode ?? null,
  };
}
