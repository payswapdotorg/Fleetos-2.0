/**
 * @fleetos/acceptance-commerce — marketplace-transaction step drivers
 * (F331C row 34, Wave 13 lane C).
 *
 * Interprets typed journey steps against the REAL public entry points:
 * the seed publishes listings through the REAL @fleetos/vendors
 * publication gate (verified capability records; the delisted listing
 * is produced by the REAL revocation cascade), then every transaction
 * step drives the REAL @fleetos/procurement marketplace-transaction API
 * (place/checkout/cancel/expire + the deterministic board).
 *
 * Time law: `at: "now"` resolves to the run anchor
 * `state.time.startedAt` (the F331C seam); absolute numbers are fixed
 * world facts. The per-journey seam (listings + orders) lives in a
 * WeakMap keyed by JourneyState — fresh world per run keeps everything
 * deterministic. Refusals are honest facts carrying the domain's reason
 * codes. Facts that are direct functions of the run anchor are emitted
 * (e.g. placedAt/checkedOutAt) but never eq-asserted by the journeys —
 * anchor-derived expectations would be timestamp-echo pins (D13).
 */

import type { FactValue } from "./journey-contracts.js";
import type { MarketplaceTransactionStep } from "./journey-contracts-f331c.js";
import type { JourneyState } from "./journey-world.js";
import { logPush } from "./journey-world.js";
import type { MarketplaceListing, VendorCapabilityRecord } from "@fleetos/vendors";
import { publishListing, applyRevocationCascade } from "@fleetos/vendors";
import {
  placeMarketplaceOrder,
  checkoutMarketplaceOrder,
  cancelMarketplaceOrder,
  expireMarketplaceOrder,
  summarizeMarketplaceOrders,
  type MarketplaceListingLike,
  type MarketplaceOrder,
} from "@fleetos/procurement";

export type DriverFacts = Record<string, FactValue>;

interface MtxSeam {
  listings: MarketplaceListingLike[];
  orders: MarketplaceOrder[];
}

const seams = new WeakMap<JourneyState, MtxSeam>();

function seamFor(state: JourneyState): MtxSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { listings: [], orders: [] };
    seams.set(state, seam);
  }
  return seam;
}

function resolveAt(at: "now" | number, state: JourneyState): number {
  return at === "now" ? state.time.startedAt : at;
}

/** A published listing of ANOTHER tenant — the fail-closed probe input. */
function foreignListing(tenantId: string): MarketplaceListingLike {
  return {
    listingId: "lst-foreign",
    tenant: { tenantId },
    vendorId: "ven-foreign",
    claimedCapabilities: ["cold-chain"],
    exclusions: [],
    status: "published",
    delistReason: null,
    publishedAt: 0,
  };
}

/** The REAL listing record (from publishListing) is structurally the seam type. */
function asLike(listing: MarketplaceListing): MarketplaceListingLike {
  return listing;
}

export async function runMarketplaceTransactionStep(
  step: MarketplaceTransactionStep,
  state: JourneyState,
): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "mtx-listing-seed": {
      const records: VendorCapabilityRecord[] = step.records.map((r) => ({
        vendorId: r.vendorId,
        tenant: state.tenant,
        tag: r.tag,
        status: "verified" as const,
        verifiedAt: state.time.startedAt - 60 * 86_400_000,
        evidence: { evidenceId: `ev-mtx-${r.vendorId}-${r.tag}`, tenantId: state.tenant.tenantId },
      }));
      const published: MarketplaceListingLike[] = [];
      const delistedIds: string[] = [];
      for (const seed of step.listings) {
        const result = publishListing(
          {
            listingId: seed.listingId,
            tenant: state.tenant,
            vendorId: seed.vendorId,
            claimedCapabilities: [...seed.claimedCapabilities],
            exclusions: [...seed.exclusions],
          },
          records,
          seed.publishedAt,
        );
        if (!result.ok) throw new Error(`mtx-seed: publication refused ${result.reasonCode}`);
        published.push(asLike(result.listing));
      }
      // The delisted listing is produced by the REAL revocation cascade.
      const toDelist = published.filter((l) =>
        step.listings.some((s) => s.listingId === l.listingId && s.delisted === true),
      );
      for (const listing of toDelist) {
        const vendorSlice = published.filter((l) => l.vendorId === listing.vendorId);
        const cascade = applyRevocationCascade(
          { tenant: state.tenant, vendorId: listing.vendorId, revokedTags: [listing.claimedCapabilities[0] ?? ""] },
          vendorSlice as readonly MarketplaceListing[],
        );
        if (!cascade.ok) throw new Error(`mtx-seed: cascade refused ${cascade.reasonCode}`);
        for (const next of cascade.listings) {
          const idx = published.findIndex((l) => l.listingId === next.listingId);
          if (idx >= 0) published[idx] = asLike(next);
        }
        delistedIds.push(...cascade.delistedListingIds);
      }
      seam.listings = published;
      logPush(state, "mtx.seedLog", `${published.map((l) => `${l.listingId}:${l.status}`).join("|")}${delistedIds.length > 0 ? `|delisted:${delistedIds.join(",")}` : ""}`);
      return {
        [`mtx.seed.${step.factKey}.count`]: published.length,
        [`mtx.seed.${step.factKey}.published`]: published.filter((l) => l.status === "published").map((l) => l.listingId),
        [`mtx.seed.${step.factKey}.delisted`]: [...delistedIds].sort(),
      };
    }
    case "mtx-place-order": {
      const input = step.injectForeignListing === true
        ? [...seam.listings, foreignListing(state.otherTenant.tenantId)]
        : seam.listings;
      const result = placeMarketplaceOrder(
        state.tenant,
        {
          orderId: step.orderId,
          listingId: step.listingId,
          vendorId: step.vendorId,
          quantity: step.quantity,
          unitPriceMinor: step.unitPriceMinor,
          holdMs: step.holdMs,
          acknowledgeExclusions: step.acknowledgeExclusions,
        },
        input,
        seam.orders,
        resolveAt(step.at, state),
      );
      if (!result.ok) {
        logPush(state, "mtx.placeLog", `${step.orderId}:refused:${result.reasonCode}`);
        return {
          [`mtx.place.${step.factKey}.ok`]: false,
          [`mtx.place.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mtx.place.${step.factKey}.status`]: null,
        };
      }
      seam.orders = [...seam.orders, result.order];
      logPush(state, "mtx.placeLog", `${step.orderId}:placed:${result.order.totalMinor}`);
      return {
        [`mtx.place.${step.factKey}.ok`]: true,
        [`mtx.place.${step.factKey}.reasonCode`]: null,
        [`mtx.place.${step.factKey}.status`]: result.order.status,
        [`mtx.place.${step.factKey}.totalMinor`]: result.order.totalMinor,
        [`mtx.place.${step.factKey}.exclusions`]: [...result.order.exclusions],
        [`mtx.place.${step.factKey}.placedAt`]: result.order.placedAt,
        [`mtx.place.${step.factKey}.validUntil`]: result.order.validUntil,
      };
    }
    case "mtx-checkout-order": {
      const order = seam.orders.find((o) => o.orderId === step.orderId);
      if (order === undefined) {
        return {
          [`mtx.checkout.${step.factKey}.ok`]: false,
          [`mtx.checkout.${step.factKey}.reasonCode`]: "ORDER_NOT_FOUND",
          [`mtx.checkout.${step.factKey}.status`]: null,
          [`mtx.checkout.${step.factKey}.totalMinor`]: null,
        };
      }
      const result = checkoutMarketplaceOrder(
        state.tenant,
        order,
        seam.listings as readonly MarketplaceListing[],
        { limitMinor: step.limitMinor },
        resolveAt(step.at, state),
      );
      if (!result.ok) {
        logPush(state, "mtx.checkoutLog", `${step.orderId}:refused:${result.reasonCode}`);
        return {
          [`mtx.checkout.${step.factKey}.ok`]: false,
          [`mtx.checkout.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mtx.checkout.${step.factKey}.status`]: null,
          [`mtx.checkout.${step.factKey}.totalMinor`]: order.totalMinor,
          [`mtx.checkout.${step.factKey}.validUntil`]: result.validUntil,
          [`mtx.checkout.${step.factKey}.overshootMs`]: result.overshootMs,
          [`mtx.checkout.${step.factKey}.overshootMinor`]: result.overshootMinor,
        };
      }
      const idx = seam.orders.findIndex((o) => o.orderId === step.orderId);
      seam.orders = [...seam.orders.slice(0, idx), result.order, ...seam.orders.slice(idx + 1)];
      logPush(state, "mtx.checkoutLog", `${step.orderId}:checked-out:${result.order.totalMinor}`);
      return {
        [`mtx.checkout.${step.factKey}.ok`]: true,
        [`mtx.checkout.${step.factKey}.reasonCode`]: null,
        [`mtx.checkout.${step.factKey}.status`]: result.order.status,
        [`mtx.checkout.${step.factKey}.totalMinor`]: result.order.totalMinor,
        [`mtx.checkout.${step.factKey}.checkedOutAt`]: result.order.checkedOutAt,
      };
    }
    case "mtx-cancel-order": {
      const order = seam.orders.find((o) => o.orderId === step.orderId);
      if (order === undefined) {
        return { [`mtx.cancel.${step.factKey}.ok`]: false, [`mtx.cancel.${step.factKey}.reasonCode`]: "ORDER_NOT_FOUND" };
      }
      const result = cancelMarketplaceOrder(order, resolveAt(step.at, state), step.reason);
      if (!result.ok) {
        logPush(state, "mtx.cancelLog", `${step.orderId}:refused:${result.reasonCode}`);
        return {
          [`mtx.cancel.${step.factKey}.ok`]: false,
          [`mtx.cancel.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mtx.cancel.${step.factKey}.status`]: null,
        };
      }
      const idx = seam.orders.findIndex((o) => o.orderId === step.orderId);
      seam.orders = [...seam.orders.slice(0, idx), result.order, ...seam.orders.slice(idx + 1)];
      logPush(state, "mtx.cancelLog", `${step.orderId}:cancelled`);
      return {
        [`mtx.cancel.${step.factKey}.ok`]: true,
        [`mtx.cancel.${step.factKey}.reasonCode`]: null,
        [`mtx.cancel.${step.factKey}.status`]: result.order.status,
        [`mtx.cancel.${step.factKey}.cancelledReason`]: result.order.cancelledReason,
      };
    }
    case "mtx-expire-order": {
      const order = seam.orders.find((o) => o.orderId === step.orderId);
      if (order === undefined) {
        return { [`mtx.expire.${step.factKey}.ok`]: false, [`mtx.expire.${step.factKey}.reasonCode`]: "ORDER_NOT_FOUND" };
      }
      const result = expireMarketplaceOrder(order, resolveAt(step.at, state));
      if (!result.ok) {
        logPush(state, "mtx.expireLog", `${step.orderId}:refused:${result.reasonCode}`);
        return {
          [`mtx.expire.${step.factKey}.ok`]: false,
          [`mtx.expire.${step.factKey}.reasonCode`]: result.reasonCode,
          [`mtx.expire.${step.factKey}.status`]: null,
        };
      }
      const idx = seam.orders.findIndex((o) => o.orderId === step.orderId);
      seam.orders = [...seam.orders.slice(0, idx), result.order, ...seam.orders.slice(idx + 1)];
      logPush(state, "mtx.expireLog", `${step.orderId}:expired`);
      return {
        [`mtx.expire.${step.factKey}.ok`]: true,
        [`mtx.expire.${step.factKey}.reasonCode`]: null,
        [`mtx.expire.${step.factKey}.status`]: result.order.status,
        [`mtx.expire.${step.factKey}.expiredAt`]: result.order.expiredAt,
      };
    }
    case "mtx-order-board": {
      const board = summarizeMarketplaceOrders(seam.orders);
      return {
        [`mtx.board.${step.factKey}.total`]: board.total,
        [`mtx.board.${step.factKey}.orderIds`]: [...board.orderIds],
        [`mtx.board.${step.factKey}.placed`]: board.byStatus.placed,
        [`mtx.board.${step.factKey}.checkedOut`]: board.byStatus["checked-out"],
        [`mtx.board.${step.factKey}.cancelled`]: board.byStatus.cancelled,
        [`mtx.board.${step.factKey}.expired`]: board.byStatus.expired,
        [`mtx.board.${step.factKey}.issuedTotalMinor`]: board.issuedTotalMinor,
      };
    }
  }
}
