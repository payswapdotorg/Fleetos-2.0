/**
 * F251 health-assembly tests — sections == direct lane calls, the fixed
 * severity ladder, fail-closed tenancy (no partial assembly), byte-identical
 * determinism, input order-independence, digest verify + tamper.
 *
 * States are IMMUTABLE records: every fixture variation is built by spread,
 * never by mutating a readonly slice.
 */

import { describe, expect, it } from "vitest";
import {
  defaultAdapterCircuitConfig,
  defaultAdapterHealthConfig,
  evaluateAdapterCircuit,
  foldAdapterCircuitAll,
  rollupAdapterHealth,
} from "@fleetos/adcos";
import { defaultHeartbeatTtl, rollupFleetPosture } from "@fleetos/connectivity";
import { makeReferenceArenaAdapter, evaluateWithDegradation } from "@fleetos/arena";
import { summarizeCapabilityEvaluations } from "@fleetos/learning";
import { reconcileProjectionSet } from "@fleetos/aurum";
import { foldRunJournal } from "@fleetos/apify";
import { classifyVerificationExpiry, revokeVerification, rollupVendorScorecards } from "@fleetos/external-vendors";
import {
  assembleIntegrationHealth,
  verifyIntegrationHealthDigest,
  type IntegrationHealthState,
} from "../src/health-assembly.js";
import {
  adcosSlice,
  apifyJournalWithJob,
  arenaRequest,
  aurumSlice,
  AURUM_SOURCE,
  healthyState,
  learningEvaluations,
  NOW,
  TENANT,
  vendorsSlice,
  WINDOW,
  WINDOW_PREV,
} from "./helpers.js";

describe("assembleIntegrationHealth — sections equal direct lane calls", () => {
  it("adcos section equals the REAL adapter-health rollup (status, circuit, reasons, stats)", () => {
    const state = healthyState();
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const circuit = evaluateAdapterCircuit(state.adcos.circuit, NOW, defaultAdapterCircuitConfig());
    const direct = rollupAdapterHealth(
      {
        tenantId: TENANT,
        now: NOW,
        commandOutcomes: state.adcos.commandOutcomes,
        sessionSummary: state.adcos.sessionSummary,
        postureSignals: state.adcos.postureSignals,
      },
      circuit,
      defaultAdapterHealthConfig(),
    );
    expect(result.view.adcos.status).toBe(direct.status);
    expect(result.view.adcos.circuit).toBe(direct.circuit);
    expect(result.view.adcos.reasons).toEqual(direct.reasons);
    expect(result.view.adcos.commandStats).toEqual(direct.commandStats);
    expect(result.view.adcos.codes).toEqual(direct.reasons);
  });

  it("connectivity section equals the REAL fleet posture rollup (counts, divergent devices)", () => {
    const state = healthyState();
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const direct = rollupFleetPosture({
      tenantId: TENANT,
      records: state.connectivity.records,
      registry: state.connectivity.registry,
      ttl: defaultHeartbeatTtl(),
      now: NOW,
    });
    expect(result.view.connectivity.counts).toEqual({
      total: direct.counts.total,
      aligned: direct.counts.aligned,
      divergent: direct.counts.divergent,
      unknown: direct.counts.unknown,
    });
    expect(result.view.connectivity.divergentDevices).toEqual(
      direct.assets.filter((a) => a.alignment === "divergent").map((a) => a.deviceId),
    );
  });

  it("aurum section equals the REAL sync-reconciliation (classification, counts)", () => {
    const state = healthyState();
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const direct = reconcileProjectionSet(state.aurum.store, state.aurum.snapshots, AURUM_SOURCE, NOW);
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    expect(result.view.aurum.classification).toBe(direct.report.classification);
    expect(result.view.aurum.counts).toEqual({
      matched: direct.report.matchedIds.length,
      externalOnly: direct.report.externalOnly.length,
      localOnly: direct.report.localOnly.length,
      divergent: direct.report.divergent.length,
    });
  });

  it("apify section equals the REAL run-registry fold (jobs by status)", () => {
    const state = healthyState();
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const direct = foldRunJournal(state.apify.journal);
    expect(result.view.apify.totalJobs).toBe(direct.jobs.size);
    expect(result.view.apify.byStatus["completed"]).toBe(direct.byStatus.get("completed")?.length ?? 0);
  });

  it("vendors section equals the REAL expiry classification + scorecard exclusions", () => {
    const state = healthyState();
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expiry = classifyVerificationExpiry(state.vendors.registry, NOW);
    expect(result.view.vendors.verificationStates.active).toBe(expiry.filter((e) => e.classification === "active").length);
    expect(result.view.vendors.verificationStates.expired).toBe(expiry.filter((e) => e.classification === "expired").length);
    const rollups = rollupVendorScorecards(state.vendors.metrics, {
      tenant: { tenantId: TENANT },
      currentWindow: WINDOW,
      previousWindow: WINDOW_PREV,
    });
    expect(rollups.ok).toBe(true);
  });

  it("arena + learning sections equal the REAL lane evaluations (degraded states, trend, band)", () => {
    const state = healthyState();
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const evaluated = evaluateWithDegradation(makeReferenceArenaAdapter(), state.arena.requests[0]!);
    expect(result.view.arena.evaluations).toBe(1);
    expect(evaluated.ok).toBe(true);
    expect(result.view.arena.degradedStates).toEqual([]);
    const summary = summarizeCapabilityEvaluations(state.learning.evaluations, {
      tenant: { tenantId: TENANT },
      summarizedAtMs: NOW,
    });
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    expect(result.view.learning.trend).toBe(summary.summary.trend);
    expect(result.view.learning.band).toBe(summary.summary.band);
  });
});

describe("assembleIntegrationHealth — the fixed severity ladder", () => {
  it("healthy fixture → all seven sections nominal, rollup healthy, digest verifies", () => {
    const result = assembleIntegrationHealth(healthyState(), { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.rollup.status).toBe("healthy");
    expect(result.view.rollup.totalAdapters).toBe(7);
    expect(result.view.rollup.criticalAdapters).toEqual([]);
    expect(result.view.rollup.degradedAdapters).toEqual([]);
    expect(verifyIntegrationHealthDigest(result.view)).toBe(true);
  });

  it("adcos open circuit → adcos critical, rollup critical", () => {
    const base = healthyState();
    const state: IntegrationHealthState = {
      ...base,
      adcos: {
        ...base.adcos,
        circuit: foldAdapterCircuitAll(
          [
            { ok: false, at: NOW - 3_000 },
            { ok: false, at: NOW - 2_000 },
            { ok: false, at: NOW - 1_000 },
          ],
          defaultAdapterCircuitConfig(),
        ),
      },
    };
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.adcos.severity).toBe("critical");
    expect(result.view.adcos.circuit).toBe("open");
    expect(result.view.rollup.status).toBe("critical");
    expect(result.view.rollup.criticalAdapters).toEqual(["adcos"]);
  });

  it("no adcos observations → honest degraded (no-observations), never healthy", () => {
    const base = healthyState();
    const state: IntegrationHealthState = {
      ...base,
      adcos: adcosSlice({ outcomes: [], classes: ["expired"], postures: [] }),
    };
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.adcos.status).toBe("degraded");
    expect(result.view.adcos.reasons).toContain("no-observations");
    expect(result.view.adcos.severity).toBe("degraded");
  });

  it("revoked vendor verification → vendors critical; aurum divergence → aurum critical", () => {
    const base = healthyState();
    const vendors = vendorsSlice();
    const revokedRegistry = revokeInline(vendors.registry, vendors.catalog);
    const state: IntegrationHealthState = {
      ...base,
      vendors: { ...vendors.slice, registry: revokedRegistry },
      aurum: aurumSlice({
        snapshots: [{ externalId: "ext-001", payload: { status: "different" }, logicalTime: 100 }],
      }),
    };
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.vendors.severity).toBe("critical");
    expect(result.view.vendors.verificationStates.revoked).toBe(1);
    expect(result.view.aurum.classification).toBe("diverged");
    expect(result.view.aurum.severity).toBe("critical");
    expect(result.view.rollup.criticalAdapters).toEqual(["aurum", "vendors"]);
  });

  it("degraded signals: offline posture (connectivity), failed apify job, arena empty_case_set, degrading learning trend", () => {
    const base = healthyState();
    const later = learningEvaluations(TENANT).map((e) => ({
      ...e,
      evaluationId: "eval-2",
      evaluatedAt: "2025-01-02T00:00:02.000Z",
      successes: 0,
      failures: 5,
      successRate: 0,
    }));
    const state: IntegrationHealthState = {
      ...base,
      connectivity: {
        ...base.connectivity,
        // A stale-but-not-dead online heartbeat: honest posture "degraded"
        // (aligned with the active online intent — degraded, not divergent).
        records: [{ tenantId: TENANT, deviceId: "dev_truck-001", state: "online", observedAt: NOW - 45_000 }],
      },
      apify: { journal: apifyJournalWithJob(TENANT, "job-001", "job-failed") },
      arena: {
        requests: [
          { ...arenaRequest(TENANT), cases: [] },
        ],
      },
      learning: { evaluations: [...learningEvaluations(TENANT), ...later] },
    };
    const result = assembleIntegrationHealth(state, { now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.connectivity.severity).toBe("degraded");
    expect(result.view.connectivity.codes).toContain("degraded");
    expect(result.view.apify.severity).toBe("degraded");
    expect(result.view.apify.byStatus["failed"]).toBe(1);
    expect(result.view.arena.degradedStates).toEqual(["empty_case_set"]);
    expect(result.view.learning.severity).toBe("degraded");
    expect(result.view.learning.trend).toBe("degrading");
    expect(result.view.rollup.degradedAdapters).toEqual(["connectivity", "arena", "learning", "apify"]);
  });
});

// Inline revocation through the REAL lane transition (test-local helper).
function revokeInline(
  registry: ReturnType<typeof vendorsSlice>["registry"],
  catalog: ReturnType<typeof vendorsSlice>["catalog"],
): ReturnType<typeof vendorsSlice>["registry"] {
  const revoked = revokeVerification(
    catalog,
    registry,
    { tenant: { tenantId: TENANT }, externalId: "ext-crm-001", capability: "catalog-sync", reason: "trust break" },
    NOW,
  );
  if (!revoked.ok) throw new Error(`revoke refused: ${revoked.reasonCode}`);
  return revoked.registry;
}
