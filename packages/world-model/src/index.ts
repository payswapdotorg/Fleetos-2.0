/**
 * @fleetos/world-model — representations, predictions, counterfactuals,
 * the WorldModelAdapter STRUCTURAL seam + a deterministic reference adapter.
 *
 * Law A11: counterfactuals carry a machine-carried `hypothetical: true` marker
 * that CANNOT be stripped by the type system. We re-export the predictive
 * package's HYPOTHETICAL brand to enforce this across the world-model boundary.
 *
 * Law A12: deterministic reference adapter — no GPU, no provider.
 *
 * Law: world-model CANNOT authorize or execute actions. There is no method
 * here that produces an ActionIntent or a GuardianDecision.
 */

import type {
  HypotheticalValue,
  PredictedValue,
  ProvenanceDigest,
  TenantScopeLike,
  UncertaintyInterval,
} from "@fleetos/predictive";

export type {
  HypotheticalValue,
  PredictedValue,
  ProvenanceDigest,
  TenantScopeLike,
  UncertaintyInterval,
};

/** LOCAL structural asset reference. */
export interface AssetRef {
  readonly assetId: string;
}

/** A learned or deterministic representation of an asset's world. */
export interface WorldModelRepresentation {
  readonly tenant: TenantScopeLike;
  readonly asset: AssetRef;
  readonly representationId: string;
  readonly version: string;
  readonly features: Readonly<Record<string, number>>;
  readonly computedAt: string;
}

/** Counterfactual scenario — premise + the resulting HYPOTHETICAL value. */
export interface CounterfactualScenario<T = unknown> {
  readonly scenarioId: string;
  readonly premise: string;
  readonly value: HypotheticalValue<T>;
  readonly representationRef: string;
}

/** WorldModelAdapter — STRUCTURAL seam. Implementations must be deterministic. */
export interface WorldModelAdapter {
  readonly name: string;
  readonly represent: (input: {
    readonly tenant: TenantScopeLike;
    readonly asset: AssetRef;
    readonly features: Readonly<Record<string, number>>;
  }) => WorldModelRepresentation;
  readonly predict: (rep: WorldModelRepresentation) => PredictedValue;
  readonly counterfactual: <T = unknown>(
    rep: WorldModelRepresentation,
    premise: string,
    newValue: T,
    newUncertainty: UncertaintyInterval,
  ) => CounterfactualScenario<T>;
}

/**
 * Deterministic reference adapter. No GPU, no provider, no I/O.
 *
 * The counterfactual it produces carries `hypothetical: true` — the type
 * system enforces this marker; runtime guards can verify it.
 */
export function makeReferenceWorldModelAdapter(now: string = "1970-01-01T00:00:00.000Z"): WorldModelAdapter {
  return {
    name: "reference.deterministic",
    represent: ({ tenant, asset, features }) => ({
      tenant,
      asset,
      representationId: `rep-${tenant.tenantId}-${asset.assetId}`,
      version: "1.0.0",
      features,
      computedAt: now,
    }),
    predict: (rep) => ({
      kind: "PREDICTED",
      value: 0,
      uncertainty: { lower: -1, upper: 1, confidence: 0.5, method: "reference.constant" },
      predictedAt: rep.computedAt,
      validUntil: "9999-12-31T00:00:00.000Z",
      provenance: {
        modelVersion: "reference-1.0.0",
        capabilityVersion: "1.0.0",
        featureDigest: stableDigest(JSON.stringify(rep.features)),
        inputsDigest: stableDigest(`${rep.tenant.tenantId}|${rep.asset.assetId}|${rep.computedAt}`),
      },
      tenant: rep.tenant,
      asset: rep.asset,
    }),
    counterfactual: (rep, premise, newValue, newUncertainty) => {
      const predicted = makeReferenceWorldModelAdapter(now).predict(rep);
      return {
        scenarioId: `cf-${rep.representationId}-${stableDigest(premise)}`,
        premise,
        value: {
          kind: "HYPOTHETICAL",
          value: newValue,
          uncertainty: newUncertainty,
          premise,
          computedAt: predicted.predictedAt,
          provenance: predicted.provenance,
          tenant: rep.tenant,
          asset: rep.asset,
          hypothetical: true,
        },
        representationRef: rep.representationId,
      };
    },
  };
}

/** Runtime guard — verifies the machine-carried hypothetical marker. */
export function assertHypotheticalMarker<T>(cf: CounterfactualScenario<T>): boolean {
  return cf.value.kind === "HYPOTHETICAL" && cf.value.hypothetical === true;
}

/** Stable digest — same as in @fleetos/predictive (kept private to this package). */
function stableDigest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// ---------- Wave 1 (F210B) kernel extensions ----------

export * from "./widening.ts";
