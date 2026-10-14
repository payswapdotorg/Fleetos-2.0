/**
 * @fleetos/evidence — the F361B marketplace evidence-retention contract.
 *
 * Frozen law: MARKETPLACE-MVP-FREEZE.md §3.6 (F360) — evidence retention
 * for marketplace artifacts (offer snapshot, provider-ack reference,
 * fulfilment evidence, receipt evidence) with:
 *
 *   - tenant-scoped, FAIL-CLOSED reads — a foreign-tenant caller reads
 *     null/[] (indistinguishable from absence, no existence leak) and a
 *     foreign-tenant WRITE is refused outright (reason
 *     `refused.tenant_mismatch`, store unchanged);
 *   - source + captured-at freshness fields on EVERY record — a record
 *     without them is refused at intake, and a capturedAt in the future
 *     (relative to the caller-supplied logical recording time) is refused
 *     as untrusted (mission §6: external events untrusted until
 *     validated);
 *   - duplicate-event refusal — the SAME provider event id presented
 *     twice returns the ORIGINAL record, never a second conclusion. First
 *     write wins; a divergent re-presentation is flagged in the outcome
 *     but the original record is preserved verbatim and the store never
 *     grows.
 *
 * Lane boundary (F360 §2 + §5): this module owns the RETENTION records
 * (artifact references + provider event ids + provenance). The receipt
 * VERIFICATION state machine (recorded → verified | discrepancy) is
 * Worker A's `packages/assets` lane; the shared seam is the frozen
 * receipt-evidence reference TYPE, never a shared file. The marketplace
 * offer/order states are Worker C's `packages/procurement` lane. No
 * supplier/order truth lives here.
 *
 * Composition: content digests are computed through the EXISTING
 * `sha256Hex`/`utf8Bytes` public APIs; artifact payloads stay in the
 * EXISTING `ContentAddressedArtifact` shape. No new persistence system —
 * deterministic in-memory reference over a port (production injects the
 * PostgreSQL/object-store repositories per the Architecture Lock).
 *
 * Determinism: no clock, no randomness — every timestamp is
 * caller-supplied logical time; digests are pure functions of content.
 */

import { sha256Hex, utf8Bytes } from "./index.ts";
import type { ContentAddressedArtifact } from "./index.ts";

/** The frozen marketplace artifact kinds (F360 §3.6). */
export type MarketplaceEvidenceKind =
  | "marketplace.offer-snapshot"
  | "marketplace.provider-ack"
  | "marketplace.fulfilment"
  | "marketplace.receipt";

/** Where the evidence came from — the F360 manual seams, honestly labelled. */
export interface MarketplaceEvidenceSource {
  /** The source system, e.g. "manual-catalogue-import", "provider-portal-export". */
  readonly system: string;
  /** The concrete reference: document id, invoice number, export file name. */
  readonly reference: string;
  /** How it was retrieved — the frozen pilot seams (never a live-API claim). */
  readonly retrievedVia: "manual" | "export";
}

/** The intake input for one marketplace evidence record. */
export interface MarketplaceEvidenceInput {
  readonly tenantId: string;
  /** The EXTERNAL provider's event id — the duplicate-refusal identity. */
  readonly providerEventId: string;
  readonly kind: MarketplaceEvidenceKind;
  /** The marketplace subject the evidence belongs to (offer id or order id). */
  readonly subjectRef: string;
  readonly source: MarketplaceEvidenceSource;
  /** When the source content was captured (freshness law). ISO-8601 UTC. */
  readonly capturedAt: string;
  readonly artifacts: readonly ContentAddressedArtifact[];
}

/** The retained record — immutable, content-addressed, tenant-scoped. */
export interface MarketplaceEvidenceRecord extends MarketplaceEvidenceInput {
  readonly evidenceId: string;
  /** sha-256 over the canonical material (providerEventId, kind, subject, source, capturedAt, sorted artifact digests). */
  readonly contentDigest: string;
  /** Logical recording time (caller-supplied — never a wall clock). */
  readonly recordedAt: string;
}

/** Machine-stable intake refusal reasons. */
export type MarketplaceEvidenceRefusalReason =
  | "refused.tenant_mismatch"
  | "refused.missing_provider_event_id"
  | "refused.missing_source"
  | "refused.missing_captured_at"
  | "refused.captured_at_in_future"
  | "refused.no_artifacts";

export type MarketplaceEvidenceRecordOutcome =
  | { readonly ok: true; readonly record: MarketplaceEvidenceRecord; readonly duplicate: false }
  /**
   * Duplicate provider event: the ORIGINAL record is returned — never a
   * second conclusion. `presentedContentDigest` is what the re-presentation
   * claimed; `divergent` flags a differing payload (the original still wins).
   */
  | {
    readonly ok: true;
    readonly record: MarketplaceEvidenceRecord;
    readonly duplicate: true;
    readonly presentedContentDigest: string;
    readonly divergent: boolean;
  }
  | { readonly ok: false; readonly reason: MarketplaceEvidenceRefusalReason };

/** The caller scope every store operation is fail-closed against. */
export interface MarketplaceEvidenceCaller {
  readonly tenantId: string;
}

/**
 * The evidence store port — production injects the durable
 * PostgreSQL/object-store repository. The in-memory reference below is
 * for tests and deterministic reference paths.
 */
export interface MarketplaceEvidenceStorePort {
  readonly recordEvidence: (
    caller: MarketplaceEvidenceCaller,
    input: MarketplaceEvidenceInput,
    at: string,
  ) => Promise<MarketplaceEvidenceRecordOutcome>;
  /** Tenant-scoped fail-closed read: foreign tenant => null (like absence). */
  readonly readEvidence: (caller: MarketplaceEvidenceCaller, evidenceId: string) => Promise<MarketplaceEvidenceRecord | null>;
  readonly findByProviderEvent: (caller: MarketplaceEvidenceCaller, providerEventId: string) => Promise<MarketplaceEvidenceRecord | null>;
  /** Tenant-scoped: only the caller's records, in recording order. */
  readonly listBySubject: (caller: MarketplaceEvidenceCaller, subjectRef: string) => Promise<readonly MarketplaceEvidenceRecord[]>;
}

/** Canonical content digest over the record's material (deterministic). */
export function computeMarketplaceEvidenceDigest(input: MarketplaceEvidenceInput): string {
  const parts = [
    input.tenantId,
    input.providerEventId,
    input.kind,
    input.subjectRef,
    input.source.system,
    input.source.reference,
    input.source.retrievedVia,
    input.capturedAt,
    input.artifacts.map((a) => a.sha256).sort().join(","),
  ];
  return sha256Hex(utf8Bytes(parts.join("|")));
}

/** Build the evidenceId for an input (content-addressed, deterministic). */
export function marketplaceEvidenceId(input: MarketplaceEvidenceInput): string {
  return `mpe-${computeMarketplaceEvidenceDigest(input).slice(0, 12)}`;
}

/**
 * Deterministic in-memory marketplace evidence store (the reference
 * implementation of the port).
 *
 * Keyspaces (all tenant-scoped — no cross-tenant leak is representable):
 *   - byId: evidenceId -> record
 *   - byEvent: `${tenantId}|${providerEventId}` -> evidenceId (dedup law)
 *   - bySubject: `${tenantId}|${subjectRef}` -> evidenceIds in recording order
 */
export class InMemoryMarketplaceEvidenceStore implements MarketplaceEvidenceStorePort {
  private readonly byId = new Map<string, MarketplaceEvidenceRecord>();
  private readonly byEvent = new Map<string, string>();
  private readonly bySubject = new Map<string, string[]>();

  async recordEvidence(
    caller: MarketplaceEvidenceCaller,
    input: MarketplaceEvidenceInput,
    at: string,
  ): Promise<MarketplaceEvidenceRecordOutcome> {
    // Tenant fail-closed WRITE: a caller may only record into its own scope.
    if (caller.tenantId !== input.tenantId) {
      return { ok: false, reason: "refused.tenant_mismatch" };
    }
    // Intake validation (fail-closed, deterministic order).
    if (input.providerEventId === "") {
      return { ok: false, reason: "refused.missing_provider_event_id" };
    }
    if (input.source.system === "" || input.source.reference === "") {
      return { ok: false, reason: "refused.missing_source" };
    }
    if (input.capturedAt === "") {
      return { ok: false, reason: "refused.missing_captured_at" };
    }
    if (Number.isNaN(Date.parse(input.capturedAt))) {
      return { ok: false, reason: "refused.missing_captured_at" };
    }
    if (Date.parse(input.capturedAt) > Date.parse(at)) {
      return { ok: false, reason: "refused.captured_at_in_future" };
    }
    if (input.artifacts.length === 0) {
      return { ok: false, reason: "refused.no_artifacts" };
    }
    // Duplicate provider-event refusal: first write wins, the ORIGINAL is
    // returned — never a second conclusion, the store never grows.
    const eventKey = `${input.tenantId}|${input.providerEventId}`;
    const existingId = this.byEvent.get(eventKey);
    if (existingId !== undefined) {
      const original = this.byId.get(existingId);
      if (original !== undefined) {
        const presented = computeMarketplaceEvidenceDigest(input);
        return {
          ok: true,
          record: original,
          duplicate: true,
          presentedContentDigest: presented,
          divergent: presented !== original.contentDigest,
        };
      }
    }
    const contentDigest = computeMarketplaceEvidenceDigest(input);
    const record: MarketplaceEvidenceRecord = {
      ...input,
      evidenceId: `mpe-${contentDigest.slice(0, 12)}`,
      contentDigest,
      recordedAt: at,
    };
    this.byId.set(record.evidenceId, record);
    this.byEvent.set(eventKey, record.evidenceId);
    const subjectKey = `${input.tenantId}|${input.subjectRef}`;
    const existing = this.bySubject.get(subjectKey) ?? [];
    existing.push(record.evidenceId);
    this.bySubject.set(subjectKey, existing);
    return { ok: true, record, duplicate: false };
  }

  async readEvidence(caller: MarketplaceEvidenceCaller, evidenceId: string): Promise<MarketplaceEvidenceRecord | null> {
    const record = this.byId.get(evidenceId);
    if (record === undefined) return null;
    if (record.tenantId !== caller.tenantId) return null; // fail-closed: like absence
    return record;
  }

  async findByProviderEvent(caller: MarketplaceEvidenceCaller, providerEventId: string): Promise<MarketplaceEvidenceRecord | null> {
    const evidenceId = this.byEvent.get(`${caller.tenantId}|${providerEventId}`);
    if (evidenceId === undefined) return null;
    const record = this.byId.get(evidenceId);
    if (record === undefined) return null;
    if (record.tenantId !== caller.tenantId) return null;
    return record;
  }

  async listBySubject(caller: MarketplaceEvidenceCaller, subjectRef: string): Promise<readonly MarketplaceEvidenceRecord[]> {
    const evidenceIds = this.bySubject.get(`${caller.tenantId}|${subjectRef}`) ?? [];
    return evidenceIds
      .map((id) => this.byId.get(id))
      .filter((r): r is MarketplaceEvidenceRecord => r !== undefined && r.tenantId === caller.tenantId);
  }

  /** Test-only — number of unique retained records across ALL tenants. */
  size(): number {
    return this.byId.size;
  }
}

/** Freshness classification thresholds (caller-supplied, deterministic). */
export interface MarketplaceEvidenceFreshnessThresholds {
  /** A record is fresh while its age is <= this (ms). */
  readonly freshWithinMs: number;
}

export type MarketplaceEvidenceFreshnessClass = "fresh" | "stale";

/**
 * Classify a record's freshness — the §3.2 law's honest form: a stale
 * record's class SAYS stale; callers never silently treat old evidence as
 * current. Pure: `nowMs` is caller-supplied logical time.
 */
export function classifyMarketplaceEvidenceFreshness(
  record: MarketplaceEvidenceRecord,
  nowMs: number,
  thresholds: MarketplaceEvidenceFreshnessThresholds,
): {
  readonly freshness: MarketplaceEvidenceFreshnessClass;
  readonly capturedAtMs: number;
  readonly ageMs: number;
} {
  const capturedAtMs = Date.parse(record.capturedAt);
  const ageMs = nowMs - capturedAtMs;
  return {
    freshness: ageMs <= thresholds.freshWithinMs ? "fresh" : "stale",
    capturedAtMs,
    ageMs,
  };
}
