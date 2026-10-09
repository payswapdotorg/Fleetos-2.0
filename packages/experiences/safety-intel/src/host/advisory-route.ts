/**
 * @fleetos/experience-safety-intel — host advisory-board route view (F300B
 * deliverable 4, route "advisory-board").
 *
 * Presentation read-model composing the REAL advisory card builders over the
 * REAL @fleetos/predictive / @fleetos/world-context outputs, plus the
 * PREDICTIVE HONESTY layer:
 *
 *  - every card carries `advisory: true` (machine-carried, upstream law A2);
 *  - every card is joined with a `ModelHonestyDisclosure` — model identity,
 *    method, uncertainty (integer bps / honest null), and the MACHINE-
 *    READABLE class (`deterministic-structural-reference` vs
 *    `trained-validated`) via the fail-closed `classifyModelHonesty`;
 *  - the registry view (structural/reference vs honestly-empty trained list)
 *    is carried on the route so the shell can render "no trained/validated
 *    models shipped" verbatim;
 *  - HONEST EMPTY: zero cards compose an explicit `composed: false` view —
 *    the board is never fabricated from nothing.
 *
 * Tenant fail-closed (A8): a cross-tenant prediction or world context
 * refuses the WHOLE route view, offender named. Determinism: derived
 * orderings only (the board's cardId ordering, registry order).
 */

import { buildAdvisoryBoard, buildPredictionAdvisoryCard, buildWorldContextAdvisoryCard } from "../advisory-cards.ts";
import type { AdvisoryBoardView, AdvisoryCardView } from "../advisory-cards.ts";
import { classifyModelHonesty, modelHonestyRegistryView } from "./honesty.ts";
import type { ModelHonestyDisclosure, ModelRegistryEntryView } from "./honesty.ts";
import type { HostRouteId } from "./contract.ts";
import type { Prediction } from "@fleetos/predictive";
import type { AssembledContext } from "@fleetos/world-context";
import type { StalenessThresholds } from "@fleetos/world-model";

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface CardHonestyEntryView {
  readonly cardId: string;
  /** Uncertainty surfaced: integer bps, or honest null (no model confidence). */
  readonly confidenceBps: number | null;
  readonly staleness: AdvisoryCardView["staleness"];
  readonly modelIdentity: {
    readonly modelVersion: string;
    readonly method: string;
    readonly modelClass: ModelHonestyDisclosure["modelClass"];
    readonly trainedValidated: boolean;
    readonly structuralAnalogue: boolean;
  };
}

export interface AdvisoryBoardRouteView {
  readonly routeId: HostRouteId;
  /** Composed discriminant (the not-composed variant carries false). */
  readonly composed: true;
  /** Machine-carried — the whole route is advisory through-and-through. */
  readonly advisory: true;
  readonly board: AdvisoryBoardView;
  /** Per-card honesty entries, ordered by the board's card order. */
  readonly cardHonesty: readonly CardHonestyEntryView[];
  /** The machine-readable model registry (structural/reference + trained lists). */
  readonly modelRegistry: {
    readonly structuralReference: readonly ModelRegistryEntryView[];
    readonly trainedValidated: readonly ModelRegistryEntryView[];
  };
}

export interface AdvisoryRouteNotComposed {
  readonly routeId: HostRouteId;
  /** Machine-carried even when not composed — the route is advisory regardless. */
  readonly advisory: true;
  readonly composed: false;
  readonly reason: "no-advisory-cards";
  readonly modelRegistry: {
    readonly structuralReference: readonly ModelRegistryEntryView[];
    readonly trainedValidated: readonly ModelRegistryEntryView[];
  };
}

export type AdvisoryBoardRouteResult =
  | { readonly ok: true; readonly view: AdvisoryBoardRouteView }
  | { readonly ok: true; readonly view: AdvisoryRouteNotComposed }
  | { readonly ok: false; readonly refused: AdvisoryRouteRefusal; readonly detail: string };

export type AdvisoryRouteRefusal =
  | "advisory.missing-tenant"
  | "advisory.cross-tenant-prediction"
  | "advisory.cross-tenant-context"
  | "advisory.card-refused"
  | "advisory.board-refused"
  | "advisory.model-honesty-refused";

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildAdvisoryBoardRouteView(input: {
  readonly tenantId: string;
  readonly nowMs: number;
  readonly thresholds: StalenessThresholds;
  readonly predictions: readonly Prediction[];
  readonly worldContexts: readonly AssembledContext[];
}): AdvisoryBoardRouteResult {
  if (input.tenantId === "") {
    return { ok: false, refused: "advisory.missing-tenant", detail: "tenant identifier is empty" };
  }
  for (const p of input.predictions) {
    if (p.tenant.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "advisory.cross-tenant-prediction",
        detail: `prediction for asset ${p.asset.assetId} belongs to tenant ${p.tenant.tenantId}, not ${input.tenantId}`,
      };
    }
  }
  for (const c of input.worldContexts) {
    if (c.tenantId !== input.tenantId) {
      return {
        ok: false,
        refused: "advisory.cross-tenant-context",
        detail: `assembled context ${c.digest} belongs to tenant ${c.tenantId}, not ${input.tenantId}`,
      };
    }
  }

  const cards: AdvisoryCardView[] = [];
  for (const prediction of input.predictions) {
    const card = buildPredictionAdvisoryCard({
      prediction,
      nowMs: input.nowMs,
      thresholds: input.thresholds,
    });
    if (!card.ok) {
      return { ok: false, refused: "advisory.card-refused", detail: `prediction card refused: ${card.refused} (${card.detail})` };
    }
    cards.push(card.card);
  }
  for (const context of input.worldContexts) {
    const card = buildWorldContextAdvisoryCard({
      context,
      nowMs: input.nowMs,
      thresholds: input.thresholds,
    });
    if (!card.ok) {
      return { ok: false, refused: "advisory.card-refused", detail: `context card refused: ${card.refused} (${card.detail})` };
    }
    cards.push(card.card);
  }
  if (cards.length === 0) {
    // HONEST EMPTY: no cards to present — never a fabricated board.
    return {
      ok: true,
      view: {
        routeId: "advisory-board",
        advisory: true,
        composed: false,
        reason: "no-advisory-cards",
        modelRegistry: modelHonestyRegistryView(),
      },
    };
  }
  const board = buildAdvisoryBoard(cards);
  if (!board.ok) {
    return { ok: false, refused: "advisory.board-refused", detail: `board refused: ${board.refused} (${board.detail})` };
  }

  // The honesty join — FAIL-CLOSED per card: an unknown model identity
  // refuses the whole route (never rendered without its honest class).
  const cardHonesty: CardHonestyEntryView[] = [];
  for (const card of board.board.cards) {
    const honesty = classifyModelHonesty({
      modelVersion: card.provenance.modelVersion,
      method: card.provenance.method,
    });
    if (!honesty.ok) {
      return {
        ok: false,
        refused: "advisory.model-honesty-refused",
        detail: `card ${card.cardId}: ${honesty.refused} (${honesty.detail})`,
      };
    }
    cardHonesty.push({
      cardId: card.cardId,
      confidenceBps: card.confidenceBps,
      staleness: card.staleness,
      modelIdentity: {
        modelVersion: honesty.disclosure.modelVersion,
        method: honesty.disclosure.method,
        modelClass: honesty.disclosure.modelClass,
        trainedValidated: honesty.disclosure.trainedValidated,
        structuralAnalogue: honesty.disclosure.structuralAnalogue,
      },
    });
  }

  return {
    ok: true,
    view: {
      routeId: "advisory-board",
      composed: true,
      advisory: true,
      board: board.board,
      cardHonesty,
      modelRegistry: modelHonestyRegistryView(),
    },
  };
}
