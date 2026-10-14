/**
 * @fleetos/procurement — F361C §3.4: the marketplace equipment-order
 * lifecycle. Machine tests of the typed transition machine, the manual
 * provider-ack seam (idempotent same-event replay, DIFFERENT duplicate
 * event refused ALREADY_ACKNOWLEDGED, evidence-tenant mismatch refusal),
 * terminality, exact-money drafting, and the fail-closed tenant reads.
 */

import { describe, expect, it } from "vitest";
import {
  draftEquipmentMarketplaceOrder,
  transitionEquipmentMarketplaceOrder,
  acknowledgeProviderOrder,
  findEquipmentMarketplaceOrder,
  buildEquipmentMarketplaceOrderBoard,
  EQUIPMENT_ORDER_ALLOWED,
  type MarketplaceEquipmentOrder,
  type EquipmentOrderDraftInput,
  type ProviderAckInput,
} from "../src/index.js";

const TENANT = { tenantId: "acme" } as const;
const FOREIGN = { tenantId: "globex" } as const;
const T0 = 1_774_000_000_000;

function draftInput(overrides: Partial<EquipmentOrderDraftInput> = {}): EquipmentOrderDraftInput {
  return {
    orderId: "ord-1",
    requestId: "req-1",
    offerId: "off-1",
    supplierId: "sup-1",
    sku: "LT-5540",
    quantity: 5,
    unitCostMinor: 1_200_000,
    totalCostMinor: 6_000_000,
    currency: "GHS",
    ...overrides,
  };
}

function placed(overrides: Partial<MarketplaceEquipmentOrder> = {}): MarketplaceEquipmentOrder {
  const draft = draftEquipmentMarketplaceOrder(TENANT, draftInput());
  if (!draft.ok) throw new Error("fixture: draft refused");
  const placedResult = transitionEquipmentMarketplaceOrder(draft.order, { type: "place", at: T0 });
  if (!placedResult.ok) throw new Error("fixture: place refused");
  return { ...placedResult.order, ...overrides };
}

function acknowledged(overrides: Partial<MarketplaceEquipmentOrder> = {}): MarketplaceEquipmentOrder {
  const ack = acknowledgeProviderOrder(placed(), {
    providerEventId: "prov-evt-1",
    evidence: { evidenceId: "inv-2026-7710", tenantId: "acme" },
    channel: "manual-invoice-reference",
    acknowledgedAt: T0 + 1,
  });
  if (!ack.ok) throw new Error("fixture: ack refused");
  return { ...ack.order, ...overrides };
}

function ackInput(overrides: Partial<ProviderAckInput> = {}): ProviderAckInput {
  return {
    providerEventId: "prov-evt-1",
    evidence: { evidenceId: "inv-2026-7710", tenantId: "acme" },
    channel: "manual-portal-export",
    acknowledgedAt: T0 + 1,
    ...overrides,
  };
}

describe("draftEquipmentMarketplaceOrder — exact money + reference law", () => {
  it("drafts from an approved request + selected offer with the frozen references", () => {
    const result = draftEquipmentMarketplaceOrder(TENANT, draftInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe("draft");
    expect(result.order.requestId).toBe("req-1");
    expect(result.order.offerId).toBe("off-1");
    expect(result.order.totalCostMinor).toBe(6_000_000);
  });

  it("money and reference refusals carry the exact reason codes", () => {
    expect(draftEquipmentMarketplaceOrder(TENANT, draftInput({ orderId: "" }))).toEqual({ ok: false, reasonCode: "ORDER_ID_REQUIRED" });
    expect(draftEquipmentMarketplaceOrder(TENANT, draftInput({ requestId: "" }))).toEqual({ ok: false, reasonCode: "REQUEST_ID_REQUIRED" });
    expect(draftEquipmentMarketplaceOrder(TENANT, draftInput({ offerId: "" }))).toEqual({ ok: false, reasonCode: "OFFER_ID_REQUIRED" });
    expect(draftEquipmentMarketplaceOrder(TENANT, draftInput({ supplierId: "" }))).toEqual({ ok: false, reasonCode: "SUPPLIER_ID_REQUIRED" });
    expect(draftEquipmentMarketplaceOrder(TENANT, draftInput({ quantity: 0 }))).toEqual({ ok: false, reasonCode: "INVALID_QUANTITY" });
    expect(draftEquipmentMarketplaceOrder(TENANT, draftInput({ totalCostMinor: 6_000_001 }))).toEqual({ ok: false, reasonCode: "TOTAL_MISMATCH" });
    expect(draftEquipmentMarketplaceOrder(TENANT, draftInput({ currency: "" }))).toEqual({ ok: false, reasonCode: "CURRENCY_REQUIRED" });
  });
});

describe("THE MANUAL PROVIDER-ACK SEAM — idempotent + duplicate-event-refusing", () => {
  it("records the ack evidence reference and acknowledges the placed order", () => {
    const result = acknowledgeProviderOrder(placed(), ackInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.order.status).toBe("acknowledged");
    expect(result.order.acknowledgement?.providerEventId).toBe("prov-evt-1");
    expect(result.order.acknowledgement?.evidence.evidenceId).toBe("inv-2026-7710");
    expect(result.order.acknowledgement?.channel).toBe("manual-portal-export");
    expect(result.order.acknowledgement?.acknowledgedAt).toBe(T0 + 1);
  });

  it("the SAME provider event replayed is IDEMPOTENT (original evidence wins, no second conclusion)", () => {
    const acked = acknowledged();
    const replay = acknowledgeProviderOrder(acked, ackInput({ acknowledgedAt: T0 + 99 }));
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.duplicate).toBe(true);
    expect(replay.order.acknowledgement?.acknowledgedAt).toBe(T0 + 1);
    expect(replay.order.acknowledgement?.evidence.evidenceId).toBe("inv-2026-7710");
    expect(replay.order.status).toBe("acknowledged");
  });

  it("a DIFFERENT provider event on an acknowledged order REFUSES ALREADY_ACKNOWLEDGED", () => {
    const acked = acknowledged();
    const duplicate = acknowledgeProviderOrder(acked, ackInput({ providerEventId: "prov-evt-OTHER" }));
    expect(duplicate).toEqual({ ok: false, reasonCode: "ALREADY_ACKNOWLEDGED" });
  });

  it("ack validation refusals: event id, evidence reference, evidence tenant, illegal state", () => {
    expect(acknowledgeProviderOrder(placed(), ackInput({ providerEventId: "" }))).toEqual({ ok: false, reasonCode: "PROVIDER_EVENT_ID_REQUIRED" });
    expect(
      acknowledgeProviderOrder(placed(), ackInput({ evidence: { evidenceId: "", tenantId: "acme" } })),
    ).toEqual({ ok: false, reasonCode: "ACK_EVIDENCE_REFERENCE_REQUIRED" });
    expect(
      acknowledgeProviderOrder(placed(), ackInput({ evidence: { evidenceId: "inv-x", tenantId: "globex" } })),
    ).toEqual({ ok: false, reasonCode: "ACK_EVIDENCE_TENANT_MISMATCH" });
    // Only a PLACED order can be acknowledged.
    expect(acknowledgeProviderOrder(acknowledged(), ackInput({ providerEventId: "prov-evt-2" }))).toEqual({
      ok: false,
      reasonCode: "ALREADY_ACKNOWLEDGED",
    });
    expect(acknowledgeProviderOrder(placed({ status: "shipped" }), ackInput())).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
  });
});

describe("transitionEquipmentMarketplaceOrder — the §3.4 machine", () => {
  it("walks the full chain: placed -> acknowledged -> shipped -> received -> accepted", () => {
    let order = acknowledged();
    for (const [command, status] of [
      [{ type: "ship", at: T0 + 2 }, "shipped"],
      [{ type: "receive", at: T0 + 3 }, "received"],
      [{ type: "accept", at: T0 + 4 }, "accepted"],
    ] as const) {
      const result = transitionEquipmentMarketplaceOrder(order, command);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.order.status).toBe(status);
      order = result.order;
    }
    expect(order.acceptedAt).toBe(T0 + 4);
    // ACCEPTED is terminal.
    expect(transitionEquipmentMarketplaceOrder(order, { type: "ship", at: T0 + 5 })).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
  });

  it("the discrepancy branch: received -> discrepancy -> [disputed | returned]", () => {
    const shipped = transitionEquipmentMarketplaceOrder(acknowledged(), { type: "ship", at: T0 + 2 });
    if (!shipped.ok) throw new Error("fixture");
    const received = transitionEquipmentMarketplaceOrder(shipped.order, { type: "receive", at: T0 + 3 });
    if (!received.ok) throw new Error("fixture");
    expect(
      transitionEquipmentMarketplaceOrder(received.order, { type: "record_discrepancy", at: T0 + 4, reason: "" }),
    ).toEqual({ ok: false, reasonCode: "DISCREPANCY_REASON_REQUIRED" });
    const discrepancy = transitionEquipmentMarketplaceOrder(received.order, {
      type: "record_discrepancy",
      at: T0 + 4,
      reason: "3 of 5 units damaged",
    });
    if (!discrepancy.ok) throw new Error("fixture");
    expect(discrepancy.order.status).toBe("discrepancy");
    expect(discrepancy.order.discrepancyReason).toBe("3 of 5 units damaged");
    const disputed = transitionEquipmentMarketplaceOrder(discrepancy.order, { type: "dispute", at: T0 + 5, reason: "" });
    expect(disputed).toEqual({ ok: false, reasonCode: "DISPUTE_REASON_REQUIRED" });
    const returned = transitionEquipmentMarketplaceOrder(discrepancy.order, { type: "return", at: T0 + 5, reason: "  " });
    expect(returned).toEqual({ ok: false, reasonCode: "RETURN_REASON_REQUIRED" });
    const okDispute = transitionEquipmentMarketplaceOrder(discrepancy.order, { type: "dispute", at: T0 + 5, reason: "wrong model" });
    if (!okDispute.ok) throw new Error("fixture");
    expect(okDispute.order.status).toBe("disputed");
    expect(transitionEquipmentMarketplaceOrder(okDispute.order, { type: "return", at: T0 + 6, reason: "x" })).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
  });

  it("illegal transitions refuse (a placed order cannot ship before acknowledgement; a draft cannot ship)", () => {
    expect(transitionEquipmentMarketplaceOrder(placed(), { type: "ship", at: T0 + 2 })).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
    const draft = draftEquipmentMarketplaceOrder(TENANT, draftInput());
    if (!draft.ok) throw new Error("fixture");
    expect(transitionEquipmentMarketplaceOrder(draft.order, { type: "ship", at: T0 })).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
    expect(transitionEquipmentMarketplaceOrder(placed(), { type: "place", at: T0 })).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
  });

  it("the allowed matrix is the frozen law", () => {
    expect(EQUIPMENT_ORDER_ALLOWED.draft).toEqual(["place"]);
    expect(EQUIPMENT_ORDER_ALLOWED.placed).toEqual([]);
    expect(EQUIPMENT_ORDER_ALLOWED.acknowledged).toEqual(["ship"]);
    expect(EQUIPMENT_ORDER_ALLOWED.shipped).toEqual(["receive"]);
    expect([...EQUIPMENT_ORDER_ALLOWED.received].sort()).toEqual(["accept", "record_discrepancy"]);
    expect([...EQUIPMENT_ORDER_ALLOWED.discrepancy].sort()).toEqual(["dispute", "return"]);
    expect(EQUIPMENT_ORDER_ALLOWED.accepted).toEqual([]);
    expect(EQUIPMENT_ORDER_ALLOWED.disputed).toEqual([]);
    expect(EQUIPMENT_ORDER_ALLOWED.returned).toEqual([]);
  });
});

describe("fail-closed reads + the deterministic board", () => {
  it("a foreign tenant never sees another tenant's order", () => {
    const order = acknowledged();
    expect(findEquipmentMarketplaceOrder(TENANT, [order], "ord-1")?.status).toBe("acknowledged");
    expect(findEquipmentMarketplaceOrder(FOREIGN, [order], "ord-1")).toBeNull();
  });

  it("the board counts by status and lists the ack-pending set", () => {
    const waiting = placed({ orderId: "ord-wait" });
    const acked = acknowledged({ orderId: "ord-ack" });
    const board = buildEquipmentMarketplaceOrderBoard(TENANT, [acked, waiting]);
    expect(board.total).toBe(2);
    expect(board.byStatus.placed).toBe(1);
    expect(board.byStatus.acknowledged).toBe(1);
    expect(board.ackPendingOrderIds).toEqual(["ord-wait"]);
    expect(board.orderIds).toEqual(["ord-ack", "ord-wait"]);
    expect(buildEquipmentMarketplaceOrderBoard(FOREIGN, [waiting]).total).toBe(0);
  });
});
