/**
 * @fleetos/external-vendors — commercial scorecard ingestion (Wave 5).
 *
 * KPI rollups from ingested vendor metrics:
 *   - INGESTION: structural failures refuse the whole batch with typed
 *     codes (atomic); SEMANTIC issues are QUARANTINED with reason codes
 *     (VENDOR_UNKNOWN, CAPABILITY_NOT_VERIFIED, CAPABILITY_REVOKED) —
 *     recorded, never silently dropped.
 *   - AGGREGATION: per-vendor weighted mean in integer bps —
 *     floor(Σ(valueBps × weightBps) / Σ weightBps) — NO floats in outputs.
 *   - EXCLUSION HONESTY: quarantined metrics are EXCLUDED from the rollup
 *     and listed with their metric id + reason code; included + excluded
 *     counts always account for every metric in the window.
 *   - TREND CLASSIFICATION: current vs previous logical window aggregate
 *     (improving | declining | stable; null when no prior history).
 *   - REVOCATION PROPAGATION: `applyRevocationToMetrics` consumes the
 *     inert `RevocationNotice` from `./verification.js` and quarantines
 *     every metric depending on the revoked capability — fail-closed, no
 *     partial application.
 *   - DIGESTS: every rollup carries an FNV-1a digest; `verifyScorecardDigest`
 *     recomputes it.
 *
 * Pure, deterministic, tenant fail-closed; logical times are caller-supplied.
 */
import { validateTenantScope, type TenantScope } from "./tenant.js";
import { canonicalJson, fnv1a32Hex } from "./digest.js";
import type { VendorCatalog } from "./catalog-sync.js";
import { findVerification, type RevocationNotice, type VerificationRegistry } from "./verification.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type MetricQuarantineReasonCode = "VENDOR_UNKNOWN" | "CAPABILITY_NOT_VERIFIED" | "CAPABILITY_REVOKED";

export interface VendorMetricRecord {
  readonly metricId: string;
  readonly tenant: TenantScope;
  readonly vendorExternalId: string;
  readonly metric: string;
  readonly window: string;
  readonly valueBps: number;
  readonly weightBps: number;
  readonly dependsOnCapability: string | null;
  readonly quarantine: { readonly reasonCode: MetricQuarantineReasonCode } | null;
  readonly ingestedAt: number;
}

export interface MetricExclusion {
  readonly metricId: string;
  readonly reasonCode: MetricQuarantineReasonCode;
}

export type TrendClassification = "improving" | "declining" | "stable";

export interface KpiRollup {
  readonly tenant: TenantScope;
  readonly vendorExternalId: string;
  readonly window: string;
  readonly aggregatedBps: number;
  readonly includedCount: number;
  readonly excludedCount: number;
  readonly exclusions: readonly MetricExclusion[];
  readonly trend: TrendClassification | null;
  readonly digest: string;
}

export type MetricRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "EMPTY_BATCH"
  | "METRIC_ID_EMPTY"
  | "VENDOR_ID_EMPTY"
  | "METRIC_NAME_EMPTY"
  | "WINDOW_EMPTY"
  | "VALUE_BPS_OUT_OF_RANGE"
  | "WEIGHT_BPS_OUT_OF_RANGE"
  | "LOGICAL_TIME_INVALID"
  | "METRIC_ID_CONFLICT"
  | "NOTICE_TENANT_MISMATCH";

export type IngestMetricsResult =
  | { readonly ok: true; readonly metrics: readonly VendorMetricRecord[]; readonly admitted: readonly string[]; readonly quarantined: readonly string[]; readonly duplicatesSkipped: readonly string[] }
  | { readonly ok: false; readonly reasonCode: MetricRefusalCode; readonly detail: string };

export type RollupResult =
  | { readonly ok: true; readonly rollups: readonly KpiRollup[] }
  | { readonly ok: false; readonly reasonCode: MetricRefusalCode; readonly detail: string };

export interface MetricDraft {
  readonly tenant: TenantScope;
  readonly metricId: string;
  readonly vendorExternalId: string;
  readonly metric: string;
  readonly window: string;
  readonly valueBps: number;
  readonly weightBps: number;
  readonly dependsOnCapability: string | null;
  readonly ingestedAt: number;
}

// ---------------------------------------------------------------------------
// Ingestion.
// ---------------------------------------------------------------------------

export function ingestVendorMetrics(
  existing: readonly VendorMetricRecord[],
  catalog: VendorCatalog,
  registry: VerificationRegistry,
  drafts: readonly MetricDraft[],
): IngestMetricsResult {
  const catalogTenant = validateTenantScope(catalog.tenant);
  const registryTenant = validateTenantScope(registry.tenant);
  if (!catalogTenant.ok || !registryTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "catalog/registry tenant invalid" };
  }
  if (catalogTenant.scope.tenantId !== registryTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "catalog and registry tenants differ" };
  }
  if (drafts.length === 0) return { ok: false, reasonCode: "EMPTY_BATCH", detail: "batch carries no metrics" };

  const contentById = new Map<string, string>();
  for (const prior of existing) contentById.set(prior.metricId, metricContent(prior));
  const next: VendorMetricRecord[] = [...existing];
  const admitted: string[] = [];
  const quarantined: string[] = [];
  const duplicatesSkipped: string[] = [];

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    if (draft === null || typeof draft !== "object") {
      return { ok: false, reasonCode: "METRIC_ID_EMPTY", detail: `draft at index ${String(i)} is malformed` };
    }
    const scope = validateTenantScope(draft.tenant);
    if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: `draft ${String(i)} tenant invalid` };
    if (scope.scope.tenantId !== catalogTenant.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH", detail: `draft ${String(i)} belongs to another tenant` };
    }
    if (draft.metricId.trim().length === 0) {
      return { ok: false, reasonCode: "METRIC_ID_EMPTY", detail: `draft at index ${String(i)} has an empty metricId` };
    }
    if (draft.vendorExternalId.trim().length === 0) {
      return { ok: false, reasonCode: "VENDOR_ID_EMPTY", detail: `metric "${draft.metricId}" has an empty vendor id` };
    }
    if (draft.metric.trim().length === 0) {
      return { ok: false, reasonCode: "METRIC_NAME_EMPTY", detail: `metric "${draft.metricId}" has an empty name` };
    }
    if (draft.window.trim().length === 0) {
      return { ok: false, reasonCode: "WINDOW_EMPTY", detail: `metric "${draft.metricId}" has an empty window` };
    }
    if (!Number.isInteger(draft.valueBps) || draft.valueBps < 0 || draft.valueBps > 10000) {
      return { ok: false, reasonCode: "VALUE_BPS_OUT_OF_RANGE", detail: `metric "${draft.metricId}" valueBps must be 0..10000` };
    }
    if (!Number.isInteger(draft.weightBps) || draft.weightBps <= 0 || draft.weightBps > 10000) {
      return { ok: false, reasonCode: "WEIGHT_BPS_OUT_OF_RANGE", detail: `metric "${draft.metricId}" weightBps must be 1..10000` };
    }
    if (!Number.isInteger(draft.ingestedAt) || draft.ingestedAt < 0) {
      return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: `metric "${draft.metricId}" ingestedAt is invalid` };
    }
    const record: VendorMetricRecord = {
      metricId: draft.metricId,
      tenant: scope.scope,
      vendorExternalId: draft.vendorExternalId,
      metric: draft.metric,
      window: draft.window,
      valueBps: draft.valueBps,
      weightBps: draft.weightBps,
      dependsOnCapability: draft.dependsOnCapability,
      quarantine: classifyQuarantine(catalog, registry, draft),
      ingestedAt: draft.ingestedAt,
    };
    const content = metricContent(record);
    const priorContent = contentById.get(draft.metricId);
    if (priorContent !== undefined) {
      if (priorContent !== content) {
        return { ok: false, reasonCode: "METRIC_ID_CONFLICT", detail: `metricId "${draft.metricId}" carries different content` };
      }
      duplicatesSkipped.push(draft.metricId);
      continue;
    }
    contentById.set(draft.metricId, content);
    next.push(record);
    if (record.quarantine === null) admitted.push(draft.metricId);
    else quarantined.push(draft.metricId);
  }
  return { ok: true, metrics: next, admitted, quarantined, duplicatesSkipped };
}

function classifyQuarantine(
  catalog: VendorCatalog,
  registry: VerificationRegistry,
  draft: MetricDraft,
): { reasonCode: MetricQuarantineReasonCode } | null {
  const entry = catalog.entries.get(draft.vendorExternalId);
  if (entry === undefined) return { reasonCode: "VENDOR_UNKNOWN" };
  if (draft.dependsOnCapability === null) return null;
  const record = findVerification(registry, draft.tenant, draft.vendorExternalId, draft.dependsOnCapability);
  if (record === null) return { reasonCode: "CAPABILITY_NOT_VERIFIED" };
  if (record.state === "revoked") return { reasonCode: "CAPABILITY_REVOKED" };
  if (record.state === "expired") return { reasonCode: "CAPABILITY_NOT_VERIFIED" };
  return null;
}

function metricContent(record: VendorMetricRecord): string {
  return canonicalJson({
    metricId: record.metricId,
    tenantId: record.tenant.tenantId,
    vendorExternalId: record.vendorExternalId,
    metric: record.metric,
    window: record.window,
    valueBps: record.valueBps,
    weightBps: record.weightBps,
    dependsOnCapability: record.dependsOnCapability,
  });
}

// ---------------------------------------------------------------------------
// Rollups.
// ---------------------------------------------------------------------------

export interface RollupInput {
  readonly tenant: TenantScope;
  readonly currentWindow: string;
  readonly previousWindow: string;
}

export function rollupVendorScorecards(metrics: readonly VendorMetricRecord[], input: RollupInput): RollupResult {
  const scope = validateTenantScope(input.tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  if (input.currentWindow.trim().length === 0 || input.previousWindow.trim().length === 0) {
    return { ok: false, reasonCode: "WINDOW_EMPTY", detail: "rollup windows must be non-empty" };
  }
  if (input.currentWindow === input.previousWindow) {
    return { ok: false, reasonCode: "WINDOW_EMPTY", detail: "current and previous windows must differ" };
  }
  for (const metric of metrics) {
    const metricTenant = validateTenantScope(metric.tenant);
    if (!metricTenant.ok || metricTenant.scope.tenantId !== scope.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH", detail: `metric "${metric.metricId}" belongs to another tenant` };
    }
  }

  const vendors = new Set<string>();
  for (const metric of metrics) {
    if (metric.window === input.currentWindow || metric.window === input.previousWindow) vendors.add(metric.vendorExternalId);
  }
  const rollups: KpiRollup[] = [];
  for (const vendor of [...vendors].sort()) {
    const current = aggregate(metrics, vendor, input.currentWindow);
    const previous = aggregate(metrics, vendor, input.previousWindow);
    if (current === null && previous === null) continue;
    const aggregatedBps = current?.aggregatedBps ?? 0;
    const includedCount = current?.includedCount ?? 0;
    const excludedCount = current?.exclusions.length ?? 0;
    const trend: TrendClassification | null =
      current === null || previous === null || previous.includedCount === 0
        ? null
        : aggregatedBps > previous.aggregatedBps
          ? "improving"
          : aggregatedBps < previous.aggregatedBps
            ? "declining"
            : "stable";
    const draft = {
      tenant: scope.scope,
      vendorExternalId: vendor,
      window: input.currentWindow,
      aggregatedBps,
      includedCount,
      excludedCount,
      exclusions: current?.exclusions ?? [],
      trend,
    };
    rollups.push({ ...draft, digest: computeRollupDigest(draft) });
  }
  return { ok: true, rollups };
}

function aggregate(
  metrics: readonly VendorMetricRecord[],
  vendorExternalId: string,
  window: string,
): { aggregatedBps: number; includedCount: number; exclusions: readonly MetricExclusion[] } | null {
  let weightedSum = 0;
  let weightSum = 0;
  const exclusions: MetricExclusion[] = [];
  let seen = false;
  for (const metric of metrics) {
    if (metric.vendorExternalId !== vendorExternalId || metric.window !== window) continue;
    seen = true;
    if (metric.quarantine !== null) {
      exclusions.push({ metricId: metric.metricId, reasonCode: metric.quarantine.reasonCode });
      continue;
    }
    weightedSum += metric.valueBps * metric.weightBps;
    weightSum += metric.weightBps;
  }
  if (!seen) return null;
  return {
    aggregatedBps: weightSum === 0 ? 0 : Math.floor(weightedSum / weightSum),
    includedCount: seen ? metrics.filter((m) => m.vendorExternalId === vendorExternalId && m.window === window && m.quarantine === null).length : 0,
    exclusions,
  };
}

export function computeRollupDigest(
  rollup: Omit<KpiRollup, "digest">,
): string {
  return fnv1a32Hex(
    "score",
    [
      rollup.tenant.tenantId,
      rollup.vendorExternalId,
      rollup.window,
      String(rollup.aggregatedBps),
      String(rollup.includedCount),
      String(rollup.excludedCount),
      rollup.exclusions.map((e) => `${e.metricId}:${e.reasonCode}`).join(","),
      rollup.trend ?? "no-history",
    ].join("\u241f"),
  );
}

export function verifyScorecardDigest(rollup: KpiRollup): boolean {
  const { digest, ...rest } = rollup;
  return computeRollupDigest(rest) === digest;
}

// ---------------------------------------------------------------------------
// Revocation propagation (fail-closed, no partial application).
// ---------------------------------------------------------------------------

export type RevocationPropagationResult =
  | { readonly ok: true; readonly metrics: readonly VendorMetricRecord[]; readonly affected: readonly string[] }
  | { readonly ok: false; reasonCode: MetricRefusalCode; detail: string };

export function applyRevocationToMetrics(
  metrics: readonly VendorMetricRecord[],
  notice: RevocationNotice,
): RevocationPropagationResult {
  const noticeTenant = validateTenantScope(notice.tenant);
  if (!noticeTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "notice tenant invalid" };
  const affected: string[] = [];
  const next = metrics.map((metric) => {
    const metricTenant = validateTenantScope(metric.tenant);
    if (!metricTenant.ok || metricTenant.scope.tenantId !== noticeTenant.scope.tenantId) {
      return metric; // other tenants' metrics are untouched (scoped propagation)
    }
    if (
      metric.vendorExternalId !== notice.externalId ||
      metric.dependsOnCapability !== notice.capability ||
      metric.quarantine !== null
    ) {
      return metric;
    }
    affected.push(metric.metricId);
    return { ...metric, quarantine: { reasonCode: "CAPABILITY_REVOKED" as MetricQuarantineReasonCode } };
  });
  return { ok: true, metrics: next, affected };
}
