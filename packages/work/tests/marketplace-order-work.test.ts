/**
 * @fleetos/work — F361C §3.4 (the work share): the marketplace
 * order→work link. Machine tests of the link gate (one live link per
 * order, non-terminal same-tenant work items), the detach discipline,
 * the service-completion ACCEPT gate (an order whose repair-service
 * work is not done refuses WORK_NOT_COMPLETED), and the deterministic
 * board projection.
 */

import { describe, expect, it } from "vitest";
import {
  linkMarketplaceOrderWork,
  detachMarketplaceOrderWork,
  serviceWorkAcceptanceGate,
  buildMarketplaceOrderWorkBoard,
  type MarketplaceOrderWorkLink,
  type WorkItem,
} from "../src/index.js";

const TENANT = { tenantId: "acme" } as const;
const FOREIGN = { tenantId: "globex" } as const;
const T0 = 1_774_000_000_000;

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: { kind: "work-item", value: "wi-repair-1" },
    tenant: TENANT,
    title: "Repair printer PR-3300 (marketplace order ord-1)",
    assignee: null,
    assignmentHistory: [],
    deadline: null,
    status: "todo",
    blockedReason: null,
    missionRef: null,
    workflowRef: null,
    projectId: null,
    ...overrides,
  };
}

describe("linkMarketplaceOrderWork — the link gate", () => {
  it("links a marketplace order to a REAL non-terminal work item", () => {
    const result = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-1", workItemId: "wi-repair-1", kind: "repair-service", at: T0 },
      workItem(),
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.link.status).toBe("linked");
    expect(result.link.kind).toBe("repair-service");
    expect(result.link.order.orderId).toBe("ord-1");
    expect(result.link.tenant.tenantId).toBe("acme");
    expect(result.link.linkedAt).toBe(T0);
  });

  it("one LIVE link per order: a second link refuses ORDER_ALREADY_LINKED", () => {
    const first = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-1", workItemId: "wi-repair-1", kind: "repair-service", at: T0 },
      workItem(),
      [],
    );
    if (!first.ok) throw new Error("fixture");
    const second = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-1", workItemId: "wi-repair-2", kind: "repair-service", at: T0 + 1 },
      workItem({ id: { kind: "work-item", value: "wi-repair-2" } }),
      [first.link],
    );
    expect(second).toEqual({ ok: false, reasonCode: "ORDER_ALREADY_LINKED" });
    // A DETACHED link frees the order for relinking.
    const detached = detachMarketplaceOrderWork(first.link, "relinked to a new job", T0 + 2);
    if (!detached.ok) throw new Error("fixture");
    const relink = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-1", workItemId: "wi-repair-2", kind: "repair-service", at: T0 + 3 },
      workItem({ id: { kind: "work-item", value: "wi-repair-2" } }),
      [detached.link],
    );
    expect(relink.ok).toBe(true);
  });

  it("terminal work items and cross-tenant inputs refuse (fail-closed)", () => {
    expect(
      linkMarketplaceOrderWork(
        TENANT,
        { orderId: "ord-1", workItemId: "wi-done", kind: "repair-service", at: T0 },
        workItem({ id: { kind: "work-item", value: "wi-done" }, status: "done" }),
        [],
      ),
    ).toEqual({ ok: false, reasonCode: "WORK_ITEM_TERMINAL" });
    expect(
      linkMarketplaceOrderWork(
        TENANT,
        { orderId: "ord-1", workItemId: "wi-f", kind: "repair-service", at: T0 },
        workItem({ id: { kind: "work-item", value: "wi-f" }, tenant: FOREIGN }),
        [],
      ),
    ).toEqual({ ok: false, reasonCode: "WORK_ITEM_TENANT_MISMATCH" });
    expect(
      linkMarketplaceOrderWork(TENANT, { orderId: "", workItemId: "wi-1", kind: "repair-service", at: T0 }, workItem(), []),
    ).toEqual({ ok: false, reasonCode: "ORDER_ID_REQUIRED" });
    const foreignLink: MarketplaceOrderWorkLink = {
      order: { orderId: "ord-f", tenant: FOREIGN },
      workItemId: "wi-f",
      tenant: FOREIGN,
      kind: "repair-service",
      status: "linked",
      linkedAt: T0,
      detachedAt: null,
      detachReason: null,
    };
    expect(
      linkMarketplaceOrderWork(
        TENANT,
        { orderId: "ord-1", workItemId: "wi-repair-1", kind: "repair-service", at: T0 },
        workItem(),
        [foreignLink],
      ),
    ).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("detaching requires a reason", () => {
    const linked = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-1", workItemId: "wi-repair-1", kind: "repair-service", at: T0 },
      workItem(),
      [],
    );
    if (!linked.ok) throw new Error("fixture");
    expect(detachMarketplaceOrderWork(linked.link, "  ", T0 + 1)).toEqual({
      ok: false,
      reasonCode: "DETACH_REASON_REQUIRED",
    });
    const detached = detachMarketplaceOrderWork(linked.link, "job superseded", T0 + 1);
    if (!detached.ok) throw new Error("fixture");
    expect(detached.link.status).toBe("detached");
    expect(detached.link.detachReason).toBe("job superseded");
    expect(detachMarketplaceOrderWork(detached.link, "again", T0 + 2)).toEqual({
      ok: false,
      reasonCode: "NOT_LINKED",
    });
  });
});

describe("serviceWorkAcceptanceGate — the §3.4 accept composition", () => {
  it("refuses WORK_NOT_COMPLETED until the linked service work is done", () => {
    const linked = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-1", workItemId: "wi-repair-1", kind: "repair-service", at: T0 },
      workItem(),
      [],
    );
    if (!linked.ok) throw new Error("fixture");
    const blocked = serviceWorkAcceptanceGate(linked.link, workItem({ status: "in_progress" }));
    expect(blocked).toEqual({ ok: false, reasonCode: "WORK_NOT_COMPLETED" });
    const todo = serviceWorkAcceptanceGate(linked.link, workItem({ status: "todo" }));
    expect(todo).toEqual({ ok: false, reasonCode: "WORK_NOT_COMPLETED" });
    const open = serviceWorkAcceptanceGate(linked.link, workItem({ status: "done" }));
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.workItemId).toBe("wi-repair-1");
  });

  it("a detached link or a foreign work item refuses (fail-closed)", () => {
    const linked = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-1", workItemId: "wi-repair-1", kind: "repair-service", at: T0 },
      workItem(),
      [],
    );
    if (!linked.ok) throw new Error("fixture");
    const detached = detachMarketplaceOrderWork(linked.link, "superseded", T0 + 1);
    if (!detached.ok) throw new Error("fixture");
    expect(serviceWorkAcceptanceGate(detached.link, workItem({ status: "done" }))).toEqual({
      ok: false,
      reasonCode: "WORK_LINK_NOT_LIVE",
    });
    expect(
      serviceWorkAcceptanceGate(linked.link, workItem({ status: "done", tenant: FOREIGN })),
    ).toEqual({ ok: false, reasonCode: "WORK_ITEM_TENANT_MISMATCH" });
  });
});

describe("buildMarketplaceOrderWorkBoard — the deterministic projection", () => {
  it("carries the work status, terminal classification and the accept-gate verdict", () => {
    // Links open while the work is ACTIVE; the work completes AFTER linking.
    const repair = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-1", workItemId: "wi-repair-1", kind: "repair-service", at: T0 },
      workItem({ status: "in_progress" }),
      [],
    );
    const delivery = linkMarketplaceOrderWork(
      TENANT,
      { orderId: "ord-2", workItemId: "wi-delivery-2", kind: "purchase-delivery", at: T0 },
      workItem({ id: { kind: "work-item", value: "wi-delivery-2" }, status: "todo" }),
      [],
    );
    if (!repair.ok || !delivery.ok) throw new Error("fixture");
    // The board reads the CURRENT work state: the delivery job is now done.
    const board = buildMarketplaceOrderWorkBoard(TENANT, [delivery.link, repair.link], [
      workItem({ status: "in_progress" }),
      workItem({ id: { kind: "work-item", value: "wi-delivery-2" }, status: "done" }),
    ]);
    expect(board.ok).toBe(true);
    if (!board.ok) return;
    expect(board.linkCount).toBe(2);
    expect(board.entries.map((e) => `${e.orderId}:${e.workStatus}:${e.acceptGateOpen}`)).toEqual([
      "ord-1:in_progress:false",
      "ord-2:done:true",
    ]);
    expect(board.entries[0]?.workTerminal).toBe(false);
    expect(board.entries[1]?.workTerminal).toBe(true);
  });

  it("a foreign-tenant link refuses the whole board (fail-closed)", () => {
    const foreignLink: MarketplaceOrderWorkLink = {
      order: { orderId: "ord-f", tenant: FOREIGN },
      workItemId: "wi-f",
      tenant: FOREIGN,
      kind: "repair-service",
      status: "linked",
      linkedAt: T0,
      detachedAt: null,
      detachReason: null,
    };
    expect(buildMarketplaceOrderWorkBoard(TENANT, [foreignLink], [])).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
    });
  });
});
