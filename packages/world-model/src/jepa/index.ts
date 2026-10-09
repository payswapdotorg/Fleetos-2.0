/**
 * @fleetos/world-model — the JEPA family BARREL + adapter registry
 * (Wave 9, F290B).
 *
 * Every family member implements the FULL `WorldModelAdapter` seam
 * (`name` / `represent` / `predict` / `counterfactual` — the existing
 * STRUCTURAL seam from ../index.ts, deterministic by contract):
 *
 *   - jepa.core   — the joint-embedding predictor (latent prediction at a
 *     horizon from a representation + premise deltas; ./predictor.ts);
 *   - jepa.masked — the masked-latent I-JEPA analogue (context-only latent
 *     prediction with honest masked-vs-full divergence accounting; ./masked.ts);
 *   - jepa.rollout — the temporal V-JEPA analogue (multi-step latent
 *     rollout seeded from a window; ./rollout.ts).
 *
 * Adapter-level laws (machine-tested per family member):
 *   - predict is TOTAL and deterministic (never throws; malformed reserved
 *     controls degrade to documented defaults, with the values actually
 *     used carried in the provenance inputsDigest);
 *   - counterfactual enforces Law A11: the returned HYPOTHETICAL carries
 *     the machine-carried `hypothetical: true` marker, and an interval NOT
 *     wider than the baseline prediction's is widened by the EXISTING A11
 *     law (factor 2, ../widening.ts) — never silently narrower;
 *   - world-model CANNOT authorize or execute actions: no method here
 *     produces an ActionIntent or a GuardianDecision (the seam's law).
 *
 * The default mask policy for the masked ADAPTER: the lexicographically
 * later ceil(n/2) payload keys (documented; module callers choose masks
 * explicitly). The rollout ADAPTER seeds its window from the reserved
 * "jepa.prev.*" keys (a 2-frame window; absent prev keys => a single-frame
 * window with zero velocity — honest).
 *
 * "JEPA" = the deterministic structural analogue (latent-space
 * prediction); NOT learned weights. No GPU, no provider, no I/O.
 */

import type {
  CounterfactualScenario,
  UncertaintyInterval,
  WorldModelAdapter,
  WorldModelRepresentation,
} from "../index.ts";
import { widenUncertaintyForCounterfactual } from "../widening.ts";
import { canonicalJepaJson, jepaDigest } from "./embedding.ts";
import type { JepaSpace } from "./embedding.ts";
import { makeJepaSpace } from "./embedding.ts";
import type { JepaControls } from "./predictor.ts";
import { parseJepaControls, predictJepa } from "./predictor.ts";
import { decodeMaskedPrimary, maskedLatentPrediction } from "./masked.ts";
import type { LatentWindowFrame } from "./rollout.ts";
import { rollLatentWindow } from "./rollout.ts";

// ---------------------------------------------------------------------------
// Barrel — the JEPA family surface
// ---------------------------------------------------------------------------

export * from "./embedding.ts";
export * from "./predictor.ts";
export * from "./masked.ts";
export * from "./rollout.ts";
export * from "./counterfactual.ts";
export * from "./benchmark.ts";

// ---------------------------------------------------------------------------
// Shared adapter machinery (total, deterministic)
// ---------------------------------------------------------------------------

/** The core latent prediction over a representation (total; never throws). */
function corePredict(
  space: JepaSpace,
  rep: WorldModelRepresentation,
  controls: JepaControls,
): ReturnType<WorldModelAdapter["predict"]> {
  const result = predictJepa(space, {
    tenant: rep.tenant,
    asset: rep.asset,
    features: rep.features,
    horizon: controls.horizon,
    computedAt: rep.computedAt,
  });
  if (result.ok) return result.prediction.predicted;
  // Unreachable by construction (parseJepaControls guarantees an integer
  // horizon >= 1); documented total fallback: horizon 1, then fail-loud.
  const fallback = predictJepa(space, {
    tenant: rep.tenant,
    asset: rep.asset,
    features: rep.features,
    horizon: 1,
    computedAt: rep.computedAt,
  });
  if (!fallback.ok) throw new Error("jepa adapter predict failed on a validated horizon");
  return fallback.prediction.predicted;
}

/** The A11-enforcing counterfactual shared by the family adapters. */
function jepaAdapterCounterfactual<T>(
  space: JepaSpace,
  baseline: ReturnType<WorldModelAdapter["predict"]>,
  rep: WorldModelRepresentation,
  premise: string,
  newValue: T,
  newUncertainty: UncertaintyInterval,
): CounterfactualScenario<T> {
  const baselineWidth = baseline.uncertainty.upper - baseline.uncertainty.lower;
  const providedWidth = newUncertainty.upper - newUncertainty.lower;
  // Law A11 (machine-enforced): a HYPOTHETICAL is LESS certain — an
  // interval not wider than the baseline's is widened by the EXISTING law.
  const uncertainty =
    providedWidth <= baselineWidth
      ? widenUncertaintyForCounterfactual(newUncertainty, 2)
      : newUncertainty;
  return {
    scenarioId: `jepa-cf-${rep.representationId}-${jepaDigest(premise)}`,
    premise,
    value: {
      kind: "HYPOTHETICAL",
      value: newValue,
      uncertainty,
      premise,
      computedAt: rep.computedAt,
      provenance: {
        modelVersion: space.version,
        capabilityVersion: "1.0.0",
        featureDigest: jepaDigest(canonicalJepaJson(rep.features)),
        inputsDigest: jepaDigest(
          `${rep.tenant.tenantId}|${rep.asset.assetId}|${rep.computedAt}|p=${jepaDigest(premise)}|v=${space.version}`,
        ),
      },
      tenant: rep.tenant,
      asset: rep.asset,
      hypothetical: true,
    },
    representationRef: rep.representationId,
  };
}

function jepaRepresent(
  variant: string,
  now: string,
): WorldModelAdapter["represent"] {
  return ({ tenant, asset, features }) => ({
    tenant,
    asset,
    representationId: `jepa-${variant}-${tenant.tenantId}-${asset.assetId}`,
    version: "jepa-1.0.0",
    features,
    computedAt: now,
  });
}

// ---------------------------------------------------------------------------
// Family adapters
// ---------------------------------------------------------------------------

/** The joint-embedding predictor adapter (jepa.core). */
export function makeJepaCoreAdapter(
  space: JepaSpace = makeJepaSpace(),
  now: string = "1970-01-01T00:00:00.000Z",
): WorldModelAdapter {
  return {
    name: "jepa.core",
    represent: jepaRepresent("core", now),
    predict: (rep) => corePredict(space, rep, parseJepaControls(rep.features)),
    counterfactual: <T = unknown>(
      rep: WorldModelRepresentation,
      premise: string,
      newValue: T,
      newUncertainty: UncertaintyInterval,
    ) =>
      jepaAdapterCounterfactual(
        space,
        corePredict(space, rep, parseJepaControls(rep.features)),
        rep,
        premise,
        newValue,
        newUncertainty,
      ),
  };
}

/** Default mask policy: the lexicographically later ceil(n/2) payload keys. */
export function defaultMaskPolicy(payloadKeys: readonly string[]): readonly string[] {
  const sorted = [...payloadKeys].sort();
  const maskCount = Math.ceil(sorted.length / 2);
  return maskCount === 0 ? [] : sorted.slice(sorted.length - maskCount);
}

/** The masked-latent (I-JEPA) adapter (jepa.masked). */
export function makeJepaMaskedAdapter(
  space: JepaSpace = makeJepaSpace(),
  now: string = "1970-01-01T00:00:00.000Z",
): WorldModelAdapter {
  return {
    name: "jepa.masked",
    represent: jepaRepresent("masked", now),
    predict: (rep) => {
      const controls = parseJepaControls(rep.features);
      const core = () => corePredict(space, rep, controls);
      const mask = defaultMaskPolicy(Object.keys(controls.payload));
      if (mask.length === 0) return core(); // no maskable payload => core path
      // The mask is derived from payload keys => ok is guaranteed by
      // construction; the documented fallback is the core path (never a
      // hidden failure).
      const result = maskedLatentPrediction(space, { features: rep.features, mask });
      if (!result.ok) return core();
      const primary = decodeMaskedPrimary(space, result.masked, {
        tenant: rep.tenant,
        asset: rep.asset,
        computedAt: rep.computedAt,
      });
      if (primary === null) return core();
      return primary;
    },
    counterfactual: <T = unknown>(
      rep: WorldModelRepresentation,
      premise: string,
      newValue: T,
      newUncertainty: UncertaintyInterval,
    ) =>
      jepaAdapterCounterfactual(
        space,
        makeJepaMaskedAdapter(space, rep.computedAt).predict(rep),
        rep,
        premise,
        newValue,
        newUncertainty,
      ),
  };
}

/** The temporal rollout (V-JEPA) adapter (jepa.rollout). */
export function makeJepaRolloutAdapter(
  space: JepaSpace = makeJepaSpace(),
  now: string = "1970-01-01T00:00:00.000Z",
): WorldModelAdapter {
  return {
    name: "jepa.rollout",
    represent: jepaRepresent("rollout", now),
    predict: (rep) => {
      const controls = parseJepaControls(rep.features);
      const core = () => corePredict(space, rep, controls);
      const frames: LatentWindowFrame[] =
        Object.keys(controls.prev).length > 0
          ? [
              { step: 0, features: controls.prev },
              { step: 1, features: controls.payload },
            ]
          : [{ step: 0, features: controls.payload }];
      // Frames are strictly ordered by construction => ok is guaranteed;
      // the documented fallback is the core path (never a hidden failure).
      const result = rollLatentWindow(space, {
        tenant: rep.tenant,
        asset: rep.asset,
        frames,
        horizon: controls.horizon,
        computedAt: rep.computedAt,
      });
      if (!result.ok) return core();
      return result.rollout.predicted;
    },
    counterfactual: <T = unknown>(
      rep: WorldModelRepresentation,
      premise: string,
      newValue: T,
      newUncertainty: UncertaintyInterval,
    ) =>
      jepaAdapterCounterfactual(
        space,
        makeJepaRolloutAdapter(space, rep.computedAt).predict(rep),
        rep,
        premise,
        newValue,
        newUncertainty,
      ),
  };
}

// ---------------------------------------------------------------------------
// The family registry
// ---------------------------------------------------------------------------

/** One JEPA family member (registry entry). */
export interface JepaFamilyEntry {
  readonly id: string;
  readonly variant: "core" | "masked" | "rollout";
  readonly description: string;
  readonly make: (space: JepaSpace, now: string) => WorldModelAdapter;
}

/** The JEPA family registry — every member satisfies the full seam contract. */
export const JEPA_FAMILY_REGISTRY: readonly JepaFamilyEntry[] = Object.freeze([
  Object.freeze({
    id: "jepa.core",
    variant: "core",
    description: "Joint-embedding predictor: latent prediction at a horizon from a representation + premise deltas.",
    make: makeJepaCoreAdapter,
  }),
  Object.freeze({
    id: "jepa.masked",
    variant: "masked",
    description: "I-JEPA analogue: masked-latent prediction from unmasked context with divergence accounting.",
    make: makeJepaMaskedAdapter,
  }),
  Object.freeze({
    id: "jepa.rollout",
    variant: "rollout",
    description: "V-JEPA analogue: multi-step latent rollout seeded from a window with bounded divergence.",
    make: makeJepaRolloutAdapter,
  }),
]);
