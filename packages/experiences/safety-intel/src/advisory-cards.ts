/**
 * @fleetos/experience-safety-intel — advisory-cards (F240B deliverable 4).
 *
 * Predictive/world-context advisory presentation. The ADVISORY LAW (A2, and
 * the packet's structural mandate) is enforced at the view boundary by FOUR
 * mechanisms, documented here for TL adjudication:
 *
 *  1. `advisory: true` is machine-carried on every card (and on the board):
 *     the type system cannot strip it, and the runtime guard verifies it on
 *     untrusted input (a JSON copy with the marker stripped is rejected).
 *  2. A module-private unique-symbol brand makes cards NON-CONSTRUCTIBLE
 *     outside this module — an authoritative record cannot be dressed up as
 *     a card, and a card cannot be forged from deserialized JSON.
 *  3. Compile-pinned `@ts-expect-error` proofs (tests): a card is NOT
 *     assignable to any authoritative input type (SecurityFinding,
 *     FindingIntakeCandidate, WorldEntitySnapshot, TwinStateInput) — a card
 *     feeding back as authoritative state is a TYPE ERROR.
 *  4. The card builders VERIFY the advisory marker on their INPUTS
 *     (`isAdvisoryPrediction`): a stripped prediction is refused before it
 *     can be presented.
 *
 * Confidence is surfaced as INTEGER basis points (0..10000), taken as the
 * MINIMUM across the projected points — the conservative headline. World-
 * context cards carry `confidenceBps: null` (no model confidence applies —
 * honest, never invented). Staleness classification for world-derived items
 * reuses the world-model's pure `classifyStaleness` at a caller-supplied
 * logical `nowMs`.
 *
 * Determinism: no clock, no randomness; byte-identical cards for identical
 * inputs (symbols do not serialize — JSON.stringify is the canonical form).
 */

import { isAdvisoryPrediction } from "@fleetos/predictive";
import type { Prediction } from "@fleetos/predictive";
import { classifyStaleness } from "@fleetos/world-model";
import type { StalenessClass, StalenessThresholds } from "@fleetos/world-model";
import type { AssembledContext } from "@fleetos/world-context";

/**
 * Module-private brand — cards are constructible only inside this module.
 * The symbol never serializes (JSON.stringify skips symbol keys), so the
 * brand is a COMPILE-TIME boundary only; the runtime boundary is the
 * machine-carried `advisory: true` marker verified by `isAdvisoryCard`.
 */
const advisoryCardBrand: unique symbol = Symbol("fleetos.advisory-card");

export interface AdvisoryProvenanceView {
  readonly modelVersion: string;
  readonly method: string;
  readonly observationRefs: readonly string[];
  readonly inputDigest: string;
}

export interface AdvisoryCardView {
  readonly cardId: string;
  readonly tenantId: string;
  readonly title: string;
  /** Machine-carried advisory marker (law A2) — never stripped. */
  readonly advisory: true;
  /** INTEGER basis points 0..10000; null when no model confidence applies. */
  readonly confidenceBps: number | null;
  readonly provenance: AdvisoryProvenanceView;
  readonly staleness: StalenessClass;
  readonly ageMs: number | null;
  readonly subject:
    | {
        readonly kind: "prediction";
        readonly assetId: string;
        readonly metric: string;
        readonly horizonSteps: number;
        readonly horizonStepMs: number;
        readonly headlineValue: number;
        readonly bounds: { readonly lower: number; readonly upper: number };
      }
    | {
        readonly kind: "world-context";
        readonly entityIds: readonly string[];
        readonly featureCount: number;
        readonly redactedFieldCount: number;
      };
  /** Module-private brand — see the header's mechanism 2. */
  readonly [advisoryCardBrand]: true;
}

export interface AdvisoryBoardView {
  readonly tenantId: string;
  /** Machine-carried — the board is advisory through-and-through. */
  readonly advisory: true;
  /** Ordered by cardId asc. */
  readonly cards: readonly AdvisoryCardView[];
  readonly digest: string;
}

export type AdvisoryCardRefusal =
  | "card.missing-tenant"
  | "card.no-cards"
  | "card.non-advisory-input"
  | "card.empty-projection"
  | "card.invalid-confidence-bps"
  | "card.invalid-thresholds"
  | "card.cross-tenant-card";

export type AdvisoryCardResult =
  | { readonly ok: true; readonly card: AdvisoryCardView }
  | { readonly ok: false; readonly refused: AdvisoryCardRefusal; readonly detail: string };

export type AdvisoryBoardResult =
  | { readonly ok: true; readonly board: AdvisoryBoardView }
  | { readonly ok: false; readonly refused: AdvisoryCardRefusal; readonly detail: string };

// ---------------------------------------------------------------------------
// Prediction card
// ---------------------------------------------------------------------------

export function buildPredictionAdvisoryCard(input: {
  readonly prediction: Prediction;
  /** Logical now (epoch ms) — staleness of the projection's data anchor. */
  readonly nowMs: number;
  readonly thresholds: StalenessThresholds;
}): AdvisoryCardResult {
  // Mechanism 4: verify the advisory marker on the INPUT before presenting.
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
  if (input.prediction.points.length === 0) {
    return { ok: false, refused: "card.empty-projection", detail: "prediction carries no projected points" };
  }
  for (const point of input.prediction.points) {
    if (!Number.isInteger(point.confidenceBps) || point.confidenceBps < 0 || point.confidenceBps > 10000) {
      return {
        ok: false,
        refused: "card.invalid-confidence-bps",
        detail: `projected point ${point.step} carries confidence ${point.confidenceBps} outside 0..10000 integer bps`,
      };
    }
  }
  // Staleness of the projection's data anchor (originMs — the freshest
  // input observation time the projection was anchored on).
  const classified = classifyStaleness(input.prediction.originMs, input.nowMs, input.thresholds);
  if (!classified.ok) {
    return { ok: false, refused: "card.invalid-thresholds", detail: "staleness thresholds are invalid" };
  }
  const last = input.prediction.points[input.prediction.points.length - 1]!;
  const minConfidence = input.prediction.points.reduce((min, p) => Math.min(min, p.confidenceBps), 10000);
  const card: AdvisoryCardView = {
    cardId: `advisory|pred|${tenantId}|${input.prediction.asset.assetId}|${input.prediction.metric}|${input.prediction.provenance.inputDigest}`,
    tenantId,
    title: `Predicted ${input.prediction.metric} for ${input.prediction.asset.assetId}`,
    advisory: true,
    confidenceBps: minConfidence,
    provenance: {
      modelVersion: input.prediction.provenance.modelVersion,
      method: input.prediction.provenance.method,
      observationRefs: [...input.prediction.provenance.observationRefs],
      inputDigest: input.prediction.provenance.inputDigest,
    },
    staleness: classified.staleness,
    ageMs: classified.ageMs,
    subject: {
      kind: "prediction",
      assetId: input.prediction.asset.assetId,
      metric: input.prediction.metric,
      horizonSteps: input.prediction.horizon.steps,
      horizonStepMs: input.prediction.horizon.stepMs,
      headlineValue: last.value,
      bounds: { lower: last.bounds.lower, upper: last.bounds.upper },
    },
    [advisoryCardBrand]: true,
  };
  return { ok: true, card };
}

// ---------------------------------------------------------------------------
// World-context card
// ---------------------------------------------------------------------------

export function buildWorldContextAdvisoryCard(input: {
  readonly context: AssembledContext;
  /** Logical now (epoch ms) — staleness of the freshest underlying observation. */
  readonly nowMs: number;
  readonly thresholds: StalenessThresholds;
}): AdvisoryCardResult {
  const tenantId = input.context.tenantId;
  if (tenantId === "") {
    return { ok: false, refused: "card.missing-tenant", detail: "context tenant identifier is empty" };
  }
  const observedAt = input.context.provenance
    .map((p) => p.observedAtMs)
    .filter((ms): ms is number => ms !== null);
  const freshest = observedAt.length === 0 ? null : Math.max(...observedAt);
  const classified = classifyStaleness(freshest, input.nowMs, input.thresholds);
  if (!classified.ok) {
    return { ok: false, refused: "card.invalid-thresholds", detail: "staleness thresholds are invalid" };
  }
  const card: AdvisoryCardView = {
    cardId: `advisory|ctx|${tenantId}|${input.context.digest}`,
    tenantId,
    title: `World context (${input.context.purpose}, ${input.context.entityIds.length} entities)`,
    advisory: true,
    // Honest: assembled world context carries observations, not model output
    // — no confidence applies, none is invented.
    confidenceBps: null,
    provenance: {
      modelVersion: `world-context@${input.context.schemaVersion}`,
      method: "context.assembly",
      observationRefs: input.context.provenance
        .map((p) => p.observationRef)
        .filter((ref): ref is string => ref !== null),
      inputDigest: input.context.digest,
    },
    staleness: classified.staleness,
    ageMs: classified.ageMs,
    subject: {
      kind: "world-context",
      entityIds: [...input.context.entityIds],
      featureCount: Object.keys(input.context.features).length,
      redactedFieldCount: input.context.redactedFields.length,
    },
    [advisoryCardBrand]: true,
  };
  return { ok: true, card };
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function buildAdvisoryBoard(cards: readonly AdvisoryCardView[]): AdvisoryBoardResult {
  if (cards.length === 0) {
    return { ok: false, refused: "card.no-cards", detail: "no advisory cards to present" };
  }
  const tenantId = cards[0]!.tenantId;
  if (tenantId === "") {
    return { ok: false, refused: "card.missing-tenant", detail: "first card carries an empty tenant identifier" };
  }
  for (const card of cards) {
    if (card.tenantId !== tenantId) {
      return {
        ok: false,
        refused: "card.cross-tenant-card",
        detail: `card ${card.cardId} belongs to tenant ${card.tenantId}, not ${tenantId}`,
      };
    }
  }
  const ordered = [...cards].sort((a, b) => (a.cardId < b.cardId ? -1 : 1));
  const digest = fnv1a(
    `ab|v1|${tenantId}|` +
      ordered
        .map((c) => `${c.cardId}@${c.staleness}/${c.confidenceBps ?? "na"}#${c.provenance.inputDigest}`)
        .join(","),
  );
  return {
    ok: true,
    board: { tenantId, advisory: true, cards: ordered, digest },
  };
}

// ---------------------------------------------------------------------------
// Runtime guard — the machine-carried marker verified on untrusted input
// ---------------------------------------------------------------------------

/**
 * Type guard: is this untrusted value an advisory card carrying its
 * machine-carried marker? A JSON round-trip that STRIPPED `advisory` is
 * rejected (law A2 — advisory values cannot re-enter as authoritative).
 */
export function isAdvisoryCard(v: unknown): v is AdvisoryCardView {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    c["advisory"] === true &&
    typeof c["cardId"] === "string" &&
    c["cardId"] !== "" &&
    typeof c["tenantId"] === "string" &&
    typeof c["title"] === "string" &&
    (c["confidenceBps"] === null ||
      (typeof c["confidenceBps"] === "number" && Number.isInteger(c["confidenceBps"]) &&
        c["confidenceBps"] >= 0 && c["confidenceBps"] <= 10000)) &&
    typeof c["staleness"] === "string" &&
    (c["staleness"] === "fresh" || c["staleness"] === "stale" || c["staleness"] === "unknown")
  );
}

// ---------------------------------------------------------------------------
// Deterministic digest (private FNV-1a — the lane's presentation convention)
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
