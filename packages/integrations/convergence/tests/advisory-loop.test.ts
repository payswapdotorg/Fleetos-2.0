/**
 * @fleetos/convergence — advisory-loop composition tests (F231).
 *
 * Bind the REAL implementations at the sanctioned composition site:
 * world-model fold → world-context assembly → predictive ModelPort
 * reference adapter. The advisory law (predictive output is advisory and
 * NEVER authoritative) is asserted STRUCTURALLY: compile-time proofs
 * (`@ts-expect-error`) that advisory values cannot become authoritative
 * inputs, plus runtime marker guards.
 */

import { describe, expect, it } from "vitest";
import type { Prediction, TwinStateInput } from "@fleetos/predictive";
import type {
  ModelPort,
  ProjectionHorizon,
} from "@fleetos/predictive";
import type {
  WorldEvent,
  WorldJournalEntry,
  WorldObservationPoint,
} from "@fleetos/world-model";
import type { WorldEntitySnapshot } from "@fleetos/world-context";
import { verifyAssembledContextDigest } from "@fleetos/world-context";
import {
  assembleAdvisoryLoop,
  isAdvisoryLoopOutput,
  type AdvisoryLoopOutput,
} from "../src/advisory-assembly.js";
import { nextWorldEntry } from "@fleetos/world-model";
import {
  NOW,
  TENANT_A,
  TENANT_B,
  worldJournalFixture,
} from "./helpers.js";

const HORIZON: ProjectionHorizon = { steps: 5, stepMs: 10_000 };

function requestFixture(overrides?: {
  readonly tenantId?: string;
  readonly entityId?: string;
  readonly nowMs?: number;
  readonly horizon?: ProjectionHorizon;
  readonly worldEntries?: readonly WorldJournalEntry[];
}) {
  return {
    tenantId: overrides?.tenantId ?? TENANT_A,
    worldEntries: overrides?.worldEntries ?? worldJournalFixture(),
    entityId: overrides?.entityId ?? "asset_truck_01",
    metric: "engine_temp",
    asOfMs: NOW - 70_000,
    nowMs: overrides?.nowMs ?? NOW,
    horizon: overrides?.horizon ?? HORIZON,
    computedAt: "2026-10-07T00:00:00.000Z",
  };
}

describe("advisory loop composition", () => {
  it("assembles context from world state and produces an advisory prediction with provenance", () => {
    const loop = assembleAdvisoryLoop();
    const result = loop.run(requestFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { output } = result;
    expect(output.advisory).toBe(true);
    expect(output.prediction.advisory).toBe(true);
    expect(output.prediction.kind).toBe("PREDICTION");
    expect(output.prediction.provenance.observationRefs).toEqual([
      "obs_001",
      "obs_002",
      "obs_003",
    ]);
    // Integer-bps confidence, in range, decaying with the horizon.
    for (const point of output.prediction.points) {
      expect(Number.isInteger(point.confidenceBps)).toBe(true);
      expect(point.confidenceBps).toBeGreaterThanOrEqual(0);
      expect(point.confidenceBps).toBeLessThanOrEqual(10_000);
    }
    // The context carries namespaced features + provenance + digest.
    expect(output.context.features["asset_truck_01#lastValue"]).toBe(14);
    const truckProvenance = output.context.provenance.find(
      (p) => p.entityId === "asset_truck_01",
    );
    expect(truckProvenance?.observationRef).toBe("obs_003");
    expect(verifyAssembledContextDigest(output.context)).toBe(true);
  });

  it("is deterministic: the same inputs produce byte-identical outputs", () => {
    const loop = assembleAdvisoryLoop();
    const a = loop.run(requestFixture());
    const b = loop.run(requestFixture());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Two separately-assembled loops are also identical (no hidden state).
    const c = assembleAdvisoryLoop().run(requestFixture());
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it("classifies staleness fresh at the last observation's logical time", () => {
    const result = assembleAdvisoryLoop().run(requestFixture({ nowMs: NOW - 70_000 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.staleness).toBe("fresh");
  });

  it("classifies staleness stale beyond the fresh window and unknown beyond the stale window", () => {
    const loop = assembleAdvisoryLoop();
    const stale = loop.run(requestFixture({ nowMs: NOW }));
    expect(stale.ok && stale.output.staleness).toBe("stale");
    const unknown = loop.run(requestFixture({ nowMs: NOW + 2_000_000 }));
    expect(unknown.ok && unknown.output.staleness).toBe("unknown");
  });

  it("applies caller-supplied redaction rules and keeps the digest verifiable", () => {
    const loop = assembleAdvisoryLoop({
      rules: [{ purpose: "model-input", redactFields: ["lastValue"] }],
    });
    const result = loop.run(requestFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.context.features["asset_truck_01#lastValue"]).toBe("[REDACTED]");
    expect(result.output.context.redactedFields).toContain("asset_truck_01#lastValue");
    expect(verifyAssembledContextDigest(result.output.context)).toBe(true);
    // The redacted value never leaks into the serialized context.
    expect(JSON.stringify(result.output.context).includes('"asset_truck_01#lastValue":14')).toBe(false);
  });

  it("rejects an unknown entity honestly", () => {
    const result = assembleAdvisoryLoop().run(requestFixture({ entityId: "asset_missing" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.rejected).toBe("entity-not-found");
    }
  });

  it("rejects an empty-history projection through the ModelPort", () => {
    const result = assembleAdvisoryLoop().run(requestFixture({ entityId: "agent_ops_01" }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.rejection.rejected === "projection") {
      expect(result.rejection.reason).toBe("empty-history");
    } else {
      expect.unreachable("expected a projection rejection");
    }
  });

  it("propagates an invalid horizon rejection from the ModelPort", () => {
    const result = assembleAdvisoryLoop().run(
      requestFixture({ horizon: { steps: 0, stepMs: 10_000 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok && result.rejection.rejected === "projection") {
      expect(result.rejection.reason).toBe("invalid-horizon");
    } else {
      expect.unreachable("expected a projection rejection");
    }
  });

  it("rejects invalid staleness thresholds", () => {
    const loop = assembleAdvisoryLoop({
      thresholds: { freshWithinMs: -1, staleWithinMs: 10_000 },
    });
    const result = loop.run(requestFixture());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.rejected).toBe("invalid-thresholds");
  });

  it("fails closed on a missing tenant before touching the world", () => {
    const result = assembleAdvisoryLoop().run(requestFixture({ tenantId: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.rejected).toBe("missing-tenant");
  });

  it("fails closed cross-tenant: a foreign focus tenant is refused at context assembly", () => {
    const result = assembleAdvisoryLoop().run(requestFixture({ tenantId: TENANT_B }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.rejection.rejected === "context-assembly") {
      // The FIRST offending entity (in deterministic entityId order) is named.
      expect(result.rejection.detail).toContain("cross-tenant-ref");
      expect(result.rejection.detail).toContain(TENANT_B);
    } else {
      expect.unreachable("expected a context-assembly rejection");
    }
  });

  it("rejects a mixed-tenant world journal at the fold", () => {
    const entries = [
      ...worldJournalFixture(),
      nextWorldEntry({
        tenantId: TENANT_B,
        existing: [],
        event: { kind: "entity-registered", entityId: "asset_foreign", entityType: "asset" },
        atMs: NOW,
      }),
    ];
    const result = assembleAdvisoryLoop().run(requestFixture({ worldEntries: entries }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.rejected).toBe("world-fold");
  });

  it("consults the CALLER-SUPPLIED ModelPort (the Wave-5 adapter seam is structural)", () => {
    const refusingStub: ModelPort = {
      name: "stub.refusing",
      modelVersion: "stub-0.0.1",
      project: () => ({ ok: false, rejected: "empty-history", detail: "stub refuses deterministically" }),
      runCounterfactual: () => ({ ok: false, rejected: "empty-history", detail: "stub refuses deterministically" }),
    };
    const loop = assembleAdvisoryLoop({ port: refusingStub });
    expect(loop.port().name).toBe("stub.refusing");
    const result = loop.run(requestFixture());
    expect(result.ok).toBe(false);
    if (!result.ok && result.rejection.rejected === "projection") {
      expect(result.rejection.detail).toBe("stub refuses deterministically");
    } else {
      expect.unreachable("expected the stub port's rejection");
    }
  });

  it("defaults to the deterministic reference ModelPort", () => {
    const loop = assembleAdvisoryLoop();
    expect(loop.port().name).toBe("reference.twin.linear-drift");
  });

  it("runtime guard accepts genuine outputs and rejects stripped copies", () => {
    const result = assembleAdvisoryLoop().run(requestFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isAdvisoryLoopOutput(result.output)).toBe(true);
    expect(isAdvisoryLoopOutput({ ...result.output, advisory: false })).toBe(false);
    expect(
      isAdvisoryLoopOutput({ ...result.output, prediction: { kind: "PREDICTED" } }),
    ).toBe(false);
    expect(isAdvisoryLoopOutput({})).toBe(false);
    expect(isAdvisoryLoopOutput(null)).toBe(false);
  });

  // -----------------------------------------------------------------
  // THE ADVISORY LAW, STRUCTURALLY (compile-time proofs). Feeding
  // advisory output back as authoritative input is a TYPE ERROR.
  // -----------------------------------------------------------------

  it("compile-time: a Prediction cannot become a TwinStateInput (no observation history)", () => {
    const result = assembleAdvisoryLoop().run(requestFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prediction: Prediction = result.output.prediction;
    // @ts-expect-error — advisory values are not authoritative twin state
    const bad: TwinStateInput = prediction;
    expect(bad).toBeDefined();
  });

  it("compile-time: a Prediction cannot become a WorldEvent (wrong kind literal)", () => {
    const result = assembleAdvisoryLoop().run(requestFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prediction: Prediction = result.output.prediction;
    // @ts-expect-error — advisory values never enter the world journal
    const bad: WorldEvent = prediction;
    expect(bad).toBeDefined();
  });

  it("compile-time: the loop output cannot become a WorldJournalEntry", () => {
    const result = assembleAdvisoryLoop().run(requestFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output: AdvisoryLoopOutput = result.output;
    // @ts-expect-error — the advisory brand blocks authoritative shapes
    const bad: WorldJournalEntry = output;
    expect(bad).toBeDefined();
  });

  it("compile-time: the loop output cannot become a TwinStateInput or a WorldEntitySnapshot", () => {
    const result = assembleAdvisoryLoop().run(requestFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output: AdvisoryLoopOutput = result.output;
    // @ts-expect-error — the advisory brand blocks authoritative shapes
    const badTwin: TwinStateInput = output;
    // @ts-expect-error — the advisory brand blocks authoritative shapes
    const badSnapshot: WorldEntitySnapshot = output;
    expect(badTwin).toBeDefined();
    expect(badSnapshot).toBeDefined();
  });

  it("compile-time: a projected point cannot become a world observation", () => {
    const result = assembleAdvisoryLoop().run(requestFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const point = result.output.prediction.points[0];
    expect(point).toBeDefined();
    if (!point) return;
    // @ts-expect-error — projected points carry no observationRef (A11)
    const bad: WorldObservationPoint = point;
    expect(bad).toBeDefined();
  });
});
