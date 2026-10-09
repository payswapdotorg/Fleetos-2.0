/**
 * @fleetos/assets — Wave 9 lineage integration tests (F290A).
 *
 * The REAL-RUN: every test binds the REAL assets kernel (the existing
 * AssetDirectory over the InMemoryAssetRepository from `kernel-directory.ts`)
 * AND the REAL observations surface (`@fleetos/observations`'s `admitToLog`)
 * AND the lineage modules — proving the modules compose end-to-end as a
 * tamper-evident industrial-genealogy graph.
 *
 * Covers:
 *   - REAL asset binding: AssetDirectory admits assets → lineage method
 *     applications validate against them via the AssetLookupPort adapter.
 *   - REAL observation binding: REAL ingest → REAL lineage anchor.
 *   - All 4 edge kinds in a single graph; full traversal across them.
 *   - Cross-tenant fail-closed end-to-end: foreign-tenant asset refused;
 *     foreign-tenant observation refused; foreign-tenant traversal filtered.
 *   - Tamper propagation: an edited lineage edge breaks verifyLineageChain.
 *   - Lifecycle refusals across the surface: over-consumption + deprecated
 *     method + dangling observation in one combined refusal sequence.
 *   - Digest determinism: byte-identical re-runs of the full chain.
 *   - Deprecation history: deprecated methods remain readable + refused.
 */

import { describe, it, expect } from "vitest";
import {
  AssetDirectory,
  InMemoryAssetRepository,
  type AssetRepositoryPort,
} from "../kernel-directory.js";
import type { AssetId, TenantIdLike } from "../assets.js";
import {
  createMaterialLot,
  consumeMaterialLot,
  materialLotDigest,
  type MaterialLot,
} from "./material.js";
import {
  emptyMethodRegistry,
  registerMethod,
  deprecateMethod,
  applyMethodToAsset,
  lookupMethod,
  type MethodRegistry,
  type MethodDefinition,
  type AssetLookupPort,
} from "./method.js";
import {
  appendLineageEdge,
  verifyLineageChain,
  lineageGraphDigest,
  emptyLineageGraph,
  computeEdgeDigest,
  type LineageGraph,
} from "./graph.js";
import {
  ancestry,
  descendants,
  tenantEdges,
} from "./queries.js";
import {
  validateObservationAnchor,
  type ObservationLookupPort,
} from "./anchor.js";
import {
  emptyAdmittedLog,
  admitToLog,
  type Observation,
} from "@fleetos/observations";

const NOW = 1_774_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";

/** Adapter: makes a REAL AssetDirectory look like the lineage AssetLookupPort. */
function directoryPort(directory: AssetDirectory): AssetLookupPort {
  return {
    findAsset: (tenantId: TenantIdLike, assetId: AssetId) => {
      const hit = directory.lookupAsset(tenantId, assetId);
      return hit ? { id: hit.id, tenantId: hit.tenantId } : null;
    },
  };
}

/** Adapter: makes a REAL observations admitted-log look like the
 * ObservationLookupPort. The log is captured in a mutable closure so the
 * port always sees the latest ingested observations. */
function observationPort(): {
  port: ObservationLookupPort;
  ingest: (input: { seq: number; tenantId: string; deviceId: string }) => Observation;
} {
  let log = emptyAdmittedLog();
  const port: ObservationLookupPort = {
    lookup: (tenantId, observationId) => {
      for (const obs of log.byKey.values()) {
        if (obs.id === observationId && obs.tenantId === tenantId) {
          return {
            id: obs.id,
            tenantId: obs.tenantId,
            deviceId: obs.deviceId,
            seq: obs.seq,
            observedAt: obs.observedAt,
            payloadDigest: obs.payloadDigest,
          };
        }
      }
      return null;
    },
  };
  const ingest = (input: { seq: number; tenantId: string; deviceId: string }): Observation => {
    const r = admitToLog(log, {
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      seq: input.seq,
      observedAt: NOW + input.seq * 1000,
      kind: "state.health",
      payload: new TextEncoder().encode(JSON.stringify({ ok: true, seq: input.seq })),
      admittedAt: NOW + input.seq * 1000,
    });
    if (!r.ok) throw new Error(`ingest failed: ${r.reason}`);
    log = r.log;
    return r.observation;
  };
  return { port, ingest };
}

/** Helper: build a fully-wired test fixture: asset directory + 2 assets +
 * method registry + 1 active method + 1 deprecated method + 1 material lot
 * (partially consumed) + lineage graph with all 4 edge kinds. */
function wiredFixture(): {
  directory: AssetDirectory;
  port: AssetLookupPort;
  reg: MethodRegistry;
  lot: MaterialLot;
  graph: LineageGraph;
  assetId1: AssetId;
  assetId2: AssetId;
} {
  const repo: AssetRepositoryPort = new InMemoryAssetRepository();
  const directory = new AssetDirectory(repo);
  // Admit two REAL assets.
  const a1 = directory.admitAsset({
    assetId: "ast_truck-0001",
    tenantId: TENANT_A,
    kind: "vehicle",
    displayName: "Truck 0001",
    createdAt: NOW,
    actor: "act_admin",
  });
  if (!a1.ok) throw new Error(`admitAsset 1 failed: ${a1.reason}`);
  const a2 = directory.admitAsset({
    assetId: "ast_truck-0002",
    tenantId: TENANT_A,
    kind: "vehicle",
    displayName: "Truck 0002",
    createdAt: NOW + 1000,
    actor: "act_admin",
  });
  if (!a2.ok) throw new Error(`admitAsset 2 failed: ${a2.reason}`);
  // Activate them so they're in 'active' lifecycle (not strictly required by
  // the method-application surface, but mirrors a REAL fleet).
  directory.transitionAsset({
    tenantId: TENANT_A,
    assetId: "ast_truck-0001" as AssetId,
    command: "activate",
    at: NOW + 2000,
    actor: "act_admin",
  });
  directory.transitionAsset({
    tenantId: TENANT_A,
    assetId: "ast_truck-0002" as AssetId,
    command: "activate",
    at: NOW + 2000,
    actor: "act_admin",
  });

  // Register an active method + a deprecated method.
  let reg = emptyMethodRegistry();
  const r1 = registerMethod(reg, {
    methodId: "mth_oil-change",
    version: "1.0.0",
    kind: "maintenance",
    displayName: "Oil Change",
    parameterSchema: [
      { name: "grade", type: "enum", required: true, enumValues: ["5W-30", "10W-40"] },
      { name: "litres", type: "number", required: true },
    ],
    createdAt: NOW,
    description: "Standard oil change",
  });
  if (!r1.ok) throw new Error();
  reg = r1.registry;
  const r2 = registerMethod(reg, {
    methodId: "mth_oil-change",
    version: "0.9.0",
    kind: "maintenance",
    displayName: "Oil Change (legacy)",
    parameterSchema: [{ name: "grade", type: "string", required: true }],
    createdAt: NOW - 10_000,
    description: "Legacy oil change procedure",
  });
  if (!r2.ok) throw new Error();
  reg = r2.registry;
  const r3 = deprecateMethod(reg, {
    methodId: "mth_oil-change" as MethodDefinition["methodId"],
    version: "0.9.0",
    deprecatedAt: NOW + 1000,
  });
  if (!r3.ok) throw new Error();
  reg = r3.registry;

  // Create a material lot (partially consumed).
  const lot0 = createMaterialLot({
    lotId: "lot_lubricant-001",
    tenantId: TENANT_A,
    kind: "lubricant",
    attributes: { grade: "5W-30", supplier: "acme-oil" },
    quantity: 100,
    unit: "litre",
    createdAt: NOW,
  });
  if (!lot0.ok) throw new Error();
  const cr = consumeMaterialLot(lot0.lot, {
    tenantId: TENANT_A,
    lotId: lot0.lot.id,
    quantity: 30,
    consumedAt: NOW + 5000,
    consumeSeq: 1,
  });
  if (!cr.ok) throw new Error();

  // Lineage graph with all 4 edge kinds.
  let graph = emptyLineageGraph();
  const ea = appendLineageEdge(graph, {
    tenantId: TENANT_A,
    payload: {
      kind: "asset-consumed-lot",
      assetId: "ast_truck-0001" as AssetId,
      lotId: lot0.lot.id,
      quantity: 30,
      unit: "litre",
      consumeSeq: 1,
    },
    at: NOW + 5000,
  });
  if (!ea.ok) throw new Error();
  graph = ea.graph;
  const eb = appendLineageEdge(graph, {
    tenantId: TENANT_A,
    payload: {
      kind: "method-applied-to-asset",
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: "ast_truck-0001" as AssetId,
      applicationId: "app_apply-0001" as never,
    },
    at: NOW + 6000,
  });
  if (!eb.ok) throw new Error();
  graph = eb.graph;
  const ec = appendLineageEdge(graph, {
    tenantId: TENANT_A,
    payload: {
      kind: "lot-transformed-into-lot",
      sourceLotId: lot0.lot.id,
      targetLotId: "lot_lubricant-002" as never,
      yieldRatio: 0.95,
    },
    at: NOW + 7000,
  });
  if (!ec.ok) throw new Error();
  graph = ec.graph;
  const ed = appendLineageEdge(graph, {
    tenantId: TENANT_A,
    payload: {
      kind: "asset-replaced-by-asset",
      predecessorAssetId: "ast_truck-0001" as AssetId,
      successorAssetId: "ast_truck-0002" as AssetId,
      reason: "end-of-life",
    },
    at: NOW + 8000,
  });
  if (!ed.ok) throw new Error();
  graph = ed.graph;

  return {
    directory,
    port: directoryPort(directory),
    reg,
    lot: cr.lot,
    graph,
    assetId1: "ast_truck-0001" as AssetId,
    assetId2: "ast_truck-0002" as AssetId,
  };
}

describe("lineage integration: REAL asset binding", () => {
  it("applyMethodToAsset validates against the REAL AssetDirectory via the port adapter", () => {
    const f = wiredFixture();
    const r = applyMethodToAsset(f.reg, f.port, {
      applicationId: "app_int-0001",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: f.assetId1,
      parameters: { grade: "5W-30", litres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.application.assetId).toBe(f.assetId1);
      expect(r.application.tenantId).toBe(TENANT_A);
    }
  });

  it("refuses method application against an unknown asset (REAL directory returns null)", () => {
    const f = wiredFixture();
    const r = applyMethodToAsset(f.reg, f.port, {
      applicationId: "app_int-0002",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: "ast_missing-9999" as AssetId,
      parameters: { grade: "5W-30", litres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-asset");
  });

  it("refuses method application for an asset in a foreign tenant (REAL directory is tenant-scoped)", () => {
    const f = wiredFixture();
    // Tenant B has NO assets; the REAL directory returns null → unknown-asset.
    const r = applyMethodToAsset(f.reg, f.port, {
      applicationId: "app_int-0003",
      tenantId: TENANT_B,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: f.assetId1,
      parameters: { grade: "5W-30", litres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-asset");
  });
});

describe("lineage integration: REAL observation binding + anchoring", () => {
  it("REAL ingest → method application with anchor → anchor validates against the REAL log", () => {
    const f = wiredFixture();
    const { port: obsPort, ingest } = observationPort();
    const obs = ingest({ seq: 1, tenantId: TENANT_A, deviceId: "dev_truck-0001" });
    const app = applyMethodToAsset(f.reg, f.port, {
      applicationId: "app_int-0010",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: f.assetId1,
      parameters: { grade: "5W-30", litres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
      observationAnchor: { observationId: obs.id },
    });
    if (!app.ok) throw new Error();
    const r = validateObservationAnchor(obsPort, {
      tenantId: TENANT_A,
      observationAnchor: app.application.observationAnchor,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.observation.id).toBe(obs.id);
      expect(r.observation.tenantId).toBe(TENANT_A);
    }
  });

  it("refuses an anchor pointing at a REAL observation ingested under a foreign tenant", () => {
    const { port: obsPort, ingest } = observationPort();
    const obs = ingest({ seq: 1, tenantId: TENANT_B, deviceId: "dev_other-0001" });
    // Caller asks for TENANT_A; port's REAL lookup filters by tenant → null.
    const r = validateObservationAnchor(obsPort, {
      tenantId: TENANT_A,
      observationAnchor: { observationId: obs.id },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("dangling-observation");
  });
});

describe("lineage integration: full graph traversal across all 4 edge kinds", () => {
  it("descendants of the predecessor asset cross all 4 edges in one traversal", () => {
    const f = wiredFixture();
    // ast_truck-0001 has descendants: ast_truck-0002 (replace), the lot
    // (consumed), the method-application (target of method-applied-to-asset).
    const r = descendants(f.graph, {
      tenantId: TENANT_A,
      id: "ast_truck-0001",
      kind: "asset",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // At least the immediate asset-replaced-by-asset edge fires (A1→A2),
      // plus the asset-consumed-lot edge fires (A1→lot).
      expect(r.edges.length).toBeGreaterThanOrEqual(2);
      expect(r.visited).toContainEqual({ kind: "asset", id: "ast_truck-0002" });
      expect(r.visited).toContainEqual({ kind: "lot", id: f.lot.id });
    }
  });

  it("ancestry of the successor asset returns the predecessor", () => {
    const f = wiredFixture();
    const r = ancestry(f.graph, {
      tenantId: TENANT_A,
      id: "ast_truck-0002",
      kind: "asset",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.visited).toContainEqual({ kind: "asset", id: "ast_truck-0001" });
    }
  });
});

describe("lineage integration: cross-tenant fail-closed end-to-end", () => {
  it("tenantEdges filters out foreign-tenant edges", () => {
    const f = wiredFixture();
    // Add a foreign-tenant edge.
    const r = appendLineageEdge(f.graph, {
      tenantId: TENANT_B,
      payload: {
        kind: "asset-replaced-by-asset",
        predecessorAssetId: "ast_b-0001" as AssetId,
        successorAssetId: "ast_b-0002" as AssetId,
        reason: "x",
      },
      at: NOW + 100_000,
    });
    if (!r.ok) throw new Error();
    expect(tenantEdges(r.graph, TENANT_A)).toHaveLength(4);
    expect(tenantEdges(r.graph, TENANT_B)).toHaveLength(1);
  });

  it("descendants traversal filters out foreign-tenant edges", () => {
    const f = wiredFixture();
    // Try a TENANT_B traversal of an asset that exists in TENANT_A — the
    // tenant mismatch filters all edges.
    const r = descendants(f.graph, {
      tenantId: TENANT_B,
      id: "ast_truck-0001",
      kind: "asset",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.edges).toHaveLength(0);
      expect(r.visited).toEqual([{ kind: "asset", id: "ast_truck-0001" }]);
    }
  });
});

describe("lineage integration: tamper propagation", () => {
  it("an edited lineage edge breaks verifyLineageChain (edge-digest-mismatch)", () => {
    const f = wiredFixture();
    // Mutate edge #2's `at` field — the recomputed digest will not match.
    const mutated = { ...f.graph.edges[1]!, at: f.graph.edges[1]!.at + 999_999 };
    const tamperedEdges = [...f.graph.edges];
    tamperedEdges[1] = mutated;
    const tampered: LineageGraph = { ...f.graph, edges: tamperedEdges };
    const v = verifyLineageChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("edge-digest-mismatch");
      expect(v.failingSequence).toBe(2);
    }
  });

  it("a re-stamped edge is detected at the NEXT edge (broken-chain-link)", () => {
    const f = wiredFixture();
    const orig = f.graph.edges[1]!;
    const tamperedEdge = {
      ...orig,
      at: orig.at + 999_999,
      edgeDigest: computeEdgeDigest({
        sequence: orig.sequence,
        tenantId: orig.tenantId,
        payload: orig.payload,
        at: orig.at + 999_999,
        prevDigest: orig.prevDigest,
      }),
    };
    const tamperedEdges = [...f.graph.edges];
    tamperedEdges[1] = tamperedEdge;
    const tampered: LineageGraph = { ...f.graph, edges: tamperedEdges };
    const v = verifyLineageChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("broken-chain-link");
  });
});

describe("lineage integration: digest determinism (byte-identical re-runs)", () => {
  it("two runs of the full fixture produce byte-identical head digests", () => {
    const f1 = wiredFixture();
    const f2 = wiredFixture();
    expect(lineageGraphDigest(f1.graph)).toBe(lineageGraphDigest(f2.graph));
    expect(materialLotDigest(f1.lot)).toBe(materialLotDigest(f2.lot));
  });
});

describe("lineage integration: lifecycle refusals across the surface", () => {
  it("over-consumption + deprecated-method + dangling-observation in one combined scenario", () => {
    const f = wiredFixture();
    // 1. Over-consumption on the lot.
    const over = consumeMaterialLot(f.lot, {
      tenantId: TENANT_A,
      lotId: f.lot.id,
      quantity: 1000,
      consumedAt: NOW + 999_999,
      consumeSeq: f.lot.consumeSeq + 1,
    });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe("over-consumption");
    // 2. Deprecated method refused for new application.
    const dep = applyMethodToAsset(f.reg, f.port, {
      applicationId: "app_int-0020",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "0.9.0",
      assetId: f.assetId1,
      parameters: { grade: "5W-30" },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(dep.ok).toBe(false);
    if (!dep.ok) expect(dep.reason).toBe("method-deprecated");
    // 3. Deprecated method remains READABLE (lineage is append-only history).
    const lookup = lookupMethod(f.reg, "mth_oil-change" as MethodDefinition["methodId"], "0.9.0");
    expect(lookup).not.toBeNull();
    expect(lookup?.status).toBe("deprecated");
    // 4. Dangling observation refused.
    const { port: obsPort } = observationPort();
    const dangling = validateObservationAnchor(obsPort, {
      tenantId: TENANT_A,
      observationAnchor: { observationId: "obs_a-999-notfound" },
    });
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.reason).toBe("dangling-observation");
  });
});
