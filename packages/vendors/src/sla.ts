/**
 * @fleetos/vendors — SLA contract math: SLA definitions as DATA,
 * deterministic SLA evaluation over the REAL fulfillment/order history
 * with exact breach evidence records, and vendor SLA scorecards that are
 * verbatim-by-reference from the evaluation output (never recomputed).
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A1 (the evaluation is the SLA accounting authority), A4 (breaches
 * are reported exactly — never clamped), A8 (tenant-scoped, fail-closed),
 * A19 (tamper-evident evaluation digest), A20.
 *
 * NO FLOATS in outputs: availability and penalties are integer basis
 * points. Time is an explicit `number` input (logical time).
 *
 * Semantics (documented laws):
 *   - AVAILABILITY is the fill-rate: an SLA's availabilityBps is
 *     floor(quantityReceivedTotal * 10000 / quantityOrderedTotal) over
 *     the evaluated outcomes (10000 when nothing was ordered). This is
 *     deliberately DISTINCT from response time: an order can be on time
 *     but short-shipped — that is an availability miss, not a breach.
 *   - A breach is any outcome with deliveredAt > promisedAt. Its band is
 *     the FIRST band (ascending maxLatenessMs) with latenessMs <=
 *     maxLatenessMs; lateness beyond the last band falls into the LAST
 *     band (the terminal band is the catch-all by construction).
 *   - The penalty is the SUM of breach penaltyBps, capped at
 *     creditCapBps (capApplied records the capping honestly).
 *   - The evaluation window filters outcomes by promisedAt inclusively:
 *     [effectiveFrom, effectiveTo] (null = unbounded on that side).
 *   - A scorecard is built ONLY from an SlaEvaluation value — it carries
 *     the evaluation digest and reuses the breach evidence array BY
 *     REFERENCE. There is no code path that recomputes scorecard numbers
 *     from history.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { FulfillmentOutcomeRecord } from "./capability-catalog.js";

// ---------------------------------------------------------------------------
// SLA definitions — DATA.
// ---------------------------------------------------------------------------

/** One response-time band: lateness up to maxLatenessMs costs penaltyBps. */
export interface SlaResponseBand {
  readonly bandId: string;
  /** Upper bound (inclusive) on lateness in ms. Bands ascend strictly. */
  readonly maxLatenessMs: number;
  /** Penalty in integer basis points (0..10000). */
  readonly penaltyBps: number;
}

/** An SLA contract — pure data. No behavior, no computation. */
export interface SlaDefinition {
  readonly slaId: string;
  readonly tenant: TenantScope;
  readonly vendorId: string;
  /** Availability target in integer basis points (0..10000). */
  readonly availabilityTargetBps: number;
  /** Response-time bands, ascending by maxLatenessMs; the last is the catch-all. */
  readonly responseBands: readonly SlaResponseBand[];
  /** Total penalty cap in integer basis points (0..10000). */
  readonly creditCapBps: number;
  /** Inclusive evaluation window start (promisedAt >= from); null = unbounded. */
  readonly effectiveFrom: number | null;
  /** Inclusive evaluation window end (promisedAt <= to); null = unbounded. */
  readonly effectiveTo: number | null;
}

export type SlaDefinitionValidation =
  | { readonly ok: true; readonly definition: SlaDefinition }
  | { readonly ok: false; readonly reasonCode: SlaDefinitionReasonCode };

export type SlaDefinitionReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "SLA_ID_EMPTY"
  | "VENDOR_ID_EMPTY"
  | "NO_RESPONSE_BANDS"
  | "BAND_ID_EMPTY"
  | "BAND_ID_DUPLICATE"
  | "INVALID_BAND_ORDER"
  | "INVALID_LATENESS_MS"
  | "INVALID_PENALTY_BPS"
  | "INVALID_CREDIT_CAP_BPS"
  | "INVALID_AVAILABILITY_TARGET"
  | "INVALID_WINDOW";

/**
 * validateSlaDefinition — structural validation of an SLA definition.
 * Bands must be non-empty, strictly ascending in maxLatenessMs (> 0),
 * with unique non-empty ids; every bps field must be an integer in
 * [0, 10000]; effectiveFrom <= effectiveTo when both are set.
 */
export function validateSlaDefinition(definition: SlaDefinition): SlaDefinitionValidation {
  const tenantCheck = validateTenantScope(definition.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (definition.slaId.length === 0) {
    return { ok: false, reasonCode: "SLA_ID_EMPTY" };
  }
  if (definition.vendorId.length === 0) {
    return { ok: false, reasonCode: "VENDOR_ID_EMPTY" };
  }
  if (definition.responseBands.length === 0) {
    return { ok: false, reasonCode: "NO_RESPONSE_BANDS" };
  }
  const seenBandIds = new Set<string>();
  let previousMax: number | null = null;
  for (const band of definition.responseBands) {
    if (band.bandId.length === 0) return { ok: false, reasonCode: "BAND_ID_EMPTY" };
    if (seenBandIds.has(band.bandId)) {
      return { ok: false, reasonCode: "BAND_ID_DUPLICATE" };
    }
    seenBandIds.add(band.bandId);
    if (!Number.isInteger(band.maxLatenessMs) || band.maxLatenessMs <= 0) {
      return { ok: false, reasonCode: "INVALID_LATENESS_MS" };
    }
    if (previousMax !== null && band.maxLatenessMs <= previousMax) {
      return { ok: false, reasonCode: "INVALID_BAND_ORDER" };
    }
    previousMax = band.maxLatenessMs;
    if (!Number.isInteger(band.penaltyBps) || band.penaltyBps < 0 || band.penaltyBps > 10000) {
      return { ok: false, reasonCode: "INVALID_PENALTY_BPS" };
    }
  }
  if (
    !Number.isInteger(definition.creditCapBps) ||
    definition.creditCapBps < 0 ||
    definition.creditCapBps > 10000
  ) {
    return { ok: false, reasonCode: "INVALID_CREDIT_CAP_BPS" };
  }
  if (
    !Number.isInteger(definition.availabilityTargetBps) ||
    definition.availabilityTargetBps < 0 ||
    definition.availabilityTargetBps > 10000
  ) {
    return { ok: false, reasonCode: "INVALID_AVAILABILITY_TARGET" };
  }
  if (
    definition.effectiveFrom !== null &&
    definition.effectiveTo !== null &&
    definition.effectiveFrom > definition.effectiveTo
  ) {
    return { ok: false, reasonCode: "INVALID_WINDOW" };
  }
  return { ok: true, definition };
}

// ---------------------------------------------------------------------------
// SLA evaluation over the real fulfillment/order history.
// ---------------------------------------------------------------------------

/** Exact breach evidence: which order, which band, which penalty. */
export interface SlaBreachEvidence {
  readonly orderId: string;
  readonly bandId: string;
  readonly latenessMs: number;
  readonly penaltyBps: number;
  readonly promisedAt: number;
  readonly deliveredAt: number;
}

/** The evaluation output — the ONLY input a scorecard may be built from. */
export interface SlaEvaluation {
  readonly slaId: string;
  readonly vendorId: string;
  readonly tenant: TenantScope;
  readonly evaluatedAt: number;
  readonly outcomeCount: number;
  readonly onTimeCount: number;
  /** Fill-rate availability: floor(receivedTotal * 10000 / orderedTotal). */
  readonly availabilityBps: number;
  readonly availabilityTargetBps: number;
  readonly availabilityMet: boolean;
  readonly breaches: readonly SlaBreachEvidence[];
  readonly totalPenaltyBpsUncapped: number;
  /** min(totalPenaltyBpsUncapped, creditCapBps). */
  readonly totalPenaltyBps: number;
  readonly creditCapBps: number;
  readonly capApplied: boolean;
  readonly digest: string;
}

export type SlaEvaluationResult =
  | { readonly ok: true; readonly evaluation: SlaEvaluation }
  | { readonly ok: false; readonly reasonCode: SlaEvaluationReasonCode };

/** Definition structural problems propagate verbatim from validation. */
export type SlaEvaluationReasonCode =
  | SlaDefinitionReasonCode
  | "TENANT_MISMATCH"
  | "VENDOR_MISMATCH"
  | "EMPTY_SLA_HISTORY"
  | "NEGATIVE_QUANTITY";

/**
 * evaluateSla — deterministic SLA evaluation over the vendor's REAL
 * fulfillment/order history (FulfillmentOutcomeRecord — the same record
 * the KPI rollups consume). Fail-closed (law A8, F280C hardening): an
 * outcome from another tenant or another vendor REFUSES the evaluation —
 * foreign records are never silently filtered. The caller-supplied `now`
 * is recorded as evaluatedAt (logical time).
 */
export function evaluateSla(
  tenant: TenantScope,
  definition: SlaDefinition,
  outcomes: readonly FulfillmentOutcomeRecord[],
  now: number,
): SlaEvaluationResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const defCheck = validateSlaDefinition(definition);
  if (!defCheck.ok) {
    return { ok: false, reasonCode: defCheck.reasonCode };
  }
  if (tenantCheck.scope.tenantId !== definition.tenant.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  const scoped: FulfillmentOutcomeRecord[] = [];
  for (const outcome of outcomes) {
    const oTenant = validateTenantScope(outcome.tenant);
    if (!oTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (oTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    if (outcome.vendorId !== definition.vendorId) {
      return { ok: false, reasonCode: "VENDOR_MISMATCH" };
    }
    if (
      !Number.isInteger(outcome.quantityOrdered) ||
      outcome.quantityOrdered < 0 ||
      !Number.isInteger(outcome.quantityReceived) ||
      outcome.quantityReceived < 0
    ) {
      return { ok: false, reasonCode: "NEGATIVE_QUANTITY" };
    }
    if (definition.effectiveFrom !== null && outcome.promisedAt < definition.effectiveFrom) {
      continue;
    }
    if (definition.effectiveTo !== null && outcome.promisedAt > definition.effectiveTo) {
      continue;
    }
    scoped.push(outcome);
  }
  if (scoped.length === 0) {
    return { ok: false, reasonCode: "EMPTY_SLA_HISTORY" };
  }
  const bands = definition.responseBands;
  let onTimeCount = 0;
  let quantityOrderedTotal = 0;
  let quantityReceivedTotal = 0;
  const breaches: SlaBreachEvidence[] = [];
  for (const outcome of scoped) {
    quantityOrderedTotal += outcome.quantityOrdered;
    quantityReceivedTotal += outcome.quantityReceived;
    const latenessMs = outcome.deliveredAt - outcome.promisedAt;
    if (latenessMs <= 0) {
      onTimeCount += 1;
      continue;
    }
    let band = bands[bands.length - 1];
    for (const candidate of bands) {
      if (latenessMs <= candidate.maxLatenessMs) {
        band = candidate;
        break;
      }
    }
    if (band === undefined) {
      return { ok: false, reasonCode: "EMPTY_SLA_HISTORY" };
    }
    breaches.push({
      orderId: outcome.orderId,
      bandId: band.bandId,
      latenessMs,
      penaltyBps: band.penaltyBps,
      promisedAt: outcome.promisedAt,
      deliveredAt: outcome.deliveredAt,
    });
  }
  const availabilityBps =
    quantityOrderedTotal === 0
      ? 10000
      : Math.floor((quantityReceivedTotal * 10000) / quantityOrderedTotal);
  const totalPenaltyBpsUncapped = breaches.reduce((acc, b) => acc + b.penaltyBps, 0);
  const totalPenaltyBps = Math.min(totalPenaltyBpsUncapped, definition.creditCapBps);
  const evaluation: SlaEvaluation = {
    slaId: definition.slaId,
    vendorId: definition.vendorId,
    tenant: tenantCheck.scope,
    evaluatedAt: now,
    outcomeCount: scoped.length,
    onTimeCount,
    availabilityBps,
    availabilityTargetBps: definition.availabilityTargetBps,
    availabilityMet: availabilityBps >= definition.availabilityTargetBps,
    breaches,
    totalPenaltyBpsUncapped,
    totalPenaltyBps,
    creditCapBps: definition.creditCapBps,
    capApplied: totalPenaltyBpsUncapped > definition.creditCapBps,
    digest: slaEvaluationDigest(definition.slaId, definition.vendorId, tenantCheck.scope.tenantId, now, scoped.length, onTimeCount, breaches, totalPenaltyBps),
  };
  return { ok: true, evaluation };
}

// ---------------------------------------------------------------------------
// Evaluation digest (FNV-1a, the lane convention — tamper-evident).
// ---------------------------------------------------------------------------

export function slaEvaluationDigest(
  slaId: string,
  vendorId: string,
  tenantId: string,
  evaluatedAt: number,
  outcomeCount: number,
  onTimeCount: number,
  breaches: readonly SlaBreachEvidence[],
  totalPenaltyBps: number,
): string {
  const parts: string[] = [
    slaId,
    vendorId,
    tenantId,
    String(evaluatedAt),
    String(outcomeCount),
    String(onTimeCount),
    String(totalPenaltyBps),
  ];
  for (const b of breaches) {
    parts.push(b.orderId, b.bandId, String(b.latenessMs), String(b.penaltyBps));
  }
  const joined = parts.join("\u241f");
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `sla_${hash.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// SLA scorecards — verbatim by reference from the evaluation output.
// ---------------------------------------------------------------------------

export type SlaScorecardStatus = "compliant" | "penalty" | "availability-breach";

export interface SlaScorecard {
  readonly slaId: string;
  readonly vendorId: string;
  readonly tenant: TenantScope;
  /** Verbatim reference to the evaluation this scorecard was built from. */
  readonly evaluationDigest: string;
  readonly evaluatedAt: number;
  readonly availabilityBps: number;
  readonly availabilityTargetBps: number;
  readonly availabilityMet: boolean;
  readonly breachCount: number;
  readonly totalPenaltyBps: number;
  readonly capApplied: boolean;
  readonly status: SlaScorecardStatus;
  /**
   * The evaluation's breach evidence array, carried BY REFERENCE — the
   * scorecard never recomputes, copies or reorders evidence.
   */
  readonly breachEvidence: readonly SlaBreachEvidence[];
}

export type SlaScorecardResult =
  | { readonly ok: true; readonly scorecard: SlaScorecard }
  | { readonly ok: false; readonly reasonCode: SlaScorecardReasonCode };

export type SlaScorecardReasonCode = "TENANT_SCOPE_MISSING" | "TENANT_MISMATCH";

/**
 * buildSlaScorecard — builds a vendor SLA scorecard from an EXISTING
 * SlaEvaluation. The ONLY accepted input is the evaluation output (there
 * is no overload that takes history — a scorecard can never be recomputed
 * from source records by construction). Every number is copied verbatim
 * from the evaluation; the breach evidence array is reused BY REFERENCE.
 * Fail-closed: a scorecard may only be read by the evaluation's tenant.
 */
export function buildSlaScorecard(
  tenant: TenantScope,
  evaluation: SlaEvaluation,
): SlaScorecardResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const evalTenant = validateTenantScope(evaluation.tenant);
  if (!evalTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (tenantCheck.scope.tenantId !== evalTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  let status: SlaScorecardStatus = "compliant";
  if (evaluation.breaches.length > 0) {
    status = "penalty";
  } else if (!evaluation.availabilityMet) {
    status = "availability-breach";
  }
  return {
    ok: true,
    scorecard: {
      slaId: evaluation.slaId,
      vendorId: evaluation.vendorId,
      tenant: tenantCheck.scope,
      evaluationDigest: evaluation.digest,
      evaluatedAt: evaluation.evaluatedAt,
      availabilityBps: evaluation.availabilityBps,
      availabilityTargetBps: evaluation.availabilityTargetBps,
      availabilityMet: evaluation.availabilityMet,
      breachCount: evaluation.breaches.length,
      totalPenaltyBps: evaluation.totalPenaltyBps,
      capApplied: evaluation.capApplied,
      status,
      breachEvidence: evaluation.breaches,
    },
  };
}
