/**
 * @fleetos/experience-safety-intel — Propagated-staleness advisory cards
 * (F280B, Wave 8 lane B).
 *
 * The end of the REAL staleness chain:
 *
 *   world-model `classifyStaleness` (upstream, once, at classification time)
 *     -> predictive `propagateStaleness` (aggregate, worst-of, no re-scoring)
 *     -> THIS card (the propagated class surfaces in the advisory output).
 *
 * NO RE-SCORING, STRUCTURALLY: this builder takes NO clock input — there is
 * no `nowMs` parameter to misuse. The card's staleness is the propagation's
 * headline, verbatim; the card's ageMs is the headline input's age AT
 * CLASSIFICATION TIME. A card built any logical time later carries exactly
 * the class its inputs were classified with.
 *
 * Advisory law (A2) — same four mechanisms as the sibling advisory-cards
 * module: machine-carried `advisory: true`, module-private brand,
 * input-marker verification (`isAdvisoryPrediction`), runtime guard.
 *
 * A8: tenant fail-closed — the prediction's and the propagation's tenants
 * must match the card tenant; the propagation's own cross-tenant refusal is
 * enforced upstream (`staleness.tenant-mismatch`).
 *
 * Determinism: no clock, no randomness; byte-identical cards for identical
 * inputs (the brand symbol never serializes).
 */

import { isAdvisoryPrediction, verifyStalenessPropagation } from "@fleetos/predictive";
import type { Prediction, StalenessPropagation, StalenessClassName } from "@fleetos/predictive";

/** Module-private brand — cards are constructible only inside this module. */
const propagatedCardBrand: unique symbol = Symbol("fleetos.propagated-staleness-card");

export interface PropagatedStalenessCardView {
  readonly cardId: string;
  readonly tenantId: string;
  readonly title: string;
  /** Machine-carried advisory marker (law A2) — never stripped. */
  readonly advisory: true;
  /** INTEGER basis points 0..10000 — the MINIMUM across projected points. */
  readonly confidenceBps: number;
  /** THE PROPAGATED CLASS — surfaced verbatim, never re-scored. */
  readonly staleness: StalenessClassName;
  /** The headline input's age AT CLASSIFICATION TIME. */
  readonly ageMs: number | null;
  /** The propagation source — provenance of the staleness itself. */
  readonly stalenessSource: {
    readonly kind: "propagated";
    readonly propagationDigest: string;
    readonly inputCount: number;
    readonly headlineRef: string;
    /** Machine-carried: no re-scoring happened anywhere in the chain. */
    readonly rescored: false;
  };
  readonly provenance: {
    readonly modelVersion: string;
    readonly method: string;
    readonly observationRefs: readonly string[];
    readonly inputDigest: string;
  };
  readonly [propagatedCardBrand]: true;
}

export type PropagatedCardRefusal =
  | "card.non-advisory-input"
  | "card.missing-tenant"
  | "card.tenant-mismatch"
  | "card.empty-projection"
  | "card.propagation-integrity";

export type PropagatedCardResult =
  | { readonly ok: true; readonly card: PropagatedStalenessCardView }
  | { readonly ok: false; readonly refused: PropagatedCardRefusal; readonly detail: string };

/**
 * Build an advisory card whose staleness is the PROPAGATED class.
 *
 * NOTE: there is deliberately no `nowMs` parameter — the structural proof
 * that this card path never re-scores staleness.
 */
export function buildPropagatedStalenessAdvisoryCard(input: {
  readonly prediction: Prediction;
  readonly propagation: StalenessPropagation;
}): PropagatedCardResult {
  if (!isAdvisoryPrediction(input.prediction)) {
    return {
      ok: false,
      refused: "card.non-advisory-input",
      detail: "prediction input does not carry the machine-carried advisory marker",
    };
  }
  const tenantId = input.prediction.tenant.tenantId;
  if (tenantId === "") {
    return { ok: false, refused: "card.missing-tenant", detail: "prediction tenant identifier is empty" };
  }
  if (input.propagation.tenantId !== tenantId) {
    return {
      ok: false,
      refused: "card.tenant-mismatch",
      detail: `propagation belongs to tenant ${input.propagation.tenantId}, prediction to ${tenantId}`,
    };
  }
  if (input.prediction.points.length === 0) {
    return { ok: false, refused: "card.empty-projection", detail: "prediction carries no projected points" };
  }
  // The propagation itself must verify (digest + honest headline) — a forged
  // "fresh" stamp over stale inputs never reaches a card.
  const integrity = verifyStalenessPropagation(input.propagation);
  if (!integrity.verified) {
    return {
      ok: false,
      refused: "card.propagation-integrity",
      detail: `staleness propagation failed integrity: ${integrity.reason}`,
    };
  }
  const minConfidence = input.prediction.points.reduce(
    (min, p) => Math.min(min, p.confidenceBps), 10_000,
  );
  const card: PropagatedStalenessCardView = {
    cardId: `advisory|prop|${tenantId}|${input.prediction.asset.assetId}|${input.prediction.metric}|${input.propagation.propagationDigest}`,
    tenantId,
    title: `Predicted ${input.prediction.metric} for ${input.prediction.asset.assetId} (input staleness: ${input.propagation.headline})`,
    advisory: true,
    confidenceBps: minConfidence,
    staleness: input.propagation.headline,
    ageMs: input.propagation.headlineAgeMs,
    stalenessSource: {
      kind: "propagated",
      propagationDigest: input.propagation.propagationDigest,
      inputCount: input.propagation.inputs.length,
      headlineRef: input.propagation.headlineRef,
      rescored: false,
    },
    provenance: {
      modelVersion: input.prediction.provenance.modelVersion,
      method: input.prediction.provenance.method,
      observationRefs: [...input.prediction.provenance.observationRefs],
      inputDigest: input.prediction.provenance.inputDigest,
    },
    [propagatedCardBrand]: true,
  };
  return { ok: true, card };
}

/**
 * Runtime guard: an untrusted value is a propagated-staleness card only if it
 * carries the machine-carried advisory marker, a valid staleness class, and
 * a `rescored: false` staleness source.
 */
export function isPropagatedStalenessCard(v: unknown): v is PropagatedStalenessCardView {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    c["advisory"] === true &&
    typeof c["cardId"] === "string" &&
    c["cardId"] !== "" &&
    typeof c["tenantId"] === "string" &&
    (c["staleness"] === "fresh" || c["staleness"] === "stale" || c["staleness"] === "unknown") &&
    typeof c["stalenessSource"] === "object" &&
    c["stalenessSource"] !== null &&
    (c["stalenessSource"] as Record<string, unknown>)["rescored"] === false &&
    (c["stalenessSource"] as Record<string, unknown>)["kind"] === "propagated"
  );
}
