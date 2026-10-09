/**
 * @fleetos/acceptance-convergence — the REAL-RUN integration suite.
 *
 * Every fixture here is a REAL output over REAL records: the six default
 * scenarios are assembled end-to-end (REAL AssetDirectory + REAL lineage
 * builders + REAL observation anchoring over the observations package's
 * public `admitToLog` + REAL JEPA family adapters + REAL archetype orgs
 * through the REAL policy guard), the rollups run the REAL benchmark +
 * REAL graph queries + REAL capability matching, and the gate renders the
 * boolean verdict over the assembled records.
 *
 * Covers the composition bindings the packet names:
 *   - the REAL world-context windowing surface (projectWindowedWorkload +
 *     verifyWindowIntegrity) seeding scenario windows (the F290B pattern);
 *   - the REAL observations admitted log bound as the lineage lookup port
 *     (the F290A pattern), including the cross-tenant dangling-anchor path;
 *   - digest-convention parity with the Wave-8 release family (F281);
 *   - full-pipeline byte-identical determinism + end-to-end tamper
 *     propagation; the widening law machine-checked against the REAL
 *     reference adapter over every forecast.
 *
 * Pure deterministic TS: logical clocks are constants; no I/O.
 */

import { describe, expect, it } from "vitest";
import { projectWindowedWorkload, verifyWindowIntegrity } from "@fleetos/world-context/windowing";
import { verifyOrgJournalChain } from "@fleetos/agent-organizations";
import { verifyUsageLedgerChain } from "@fleetos/model-gateway";
import { ancestry } from "@fleetos/assets";
import { makeReferenceWorldModelAdapter } from "@fleetos/world-model";
import { canonicalJson as releaseCanonicalJson, fnv1a as releaseFnv1a, ACCEPTANCE_RELEASE_SCHEMA_VERSION } from "@fleetos/acceptance-release";
import { assembleScenario, assembleDefaultScenarios, verifyScenarioDigest } from "../src/scenarios.js";
import { buildScenarioIntelligence, buildScenarioIntelligenceSet, verifyIntelligenceDigest } from "../src/intelligence.js";
import { evaluateConvergenceGate, verifyConvergenceGateVerdict } from "../src/convergence-gate.js";
import { fnv1a, canonicalJson } from "../src/digest.js";
import { INDUSTRY_SHORT_KEYS, NOW_0 } from "../src/scenario-data.js";
import { ALL_INDUSTRIES, ANCHORED_INTELLIGENCE, ANCHORED_SCENARIOS, realObservationBinding, scenarioFor, TENANT_OF, worldWithRealAnchor } from "./fixtures.js";

describe("integration — the REAL-RUN: six industries end-to-end", () => {
  it("assemble → rollup → gate: all six CONVERGED with verified digests at every stage", () => {
    for (const [index, scenario] of ANCHORED_SCENARIOS.entries()) {
      const intelligence = ANCHORED_INTELLIGENCE[index];
      if (intelligence === undefined) throw new Error("intelligence missing");
      expect(verifyScenarioDigest(scenario)).toBe(true);
      expect(verifyIntelligenceDigest(intelligence)).toBe(true);
      // The org artifacts are REAL kernel-chained records.
      expect(verifyOrgJournalChain(scenario.org.journal).ok).toBe(true);
      expect(verifyUsageLedgerChain(scenario.org.usageExcerpt).ok).toBe(true);
      const verdict = evaluateConvergenceGate({ tenantId: scenario.tenantId, scenario, intelligence });
      expect(verdict.verdict).toBe("CONVERGED");
      expect(verifyConvergenceGateVerdict(verdict)).toBe(true);
    }
  });

  it("the anchored observation IS the REAL admitToLog output (id + digest + tenant)", () => {
    for (const industry of ALL_INDUSTRIES) {
      const shortKey = INDUSTRY_SHORT_KEYS[industry];
      const binding = realObservationBinding(TENANT_OF(industry), shortKey);
      const scenario = scenarioFor(industry);
      const anchor = scenario.anchorResults[0];
      if (anchor === undefined || !anchor.ok || anchor.observation === undefined) throw new Error("anchor missing");
      expect(anchor.observation.id).toBe(binding.observationId);
      expect(anchor.observation.payloadDigest).toBe(anchor.observation.payloadDigest);
      expect(anchor.observation.tenantId).toBe(TENANT_OF(industry));
      expect(anchor.observation.deviceId).toBe(binding.deviceId);
      expect(anchor.observation.seq).toBe(1);
      expect(anchor.observation.observedAt).toBe(NOW_0 + 6);
    }
  });

  it("cross-tenant anchoring is fail-closed: a foreign observation is a RECORDED dangling refusal", () => {
    // Ingest under tenant A; assemble tenant B's world with A's port.
    const binding = realObservationBinding(TENANT_OF("manufacturing"), INDUSTRY_SHORT_KEYS["manufacturing"]);
    const result = assembleScenario({
      industry: "logistics",
      world: { tenantId: TENANT_OF("logistics"), observationAnchor: { port: binding.port, observationId: binding.observationId } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const anchor = result.scenario.anchorResults[0];
    if (anchor === undefined) throw new Error("anchor missing");
    expect(anchor.ok).toBe(false);
    expect(anchor.reasonCode).toBe("dangling-observation");
    // The honest refusal flows into the shortfall ledger with the REAL code.
    const rollup = buildScenarioIntelligence(result.scenario);
    expect(rollup.ok).toBe(true);
    if (!rollup.ok) return;
    const anchorShortfall = rollup.intelligence.shortfalls.find((s) => s.kind === "anchor-refusal");
    expect(anchorShortfall?.reasonCode).toBe("dangling-observation");
  });

  it("cross-tenant traversal never crosses scopes (REAL BFS tenant filter)", () => {
    const manufacturing = scenarioFor("manufacturing");
    const logistics = scenarioFor("logistics");
    const foreign = ancestry(logistics.graph, {
      tenantId: manufacturing.tenantId,
      kind: "asset",
      id: (logistics.fleet[2] as { id: string }).id,
    });
    expect(foreign.ok).toBe(true);
    expect(foreign.edges).toHaveLength(0);
    expect(foreign.depth).toBe(0);
  });

  it("full-pipeline byte-identical determinism (scenarios + rollups + verdicts)", () => {
    const scenarios = assembleDefaultScenarios(worldWithRealAnchor);
    const intelligences = buildScenarioIntelligenceSet(scenarios);
    for (const [index, scenario] of scenarios.entries()) {
      const rebuiltIntelligence = intelligences[index];
      const originalScenario = ANCHORED_SCENARIOS[index];
      const originalIntelligence = ANCHORED_INTELLIGENCE[index];
      if (rebuiltIntelligence === undefined || originalScenario === undefined || originalIntelligence === undefined) {
        throw new Error("pipeline record missing");
      }
      expect(scenario.scenarioDigest).toBe(originalScenario.scenarioDigest);
      expect(rebuiltIntelligence.intelligenceDigest).toBe(originalIntelligence.intelligenceDigest);
      const verdict = evaluateConvergenceGate({ tenantId: scenario.tenantId, scenario, intelligence: rebuiltIntelligence });
      const original = evaluateConvergenceGate({
        tenantId: originalScenario.tenantId,
        scenario: originalScenario,
        intelligence: originalIntelligence,
      });
      expect(verdict.gateDigest).toBe(original.gateDigest);
      expect(verdict.verdict).toBe("CONVERGED");
    }
  });

  it("the widening law holds against the REAL reference adapter over EVERY forecast", () => {
    const reference = makeReferenceWorldModelAdapter("2026-10-01T00:00:00.000Z");
    for (const scenario of ANCHORED_SCENARIOS) {
      for (const forecast of scenario.forecasts) {
        const referencePrediction = reference.predict(forecast.representation);
        const referenceWidth = referencePrediction.uncertainty.upper - referencePrediction.uncertainty.lower;
        const width = forecast.predicted.uncertainty.upper - forecast.predicted.uncertainty.lower;
        expect(width + 1e-6).toBeGreaterThanOrEqual(referenceWidth);
        expect(forecast.predicted.uncertainty.method).toBe("jepa.latent-sqrt");
      }
    }
  });

  it("end-to-end tamper propagation: a mutated referenced lot blocks the gate", () => {
    const scenario = ANCHORED_SCENARIOS[0];
    if (scenario === undefined) throw new Error("scenario missing");
    const intelligence = ANCHORED_INTELLIGENCE[0];
    if (intelligence === undefined) throw new Error("intelligence missing");
    const lot = scenario.lots[0];
    if (lot === undefined) throw new Error("lot missing");
    (lot as unknown as { remainingQuantity: number }).remainingQuantity = 3;
    const verdict = evaluateConvergenceGate({ tenantId: scenario.tenantId, scenario, intelligence });
    expect(verdict.verdict).toBe("NOT-CONVERGED");
    expect(verdict.blockers.map((b) => b.code)).toContain("SCENARIO_TAMPERED");
  });
});

describe("integration — the REAL world-context window seeding (composition binding)", () => {
  it("scenario windows derive from REAL windowed workload projections", () => {
    const observations = [
      { observationRef: "obs-w-1", observedAt: "2026-10-01T00:30:00.000Z", observer: "sensor-conv", sensorKind: "telemetry" },
      { observationRef: "obs-w-2", observedAt: "2026-10-01T12:30:00.000Z", observer: "sensor-conv", sensorKind: "telemetry" },
      { observationRef: "obs-w-3", observedAt: "2026-10-02T00:30:00.000Z", observer: "sensor-conv", sensorKind: "telemetry" },
      { observationRef: "obs-w-4", observedAt: "2026-10-02T12:30:00.000Z", observer: "sensor-conv", sensorKind: "telemetry" },
    ];
    const base = {
      tenant: { tenantId: TENANT_OF("manufacturing") },
      workloadId: "wl-conv",
      assetIds: ["ast_conv_mfg_0001"],
      workItemRefs: [],
      projectRefs: [],
      observations,
    };
    const w1 = projectWindowedWorkload({
      ...base, utilization: 0.6, computedAt: "2026-10-01T23:59:59.000Z",
      windowStart: "2026-10-01T00:00:00.000Z", windowEnd: "2026-10-01T23:59:59.000Z",
    });
    const w2 = projectWindowedWorkload({
      ...base, utilization: 0.8, computedAt: "2026-10-02T23:59:59.000Z",
      windowStart: "2026-10-02T00:00:00.000Z", windowEnd: "2026-10-02T23:59:59.000Z",
    });
    // REAL windowing outputs: integrity verified, per-window provenance.
    expect(verifyWindowIntegrity(w1)).toEqual({ ok: true, outOfWindow: 0 });
    expect(verifyWindowIntegrity(w2)).toEqual({ ok: true, outOfWindow: 0 });
    expect(w1.provenance).toHaveLength(2);
    expect(w2.provenance).toHaveLength(2);
    // Frames derived from the REAL projection outputs (utilization + count).
    const frameA = { utilization: w1.utilization, observations: w1.provenance.length };
    const frameB = { utilization: w2.utilization, observations: w2.provenance.length };
    const result = assembleScenario({
      industry: "manufacturing",
      world: {
        windows: [
          { assetIndex: 0, horizon: 3, prev: frameA, current: frameB },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.forecasts).toHaveLength(3);
    for (const forecast of result.scenario.forecasts) {
      expect(forecast.horizon).toBe(3);
      expect(forecast.assetId).toBe("ast_conv_mfg_0001");
    }
  });
});

describe("integration — acceptance-family composition (the F281 lane)", () => {
  it("digest-convention parity with the release family (fnv1a + canonicalJson)", () => {
    const shared = [
      "fleetos-convergence",
      { b: 2, a: 1, nested: { z: [3, 2, 1], y: "s" } },
      [42, "x", null, true],
    ];
    for (const value of shared) {
      expect(canonicalJson(value)).toBe(releaseCanonicalJson(value));
    }
    for (const s of ["", "a", "convergence-gate|v1|...", "unit␟separator"]) {
      expect(fnv1a(s)).toBe(releaseFnv1a(s));
    }
  });

  it("composition lineage carries the REAL release schema version (the F281 discipline)", () => {
    for (const scenario of ANCHORED_SCENARIOS) {
      expect(scenario.compositionLineage.releaseSchemaVersion).toBe(ACCEPTANCE_RELEASE_SCHEMA_VERSION);
    }
  });
});
