/**
 * @fleetos/procurement — Wave 2 (F220C) operational-truth grade tests:
 * procure-to-receive flow approval gates, idempotent document creation,
 * deterministic quote scoring, order totals reconciliation.
 */
import { describe, expect, it } from "vitest";
import {
  transitionDemandFlow,
  awardQuoteToOrder,
  createDocumentIdempotent,
  computeRequestDigest,
  compareQuotes,
  reconcileOrderTotals,
  type DemandFlowRecord,
  type Quote,
  type IdempotentCreationRegistry,
  type QuoteScoreInput,
  type ScoringWeights,
  type OrderTotals,
  type OrderReceipt,
  type TenantScope,
  type GuardianDecisionRefLike,
  type EvidenceRefLike,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

const AUTH_OK: GuardianDecisionRefLike = {
  decisionId: "gd-1",
  authorized: true,
  reasonCode: "approved-by-guardian",
};
const AUTH_DENIED: GuardianDecisionRefLike = {
  decisionId: "gd-2",
  authorized: false,
  reasonCode: "over-budget",
};
const EVIDENCE: EvidenceRefLike = { evidenceId: "ev-1", tenantId: "acme" };
const EVIDENCE_OTHER_TENANT: EvidenceRefLike = { evidenceId: "ev-2", tenantId: "globex" };

function demandRecord(overrides: Partial<DemandFlowRecord> = {}): DemandFlowRecord {
  return {
    id: { kind: "procurement-demand", value: "demand-1" },
    tenant: TENANT,
    needId: { kind: "need", value: "need-1" },
    quantity: 10,
    requiredBy: 5_000_000,
    capabilityTags: ["diagnostics"],
    status: "draft",
    solicitationAuthorization: null,
    solicitationEvidence: null,
    awardAuthorization: null,
    awardEvidence: null,
    ...overrides,
  };
}

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: { kind: "quote", value: "quote-1" },
    tenant: TENANT,
    demandId: { kind: "procurement-demand", value: "demand-1" },
    vendorId: "v-alpha",
    unitCost: 100,
    totalCost: 1000,
    status: "submitted",
    submittedAt: "2026-10-01T00:00:00Z",
    expiresAt: "2026-11-01T00:00:00Z",
    supersedes: null,
    superseded: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Demand flow: Need → Demand → Quote → Order with approval gates.
// ---------------------------------------------------------------------------

describe("transitionDemandFlow — the full legal spine", () => {
  it("draft → solicited → awarded → closed with gates satisfied", () => {
    const solicited = transitionDemandFlow(demandRecord(), {
      type: "solicit",
      authorization: AUTH_OK,
      evidence: EVIDENCE,
    });
    expect(solicited.ok).toBe(true);
    if (solicited.ok) {
      expect(solicited.next.status).toBe("solicited");
      expect(solicited.next.solicitationAuthorization?.decisionId).toBe("gd-1");
      expect(solicited.next.solicitationEvidence?.evidenceId).toBe("ev-1");
      const awarded = transitionDemandFlow(solicited.next, {
        type: "award",
        authorization: AUTH_OK,
        evidence: EVIDENCE,
      });
      expect(awarded.ok).toBe(true);
      if (awarded.ok) {
        expect(awarded.next.status).toBe("awarded");
        const closed = transitionDemandFlow(awarded.next, { type: "close" });
        expect(closed.ok).toBe(true);
        if (closed.ok) expect(closed.next.status).toBe("closed");
      }
    }
  });

  it("transitions never mutate the input record", () => {
    const input = demandRecord();
    transitionDemandFlow(input, { type: "solicit", authorization: AUTH_OK, evidence: EVIDENCE });
    expect(input.status).toBe("draft");
    expect(input.solicitationAuthorization).toBeNull();
  });
});

describe("transitionDemandFlow — solicitation gate refusals (every code)", () => {
  it("refuses a null authorization with AUTHORIZATION_REQUIRED", () => {
    const result = transitionDemandFlow(demandRecord(), {
      type: "solicit",
      authorization: null as unknown as GuardianDecisionRefLike,
      evidence: EVIDENCE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("AUTHORIZATION_REQUIRED");
  });

  it("refuses authorized=false with AUTHORIZATION_DENIED (never self-authorizes)", () => {
    const result = transitionDemandFlow(demandRecord(), {
      type: "solicit",
      authorization: AUTH_DENIED,
      evidence: EVIDENCE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("AUTHORIZATION_DENIED");
  });

  it("refuses missing evidence with EVIDENCE_REQUIRED", () => {
    const result = transitionDemandFlow(demandRecord(), {
      type: "solicit",
      authorization: AUTH_OK,
      evidence: { evidenceId: "", tenantId: "acme" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("EVIDENCE_REQUIRED");
  });

  it("refuses cross-tenant evidence with EVIDENCE_TENANT_MISMATCH", () => {
    const result = transitionDemandFlow(demandRecord(), {
      type: "solicit",
      authorization: AUTH_OK,
      evidence: EVIDENCE_OTHER_TENANT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("EVIDENCE_TENANT_MISMATCH");
  });

  it("the award gate enforces the same codes (authorization + evidence)", () => {
    const solicited = transitionDemandFlow(demandRecord(), {
      type: "solicit",
      authorization: AUTH_OK,
      evidence: EVIDENCE,
    });
    expect(solicited.ok).toBe(true);
    if (solicited.ok) {
      const denied = transitionDemandFlow(solicited.next, {
        type: "award",
        authorization: AUTH_DENIED,
        evidence: EVIDENCE,
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.reasonCode).toBe("AUTHORIZATION_DENIED");
      const wrongTenant = transitionDemandFlow(solicited.next, {
        type: "award",
        authorization: AUTH_OK,
        evidence: EVIDENCE_OTHER_TENANT,
      });
      expect(wrongTenant.ok).toBe(false);
      if (!wrongTenant.ok) expect(wrongTenant.reasonCode).toBe("EVIDENCE_TENANT_MISMATCH");
    }
  });
});

describe("transitionDemandFlow — illegal transitions", () => {
  const illegalCases: readonly (readonly [
    string,
    Parameters<typeof transitionDemandFlow>[1],
    DemandFlowRecord["status"],
  ])[] = [
    ["award from draft (must solicit first)", { type: "award", authorization: AUTH_OK, evidence: EVIDENCE }, "draft"],
    ["solicit from solicited", { type: "solicit", authorization: AUTH_OK, evidence: EVIDENCE }, "solicited"],
    ["close from draft", { type: "close" }, "draft"],
    ["solicit from closed (terminal)", { type: "solicit", authorization: AUTH_OK, evidence: EVIDENCE }, "closed"],
    ["award from cancelled (terminal)", { type: "award", authorization: AUTH_OK, evidence: EVIDENCE }, "cancelled"],
  ];
  it.each(illegalCases)("refuses %s with ILLEGAL_TRANSITION", (_label, command, status) => {
    const result = transitionDemandFlow(demandRecord({ status }), command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("ILLEGAL_TRANSITION");
  });

  it("refuses cancel without a reason with CANCEL_REASON_REQUIRED", () => {
    const result = transitionDemandFlow(demandRecord(), { type: "cancel", reason: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("CANCEL_REASON_REQUIRED");
  });

  it("refuses a non-positive quantity with NEGATIVE_QUANTITY", () => {
    const result = transitionDemandFlow(
      demandRecord({ quantity: 0 }),
      { type: "solicit", authorization: AUTH_OK, evidence: EVIDENCE },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("NEGATIVE_QUANTITY");
  });
});

// ---------------------------------------------------------------------------
// Quote → Order (award) gate.
// ---------------------------------------------------------------------------

describe("awardQuoteToOrder — the Quote→Order gate", () => {
  it("awards a submitted quote and creates a draft order carrying the authorization", () => {
    const result = awardQuoteToOrder(
      quote(),
      { kind: "order", value: "order-1" },
      AUTH_OK,
      EVIDENCE,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.status).toBe("draft");
      expect(result.order.authorization.decisionId).toBe("gd-1");
      expect(result.order.quoteId.value).toBe("quote-1");
      expect(result.order.fulfillmentVerified).toBe(false);
    }
  });

  it("refuses a superseded quote with QUOTE_SUPERSEDED", () => {
    const result = awardQuoteToOrder(
      quote({ superseded: true }),
      { kind: "order", value: "order-1" },
      AUTH_OK,
      EVIDENCE,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("QUOTE_SUPERSEDED");
  });

  it("refuses non-submitted quotes with ILLEGAL_TRANSITION", () => {
    for (const status of ["draft", "accepted", "rejected", "expired", "withdrawn"] as const) {
      const result = awardQuoteToOrder(quote({ status }), { kind: "order", value: "order-1" }, AUTH_OK, EVIDENCE);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasonCode).toBe("ILLEGAL_TRANSITION");
    }
  });

  it.each([
    ["null authorization", null, EVIDENCE, "AUTHORIZATION_REQUIRED"],
    ["denied authorization", AUTH_DENIED, EVIDENCE, "AUTHORIZATION_DENIED"],
    ["missing evidence", AUTH_OK, null, "EVIDENCE_REQUIRED"],
    ["cross-tenant evidence", AUTH_OK, EVIDENCE_OTHER_TENANT, "EVIDENCE_TENANT_MISMATCH"],
  ])("refuses %s at the award gate", (_label, authorization, evidence, expected) => {
    const result = awardQuoteToOrder(
      quote(),
      { kind: "order", value: "order-1" },
      authorization as GuardianDecisionRefLike | null,
      evidence as EvidenceRefLike | null,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Idempotent document creation.
// ---------------------------------------------------------------------------

describe("createDocumentIdempotent", () => {
  function registry(): IdempotentCreationRegistry {
    return { tenant: TENANT, records: [] };
  }
  const request = {
    requestId: "req-1",
    requestDigest: computeRequestDigest("acme", "quote", "vendor=v-alpha;cost=100"),
    documentKind: "quote" as const,
    documentId: "quote-9",
    createdAt: 1000,
  };

  it("first submission creates the document (duplicate=false)", () => {
    const result = createDocumentIdempotent(registry(), request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.duplicate).toBe(false);
      expect(result.documentId).toBe("quote-9");
    }
  });

  it("re-submitting the SAME request id + digest returns the SAME document id, no double-create", () => {
    const first = createDocumentIdempotent(registry(), request);
    expect(first.ok).toBe(true);
    if (first.ok) {
      const second = createDocumentIdempotent(first.registry, request);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.duplicate).toBe(true);
        expect(second.documentId).toBe(first.documentId);
        expect(second.registry.records.length).toBe(1);
      }
    }
  });

  it("same request id with a DIFFERENT digest is refused with IDEMPOTENCY_KEY_CONFLICT", () => {
    const first = createDocumentIdempotent(registry(), request);
    expect(first.ok).toBe(true);
    if (first.ok) {
      const conflict = createDocumentIdempotent(first.registry, {
        ...request,
        requestDigest: computeRequestDigest("acme", "quote", "vendor=v-beta;cost=200"),
      });
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.reasonCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    }
  });

  it.each([
    ["empty request id", { requestId: "" }, "REQUEST_ID_REQUIRED"],
    ["empty digest", { requestDigest: "" }, "REQUEST_DIGEST_REQUIRED"],
    ["empty document id", { documentId: "" }, "DOCUMENT_ID_REQUIRED"],
  ])("refuses %s", (_label, overrides, expected) => {
    const result = createDocumentIdempotent(registry(), { ...request, ...overrides });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });

  it("computeRequestDigest is stable and content-sensitive", () => {
    expect(computeRequestDigest("acme", "quote", "a")).toBe(computeRequestDigest("acme", "quote", "a"));
    expect(computeRequestDigest("acme", "quote", "a")).not.toBe(computeRequestDigest("acme", "quote", "b"));
  });
});

// ---------------------------------------------------------------------------
// Deterministic quote comparison.
// ---------------------------------------------------------------------------

function scoreInput(overrides: Partial<QuoteScoreInput> = {}): QuoteScoreInput {
  return {
    quoteId: "quote-1",
    vendorId: "v-alpha",
    tenant: TENANT,
    unitCostMinor: 100,
    totalCostMinor: 1000,
    leadTimeDays: 10,
    capabilityTags: ["diagnostics", "repair"],
    submittedAtEpoch: 1_000,
    ...overrides,
  };
}

describe("compareQuotes — deterministic scoring in basis points", () => {
  it("scores the cheapest/shortest/most-capable quote 10000 on each axis", () => {
    const result = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: ["diagnostics", "repair"] },
      [scoreInput()],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const top = result.ranked[0];
      expect(top?.priceScoreBps).toBe(10000);
      expect(top?.termsScoreBps).toBe(10000);
      expect(top?.capabilityScoreBps).toBe(10000);
      expect(top?.totalScoreBps).toBe(10000);
    }
  });

  it("floors partial scores to integers (no floats in decisions)", () => {
    const result = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: [] },
      [scoreInput({ unitCostMinor: 100 }), scoreInput({ quoteId: "q-2", vendorId: "v-b", unitCostMinor: 300, leadTimeDays: 30 })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const pricey = result.ranked.find((r) => r.quoteId === "q-2");
      expect(pricey?.priceScoreBps).toBe(3333); // floor(100*10000/300)
      expect(pricey?.termsScoreBps).toBe(3333); // floor(10*10000/30)
      expect(Number.isInteger(pricey?.totalScoreBps)).toBe(true);
    }
  });

  it("partial capability match scores proportionally in bps", () => {
    const result = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: ["diagnostics", "repair", "calibration"] },
      [scoreInput({ capabilityTags: ["diagnostics"] })],
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ranked[0]?.capabilityScoreBps).toBe(3333);
  });

  it("ranks by total score and records tie-breaks", () => {
    const result = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: [] },
      [
        scoreInput({ quoteId: "q-cheap", vendorId: "v-a", unitCostMinor: 100, totalCostMinor: 1000, leadTimeDays: 10, submittedAtEpoch: 1000 }),
        scoreInput({ quoteId: "q-pricey", vendorId: "v-b", unitCostMinor: 200, totalCostMinor: 2000, leadTimeDays: 10, submittedAtEpoch: 1000 }),
      ],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ranked[0]?.quoteId).toBe("q-cheap");
      expect(result.ranked[0]?.tieBreakRule).toBeNull();
      expect(result.ranked[1]?.quoteId).toBe("q-pricey");
      expect(result.ranked[1]?.priceScoreBps).toBe(5000);
      expect(result.ranked[1]?.tieBreakRule).toBeNull(); // different totals → no tie
    }
  });

  it("an exact total-score tie is broken by lower total cost and the rule is recorded", () => {
    // identical price/terms/capability axes but different totalCostMinor
    const result = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: [] },
      [
        scoreInput({ quoteId: "q-higher-total", vendorId: "v-a", totalCostMinor: 2000 }),
        scoreInput({ quoteId: "q-lower-total", vendorId: "v-b", totalCostMinor: 1500 }),
      ],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ranked[0]?.quoteId).toBe("q-lower-total");
      expect(result.ranked[1]?.tieBreakRule).toBe("lower-total-cost");
    }
  });

  it("deeper ties fall through to lead time, then submission time, then vendor id", () => {
    // Constructed total-score TIE with different lead times:
    // A: unitCost 7 (cheapest, price 10000), lead 20 → terms floor(5*10000/20)=2500
    // B: unitCost 10 → price floor(7*10000/10)=7000, lead 5 (shortest, terms 10000)
    // weights 5000/2000/3000 + capability 10000 → both total 8500.
    // Total costs equal → the tie is resolved by SHORTER LEAD TIME.
    const byLeadTime = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: [] },
      [
        scoreInput({ quoteId: "q-slow", vendorId: "v-a", unitCostMinor: 7, totalCostMinor: 1000, leadTimeDays: 20 }),
        scoreInput({ quoteId: "q-fast", vendorId: "v-b", unitCostMinor: 10, totalCostMinor: 1000, leadTimeDays: 5 }),
      ],
    );
    expect(byLeadTime.ok).toBe(true);
    if (byLeadTime.ok) {
      expect(byLeadTime.ranked[0]?.totalScoreBps).toBe(byLeadTime.ranked[1]?.totalScoreBps);
      expect(byLeadTime.ranked[0]?.quoteId).toBe("q-fast");
      expect(byLeadTime.ranked[1]?.tieBreakRule).toBe("shorter-lead-time");
    }
    // tie on total score, total cost, lead time → earlier submission wins
    const bySubmission = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: [] },
      [
        scoreInput({ quoteId: "q-late", vendorId: "v-a", submittedAtEpoch: 2000 }),
        scoreInput({ quoteId: "q-early", vendorId: "v-b", submittedAtEpoch: 500 }),
      ],
    );
    expect(bySubmission.ok).toBe(true);
    if (bySubmission.ok) {
      expect(bySubmission.ranked[0]?.quoteId).toBe("q-early");
      expect(bySubmission.ranked[1]?.tieBreakRule).toBe("earlier-submission");
    }
    // full tie → vendor id lexical
    const byVendor = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: [] },
      [
        scoreInput({ quoteId: "q-1", vendorId: "v-zulu" }),
        scoreInput({ quoteId: "q-2", vendorId: "v-alpha" }),
      ],
    );
    expect(byVendor.ok).toBe(true);
    if (byVendor.ok) {
      expect(byVendor.ranked[0]?.vendorId).toBe("v-alpha");
      expect(byVendor.ranked[1]?.tieBreakRule).toBe("vendor-id-lexical");
    }
  });

  const comparisonRefusals: readonly (readonly [
    string,
    { readonly quotes?: readonly QuoteScoreInput[]; readonly weights?: ScoringWeights },
    string,
  ])[] = [
    ["no quotes", { quotes: [] }, "NO_QUOTES"],
    [
      "weights not summing to 10000",
      { weights: { priceWeightBps: 5000, termsWeightBps: 2000, capabilityWeightBps: 2000 } },
      "WEIGHTS_MUST_SUM_TO_10000",
    ],
    ["invalid unit cost", { quotes: [scoreInput({ unitCostMinor: 0 })] }, "INVALID_UNIT_COST"],
    ["negative lead time", { quotes: [scoreInput({ leadTimeDays: -1 })] }, "INVALID_LEAD_TIME"],
    [
      "cross-tenant quote",
      { quotes: [scoreInput({ tenant: OTHER_TENANT })] },
      "TENANT_MISMATCH",
    ],
  ];
  it.each(comparisonRefusals)("refuses %s", (_label, overrides, expected) => {
    const result = compareQuotes(
      { tenant: TENANT, requiredCapabilityTags: [] },
      overrides.quotes ?? [scoreInput()],
      overrides.weights,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });

  it("is deterministic: identical inputs produce identical rankings", () => {
    const quotes = [
      scoreInput({ quoteId: "q-1", vendorId: "v-a", unitCostMinor: 120 }),
      scoreInput({ quoteId: "q-2", vendorId: "v-b", unitCostMinor: 90 }),
      scoreInput({ quoteId: "q-3", vendorId: "v-c", unitCostMinor: 150, leadTimeDays: 3 }),
    ];
    const a = compareQuotes({ tenant: TENANT, requiredCapabilityTags: [] }, quotes);
    const b = compareQuotes({ tenant: TENANT, requiredCapabilityTags: [] }, [...quotes].reverse());
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Order totals reconciliation.
// ---------------------------------------------------------------------------

describe("reconcileOrderTotals — received vs ordered", () => {
  function order(overrides: Partial<OrderTotals> = {}): OrderTotals {
    return {
      orderId: "order-1",
      tenant: TENANT,
      orderedQuantity: 100,
      unitCostMinor: 250,
      ...overrides,
    };
  }
  function receipt(overrides: Partial<OrderReceipt> = {}): OrderReceipt {
    return {
      orderId: "order-1",
      tenant: TENANT,
      receivedQuantity: 100,
      receivedAt: 5000,
      ...overrides,
    };
  }

  it("classifies an exact delivery", () => {
    const result = reconcileOrderTotals(order(), [receipt()]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reconciliation.classification).toBe("exact");
      expect(result.reconciliation.varianceQuantity).toBe(0);
      expect(result.reconciliation.varianceBps).toBe(0);
    }
  });

  it("classifies a short delivery with integer bps magnitude", () => {
    const result = reconcileOrderTotals(order(), [receipt({ receivedQuantity: 97 })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reconciliation.classification).toBe("short");
      expect(result.reconciliation.varianceQuantity).toBe(-3);
      expect(result.reconciliation.varianceBps).toBe(300);
    }
  });

  it("classifies an over-delivery", () => {
    const result = reconcileOrderTotals(order(), [receipt({ receivedQuantity: 105 })]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reconciliation.classification).toBe("over");
      expect(result.reconciliation.varianceBps).toBe(500);
    }
  });

  it("sums multiple receipts before comparing", () => {
    const result = reconcileOrderTotals(order(), [
      receipt({ receivedQuantity: 40 }),
      receipt({ receivedQuantity: 35 }),
      receipt({ receivedQuantity: 25 }),
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reconciliation.receivedQuantity).toBe(100);
      expect(result.reconciliation.receiptCount).toBe(3);
      expect(result.reconciliation.classification).toBe("exact");
    }
  });

  it("floors non-integer bps deterministically", () => {
    const result = reconcileOrderTotals(order({ orderedQuantity: 3 }), [receipt({ receivedQuantity: 2 })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reconciliation.varianceBps).toBe(3333);
  });

  const reconciliationRefusals: readonly (readonly [
    string,
    { readonly receipts?: readonly OrderReceipt[]; readonly order?: OrderTotals },
    string,
  ])[] = [
    [
      "cross-tenant receipt",
      { receipts: [receipt({ tenant: OTHER_TENANT })] },
      "TENANT_MISMATCH",
    ],
    [
      "receipt for another order",
      { receipts: [receipt({ orderId: "order-2" })] },
      "RECEIPT_ORDER_MISMATCH",
    ],
    [
      "negative received quantity",
      { receipts: [receipt({ receivedQuantity: -1 })] },
      "NEGATIVE_QUANTITY",
    ],
    [
      "non-positive ordered quantity",
      { receipts: [], order: order({ orderedQuantity: 0 }) },
      "NEGATIVE_QUANTITY",
    ],
  ];
  it.each(reconciliationRefusals)("refuses %s", (_label, overrides, expected) => {
    const result = reconcileOrderTotals(
      overrides.order ?? order(),
      overrides.receipts ?? [],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe(expected);
  });

  it("is deterministic", () => {
    const receipts = [receipt({ receivedQuantity: 10 }), receipt({ receivedQuantity: 90 })];
    expect(reconcileOrderTotals(order(), receipts)).toEqual(reconcileOrderTotals(order(), [...receipts].reverse()));
  });
});
