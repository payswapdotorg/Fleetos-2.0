/**
 * @fleetos/assets — Wave 9 lineage graph (F290A).
 *
 * Typed directed edges between assets, material lots, and method
 * applications:
 *   - asset-consumed-lot: an asset consumed part of a material lot.
 *   - method-applied-to-asset: a (versioned) method was applied to an asset.
 *   - lot-transformed-into-lot: a lot was derived/transformed into another.
 *   - asset-replaced-by-asset: one asset was replaced by another (successor).
 *
 * The graph is an APPEND-ONLY log of edges; each new edge's `edgeDigest`
 * is the lane's FNV-1a over the prior edge's digest (the chain link) and
 * the canonical JSON of the edge's own fields. Any reordering, edit, or
 * rewrite of an already-chained edge BREAKS VERIFICATION — machine-tested
 * with mutation fixtures (the packet's tamper-evident law).
 *
 * Deterministic edge ordering: edges are stored in append order; queries
 * traverse in that order. The chain head is the last edge's edgeDigest
 * (or `"genesis"` for the empty graph).
 *
 * Pure TypeScript, no I/O, no Date.now, no Math.random, no timers, no network.
 */

import { fnv1a32, canonicalJson } from "./digest.js";
import type { TenantIdLike, AssetId } from "../assets.js";
import type { MaterialLotId } from "./material.js";
import type { MethodId, MethodApplicationId } from "./method.js";

// ---------------------------------------------------------------------------
// Edge kinds + payload types — typed directed edges.
// ---------------------------------------------------------------------------

export type LineageEdgeKind =
  | "asset-consumed-lot"
  | "method-applied-to-asset"
  | "lot-transformed-into-lot"
  | "asset-replaced-by-asset";

export interface AssetConsumedLotPayload {
  readonly kind: "asset-consumed-lot";
  readonly assetId: AssetId;
  readonly lotId: MaterialLotId;
  readonly quantity: number;
  readonly unit: string;
  readonly consumeSeq: number;
}

export interface MethodAppliedToAssetPayload {
  readonly kind: "method-applied-to-asset";
  readonly methodId: MethodId;
  readonly methodVersion: string;
  readonly assetId: AssetId;
  readonly applicationId: MethodApplicationId;
}

export interface LotTransformedIntoLotPayload {
  readonly kind: "lot-transformed-into-lot";
  readonly sourceLotId: MaterialLotId;
  readonly targetLotId: MaterialLotId;
  readonly yieldRatio: number;
}

export interface AssetReplacedByAssetPayload {
  readonly kind: "asset-replaced-by-asset";
  readonly predecessorAssetId: AssetId;
  readonly successorAssetId: AssetId;
  readonly reason: string;
}

export type LineageEdgePayload =
  | AssetConsumedLotPayload
  | MethodAppliedToAssetPayload
  | LotTransformedIntoLotPayload
  | AssetReplacedByAssetPayload;

// ---------------------------------------------------------------------------
// LineageEdge — a single tamper-evident edge in the chain.
// ---------------------------------------------------------------------------

export interface LineageEdge {
  /** 1-indexed position in the append log (deterministic ordering). */
  readonly sequence: number;
  readonly tenantId: TenantIdLike;
  readonly payload: LineageEdgePayload;
  readonly at: number;
  /** The digest of the previous edge (the chain link); "genesis" for #1. */
  readonly prevDigest: string;
  /** FNV-1a over (prevDigest, canonicalJson(edge-without-digest)). */
  readonly edgeDigest: string;
}

export const GENESIS_DIGEST = "genesis";

// ---------------------------------------------------------------------------
// Graph — the append-only edge log.
// ---------------------------------------------------------------------------

export interface LineageGraph {
  readonly edges: ReadonlyArray<LineageEdge>;
  /** The current head digest (last edge's edgeDigest, or GENESIS_DIGEST). */
  readonly headDigest: string;
  readonly edgeCount: number;
}

export function emptyLineageGraph(): LineageGraph {
  return { edges: [], headDigest: GENESIS_DIGEST, edgeCount: 0 };
}

// ---------------------------------------------------------------------------
// Append — fail-closed validations, deterministic chain.
// ---------------------------------------------------------------------------

export type LineageAppendRejectionCode =
  | "missing-tenant-id"
  | "invalid-payload"
  | "invalid-at"
  | "payload-tenant-mismatch"
  | "unknown-edge-kind"
  | "edge-digest-mismatch";

export interface LineageAppendInput {
  readonly tenantId: TenantIdLike;
  readonly payload: LineageEdgePayload;
  readonly at: number;
}

export type LineageAppendResult =
  | { readonly ok: true; readonly graph: LineageGraph; readonly edge: LineageEdge }
  | { readonly ok: false; readonly reason: LineageAppendRejectionCode };

function validatePayload(p: LineageEdgePayload): boolean {
  switch (p.kind) {
    case "asset-consumed-lot":
      return (
        typeof p.assetId === "string" && p.assetId !== "" &&
        typeof p.lotId === "string" && p.lotId !== "" &&
        Number.isFinite(p.quantity) && p.quantity > 0 &&
        typeof p.unit === "string" && p.unit !== "" &&
        Number.isFinite(p.consumeSeq) && p.consumeSeq >= 0
      );
    case "method-applied-to-asset":
      return (
        typeof p.methodId === "string" && p.methodId !== "" &&
        typeof p.methodVersion === "string" && p.methodVersion !== "" &&
        typeof p.assetId === "string" && p.assetId !== "" &&
        typeof p.applicationId === "string" && p.applicationId !== ""
      );
    case "lot-transformed-into-lot":
      return (
        typeof p.sourceLotId === "string" && p.sourceLotId !== "" &&
        typeof p.targetLotId === "string" && p.targetLotId !== "" &&
        p.sourceLotId !== p.targetLotId &&
        Number.isFinite(p.yieldRatio) && p.yieldRatio > 0
      );
    case "asset-replaced-by-asset":
      return (
        typeof p.predecessorAssetId === "string" && p.predecessorAssetId !== "" &&
        typeof p.successorAssetId === "string" && p.successorAssetId !== "" &&
        p.predecessorAssetId !== p.successorAssetId &&
        typeof p.reason === "string" && p.reason !== ""
      );
    default:
      return false;
  }
}

/**
 * Compute the edge digest for a candidate edge (deterministic, pure).
 * Pure over the inputs; used both at append time AND by verifyLineageChain.
 */
export function computeEdgeDigest(input: {
  readonly sequence: number;
  readonly tenantId: string;
  readonly payload: LineageEdgePayload;
  readonly at: number;
  readonly prevDigest: string;
}): string {
  return fnv1a32([
    "lineage-edge",
    input.sequence,
    input.tenantId,
    input.at,
    input.prevDigest,
    canonicalJson(input.payload),
  ]);
}

export function appendLineageEdge(
  graph: LineageGraph,
  input: LineageAppendInput,
): LineageAppendResult {
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return { ok: false, reason: "missing-tenant-id" };
  }
  if (!validatePayload(input.payload)) {
    return { ok: false, reason: "invalid-payload" };
  }
  if (!Number.isFinite(input.at) || input.at <= 0) {
    return { ok: false, reason: "invalid-at" };
  }
  const sequence = graph.edgeCount + 1;
  const prevDigest = graph.headDigest;
  const edgeDigest = computeEdgeDigest({
    sequence,
    tenantId: input.tenantId,
    payload: input.payload,
    at: input.at,
    prevDigest,
  });
  const edge: LineageEdge = {
    sequence,
    tenantId: input.tenantId,
    payload: input.payload,
    at: input.at,
    prevDigest,
    edgeDigest,
  };
  return {
    ok: true,
    graph: {
      edges: [...graph.edges, edge],
      headDigest: edgeDigest,
      edgeCount: sequence,
    },
    edge,
  };
}

// ---------------------------------------------------------------------------
// Tamper-evident chain verification.
// ---------------------------------------------------------------------------

export type LineageVerificationResult =
  | { readonly ok: true; readonly headDigest: string; readonly edgeCount: number }
  | {
      readonly ok: false;
      readonly reason: "edge-digest-mismatch" | "broken-chain-link" | "out-of-order-sequence";
      readonly failingSequence: number;
      readonly expected: string;
      readonly actual: string;
    };

export function verifyLineageChain(graph: LineageGraph): LineageVerificationResult {
  let runningDigest = GENESIS_DIGEST;
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!;
    const expectedSequence = i + 1;
    if (edge.sequence !== expectedSequence) {
      return {
        ok: false,
        reason: "out-of-order-sequence",
        failingSequence: edge.sequence,
        expected: String(expectedSequence),
        actual: String(edge.sequence),
      };
    }
    if (edge.prevDigest !== runningDigest) {
      return {
        ok: false,
        reason: "broken-chain-link",
        failingSequence: edge.sequence,
        expected: runningDigest,
        actual: edge.prevDigest,
      };
    }
    const recomputed = computeEdgeDigest({
      sequence: edge.sequence,
      tenantId: edge.tenantId,
      payload: edge.payload,
      at: edge.at,
      prevDigest: edge.prevDigest,
    });
    if (recomputed !== edge.edgeDigest) {
      return {
        ok: false,
        reason: "edge-digest-mismatch",
        failingSequence: edge.sequence,
        expected: edge.edgeDigest,
        actual: recomputed,
      };
    }
    runningDigest = edge.edgeDigest;
  }
  if (runningDigest !== graph.headDigest) {
    return {
      ok: false,
      reason: "broken-chain-link",
      failingSequence: graph.edges.length,
      expected: graph.headDigest,
      actual: runningDigest,
    };
  }
  return { ok: true, headDigest: graph.headDigest, edgeCount: graph.edgeCount };
}

/**
 * Convenience: the head digest. For an empty graph this is GENESIS_DIGEST.
 */
export function lineageGraphDigest(graph: LineageGraph): string {
  return graph.headDigest;
}

// ---------------------------------------------------------------------------
// Source / target — typed extraction of an edge's endpoints (for traversal).
// ---------------------------------------------------------------------------

export type NodeKind = "asset" | "lot" | "method-application";

export interface LineageNodeRef {
  readonly kind: NodeKind;
  readonly id: string;
}

/** The "from" node of an edge (the source of the directed relationship). */
export function edgeSource(payload: LineageEdgePayload): LineageNodeRef {
  switch (payload.kind) {
    case "asset-consumed-lot":
      return { kind: "asset", id: payload.assetId };
    case "method-applied-to-asset":
      return { kind: "method-application", id: payload.applicationId };
    case "lot-transformed-into-lot":
      return { kind: "lot", id: payload.sourceLotId };
    case "asset-replaced-by-asset":
      return { kind: "asset", id: payload.predecessorAssetId };
  }
}

/** The "to" node of an edge (the target of the directed relationship). */
export function edgeTarget(payload: LineageEdgePayload): LineageNodeRef {
  switch (payload.kind) {
    case "asset-consumed-lot":
      return { kind: "lot", id: payload.lotId };
    case "method-applied-to-asset":
      return { kind: "asset", id: payload.assetId };
    case "lot-transformed-into-lot":
      return { kind: "lot", id: payload.targetLotId };
    case "asset-replaced-by-asset":
      return { kind: "asset", id: payload.successorAssetId };
  }
}
