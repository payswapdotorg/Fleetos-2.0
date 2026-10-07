/**
 * @fleetos/evidence — Evidence metadata, bundles, content-addressed artifacts,
 * verification records, append-only hash-chain contracts.
 *
 * Law A13: every consequential operation is traceable through evidence to
 * actor, intent, authorization, execution, verification, capability/model
 * version.
 *
 * Law A19: append-only, tenant-scoped, hash-verifiable, machine-readable.
 *
 * Pure types + pure functions only. The SHA-256 implementation uses node:crypto
 * through a SEAM (defaultSha256) so tests can substitute a deterministic
 * fake. `sha256Hex` is a pure function over (Uint8Array, Sha256Port).
 */

import { createHash } from "node:crypto";

/** LOCAL structural tenant scope (compatible with Worker A). */
export interface TenantScopeLike {
  readonly tenantId: string;
  readonly workspaceId?: string;
}

/** LOCAL structural mission reference (compatible with Worker C). */
export interface MissionRefLike {
  readonly missionId: string;
  readonly runId?: string;
  readonly workItemId?: string;
}

/** LOCAL structural capability ref (compatible with @fleetos/policy). */
export interface CapabilityVersionRef {
  readonly capabilityId: string;
  readonly version: string;
}

/** LOCAL structural actor ref. */
export interface ActorRef {
  readonly actorId: string;
  readonly isAutonomous: boolean;
}

/** Content-addressed artifact — sha-256 digest of canonical bytes. */
export interface ContentAddressedArtifact {
  readonly artifactId: string;
  readonly sha256: string; // 64 lowercase hex chars
  readonly bytes: number;
  readonly mediaType: string;
  readonly description: string;
}

/** Evidence metadata — points at artifacts, not the bytes themselves. */
export interface EvidenceMetadata {
  readonly evidenceId: string;
  readonly tenantId: string;
  readonly actor: ActorRef;
  readonly intentRef: string;
  readonly authorizationRef: string;
  readonly executionRef: string;
  readonly verificationRef: string;
  readonly capability: CapabilityVersionRef;
  readonly missionRef?: MissionRefLike;
  readonly artifacts: readonly ContentAddressedArtifact[];
  readonly recordedAt: string;
}

/** Bundle — multiple evidence records under one envelope. */
export interface EvidenceBundle {
  readonly bundleId: string;
  readonly tenantId: string;
  readonly evidenceIds: readonly string[];
  readonly sealedAt: string;
  readonly bundleDigest: string;
}

/**
 * Chain entry — append-only. Each entry links to the previous entry's digest.
 *
 * Law A19: append-only, tenant-scoped, hash-verifiable.
 */
export interface EvidenceChainEntry {
  readonly index: number; // 0-based, monotonically increasing
  readonly tenantId: string;
  readonly evidenceId: string;
  readonly previousDigest: string | null; // null only for index 0
  readonly entryDigest: string; // sha256 of (previousDigest || evidenceId || tenantId || index)
  readonly recordedAt: string;
}

/** Verification record — result of verifying the chain. */
export interface ChainVerificationRecord {
  readonly verified: boolean;
  readonly checkedEntries: number;
  readonly brokenAt: number | null;
  readonly reason: ChainBreakReason | null;
  readonly computedTailDigest: string | null;
}

export type ChainBreakReason =
  | "chain.empty"
  | "chain.tenant_mismatch"
  | "chain.index_gap"
  | "chain.previous_digest_mismatch"
  | "chain.entry_digest_mismatch"
  | "chain.first_entry_has_previous";

/**
 * SHA-256 seam — a port so tests can inject a deterministic fake.
 *
 * Default implementation uses node:crypto (lazy import) so the package itself
 * stays pure-typescript at the surface.
 */
export type Sha256Port = (bytes: Uint8Array) => string;

/** Convert a hex string to Uint8Array (deterministic). */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`hexToBytes: odd-length hex: ${hex.length}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`hexToBytes: invalid hex char at ${i}`);
    out[i / 2] = byte;
  }
  return out;
}

/** Convert Uint8Array to lowercase hex. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Default SHA-256 port — uses node:crypto. The seam allows test substitution.
 */
export const defaultSha256: Sha256Port = (bytes) => {
  return createHash("sha256").update(bytes).digest("hex");
};

/**
 * Pure sha256Hex over Uint8Array. Same input => same output, byte-identical.
 *
 * Accepts an optional port; defaults to node:crypto-backed implementation.
 */
export function sha256Hex(bytes: Uint8Array, port: Sha256Port = defaultSha256): string {
  return port(bytes);
}

/** Stable UTF-8 encoding of a string into Uint8Array. */
export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Compute the canonical entry digest for an EvidenceChainEntry. */
export function computeEntryDigest(
  previousDigest: string | null,
  evidenceId: string,
  tenantId: string,
  index: number,
  port: Sha256Port = defaultSha256,
): string {
  const parts = `${previousDigest ?? ""}|${evidenceId}|${tenantId}|${index}`;
  return sha256Hex(utf8Bytes(parts), port);
}

/** Append a new entry to a chain (pure — returns a new array, does not mutate). */
export function appendEvidence(
  chain: readonly EvidenceChainEntry[],
  evidence: { readonly evidenceId: string; readonly tenantId: string; readonly recordedAt: string },
  port: Sha256Port = defaultSha256,
): readonly EvidenceChainEntry[] {
  if (chain.length === 0) {
    const entryDigest = computeEntryDigest(null, evidence.evidenceId, evidence.tenantId, 0, port);
    return [{
      index: 0,
      tenantId: evidence.tenantId,
      evidenceId: evidence.evidenceId,
      previousDigest: null,
      entryDigest,
      recordedAt: evidence.recordedAt,
    }];
  }
  const last = chain[chain.length - 1]!;
  if (last.tenantId !== evidence.tenantId) {
    throw new Error(`appendEvidence: tenant mismatch (chain=${last.tenantId}, evidence=${evidence.tenantId})`);
  }
  const index = last.index + 1;
  const entryDigest = computeEntryDigest(last.entryDigest, evidence.evidenceId, evidence.tenantId, index, port);
  return [...chain, {
    index,
    tenantId: evidence.tenantId,
    evidenceId: evidence.evidenceId,
    previousDigest: last.entryDigest,
    entryDigest,
    recordedAt: evidence.recordedAt,
  }];
}

/**
 * Verify an evidence chain — pure, deterministic.
 *
 * Checks:
 *   - empty chain => verified:true, checked:0.
 *   - first entry must have previousDigest=null.
 *   - every entry's previousDigest must equal the prior entry's entryDigest.
 *   - every entry's index must equal its position in the array.
 *   - every entry's tenantId must be consistent.
 *   - every entry's entryDigest must equal computeEntryDigest(...).
 */
export function verifyEvidenceChain(
  chain: readonly EvidenceChainEntry[],
  port: Sha256Port = defaultSha256,
): ChainVerificationRecord {
  if (chain.length === 0) {
    return { verified: true, checkedEntries: 0, brokenAt: null, reason: "chain.empty", computedTailDigest: null };
  }
  const tenantId = chain[0]!.tenantId;
  let previousDigest: string | null = null;
  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i]!;
    if (entry.index !== i) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "chain.index_gap", computedTailDigest: previousDigest };
    }
    if (entry.tenantId !== tenantId) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "chain.tenant_mismatch", computedTailDigest: previousDigest };
    }
    if (i === 0) {
      if (entry.previousDigest !== null) {
        return { verified: false, checkedEntries: i, brokenAt: i, reason: "chain.first_entry_has_previous", computedTailDigest: previousDigest };
      }
    } else {
      if (entry.previousDigest !== previousDigest) {
        return { verified: false, checkedEntries: i, brokenAt: i, reason: "chain.previous_digest_mismatch", computedTailDigest: previousDigest };
      }
    }
    const expected = computeEntryDigest(entry.previousDigest, entry.evidenceId, entry.tenantId, entry.index, port);
    if (expected !== entry.entryDigest) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "chain.entry_digest_mismatch", computedTailDigest: previousDigest };
    }
    previousDigest = entry.entryDigest;
  }
  return { verified: true, checkedEntries: chain.length, brokenAt: null, reason: null, computedTailDigest: previousDigest };
}

/** Build a content-addressed artifact descriptor from raw bytes. */
export function buildArtifact(
  artifactId: string,
  bytes: Uint8Array,
  mediaType: string,
  description: string,
  port: Sha256Port = defaultSha256,
): ContentAddressedArtifact {
  return {
    artifactId,
    sha256: sha256Hex(bytes, port),
    bytes: bytes.byteLength,
    mediaType,
    description,
  };
}

/** Compute a deterministic bundle digest over evidence IDs. */
export function computeBundleDigest(
  bundleId: string,
  tenantId: string,
  evidenceIds: readonly string[],
  port: Sha256Port = defaultSha256,
): string {
  const parts = `${bundleId}|${tenantId}|${[...evidenceIds].sort().join(",")}`;
  return sha256Hex(utf8Bytes(parts), port);
}

// ---------- Wave 1 (F210B) kernel extensions ----------

export * from "./artifact-store.ts";
export * from "./traceability.ts";
