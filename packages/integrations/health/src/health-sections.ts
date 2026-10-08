/**
 * @fleetos/integration-health — the per-adapter health sections (F251).
 *
 * Section view types + the FIXED deterministic severity ladder + the section
 * builders over the lanes' REAL health outputs, and the per-section +
 * assembly chained FNV-1a digests (␟-join convention; one digest per section,
 * one chained digest over every section digest).
 *
 * Severity ladder (fixed, documented, TL-tunable):
 *   - adcos:        critical if status `unavailable` or circuit `open`;
 *                   degraded if status `degraded`, circuit `half-open`, or any
 *                   reason code (the lane's honesty law: no observations is
 *                   degraded, never healthy).
 *   - connectivity: critical if any divergent alignment; degraded if any
 *                   unknown alignment or any offline/degraded/unknown honest
 *                   posture.
 *   - arena:        critical if `tenant_mismatch`; degraded on any other
 *                   honest degraded state.
 *   - learning:     degraded if trend `degrading` or band
 *                   `weak`/`insufficient-evidence` (advisory signal only).
 *   - aurum:        critical if classification `diverged`; degraded on any
 *                   lag class (external-ahead | local-ahead).
 *   - apify:        degraded if any failed or expired jobs.
 *   - vendors:      critical if any revoked verification; degraded if any
 *                   expired verification or scorecard exclusion.
 */

import type {
  AdapterHealthReasonCode,
  SessionHealthSummary,
} from "@fleetos/adcos";
import type { ArenaDegradedState } from "@fleetos/arena";
import type { CapabilityEvaluationSummary } from "@fleetos/learning";
import type { ReconciliationClass, ReconciliationReport } from "@fleetos/aurum";
import type { RunRegistryState } from "@fleetos/apify";
import type { AdapterHealthReport } from "@fleetos/adcos";
import type { ExpiryClassification, KpiRollup } from "@fleetos/external-vendors";
import type { FleetPostureRollup } from "@fleetos/connectivity";
import { HEALTH_SCHEMA_VERSION, healthDigestOf, sortedUnique } from "./health-core.js";

/** Fixed deterministic severity ladder (critical > degraded > nominal). */
export type AdapterSeverity = "critical" | "degraded" | "nominal";

export interface AdapterHealthSection {
  readonly adapter: string;
  readonly severity: AdapterSeverity;
  /** Adapter-carried reason codes / vocabulary values, verbatim. */
  readonly codes: readonly string[];
  readonly digest: string;
}

export interface AdcosSection extends AdapterHealthSection {
  readonly adapter: "adcos";
  readonly status: AdapterHealthReport["status"];
  readonly circuit: AdapterHealthReport["circuit"];
  readonly reasons: readonly AdapterHealthReasonCode[];
  readonly commandStats: AdapterHealthReport["commandStats"];
  readonly sessionSummary: SessionHealthSummary;
}

export interface ConnectivitySection extends AdapterHealthSection {
  readonly adapter: "connectivity";
  readonly counts: {
    readonly total: number;
    readonly aligned: number;
    readonly divergent: number;
    readonly unknown: number;
  };
  readonly divergentDevices: readonly string[];
}

export interface ArenaSection extends AdapterHealthSection {
  readonly adapter: "arena";
  readonly evaluations: number;
  readonly degradedStates: readonly ArenaDegradedState[];
}

export interface LearningSection extends AdapterHealthSection {
  readonly adapter: "learning";
  readonly trend: CapabilityEvaluationSummary["trend"];
  readonly band: string;
  readonly successRateBps: number;
}

export interface AurumSection extends AdapterHealthSection {
  readonly adapter: "aurum";
  readonly classification: ReconciliationClass;
  readonly counts: {
    readonly matched: number;
    readonly externalOnly: number;
    readonly localOnly: number;
    readonly divergent: number;
  };
}

export interface ApifySection extends AdapterHealthSection {
  readonly adapter: "apify";
  readonly totalJobs: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly failureReasonCodes: readonly string[];
}

export interface VendorsSection extends AdapterHealthSection {
  readonly adapter: "vendors";
  readonly verificationStates: { readonly active: number; readonly expired: number; readonly revoked: number };
  readonly exclusions: readonly string[];
}

export interface IntegrationHealthRollup {
  readonly status: "critical" | "degraded" | "healthy";
  readonly criticalAdapters: readonly string[];
  readonly degradedAdapters: readonly string[];
  readonly totalAdapters: number;
  readonly totalCodes: number;
}

export interface IntegrationHealthView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly asOf: number;
  readonly adcos: AdcosSection;
  readonly connectivity: ConnectivitySection;
  readonly arena: ArenaSection;
  readonly learning: LearningSection;
  readonly aurum: AurumSection;
  readonly apify: ApifySection;
  readonly vendors: VendorsSection;
  readonly rollup: IntegrationHealthRollup;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Section builders (over the lanes' REAL outputs; fixed severity ladder).
// ---------------------------------------------------------------------------

export function buildAdcosSection(report: AdapterHealthReport): AdcosSection {
  return {
    adapter: "adcos",
    status: report.status,
    circuit: report.circuit,
    reasons: report.reasons,
    commandStats: report.commandStats,
    sessionSummary: report.sessionSummary,
    codes: report.reasons,
    severity: report.status === "unavailable" || report.circuit === "open"
      ? "critical"
      : report.status === "degraded" || report.circuit === "half-open" || report.reasons.length > 0
        ? "degraded"
        : "nominal",
    digest: "",
  };
}

export function buildConnectivitySection(posture: FleetPostureRollup): ConnectivitySection {
  const divergentDevices = posture.assets.filter((a) => a.alignment === "divergent").map((a) => a.deviceId);
  return {
    adapter: "connectivity",
    counts: {
      total: posture.counts.total,
      aligned: posture.counts.aligned,
      divergent: posture.counts.divergent,
      unknown: posture.counts.unknown,
    },
    divergentDevices,
    codes: sortedUnique([
      ...posture.assets.filter((a) => a.alignment === "divergent").map(() => "divergent"),
      ...posture.assets.filter((a) => a.observed === "offline").map(() => "offline"),
      ...posture.assets.filter((a) => a.observed === "degraded").map(() => "degraded"),
      ...posture.assets.filter((a) => a.observed === "unknown").map(() => "unknown"),
    ]),
    severity: divergentDevices.length > 0
      ? "critical"
      : posture.counts.unknown > 0 || posture.counts.observedOffline > 0 ||
          posture.counts.observedDegraded > 0 || posture.counts.observedUnknown > 0
        ? "degraded"
        : "nominal",
    digest: "",
  };
}

export function buildArenaSection(evaluations: number, degraded: readonly ArenaDegradedState[]): ArenaSection {
  const states = [...new Set(degraded)].sort();
  return {
    adapter: "arena",
    evaluations,
    degradedStates: states,
    codes: states,
    severity: degraded.includes("tenant_mismatch")
      ? "critical"
      : degraded.length > 0
        ? "degraded"
        : "nominal",
    digest: "",
  };
}

export function buildLearningSection(summary: CapabilityEvaluationSummary): LearningSection {
  return {
    adapter: "learning",
    trend: summary.trend,
    band: summary.band,
    successRateBps: summary.successRateBps,
    codes: [summary.trend, summary.band],
    severity: summary.trend === "degrading" || summary.band === "weak" || summary.band === "insufficient-evidence"
      ? "degraded"
      : "nominal",
    digest: "",
  };
}

export function buildAurumSection(report: ReconciliationReport): AurumSection {
  return {
    adapter: "aurum",
    classification: report.classification,
    counts: {
      matched: report.matchedIds.length,
      externalOnly: report.externalOnly.length,
      localOnly: report.localOnly.length,
      divergent: report.divergent.length,
    },
    codes: [report.classification],
    severity: report.classification === "diverged"
      ? "critical"
      : report.classification === "in-sync"
        ? "nominal"
        : "degraded",
    digest: "",
  };
}

export function buildApifySection(runs: RunRegistryState): ApifySection {
  const byStatus: Record<string, number> = {};
  for (const status of ["proposed", "authorized", "scheduled", "running", "completed", "failed", "expired"] as const) {
    const ids = runs.byStatus.get(status);
    if (ids !== undefined) byStatus[status] = ids.length;
  }
  const failureReasonCodes = sortedUnique(
    [...runs.jobs.values()].flatMap((job) => (job.failureReasonCode === null ? [] : [job.failureReasonCode])),
  );
  return {
    adapter: "apify",
    totalJobs: runs.jobs.size,
    byStatus,
    failureReasonCodes,
    codes: failureReasonCodes,
    severity: (byStatus["failed"] ?? 0) > 0 || (byStatus["expired"] ?? 0) > 0 ? "degraded" : "nominal",
    digest: "",
  };
}

export function buildVendorsSection(
  expiry: readonly { readonly externalId: string; readonly capability: string; readonly classification: ExpiryClassification }[],
  revokedCount: number,
  rollups: readonly KpiRollup[],
): VendorsSection {
  const exclusions = sortedUnique(rollups.flatMap((r) => r.exclusions.map((e) => e.reasonCode)));
  const expiredVerifications = expiry.filter((e) => e.classification === "expired").length;
  return {
    adapter: "vendors",
    verificationStates: {
      active: expiry.length - expiredVerifications,
      expired: expiredVerifications,
      revoked: revokedCount,
    },
    exclusions,
    codes: sortedUnique([...exclusions, ...(revokedCount > 0 ? ["revoked"] : [])]),
    severity: revokedCount > 0
      ? "critical"
      : expiredVerifications > 0 || exclusions.length > 0
        ? "degraded"
        : "nominal",
    digest: "",
  };
}

// ---------------------------------------------------------------------------
// Section digests + the chained assembly digest.
// ---------------------------------------------------------------------------

export type HealthSection =
  | AdcosSection
  | ConnectivitySection
  | ArenaSection
  | LearningSection
  | AurumSection
  | ApifySection
  | VendorsSection;

export function sectionsOf(view: IntegrationHealthView): readonly HealthSection[] {
  return [view.adcos, view.connectivity, view.arena, view.learning, view.aurum, view.apify, view.vendors];
}

export function stampSectionDigests(sections: readonly AdapterHealthSection[]): void {
  for (const section of sections) {
    (section as { digest: string }).digest = sectionDigest(section);
  }
}

export function buildRollup(sections: readonly AdapterHealthSection[]): IntegrationHealthRollup {
  const criticalAdapters = sections.filter((s) => s.severity === "critical").map((s) => s.adapter);
  const degradedAdapters = sections.filter((s) => s.severity === "degraded").map((s) => s.adapter);
  return {
    status: criticalAdapters.length > 0 ? "critical" : degradedAdapters.length > 0 ? "degraded" : "healthy",
    criticalAdapters,
    degradedAdapters,
    totalAdapters: sections.length,
    totalCodes: sections.reduce((sum, s) => sum + s.codes.length, 0),
  };
}

export function sectionDigest(section: AdapterHealthSection): string {
  const rest = { ...section } as Record<string, unknown>;
  delete rest.digest;
  return healthDigestOf(`section-${section.adapter}`, rest);
}

export function assemblyDigestBody(
  sections: readonly AdapterHealthSection[],
  tenantId: string,
  asOf: number,
  rollup: IntegrationHealthRollup,
): unknown {
  return {
    tenantId,
    asOf,
    sections: Object.fromEntries(sections.map((s) => [s.adapter, s.digest])),
    rollup,
  };
}

export const INTEGRATION_HEALTH_SCHEMA_VERSION = HEALTH_SCHEMA_VERSION;
