/**
 * F361B marketplace evidence-retention contract tests (packages/evidence).
 *
 * Frozen law: MARKETPLACE-MVP-FREEZE.md §3.6 — the four marketplace
 * artifact kinds, tenant-scoped fail-closed reads, source+captured-at
 * freshness, and duplicate-event refusal (the same provider event id
 * returns the ORIGINAL record, never a second conclusion).
 */

import { describe, it, expect } from "vitest";
import { buildArtifact, sha256Hex, utf8Bytes } from "../src/index.ts";
import {
  InMemoryMarketplaceEvidenceStore,
  classifyMarketplaceEvidenceFreshness,
  computeMarketplaceEvidenceDigest,
  marketplaceEvidenceId,
} from "../src/marketplace-evidence.ts";
import type {
  MarketplaceEvidenceInput,
  MarketplaceEvidenceRecord,
} from "../src/marketplace-evidence.ts";

const TENANT = { tenantId: "acme-ops" } as const;
const FOREIGN = { tenantId: "globex-rival" } as const;
const AT = "2026-10-14T10:00:00.000Z";
const CAPTURED_AT = "2026-10-14T09:30:00.000Z";

function art(payload: string, description: string) {
  return buildArtifact(`art-x-${description}`, utf8Bytes(payload), "application/json", description);
}

function offerSnapshotInput(overrides: Partial<MarketplaceEvidenceInput> = {}): MarketplaceEvidenceInput {
  return {
    tenantId: TENANT.tenantId,
    providerEventId: "prov-event-offer-1",
    kind: "marketplace.offer-snapshot",
    subjectRef: "order-100",
    source: { system: "manual-catalogue-import", reference: "catalogue-2026-10.ods", retrievedVia: "manual" },
    capturedAt: CAPTURED_AT,
    artifacts: [art(JSON.stringify({ offerId: "offer-1", total: 9_500 }), "offer snapshot for order-100")],
    ...overrides,
  };
}

describe("F361B marketplace evidence — intake and retention", () => {
  it("records all four frozen marketplace artifact kinds", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const kinds = [
      "marketplace.offer-snapshot",
      "marketplace.provider-ack",
      "marketplace.fulfilment",
      "marketplace.receipt",
    ] as const;
    for (const kind of kinds) {
      const outcome = await store.recordEvidence(
        TENANT,
        offerSnapshotInput({ kind, providerEventId: `prov-event-${kind.split(".")[1]}` }),
        AT,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.record.kind).toBe(kind);
    }
    expect(store.size()).toBe(4);
  });

  it("the retained record carries source + capturedAt verbatim (freshness law fields)", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const outcome = await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.record.source).toEqual({
        system: "manual-catalogue-import",
        reference: "catalogue-2026-10.ods",
        retrievedVia: "manual",
      });
      expect(outcome.record.capturedAt).toBe(CAPTURED_AT);
      expect(outcome.record.recordedAt).toBe(AT);
      expect(outcome.record.providerEventId).toBe("prov-event-offer-1");
      expect(outcome.record.subjectRef).toBe("order-100");
    }
  });

  it("the evidenceId and contentDigest are content-addressed and deterministic", () => {
    const input = offerSnapshotInput();
    const digest = computeMarketplaceEvidenceDigest(input);
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(marketplaceEvidenceId(input)).toBe(`mpe-${digest.slice(0, 12)}`);
    expect(computeMarketplaceEvidenceDigest(offerSnapshotInput())).toBe(digest);
  });

  it("the content digest sorts artifact digests (order-insensitive)", () => {
    const a1 = art(JSON.stringify({ part: 1 }), "artifact-a");
    const a2 = art(JSON.stringify({ part: 2 }), "artifact-b");
    const first = offerSnapshotInput({ artifacts: [a1, a2] });
    const second = offerSnapshotInput({ artifacts: [a2, a1] });
    expect(computeMarketplaceEvidenceDigest(first)).toBe(computeMarketplaceEvidenceDigest(second));
  });

  it("readEvidence round-trips the record for the owning tenant", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const recorded = await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    if (!recorded.ok) throw new Error("record failed");
    const read = await store.readEvidence(TENANT, recorded.record.evidenceId);
    expect(read).toEqual(recorded.record);
  });

  it("findByProviderEvent resolves the record for the owning tenant", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const recorded = await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    if (!recorded.ok) throw new Error("record failed");
    const found = await store.findByProviderEvent(TENANT, "prov-event-offer-1");
    expect(found?.evidenceId).toBe(recorded.record.evidenceId);
    expect(await store.findByProviderEvent(TENANT, "prov-event-never")).toBeNull();
  });

  it("listBySubject returns the tenant's records in recording order", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    await store.recordEvidence(TENANT, offerSnapshotInput({
      providerEventId: "prov-event-ack-1",
      kind: "marketplace.provider-ack",
      source: { system: "provider-portal-export", reference: "ack-export-7.pdf", retrievedVia: "export" },
    }), AT);
    const list = await store.listBySubject(TENANT, "order-100");
    expect(list.map((r) => r.providerEventId)).toEqual(["prov-event-offer-1", "prov-event-ack-1"]);
  });
});

describe("F361B marketplace evidence — duplicate-event refusal (the ORIGINAL, never a second conclusion)", () => {
  it("re-presenting the same provider event id returns the ORIGINAL record", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const first = await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    if (!first.ok || first.duplicate) throw new Error("first record failed");
    const second = await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.duplicate).toBe(true);
      expect(second.record).toEqual(first.record);
      expect(second.record.evidenceId).toBe(first.record.evidenceId);
      expect(second.record.recordedAt).toBe(first.record.recordedAt);
    }
    expect(store.size()).toBe(1);
  });

  it("a DIVERGENT re-presentation still returns the ORIGINAL (flagged, store unchanged)", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const first = await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    if (!first.ok) throw new Error("first record failed");
    const divergent = offerSnapshotInput({
      artifacts: [art(JSON.stringify({ offerId: "offer-1", total: 99_999 }), "a forged replacement payload")],
      capturedAt: "2026-10-14T09:59:00.000Z",
    });
    const second = await store.recordEvidence(TENANT, divergent, AT);
    expect(second.ok).toBe(true);
    if (second.ok && second.duplicate) {
      expect(second.divergent).toBe(true);
      expect(second.presentedContentDigest).not.toBe(first.record.contentDigest);
      expect(second.record.evidenceId).toBe(first.record.evidenceId);
      expect(second.record.contentDigest).toBe(first.record.contentDigest);
      expect(second.record.capturedAt).toBe(CAPTURED_AT);
    } else {
      throw new Error("expected duplicate outcome");
    }
    expect(store.size()).toBe(1);
  });

  it("the same provider event id in a DIFFERENT tenant is a separate record (no cross-tenant dedup leak)", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const mine = await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    const theirs = await store.recordEvidence(FOREIGN, offerSnapshotInput({ tenantId: FOREIGN.tenantId }), AT);
    expect(mine.ok).toBe(true);
    expect(theirs.ok).toBe(true);
    if (mine.ok && theirs.ok) {
      expect(theirs.duplicate).toBe(false);
      expect(theirs.record.evidenceId).not.toBe(mine.record.evidenceId);
      expect(theirs.record.tenantId).toBe("globex-rival");
    }
    expect(store.size()).toBe(2);
  });

  it("duplicate detection is per-provider-event-id, not per-subject", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    await store.recordEvidence(TENANT, offerSnapshotInput({ subjectRef: "order-100" }), AT);
    const otherSubject = await store.recordEvidence(TENANT, offerSnapshotInput({ subjectRef: "order-200" }), AT);
    expect(otherSubject.ok).toBe(true);
    if (otherSubject.ok) expect(otherSubject.duplicate).toBe(true); // same event id, different subject => still the ORIGINAL event
    expect(store.size()).toBe(1);
  });
});

describe("F361B marketplace evidence — tenant fail-closed laws", () => {
  it("REFUSAL: a foreign-tenant READ returns null (indistinguishable from absence)", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const recorded = await store.recordEvidence(TENANT, offerSnapshotInput(), AT);
    if (!recorded.ok) throw new Error("record failed");
    expect(await store.readEvidence(FOREIGN, recorded.record.evidenceId)).toBeNull();
    expect(await store.findByProviderEvent(FOREIGN, "prov-event-offer-1")).toBeNull();
    expect(await store.listBySubject(FOREIGN, "order-100")).toEqual([]);
  });

  it("REFUSAL: a foreign-tenant WRITE is refused and the store is unchanged", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const outcome = await store.recordEvidence(FOREIGN, offerSnapshotInput(), AT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("refused.tenant_mismatch");
    expect(store.size()).toBe(0);
  });
});

describe("F361B marketplace evidence — intake refusals (fail-closed)", () => {
  it("REFUSAL: missing provider event id", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const outcome = await store.recordEvidence(TENANT, offerSnapshotInput({ providerEventId: "" }), AT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("refused.missing_provider_event_id");
  });

  it("REFUSAL: missing source fields", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const outcome = await store.recordEvidence(TENANT, offerSnapshotInput({
      source: { system: "", reference: "catalogue-2026-10.ods", retrievedVia: "manual" },
    }), AT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("refused.missing_source");
  });

  it("REFUSAL: missing or malformed capturedAt", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const missing = await store.recordEvidence(TENANT, offerSnapshotInput({ capturedAt: "" }), AT);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("refused.missing_captured_at");
    const malformed = await store.recordEvidence(TENANT, offerSnapshotInput({ capturedAt: "not-a-date" }), AT);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.reason).toBe("refused.missing_captured_at");
  });

  it("REFUSAL: capturedAt in the future is untrusted (mission §6 external-events law)", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const outcome = await store.recordEvidence(TENANT, offerSnapshotInput({ capturedAt: "2026-10-14T10:00:01.000Z" }), AT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("refused.captured_at_in_future");
    expect(store.size()).toBe(0);
  });

  it("REFUSAL: an evidence record with no artifacts is refused", async () => {
    const store = new InMemoryMarketplaceEvidenceStore();
    const outcome = await store.recordEvidence(TENANT, offerSnapshotInput({ artifacts: [] }), AT);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("refused.no_artifacts");
  });
});

describe("F361B marketplace evidence — freshness classification", () => {
  async function recordedAt(capturedAt: string): Promise<MarketplaceEvidenceRecord> {
    const store = new InMemoryMarketplaceEvidenceStore();
    const outcome = await store.recordEvidence(TENANT, offerSnapshotInput({ capturedAt }), AT);
    if (!outcome.ok) throw new Error("record failed");
    return outcome.record;
  }

  it("a record captured within the window classifies fresh (caller-supplied now)", async () => {
    const record = await recordedAt("2026-10-14T09:00:00.000Z");
    const result = classifyMarketplaceEvidenceFreshness(record, Date.parse(AT), { freshWithinMs: 3_600_000 });
    expect(result.freshness).toBe("fresh");
    expect(result.ageMs).toBe(3_600_000);
  });

  it("an older record honestly classifies stale — never silently current (§3.2 law)", async () => {
    const record = await recordedAt("2026-10-01T09:00:00.000Z");
    const result = classifyMarketplaceEvidenceFreshness(record, Date.parse(AT), { freshWithinMs: 3_600_000 });
    expect(result.freshness).toBe("stale");
    expect(result.capturedAtMs).toBe(Date.parse("2026-10-01T09:00:00.000Z"));
  });

  it("the boundary is inclusive: exactly freshWithinMs is fresh", async () => {
    const record = await recordedAt("2026-10-14T09:00:00.000Z");
    expect(classifyMarketplaceEvidenceFreshness(record, Date.parse(AT) + 1, { freshWithinMs: 3_600_000 }).freshness).toBe("stale");
    expect(classifyMarketplaceEvidenceFreshness(record, Date.parse(AT), { freshWithinMs: 3_600_000 }).freshness).toBe("fresh");
  });

  it("deterministic: same record + same now => same classification", async () => {
    const record = await recordedAt(CAPTURED_AT);
    const a = classifyMarketplaceEvidenceFreshness(record, Date.parse(AT), { freshWithinMs: 60_000 });
    const b = classifyMarketplaceEvidenceFreshness(record, Date.parse(AT), { freshWithinMs: 60_000 });
    expect(a).toEqual(b);
  });
});

describe("F361B marketplace evidence — digest composition over the existing APIs", () => {
  it("the content digest is a real sha-256 over the canonical material", () => {
    const input = offerSnapshotInput();
    const expectedParts = [
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
    expect(computeMarketplaceEvidenceDigest(input)).toBe(sha256Hex(utf8Bytes(expectedParts.join("|"))));
  });
});
