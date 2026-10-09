/**
 * @fleetos/vendors — Wave 8 (F280C) marketplace hardening tests:
 * publication requires verified capabilities (per-claim reason codes),
 * revocation cascade delists exactly the intersecting set, search is
 * deterministic, delisted listings never match, tenant fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  publishListing,
  applyRevocationCascade,
  searchListings,
  type MarketplaceListingDraft,
  type MarketplaceListing,
  type VendorCapabilityRecord,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

function capability(
  overrides: Partial<VendorCapabilityRecord> = {},
): VendorCapabilityRecord {
  return {
    vendorId: "v-alpha",
    tenant: TENANT,
    tag: "diagnostics",
    status: "verified",
    verifiedAt: 100,
    evidence: { evidenceId: "ev-1", tenantId: "acme" },
    ...overrides,
  };
}

function draft(overrides: Partial<MarketplaceListingDraft> = {}): MarketplaceListingDraft {
  return {
    listingId: "l-1",
    tenant: TENANT,
    vendorId: "v-alpha",
    claimedCapabilities: ["diagnostics", "cold-chain"],
    exclusions: ["no-weekend-delivery"],
    ...overrides,
  };
}

function listing(
  overrides: Partial<MarketplaceListing> = {},
): MarketplaceListing {
  return {
    listingId: "l-1",
    tenant: TENANT,
    vendorId: "v-alpha",
    claimedCapabilities: ["diagnostics"],
    exclusions: [],
    status: "published",
    delistReason: null,
    publishedAt: 100,
    ...overrides,
  };
}

describe("publishListing — verified capabilities gate", () => {
  it("publishes when every claimed capability is verified, exclusions verbatim", () => {
    const result = publishListing(
      draft(),
      [
        capability({ tag: "diagnostics" }),
        capability({ tag: "cold-chain" }),
      ],
      500,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listing).toEqual({
      listingId: "l-1",
      tenant: TENANT,
      vendorId: "v-alpha",
      claimedCapabilities: ["diagnostics", "cold-chain"],
      exclusions: ["no-weekend-delivery"],
      status: "published",
      delistReason: null,
      publishedAt: 500,
    });
    expect(result.claimReport).toEqual([
      { tag: "diagnostics", recordStatus: "verified", reasonCode: null },
      { tag: "cold-chain", recordStatus: "verified", reasonCode: null },
    ]);
  });

  it("refuses publication when a claimed capability is only DECLARED, with reason codes", () => {
    const result = publishListing(
      draft(),
      [
        capability({ tag: "diagnostics" }),
        capability({ tag: "cold-chain", status: "declared", verifiedAt: null, evidence: null }),
      ],
      500,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe("CAPABILITY_UNVERIFIED");
    expect(result.claimReport).toEqual([
      { tag: "diagnostics", recordStatus: "verified", reasonCode: null },
      { tag: "cold-chain", recordStatus: "declared", reasonCode: "CAPABILITY_UNVERIFIED" },
    ]);
  });

  it("refuses publication when a claimed capability was never claimed at all (unknown)", () => {
    const result = publishListing(
      draft({ claimedCapabilities: ["ghost-tag"] }),
      [capability({ tag: "diagnostics" })],
      500,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasonCode).toBe("CAPABILITY_UNVERIFIED");
    expect(result.claimReport).toEqual([
      { tag: "ghost-tag", recordStatus: "unknown", reasonCode: "CAPABILITY_UNKNOWN" },
    ]);
  });

  it("refuses empty listing ids, empty vendors and zero claims", () => {
    expect(publishListing(draft({ listingId: "" }), [], 1)).toMatchObject({
      ok: false,
      reasonCode: "LISTING_ID_EMPTY",
    });
    expect(publishListing(draft({ vendorId: "" }), [], 1)).toMatchObject({
      ok: false,
      reasonCode: "VENDOR_ID_EMPTY",
    });
    expect(publishListing(draft({ claimedCapabilities: [] }), [], 1)).toMatchObject({
      ok: false,
      reasonCode: "NO_CLAIMED_CAPABILITIES",
    });
  });

  it("TENANT fail-closed: a capability record from another tenant refuses publication", () => {
    const result = publishListing(
      draft(),
      [capability({ tag: "diagnostics", tenant: OTHER_TENANT })],
      500,
    );
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("TENANT fail-closed: an invalid tenant scope refuses publication", () => {
    const result = publishListing(
      draft({ tenant: { tenantId: "" } }),
      [],
      500,
    );
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

describe("applyRevocationCascade — machine-checked delisting semantics", () => {
  const l1 = listing({ listingId: "l-1", claimedCapabilities: ["diagnostics"] });
  const l2 = listing({ listingId: "l-2", claimedCapabilities: ["diagnostics", "cold-chain"] });
  const l3 = listing({ listingId: "l-3", claimedCapabilities: ["paint"] });
  const l4 = listing({
    listingId: "l-4",
    claimedCapabilities: ["paint"],
    status: "delisted",
    delistReason: "CAPABILITY_REVOKED:paint",
  });

  it("delists EXACTLY the listings whose claims intersect the revoked set", () => {
    const result = applyRevocationCascade(
      { tenant: TENANT, vendorId: "v-alpha", revokedTags: ["diagnostics"] },
      [l1, l2, l3, l4],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delistedListingIds).toEqual(["l-1", "l-2"]);
    expect(result.keptListingIds).toEqual(["l-3"]);
    const statuses = result.listings.map((l) => [l.listingId, l.status]);
    expect(statuses).toEqual([
      ["l-1", "delisted"],
      ["l-2", "delisted"],
      ["l-3", "published"],
      ["l-4", "delisted"],
    ]);
  });

  it("the delist reason records the revoked tags sorted; already-delisted keep their reason", () => {
    const result = applyRevocationCascade(
      { tenant: TENANT, vendorId: "v-alpha", revokedTags: ["cold-chain", "diagnostics"] },
      [l2, l4],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.listings[0]?.delistReason).toBe("CAPABILITY_REVOKED:cold-chain,diagnostics");
    expect(result.listings[1]?.delistReason).toBe("CAPABILITY_REVOKED:paint");
  });

  it("revoking a tag no listing claims delists nothing (set equality both directions)", () => {
    const result = applyRevocationCascade(
      { tenant: TENANT, vendorId: "v-alpha", revokedTags: ["welding"] },
      [l1, l2, l3],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delistedListingIds).toEqual([]);
    expect(result.keptListingIds).toEqual(["l-1", "l-2", "l-3"]);
  });

  it("refuses empty revocations and foreign-vendor listings", () => {
    expect(
      applyRevocationCascade(
        { tenant: TENANT, vendorId: "v-alpha", revokedTags: [] },
        [l1],
      ),
    ).toMatchObject({ ok: false, reasonCode: "NO_REVOKED_TAGS" });
    expect(
      applyRevocationCascade(
        { tenant: TENANT, vendorId: "v-alpha", revokedTags: ["diagnostics"] },
        [listing({ vendorId: "v-beta" })],
      ),
    ).toMatchObject({ ok: false, reasonCode: "VENDOR_MISMATCH" });
  });

  it("TENANT fail-closed: a foreign-tenant listing refuses the cascade", () => {
    expect(
      applyRevocationCascade(
        { tenant: TENANT, vendorId: "v-alpha", revokedTags: ["diagnostics"] },
        [listing({ tenant: OTHER_TENANT })],
      ),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});

describe("searchListings — deterministic search over published listings", () => {
  const a = listing({ listingId: "l-b", vendorId: "v-beta", claimedCapabilities: ["diagnostics"] });
  const b = listing({ listingId: "l-a", vendorId: "v-alpha", claimedCapabilities: ["diagnostics", "cold-chain"] });
  const c = listing({ listingId: "l-c", vendorId: "v-alpha", claimedCapabilities: ["paint"] });
  const delisted = listing({
    listingId: "l-x",
    vendorId: "v-gamma",
    claimedCapabilities: ["diagnostics"],
    status: "delisted",
    delistReason: "CAPABILITY_REVOKED:diagnostics",
  });

  it("orders results by (vendorId, listingId) regardless of input order", () => {
    const forward = searchListings(TENANT, [a, b, c, delisted], { capabilityTag: null, vendorId: null });
    const permuted = searchListings(TENANT, [c, delisted, b, a], { capabilityTag: null, vendorId: null });
    expect(forward.ok && permuted.ok).toBe(true);
    if (!forward.ok || !permuted.ok) return;
    expect(forward.results.map((l) => l.listingId)).toEqual(["l-a", "l-c", "l-b"]);
    expect(permuted.results).toEqual(forward.results);
    expect(forward.ordering).toBe("vendor-id-lexical-then-listing-id-lexical");
  });

  it("filters by capability tag and vendor; delisted listings NEVER match", () => {
    const byTag = searchListings(TENANT, [a, b, c, delisted], { capabilityTag: "diagnostics", vendorId: null });
    expect(byTag.ok && byTag.results.map((l) => l.listingId)).toEqual(["l-a", "l-b"]);
    const byVendor = searchListings(TENANT, [a, b, c], { capabilityTag: null, vendorId: "v-alpha" });
    expect(byVendor.ok && byVendor.results.map((l) => l.listingId)).toEqual(["l-a", "l-c"]);
    const combined = searchListings(TENANT, [a, b, c], { capabilityTag: "paint", vendorId: "v-beta" });
    expect(combined.ok && combined.results).toEqual([]);
  });

  it("TENANT fail-closed: a foreign-tenant listing in the input refuses the search", () => {
    expect(
      searchListings(TENANT, [a, listing({ tenant: OTHER_TENANT })], {
        capabilityTag: null,
        vendorId: null,
      }),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("TENANT fail-closed: an invalid caller tenant scope refuses the search", () => {
    expect(
      searchListings({ tenantId: "" }, [a], { capabilityTag: null, vendorId: null }),
    ).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});
