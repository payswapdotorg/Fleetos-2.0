/**
 * @fleetos/apify — Wave 5 evidence-gated result-ingestion tests.
 *
 * Themes: results enter QUARANTINE (evidence gate — no attachment → never
 * usable); sha-256-shaped structural digest validation; nothing is
 * laundered (malformed payloads stay quarantined); deterministic
 * classification + digests; tenant fail-closed reads.
 */
import { describe, expect, it } from "vitest";
import {
  attachEvidenceBundle,
  computeResultDigest,
  ingestJobResult,
  isSha256Shaped,
  partitionByState,
  readResultForTenant,
  verifyResultDigest,
  type EvidenceBundleRef,
  type IngestedJobResult,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function bundle(tenantId = "acme", digest = "a".repeat(64)): EvidenceBundleRef {
  return { bundleId: "ev-1", tenantId, digest };
}

function ingested(payload: unknown = { rows: 3 }): IngestedJobResult {
  const result = ingestJobResult({ tenant: TENANT, resultId: "r-1", jobId: "job-1", payload, now: 100 });
  if (!result.ok) throw new Error("ingest failed");
  return result.result;
}

describe("result-ingestion — the evidence gate", () => {
  it("every ingested result enters quarantine with EVIDENCE_NOT_ATTACHED", () => {
    const result = ingested();
    expect(result.state).toBe("quarantined");
    expect(result.quarantineReasonCode).toBe("EVIDENCE_NOT_ATTACHED");
    expect(result.evidence).toBeNull();
  });

  it("a quarantined result becomes usable ONLY after an evidence bundle is attached", () => {
    const attached = attachEvidenceBundle(ingested(), bundle(), 101);
    expect(attached).toMatchObject({ ok: true, result: { state: "usable", quarantineReasonCode: null, evidenceAttachedAt: 101 } });
  });

  it("refuses attaching twice (EVIDENCE_ALREADY_ATTACHED)", () => {
    const attached = attachEvidenceBundle(ingested(), bundle(), 101);
    if (!attached.ok) return;
    expect(attachEvidenceBundle(attached.result, bundle(), 102)).toMatchObject({ ok: false, reasonCode: "EVIDENCE_ALREADY_ATTACHED" });
  });

  it("partitionByState separates usable from still-quarantined results", () => {
    const a = ingested();
    const b = ingested({ rows: 1 });
    const attached = attachEvidenceBundle(b, bundle(), 101);
    if (!attached.ok) return;
    const partition = partitionByState([a, attached.result]);
    expect(partition.usable).toHaveLength(1);
    expect(partition.quarantined).toHaveLength(1);
    expect(partition.quarantined[0]?.quarantineReasonCode).toBe("EVIDENCE_NOT_ATTACHED");
  });
});

describe("result-ingestion — sha-256-shaped structural validation", () => {
  it("isSha256Shaped accepts 64 lowercase hex and rejects everything else", () => {
    expect(isSha256Shaped("a".repeat(64))).toBe(true);
    expect(isSha256Shaped("0123456789abcdef".repeat(4))).toBe(true);
    expect(isSha256Shaped("A".repeat(64))).toBe(false);
    expect(isSha256Shaped("a".repeat(63))).toBe(false);
    expect(isSha256Shaped("a".repeat(65))).toBe(false);
    expect(isSha256Shaped("")).toBe(false);
  });

  it("refuses evidence whose digest is not sha-256-shaped (EVIDENCE_DIGEST_MALFORMED)", () => {
    const bad = attachEvidenceBundle(ingested(), bundle("acme", "not-a-sha"), 101);
    expect(bad).toMatchObject({ ok: false, reasonCode: "EVIDENCE_DIGEST_MALFORMED" });
  });

  it("refuses evidence with an empty bundle id (EVIDENCE_BUNDLE_ID_EMPTY)", () => {
    const empty: EvidenceBundleRef = { bundleId: " ", tenantId: "acme", digest: "b".repeat(64) };
    expect(attachEvidenceBundle(ingested(), empty, 101)).toMatchObject({ ok: false, reasonCode: "EVIDENCE_BUNDLE_ID_EMPTY" });
  });

  it("refuses cross-tenant evidence (EVIDENCE_TENANT_MISMATCH) and changes nothing", () => {
    const quarantined = ingested();
    const refused = attachEvidenceBundle(quarantined, bundle("other"), 101);
    expect(refused).toMatchObject({ ok: false, reasonCode: "EVIDENCE_TENANT_MISMATCH" });
    expect(quarantined.state).toBe("quarantined");
  });
});

describe("result-ingestion — deterministic classification, honest quarantine", () => {
  it("classifies structured vs empty payloads deterministically", () => {
    expect(ingested({ rows: 3 }).payloadClassification).toBe("structured");
    expect(ingested({}).payloadClassification).toBe("empty");
  });

  it("quarantines malformed payloads with PAYLOAD_MALFORMED and keeps the raw input verbatim (never dropped)", () => {
    const malformed = ingested([1, 2, 3]);
    expect(malformed.state).toBe("quarantined");
    expect(malformed.quarantineReasonCode).toBe("PAYLOAD_MALFORMED");
    expect(malformed.payload).toBeNull();
    expect(malformed.rawPayload).toEqual([1, 2, 3]);
    expect(malformed.payloadClassification).toBe("malformed");
  });

  it("evidence cannot launder a malformed payload (RESULT_NOT_QUARANTINED)", () => {
    const refused = attachEvidenceBundle(ingested("not-an-object"), bundle(), 101);
    expect(refused).toMatchObject({ ok: false, reasonCode: "RESULT_NOT_QUARANTINED" });
  });

  it("refuses structurally invalid ingest inputs with typed codes", () => {
    expect(ingestJobResult({ tenant: { tenantId: "" } as unknown as TenantScope, resultId: "r", jobId: "j", payload: {}, now: 1 })).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
    expect(ingestJobResult({ tenant: TENANT, resultId: " ", jobId: "j", payload: {}, now: 1 })).toMatchObject({ ok: false, reasonCode: "RESULT_ID_EMPTY" });
    expect(ingestJobResult({ tenant: TENANT, resultId: "r", jobId: "", payload: {}, now: 1 })).toMatchObject({ ok: false, reasonCode: "JOB_ID_EMPTY" });
    expect(ingestJobResult({ tenant: TENANT, resultId: "r", jobId: "j", payload: {}, now: -1 })).toMatchObject({ ok: false, reasonCode: "LOGICAL_TIME_INVALID" });
  });

  it("attachment requires now ≥ ingestedAt (LOGICAL_TIME_INVALID)", () => {
    expect(attachEvidenceBundle(ingested(), bundle(), 99)).toMatchObject({ ok: false, reasonCode: "LOGICAL_TIME_INVALID" });
  });
});

describe("result-ingestion — digests", () => {
  it("result digest verifies and CHANGES when evidence is attached (provenance)", () => {
    const quarantined = ingested();
    expect(verifyResultDigest(quarantined)).toBe(true);
    const attached = attachEvidenceBundle(quarantined, bundle(), 101);
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    expect(verifyResultDigest(attached.result)).toBe(true);
    expect(attached.result.resultDigest).not.toBe(quarantined.resultDigest);
  });

  it("identical inputs produce identical digests (determinism)", () => {
    const a = ingested();
    const b = ingested();
    expect(computeResultDigest(a)).toBe(computeResultDigest(b));
  });

  it("payload key order does not change the digest", () => {
    const a = ingested({ x: 1, y: 2 });
    const b = ingested({ y: 2, x: 1 });
    expect(computeResultDigest(a)).toBe(computeResultDigest(b));
  });
});

describe("result-ingestion — tenant fail-closed reads", () => {
  it("returns the result for the owning tenant and null for foreign tenants (no existence leak)", () => {
    const result = ingested();
    expect(readResultForTenant([result], TENANT, "r-1")).toBe(result);
    expect(readResultForTenant([result], { tenantId: "other" }, "r-1")).toBeNull();
    expect(readResultForTenant([result], TENANT, "unknown")).toBeNull();
    expect(readResultForTenant([result], { tenantId: "" } as unknown as TenantScope, "r-1")).toBeNull();
  });
});
