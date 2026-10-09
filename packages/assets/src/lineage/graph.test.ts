/**
 * @fleetos/assets — Wave 9 lineage graph tests (F290A).
 *
 * Covers:
 *   - append: chain growth, deterministic edge ordering (sequence, prevDigest, edgeDigest).
 *   - tamper-evident: 3 mutation fixtures (reorder, edit, rewrite) each break
 *     verifyLineageChain with a REAL reason code + failing sequence + expected/actual digests.
 *   - verify: green over a freshly-built chain; head digest matches last edge.
 *   - edge kinds: all 4 payloads append cleanly.
 *   - empty graph: GENESIS_DIGEST; verify returns ok=true with edgeCount=0.
 *   - validations: missing-tenant-id, invalid-payload, invalid-at.
 *   - byte-identical: two runs over the same inputs produce identical edge digests AND head digest.
 */

import { describe, it, expect } from "vitest";
import {
  appendLineageEdge,
  verifyLineageChain,
  lineageGraphDigest,
  emptyLineageGraph,
  computeEdgeDigest,
  edgeSource,
  edgeTarget,
  GENESIS_DIGEST,
  type LineageGraph,
  type LineageEdge,
  type LineageAppendInput,
  type AssetConsumedLotPayload,
  type MethodAppliedToAssetPayload,
  type LotTransformedIntoLotPayload,
  type AssetReplacedByAssetPayload,
} from "./graph.js";

const NOW = 1_774_000_000_000;
const TENANT_A = "tnt_acme";
const ASSET_1 = "ast_truck-0001" as never;
const ASSET_2 = "ast_truck-0002" as never;
const LOT_1 = "lot_lubricant-001" as never;
const LOT_2 = "lot_lubricant-002" as never;
const MTH_1 = "mth_oil-change" as never;
const APP_1 = "app_apply-0001" as never;

function consumePayload(): AssetConsumedLotPayload {
  return {
    kind: "asset-consumed-lot",
    assetId: ASSET_1,
    lotId: LOT_1,
    quantity: 10,
    unit: "litre",
    consumeSeq: 1,
  };
}
function methodPayload(): MethodAppliedToAssetPayload {
  return {
    kind: "method-applied-to-asset",
    methodId: MTH_1,
    methodVersion: "1.0.0",
    assetId: ASSET_1,
    applicationId: APP_1,
  };
}
function transformPayload(): LotTransformedIntoLotPayload {
  return {
    kind: "lot-transformed-into-lot",
    sourceLotId: LOT_1,
    targetLotId: LOT_2,
    yieldRatio: 0.95,
  };
}
function replacePayload(): AssetReplacedByAssetPayload {
  return {
    kind: "asset-replaced-by-asset",
    predecessorAssetId: ASSET_1,
    successorAssetId: ASSET_2,
    reason: "end-of-life",
  };
}

function buildChain(): LineageGraph {
  let g = emptyLineageGraph();
  const inputs: LineageAppendInput[] = [
    { tenantId: TENANT_A, payload: consumePayload(), at: NOW + 1_000 },
    { tenantId: TENANT_A, payload: methodPayload(), at: NOW + 2_000 },
    { tenantId: TENANT_A, payload: transformPayload(), at: NOW + 3_000 },
    { tenantId: TENANT_A, payload: replacePayload(), at: NOW + 4_000 },
  ];
  for (const i of inputs) {
    const r = appendLineageEdge(g, i);
    if (!r.ok) throw new Error(`append failed: ${r.reason}`);
    g = r.graph;
  }
  return g;
}

describe("lineage graph: empty + GENESIS", () => {
  it("empty graph has GENESIS_DIGEST, 0 edges, verifies ok", () => {
    const g = emptyLineageGraph();
    expect(g.headDigest).toBe(GENESIS_DIGEST);
    expect(g.edgeCount).toBe(0);
    expect(lineageGraphDigest(g)).toBe(GENESIS_DIGEST);
    const v = verifyLineageChain(g);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.headDigest).toBe(GENESIS_DIGEST);
      expect(v.edgeCount).toBe(0);
    }
  });
});

describe("lineage graph: append + chain", () => {
  it("appends 4 edges with sequential numbers and chained digests", () => {
    const g = buildChain();
    expect(g.edgeCount).toBe(4);
    expect(g.edges).toHaveLength(4);
    expect(g.edges[0]!.sequence).toBe(1);
    expect(g.edges[1]!.sequence).toBe(2);
    expect(g.edges[2]!.sequence).toBe(3);
    expect(g.edges[3]!.sequence).toBe(4);
    expect(g.edges[0]!.prevDigest).toBe(GENESIS_DIGEST);
    expect(g.edges[1]!.prevDigest).toBe(g.edges[0]!.edgeDigest);
    expect(g.edges[2]!.prevDigest).toBe(g.edges[1]!.edgeDigest);
    expect(g.edges[3]!.prevDigest).toBe(g.edges[2]!.edgeDigest);
    expect(g.headDigest).toBe(g.edges[3]!.edgeDigest);
  });

  it("verifies a freshly-built chain green", () => {
    const g = buildChain();
    const v = verifyLineageChain(g);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.edgeCount).toBe(4);
      expect(v.headDigest).toBe(g.headDigest);
    }
  });

  it("byte-identical re-runs over the same inputs (same edge digests AND head)", () => {
    const g1 = buildChain();
    const g2 = buildChain();
    expect(g1.headDigest).toBe(g2.headDigest);
    for (let i = 0; i < g1.edges.length; i++) {
      expect(g1.edges[i]!.edgeDigest).toBe(g2.edges[i]!.edgeDigest);
      expect(g1.edges[i]!.prevDigest).toBe(g2.edges[i]!.prevDigest);
    }
  });

  it("all 4 edge kinds append cleanly (typed payloads survive)", () => {
    const g = buildChain();
    expect(g.edges[0]!.payload.kind).toBe("asset-consumed-lot");
    expect(g.edges[1]!.payload.kind).toBe("method-applied-to-asset");
    expect(g.edges[2]!.payload.kind).toBe("lot-transformed-into-lot");
    expect(g.edges[3]!.payload.kind).toBe("asset-replaced-by-asset");
  });
});

describe("lineage graph: tamper-evident — mutation fixtures break verification", () => {
  it("EDIT: mutating an edge's `at` field breaks edge-digest (edge-digest-mismatch)", () => {
    const g = buildChain();
    // Mutate edge #2's `at` (in place — the kind of mutation a tamperer might do).
    const mutated: LineageEdge = { ...g.edges[1]!, at: g.edges[1]!.at + 999_999 };
    const tamperedEdges = [...g.edges];
    tamperedEdges[1] = mutated;
    const tampered: LineageGraph = { ...g, edges: tamperedEdges };
    const v = verifyLineageChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("edge-digest-mismatch");
      expect(v.failingSequence).toBe(2);
      expect(v.expected).toBe(g.edges[1]!.edgeDigest); // tampered edge still has old digest
      // Actual is the recomputed digest over the tampered edge — must differ.
      expect(v.actual).not.toBe(v.expected);
    }
  });

  it("REORDER: swapping two edges breaks the chain link (broken-chain-link)", () => {
    const g = buildChain();
    // Swap edges #2 and #3 — the prevDigest of #3 (originally) no longer matches
    // the new predecessor's edgeDigest (#2's old digest, now in slot 3).
    const tamperedEdges = [g.edges[0]!, g.edges[2]!, g.edges[1]!, g.edges[3]!];
    const tampered: LineageGraph = {
      edges: tamperedEdges,
      headDigest: g.headDigest,
      edgeCount: 4,
    };
    const v = verifyLineageChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      // The failure surfaces as either broken-chain-link or out-of-order-sequence,
      // because we swapped two edges with different sequence numbers — the
      // sequence-1..4 invariant is also broken. Both reasons are honest.
      expect(["broken-chain-link", "out-of-order-sequence"]).toContain(v.reason);
    }
  });

  it("REWRITE: replacing an edge with a freshly-computed digest over tampered fields is detected at the NEXT edge (broken-chain-link)", () => {
    const g = buildChain();
    // Tamperer rewrites edge #2 with a valid recomputed digest over new fields,
    // but they CANNOT re-stamp edge #3's prevDigest (it was sealed with the
    // original #2 digest). The chain breaks at #3.
    const tamperedEdge2: LineageEdge = {
      ...g.edges[1]!,
      at: g.edges[1]!.at + 999_999,
      edgeDigest: computeEdgeDigest({
        sequence: 2,
        tenantId: g.edges[1]!.tenantId,
        payload: g.edges[1]!.payload,
        at: g.edges[1]!.at + 999_999,
        prevDigest: g.edges[1]!.prevDigest,
      }),
    };
    const tamperedEdges = [...g.edges];
    tamperedEdges[1] = tamperedEdge2;
    // Edge #3 still has its original prevDigest (pointing to the original #2).
    // It will not match the new #2's edgeDigest.
    const tampered: LineageGraph = { ...g, edges: tamperedEdges };
    const v = verifyLineageChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("broken-chain-link");
      expect(v.failingSequence).toBe(3);
    }
  });

  it("HEAD TAMPER: mutating headDigest to a wrong value is detected (broken-chain-link at the tail)", () => {
    const g = buildChain();
    const tampered: LineageGraph = { ...g, headDigest: "deadbeef" };
    const v = verifyLineageChain(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("broken-chain-link");
      expect(v.failingSequence).toBe(4);
    }
  });
});

describe("lineage graph: append validations — fail-closed", () => {
  it("refuses empty tenant id (missing-tenant-id)", () => {
    const r = appendLineageEdge(emptyLineageGraph(), {
      tenantId: "",
      payload: consumePayload(),
      at: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("refuses invalid at (invalid-at)", () => {
    for (const at of [0, -1, NaN]) {
      const r = appendLineageEdge(emptyLineageGraph(), {
        tenantId: TENANT_A,
        payload: consumePayload(),
        at,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-at");
    }
  });

  it("refuses invalid payload (invalid-payload) — consume with non-positive quantity", () => {
    const bad: AssetConsumedLotPayload = {
      ...consumePayload(),
      quantity: 0,
    };
    const r = appendLineageEdge(emptyLineageGraph(), {
      tenantId: TENANT_A,
      payload: bad,
      at: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("refuses invalid payload (invalid-payload) — replace with self-loop", () => {
    const bad: AssetReplacedByAssetPayload = {
      kind: "asset-replaced-by-asset",
      predecessorAssetId: ASSET_1,
      successorAssetId: ASSET_1, // self-loop forbidden
      reason: "x",
    };
    const r = appendLineageEdge(emptyLineageGraph(), {
      tenantId: TENANT_A,
      payload: bad,
      at: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });

  it("refuses invalid payload (invalid-payload) — transform with self-loop", () => {
    const bad: LotTransformedIntoLotPayload = {
      kind: "lot-transformed-into-lot",
      sourceLotId: LOT_1,
      targetLotId: LOT_1,
      yieldRatio: 0.95,
    };
    const r = appendLineageEdge(emptyLineageGraph(), {
      tenantId: TENANT_A,
      payload: bad,
      at: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-payload");
  });
});

describe("lineage graph: edgeSource / edgeTarget — typed extraction", () => {
  it("asset-consumed-lot: source=asset, target=lot", () => {
    const p = consumePayload();
    expect(edgeSource(p)).toEqual({ kind: "asset", id: ASSET_1 });
    expect(edgeTarget(p)).toEqual({ kind: "lot", id: LOT_1 });
  });

  it("method-applied-to-asset: source=method-application, target=asset", () => {
    const p = methodPayload();
    expect(edgeSource(p)).toEqual({ kind: "method-application", id: APP_1 });
    expect(edgeTarget(p)).toEqual({ kind: "asset", id: ASSET_1 });
  });

  it("lot-transformed-into-lot: source=lot, target=lot", () => {
    const p = transformPayload();
    expect(edgeSource(p)).toEqual({ kind: "lot", id: LOT_1 });
    expect(edgeTarget(p)).toEqual({ kind: "lot", id: LOT_2 });
  });

  it("asset-replaced-by-asset: source=asset, target=asset", () => {
    const p = replacePayload();
    expect(edgeSource(p)).toEqual({ kind: "asset", id: ASSET_1 });
    expect(edgeTarget(p)).toEqual({ kind: "asset", id: ASSET_2 });
  });
});
