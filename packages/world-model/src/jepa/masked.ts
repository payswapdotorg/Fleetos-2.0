/**
 * @fleetos/world-model — JEPA masked-latent variant, the I-JEPA analogue
 * (Wave 9, F290B).
 *
 * I-JEPA predicts the latents of MASKED input parts from the unmasked
 * context. Deterministic structural analogue (see ./embedding.ts): the
 * caller chooses a subset of feature names to mask; the variant embeds the
 * UNMASKED context, advances it one step with the SAME latent dynamics
 * operator used by the joint-embedding predictor, and decodes the masked
 * features from that context-only latent.
 *
 * HONEST divergence accounting — recorded, never hidden: for every masked
 * feature the result carries BOTH the masked prediction and the full
 * prediction (the same operator applied to the unmasked FULL feature set),
 * plus the per-feature divergence |masked - full| and the total. The
 * masked-vs-full divergence is the honest measure of the information lost
 * to masking; nothing is averaged away or silently dropped.
 *
 * Masked prediction is LESS certain than the full prediction: the decoded
 * `PredictedValue` widens the composed widening law (./predictor.ts) by
 * the lane's A11 counterfactual factor (2x) via the EXISTING
 * `widenUncertaintyForCounterfactual` law in ../widening.ts — the same
 * "less evidence, wider interval" discipline.
 *
 * Strict module surface: mask targets must exist in the payload features
 * (unknown target => rejection naming it). An empty mask is legal and
 * yields the honest zero-divergence result (masked === full decode).
 * Deterministic: no clock, no randomness, no I/O.
 */

import type { AssetRef, PredictedValue, TenantScopeLike } from "../index.ts";
import { widenUncertaintyForCounterfactual } from "../widening.ts";
import type { FeatureMap, JepaSpace, LatentVector } from "./embedding.ts";
import { canonicalJepaJson, jepaDigest } from "./embedding.ts";
import type { JepaRejection } from "./predictor.ts";
import { JEPA_VALID_UNTIL, jepaUncertaintyAt, parseJepaControls, round6 } from "./predictor.ts";

/** One masked feature's honest accounting record. */
export interface MaskedTargetAccounting {
  readonly feature: string;
  /** Decoded prediction for the masked feature from the CONTEXT-only latent. */
  readonly maskedValue: number;
  /** Decoded prediction from the FULL (unmasked) feature set — same operator. */
  readonly fullValue: number;
  /** maskedValue - fullValue, rounded to 1e-6. */
  readonly delta: number;
  /** |delta|. */
  readonly divergence: number;
  /** Signed bps of the full value; null when fullValue is exactly 0. */
  readonly deltaBpsOfFull: number | null;
}

/** The masked-latent prediction result (masked and full paths both recorded). */
export interface MaskedLatentPrediction {
  readonly contextLatent: LatentVector;
  /** The context-only latent after ONE dynamics step (the I-JEPA prediction). */
  readonly predictedLatent: LatentVector;
  /** The full-embedding latent after ONE dynamics step (the comparison path). */
  readonly fullLatent: LatentVector;
  readonly maskedFeatures: readonly string[];
  readonly contextFeatures: readonly string[];
  readonly perTarget: readonly MaskedTargetAccounting[];
  /** Sum of per-target divergences (>= 0; 0 iff every masked decode matches). */
  readonly maskedDivergenceTotal: number;
}

export type MaskedLatentResult =
  | { readonly ok: true; readonly masked: MaskedLatentPrediction }
  | { readonly ok: false; readonly rejected: JepaRejection; readonly detail: string };

/**
 * Run the masked-latent (I-JEPA) prediction with honest divergence
 * accounting. The mask is CALLER-chosen; unknown mask targets are rejected
 * naming the offender (fail-loud module surface).
 */
export function maskedLatentPrediction(
  space: JepaSpace,
  input: {
    readonly features: FeatureMap;
    readonly mask: readonly string[];
  },
): MaskedLatentResult {
  const controls = parseJepaControls(input.features);
  const payloadKeys = Object.keys(controls.payload);
  const maskSet = new Set<string>();
  for (const target of input.mask) {
    if (!Object.prototype.hasOwnProperty.call(controls.payload, target)) {
      return {
        ok: false,
        rejected: "unknown-mask-target",
        detail: `mask target "${target}" is not a payload feature (reserved jepa.* keys cannot be masked)`,
      };
    }
    maskSet.add(target);
  }

  const context: Record<string, number> = {};
  for (const key of payloadKeys) {
    if (!maskSet.has(key)) context[key] = controls.payload[key] as number;
  }

  // The I-JEPA prediction: context-only latent, ONE dynamics step.
  const contextLatent = space.embedFeatures(context);
  const predictedLatent = space.applyDynamics(contextLatent, 1);
  // The comparison path: full-embedding latent, the SAME one step.
  const fullLatent = space.applyDynamics(space.embedFeatures(controls.payload), 1);

  const maskedFeatures = [...maskSet].sort();
  const perTarget: MaskedTargetAccounting[] = [];
  let total = 0;
  for (const feature of maskedFeatures) {
    const maskedValue = round6(space.decode(predictedLatent, feature));
    const fullValue = round6(space.decode(fullLatent, feature));
    const delta = round6(maskedValue - fullValue);
    const divergence = round6(Math.abs(delta));
    const deltaBpsOfFull =
      fullValue === 0 ? null : Math.round((10000 * delta) / fullValue);
    perTarget.push({ feature, maskedValue, fullValue, delta, divergence, deltaBpsOfFull });
    total += divergence;
  }

  return {
    ok: true,
    masked: {
      contextLatent,
      predictedLatent,
      fullLatent,
      maskedFeatures,
      contextFeatures: Object.keys(context).sort(),
      perTarget,
      maskedDivergenceTotal: round6(total),
    },
  };
}

/**
 * Decode the masked prediction of the PRIMARY masked feature (the
 * lexicographically smallest masked name) into a seam-shaped
 * `PredictedValue` — the masked decode, with uncertainty widened 2x by the
 * EXISTING A11 widening law (masked prediction is less certain than the
 * full prediction at the same horizon).
 */
export function decodeMaskedPrimary(
  space: JepaSpace,
  masked: MaskedLatentPrediction,
  meta: {
    readonly tenant: TenantScopeLike;
    readonly asset: AssetRef;
    readonly computedAt: string;
  },
): PredictedValue<number> | null {
  const primary = masked.maskedFeatures.length > 0 ? (masked.maskedFeatures[0] as string) : null;
  if (primary === null) return null;
  const value = round6(space.decode(masked.predictedLatent, primary));
  const widened = widenUncertaintyForCounterfactual(jepaUncertaintyAt(1, value), 2);
  return {
    kind: "PREDICTED",
    value,
    uncertainty: widened,
    predictedAt: meta.computedAt,
    validUntil: JEPA_VALID_UNTIL,
    provenance: {
      modelVersion: space.version,
      capabilityVersion: "1.0.0",
      // Digest over the recorded accounting (masked + full + divergence):
      // the provenance covers the honest divergence record itself.
      featureDigest: jepaDigest(
        canonicalJepaJson({
          masked: masked.perTarget.map((t) => [t.feature, t.maskedValue, t.fullValue, t.delta]),
          total: masked.maskedDivergenceTotal,
        }),
      ),
      inputsDigest: jepaDigest(
        `${meta.tenant.tenantId}|${meta.asset.assetId}|${meta.computedAt}|masked|v=${space.version}`,
      ),
    },
    tenant: meta.tenant,
    asset: meta.asset,
  };
}
