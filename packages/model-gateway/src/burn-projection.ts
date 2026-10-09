/**
 * @fleetos/model-gateway — Budget-burn projection: deterministic given
 * the REAL usage ledger + a caller-supplied burn schedule — never a
 * guess. Every actual number traces to ledger entries (seq refs); every
 * projected number is marked as projection and carries its assumption.
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A1 (the ledger is the actuals authority), A4 (refusals and
 * projections are honest — never clamped), A8 (tenant-scoped,
 * fail-closed), A19, A20.
 *
 * PROJECTION LAW (documented):
 *   - actual = signed sums over the REAL ledger entries, with the seq of
 *     every contributing entry recorded (traceable to source).
 *   - projected = actual + Σ schedule points. Every schedule point MUST
 *     carry a non-empty assumption; points are applied in schedule order
 *     with running cumulative totals.
 *   - projectedUtilizationBps = floor(projectedCost * 10000 / ceiling);
 *     severity: "breach" when projectedCost > ceiling, "warning" when
 *     utilization >= warningThresholdBps (default 9000, caller-tunable),
 *     else "none".
 *   - The output is marked `projection: true` and lists every assumption
 *     verbatim — uncertainty is explicit, never hidden.
 *   - Fail-closed: a ledger entry from another tenant than the caller's
 *     tenant refuses the projection (TENANT_MISMATCH).
 */

import type { UsageLedgerEntry } from "./usage.js";

// ---------------------------------------------------------------------------
// Burn schedule + projection contracts.
// ---------------------------------------------------------------------------

export interface BurnSchedulePoint {
  readonly label: string;
  readonly units: number;
  readonly costMinor: number;
  /** Logical time the burn is projected to occur (ordering only). */
  readonly at: number;
  /** REQUIRED non-empty assumption — the uncertainty statement. */
  readonly assumption: string;
}

export interface BurnProjectionOptions {
  /** The budget ceiling under projection (integer minor units). */
  readonly ceilingMinor: number;
  /** Warning threshold in bps of the ceiling (default 9000). */
  readonly warningThresholdBps?: number;
}

export interface BurnActuals {
  readonly totalUnits: number;
  readonly totalCostMinor: number;
  /** Seqs of every ledger entry contributing (traceable to source). */
  readonly entrySeqs: readonly number[];
  readonly source: "usage-ledger";
}

export interface BurnProjectedPoint {
  readonly label: string;
  readonly units: number;
  readonly costMinor: number;
  readonly at: number;
  readonly assumption: string;
  readonly cumulativeCostMinor: number;
  readonly source: "burn-schedule";
}

export interface BudgetBurnProjection {
  readonly tenantId: string;
  readonly actuals: BurnActuals;
  readonly projected: readonly BurnProjectedPoint[];
  readonly projectedTotalCostMinor: number;
  readonly projectedTotalUnits: number;
  readonly ceilingMinor: number;
  readonly projectedRemainingMinor: number;
  readonly projectedUtilizationBps: number;
  readonly severity: "none" | "warning" | "breach";
  readonly warningThresholdBps: number;
  readonly projection: true;
  /** Every assumption verbatim, in schedule order. */
  readonly assumptions: readonly string[];
}

export type BurnProjectionResult =
  | { readonly ok: true; readonly projection: BudgetBurnProjection }
  | { readonly ok: false; readonly reasonCode: BurnProjectionReasonCode };

export type BurnProjectionReasonCode =
  | "TENANT_ID_EMPTY"
  | "TENANT_MISMATCH"
  | "EMPTY_SCHEDULE"
  | "LABEL_EMPTY"
  | "ASSUMPTION_EMPTY"
  | "NEGATIVE_UNITS"
  | "NEGATIVE_COST"
  | "NON_INTEGER_AMOUNT"
  | "NEGATIVE_CEILING"
  | "INVALID_THRESHOLD_BPS";

/**
 * projectBudgetBurn — deterministic budget-burn projection from the REAL
 * usage ledger plus a burn schedule. The actuals are the ledger's own
 * sums (with entry seqs); the projection adds the schedule points with
 * their assumptions verbatim. No randomness, no hidden inputs: identical
 * inputs produce byte-identical outputs.
 */
export function projectBudgetBurn(
  tenantId: string,
  ledger: readonly UsageLedgerEntry[],
  schedule: readonly BurnSchedulePoint[],
  options: BurnProjectionOptions,
): BurnProjectionResult {
  if (tenantId.length === 0) return { ok: false, reasonCode: "TENANT_ID_EMPTY" };
  if (!Number.isInteger(options.ceilingMinor) || options.ceilingMinor < 0) {
    return { ok: false, reasonCode: "NEGATIVE_CEILING" };
  }
  const warningThresholdBps = options.warningThresholdBps ?? 9000;
  if (
    !Number.isInteger(warningThresholdBps) ||
    warningThresholdBps < 0 ||
    warningThresholdBps > 10000
  ) {
    return { ok: false, reasonCode: "INVALID_THRESHOLD_BPS" };
  }
  if (schedule.length === 0) return { ok: false, reasonCode: "EMPTY_SCHEDULE" };
  for (const point of schedule) {
    if (point.label.length === 0) return { ok: false, reasonCode: "LABEL_EMPTY" };
    if (point.assumption.trim().length === 0) {
      return { ok: false, reasonCode: "ASSUMPTION_EMPTY" };
    }
    if (!Number.isInteger(point.units) || !Number.isInteger(point.costMinor)) {
      return { ok: false, reasonCode: "NON_INTEGER_AMOUNT" };
    }
    if (point.units < 0) return { ok: false, reasonCode: "NEGATIVE_UNITS" };
    if (point.costMinor < 0) return { ok: false, reasonCode: "NEGATIVE_COST" };
  }
  // Actuals from the REAL ledger (fail-closed on foreign tenants).
  let totalUnits = 0;
  let totalCostMinor = 0;
  const entrySeqs: number[] = [];
  for (const entry of ledger) {
    if (entry.tenantId !== tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    totalUnits += entry.units;
    totalCostMinor += entry.costMinor;
    entrySeqs.push(entry.seq);
  }
  // Projection: apply the schedule in order with running totals.
  let cumulative = totalCostMinor;
  let projectedUnits = totalUnits;
  const projected: BurnProjectedPoint[] = [];
  for (const point of schedule) {
    cumulative += point.costMinor;
    projectedUnits += point.units;
    projected.push({
      label: point.label,
      units: point.units,
      costMinor: point.costMinor,
      at: point.at,
      assumption: point.assumption,
      cumulativeCostMinor: cumulative,
      source: "burn-schedule",
    });
  }
  const projectedTotalCostMinor = cumulative;
  const projectedUtilizationBps =
    options.ceilingMinor === 0
      ? projectedTotalCostMinor > 0 ? 10000 : 0
      : Math.floor((projectedTotalCostMinor * 10000) / options.ceilingMinor);
  let severity: "none" | "warning" | "breach" = "none";
  if (projectedTotalCostMinor > options.ceilingMinor) {
    severity = "breach";
  } else if (projectedUtilizationBps >= warningThresholdBps) {
    severity = "warning";
  }
  return {
    ok: true,
    projection: {
      tenantId,
      actuals: {
        totalUnits,
        totalCostMinor,
        entrySeqs,
        source: "usage-ledger",
      },
      projected,
      projectedTotalCostMinor,
      projectedTotalUnits: projectedUnits,
      ceilingMinor: options.ceilingMinor,
      projectedRemainingMinor: options.ceilingMinor - projectedTotalCostMinor,
      projectedUtilizationBps,
      severity,
      warningThresholdBps,
      projection: true,
      assumptions: schedule.map((p) => p.assumption),
    },
  };
}
