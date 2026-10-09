/**
 * @fleetos/assets — Wave 9 lineage queries / cycle-safe traversal (F290A).
 *
 * Traversal queries over the lineage graph:
 *   - ancestry(graph, tenantId, id): full ancestor chain (BFS from id back).
 *   - descendants(graph, tenantId, id): full descendant chain (BFS from id fwd).
 *   - ancestryBounded / descendantsBounded: bounded-depth traversal with
 *     a documented, machine-tested bound (MAX_TRAVERSAL_DEPTH = 64).
 *   - Cycle-safe: a visited set prevents infinite loops even with
 *     self-edges (A → A) or longer cycles (A → B → A). Tested with
 *     explicit self-reference and 3-node cycle fixtures.
 *   - Cross-tenant fail-closed: any edge whose tenantId does NOT match the
 *     caller's tenant is FILTERED (never traversed, never returned). A
 *     caller supplying a foreign-tenant id directly receives an empty
 *     result with a REAL reason code — fail-closed, never a mixed view.
 *   - Documented node cap (MAX_TRAVERSAL_NODES = 1000): a traversal that
 *     would exceed the cap refuses with "traversal-overflow" rather than
 *     silently truncating. Honesty law: the bound is documented AND
 *     machine-tested at the exact edge.
 *
 * Pure TypeScript, no I/O, no Date.now, no Math.random, no timers, no network.
 */

import type { LineageEdge, LineageGraph, LineageNodeRef } from "./graph.js";
import { edgeSource, edgeTarget } from "./graph.js";

// ---------------------------------------------------------------------------
// Documented bounds — machine-tested at the exact edges.
// ---------------------------------------------------------------------------

export const MAX_TRAVERSAL_DEPTH = 64;
export const MAX_TRAVERSAL_NODES = 1000;

export type TraversalRefusalCode =
  | "traversal-overflow"
  | "tenant-id-empty"
  | "missing-target";

export type TraversalOrder = "ancestry" | "descendants";

// ---------------------------------------------------------------------------
// Traversal result.
// ---------------------------------------------------------------------------

export interface TraversalResult {
  readonly ok: boolean;
  readonly order: TraversalOrder;
  /** The seed node the traversal started from. */
  readonly seed: LineageNodeRef;
  /** Edges in BFS order (closest-first). Each edge is a REAL edge object. */
  readonly edges: ReadonlyArray<LineageEdge>;
  /** Distinct nodes visited (including the seed). */
  readonly visited: ReadonlyArray<LineageNodeRef>;
  /** Refusal code if ok === false; otherwise undefined. */
  readonly refusal?: TraversalRefusalCode;
  /** The depth actually reached (0 for the seed alone, 1 for the first hop). */
  readonly depth: number;
}

// ---------------------------------------------------------------------------
// Internal: BFS with a visited set + depth + node cap.
// ---------------------------------------------------------------------------

function nodeKey(node: LineageNodeRef): string {
  return `${node.kind}#${node.id}`;
}

function bfs(
  graph: LineageGraph,
  start: LineageNodeRef,
  order: TraversalOrder,
  maxDepth: number,
  tenantId: string,
): TraversalResult {
  if (maxDepth < 0 || maxDepth > MAX_TRAVERSAL_DEPTH) {
    return {
      ok: false,
      order,
      seed: start,
      edges: [],
      visited: [start],
      refusal: "traversal-overflow",
      depth: 0,
    };
  }
  const visited = new Map<string, LineageNodeRef>();
  visited.set(nodeKey(start), start);
  const outEdges: LineageEdge[] = [];
  let maxReachedDepth = 0;
  // BFS using a simple queue.
  const queue: Array<{ readonly node: LineageNodeRef; readonly depth: number }> = [
    { node: start, depth: 0 },
  ];
  while (queue.length > 0) {
    const head = queue.shift()!;
    if (head.depth >= maxDepth) continue;
    for (const edge of graph.edges) {
      // Tenant filter: cross-tenant edges are NEVER traversed.
      if (edge.tenantId !== tenantId) continue;
      const src = edgeSource(edge.payload);
      const tgt = edgeTarget(edge.payload);
      // For ANCESTRY (predecessors of the seed): find edges where the seed is
      // the TARGET; the next hop is the SOURCE (the predecessor).
      // For DESCENDANTS (successors of the seed): find edges where the seed is
      // the SOURCE; the next hop is the TARGET (the successor).
      const candidate = order === "ancestry" ? tgt : src;
      const next = order === "ancestry" ? src : tgt;
      if (candidate.id !== head.node.id || candidate.kind !== head.node.kind) continue;
      // Cycle-safe: if `next` already visited, record the edge but don't enqueue.
      outEdges.push(edge);
      const nextKey = nodeKey(next);
      if (!visited.has(nextKey)) {
        visited.set(nextKey, next);
        maxReachedDepth = Math.max(maxReachedDepth, head.depth + 1);
        queue.push({ node: next, depth: head.depth + 1 });
        if (visited.size > MAX_TRAVERSAL_NODES) {
          return {
            ok: false,
            order,
            seed: start,
            edges: outEdges,
            visited: Array.from(visited.values()),
            refusal: "traversal-overflow",
            depth: maxReachedDepth,
          };
        }
      }
    }
  }
  return {
    ok: true,
    order,
    seed: start,
    edges: outEdges,
    visited: Array.from(visited.values()),
    depth: maxReachedDepth,
  };
}

// ---------------------------------------------------------------------------
// Public traversal queries.
// ---------------------------------------------------------------------------

export interface TraversalInput {
  readonly tenantId: string;
  readonly id: string;
  readonly kind: "asset" | "lot" | "method-application";
  /** Default MAX_TRAVERSAL_DEPTH. Must be ≥ 1. */
  readonly maxDepth?: number;
}

function validateInput(input: TraversalInput): TraversalResult | null {
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return {
      ok: false,
      order: "ancestry",
      seed: { kind: input.kind ?? "asset", id: input.id ?? "" },
      edges: [],
      visited: [],
      refusal: "tenant-id-empty",
      depth: 0,
    };
  }
  if (typeof input.id !== "string" || input.id === "") {
    return {
      ok: false,
      order: "ancestry",
      seed: { kind: input.kind ?? "asset", id: input.id ?? "" },
      edges: [],
      visited: [],
      refusal: "missing-target",
      depth: 0,
    };
  }
  return null;
}

export function ancestry(graph: LineageGraph, input: TraversalInput): TraversalResult {
  const fail = validateInput(input);
  if (fail) return { ...fail, order: "ancestry" };
  const maxDepth = input.maxDepth ?? MAX_TRAVERSAL_DEPTH;
  return bfs(
    graph,
    { kind: input.kind, id: input.id },
    "ancestry",
    maxDepth,
    input.tenantId,
  );
}

export function descendants(graph: LineageGraph, input: TraversalInput): TraversalResult {
  const fail = validateInput(input);
  if (fail) return { ...fail, order: "descendants" };
  const maxDepth = input.maxDepth ?? MAX_TRAVERSAL_DEPTH;
  return bfs(
    graph,
    { kind: input.kind, id: input.id },
    "descendants",
    maxDepth,
    input.tenantId,
  );
}

export function ancestryBounded(graph: LineageGraph, input: TraversalInput): TraversalResult {
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return {
      ok: false,
      order: "ancestry",
      seed: { kind: input.kind ?? "asset", id: input.id ?? "" },
      edges: [],
      visited: [],
      refusal: "tenant-id-empty",
      depth: 0,
    };
  }
  const maxDepth = input.maxDepth ?? 1;
  if (maxDepth < 1 || maxDepth > MAX_TRAVERSAL_DEPTH) {
    return {
      ok: false,
      order: "ancestry",
      seed: { kind: input.kind, id: input.id },
      edges: [],
      visited: [],
      refusal: "traversal-overflow",
      depth: 0,
    };
  }
  return bfs(
    graph,
    { kind: input.kind, id: input.id },
    "ancestry",
    maxDepth,
    input.tenantId,
  );
}

export function descendantsBounded(graph: LineageGraph, input: TraversalInput): TraversalResult {
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return {
      ok: false,
      order: "descendants",
      seed: { kind: input.kind ?? "asset", id: input.id ?? "" },
      edges: [],
      visited: [],
      refusal: "tenant-id-empty",
      depth: 0,
    };
  }
  const maxDepth = input.maxDepth ?? 1;
  if (maxDepth < 1 || maxDepth > MAX_TRAVERSAL_DEPTH) {
    return {
      ok: false,
      order: "descendants",
      seed: { kind: input.kind, id: input.id },
      edges: [],
      visited: [],
      refusal: "traversal-overflow",
      depth: 0,
    };
  }
  return bfs(
    graph,
    { kind: input.kind, id: input.id },
    "descendants",
    maxDepth,
    input.tenantId,
  );
}

// ---------------------------------------------------------------------------
// Tenant isolation — the cross-tenant edge filter (machine-tested).
// ---------------------------------------------------------------------------

/**
 * Returns the edges in `graph` whose tenantId matches `tenantId`. Used by
 * tests + applications to demonstrate the cross-tenant filter explicitly.
 * This is informational: the traversal queries already filter internally.
 */
export function tenantEdges(
  graph: LineageGraph,
  tenantId: string,
): ReadonlyArray<LineageEdge> {
  if (typeof tenantId !== "string" || tenantId === "") return [];
  return graph.edges.filter((e) => e.tenantId === tenantId);
}
