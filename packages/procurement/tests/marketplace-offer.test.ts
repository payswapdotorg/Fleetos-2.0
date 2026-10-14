/**
 * @fleetos/procurement — F361C §3.2: the marketplace offer/quote contract.
 * Machine tests of the full-schema capture battery, THE FRESHNESS LAW
 * (an expired offer never silently appears current), the fail-closed
 * current-offer sheet, and the comparison composition over the EXISTING
 * compareQuotes + matchVendors kernels (hard-constraint vs
 * preference-weight separation, per-offer explainable rationale).
 */

import { describe, expect, it } from "vitest";
import {
  captureMarketplaceOffer,
  assessOfferFreshness,
  buildCurrentOfferSheet,
  compareMarketplaceOffers,
  type MarketplaceOffer,
  type MarketplaceOfferCaptureInput,
  type SupplierVerificationLike,
} from "../src/index.js";

const TENANT = { tenantId: "acme" } as const;
const FOREIGN = { tenantId: "globex" } as const;
const T0 = 1_774_000_000_000;
const DAY = 86_400_000;

function mustCapture(tenant: { tenantId: string }, input: MarketplaceOfferCaptureInput): MarketplaceOffer {
  const result = captureMarketplaceOffer(tenant, input);
  if (!result.ok) throw new Error(`fixture: ${result.reasonCode}`);
  return result.offer;
}

function captureInput(overrides: Partial<MarketplaceOfferCaptureInput> = {}): MarketplaceOfferCaptureInput {
  return {
    offerId: "off-1",
    supplierId: "sup-1",
    sku: "LT-5540",
    quantity: 5,
    unitCostMinor: 1_200_000,
    totalCostMinor: 6_000_000,
    currency: "GHS",
    taxMinor: 150_000,
    feesMinor: 25_000,
    deliveryEstimateDays: 10,
    condition: "new",
    warrantyMonths: 24,
    validFrom: T0 - DAY,
    validUntil: T0 + 14 * DAY,
    source: { kind: "manual-catalogue-export", reference: "exp-2026-10-01" },
    capturedAt: T0,
    ...overrides,
  };
}

describe("captureMarketplaceOffer — the full frozen-schema battery", () => {
  it("captures the full §3.2 schema immutably", () => {
    const result = captureMarketplaceOffer(TENANT, captureInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offer.tenant.tenantId).toBe("acme");
    expect(result.offer.source.kind).toBe("manual-catalogue-export");
    expect(result.offer.capturedAt).toBe(T0);
    expect(result.offer.taxMinor).toBe(150_000);
    expect(result.offer.feesMinor).toBe(25_000);
    expect(result.offer.condition).toBe("new");
    expect(result.offer.warrantyMonths).toBe(24);
    expect(result.offer.validUntil).toBe(T0 + 14 * DAY);
  });

  it("money and window refusals carry the exact reason codes (never clamped)", () => {
    expect(captureMarketplaceOffer(TENANT, captureInput({ offerId: "" }))).toEqual({ ok: false, reasonCode: "OFFER_ID_REQUIRED" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ supplierId: "" }))).toEqual({ ok: false, reasonCode: "SUPPLIER_ID_REQUIRED" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ sku: "" }))).toEqual({ ok: false, reasonCode: "SKU_REQUIRED" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ quantity: 0 }))).toEqual({ ok: false, reasonCode: "INVALID_QUANTITY" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ unitCostMinor: 0 }))).toEqual({ ok: false, reasonCode: "INVALID_UNIT_COST" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ totalCostMinor: 6_000_001 }))).toEqual({ ok: false, reasonCode: "TOTAL_MISMATCH" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ currency: "" }))).toEqual({ ok: false, reasonCode: "CURRENCY_REQUIRED" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ taxMinor: -1 }))).toEqual({ ok: false, reasonCode: "INVALID_TAX" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ feesMinor: -1 }))).toEqual({ ok: false, reasonCode: "INVALID_FEES" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ deliveryEstimateDays: -1 }))).toEqual({ ok: false, reasonCode: "INVALID_DELIVERY_ESTIMATE" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ warrantyMonths: -1 }))).toEqual({ ok: false, reasonCode: "INVALID_WARRANTY" });
  });

  it("the capture itself must sit inside the validity window and carry a source reference", () => {
    expect(captureMarketplaceOffer(TENANT, captureInput({ validUntil: T0 - DAY }))).toEqual({ ok: false, reasonCode: "INVALID_VALIDITY_WINDOW" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ capturedAt: T0 - 2 * DAY }))).toEqual({ ok: false, reasonCode: "CAPTURE_BEFORE_WINDOW_START" });
    expect(captureMarketplaceOffer(TENANT, captureInput({ capturedAt: T0 + 15 * DAY }))).toEqual({ ok: false, reasonCode: "CAPTURE_AFTER_WINDOW_END" });
    expect(
      captureMarketplaceOffer(TENANT, captureInput({ source: { kind: "operator-entered", reference: "" } })),
    ).toEqual({ ok: false, reasonCode: "SOURCE_REFERENCE_REQUIRED" });
  });
});

describe("THE FRESHNESS LAW — an expired offer never silently appears current", () => {
  it("the verdict is pure over the window (boundary instant inclusive)", () => {
    const captured = captureMarketplaceOffer(TENANT, captureInput());
    if (!captured.ok) throw new Error("fixture");
    const o = captured.offer;
    expect(assessOfferFreshness(o, T0).verdict).toBe("fresh");
    expect(assessOfferFreshness(o, o.validUntil).verdict).toBe("fresh");
    expect(assessOfferFreshness(o, o.validUntil + 1).verdict).toBe("expired");
    expect(assessOfferFreshness(o, o.validFrom - 1).verdict).toBe("not-yet-valid");
    expect(assessOfferFreshness(o, o.validFrom).verdict).toBe("fresh");
  });

  it("the current-offer sheet admits ONLY fresh offers and reports every exclusion", () => {
    const fresh = mustCapture(TENANT, captureInput({ offerId: "off-fresh", validUntil: T0 + 30 * DAY }));
    const expired = mustCapture(
      TENANT,
      captureInput({ offerId: "off-expired", validFrom: T0 - 30 * DAY, validUntil: T0 - DAY, capturedAt: T0 - 2 * DAY }),
    );
    const future = mustCapture(
      TENANT,
      captureInput({ offerId: "off-future", validFrom: T0 + 10 * DAY, validUntil: T0 + 40 * DAY, capturedAt: T0 + 10 * DAY }),
    );
    if (!fresh || !expired || !future) throw new Error("fixture");
    const sheet = buildCurrentOfferSheet(TENANT, [future, fresh, expired], T0);
    expect(sheet.ok).toBe(true);
    if (!sheet.ok) return;
    expect(sheet.freshOffers.map((o) => o.offerId)).toEqual(["off-fresh"]);
    expect(sheet.excluded.map((e) => `${e.offerId}:${e.verdict}`)).toEqual([
      "off-expired:expired",
      "off-future:not-yet-valid",
    ]);
    expect(sheet.freshCount).toBe(1);
    expect(sheet.expiredCount).toBe(1);
    expect(sheet.notYetValidCount).toBe(1);
  });

  it("a foreign-tenant offer in the sheet input refuses the whole sheet (fail-closed)", () => {
    const foreign = mustCapture(FOREIGN, captureInput({ offerId: "off-foreign" }));
    if (!foreign) throw new Error("fixture");
    expect(buildCurrentOfferSheet(TENANT, [foreign], T0)).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });
});

describe("compareMarketplaceOffers — hard constraints vs preference weights", () => {
  const verifications: readonly SupplierVerificationLike[] = [
    { supplierId: "sup-a", tenant: TENANT, status: "verified", expiresAt: T0 + 90 * DAY },
    { supplierId: "sup-b", tenant: TENANT, status: "verified", expiresAt: T0 + 90 * DAY },
    { supplierId: "sup-pending", tenant: TENANT, status: "pending", expiresAt: null },
    { supplierId: "sup-susp", tenant: TENANT, status: "suspended", expiresAt: T0 + 90 * DAY },
    { supplierId: "sup-lapsed", tenant: TENANT, status: "verified", expiresAt: T0 - DAY },
  ];

  function offer(overrides: Partial<MarketplaceOfferCaptureInput>): MarketplaceOffer {
    const result = captureMarketplaceOffer(TENANT, captureInput(overrides));
    if (!result.ok) throw new Error(`fixture: ${result.reasonCode}`);
    return result.offer;
  }

  const demand = {
    tenant: TENANT,
    sku: "LT-5540",
    currency: "GHS",
    acceptableConditions: ["new", "certified-refurbished"] as const,
  };

  it("hard constraints gate eligibility; the preference weights rank ONLY the eligible set", () => {
    const eligibleA = offer({ offerId: "off-a", supplierId: "sup-a", unitCostMinor: 1_200_000, totalCostMinor: 6_000_000, warrantyMonths: 24 });
    const eligibleB = offer({ offerId: "off-b", supplierId: "sup-b", unitCostMinor: 1_000_000, totalCostMinor: 5_000_000, deliveryEstimateDays: 3, warrantyMonths: 12 });
    const wrongSku = offer({ offerId: "off-sku", supplierId: "sup-a", sku: "PR-3300" });
    const wrongCurrency = offer({ offerId: "off-cur", supplierId: "sup-b", currency: "USD" });
    const wrongCondition = offer({ offerId: "off-con", supplierId: "sup-a", condition: "used" });
    const pendingSupplier = offer({ offerId: "off-pend", supplierId: "sup-pending" });
    const suspendedSupplier = offer({ offerId: "off-susp", supplierId: "sup-susp" });
    const lapsedSupplier = offer({ offerId: "off-lap", supplierId: "sup-lapsed" });
    const result = compareMarketplaceOffers(
      demand,
      [eligibleA, eligibleB, wrongSku, wrongCurrency, wrongCondition, pendingSupplier, suspendedSupplier, lapsedSupplier],
      verifications,
      { at: T0 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.eligibleCount).toBe(2);
    expect(result.ineligibleCount).toBe(6);
    // The composed EXISTING compareQuotes ranking over the eligible set.
    expect(result.ranked.map((r) => r.quoteId)).toEqual(["off-b", "off-a"]);
    // Every offer carries its explainable rationale.
    const rationaleById = new Map(result.rationales.map((r) => [r.offerId, r]));
    const failCode = (offerId: string, constraint: string) => {
      const rationale = rationaleById.get(offerId);
      const check = rationale?.hardConstraints.find((c) => c.constraint === constraint);
      return check?.reasonCode ?? null;
    };
    expect(failCode("off-sku", "sku")).toBe("OFFER_SKU_MISMATCH");
    expect(failCode("off-cur", "currency")).toBe("OFFER_CURRENCY_MISMATCH");
    expect(failCode("off-con", "condition")).toBe("OFFER_CONDITION_NOT_ACCEPTABLE");
    expect(failCode("off-pend", "supplier_verification")).toBe("SUPPLIER_NOT_VERIFIED");
    expect(failCode("off-susp", "supplier_verification")).toBe("SUPPLIER_NOT_VERIFIED");
    expect(failCode("off-lap", "supplier_verification")).toBe("VERIFICATION_EXPIRED");
    const a = rationaleById.get("off-a");
    expect(a?.eligible).toBe(true);
    expect(a?.rank).toBe(2);
    expect(a?.totalScoreBps).toBeGreaterThan(0);
    expect(a?.priceScoreBps).toBe(8333);
    expect(a?.matchedTags).toEqual(["LT-5540"]);
    expect(a?.supplierMatchScore).not.toBeNull();
    const ineligible = rationaleById.get("off-sku");
    expect(ineligible?.rank).toBeNull();
    expect(ineligible?.totalScoreBps).toBeNull();
    // Eligible rationales precede ineligible ones (deterministic order).
    expect(result.rationales.slice(0, 2).every((r) => r.eligible)).toBe(true);
    expect(result.rationales.slice(2).every((r) => !r.eligible)).toBe(true);
  });

  it("the EXISTING matchVendors supplier match is composed (recorded tie-breaks, matched tags)", () => {
    const a = offer({ offerId: "off-a", supplierId: "sup-a" });
    const b = offer({ offerId: "off-b", supplierId: "sup-b", warrantyMonths: 36 });
    const result = compareMarketplaceOffers(demand, [a, b], verifications, { at: T0 });
    if (!result.ok) throw new Error("fixture");
    expect(result.supplierMatches.map((m) => m.vendorId).sort()).toEqual(["sup-a", "sup-b"]);
    expect(result.supplierMatches.every((m) => m.matchedTags.includes("LT-5540"))).toBe(true);
    // The warranty proxy: 36 months scores serviceLevel 1.0.
    const supB = result.supplierMatches.find((m) => m.vendorId === "sup-b");
    expect(supB?.scoreBreakdown.serviceLevel).toBe(1);
  });

  it("an expired offer is a hard-constraint failure — a weight can NEVER rescue it", () => {
    const expired = mustCapture(
      TENANT,
      captureInput({ offerId: "off-exp", supplierId: "sup-a", validFrom: T0 - 30 * DAY, validUntil: T0 - DAY, capturedAt: T0 - 2 * DAY }),
    );
    if (!expired) throw new Error("fixture");
    const fresh = offer({ offerId: "off-fresh", supplierId: "sup-b" });
    const result = compareMarketplaceOffers(demand, [fresh, expired], verifications, { at: T0 });
    if (!result.ok) throw new Error("fixture");
    const expiredRationale = result.rationales.find((r) => r.offerId === "off-exp");
    const freshnessCheck = expiredRationale?.hardConstraints.find((c) => c.constraint === "freshness");
    expect(freshnessCheck?.reasonCode).toBe("OFFER_EXPIRED");
    expect(expiredRationale?.eligible).toBe(false);
    expect(result.ranked.map((r) => r.quoteId)).toEqual(["off-fresh"]);
  });

  it("honest refusals: no offers, duplicates, bad weights, all-ineligible, foreign records (fail-closed)", () => {
    expect(compareMarketplaceOffers(demand, [], verifications, { at: T0 })).toEqual({ ok: false, reasonCode: "NO_OFFERS" });
    const a = offer({ offerId: "off-dup" });
    expect(compareMarketplaceOffers(demand, [a, a], verifications, { at: T0 })).toEqual({
      ok: false,
      reasonCode: "DUPLICATE_OFFER_ID",
    });
    expect(
      compareMarketplaceOffers(demand, [a], verifications, {
        at: T0,
        weights: { priceWeightBps: 4000, termsWeightBps: 3000, capabilityWeightBps: 2000 },
      }),
    ).toEqual({ ok: false, reasonCode: "WEIGHTS_MUST_SUM_TO_10000" });
    const foreignOffer = mustCapture(FOREIGN, captureInput({ offerId: "off-f" }));
    if (!foreignOffer) throw new Error("fixture");
    expect(compareMarketplaceOffers(demand, [foreignOffer], verifications, { at: T0 })).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
    });
    const foreignVerification: SupplierVerificationLike = { supplierId: "sup-x", tenant: FOREIGN, status: "verified", expiresAt: T0 };
    expect(compareMarketplaceOffers(demand, [a], [foreignVerification], { at: T0 })).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
    });
    const unverifiedOnly = offer({ offerId: "off-u", supplierId: "sup-pending" });
    const allIneligible = compareMarketplaceOffers(demand, [unverifiedOnly], verifications, { at: T0 });
    expect(allIneligible.ok).toBe(false);
    if (allIneligible.ok) return;
    expect(allIneligible.reasonCode).toBe("NO_ELIGIBLE_OFFERS");
    expect(allIneligible.rationales?.[0]?.hardConstraints.find((c) => c.constraint === "supplier_verification")?.reasonCode).toBe("SUPPLIER_NOT_VERIFIED");
  });
});
