/**
 * @fleetos/external-vendors — Wave 5 catalog-sync tests.
 *
 * Themes: batch import dedupe by external id (identical → deduped,
 * conflicting → atomic refusal); LWW re-import rule; capability claims
 * enter as `claimed`; deterministic catalog digests + tamper detection;
 * tenant fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  computeCatalogDigest,
  findEntry,
  importCatalogBatch,
  openVendorCatalog,
  verifyCatalogDigest,
  type ExternalCatalogEntry,
  type TenantScope,
  type VendorCatalog,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const SOURCE = "vendor-hub";

function entry(externalId: string, logicalTime = 10, capabilities = ["cold-chain"]): ExternalCatalogEntry {
  return { externalId, vendorExternalId: `vendor-${externalId}`, displayName: `Vendor ${externalId}`, capabilities, logicalTime };
}

function catalog(): VendorCatalog {
  const opened = openVendorCatalog(TENANT, SOURCE);
  if (!opened.ok) throw new Error("open failed");
  return opened.catalog;
}

describe("catalog-sync — batch import + dedupe by external id", () => {
  it("imports entries and registers every capability as a CLAIM (claimed state)", () => {
    const result = importCatalogBatch(catalog(), [entry("v-1"), entry("v-2", 12, ["cold-chain", "hazmat"])], 100);
    expect(result).toMatchObject({ ok: true, imported: ["v-1", "v-2"] });
    if (!result.ok) return;
    expect(result.catalog.entries.get("v-2")?.capabilityClaims).toEqual([
      { capability: "cold-chain", state: "claimed" },
      { capability: "hazmat", state: "claimed" },
    ]);
  });

  it("dedupes identical duplicates within a batch (skipped, counted)", () => {
    const result = importCatalogBatch(catalog(), [entry("v-1"), entry("v-1")], 100);
    expect(result).toMatchObject({ ok: true, imported: ["v-1"], duplicatesSkipped: ["v-1"] });
  });

  it("refuses conflicting duplicates within a batch atomically (DUPLICATE_EXTERNAL_ID_CONFLICT)", () => {
    const result = importCatalogBatch(catalog(), [entry("v-1", 10), entry("v-1", 11)], 100);
    expect(result).toMatchObject({ ok: false, reasonCode: "DUPLICATE_EXTERNAL_ID_CONFLICT" });
  });

  it("refuses malformed entries with typed codes (nothing imported)", () => {
    expect(importCatalogBatch(catalog(), [], 100)).toMatchObject({ ok: false, reasonCode: "EMPTY_BATCH" });
    expect(importCatalogBatch(catalog(), [{ ...entry("v-1"), externalId: " " }], 100)).toMatchObject({ ok: false, reasonCode: "MALFORMED_CATALOG_ENTRY" });
    expect(importCatalogBatch(catalog(), [{ ...entry("v-1"), logicalTime: -1 }], 100)).toMatchObject({ ok: false, reasonCode: "MALFORMED_CATALOG_ENTRY" });
    expect(importCatalogBatch(catalog(), [{ ...entry("v-1"), capabilities: ["a", "a"] }], 100)).toMatchObject({ ok: false, reasonCode: "MALFORMED_CATALOG_ENTRY" });
  });
});

describe("catalog-sync — re-import LWW rule (documented)", () => {
  it("a NEWER logical time replaces the entry and RESETS claims to claimed", () => {
    const first = importCatalogBatch(catalog(), [entry("v-1", 10)], 100);
    if (!first.ok) return;
    const second = importCatalogBatch(first.catalog, [entry("v-1", 20)], 101);
    expect(second).toMatchObject({ ok: true, imported: ["v-1"] });
    if (!second.ok) return;
    expect(second.catalog.entries.get("v-1")?.logicalTime).toBe(20);
    expect(second.catalog.entries.get("v-1")?.capabilityClaims.every((c) => c.state === "claimed")).toBe(true);
  });

  it("an OLDER logical time is skipped as stale (recorded, not silent)", () => {
    const first = importCatalogBatch(catalog(), [entry("v-1", 20)], 100);
    if (!first.ok) return;
    const second = importCatalogBatch(first.catalog, [entry("v-1", 10)], 101);
    expect(second).toMatchObject({ ok: true, staleSkipped: ["v-1"] });
  });

  it("equal logical time + identical content is an idempotent skip", () => {
    const first = importCatalogBatch(catalog(), [entry("v-1", 10)], 100);
    if (!first.ok) return;
    const second = importCatalogBatch(first.catalog, [entry("v-1", 10)], 101);
    expect(second).toMatchObject({ ok: true, duplicatesSkipped: ["v-1"] });
  });

  it("equal logical time + DIFFERENT content refuses the batch atomically (ENTRY_LOGICAL_TIME_CONFLICT)", () => {
    const first = importCatalogBatch(catalog(), [entry("v-1", 10, ["cold-chain"])], 100);
    if (!first.ok) return;
    const conflict = importCatalogBatch(first.catalog, [entry("v-1", 10, ["hazmat"])], 101);
    expect(conflict).toMatchObject({ ok: false, reasonCode: "ENTRY_LOGICAL_TIME_CONFLICT" });
    // The original catalog is untouched (atomicity).
    expect(first.catalog.entries.get("v-1")?.capabilityClaims[0]?.capability).toBe("cold-chain");
  });
});

describe("catalog-sync — digests", () => {
  it("the catalog digest is deterministic and input-order independent", () => {
    const a = importCatalogBatch(catalog(), [entry("v-1"), entry("v-2", 12)], 100);
    const b = importCatalogBatch(catalog(), [entry("v-2", 12), entry("v-1")], 100);
    if (!a.ok || !b.ok) return;
    expect(a.catalog.catalogDigest).toBe(b.catalog.catalogDigest);
    expect(computeCatalogDigest(a.catalog)).toBe(a.catalog.catalogDigest);
  });

  it("verifyCatalogDigest passes on honest catalogs and detects tampering", () => {
    const result = importCatalogBatch(catalog(), [entry("v-1")], 100);
    if (!result.ok) return;
    expect(verifyCatalogDigest(result.catalog).ok).toBe(true);
    const entries = new Map(result.catalog.entries);
    const original = entries.get("v-1");
    if (original === undefined) return;
    entries.set("v-1", { ...original, displayName: "Tampered" });
    expect(verifyCatalogDigest({ ...result.catalog, entries }).ok).toBe(false);
  });
});

describe("catalog-sync — tenant fail-closed", () => {
  it("refuses an invalid tenant at open (TENANT_SCOPE_MISSING)", () => {
    expect(openVendorCatalog({ tenantId: "" } as unknown as TenantScope, SOURCE)).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("findEntry returns null for foreign tenants (no existence leak)", () => {
    const result = importCatalogBatch(catalog(), [entry("v-1")], 100);
    if (!result.ok) return;
    expect(findEntry(result.catalog, TENANT, "v-1")).not.toBeNull();
    expect(findEntry(result.catalog, { tenantId: "other" }, "v-1")).toBeNull();
    expect(findEntry(result.catalog, TENANT, "nope")).toBeNull();
  });
});
