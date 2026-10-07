/**
 * @fleetos/world-model — predictive integration bridge (Wave 3, F230B).
 *
 * Predictive integration is TYPE-ONLY from `@fleetos/predictive` (intra-lane,
 * established): `askWorldProjection` maps a world entity's observation log
 * into a `TwinStateInput` and hands it to any `ModelPort`. LAW: the result is
 * ADVISORY — it carries `advisory: true`, and nothing in this module feeds a
 * projection back into the world journal or into authoritative state.
 *
 * The predictive seam types are re-exported here (as the pre-split module
 * did) so the `@fleetos/world-model/world-fold` subpath surface stays
 * symbol-for-symbol identical.
 *
 * Deterministic: no clock, no randomness, no I/O.
 *
 * Split note (F230B lint conformance): this moved verbatim from
 * `../world-fold.ts` (now the subpath barrel) to keep every src file under
 * the repo's max-lines lint budget — zero behavior change.
 */

import type {
  ModelPort,
  ProjectionHorizon,
  ProjectionResult,
  TwinStateInput,
} from "@fleetos/predictive";
import type { WorldEntityView } from "./journal.ts";

export type { ModelPort, ProjectionHorizon, ProjectionResult, TwinStateInput };

// ---------------------------------------------------------------------------
// Predictive integration (advisory; ModelPort supplied by the caller)
// ---------------------------------------------------------------------------

/**
 * Ask a ModelPort for a forward projection of a world entity's observation
 * log. The result is ADVISORY (law: predictive output is never
 * authoritative) — it is never folded back into the world journal.
 */
export function askWorldProjection(input: {
  readonly tenantId: string;
  readonly entity: WorldEntityView;
  readonly metric: string;
  readonly asOfMs: number;
  readonly horizon: ProjectionHorizon;
  readonly port: ModelPort;
}): ProjectionResult {
  const twinInput: TwinStateInput = {
    tenant: { tenantId: input.tenantId },
    asset: { assetId: input.entity.entityId },
    metric: input.metric,
    observations: input.entity.observations,
    asOfMs: input.asOfMs,
  };
  return input.port.project(twinInput, input.horizon);
}
