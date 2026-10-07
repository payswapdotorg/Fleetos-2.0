/**
 * @fleetos/evidence — A13 traceability chain.
 *
 * Law A13: every consequential operation must be traceable through evidence to:
 *   actor -> intent -> authorization -> execution -> verification -> capability/model version
 *
 * The TraceabilityChain is a typed causal chain that a user can inspect. Each
 * link points to the next, forming a verifiable causal path from the human
 * actor who initiated the action to the capability/model version that executed it.
 *
 * Pure types + pure functions + verification.
 */

import type { Sha256Port } from "./index.ts";
import { sha256Hex, utf8Bytes, defaultSha256 } from "./index.ts";

/** Link kind — one per stage of the A13 causal chain. */
export type TraceabilityLinkKind =
  | "actor"
  | "intent"
  | "authorization"
  | "execution"
  | "verification"
  | "capability_version";

/** A single link in the traceability chain. */
export interface TraceabilityLink {
  readonly kind: TraceabilityLinkKind;
  readonly ref: string;
  readonly recordedAt: string;
  readonly details: Readonly<Record<string, string>>;
}

/** The full A13 causal chain. */
export interface TraceabilityChain {
  readonly chainId: string;
  readonly tenantId: string;
  readonly links: readonly TraceabilityLink[];
  readonly computedAt: string;
  readonly chainDigest: string;
}

/** Verification result for a traceability chain. */
export interface TraceabilityVerification {
  readonly verified: boolean;
  readonly reason: TraceabilityBreakReason | null;
  readonly missingLinks: readonly TraceabilityLinkKind[];
  readonly computedDigest: string | null;
}

export type TraceabilityBreakReason =
  | "trace.empty"
  | "trace.missing_actor"
  | "trace.missing_intent"
  | "trace.missing_authorization"
  | "trace.missing_execution"
  | "trace.missing_verification"
  | "trace.missing_capability_version"
  | "trace.tenant_mismatch"
  | "trace.digest_mismatch";

/** The required link kinds in order (law A13). */
export const REQUIRED_LINK_KINDS: readonly TraceabilityLinkKind[] = [
  "actor",
  "intent",
  "authorization",
  "execution",
  "verification",
  "capability_version",
];

/**
 * Build a traceability chain from a set of links.
 *
 * The links may be provided in any order; they are sorted into the canonical
 * A13 order (actor -> intent -> authorization -> execution -> verification ->
 * capability_version).
 *
 * Pure + deterministic.
 */
export function buildTraceabilityChain(
  tenantId: string,
  links: readonly TraceabilityLink[],
  computedAt: string = "1970-01-01T00:00:00.000Z",
  port: Sha256Port = defaultSha256,
): TraceabilityChain {
  // Sort into canonical A13 order.
  const orderMap = new Map(REQUIRED_LINK_KINDS.map((k, i) => [k, i]));
  const sorted = [...links].sort((a, b) => {
    const ai = orderMap.get(a.kind) ?? 99;
    const bi = orderMap.get(b.kind) ?? 99;
    return ai - bi;
  });

  const chainId = `trace-${tenantId}-${sorted.map((l) => l.ref).join("|")}`;
  const digestInput = sorted.map((l) => `${l.kind}:${l.ref}`).join("->");
  const chainDigest = sha256Hex(utf8Bytes(digestInput), port);

  return {
    chainId,
    tenantId,
    links: sorted,
    computedAt,
    chainDigest,
  };
}

/**
 * Verify a traceability chain — pure, deterministic.
 *
 * Law A13: the chain MUST contain all six required link kinds in the canonical
 * order: actor -> intent -> authorization -> execution -> verification ->
 * capability_version.
 *
 * Checks:
 *   - empty => verified:false, all missing.
 *   - every required kind must be present.
 *   - links must be in canonical order.
 *   - tenantId must be consistent across links.
 *   - chainDigest must match recomputation.
 */
export function verifyTraceabilityChain(
  chain: TraceabilityChain,
  port: Sha256Port = defaultSha256,
): TraceabilityVerification {
  if (chain.links.length === 0) {
    return {
      verified: false,
      reason: "trace.empty",
      missingLinks: [...REQUIRED_LINK_KINDS],
      computedDigest: null,
    };
  }

  // Check all required kinds are present.
  const presentKinds = new Set(chain.links.map((l) => l.kind));
  const missing = REQUIRED_LINK_KINDS.filter((k) => !presentKinds.has(k));
  if (missing.length > 0) {
    // Determine the specific reason for the first missing kind.
    const reason: TraceabilityBreakReason = missing[0] === "actor" ? "trace.missing_actor"
      : missing[0] === "intent" ? "trace.missing_intent"
      : missing[0] === "authorization" ? "trace.missing_authorization"
      : missing[0] === "execution" ? "trace.missing_execution"
      : missing[0] === "verification" ? "trace.missing_verification"
      : "trace.missing_capability_version";
    return { verified: false, reason, missingLinks: missing, computedDigest: null };
  }

  // Check canonical order.
  const orderMap = new Map(REQUIRED_LINK_KINDS.map((k, i) => [k, i]));
  for (let i = 1; i < chain.links.length; i += 1) {
    const prev = chain.links[i - 1]!;
    const curr = chain.links[i]!;
    const prevOrder = orderMap.get(prev.kind) ?? 99;
    const currOrder = orderMap.get(curr.kind) ?? 99;
    if (currOrder < prevOrder) {
      return { verified: false, reason: "trace.digest_mismatch", missingLinks: [], computedDigest: null };
    }
  }

  // Check tenant consistency.
  for (const link of chain.links) {
    if (link.details["tenantId"] !== undefined && link.details["tenantId"] !== chain.tenantId) {
      return { verified: false, reason: "trace.tenant_mismatch", missingLinks: [], computedDigest: null };
    }
  }

  // Recompute digest.
  const digestInput = chain.links.map((l) => `${l.kind}:${l.ref}`).join("->");
  const computed = sha256Hex(utf8Bytes(digestInput), port);
  if (computed !== chain.chainDigest) {
    return { verified: false, reason: "trace.digest_mismatch", missingLinks: [], computedDigest: computed };
  }

  return {
    verified: true,
    reason: null,
    missingLinks: [],
    computedDigest: computed,
  };
}

/**
 * Build a complete traceability chain from the standard A13 inputs.
 *
 * Convenience constructor — assembles all six links in canonical order.
 */
export function buildCompleteChain(input: {
  readonly tenantId: string;
  readonly actorId: string;
  readonly intentRef: string;
  readonly authorizationRef: string;
  readonly executionRef: string;
  readonly verificationRef: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly recordedAt: string;
}, port: Sha256Port = defaultSha256): TraceabilityChain {
  const links: TraceabilityLink[] = [
    { kind: "actor", ref: input.actorId, recordedAt: input.recordedAt, details: { tenantId: input.tenantId } },
    { kind: "intent", ref: input.intentRef, recordedAt: input.recordedAt, details: { tenantId: input.tenantId } },
    { kind: "authorization", ref: input.authorizationRef, recordedAt: input.recordedAt, details: { tenantId: input.tenantId } },
    { kind: "execution", ref: input.executionRef, recordedAt: input.recordedAt, details: { tenantId: input.tenantId } },
    { kind: "verification", ref: input.verificationRef, recordedAt: input.recordedAt, details: { tenantId: input.tenantId } },
    { kind: "capability_version", ref: `${input.capabilityId}:${input.capabilityVersion}`, recordedAt: input.recordedAt, details: { tenantId: input.tenantId } },
  ];
  return buildTraceabilityChain(input.tenantId, links, input.recordedAt, port);
}
