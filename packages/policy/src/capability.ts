/**
 * @fleetos/policy — Capability vocabulary (Architecture law A15).
 *
 * One typed Capability vocabulary shared by UI, agents, workflows, CLI, MCP,
 * plugins, edge agents and APIs. Every consequential capability declares
 * inputs, outputs, risk, required authority, tenant scope, resource scope,
 * side effects, idempotency and verification.
 *
 * Pure types + structural guards. No I/O, no providers, no runtime.
 */

/** Stable capability category — used as a policy key, never displayed raw. */
export type CapabilityCategory =
  | "read"
  | "observe"
  | "propose"
  | "execute.device"
  | "execute.work"
  | "execute.commerce"
  | "execute.network"
  | "mutate.asset"
  | "mutate.policy"
  | "adopt.capability"
  | "simulate";

/** Severity of side-effect if executed without authorization. */
export type CapabilityRisk =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "severe"
  | "irreversible";

/** Authority flavors the Guardian may require. */
export type AuthorityKind =
  | "tenant.operator"
  | "tenant.admin"
  | "tenant.engineer"
  | "mission.owner"
  | "asset.owner"
  | "human.approval"
  | "guardian.autonomous";

/** Resource scope — what concrete resources a capability may touch. */
export interface ResourceScope {
  readonly assetIds?: readonly string[];
  readonly missionIds?: readonly string[];
  readonly workItemIds?: readonly string[];
  readonly vendorIds?: readonly string[];
  readonly softwareIds?: readonly string[];
  /** Glob-style attribute filters, e.g. "fleet:region=eu-west". */
  readonly attributeFilters?: readonly string[];
}

/** Tenant scope (structural — compatible with Worker A's tenant package). */
export interface TenantScopeLike {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly impersonatedBy?: string;
}

/** Mission reference (structural — compatible with Worker C's mission package). */
export interface MissionRefLike {
  readonly missionId: string;
  readonly runId?: string;
  readonly workItemId?: string;
}

/** Side-effect descriptor — what execution will change. */
export interface SideEffect {
  readonly kind: "device.command" | "domain.write" | "outbox.event" | "evidence.write" | "external.call";
  readonly target: string;
  readonly reversible: boolean;
  readonly description: string;
}

/** Idempotency contract. */
export interface IdempotencyContract {
  readonly supported: boolean;
  /** Stable key shape — concatenated with tenantId for storage. */
  readonly keyShape: readonly string[];
  readonly replayWindowSeconds?: number;
}

/** Verification contract — what proves execution succeeded. */
export interface VerificationContract {
  readonly kind: "evidence.hash" | "device.ack" | "domain.read" | "external.receipt" | "none";
  readonly timeoutMs?: number;
}

/**
 * Capability — the canonical typed vocabulary entry.
 *
 * Law A15: human UI, agents, workflows, MCP, plugins, CLI, device agents and
 * APIs all reference the SAME capability descriptor. Capabilities are
 * declarative; they do not execute.
 */
export interface Capability {
  readonly id: string;
  readonly category: CapabilityCategory;
  readonly risk: CapabilityRisk;
  readonly requiredAuthority: readonly AuthorityKind[];
  readonly tenantScope: "single" | "cross" | "system";
  readonly resourceScope: ResourceScope;
  readonly sideEffects: readonly SideEffect[];
  readonly idempotency: IdempotencyContract;
  readonly verification: VerificationContract;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly description: string;
  /** Model/capability version pin (law A13). */
  readonly version: string;
}

/** Proposal to adopt a capability — never auto-adopted (law A5). */
export interface CapabilityAdoptionProposal {
  readonly proposalId: string;
  readonly capability: Capability;
  readonly rationale: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly evaluationRefs: readonly string[];
}

/**
 * Adoption authorization — produced ONLY by the Guardian.
 *
 * `authorizedBy.kind === "guardian.autonomous"` is the only path an agent can
 * take; agents/workflows/models never self-authorize. Manual self-authorization
 * is encoded as an unrepresentable state by the type system (no field exists
 * for "self.authorized").
 */
export interface CapabilityAdoptionAuthorization {
  readonly proposalId: string;
  readonly authorizedBy: { readonly kind: AuthorityKind; readonly actorId: string };
  readonly decidedAt: string;
  readonly decision: "adopt" | "reject" | "defer";
  readonly reasonCode: AdoptionReasonCode;
  readonly conditions: readonly string[];
}

export type AdoptionReasonCode =
  | "adopt.authorized"
  | "adopt.deferred_for_evidence"
  | "reject.insufficient_authority"
  | "reject.risk_too_high"
  | "reject.policy_violation"
  | "reject.unknown_capability";

/** Structural guard — runtime check that a value is a Capability. */
export function isCapability(value: unknown): value is Capability {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.category === "string" &&
    typeof v.risk === "string" &&
    Array.isArray(v.requiredAuthority) &&
    (v.tenantScope === "single" || v.tenantScope === "cross" || v.tenantScope === "system") &&
    typeof v.resourceScope === "object" &&
    Array.isArray(v.sideEffects) &&
    typeof v.idempotency === "object" &&
    typeof v.verification === "object" &&
    Array.isArray(v.inputs) &&
    Array.isArray(v.outputs) &&
    typeof v.description === "string" &&
    typeof v.version === "string"
  );
}
