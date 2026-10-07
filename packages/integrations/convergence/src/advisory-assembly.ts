/**
 * @fleetos/convergence — the advisory-loop assembly (F231, Wave 3 TL lane).
 *
 * THE sanctioned composition site for the Intelligence-Plane advisory seam
 * (F230B): world-context CONTEXT ASSEMBLY (`assembleContext` — tenant
 * fail-closed, purpose-scoped redaction, digest-stamped) over a folded
 * WORLD STATE (`foldWorldState` — the world-model pure fold over the
 * digest-chained world journal), feeding the predictive `ModelPort`
 * REFERENCE ADAPTER (`makeReferenceModelPort`) — advisory predictions with
 * provenance + integer-bps confidence.
 *
 * THE ADVISORY LAW IS STRUCTURAL HERE (packet requirement). The loop's
 * output type `AdvisoryLoopOutput`:
 *   1. carries the machine-carried `advisory: true` marker plus a
 *      unique-symbol brand (`[ADVISORY_ONLY]`) that no authoritative input
 *      shape declares — the output is not assignable to `WorldEvent`,
 *      `WorldJournalEntry`, `TwinStateInput` or `WorldEntitySnapshot`;
 *   2. contains a `Prediction`, which structurally cannot become a
 *      `TwinStateInput` (no observation-ref history) nor a `WorldEvent`
 *      (its `kind` is "PREDICTION", not a WorldEventKind) — compile-pinned
 *      by `@ts-expect-error` proofs in the test suite;
 *   3. exposes NO function that writes authoritative state — the assembly
 *      only READS the world journal and produces advisory values. Extending
 *      the world journal remains the world-model public surface
 *      (`nextWorldEntry` over `WorldEvent`), which advisory outputs cannot
 *      satisfy.
 *
 * Determinism laws: same inputs → byte-identical outputs; `now` always an
 * explicit input; no Date.now/Math.random/timers/network. Public-entry
 * imports only.
 */

import {
  isAdvisoryPrediction,
  makeReferenceModelPort,
  type ModelPort,
  type Prediction,
  type ProjectionHorizon,
} from "@fleetos/predictive";
import {
  foldWorldState,
  projectEntity,
  type EntityProjection,
  type StalenessThresholds,
  type WorldEntityView,
  type WorldJournalEntry,
} from "@fleetos/world-model";
import {
  assembleContext,
  type AssembledContext,
  type RedactionRule,
} from "@fleetos/world-context";

// ---------------------------------------------------------------------------
// The advisory brand — structural advisory-ness (law A2)
// ---------------------------------------------------------------------------

/** Module-private unique symbol: external code cannot construct the output. */
const ADVISORY_ONLY = Symbol("@fleetos/convergence:advisory-only");

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export const DEFAULT_ADVISORY_STALENESS: StalenessThresholds = {
  freshWithinMs: 60_000,
  staleWithinMs: 600_000,
};

export interface AdvisoryLoopOptions {
  /** The ModelPort adapter (default: the deterministic reference model). */
  readonly port?: ModelPort;
  /** Redaction rules (default: the world-context reference policy). */
  readonly rules?: readonly RedactionRule[];
  /** Staleness thresholds (default: DEFAULT_ADVISORY_STALENESS). */
  readonly thresholds?: StalenessThresholds;
}

export interface AdvisoryLoopRequest {
  readonly tenantId: string;
  /** The authoritative world journal (the ONLY read side of this loop). */
  readonly worldEntries: readonly WorldJournalEntry[];
  /** The entity whose metric is projected advisorially. */
  readonly entityId: string;
  readonly metric: string;
  readonly asOfMs: number;
  /** Logical now for staleness classification. */
  readonly nowMs: number;
  readonly horizon: ProjectionHorizon;
  /** Caller-supplied context stamp (logical time as a string). */
  readonly computedAt: string;
}

/**
 * The advisory loop output — ADVISORY ONLY. Branded with a unique symbol so
 * it is not assignable to any authoritative input shape, and carrying the
 * assembled context + the prediction with provenance + bps confidence.
 */
export interface AdvisoryLoopOutput {
  readonly advisory: true;
  readonly [ADVISORY_ONLY]: true;
  readonly tenantId: string;
  readonly entityId: string;
  readonly metric: string;
  readonly staleness: EntityProjection["staleness"];
  readonly ageMs: number | null;
  readonly context: AssembledContext;
  readonly prediction: Prediction;
}

export type AdvisoryRejection =
  | { readonly rejected: "missing-tenant" }
  | { readonly rejected: "world-fold"; readonly detail: string }
  | { readonly rejected: "entity-not-found"; readonly entityId: string }
  | { readonly rejected: "invalid-thresholds" }
  | { readonly rejected: "context-assembly"; readonly detail: string }
  | { readonly rejected: "projection"; readonly reason: string; readonly detail: string };

export type AdvisoryLoopResult =
  | { readonly ok: true; readonly output: AdvisoryLoopOutput }
  | { readonly ok: false; readonly rejection: AdvisoryRejection };

export interface AdvisoryLoop {
  /** Run the advisory loop — pure with respect to (loop, request). */
  run(request: AdvisoryLoopRequest): AdvisoryLoopResult;
  /** The ModelPort this loop consults (the adapter seam). */
  port(): ModelPort;
}

// ---------------------------------------------------------------------------
// The assembly
// ---------------------------------------------------------------------------

export function assembleAdvisoryLoop(options?: AdvisoryLoopOptions): AdvisoryLoop {
  const port = options?.port ?? makeReferenceModelPort();
  const rules = options?.rules;
  const thresholds = options?.thresholds ?? DEFAULT_ADVISORY_STALENESS;
  return {
    port: () => port,

    run(request: AdvisoryLoopRequest): AdvisoryLoopResult {
      if (request.tenantId === "") {
        return { ok: false, rejection: { rejected: "missing-tenant" } };
      }
      const folded = foldWorldState(request.worldEntries);
      if (!folded.ok) {
        return {
          ok: false,
          rejection: { rejected: "world-fold", detail: folded.detail },
        };
      }
      const entity = folded.state.entities.find(
        (e) => e.entityId === request.entityId,
      );
      if (!entity) {
        return {
          ok: false,
          rejection: { rejected: "entity-not-found", entityId: request.entityId },
        };
      }
      const projected = projectEntity(entity, request.nowMs, thresholds);
      if (!projected.ok) {
        return { ok: false, rejection: { rejected: "invalid-thresholds" } };
      }
      const contextResult = assembleContext({
        focus: {
          tenant: { tenantId: request.tenantId },
          entities: folded.state.entities.map((entity) =>
            snapshotOf(entity, folded.state.tenantId),
          ),
          purpose: "model-input",
        },
        ...(rules ? { rules } : {}),
        computedAt: request.computedAt,
      });
      if (!contextResult.ok) {
        return {
          ok: false,
          rejection: {
            rejected: "context-assembly",
            detail: `${contextResult.rejected}: ${contextResult.detail}`,
          },
        };
      }
      const projectedValue = port.project(
        {
          tenant: { tenantId: request.tenantId },
          asset: { assetId: request.entityId },
          metric: request.metric,
          observations: entity.observations,
          asOfMs: request.asOfMs,
        },
        request.horizon,
      );
      if (!projectedValue.ok) {
        return {
          ok: false,
          rejection: {
            rejected: "projection",
            reason: projectedValue.rejected,
            detail: projectedValue.detail,
          },
        };
      }
      return {
        ok: true,
        output: {
          advisory: true,
          [ADVISORY_ONLY]: true,
          tenantId: request.tenantId,
          entityId: request.entityId,
          metric: request.metric,
          staleness: projected.projection.staleness,
          ageMs: projected.projection.ageMs,
          context: contextResult.context,
          prediction: projectedValue.prediction,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Runtime guard (the advisory marker must survive untrusted transit)
// ---------------------------------------------------------------------------

export function isAdvisoryLoopOutput(v: unknown): v is AdvisoryLoopOutput {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as { advisory?: unknown; prediction?: unknown };
  // The outer marker AND the inner prediction's machine-carried marker must
  // both survive transit (stripped copies are rejected).
  return rec.advisory === true && isAdvisoryPrediction(rec.prediction);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Map a folded world entity into the world-context LOCAL snapshot shape. */
function snapshotOf(
  entity: WorldEntityView,
  tenantId: string,
): {
  readonly entityId: string;
  readonly entityType: "asset" | "agent" | "org";
  readonly tenantId: string;
  readonly fields: Readonly<Record<string, string | number | boolean | null>>;
  readonly lastObservationRef?: string;
  readonly lastObservedAtMs?: number;
} {
  return {
    entityId: entity.entityId,
    entityType: entity.entityType,
    tenantId,
    fields: {
      lifecycle: entity.state,
      observationCount: entity.observationCount,
      lastValue: entity.lastObservation ? entity.lastObservation.value : null,
      tags: entity.tags.join(","),
    },
    lastObservationRef: entity.lastObservation?.observationRef,
    lastObservedAtMs: entity.lastObservation?.atMs,
  };
}
