/**
 * @fleetos/procurement — Wave 1 kernel-grade tests.
 *
 * Coverage themes:
 *   - quote lifecycle with SUPERSESSION discipline;
 *   - order lifecycle with Guardian authorization seam (no self-auth);
 *   - fulfillment verification hooks;
 *   - matching engine with tie-break rules recorded;
 *   - tenant fail-closed;
 *   - determinism.
 */
import { describe, expect, it } from "vitest";
import {
  transitionQuote,
  supersedeQuote,
  createOrder,
  transitionOrder,
  transitionFulfillment,
  matchVendors,
  contractsAreDistinct,
  createProcurementDirectory,
  createInMemoryProcurementRepository,
  type Quote,
  type Order,
  type Fulfillment,
  type ProcurementDemand,
  type TenantScope,
  type GuardianDecisionRefLike,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const AUTH: GuardianDecisionRefLike = {
  decisionId: "d-1",
  authorized: true,
  reasonCode: "allow.matched_rule",
};

function baseQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: { kind: "quote", value: "q-1" },
    tenant: TENANT,
    demandId: { kind: "procurement-demand", value: "dem-1" },
    vendorId: "v-1",
    unitCost: 10,
    totalCost: 100,
    status: "draft",
    submittedAt: null,
    expiresAt: null,
    supersedes: null,
    superseded: false,
    ...overrides,
  };
}

function baseOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: { kind: "order", value: "o-1" },
    tenant: TENANT,
    quoteId: { kind: "quote", value: "q-1" },
    status: "draft",
    authorization: AUTH,
    fulfillmentVerified: false,
    ...overrides,
  };
}

function baseFulfillment(overrides: Partial<Fulfillment> = {}): Fulfillment {
  return {
    id: { kind: "fulfillment", value: "f-1" },
    tenant: TENANT,
    orderId: { kind: "order", value: "o-1" },
    status: "pending",
    verificationEvidence: null,
    ...overrides,
  };
}

function baseDemand(overrides: Partial<ProcurementDemand> = {}): ProcurementDemand {
  return {
    id: { kind: "procurement-demand", value: "dem-1" },
    tenant: TENANT,
    needId: { kind: "need", value: "n-1" },
    quantity: 10,
    requiredBy: "2026-01-31T00:00:00Z",
    capabilityTags: ["pump", "industrial"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Quote lifecycle — Wave 0 regression + Wave 1 SUPERSESSION.
// ---------------------------------------------------------------------------

describe("transitionQuote — legal transitions", () => {
  it("draft -> submitted on submit", () => {
    const next = transitionQuote(baseQuote(), {
      type: "submit",
      submittedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-02-01T00:00:00Z",
    });
    expect(next.ok).toBe(true);
    if (next.ok) {
      expect(next.next.status).toBe("submitted");
      expect(next.next.submittedAt).toBe("2026-01-01T00:00:00Z");
    }
  });

  it("submitted -> accepted on accept", () => {
    const next = transitionQuote(baseQuote({ status: "submitted" }), { type: "accept" });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("accepted");
  });

  it("submitted -> rejected on reject", () => {
    const next = transitionQuote(baseQuote({ status: "submitted" }), { type: "reject" });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("rejected");
  });

  it("submitted -> expired on expire", () => {
    const next = transitionQuote(baseQuote({ status: "submitted" }), { type: "expire" });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("expired");
  });

  it("draft -> withdrawn on withdraw (Wave 1)", () => {
    const next = transitionQuote(baseQuote(), { type: "withdraw" });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.next.status).toBe("withdrawn");
  });
});

describe("transitionQuote — illegal transitions refused", () => {
  it("refuses accept from draft with ILLEGAL_TRANSITION", () => {
    const next = transitionQuote(baseQuote(), { type: "accept" });
    expect(next).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses submit from accepted with ILLEGAL_TRANSITION", () => {
    const next = transitionQuote(
      baseQuote({ status: "accepted" }),
      { type: "submit", submittedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-02-01T00:00:00Z" },
    );
    expect(next).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses on broken tenant with TENANT_SCOPE_MISSING", () => {
    const next = transitionQuote(
      baseQuote({ tenant: { tenantId: "" } as unknown as TenantScope }),
      { type: "withdraw" },
    );
    expect(next).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

describe("supersedeQuote — SUPERSESSION discipline", () => {
  it("withdraws the previous quote and creates a new one with supersedes ref", () => {
    const previous = baseQuote({ status: "submitted" });
    const result = supersedeQuote(
      previous,
      { kind: "quote", value: "q-2" },
      TENANT,
      previous.demandId,
      "v-1",
      9,
      90,
      "2026-01-02T00:00:00Z",
      "2026-03-01T00:00:00Z",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Previous quote is withdrawn with superseded=true — NEVER mutated in place.
      expect(result.previousWithdrew.id.value).toBe("q-1");
      expect(result.previousWithdrew.status).toBe("withdrawn");
      expect(result.previousWithdrew.superseded).toBe(true);
      expect(result.previousWithdrew.unitCost).toBe(10); // unchanged
      // New quote carries supersedes ref.
      expect(result.next.id.value).toBe("q-2");
      expect(result.next.status).toBe("submitted");
      expect(result.next.supersedes).toBe("q-1");
      expect(result.next.superseded).toBe(false);
      expect(result.next.unitCost).toBe(9);
    }
  });

  it("refuses to supersede an already-withdrawn quote with ILLEGAL_TRANSITION", () => {
    const previous = baseQuote({ status: "withdrawn" });
    const result = supersedeQuote(
      previous,
      { kind: "quote", value: "q-2" },
      TENANT,
      previous.demandId,
      "v-1",
      9,
      90,
      "2026-01-02T00:00:00Z",
      "2026-03-01T00:00:00Z",
    );
    expect(result).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("preserves the previous quote's submittedAt and expiresAt", () => {
    const previous = baseQuote({
      status: "submitted",
      submittedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-02-01T00:00:00Z",
    });
    const result = supersedeQuote(
      previous,
      { kind: "quote", value: "q-2" },
      TENANT,
      previous.demandId,
      "v-1",
      9,
      90,
      "2026-01-02T00:00:00Z",
      "2026-03-01T00:00:00Z",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previousWithdrew.submittedAt).toBe("2026-01-01T00:00:00Z");
      expect(result.previousWithdrew.expiresAt).toBe("2026-02-01T00:00:00Z");
    }
  });
});

// ---------------------------------------------------------------------------
// Order lifecycle — Guardian authorization seam (law A5).
// ---------------------------------------------------------------------------

describe("createOrder — Guardian authorization seam", () => {
  it("creates an order when the authorization is authorized=true", () => {
    const result = createOrder(
      { kind: "order", value: "o-1" },
      TENANT,
      { kind: "quote", value: "q-1" },
      AUTH,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.status).toBe("draft");
      expect(result.next.authorization.decisionId).toBe("d-1");
      expect(result.next.fulfillmentVerified).toBe(false);
    }
  });

  it("refuses with AUTHORIZATION_DENIED when authorization.authorized is false", () => {
    const result = createOrder(
      { kind: "order", value: "o-1" },
      TENANT,
      { kind: "quote", value: "q-1" },
      { decisionId: "d-2", authorized: false, reasonCode: "block.policy" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "AUTHORIZATION_DENIED" });
  });

  it("refuses with AUTHORIZATION_REQUIRED when authorization is null-like", () => {
    const result = createOrder(
      { kind: "order", value: "o-1" },
      TENANT,
      { kind: "quote", value: "q-1" },
      null as unknown as GuardianDecisionRefLike,
    );
    expect(result).toEqual({ ok: false, reasonCode: "AUTHORIZATION_REQUIRED" });
  });

  it("refuses with TENANT_SCOPE_MISSING on broken tenant", () => {
    const broken = { tenantId: "" } as unknown as TenantScope;
    const result = createOrder(
      { kind: "order", value: "o-1" },
      broken,
      { kind: "quote", value: "q-1" },
      AUTH,
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });
});

describe("transitionOrder — non-create transitions", () => {
  it("draft -> confirmed on confirm", () => {
    const result = transitionOrder(baseOrder(), { type: "confirm" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.status).toBe("confirmed");
  });

  it("confirmed -> shipped on ship", () => {
    const result = transitionOrder(baseOrder({ status: "confirmed" }), { type: "ship" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.status).toBe("shipped");
  });

  it("shipped -> received on receive", () => {
    const result = transitionOrder(baseOrder({ status: "shipped" }), { type: "receive" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.status).toBe("received");
  });

  it("refuses receive from draft with ILLEGAL_TRANSITION", () => {
    const result = transitionOrder(baseOrder(), { type: "receive" });
    expect(result).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("create command re-authorizes a draft order with authorized=true", () => {
    const newAuth: GuardianDecisionRefLike = { decisionId: "d-3", authorized: true, reasonCode: "allow.matched_rule" };
    const result = transitionOrder(baseOrder(), { type: "create", authorization: newAuth });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.authorization.decisionId).toBe("d-3");
  });

  it("create command refuses with AUTHORIZATION_DENIED when authorized=false", () => {
    const result = transitionOrder(
      baseOrder(),
      { type: "create", authorization: { decisionId: "d-3", authorized: false, reasonCode: "block.policy" } },
    );
    expect(result).toEqual({ ok: false, reasonCode: "AUTHORIZATION_DENIED" });
  });
});

// ---------------------------------------------------------------------------
// Fulfillment lifecycle — verification hooks.
// ---------------------------------------------------------------------------

describe("transitionFulfillment — verification hooks", () => {
  it("pending -> in_transit on start_transit", () => {
    const result = transitionFulfillment(baseFulfillment(), { type: "start_transit" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.status).toBe("in_transit");
  });

  it("in_transit -> delivered on deliver", () => {
    const result = transitionFulfillment(
      baseFulfillment({ status: "in_transit" }),
      { type: "deliver" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.next.status).toBe("delivered");
  });

  it("delivered -> verified on verify with evidence", () => {
    const result = transitionFulfillment(
      baseFulfillment({ status: "delivered" }),
      { type: "verify", evidence: { evidenceId: "e-1", tenantId: "acme" } },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.status).toBe("verified");
      expect(result.next.verificationEvidence?.evidenceId).toBe("e-1");
    }
  });

  it("refuses verify without evidence with VERIFICATION_EVIDENCE_REQUIRED", () => {
    const result = transitionFulfillment(
      baseFulfillment({ status: "delivered" }),
      { type: "verify", evidence: null as unknown as { evidenceId: string; tenantId: string } },
    );
    expect(result).toEqual({ ok: false, reasonCode: "VERIFICATION_EVIDENCE_REQUIRED" });
  });

  it("refuses verify with cross-tenant evidence with VERIFICATION_EVIDENCE_TENANT_MISMATCH", () => {
    const result = transitionFulfillment(
      baseFulfillment({ status: "delivered" }),
      { type: "verify", evidence: { evidenceId: "e-1", tenantId: "other" } },
    );
    expect(result).toEqual({ ok: false, reasonCode: "VERIFICATION_EVIDENCE_TENANT_MISMATCH" });
  });

  it("refuses verify from pending with ILLEGAL_TRANSITION", () => {
    const result = transitionFulfillment(
      baseFulfillment(),
      { type: "verify", evidence: { evidenceId: "e-1", tenantId: "acme" } },
    );
    expect(result).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });
});

// ---------------------------------------------------------------------------
// Matching engine — deterministic scoring with tie-break rules recorded.
// ---------------------------------------------------------------------------

describe("matchVendors — deterministic scoring", () => {
  it("returns matches sorted by score desc", () => {
    const demand = baseDemand();
    const vendors = [
      { vendorId: "v-1", tenant: TENANT, capabilityTags: ["pump"], serviceLevel: 0.5, unitCost: 10 },
      { vendorId: "v-2", tenant: TENANT, capabilityTags: ["pump", "industrial"], serviceLevel: 0.9, unitCost: 5 },
    ];
    const matches = matchVendors(demand, vendors);
    expect(matches.length).toBe(2);
    expect(matches[0]?.vendorId).toBe("v-2"); // higher coverage
    expect(matches[0]?.tieBreakRule).toBeNull(); // first match has no predecessor
  });

  it("records the tie-break rule that decided each match's position", () => {
    const demand = baseDemand();
    // Two vendors with identical scores but different coverage.
    const vendors = [
      { vendorId: "v-1", tenant: TENANT, capabilityTags: ["pump", "industrial"], serviceLevel: 0.5, unitCost: 5 },
      { vendorId: "v-2", tenant: TENANT, capabilityTags: ["pump", "industrial"], serviceLevel: 0.5, unitCost: 5 },
    ];
    const matches = matchVendors(demand, vendors);
    expect(matches.length).toBe(2);
    // Same score, same coverage, same service, same cost — fall back to
    // lexicographic_vendor_id.
    expect(matches[1]?.tieBreakRule).toBe("lexicographic_vendor_id");
  });

  it("returns empty for cross-tenant vendors", () => {
    const demand = baseDemand();
    const vendors = [
      { vendorId: "v-1", tenant: { tenantId: "other" }, capabilityTags: ["pump"], serviceLevel: 0.5, unitCost: 10 },
    ];
    const matches = matchVendors(demand, vendors);
    expect(matches).toEqual([]);
  });

  it("skips vendors with no matching tags", () => {
    const demand = baseDemand();
    const vendors = [
      { vendorId: "v-1", tenant: TENANT, capabilityTags: ["unrelated"], serviceLevel: 0.5, unitCost: 10 },
    ];
    const matches = matchVendors(demand, vendors);
    expect(matches).toEqual([]);
  });

  it("exposes score breakdown transparently", () => {
    const demand = baseDemand();
    const vendors = [
      { vendorId: "v-1", tenant: TENANT, capabilityTags: ["pump", "industrial"], serviceLevel: 0.5, unitCost: 10 },
    ];
    const matches = matchVendors(demand, vendors);
    expect(matches[0]?.scoreBreakdown.coverage).toBe(1);
    expect(matches[0]?.scoreBreakdown.serviceLevel).toBe(0.5);
  });

  it("is deterministic — same inputs produce the same output across calls", () => {
    const demand = baseDemand();
    const vendors = [
      { vendorId: "v-1", tenant: TENANT, capabilityTags: ["pump"], serviceLevel: 0.5, unitCost: 10 },
      { vendorId: "v-2", tenant: TENANT, capabilityTags: ["pump", "industrial"], serviceLevel: 0.9, unitCost: 5 },
    ];
    expect(matchVendors(demand, vendors)).toEqual(matchVendors(demand, vendors));
  });
});

// ---------------------------------------------------------------------------
// contractsAreDistinct — runtime proof of law A16.
// ---------------------------------------------------------------------------

describe("contractsAreDistinct — law A16 proof", () => {
  it("returns true for need vs demand", () => {
    expect(contractsAreDistinct({ kind: "need" }, { kind: "procurement-demand" })).toBe(true);
  });

  it("returns true for quote vs order", () => {
    expect(contractsAreDistinct({ kind: "quote" }, { kind: "order" })).toBe(true);
  });

  it("returns false for two of the same kind", () => {
    expect(contractsAreDistinct({ kind: "quote" }, { kind: "quote" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ProcurementDirectory over in-memory repository.
// ---------------------------------------------------------------------------

describe("ProcurementDirectory over InMemoryProcurementRepository", () => {
  it("transitionQuote persists and emits an audit event", async () => {
    const repo = createInMemoryProcurementRepository([baseQuote()]);
    const directory = createProcurementDirectory(repo);
    const result = await directory.transitionQuote(
      TENANT,
      { kind: "quote", value: "q-1" },
      { type: "submit", submittedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-02-01T00:00:00Z" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quote?.status).toBe("submitted");
      expect(result.auditEvents[0]?.kind).toBe("procurement.quote-transitioned");
    }
  });

  it("supersedeQuote persists both quotes and emits an audit event", async () => {
    const repo = createInMemoryProcurementRepository([baseQuote({ status: "submitted" })]);
    const directory = createProcurementDirectory(repo);
    const result = await directory.supersedeQuote(
      TENANT,
      { kind: "quote", value: "q-1" },
      { kind: "quote", value: "q-2" },
      "v-1",
      9,
      90,
      "2026-01-02T00:00:00Z",
      "2026-03-01T00:00:00Z",
      { occurredAt: "2026-01-02T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quote?.id.value).toBe("q-2");
      expect(result.auditEvents[0]?.kind).toBe("procurement.quote-superseded");
    }
    const previous = await directory.getQuote(TENANT, { kind: "quote", value: "q-1" });
    expect(previous?.status).toBe("withdrawn");
    expect(previous?.superseded).toBe(true);
  });

  it("createOrder refuses when the quote is not accepted (law: only accepted quotes can be ordered)", async () => {
    const repo = createInMemoryProcurementRepository([baseQuote({ status: "submitted" })]);
    const directory = createProcurementDirectory(repo);
    const result = await directory.createOrder(
      TENANT,
      { kind: "order", value: "o-1" },
      { kind: "quote", value: "q-1" },
      AUTH,
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("createOrder succeeds when the quote is accepted and authorization is authorized=true", async () => {
    const repo = createInMemoryProcurementRepository([baseQuote({ status: "accepted" })]);
    const directory = createProcurementDirectory(repo);
    const result = await directory.createOrder(
      TENANT,
      { kind: "order", value: "o-1" },
      { kind: "quote", value: "q-1" },
      AUTH,
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order?.status).toBe("draft");
      expect(result.auditEvents[0]?.kind).toBe("procurement.order-created");
      expect(result.auditEvents[0]?.authorizationDecisionId).toBe("d-1");
    }
  });

  it("createOrder refuses with AUTHORIZATION_DENIED when authorization.authorized is false", async () => {
    const repo = createInMemoryProcurementRepository([baseQuote({ status: "accepted" })]);
    const directory = createProcurementDirectory(repo);
    const result = await directory.createOrder(
      TENANT,
      { kind: "order", value: "o-1" },
      { kind: "quote", value: "q-1" },
      { decisionId: "d-2", authorized: false, reasonCode: "block.policy" },
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result).toEqual({ ok: false, reasonCode: "AUTHORIZATION_DENIED" });
  });

  it("matchVendors returns matches and emits an audit event", async () => {
    const repo = createInMemoryProcurementRepository();
    const directory = createProcurementDirectory(repo);
    const demand = baseDemand();
    const result = await directory.matchVendors(
      TENANT,
      demand,
      [
        { vendorId: "v-1", tenant: TENANT, capabilityTags: ["pump", "industrial"], serviceLevel: 0.5, unitCost: 10 },
      ],
      { occurredAt: "2026-01-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches?.length).toBe(1);
      expect(result.auditEvents[0]?.kind).toBe("procurement.match-computed");
      expect(result.auditEvents[0]?.matchCount).toBe(1);
    }
  });

  it("getQuote returns null for cross-tenant (fail-closed)", async () => {
    const repo = createInMemoryProcurementRepository([baseQuote()]);
    const directory = createProcurementDirectory(repo);
    const item = await directory.getQuote({ tenantId: "other" }, { kind: "quote", value: "q-1" });
    expect(item).toBeNull();
  });

  it("getOrder returns null for cross-tenant (fail-closed)", async () => {
    const repo = createInMemoryProcurementRepository(
      [],
      [baseOrder()],
    );
    const directory = createProcurementDirectory(repo);
    const item = await directory.getOrder({ tenantId: "other" }, { kind: "order", value: "o-1" });
    expect(item).toBeNull();
  });
});
