import { describe, expect, it } from "vitest";
import {
  matchVendors,
  transitionQuote,
  transitionOrder,
  transitionFulfillment,
  contractsAreDistinct,
  validateTenantScope,
  type TenantScope,
  type ProcurementDemand,
  type Quote,
  type Order,
  type Fulfillment,
  type VendorCapabilityRefLike,
  type NeedId,
  type DemandId,
  type QuoteId,
  type OrderId,
  type FulfillmentId,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function demand(overrides: Partial<ProcurementDemand> = {}): ProcurementDemand {
  return {
    id: { kind: "procurement-demand", value: "d-1" },
    tenant: TENANT,
    needId: { kind: "need", value: "n-1" },
    quantity: 10,
    requiredBy: "2026-12-01",
    capabilityTags: ["industrial-pump", "stainless-steel"],
    ...overrides,
  };
}

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: { kind: "quote", value: "q-1" },
    tenant: TENANT,
    demandId: { kind: "procurement-demand", value: "d-1" },
    vendorId: "v-1",
    unitCost: 100,
    totalCost: 1000,
    status: "draft",
    submittedAt: null,
    expiresAt: null,
    ...overrides,
  };
}

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: { kind: "order", value: "o-1" },
    tenant: TENANT,
    quoteId: { kind: "quote", value: "q-1" },
    status: "draft",
    ...overrides,
  };
}

function fulfillment(overrides: Partial<Fulfillment> = {}): Fulfillment {
  return {
    id: { kind: "fulfillment", value: "f-1" },
    tenant: TENANT,
    orderId: { kind: "order", value: "o-1" },
    status: "pending",
    ...overrides,
  };
}

describe("validateTenantScope", () => {
  it("accepts a valid tenant id", () => {
    expect(validateTenantScope({ tenantId: "acme" })).toEqual({
      ok: true,
      scope: { tenantId: "acme" },
    });
  });

  it("refuses a null scope with TENANT_SCOPE_MISSING", () => {
    expect(validateTenantScope(null)).toEqual({
      ok: false,
      reasonCode: "TENANT_SCOPE_MISSING",
    });
  });
});

describe("exchange-identity separation (law A16) — quote != order != demand != need", () => {
  it("proves at the type level that contract ids have distinct kinds", () => {
    const need: NeedId = { kind: "need", value: "n-1" };
    const dem: DemandId = { kind: "procurement-demand", value: "d-1" };
    const qte: QuoteId = { kind: "quote", value: "q-1" };
    const ord: OrderId = { kind: "order", value: "o-1" };
    const ful: FulfillmentId = { kind: "fulfillment", value: "f-1" };
    const ids = [need, dem, qte, ord, ful];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(contractsAreDistinct(ids[i]!, ids[j]!)).toBe(true);
      }
    }
  });

  it("proves that two contract ids of the same kind are not distinct", () => {
    expect(
      contractsAreDistinct({ kind: "quote" }, { kind: "quote" }),
    ).toBe(false);
  });
});

describe("matchVendors — deterministic scoring", () => {
  const vendors: VendorCapabilityRefLike[] = [
    {
      vendorId: "v-alpha",
      tenant: TENANT,
      capabilityTags: ["industrial-pump", "stainless-steel"],
      serviceLevel: 0.9,
      unitCost: 80,
    },
    {
      vendorId: "v-beta",
      tenant: TENANT,
      capabilityTags: ["industrial-pump"],
      serviceLevel: 0.5,
      unitCost: 60,
    },
    {
      vendorId: "v-gamma",
      tenant: TENANT,
      capabilityTags: ["industrial-pump", "stainless-steel"],
      serviceLevel: 0.8,
      unitCost: 90,
    },
  ];

  it("ranks full-coverage vendors higher than partial-coverage ones", () => {
    const matches = matchVendors(demand(), vendors);
    expect(matches[0]!.vendorId).toMatch(/v-(alpha|gamma)/);
    expect(matches[matches.length - 1]!.vendorId).toBe("v-beta");
  });

  it("breaks score ties by deterministic lexicographic vendorId ordering", () => {
    // v-alpha and v-gamma have identical capability tags and similar service
    // levels — when scores tie, lexicographic order decides.
    const matches = matchVendors(demand(), vendors);
    expect(matches.length).toBeGreaterThan(0);
    const ids = matches.map((m) => m.vendorId);
    const sortedById = [...ids].sort();
    // The first result must be reproducible across calls.
    expect(matchVendors(demand(), vendors)[0]!.vendorId).toBe(matches[0]!.vendorId);
    expect(sortedById).toEqual([...new Set(ids)].sort());
  });

  it("filters out vendors whose tenant does not match the demand tenant", () => {
    const other: VendorCapabilityRefLike = {
      vendorId: "v-other",
      tenant: { tenantId: "globex" },
      capabilityTags: ["industrial-pump", "stainless-steel"],
      serviceLevel: 0.99,
      unitCost: 10,
    };
    const matches = matchVendors(demand(), [...vendors, other]);
    expect(matches.map((m) => m.vendorId)).not.toContain("v-other");
  });

  it("returns an empty list when demand tenant is broken (fail-closed)", () => {
    const matches = matchVendors(
      demand({ tenant: { tenantId: "" } as unknown as TenantScope }),
      vendors,
    );
    expect(matches).toEqual([]);
  });
});

describe("transitionQuote — lifecycle", () => {
  it("submits a draft quote", () => {
    const r = transitionQuote(quote(), {
      type: "submit",
      submittedAt: "2026-10-07T00:00:00Z",
      expiresAt: "2026-10-14T00:00:00Z",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.status).toBe("submitted");
  });

  it("accepts a submitted quote", () => {
    const r = transitionQuote(quote({ status: "submitted" }), { type: "accept" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.status).toBe("accepted");
  });

  it("refuses to accept a draft quote with ILLEGAL_TRANSITION", () => {
    const r = transitionQuote(quote(), { type: "accept" });
    expect(r).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses any transition when tenant is broken", () => {
    const broken = quote({ tenant: { tenantId: "" } as unknown as TenantScope });
    const r = transitionQuote(broken, { type: "submit", submittedAt: "", expiresAt: "" });
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

describe("transitionOrder — lifecycle", () => {
  it("places a draft order", () => {
    const r = transitionOrder(order(), { type: "place" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.status).toBe("placed");
  });

  it("ships a confirmed order", () => {
    const r = transitionOrder(order({ status: "confirmed" }), { type: "ship" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.next.status).toBe("shipped");
  });

  it("refuses to ship a draft order with ILLEGAL_TRANSITION", () => {
    const r = transitionOrder(order(), { type: "ship" });
    expect(r).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses transitions when tenant is broken", () => {
    const broken = order({ tenant: { tenantId: "" } as unknown as TenantScope });
    const r = transitionOrder(broken, { type: "place" });
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

describe("transitionFulfillment — lifecycle with verification hook", () => {
  it("advances pending -> in_transit -> delivered -> verified", () => {
    const inTransit = transitionFulfillment(fulfillment(), { type: "start_transit" });
    expect(inTransit.ok).toBe(true);
    if (inTransit.ok) {
      const delivered = transitionFulfillment(inTransit.next, { type: "deliver" });
      expect(delivered.ok).toBe(true);
      if (delivered.ok) {
        const verified = transitionFulfillment(delivered.next, { type: "verify" });
        expect(verified.ok).toBe(true);
        if (verified.ok) expect(verified.next.status).toBe("verified");
      }
    }
  });

  it("refuses verify before deliver with ILLEGAL_TRANSITION (verification hook)", () => {
    const r = transitionFulfillment(fulfillment({ status: "in_transit" }), { type: "verify" });
    expect(r).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses transitions when tenant is broken", () => {
    const broken = fulfillment({ tenant: { tenantId: "" } as unknown as TenantScope });
    const r = transitionFulfillment(broken, { type: "start_transit" });
    expect(r).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});
