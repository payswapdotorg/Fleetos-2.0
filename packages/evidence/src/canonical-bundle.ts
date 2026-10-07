/**
 * @fleetos/evidence — Canonical evidence bundles (F220B, Wave 2).
 *
 * Content-addressed entries (sha-256 digests over canonical JSON payloads),
 * bundle integrity verification, chain-of-custody refs, and verification
 * records with signer-free determinism.
 *
 * The sha-256 seam is the package's existing `Sha256Port` (node:crypto
 * default) — the same approach F230A used in `apps/agent`.
 *
 * Laws:
 *  - A13: every consequential operation is traceable through evidence.
 *  - A19: bundles are tenant-scoped, hash-verifiable, machine-readable.
 *  - A8: entries are tenant-scoped; a cross-tenant entry inside a bundle
 *    FAILS the integrity verification (fail-closed).
 *  - Determinism: no wall-clock anywhere — `recordedAt` / `sealedAt` /
 *    `verifiedAt` are explicit number inputs; identical inputs produce
 *    byte-identical digests.
 */

import { sha256Hex, utf8Bytes, defaultSha256 } from "./index.ts";
import type { Sha256Port } from "./index.ts";

// ---------------------------------------------------------------------------
// Canonical JSON — deterministic serialization
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: object keys sorted recursively, arrays kept in order,
 * strings JSON-escaped. The SAME value always serializes to the SAME bytes —
 * the foundation of content addressing.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => serialize(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

// ---------------------------------------------------------------------------
// Chain-of-custody vocabulary
// ---------------------------------------------------------------------------

export type CustodyRole = "collector" | "custodian" | "verifier" | "archivist";

export interface CustodyRef {
  readonly actorId: string;
  readonly role: CustodyRole;
  /** Epoch ms — explicit time input. */
  readonly at: number;
}

export type CustodyRefusalCode =
  | "custody.empty"
  | "custody.missing-actor"
  | "custody.missing-collector"
  | "custody.unordered";

/**
 * Verify the chain of custody of one entry.
 *
 * Rules (deterministic):
 *  1. the chain is non-empty;
 *  2. every actor id is non-empty;
 *  3. the FIRST holder must be the `collector` (who captured the evidence);
 *  4. custody timestamps are non-decreasing (hands pass forward in time).
 */
export function verifyChainOfCustody(custody: readonly CustodyRef[]): {
  readonly ok: boolean;
  readonly reason: CustodyRefusalCode | null;
} {
  if (custody.length === 0) return { ok: false, reason: "custody.empty" };
  for (const ref of custody) {
    if (ref.actorId === "") return { ok: false, reason: "custody.missing-actor" };
  }
  if (custody[0]!.role !== "collector") return { ok: false, reason: "custody.missing-collector" };
  for (let i = 1; i < custody.length; i += 1) {
    if (custody[i]!.at < custody[i - 1]!.at) return { ok: false, reason: "custody.unordered" };
  }
  return { ok: true, reason: null };
}

// ---------------------------------------------------------------------------
// Canonical entries — content-addressed
// ---------------------------------------------------------------------------

export type CanonicalEvidenceKind =
  | "actor-intent"
  | "authorization"
  | "execution"
  | "verification"
  | "capability-version"
  | "observation"
  | "model-output";

export interface CanonicalEvidenceEntry {
  readonly entryId: string;
  readonly tenantId: string;
  readonly kind: CanonicalEvidenceKind;
  /** sha-256 over the canonical JSON of the payload. */
  readonly payloadDigest: string;
  readonly recordedAt: number;
  readonly custody: readonly CustodyRef[];
}

export type EntryRefusalCode =
  | "entry.missing-tenant"
  | "entry.missing-entry-id"
  | "entry.invalid-recorded-at"
  | "entry.bad-custody";

export type EntryBuildResult =
  | { readonly ok: true; readonly entry: CanonicalEvidenceEntry }
  | { readonly ok: false; readonly reason: EntryRefusalCode; readonly custodyReason: CustodyRefusalCode | null };

/**
 * Build a canonical evidence entry — content-addressed.
 *
 * The payload digest is sha-256 over `canonicalJson(payload)`: the same
 * payload (regardless of key order) always yields the same digest.
 */
export function buildCanonicalEntry(
  input: {
    readonly entryId: string;
    readonly tenantId: string;
    readonly kind: CanonicalEvidenceKind;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly recordedAt: number;
    readonly custody: readonly CustodyRef[];
  },
  port: Sha256Port = defaultSha256,
): EntryBuildResult {
  if (input.tenantId === "") return { ok: false, reason: "entry.missing-tenant", custodyReason: null };
  if (input.entryId === "") return { ok: false, reason: "entry.missing-entry-id", custodyReason: null };
  if (!Number.isInteger(input.recordedAt) || input.recordedAt < 0) {
    return { ok: false, reason: "entry.invalid-recorded-at", custodyReason: null };
  }
  const custody = verifyChainOfCustody(input.custody);
  if (!custody.ok) {
    return { ok: false, reason: "entry.bad-custody", custodyReason: custody.reason };
  }
  return {
    ok: true,
    entry: {
      entryId: input.entryId,
      tenantId: input.tenantId,
      kind: input.kind,
      payloadDigest: sha256Hex(utf8Bytes(canonicalJson(input.payload)), port),
      recordedAt: input.recordedAt,
      custody: [...input.custody],
    },
  };
}

// ---------------------------------------------------------------------------
// Bundle sealing — content-addressed, insertion-order independent
// ---------------------------------------------------------------------------

export interface CanonicalEvidenceBundle {
  readonly bundleId: string;
  readonly tenantId: string;
  /** Sorted by entryId — deterministic iteration. */
  readonly entries: readonly CanonicalEvidenceEntry[];
  /** sha-256 over (bundleId, tenantId, sorted entry digests). */
  readonly bundleDigest: string;
  readonly sealedAt: number;
}

export type BundleRefusalCode =
  | "bundle.missing-bundle-id"
  | "bundle.missing-tenant"
  | "bundle.empty-entries"
  | "bundle.duplicate-entry"
  | "bundle.tenant-mismatch"
  | "bundle.invalid-sealed-at";

export type BundleSealResult =
  | { readonly ok: true; readonly bundle: CanonicalEvidenceBundle }
  | { readonly ok: false; readonly reason: BundleRefusalCode };

/**
 * Compute the bundle digest — sha-256 over (bundleId, tenantId, the SORTED
 * `entryId:payloadDigest` pairs). Insertion order of entries NEVER affects
 * the digest; the digest covers BOTH the manifest (which entries) and the
 * content (their payload digests).
 */
export function computeCanonicalBundleDigest(
  bundleId: string,
  tenantId: string,
  entries: readonly CanonicalEvidenceEntry[],
  port: Sha256Port = defaultSha256,
): string {
  const pairs = entries.map((e) => `${e.entryId}:${e.payloadDigest}`).sort();
  const parts = `${bundleId}|${tenantId}|${pairs.join(",")}`;
  return sha256Hex(utf8Bytes(parts), port);
}

/**
 * Seal a canonical bundle.
 *
 * Refuses: missing bundle id / tenant, empty entry set, duplicate entry ids,
 * entries from another tenant (A8 fail-closed), invalid `sealedAt`.
 */
export function sealCanonicalBundle(
  input: {
    readonly bundleId: string;
    readonly tenantId: string;
    readonly entries: readonly CanonicalEvidenceEntry[];
    readonly sealedAt: number;
  },
  port: Sha256Port = defaultSha256,
): BundleSealResult {
  if (input.bundleId === "") return { ok: false, reason: "bundle.missing-bundle-id" };
  if (input.tenantId === "") return { ok: false, reason: "bundle.missing-tenant" };
  if (input.entries.length === 0) return { ok: false, reason: "bundle.empty-entries" };
  if (!Number.isInteger(input.sealedAt) || input.sealedAt < 0) {
    return { ok: false, reason: "bundle.invalid-sealed-at" };
  }
  const seen = new Set<string>();
  for (const entry of input.entries) {
    if (seen.has(entry.entryId)) return { ok: false, reason: "bundle.duplicate-entry" };
    seen.add(entry.entryId);
    if (entry.tenantId !== input.tenantId) return { ok: false, reason: "bundle.tenant-mismatch" };
  }
  const sorted = [...input.entries].sort((a, b) => (a.entryId < b.entryId ? -1 : 1));
  return {
    ok: true,
    bundle: {
      bundleId: input.bundleId,
      tenantId: input.tenantId,
      entries: sorted,
      bundleDigest: computeCanonicalBundleDigest(input.bundleId, input.tenantId, sorted, port),
      sealedAt: input.sealedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Bundle integrity verification
// ---------------------------------------------------------------------------

export type BundleIntegrityCode =
  | "integrity.tenant-mismatch"
  | "integrity.duplicate-entry"
  | "integrity.entry-digest-mismatch"
  | "integrity.custody-unordered"
  | "integrity.custody-missing-actor"
  | "integrity.custody-empty"
  | "integrity.custody-missing-collector"
  | "integrity.bundle-digest-mismatch";

export interface BundleIntegrityResult {
  readonly verified: boolean;
  readonly checkedEntries: number;
  readonly brokenEntryId: string | null;
  readonly reason: BundleIntegrityCode | null;
}

function custodyCode(reason: CustodyRefusalCode): BundleIntegrityCode {
  switch (reason) {
    case "custody.empty": return "integrity.custody-empty";
    case "custody.missing-actor": return "integrity.custody-missing-actor";
    case "custody.unordered": return "integrity.custody-unordered";
    case "custody.missing-collector": return "integrity.custody-missing-collector";
  }
}

/**
 * Verify bundle integrity — fail-closed.
 *
 * Checks (in order):
 *  1. every entry's tenantId matches the bundle's tenant (A8);
 *  2. entry ids are unique;
 *  3. every entry's custody chain is valid;
 *  4. every entry's payloadDigest is a well-formed sha-256 hex digest
 *     (64 lowercase hex chars) — a tampered/placeholder digest fails;
 *  5. the bundle digest recomputes exactly.
 */
export function verifyCanonicalBundle(
  bundle: CanonicalEvidenceBundle,
  port: Sha256Port = defaultSha256,
): BundleIntegrityResult {
  const seen = new Set<string>();
  for (const entry of bundle.entries) {
    if (entry.tenantId !== bundle.tenantId) {
      return { verified: false, checkedEntries: 0, brokenEntryId: entry.entryId, reason: "integrity.tenant-mismatch" };
    }
    if (seen.has(entry.entryId)) {
      return { verified: false, checkedEntries: 0, brokenEntryId: entry.entryId, reason: "integrity.duplicate-entry" };
    }
    seen.add(entry.entryId);
    const custody = verifyChainOfCustody(entry.custody);
    if (!custody.ok) {
      return {
        verified: false,
        checkedEntries: 0,
        brokenEntryId: entry.entryId,
        reason: custodyCode(custody.reason!),
      };
    }
    if (!/^[0-9a-f]{64}$/.test(entry.payloadDigest)) {
      return { verified: false, checkedEntries: 0, brokenEntryId: entry.entryId, reason: "integrity.entry-digest-mismatch" };
    }
  }
  const expected = computeCanonicalBundleDigest(bundle.bundleId, bundle.tenantId, bundle.entries, port);
  if (expected !== bundle.bundleDigest) {
    return { verified: false, checkedEntries: bundle.entries.length, brokenEntryId: null, reason: "integrity.bundle-digest-mismatch" };
  }
  return { verified: true, checkedEntries: bundle.entries.length, brokenEntryId: null, reason: null };
}

// ---------------------------------------------------------------------------
// Verification records — signer-free determinism
// ---------------------------------------------------------------------------

export interface BundleVerificationRecord {
  /** Content-addressed: sha-256 over (bundleDigest, verifiedAt, outcome). */
  readonly verificationId: string;
  readonly bundleId: string;
  readonly tenantId: string;
  readonly outcome: "verified" | "failed";
  readonly reason: BundleIntegrityCode | null;
  readonly checkedEntries: number;
  /** Explicit time input — NEVER wall-clock. */
  readonly verifiedAt: number;
  /** sha-256 over the canonical record fields — signer-free integrity. */
  readonly recordDigest: string;
}

export type VerificationRecordResult =
  | { readonly ok: true; readonly record: BundleVerificationRecord }
  | { readonly ok: false; readonly reason: "verify.invalid-verified-at" };

/**
 * Verify a bundle AND produce the verification record in one step.
 *
 * Signer-free determinism: the record carries no signature and no timestamp
 * of its own — `verifiedAt` is an explicit input, and the record digest is
 * sha-256 over the canonical record fields. The same bundle + the same
 * `verifiedAt` ALWAYS produce the byte-identical record.
 */
export function verifyBundleAndRecord(
  bundle: CanonicalEvidenceBundle,
  verifiedAt: number,
  port: Sha256Port = defaultSha256,
): VerificationRecordResult {
  if (!Number.isInteger(verifiedAt) || verifiedAt < 0) {
    return { ok: false, reason: "verify.invalid-verified-at" };
  }
  const integrity = verifyCanonicalBundle(bundle, port);
  const outcome: "verified" | "failed" = integrity.verified ? "verified" : "failed";
  const canonical = canonicalJson({
    bundleId: bundle.bundleId,
    tenantId: bundle.tenantId,
    bundleDigest: bundle.bundleDigest,
    outcome,
    reason: integrity.reason,
    checkedEntries: integrity.checkedEntries,
    verifiedAt,
  });
  const recordDigest = sha256Hex(utf8Bytes(canonical), port);
  return {
    ok: true,
    record: {
      verificationId: `ver-${recordDigest.slice(0, 24)}`,
      bundleId: bundle.bundleId,
      tenantId: bundle.tenantId,
      outcome,
      reason: integrity.reason,
      checkedEntries: integrity.checkedEntries,
      verifiedAt,
      recordDigest,
    },
  };
}
