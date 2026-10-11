/**
 * @fleetos/acceptance-commerce — marketplace step drivers (F321C, Wave 12
 * lane C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * `@fleetos/vendors` marketplace.ts: the publication gate (every claimed
 * capability must be a verified record of this vendor in this tenant),
 * the revocation→delisting cascade (set-equality machine-checked), and
 * deterministic tenant-scoped listing search (delisted listings never
 * match; the documented (vendorId, listingId) lexical total order).
 *
 * The per-journey marketplace seam (capability records + listings) lives
 * in a WeakMap keyed by JourneyState — a fresh world per run keeps every
 * run pure and deterministic. Facts are namespaced per `factKey`;
 * refusals are honest facts carrying the domain's reason codes.
 */

import type { FactValue, MarketplaceStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, OTHER_TENANT, logPush } from "./journey-world.js";
import type {
  MarketplaceListing,
  VendorCapabilityRecord,
} from "@fleetos/vendors";
import { publishListing, applyRevocationCascade, searchListings } from "@fleetos/vendors";

export type DriverFacts = Record<string, FactValue>;

interface MarketplaceSeam {
  records: VendorCapabilityRecord[];
  listings: MarketplaceListing[];
}

const seams = new WeakMap<JourneyState, MarketplaceSeam>();

function seamFor(state: JourneyState): MarketplaceSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { records: [], listings: [] };
    seams.set(state, seam);
  }
  return seam;
}

/** A published listing from ANOTHER tenant — the fail-closed probe input. */
function foreignTenantListing(): MarketplaceListing {
  return {
    listingId: "lst-foreign",
    tenant: OTHER_TENANT,
    vendorId: "ven-foreign",
    claimedCapabilities: ["cold-chain"],
    exclusions: [],
    status: "published",
    delistReason: null,
    publishedAt: CLOCK.t3,
  };
}

/** A published listing of ANOTHER vendor — the cascade fail-closed probe input. */
function foreignVendorListing(tenant: { readonly tenantId: string }): MarketplaceListing {
  return {
    listingId: "lst-other-vendor",
    tenant,
    vendorId: "ven-other",
    claimedCapabilities: ["cold-chain"],
    exclusions: [],
    status: "published",
    delistReason: null,
    publishedAt: CLOCK.t3,
  };
}

export async function runMarketplaceStep(step: MarketplaceStep, state: JourneyState): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "marketplace-capabilities-seed": {
      seam.records = step.records.map((r) => ({
        vendorId: r.vendorId,
        tenant: (r.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT,
        tag: r.tag,
        status: r.status,
        verifiedAt: r.status === "verified" ? CLOCK.t1 : null,
        evidence: r.status === "verified" ? { evidenceId: `ev-mp-${r.vendorId}-${r.tag}`, tenantId: (r.tenant ?? "own") === "own" ? state.tenant.tenantId : OTHER_TENANT.tenantId } : null,
      }));
      return {
        [`mp.seed.${step.factKey}.count`]: seam.records.length,
        [`mp.seed.${step.factKey}.verifiedTags`]: seam.records.filter((r) => r.status === "verified").map((r) => `${r.vendorId}:${r.tag}`),
      };
    }
    case "marketplace-publish": {
      const result = publishListing(
        {
          listingId: step.listingId,
          tenant: state.tenant,
          vendorId: step.vendorId,
          claimedCapabilities: [...step.claimedCapabilities],
          exclusions: [...step.exclusions],
        },
        seam.records,
        CLOCK.t3,
      );
      if (!result.ok) {
        logPush(state, "mp.publishLog", `${step.listingId}:refused:${result.reasonCode}`);
        return {
          [`mp.publish.${step.factKey}.ok`]: false,
          [`mp.publish.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mp.publish.${step.factKey}.claimReport`]: result.claimReport.map((c) => `${c.tag}:${c.recordStatus}:${c.reasonCode ?? "-"}`),
        };
      }
      seam.listings = [...seam.listings, result.listing];
      logPush(state, "mp.publishLog", `${step.listingId}:published`);
      return {
        [`mp.publish.${step.factKey}.ok`]: true,
        [`mp.publish.${step.factKey}.status`]: result.listing.status,
        [`mp.publish.${step.factKey}.vendorId`]: result.listing.vendorId,
        [`mp.publish.${step.factKey}.exclusions`]: [...result.listing.exclusions],
        [`mp.publish.${step.factKey}.claimReport`]: result.claimReport.map((c) => `${c.tag}:${c.recordStatus}:${c.reasonCode ?? "-"}`),
        [`mp.publish.${step.factKey}.publishedAt`]: result.listing.publishedAt,
        [`mp.publish.${step.factKey}.publishedCount`]: seam.listings.length,
      };
    }
    case "marketplace-revoke-cascade": {
      // The honest caller scope: the revocation vendor's own listings.
      // A foreign-vendor listing in the input refuses the whole cascade
      // (fail-closed) — driven via the explicit probe flag.
      const own = seam.listings.filter((l) => l.vendorId === step.vendorId);
      const input = step.foreignVendorListingInjected
        ? [...own, foreignVendorListing(state.tenant)]
        : own;
      const result = applyRevocationCascade(
        {
          tenant: state.tenant,
          vendorId: step.vendorId,
          revokedTags: [...step.revokedTags],
        },
        input,
      );
      if (!result.ok) {
        logPush(state, "mp.cascadeLog", `${step.vendorId}:refused:${result.reasonCode}`);
        return {
          [`mp.cascade.${step.factKey}.ok`]: false,
          [`mp.cascade.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      // Merge the transformed vendor slice back into the seam WITHOUT
      // touching the other vendors' listings.
      const others = seam.listings.filter((l) => l.vendorId !== step.vendorId);
      seam.listings = [...others, ...result.listings];
      const delisted = seam.listings.filter((l) => l.status === "delisted");
      logPush(state, "mp.cascadeLog", `${step.vendorId}:delisted:${result.delistedListingIds.join(",") || "-"}`);
      return {
        [`mp.cascade.${step.factKey}.ok`]: true,
        [`mp.cascade.${step.factKey}.delistedIds`]: [...result.delistedListingIds],
        [`mp.cascade.${step.factKey}.keptIds`]: [...result.keptListingIds],
        [`mp.cascade.${step.factKey}.firstDelistReason`]: delisted[0]?.delistReason ?? null,
        [`mp.cascade.${step.factKey}.delistedCount`]: delisted.length,
      };
    }
    case "marketplace-search": {
      const input = step.foreignListingInjected
        ? [...seam.listings, foreignTenantListing()]
        : [...seam.listings];
      const result = searchListings(state.tenant, input, {
        capabilityTag: step.capabilityTag,
        vendorId: step.vendorId,
      });
      if (!result.ok) {
        logPush(state, "mp.searchLog", `refused:${result.reasonCode}`);
        return {
          [`mp.search.${step.factKey}.ok`]: false,
          [`mp.search.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      logPush(state, "mp.searchLog", result.results.map((r) => r.listingId).join(",") || "-");
      return {
        [`mp.search.${step.factKey}.ok`]: true,
        [`mp.search.${step.factKey}.ids`]: result.results.map((r) => r.listingId),
        [`mp.search.${step.factKey}.vendors`]: result.results.map((r) => r.vendorId),
        [`mp.search.${step.factKey}.ordering`]: result.ordering,
        [`mp.search.${step.factKey}.count`]: result.results.length,
      };
    }
  }
}
