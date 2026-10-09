/**
 * @fleetos/world-model — JEPA family contract benchmark (Wave 9, F290B).
 *
 * A deterministic benchmark over the lane's reference fixtures: every
 * family adapter (from ./index.ts's registry) runs the FULL seam contract
 * (represent -> predict -> counterfactual) over every fixture, every
 * output is serialized canonically and digested with the lane's FNV-1a
 * family, and the report carries per-row, per-adapter and aggregate
 * digests.
 *
 * BYTE-IDENTICAL DETERMINISM PROOF: the machine test (tests/jepa/
 * benchmark.test.ts) runs `runJepaBenchmark()` twice and compares BOTH the
 * full serialized rows AND every digest — same inputs => same outputs,
 * re-run and compare digests. A third run on a FRESHLY-CONSTRUCTED space
 * proves construction determinism (weights re-derived from the hash family
 * are byte-identical).
 *
 * Fixtures: deterministic literals mirroring the lane's reference fixture
 * shapes — the world-model seam tests' tenant/asset/feature literals plus
 * JEPA-extended variants exercising the reserved-key controls. Every
 * fixture is caller-data: no clock, no randomness, no I/O.
 */

import type { WorldModelAdapter, WorldModelRepresentation } from "../index.ts";
import { canonicalJepaJson, jepaDigest } from "./embedding.ts";
import type { JepaSpace } from "./embedding.ts";
import { makeJepaSpace } from "./embedding.ts";
import { JEPA_FAMILY_REGISTRY } from "./index.ts";

/** One benchmark fixture — the lane's reference fixture shapes, mirrored. */
export interface JepaBenchmarkFixture {
  readonly id: string;
  readonly tenantId: string;
  readonly assetId: string;
  readonly features: Readonly<Record<string, number>>;
}

/**
 * The lane's reference fixtures (documented mirrors): the seam tests'
 * canonical single-feature literal ({temperature: 42} on t1/a-1), the
 * multi-feature shapes used by the world-model suite, and JEPA-extended
 * variants carrying the reserved-key controls (horizon, premise deltas).
 */
export const JEPA_BENCHMARK_FIXTURES: readonly JepaBenchmarkFixture[] = Object.freeze([
  Object.freeze({
    id: "seam-single-temperature",
    tenantId: "t1",
    assetId: "a-1",
    features: Object.freeze({ temperature: 42 }),
  }),
  Object.freeze({
    id: "seam-multi-metric",
    tenantId: "t1",
    assetId: "a-1",
    features: Object.freeze({ humidity: 11, pressure: 3.5, temperature: 42 }),
  }),
  Object.freeze({
    id: "jepa-horizon-controls",
    tenantId: "t1",
    assetId: "a-1",
    features: Object.freeze({ temperature: 42, "jepa.horizon": 4 }),
  }),
  Object.freeze({
    id: "jepa-delta-controls",
    tenantId: "t1",
    assetId: "a-1",
    features: Object.freeze({ pressure: 3.5, "jepa.delta.temperature": 7, temperature: 42 }),
  }),
  Object.freeze({
    id: "jepa-rollout-controls",
    tenantId: "t1",
    assetId: "a-1",
    features: Object.freeze({
      "jepa.prev.temperature": 40,
      "jepa.prev.pressure": 3.1,
      pressure: 3.5,
      temperature: 42,
    }),
  }),
]);

/** One benchmark row: one adapter x one fixture, fully digested. */
export interface JepaBenchmarkRow {
  readonly adapterId: string;
  readonly fixtureId: string;
  readonly representationId: string;
  readonly predictedValue: number;
  readonly predictedLower: number;
  readonly predictedUpper: number;
  readonly predictedConfidence: number;
  readonly scenarioId: string;
  readonly hypothetical: boolean;
  /** Digest of the canonical serialization of the FULL outputs. */
  readonly rowDigest: string;
}

/** One family member's benchmark section. */
export interface JepaBenchmarkFamilySection {
  readonly adapterId: string;
  readonly rows: readonly JepaBenchmarkRow[];
  readonly adapterDigest: string;
}

/** The full benchmark report. */
export interface JepaBenchmarkReport {
  readonly spaceVersion: string;
  readonly fixtureCount: number;
  readonly family: readonly JepaBenchmarkFamilySection[];
  readonly aggregateDigest: string;
}

/** The counterfactual premise every benchmark row uses (documented constant). */
const BENCHMARK_PREMISE = "benchmark-premise";

/**
 * Run the JEPA family benchmark. Deterministic: two runs over the same
 * space produce byte-identical reports (machine-tested); a run over a
 * freshly-constructed space is byte-identical too (construction
 * determinism, machine-tested).
 */
export function runJepaBenchmark(
  space: JepaSpace = makeJepaSpace(),
  adapters: readonly { readonly id: string; readonly make: (space: JepaSpace, now: string) => WorldModelAdapter }[] = JEPA_FAMILY_REGISTRY,
): JepaBenchmarkReport {
  const family: JepaBenchmarkFamilySection[] = [];
  for (const entry of adapters) {
    const adapter = entry.make(space, "1970-01-01T00:00:00.000Z");
    const rows: JepaBenchmarkRow[] = [];
    for (const fixture of JEPA_BENCHMARK_FIXTURES) {
      const rep = adapter.represent({
        tenant: { tenantId: fixture.tenantId },
        asset: { assetId: fixture.assetId },
        features: fixture.features,
      });
      const predicted = adapter.predict(rep);
      const counterfactual = adapter.counterfactual(
        rep,
        BENCHMARK_PREMISE,
        predicted.value,
        predicted.uncertainty,
      );
      const rowDigest = jepaDigest(
        canonicalJepaJson({
          rep: representationDigestInput(rep),
          predicted,
          counterfactual,
        }),
      );
      rows.push({
        adapterId: entry.id,
        fixtureId: fixture.id,
        representationId: rep.representationId,
        // The seam's predict returns PredictedValue<unknown> by default;
        // the JEPA family decodes NUMBER values (machine-tested).
        predictedValue: predicted.value as number,
        predictedLower: predicted.uncertainty.lower,
        predictedUpper: predicted.uncertainty.upper,
        predictedConfidence: predicted.uncertainty.confidence,
        scenarioId: counterfactual.scenarioId,
        hypothetical: counterfactual.value.hypothetical,
        rowDigest,
      });
    }
    family.push({
      adapterId: entry.id,
      rows: Object.freeze(rows),
      adapterDigest: jepaDigest(canonicalJepaJson(rows)),
    });
  }
  const aggregateDigest = jepaDigest(
    canonicalJepaJson({
      spaceVersion: space.version,
      fixtures: JEPA_BENCHMARK_FIXTURES.map((f) => f.id),
      family: family.map((f) => f.adapterDigest),
    }),
  );
  return {
    spaceVersion: space.version,
    fixtureCount: JEPA_BENCHMARK_FIXTURES.length,
    family: Object.freeze(family),
    aggregateDigest,
  };
}

/** Canonical digest input of a representation (stable field order). */
function representationDigestInput(rep: WorldModelRepresentation): unknown {
  return {
    representationId: rep.representationId,
    version: rep.version,
    computedAt: rep.computedAt,
    tenant: rep.tenant.tenantId,
    asset: rep.asset.assetId,
    features: rep.features,
  };
}
