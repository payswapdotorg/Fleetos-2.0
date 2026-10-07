/**
 * @fleetos/evidence — Content-addressed artifact store + bundle completeness.
 *
 * Law A13: every consequential operation is traceable through evidence to
 * actor, intent, authorization, execution, verification, capability/model
 * version.
 *
 * Law A19: append-only, tenant-scoped, hash-verifiable, machine-readable.
 *
 * Content-addressed: artifacts are keyed by sha-256 digest. Dedup is automatic
 * — storing the same bytes twice returns the same artifactId.
 *
 * Bundle completeness: a bundle referencing a missing artifact is INVALID.
 * The verification returns sorted missing paths (fail-closed).
 *
 * Pure types + pure functions + deterministic in-memory reference.
 */

import type { ContentAddressedArtifact } from "./index.ts";
import { sha256Hex, utf8Bytes, defaultSha256, type Sha256Port } from "./index.ts";

/**
 * Artifact store port — production injects an object-store-backed
 * repository (e.g. R2/S3). The in-memory reference is for tests and
 * deterministic reference paths.
 */
export interface ArtifactStorePort {
  readonly store: (bytes: Uint8Array, mediaType: string, description: string) => Promise<ContentAddressedArtifact>;
  readonly retrieve: (sha256: string) => Promise<ContentAddressedArtifact | null>;
  readonly exists: (sha256: string) => Promise<boolean>;
}

/**
 * Deterministic in-memory artifact store.
 *
 * Content-addressed: keyed by sha-256 digest. Storing the same bytes twice
 * returns the same artifact — automatic dedup.
 */
export class InMemoryArtifactStore implements ArtifactStorePort {
  private readonly artifacts = new Map<string, { readonly artifact: ContentAddressedArtifact; readonly bytes: Uint8Array }>();
  private readonly port: Sha256Port;

  constructor(port: Sha256Port = defaultSha256) {
    this.port = port;
  }

  async store(bytes: Uint8Array, mediaType: string, description: string): Promise<ContentAddressedArtifact> {
    const digest = sha256Hex(bytes, this.port);
    const existing = this.artifacts.get(digest);
    if (existing) return existing.artifact;
    const artifact: ContentAddressedArtifact = {
      artifactId: `art-${digest.slice(0, 16)}`,
      sha256: digest,
      bytes: bytes.byteLength,
      mediaType,
      description,
    };
    this.artifacts.set(digest, { artifact, bytes });
    return artifact;
  }

  async retrieve(sha256: string): Promise<ContentAddressedArtifact | null> {
    return this.artifacts.get(sha256)?.artifact ?? null;
  }

  async exists(sha256: string): Promise<boolean> {
    return this.artifacts.has(sha256);
  }

  /** Test-only — number of unique digests stored. */
  size(): number {
    return this.artifacts.size;
  }
}

/**
 * Bundle assembly input — the evidence IDs and their referenced artifact digests.
 */
export interface BundleAssemblyInput {
  readonly bundleId: string;
  readonly tenantId: string;
  readonly entries: readonly {
    readonly evidenceId: string;
    readonly artifactDigests: readonly string[];
  }[];
}

/** Bundle completeness verification result. */
export interface BundleCompletenessResult {
  readonly verified: boolean;
  readonly bundleId: string;
  readonly tenantId: string;
  readonly totalArtifacts: number;
  readonly missingArtifacts: readonly string[];
  readonly presentArtifacts: number;
}

/**
 * Verify bundle completeness — fail-closed.
 *
 * A bundle referencing a missing artifact is INVALID. The missing digests are
 * returned sorted (deterministic) so callers can report exactly which
 * artifacts are absent.
 *
 * Law A13: completeness is verified — an incomplete bundle cannot be sealed.
 */
export async function verifyBundleCompleteness(
  store: ArtifactStorePort,
  input: BundleAssemblyInput,
): Promise<BundleCompletenessResult> {
  const allDigests = new Set<string>();
  for (const entry of input.entries) {
    for (const digest of entry.artifactDigests) {
      allDigests.add(digest);
    }
  }

  const missing: string[] = [];
  let present = 0;
  for (const digest of allDigests) {
    if (await store.exists(digest)) {
      present += 1;
    } else {
      missing.push(digest);
    }
  }

  return {
    verified: missing.length === 0,
    bundleId: input.bundleId,
    tenantId: input.tenantId,
    totalArtifacts: allDigests.size,
    missingArtifacts: missing.sort(),
    presentArtifacts: present,
  };
}

/**
 * Assemble a bundle — stores all artifacts and verifies completeness.
 *
 * If any artifact is missing after assembly, the bundle is INVALID.
 * Returns the completeness result + the computed bundle digest.
 */
export async function assembleBundle(
  store: ArtifactStorePort,
  input: BundleAssemblyInput,
  port: Sha256Port = defaultSha256,
): Promise<{
  readonly completeness: BundleCompletenessResult;
  readonly bundleDigest: string;
}> {
  const completeness = await verifyBundleCompleteness(store, input);
  const evidenceIds = input.entries.map((e) => e.evidenceId).sort();
  const parts = `${input.bundleId}|${input.tenantId}|${evidenceIds.join(",")}`;
  const bundleDigest = sha256Hex(utf8Bytes(parts), port);
  return { completeness, bundleDigest };
}
