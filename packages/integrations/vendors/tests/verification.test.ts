/**
 * @fleetos/external-vendors — Wave 5 verification tests.
 *
 * Themes: claimed → verified lifecycle with evidence gating (required,
 * same-tenant); expiry classification by logical time + enforcement;
 * revocation (reason required, claim forced to expired, inert notice);
 * tenant fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  classifyVerificationExpiry,
  expireDueVerifications,
  findVerification,
  openVendorCatalog,
  openVerificationRegistry,
  revokeVerification,
  verifyCapability,
  importCatalogBatch,
  type ExternalCatalogEntry,
  type TenantScope,
  type VendorCatalog,
  type VerificationRegistry,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const SOURCE = "vendor-hub";

function entry(externalId: string, logicalTime = 10, capabilities = ["cold-chain"]): ExternalCatalogEntry {
  return { externalId, vendorExternalId: `vendor-${externalId}`, displayName: `Vendor ${externalId}`, capabilities, logicalTime };
}

function setup(entryId = "v-1"): { catalog: VendorCatalog; registry: VerificationRegistry } {
  const opened = openVendorCatalog(TENANT, SOURCE);
  const registry = openVerificationRegistry(TENANT);
  if (!opened.ok || !registry.ok) throw new Error("setup failed");
  const imported = importCatalogBatch(opened.catalog, [entry(entryId)], 100);
  if (!imported.ok) throw new Error("import failed");
  return { catalog: imported.catalog, registry: registry.registry };
}

function verify(catalog: VendorCatalog, registry: VerificationRegistry, verifiedAt = 200, expiresAt = 1000, capability = "cold-chain") {
  return verifyCapability(catalog, registry, {
    tenant: TENANT,
    externalId: "v-1",
    capability,
    evidence: { evidenceId: "ev-1", tenantId: "acme" },
    verifiedAt,
    expiresAt,
  });
}

describe("verification — claimed → verified (evidence-referenced)", () => {
  it("moves the claim to verified, records the evidence and updates the catalog digest", () => {
    const { catalog, registry } = setup();
    const result = verify(catalog, registry);
    expect(result).toMatchObject({ ok: true, record: { state: "verified", evidence: { evidenceId: "ev-1" } } });
    if (!result.ok) return;
    expect(result.catalog.entries.get("v-1")?.capabilityClaims[0]?.state).toBe("verified");
    expect(result.catalog.catalogDigest).not.toBe(catalog.catalogDigest);
  });

  it("refuses verification without evidence (VERIFICATION_EVIDENCE_REQUIRED)", () => {
    const { catalog, registry } = setup();
    const result = verifyCapability(catalog, registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", evidence: null, verifiedAt: 200, expiresAt: 1000 });
    expect(result).toMatchObject({ ok: false, reasonCode: "VERIFICATION_EVIDENCE_REQUIRED" });
  });

  it("refuses cross-tenant evidence (EVIDENCE_TENANT_MISMATCH)", () => {
    const { catalog, registry } = setup();
    const result = verifyCapability(catalog, registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", evidence: { evidenceId: "ev-1", tenantId: "other" }, verifiedAt: 200, expiresAt: 1000 });
    expect(result).toMatchObject({ ok: false, reasonCode: "EVIDENCE_TENANT_MISMATCH" });
  });

  it("refuses unknown entries and unclaimed capabilities with typed codes", () => {
    const { catalog, registry } = setup();
    expect(verify(catalog, registry, 200, 1000, "not-claimed")).toMatchObject({ ok: false, reasonCode: "CAPABILITY_NOT_CLAIMED" });
    const unknown = verifyCapability(catalog, registry, { tenant: TENANT, externalId: "ghost", capability: "cold-chain", evidence: { evidenceId: "e", tenantId: "acme" }, verifiedAt: 1, expiresAt: 2 });
    expect(unknown).toMatchObject({ ok: false, reasonCode: "CATALOG_ENTRY_UNKNOWN" });
  });

  it("refuses double verification (ALREADY_VERIFIED) and expiry not after verification", () => {
    const { catalog, registry } = setup();
    const first = verify(catalog, registry);
    if (!first.ok) return;
    expect(verify(first.catalog, first.registry)).toMatchObject({ ok: false, reasonCode: "ALREADY_VERIFIED" });
    expect(verify(catalog, registry, 200, 200)).toMatchObject({ ok: false, reasonCode: "EXPIRY_NOT_AFTER_VERIFICATION" });
  });
});

describe("verification — expiry by logical time", () => {
  it("classifies records as active/expired WITHOUT mutating anything (pure read)", () => {
    const { catalog, registry } = setup();
    const verified = verify(catalog, registry, 200, 1000);
    if (!verified.ok) return;
    expect(classifyVerificationExpiry(verified.registry, 999)).toEqual([{ externalId: "v-1", capability: "cold-chain", classification: "active" }]);
    expect(classifyVerificationExpiry(verified.registry, 1000)).toEqual([{ externalId: "v-1", capability: "cold-chain", classification: "expired" }]);
  });

  it("expireDueVerifications flips due records and claims to expired, keeping digests honest", () => {
    const { catalog, registry } = setup();
    const verified = verify(catalog, registry, 200, 1000);
    if (!verified.ok) return;
    const expired = expireDueVerifications(verified.catalog, verified.registry, 1500);
    expect(expired).toMatchObject({ ok: true, expired: ["v-1::cold-chain"] });
    if (!expired.ok) return;
    expect(expired.registry.records.get("v-1::cold-chain")?.state).toBe("expired");
    expect(expired.catalog.entries.get("v-1")?.capabilityClaims[0]?.state).toBe("expired");
    const again = expireDueVerifications(expired.catalog, expired.registry, 1600);
    expect(again).toMatchObject({ ok: true, expired: [] });
  });

  it("expired claims cannot be re-verified without a fresh import (CLAIM_EXPIRED)", () => {
    const { catalog, registry } = setup();
    const verified = verify(catalog, registry, 200, 1000);
    if (!verified.ok) return;
    const expired = expireDueVerifications(verified.catalog, verified.registry, 1500);
    if (!expired.ok) return;
    expect(verify(expired.catalog, expired.registry, 1600, 2000)).toMatchObject({ ok: false, reasonCode: "CLAIM_EXPIRED" });
  });
});

describe("verification — revocation", () => {
  it("revokes a verified record with a required reason, forces the claim to expired, and returns an inert notice", () => {
    const { catalog, registry } = setup();
    const verified = verify(catalog, registry);
    if (!verified.ok) return;
    const revoked = revokeVerification(verified.catalog, verified.registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", reason: "audit-finding" }, 500);
    expect(revoked).toMatchObject({ ok: true, notice: { kind: "revocation-notice", reason: "audit-finding", revokedAt: 500 } });
    if (!revoked.ok) return;
    expect(revoked.registry.records.get("v-1::cold-chain")?.state).toBe("revoked");
    expect(revoked.catalog.entries.get("v-1")?.capabilityClaims[0]?.state).toBe("expired");
    for (const value of Object.values(revoked.notice)) {
      expect(typeof value).not.toBe("function");
    }
  });

  it("refuses revocation without a reason and refuses double revocation", () => {
    const { catalog, registry } = setup();
    const verified = verify(catalog, registry);
    if (!verified.ok) return;
    expect(revokeVerification(verified.catalog, verified.registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", reason: " " }, 500)).toMatchObject({ ok: false, reasonCode: "REVOCATION_REASON_REQUIRED" });
    const revoked = revokeVerification(verified.catalog, verified.registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", reason: "audit" }, 500);
    if (!revoked.ok) return;
    expect(revokeVerification(revoked.catalog, revoked.registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", reason: "again" }, 600)).toMatchObject({ ok: false, reasonCode: "VERIFICATION_RECORD_REVOKED" });
  });

  it("refuses revoking an unknown pair (VERIFICATION_RECORD_UNKNOWN)", () => {
    const { catalog, registry } = setup();
    expect(revokeVerification(catalog, registry, { tenant: TENANT, externalId: "v-1", capability: "cold-chain", reason: "audit" }, 500)).toMatchObject({ ok: false, reasonCode: "VERIFICATION_RECORD_UNKNOWN" });
  });
});

describe("verification — tenant fail-closed", () => {
  it("refuses cross-tenant verification inputs (TENANT_MISMATCH)", () => {
    const { catalog, registry } = setup();
    const result = verifyCapability(catalog, registry, { tenant: { tenantId: "other" }, externalId: "v-1", capability: "cold-chain", evidence: { evidenceId: "e", tenantId: "other" }, verifiedAt: 1, expiresAt: 2 });
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("findVerification returns null for foreign tenants (no existence leak)", () => {
    const { catalog, registry } = setup();
    const verified = verify(catalog, registry);
    if (!verified.ok) return;
    expect(findVerification(verified.registry, TENANT, "v-1", "cold-chain")).not.toBeNull();
    expect(findVerification(verified.registry, { tenantId: "other" }, "v-1", "cold-chain")).toBeNull();
  });

  it("refuses a cross-tenant revocation (TENANT_MISMATCH)", () => {
    const { catalog, registry } = setup();
    const verified = verify(catalog, registry);
    if (!verified.ok) return;
    const result = revokeVerification(verified.catalog, verified.registry, { tenant: { tenantId: "other" }, externalId: "v-1", capability: "cold-chain", reason: "audit" }, 500);
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});
