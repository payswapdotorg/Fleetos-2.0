/**
 * @fleetos/world-model — JEPA latent counterfactuals (Wave 9, F290B).
 *
 * Intervene in LATENT space: a premise maps to a shifted embedding (either
 * explicit feature deltas, or the deterministic direction selected by the
 * premise string), the shifted latent is advanced to the horizon and
 * DECODED. The result is a full `CounterfactualScenario` whose value is an
 * `HypotheticalValue` — the Law-A11 `hypothetical: true` marker is
 * machine-carried and type-enforced by the EXISTING HYPOTHETICAL brand
 * re-exported through the world-model seam. A HYPOTHETICAL can never be
 * assigned to a `PredictedValue` (type-level law, machine-tested).
 *
 * Uncertainty: the composed widening law (./predictor.ts) widened by the
 * EXISTING A11 counterfactual widening law
 * (`widenUncertaintyForCounterfactual`, ../widening.ts, factor 2): the
 * hypothetical is LESS certain than the baseline prediction at the same
 * horizon — wider bounds, halved confidence. Machine-tested.
 *
 * Divergence accounting (mirrors the predictive reference model's
 * discipline): every payload feature carries baseline vs counterfactual
 * decoded values, the delta, and signed bps of the baseline — recorded on
 * the result, never hidden.
 *
 * Purity: no clock, no randomness, no I/O; the representation's
 * caller-supplied `computedAt` is the logical time.
 */

import type { CounterfactualScenario, WorldModelRepresentation } from "../index.ts";
import type { FeatureMap, JepaSpace, LatentVector } from "./embedding.ts";
import { canonicalJepaJson, jepaDigest } from "./embedding.ts";
import type { JepaRejection } from "./predictor.ts";
import {
  addLatents,
  jepaUncertaintyAt,
  parseJepaControls,
  round6,
  scaleLatent,
} from "./predictor.ts";
import { widenUncertaintyForCounterfactual } from "../widening.ts";

/**
 * A latent intervention. "feature-shift": the premise deltas' embedding is
 * added to the base embedding. "premise-direction": the premise string
 * deterministically selects a latent direction (the feature row for the
 * virtual name `premise#<premise>`), scaled by `scale` (default 1).
 */
export type LatentIntervention =
  | { readonly kind: "feature-shift"; readonly deltas: FeatureMap }
  | { readonly kind: "premise-direction"; readonly scale?: number };

/** One payload feature's baseline-vs-counterfactual accounting record. */
export interface LatentCounterfactualDivergence {
  readonly feature: string;
  readonly baselineValue: number;
  readonly counterfactualValue: number;
  /** counterfactual - baseline, rounded to 1e-6. */
  readonly delta: number;
  /** Signed bps of the baseline; null when baselineValue is exactly 0. */
  readonly deltaBpsOfBaseline: number | null;
}

/** A latent counterfactual: the branded scenario + the accounting artifacts. */
export interface LatentCounterfactual {
  readonly scenario: CounterfactualScenario<number>;
  readonly divergence: readonly LatentCounterfactualDivergence[];
  readonly baselineLatent: LatentVector;
  readonly counterfactualLatent: LatentVector;
  readonly intervention: LatentIntervention;
}

export type LatentCounterfactualResult =
  | { readonly ok: true; readonly counterfactual: LatentCounterfactual }
  | { readonly ok: false; readonly rejected: JepaRejection; readonly detail: string };

/**
 * Run a latent counterfactual: premise -> shifted embedding -> latent
 * rollout to the horizon -> decode -> HYPOTHETICAL brand with composed
 * (sqrt + A11 factor-2) widened uncertainty and full divergence accounting.
 */
export function latentCounterfactual(
  space: JepaSpace,
  input: {
    readonly rep: WorldModelRepresentation;
    readonly premise: string;
    readonly intervention: LatentIntervention;
    readonly horizon: number;
  },
): LatentCounterfactualResult {
  if (!Number.isInteger(input.horizon) || input.horizon < 1) {
    return { ok: false, rejected: "invalid-horizon", detail: "horizon must be an integer >= 1" };
  }
  const controls = parseJepaControls(input.rep.features);
  let shift: LatentVector;
  switch (input.intervention.kind) {
    case "feature-shift": {
      const deltaControls = parseJepaControls(input.intervention.deltas);
      for (const key of Object.keys(input.intervention.deltas)) {
        const value = (input.intervention.deltas as Record<string, number>)[key];
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return {
            ok: false,
            rejected: "invalid-intervention",
            detail: `intervention delta ${key} is not a finite number`,
          };
        }
      }
      shift = space.embedFeatures(deltaControls.payload);
      break;
    }
    case "premise-direction": {
      const scale = input.intervention.scale ?? 1;
      if (typeof scale !== "number" || !Number.isFinite(scale)) {
        return {
          ok: false,
          rejected: "invalid-intervention",
          detail: "premise-direction scale must be a finite number",
        };
      }
      shift = scaleLatent(space.featureRow(`premise#${input.premise}`), scale);
      break;
    }
    default:
      return {
        ok: false,
        rejected: "invalid-intervention",
        detail: `unknown intervention kind: ${String((input.intervention as { kind?: unknown }).kind)}`,
      };
  }

  // Baseline and intervened premises, advanced to the horizon (JEPA core:
  // the intervention happens in LATENT space, then prediction).
  const baseLatent = space.embedFeatures(controls.payload);
  const baselineLatent = space.applyDynamics(baseLatent, input.horizon);
  const counterfactualLatent = space.applyDynamics(
    addLatents(baseLatent, shift),
    input.horizon,
  );

  // Divergence accounting: baseline vs counterfactual decodes, per feature.
  const divergence: LatentCounterfactualDivergence[] = [];
  for (const key of Object.keys(controls.payload).sort()) {
    const baselineValue = round6(space.decode(baselineLatent, key));
    const counterfactualValue = round6(space.decode(counterfactualLatent, key));
    const delta = round6(counterfactualValue - baselineValue);
    const deltaBpsOfBaseline =
      baselineValue === 0 ? null : Math.round((10000 * delta) / baselineValue);
    divergence.push({ feature: key, baselineValue, counterfactualValue, delta, deltaBpsOfBaseline });
  }

  // The primary decoded hypothetical value (seam convention: smallest key).
  const keys = Object.keys(controls.payload).sort();
  const value = keys.length > 0 ? round6(space.decode(counterfactualLatent, keys[0] as string)) : 0;

  // Uncertainty: composed widening law, then the EXISTING A11 law (factor 2).
  const uncertainty = widenUncertaintyForCounterfactual(
    jepaUncertaintyAt(input.horizon, value),
    2,
  );

  const scenario: CounterfactualScenario<number> = {
    scenarioId: `jepa-cf-${input.rep.representationId}-${jepaDigest(input.premise)}`,
    premise: input.premise,
    value: {
      kind: "HYPOTHETICAL",
      value,
      uncertainty,
      premise: input.premise,
      computedAt: input.rep.computedAt,
      provenance: {
        modelVersion: space.version,
        capabilityVersion: "1.0.0",
        featureDigest: jepaDigest(canonicalJepaJson(input.rep.features)),
        inputsDigest: jepaDigest(
          `${input.rep.tenant.tenantId}|${input.rep.asset.assetId}|${input.rep.computedAt}|h=${input.horizon}|p=${jepaDigest(input.premise)}|v=${space.version}`,
        ),
      },
      tenant: input.rep.tenant,
      asset: input.rep.asset,
      hypothetical: true,
    },
    representationRef: input.rep.representationId,
  };
  return {
    ok: true,
    counterfactual: {
      scenario,
      divergence,
      baselineLatent,
      counterfactualLatent,
      intervention: input.intervention,
    },
  };
}
