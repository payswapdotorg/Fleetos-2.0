/**
 * @fleetos/vendors — Vendor marketplace hardening: listing publication
 * requires VERIFIED capabilities (claimed-but-unverified refuses with
 * per-claim reason codes), revocation cascades to delisting
 * (machine-checked), and listing search is deterministic with a recorded
 * ordering law.
 *
 * Wave 8 lane C (F280C) production-economics grade.
 *
 * Laws: A3 (a declaration is not a verification), A4 (refuse, never
 * silently publish/delist partially), A8 (tenant-scoped, fail-closed),
 * A20.
 *
 * Semantics (documented laws):
 *   - PUBLICATION: a listing is publishable ONLY when every claimed
 *     capability tag is a record of THIS vendor in THIS tenant with
 *     status "verified". Any unverified or unknown claim refuses the
 *     ENTIRE publication with a per-claim report — never a partial
 *     publish.
 *   - HONEST EXCLUSIONS: the exclusions array is carried verbatim onto
 *     the published listing — what the vendor declared is what buyers
 *     see.
 *   - DELISTING CASCADE: revoking a capability tag delists EXACTLY the
 *     published listings whose claimedCapabilities intersect the revoked
 *     set (set equality, machine-checked in tests); untouched listings
 *     are returned unchanged; already-delisted listings are left as-is.
 *   - SEARCH DETERMINISM: results are ordered by (vendorId lexical,
 *     listingId lexical) — the documented total order; permuted input
 *     produces byte-identical output. Delisted listings NEVER match.
 *   - TENANT FAIL-CLOSED (F280C hardening): a foreign-tenant listing or
 *     capability record present in the input REFUSES the operation —
 *     cross-tenant records are never silently filtered out.
 *
 * Pure deterministic TS. Time is an explicit `number` input.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { VendorCapabilityRecord } from "./capability-catalog.js";

// ---------------------------------------------------------------------------
// Listing contracts.
// ---------------------------------------------------------------------------

export type MarketplaceListingStatus = "published" | "delisted";

export interface MarketplaceListingDraft {
  readonly listingId: string;
  readonly tenant: TenantScope;
  readonly vendorId: string;
  /** Capability tags the listing CLAIMS. All must be verified to publish. */
  readonly claimedCapabilities: readonly string[];
  /** Honest exclusions — carried verbatim onto the published listing. */
  readonly exclusions: readonly string[];
}

export interface MarketplaceListing {
  readonly listingId: string;
  readonly tenant: TenantScope;
  readonly vendorId: string;
  readonly claimedCapabilities: readonly string[];
  readonly exclusions: readonly string[];
  readonly status: MarketplaceListingStatus;
  readonly delistReason: string | null;
  readonly publishedAt: number;
}

/** Per-claim publication report — one entry per claimed tag. */
export interface PublicationClaimReport {
  readonly tag: string;
  readonly recordStatus: "verified" | "declared" | "unknown";
  readonly reasonCode: PublicationClaimReasonCode | null;
}

export type PublicationClaimReasonCode = "CAPABILITY_UNVERIFIED" | "CAPABILITY_UNKNOWN";

export type ListingPublicationResult =
  | {
      readonly ok: true;
      readonly listing: MarketplaceListing;
      /** Verbatim per-claim verification report (all claims verified). */
      readonly claimReport: readonly PublicationClaimReport[];
    }
  | {
      readonly ok: false;
      readonly reasonCode: ListingPublicationReasonCode;
      readonly claimReport: readonly PublicationClaimReport[];
    };

export type ListingPublicationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "LISTING_ID_EMPTY"
  | "VENDOR_ID_EMPTY"
  | "NO_CLAIMED_CAPABILITIES"
  | "CAPABILITY_UNVERIFIED";

/**
 * publishListing — publication gate. Every claimed capability must be a
 * record of this vendor in this tenant with status "verified" (law A3).
 * One unverified claim refuses the whole publication; the per-claim
 * report states exactly which claims are unverified or unknown. Exclusions
 * are honest: they are carried verbatim onto the published listing.
 */
export function publishListing(
  draft: MarketplaceListingDraft,
  capabilityRecords: readonly VendorCapabilityRecord[],
  publishedAt: number,
): ListingPublicationResult {
  const tenantCheck = validateTenantScope(draft.tenant);
  if (!tenantCheck.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", claimReport: [] };
  }
  if (draft.listingId.length === 0) {
    return { ok: false, reasonCode: "LISTING_ID_EMPTY", claimReport: [] };
  }
  if (draft.vendorId.length === 0) {
    return { ok: false, reasonCode: "VENDOR_ID_EMPTY", claimReport: [] };
  }
  if (draft.claimedCapabilities.length === 0) {
    return { ok: false, reasonCode: "NO_CLAIMED_CAPABILITIES", claimReport: [] };
  }
  const claimReport: PublicationClaimReport[] = [];
  let refused = false;
  for (const tag of draft.claimedCapabilities) {
    const record = capabilityRecords.find(
      (r) => r.vendorId === draft.vendorId && r.tag === tag,
    );
    if (record === undefined) {
      claimReport.push({ tag, recordStatus: "unknown", reasonCode: "CAPABILITY_UNKNOWN" });
      refused = true;
      continue;
    }
    const recordTenant = validateTenantScope(record.tenant);
    if (!recordTenant.ok) {
      return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", claimReport };
    }
    if (recordTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH", claimReport };
    }
    if (record.status === "verified") {
      claimReport.push({ tag, recordStatus: "verified", reasonCode: null });
    } else {
      claimReport.push({ tag, recordStatus: "declared", reasonCode: "CAPABILITY_UNVERIFIED" });
      refused = true;
    }
  }
  if (refused) {
    return { ok: false, reasonCode: "CAPABILITY_UNVERIFIED", claimReport };
  }
  return {
    ok: true,
    listing: {
      listingId: draft.listingId,
      tenant: tenantCheck.scope,
      vendorId: draft.vendorId,
      claimedCapabilities: [...draft.claimedCapabilities],
      exclusions: [...draft.exclusions],
      status: "published",
      delistReason: null,
      publishedAt,
    },
    claimReport,
  };
}

// ---------------------------------------------------------------------------
// Delisting cascade — a revoked capability cascades to listing removal.
// ---------------------------------------------------------------------------

export interface CapabilityRevocation {
  readonly tenant: TenantScope;
  readonly vendorId: string;
  /** Capability tags whose verification was revoked. */
  readonly revokedTags: readonly string[];
}

export type RevocationCascadeResult =
  | {
      readonly ok: true;
      readonly listings: readonly MarketplaceListing[];
      /** Listing ids delisted by this revocation (exactly the intersecting set). */
      readonly delistedListingIds: readonly string[];
      /** Listing ids inspected and left published (claims do not intersect). */
      readonly keptListingIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reasonCode: RevocationCascadeReasonCode;
    };

export type RevocationCascadeReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "VENDOR_MISMATCH"
  | "NO_REVOKED_TAGS";

/**
 * applyRevocationCascade — machine-checked delisting semantics: a
 * published listing is delisted IFF its claimedCapabilities intersect the
 * revoked tag set. The delist reason records the revoked tags (sorted,
 * comma-joined). Untouched listings are returned UNCHANGED (by reference
 * where possible); already-delisted listings keep their original reason.
 * Fail-closed: a foreign-tenant or foreign-vendor listing in the input
 * refuses the whole cascade.
 */
export function applyRevocationCascade(
  revocation: CapabilityRevocation,
  listings: readonly MarketplaceListing[],
): RevocationCascadeResult {
  const tenantCheck = validateTenantScope(revocation.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (revocation.vendorId.length === 0) {
    return { ok: false, reasonCode: "VENDOR_MISMATCH" };
  }
  if (revocation.revokedTags.length === 0) {
    return { ok: false, reasonCode: "NO_REVOKED_TAGS" };
  }
  const revokedSet = new Set(revocation.revokedTags);
  const next: MarketplaceListing[] = [];
  const delistedListingIds: string[] = [];
  const keptListingIds: string[] = [];
  for (const listing of listings) {
    const listingTenant = validateTenantScope(listing.tenant);
    if (!listingTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (listingTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
    if (listing.vendorId !== revocation.vendorId) {
      return { ok: false, reasonCode: "VENDOR_MISMATCH" };
    }
    if (listing.status === "delisted") {
      next.push(listing);
      continue;
    }
    const hit = [...revokedSet].filter((t) => listing.claimedCapabilities.includes(t));
    if (hit.length === 0) {
      next.push(listing);
      keptListingIds.push(listing.listingId);
      continue;
    }
    next.push({
      ...listing,
      status: "delisted",
      delistReason: `CAPABILITY_REVOKED:${[...hit].sort().join(",")}`,
    });
    delistedListingIds.push(listing.listingId);
  }
  return {
    ok: true,
    listings: next,
    delistedListingIds: delistedListingIds.sort(),
    keptListingIds: keptListingIds.sort(),
  };
}

// ---------------------------------------------------------------------------
// Listing search — deterministic ordering + filters (delisted never match).
// ---------------------------------------------------------------------------

export interface ListingSearchQuery {
  /** Match listings claiming this exact tag (optional). */
  readonly capabilityTag: string | null;
  /** Match listings of this vendor (optional). */
  readonly vendorId: string | null;
}

export type ListingSearchResult =
  | {
      readonly ok: true;
      readonly results: readonly MarketplaceListing[];
      /** The recorded ordering law, verbatim for evidence. */
      readonly ordering: "vendor-id-lexical-then-listing-id-lexical";
    }
  | { readonly ok: false; readonly reasonCode: ListingSearchReasonCode };

export type ListingSearchReasonCode = "TENANT_SCOPE_MISSING" | "TENANT_MISMATCH";

/**
 * searchListings — deterministic marketplace search over the tenant's
 * listings. Only PUBLISHED listings match (delisted listings are never
 * searchable). Results are ordered by (vendorId lexical, listingId
 * lexical) — the documented total order; input order never leaks into
 * the output. Fail-closed: a foreign-tenant listing in the input refuses
 * the search (never silently filtered).
 */
export function searchListings(
  tenant: TenantScope,
  listings: readonly MarketplaceListing[],
  query: ListingSearchQuery,
): ListingSearchResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  for (const listing of listings) {
    const listingTenant = validateTenantScope(listing.tenant);
    if (!listingTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
    if (listingTenant.scope.tenantId !== tenantCheck.scope.tenantId) {
      return { ok: false, reasonCode: "TENANT_MISMATCH" };
    }
  }
  const results = listings.filter((listing) => {
    if (listing.status !== "published") return false;
    if (query.capabilityTag !== null && !listing.claimedCapabilities.includes(query.capabilityTag)) {
      return false;
    }
    if (query.vendorId !== null && listing.vendorId !== query.vendorId) {
      return false;
    }
    return true;
  });
  const sorted = [...results].sort((a, b) => {
    if (a.vendorId !== b.vendorId) return a.vendorId.localeCompare(b.vendorId);
    return a.listingId.localeCompare(b.listingId);
  });
  return {
    ok: true,
    results: sorted,
    ordering: "vendor-id-lexical-then-listing-id-lexical",
  };
}
