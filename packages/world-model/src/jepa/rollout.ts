/**
 * @fleetos/world-model — JEPA temporal rollout variant, the V-JEPA
 * analogue (Wave 9, F290B).
 *
 * V-JEPA predicts futures by rolling a latent forward in TIME. Deterministic
 * structural analogue (see ./embedding.ts): the rollout is seeded from a
 * WINDOW of feature frames (the world-context window — see the test
 * composition, which binds the REAL @fleetos/world-context public assembly
 * and windowing surfaces to produce the frames; this module consumes the
 * window as a LOCAL structural shape, keeping src free of cross-context
 * runtime imports — the binding is a test/composition-site concern).
 *
 * Seeding: z0 = embedding of the LAST frame. Latent velocity v = last
 * embedding minus the previous frame's embedding (a finite difference in
 * latent space); a single-frame window has NO velocity information and
 * honestly uses v = 0 (documented, machine-tested).
 *
 * Rollout law: z_{k} = A z_{k-1} + v for k = 1..H, where A is the
 * NON-EXPANDING dynamics operator (proof in ./embedding.ts).
 *
 * DIVERGENCE ACCOUNTING — the law, stated and proven:
 *   1. ACCUMULATED truth divergence is MONOTONE NON-DECREASING in k by
 *      construction: cumulative(k) = sum_{j<=k} ||embed(truth_j) - z_j||,
 *      a running sum of non-negative norms. (State: MONOTONE.)
 *   2. The latent RADIUS is EXPLICITLY BOUNDED: ||z_k|| <= ||z_0|| + k*||v||
 *      — PROOF: ||A z|| <= ||z|| (non-expansion, ./embedding.ts) plus the
 *      triangle inequality, by induction on k. In particular v = 0 makes
 *      ||z_k|| non-increasing in k. (State: BOUNDED, machine-tested.)
 *
 * When truth frames are supplied (exactly H frames, steps 1..H in order —
 * strictly validated), every per-step record carries the truth divergence
 * and the running total; without truth, the per-step records carry the
 * latent radius and step-to-step delta norms (the self-divergence view).
 * Nothing is hidden: every number is recorded on the step records.
 *
 * Purity: no clock, no randomness, no I/O; frames' feature maps pass the
 * same reserved-key discipline as every other JEPA input.
 */

import type { AssetRef, PredictedValue, TenantScopeLike } from "../index.ts";
import type { FeatureMap, JepaSpace, LatentVector } from "./embedding.ts";
import { canonicalJepaJson, jepaDigest, latentL2, latentNorm } from "./embedding.ts";
import type { JepaRejection } from "./predictor.ts";
import {
  JEPA_VALID_UNTIL,
  addLatents,
  jepaUncertaintyAt,
  parseJepaControls,
  round6,
  subtractLatents,
} from "./predictor.ts";

/** One frame of a world-context window (LOCAL structural shape). */
export interface LatentWindowFrame {
  /** Window ordinal; strictly increasing across the window. */
  readonly step: number;
  readonly features: FeatureMap;
}

/** Per-step rollout record — every number recorded, nothing hidden. */
export interface RolloutStepRecord {
  readonly step: number;
  readonly latent: LatentVector;
  /** ||z_k|| (the radius — bounded per the law above). */
  readonly radius: number;
  /** ||z_k - z_{k-1}|| (the step-to-step latent delta). */
  readonly stepDelta: number;
  /** The truth latent at this step (present iff truth frames supplied). */
  readonly truthLatent?: LatentVector;
  /** ||embed(truth_k) - z_k|| (present iff truth frames supplied). */
  readonly truthDivergence?: number;
  /** Running sum of truth divergences (monotone non-decreasing by law 1). */
  readonly cumulativeTruthDivergence?: number;
}

/** The rollout result. */
export interface LatentRollout {
  readonly seedLatent: LatentVector;
  /** The latent velocity from the window's finite difference (0 for single frames). */
  readonly velocity: LatentVector;
  readonly velocityNorm: number;
  readonly windowFrameCount: number;
  readonly steps: readonly RolloutStepRecord[];
  readonly finalLatent: LatentVector;
  /** The seam-shaped decode of the final latent (primary feature of the last frame). */
  readonly predicted: PredictedValue<number>;
  readonly horizon: number;
  /** The explicit bound at the final step: ||z_0|| + H*||v|| (law 2). */
  readonly radiusBoundAtFinal: number;
  readonly spaceVersion: string;
}

export type LatentRolloutResult =
  | { readonly ok: true; readonly rollout: LatentRollout }
  | { readonly ok: false; readonly rejected: JepaRejection; readonly detail: string };

/**
 * Roll the latent forward from a world-context window. Strict validation:
 * the window must be non-empty with strictly increasing steps, the horizon
 * an integer >= 1, and truth (when supplied) exactly `horizon` frames with
 * steps 1..horizon in order.
 */
export function rollLatentWindow(
  space: JepaSpace,
  input: {
    readonly tenant: TenantScopeLike;
    readonly asset: AssetRef;
    readonly frames: readonly LatentWindowFrame[];
    readonly horizon: number;
    /** Optional actual future frames for divergence accounting. */
    readonly truth?: readonly LatentWindowFrame[];
    readonly computedAt: string;
  },
): LatentRolloutResult {
  if (input.frames.length === 0) {
    return { ok: false, rejected: "empty-window", detail: "window contains no frames" };
  }
  for (let i = 1; i < input.frames.length; i += 1) {
    const prev = input.frames[i - 1] as LatentWindowFrame;
    const cur = input.frames[i] as LatentWindowFrame;
    if (cur.step <= prev.step) {
      return {
        ok: false,
        rejected: "non-monotonic-steps",
        detail: `frame steps must be strictly increasing (step ${cur.step} after ${prev.step})`,
      };
    }
  }
  if (!Number.isInteger(input.horizon) || input.horizon < 1) {
    return { ok: false, rejected: "invalid-horizon", detail: "horizon must be an integer >= 1" };
  }
  const truth = input.truth ?? [];
  if (truth.length > 0) {
    if (truth.length !== input.horizon) {
      return {
        ok: false,
        rejected: "invalid-truth-steps",
        detail: `truth must carry exactly ${input.horizon} frames, got ${truth.length}`,
      };
    }
    for (let k = 0; k < truth.length; k += 1) {
      const frame = truth[k] as LatentWindowFrame;
      if (frame.step !== k + 1) {
        return {
          ok: false,
          rejected: "invalid-truth-steps",
          detail: `truth frame ${k} must have step ${k + 1}, got ${frame.step}`,
        };
      }
    }
  }

  const payloadOf = (frame: LatentWindowFrame): FeatureMap => parseJepaControls(frame.features).payload;
  const last = input.frames[input.frames.length - 1] as LatentWindowFrame;
  const seedLatent = space.embedFeatures(payloadOf(last));
  // Latent velocity: finite difference of the last two frames; 0 when the
  // window carries a single frame (honest: no velocity information).
  const velocity =
    input.frames.length >= 2
      ? subtractLatents(
          seedLatent,
          space.embedFeatures(payloadOf(input.frames[input.frames.length - 2] as LatentWindowFrame)),
        )
      : (Array.from({ length: space.dim }, () => 0) as LatentVector);
  const velocityNorm = latentNorm(velocity);

  const steps: RolloutStepRecord[] = [];
  let z = seedLatent;
  let cumulative = 0;
  for (let k = 1; k <= input.horizon; k += 1) {
    // Rollout law: z_k = A z_{k-1} + v (non-expanding A + carried velocity).
    const az = space.applyDynamics(z, 1);
    const next: LatentVector = addLatents(az, velocity);
    const radius = round6(latentNorm(next));
    const stepDelta = round6(latentL2(next, z));
    let record: RolloutStepRecord;
    if (truth.length > 0) {
      const truthLatent = space.embedFeatures(payloadOf(truth[k - 1] as LatentWindowFrame));
      const truthDivergence = round6(latentL2(truthLatent, next));
      cumulative = round6(cumulative + truthDivergence);
      record = {
        step: k,
        latent: next,
        radius,
        stepDelta,
        truthLatent,
        truthDivergence,
        cumulativeTruthDivergence: cumulative,
      };
    } else {
      record = { step: k, latent: next, radius, stepDelta };
    }
    steps.push(record);
    z = next;
  }
  const finalLatent = z;

  // Decode the final latent at the primary feature of the LAST frame.
  const lastKeys = Object.keys(payloadOf(last)).sort();
  const primary = lastKeys.length > 0 ? (lastKeys[0] as string) : null;
  const value = primary !== null ? round6(space.decode(finalLatent, primary)) : 0;

  const predicted: PredictedValue<number> = {
    kind: "PREDICTED",
    value,
    uncertainty: jepaUncertaintyAt(input.horizon, value),
    predictedAt: input.computedAt,
    validUntil: JEPA_VALID_UNTIL,
    provenance: {
      modelVersion: space.version,
      capabilityVersion: "1.0.0",
      featureDigest: jepaDigest(canonicalJepaJson(input.frames.map((f) => f.features))),
      inputsDigest: jepaDigest(
        `${input.tenant.tenantId}|${input.asset.assetId}|${input.computedAt}|h=${input.horizon}|w=${input.frames.length}|v=${space.version}`,
      ),
    },
    tenant: input.tenant,
    asset: input.asset,
  };

  return {
    ok: true,
    rollout: {
      seedLatent,
      velocity,
      velocityNorm: round6(velocityNorm),
      windowFrameCount: input.frames.length,
      steps,
      finalLatent,
      predicted,
      horizon: input.horizon,
      radiusBoundAtFinal: round6(latentNorm(seedLatent) + input.horizon * velocityNorm),
      spaceVersion: space.version,
    },
  };
}
