/**
 * infrastructure/fleetos-marketplace/evidence-store.ts — the F361B
 * MarketplaceEvidenceStorePort over the authoritative PostgreSQL store
 * (F370C, Wave 18 lane C).
 *
 * The port's own header is the mandate: "production injects the durable
 * PostgreSQL/object-store repository. The in-memory reference below is
 * for tests and deterministic reference paths." This module IS that
 * injection — the port contract (the frozen validation order, the refusal
 * reasons, the duplicate-provider-event law: the ORIGINAL record wins,
 * never a second conclusion) implemented over the MarketplaceStore. The
 * content digest and the evidence id are computed by the REAL
 * @fleetos/evidence pure helpers (computeMarketplaceEvidenceDigest /
 * marketplaceEvidenceId — composed, never re-implemented); the reference
 * implementation stays untouched in its package.
 */

import type {
  MarketplaceEvidenceCaller,
  MarketplaceEvidenceInput,
  MarketplaceEvidenceRecord,
  MarketplaceEvidenceRecordOutcome,
  MarketplaceEvidenceStorePort,
} from "@fleetos/evidence";
import { computeMarketplaceEvidenceDigest, marketplaceEvidenceId } from "@fleetos/evidence";
import type { MarketplaceStore } from "./store.js";

export class PgMarketplaceEvidenceStore implements MarketplaceEvidenceStorePort {
  private readonly store: MarketplaceStore;

  constructor(store: MarketplaceStore) {
    this.store = store;
  }

  async recordEvidence(
    caller: MarketplaceEvidenceCaller,
    input: MarketplaceEvidenceInput,
    at: string,
  ): Promise<MarketplaceEvidenceRecordOutcome> {
    // The port contract, in the reference's frozen order.
    if (caller.tenantId !== input.tenantId) {
      return { ok: false, reason: "refused.tenant_mismatch" };
    }
    if (input.providerEventId === "") {
      return { ok: false, reason: "refused.missing_provider_event_id" };
    }
    if (input.source.system === "" || input.source.reference === "") {
      return { ok: false, reason: "refused.missing_source" };
    }
    if (input.capturedAt === "" || Number.isNaN(Date.parse(input.capturedAt))) {
      return { ok: false, reason: "refused.missing_captured_at" };
    }
    if (Date.parse(input.capturedAt) > Date.parse(at)) {
      return { ok: false, reason: "refused.captured_at_in_future" };
    }
    if (input.artifacts.length === 0) {
      return { ok: false, reason: "refused.no_artifacts" };
    }
    // Duplicate provider event: the ORIGINAL record is returned — never a
    // second conclusion; a divergent payload is flagged, the original wins.
    const original = await this.store.findEvidenceByProviderEvent(caller, input.providerEventId);
    if (original !== null) {
      const presented = computeMarketplaceEvidenceDigest(input);
      return {
        ok: true,
        record: original,
        duplicate: true,
        presentedContentDigest: presented,
        divergent: presented !== original.contentDigest,
      };
    }
    const contentDigest = computeMarketplaceEvidenceDigest(input);
    const record: MarketplaceEvidenceRecord = {
      ...input,
      evidenceId: marketplaceEvidenceId(input),
      contentDigest,
      recordedAt: at,
    };
    await this.store.insertEvidenceIfAbsent(caller, record);
    return { ok: true, record, duplicate: false };
  }

  async readEvidence(caller: MarketplaceEvidenceCaller, evidenceId: string): Promise<MarketplaceEvidenceRecord | null> {
    // Tenant-scoped fail-closed read: a foreign record is like absence.
    for (const record of await this.store.listEvidence(caller)) {
      if (record.evidenceId === evidenceId) return record;
    }
    return null;
  }

  async findByProviderEvent(caller: MarketplaceEvidenceCaller, providerEventId: string): Promise<MarketplaceEvidenceRecord | null> {
    return this.store.findEvidenceByProviderEvent(caller, providerEventId);
  }

  async listBySubject(caller: MarketplaceEvidenceCaller, subjectRef: string): Promise<readonly MarketplaceEvidenceRecord[]> {
    const all = await this.store.listEvidence(caller);
    return all
      .filter((r) => r.subjectRef === subjectRef)
      .sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : a.evidenceId > b.evidenceId ? 1 : 0));
  }
}
