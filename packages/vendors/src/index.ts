/**
 * @fleetos/vendors — Vendors bounded context public contracts.
 *
 * Wave 0 lane C (F200C). Pure TypeScript domain package.
 *
 * Laws: A1, A4, A8, A16 (exchange), A20. Scorecard aggregation uses
 * WORST-WINS — the worst observed score on a metric dominates the
 * aggregate, so a single weak metric cannot be hidden by strong averages.
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

export interface VendorServiceRelationship {
  readonly vendorId: VendorId;
  readonly tenant: TenantScope;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly contractRef: string;
}

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
  /** The worst score across all observed metrics — honest, no averaging. */
  readonly worstScore: number;
  /** The metric that produced the worst score. */
  readonly worstMetric: string | null;
  /** Total observations included in the aggregate. */
  readonly observationCount: number;
}

// ---------------------------------------------------------------------------
// Pure worst-wins scorecard aggregation. A single weak metric dominates the
// aggregate. Honest: when input scores are out of [0,1], the function
// refuses (does not silently clamp).
// ---------------------------------------------------------------------------

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
// Capability membership — pure check. Used by @fleetos/procurement at the
// structural seam boundary.
// ---------------------------------------------------------------------------

export function vendorHasCapability(
  vendor: Vendor,
  capabilityTag: string,
): boolean {
  const tenantCheck = validateTenantScope(vendor.tenant);
  if (!tenantCheck.ok) return false;
  return vendor.capabilityTags.includes(capabilityTag);
}
