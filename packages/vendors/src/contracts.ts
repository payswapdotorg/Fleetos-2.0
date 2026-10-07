/**
 * @fleetos/vendors — Vendors bounded context public contracts.
 *
 * Wave 1 lane C (F210C) kernel-grade.
 *
 * Laws: A1, A4, A8, A16, A19, A20. Scorecard aggregation uses
 * WORST-WINS — the worst observed score on a metric dominates the
 * aggregate.
 *
 * Wave 1 kernel-grade additions over Wave 0 (F200C):
 *   - service-relationship lifecycle (active -> suspended -> terminated
 *     with supersession-free terminal states);
 *   - capability matching feed — deterministic, tenant-scoped, used by
 *     @fleetos/procurement at the structural seam;
 *   - VendorDirectory over VendorRepositoryPort + in-memory reference;
 *   - audit events on every consequential operation.
 */

export interface TenantScope {
  readonly tenantId: string;
}

export type TenantValidation =
  | { ok: true; scope: TenantScope }
  | { ok: false; reasonCode: TenantReasonCode };

export type TenantReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS";

const TENANT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateTenantScope(scope: unknown): TenantValidation {
  if (scope === null || typeof scope !== "object") {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  }
  const candidate = scope as Record<string, unknown>;
  const tenantId = candidate["tenantId"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  }
  if (tenantId.length > 128) {
    return { ok: false, reasonCode: "TENANT_ID_TOO_LONG" };
  }
  if (!TENANT_PATTERN.test(tenantId)) {
    return { ok: false, reasonCode: "TENANT_ID_INVALID_CHARS" };
  }
  return { ok: true, scope: { tenantId } };
}

// ---------------------------------------------------------------------------
// Vendor identity, capabilities, scorecards, service relationships.
// ---------------------------------------------------------------------------

export interface VendorId { readonly kind: "vendor"; readonly value: string }

export type VendorStatus = "active" | "suspended" | "terminated";

export interface Vendor {
  readonly id: VendorId;
  readonly tenant: TenantScope;
  readonly displayName: string;
  readonly status: VendorStatus;
  readonly capabilityTags: readonly string[];
}

// ---------------------------------------------------------------------------
// Service-relationship lifecycle.
// ---------------------------------------------------------------------------

export type ServiceRelationshipStatus = "active" | "suspended" | "terminated";

export interface VendorServiceRelationship {
  readonly vendorId: VendorId;
  readonly tenant: TenantScope;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly contractRef: string;
  readonly status: ServiceRelationshipStatus;
}

export type ServiceRelationshipTransitionCommand =
  | { type: "suspend"; reason: string }
  | { type: "resume" }
  | { type: "terminate"; reason: string; endedAt: string };

export type ServiceRelationshipTransition =
  | { ok: true; next: VendorServiceRelationship }
  | { ok: false; reasonCode: ServiceRelationshipReasonCode };

export type ServiceRelationshipReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "ILLEGAL_TRANSITION"
  | "SUSPEND_REASON_REQUIRED"
  | "TERMINATE_REASON_REQUIRED";

const RELATIONSHIP_ALLOWED: Readonly<
  Record<ServiceRelationshipStatus, readonly ServiceRelationshipTransitionCommand["type"][]>
> = {
  active: ["suspend", "terminate"],
  suspended: ["resume", "terminate"],
  terminated: [],
};

export function transitionServiceRelationship(
  current: VendorServiceRelationship,
  command: ServiceRelationshipTransitionCommand,
): ServiceRelationshipTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (tenantCheck.scope.tenantId !== current.tenant.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  const allowed = RELATIONSHIP_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "suspend":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "SUSPEND_REASON_REQUIRED" };
      }
      return { ok: true, next: { ...current, status: "suspended" } };
    case "resume":
      return { ok: true, next: { ...current, status: "active" } };
    case "terminate":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "TERMINATE_REASON_REQUIRED" };
      }
      return {
        ok: true,
        next: { ...current, status: "terminated", endedAt: command.endedAt },
      };
  }
}

// ---------------------------------------------------------------------------
// Scorecards.
// ---------------------------------------------------------------------------

export interface MetricScore {
  readonly metric: string;
  /** Score in [0, 1]. */
  readonly score: number;
  readonly observedAt: string;
}

export interface VendorScorecard {
  readonly vendorId: VendorId;
  readonly tenant: TenantScope;
  readonly metricScores: readonly MetricScore[];
}

export interface VendorScorecardAggregate {
  readonly vendorId: VendorId;
  readonly tenant: TenantScope;
  readonly worstScore: number;
  readonly worstMetric: string | null;
  readonly observationCount: number;
}

export type ScorecardAggregateResult =
  | { ok: true; aggregate: VendorScorecardAggregate }
  | { ok: false; reasonCode: ScorecardReasonCode };

export type ScorecardReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "EMPTY_SCORECARD"
  | "SCORE_OUT_OF_RANGE";

const VENDOR_ID_PATTERN = /^v-[A-Za-z0-9_-]+$/;

export function aggregateScorecard(
  scorecard: VendorScorecard,
): ScorecardAggregateResult {
  const tenantCheck = validateTenantScope(scorecard.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (tenantCheck.scope.tenantId !== scorecard.tenant.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  if (!VENDOR_ID_PATTERN.test(scorecard.vendorId.value)) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  if (scorecard.metricScores.length === 0) {
    return { ok: false, reasonCode: "EMPTY_SCORECARD" };
  }
  let worst: MetricScore | null = null;
  for (const m of scorecard.metricScores) {
    if (!Number.isFinite(m.score) || m.score < 0 || m.score > 1) {
      return { ok: false, reasonCode: "SCORE_OUT_OF_RANGE" };
    }
    if (worst === null || m.score < worst.score) {
      worst = m;
    }
  }
  if (worst === null) {
    return { ok: false, reasonCode: "EMPTY_SCORECARD" };
  }
  return {
    ok: true,
    aggregate: {
      vendorId: scorecard.vendorId,
      tenant: scorecard.tenant,
      worstScore: worst.score,
      worstMetric: worst.metric,
      observationCount: scorecard.metricScores.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Capability matching feed — deterministic, tenant-scoped. The feed
// produces a VendorCapabilityRef for each vendor that has at least one
// matching tag. @fleetos/procurement consumes this feed at the structural
// seam (law A20).
// ---------------------------------------------------------------------------

export interface VendorCapabilityRef {
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly capabilityTags: readonly string[];
  readonly serviceLevel: number;
  readonly unitCost: number;
}

/**
 * capabilityMatchingFeed — pure function. Filters vendors by capability
 * tags AND tenant scope, returning a deterministic-ordered list of
 * VendorCapabilityRef records. Used by @fleetos/procurement's matchVendors.
 */
export function capabilityMatchingFeed(
  tenant: TenantScope,
  vendors: readonly Vendor[],
  scorecards: readonly VendorScorecard[],
  requestedTags: readonly string[],
): readonly VendorCapabilityRef[] {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return [];
  const out: VendorCapabilityRef[] = [];
  for (const v of vendors) {
    const vTenant = validateTenantScope(v.tenant);
    if (!vTenant.ok) continue;
    if (vTenant.scope.tenantId !== tenantCheck.scope.tenantId) continue;
    if (v.status !== "active") continue;
    const hasAny = requestedTags.some((t) => v.capabilityTags.includes(t));
    if (!hasAny) continue;
    // Find the vendor's scorecard (if any) — use worst score as service level.
    const scorecard = scorecards.find(
      (s) => s.vendorId.value === v.id.value,
    );
    const aggregate = scorecard ? aggregateScorecard(scorecard) : null;
    const serviceLevel = aggregate?.ok ? aggregate.aggregate.worstScore : 0.5;
    out.push({
      vendorId: v.id.value,
      tenant: v.tenant,
      capabilityTags: v.capabilityTags,
      serviceLevel,
      unitCost: 1, // default; real costing lives in procurement quotes
    });
  }
  out.sort((a, b) => a.vendorId.localeCompare(b.vendorId));
  return out;
}

// ---------------------------------------------------------------------------
// Capability membership — pure check.
// ---------------------------------------------------------------------------

export function vendorHasCapability(
  vendor: Vendor,
  capabilityTag: string,
): boolean {
  const tenantCheck = validateTenantScope(vendor.tenant);
  if (!tenantCheck.ok) return false;
  return vendor.capabilityTags.includes(capabilityTag);
}
