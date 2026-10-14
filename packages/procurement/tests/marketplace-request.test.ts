/**
 * @fleetos/procurement — F361C §3.1: the marketplace equipment-request
 * state machine. Machine tests of the typed transitions, reason codes,
 * illegal-transition refusals, terminality, the idempotent create/submit
 * discipline keyed tenant+natural-key, and the fail-closed tenant reads.
 */

import { describe, expect, it } from "vitest";
import {
  submitEquipmentRequest,
  transitionEquipmentRequest,
  findEquipmentRequest,
  buildEquipmentRequestBoard,
  EQUIPMENT_REQUEST_ALLOWED,
  type EquipmentRequest,
  type EquipmentRequestCommand,
  type EquipmentRequestSubmitInput,
} from "../src/index.js";

const TENANT = { tenantId: "acme" } as const;
const FOREIGN = { tenantId: "globex" } as const;
const T0 = 1_774_000_000_000;

function submitted(overrides: Partial<EquipmentRequest> = {}): EquipmentRequest {
  const result = submitEquipmentRequest(
    TENANT,
    {
      requestId: "req-1",
      naturalKey: "site-accra-hq:lt-5540:2026-q4",
      sku: "LT-5540",
      quantity: 5,
      requiredBy: "2026-12-01",
      at: T0,
    },
    [],
  );
  if (!result.ok || result.duplicate) throw new Error("fixture: submit refused");
  return { ...result.request, ...overrides };
}

describe("submitEquipmentRequest — idempotent create/submit (tenant + natural key)", () => {
  it("creates and submits the request with one transition event", () => {
    const result = submitEquipmentRequest(
      TENANT,
      {
        requestId: "req-1",
        naturalKey: "nk-1",
        sku: "LT-5540",
        quantity: 5,
        requiredBy: "2026-12-01",
        at: T0,
      },
      [],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.request.status).toBe("submitted");
    expect(result.request.submittedAt).toBe(T0);
    expect(result.event?.fromStatus).toBe("draft");
    expect(result.event?.toStatus).toBe("submitted");
  });

  it("a replay with identical content returns the ORIGINAL with duplicate=true (even with a different requestId)", () => {
    const first = submitEquipmentRequest(
      TENANT,
      { requestId: "req-1", naturalKey: "nk-1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-01", at: T0 },
      [],
    );
    if (!first.ok) throw new Error("fixture");
    // The original advances to `resolving` before the replay arrives.
    const resolving = transitionEquipmentRequest(first.request, { type: "resolve", at: T0 + 1 });
    if (!resolving.ok) throw new Error("fixture");
    const replay = submitEquipmentRequest(
      TENANT,
      { requestId: "req-999", naturalKey: "nk-1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-01", at: T0 + 2 },
      [resolving.next],
    );
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.duplicate).toBe(true);
    expect(replay.request.requestId).toBe("req-1");
    expect(replay.request.status).toBe("resolving");
    expect(replay.event).toBeNull();
  });

  it("the same natural key with DIFFERENT content refuses NATURAL_KEY_CONFLICT", () => {
    const first = submitEquipmentRequest(
      TENANT,
      { requestId: "req-1", naturalKey: "nk-1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-01", at: T0 },
      [],
    );
    if (!first.ok) throw new Error("fixture");
    const conflict = submitEquipmentRequest(
      TENANT,
      { requestId: "req-2", naturalKey: "nk-1", sku: "LT-5540", quantity: 9, requiredBy: "2026-12-01", at: T0 + 1 },
      [first.request],
    );
    expect(conflict).toEqual({ ok: false, reasonCode: "NATURAL_KEY_CONFLICT" });
  });

  it("a foreign tenant's natural key never collides (tenant-scoped idempotency)", () => {
    const own = submitEquipmentRequest(
      TENANT,
      { requestId: "req-1", naturalKey: "nk-1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-01", at: T0 },
      [],
    );
    if (!own.ok) throw new Error("fixture");
    const foreign = submitEquipmentRequest(
      FOREIGN,
      { requestId: "req-f1", naturalKey: "nk-1", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-01", at: T0 },
      [own.request],
    );
    expect(foreign.ok).toBe(true);
    if (!foreign.ok) return;
    expect(foreign.duplicate).toBe(false);
    expect(foreign.request.tenant.tenantId).toBe("globex");
  });

  it("required-field refusals carry the exact reason codes", () => {
    const base: EquipmentRequestSubmitInput = {
      requestId: "req-x", naturalKey: "nk-x", sku: "LT-5540", quantity: 5, requiredBy: "2026-12-01", at: T0,
    };
    expect(submitEquipmentRequest(TENANT, { ...base, requestId: "" }, [])).toEqual({ ok: false, reasonCode: "REQUEST_ID_REQUIRED" });
    expect(submitEquipmentRequest(TENANT, { ...base, naturalKey: "" }, [])).toEqual({ ok: false, reasonCode: "NATURAL_KEY_REQUIRED" });
    expect(submitEquipmentRequest(TENANT, { ...base, sku: "" }, [])).toEqual({ ok: false, reasonCode: "SKU_REQUIRED" });
    expect(submitEquipmentRequest(TENANT, { ...base, quantity: 0 }, [])).toEqual({ ok: false, reasonCode: "INVALID_QUANTITY" });
    expect(submitEquipmentRequest(TENANT, { ...base, quantity: 1.5 }, [])).toEqual({ ok: false, reasonCode: "INVALID_QUANTITY" });
    expect(submitEquipmentRequest(TENANT, { ...base, requiredBy: "" }, [])).toEqual({ ok: false, reasonCode: "REQUIRED_BY_REQUIRED" });
    expect(submitEquipmentRequest(TENANT, { ...base, at: -1 }, [])).toEqual({ ok: false, reasonCode: "INVALID_SUBMIT_TIME" });
  });
});

describe("transitionEquipmentRequest — the §3.1 machine", () => {
  it("walks the full happy chain to fulfilled", () => {
    let request = submitted();
    const chain: Array<{ command: EquipmentRequestCommand; status: string }> = [
      { command: { type: "resolve", at: T0 + 1 }, status: "resolving" },
      { command: { type: "close_offer_window", at: T0 + 2 }, status: "offer_window_closed" },
      { command: { type: "compare", at: T0 + 3 }, status: "comparing" },
      { command: { type: "select", at: T0 + 4, offerId: "off-1" }, status: "selected" },
      { command: { type: "request_approval", at: T0 + 5 }, status: "approval_requested" },
      { command: { type: "approve", at: T0 + 6 }, status: "approved" },
      { command: { type: "order", at: T0 + 7 }, status: "ordered" },
      { command: { type: "fulfill", at: T0 + 8 }, status: "fulfilled" },
    ];
    for (const step of chain) {
      const result = transitionEquipmentRequest(request, step.command);
      expect(result.ok, `${JSON.stringify(step.command)} from ${request.status}`).toBe(true);
      if (!result.ok) return;
      expect(result.next.status).toBe(step.status);
      expect(result.next.lastTransitionAt).toBe(step.command.at);
      expect(result.event.toStatus).toBe(step.status);
      request = result.next;
    }
    expect(request.selectedOfferId).toBe("off-1");
  });

  it("the refusal branch: approval_requested -> refused (reason REQUIRED)", () => {
    let request = submitted();
    for (const command of [
      { type: "resolve", at: T0 + 1 },
      { type: "close_offer_window", at: T0 + 2 },
      { type: "compare", at: T0 + 3 },
      { type: "select", at: T0 + 4, offerId: "off-1" },
      { type: "request_approval", at: T0 + 5 },
    ] as const) {
      const result = transitionEquipmentRequest(request, command);
      if (!result.ok) throw new Error(`fixture: ${JSON.stringify(command)}`);
      request = result.next;
    }
    const refused = transitionEquipmentRequest(request, { type: "refuse", at: T0 + 6, reason: "" });
    expect(refused).toEqual({ ok: false, reasonCode: "REFUSE_REASON_REQUIRED" });
    const ok = transitionEquipmentRequest(request, { type: "refuse", at: T0 + 6, reason: "over-budget" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.next.status).toBe("refused");
    // REFUSED is terminal: order refuses.
    expect(transitionEquipmentRequest(ok.next, { type: "order", at: T0 + 7 })).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
  });

  it("illegal transitions refuse with ILLEGAL_TRANSITION (never coerced)", () => {
    const request = submitted();
    expect(transitionEquipmentRequest(request, { type: "submit", at: T0 + 1 })).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
    expect(transitionEquipmentRequest(request, { type: "order", at: T0 + 1 })).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
    expect(transitionEquipmentRequest(request, { type: "fulfill", at: T0 + 1 })).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
    const draft = { ...request, status: "draft" as const };
    expect(transitionEquipmentRequest(draft, { type: "resolve", at: T0 + 1 })).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("select requires the offer id; the frozen grammar's cancel fires only from ordered", () => {
    const request = submitted();
    const resolving = transitionEquipmentRequest(request, { type: "resolve", at: T0 + 1 });
    if (!resolving.ok) throw new Error("fixture");
    const closed = transitionEquipmentRequest(resolving.next, { type: "close_offer_window", at: T0 + 2 });
    if (!closed.ok) throw new Error("fixture");
    const comparing = transitionEquipmentRequest(closed.next, { type: "compare", at: T0 + 3 });
    if (!comparing.ok) throw new Error("fixture");
    expect(transitionEquipmentRequest(comparing.next, { type: "select", at: T0 + 4, offerId: "" })).toEqual({
      ok: false,
      reasonCode: "SELECT_OFFER_ID_REQUIRED",
    });
    // The frozen §3.1 grammar: cancelled is reachable ONLY from ordered.
    expect(transitionEquipmentRequest(comparing.next, { type: "cancel", at: T0 + 4, reason: "x" })).toEqual({
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
    });
    let ordered = comparing.next;
    for (const command of [
      { type: "select", at: T0 + 4, offerId: "off-1" },
      { type: "request_approval", at: T0 + 5 },
      { type: "approve", at: T0 + 6 },
      { type: "order", at: T0 + 7 },
    ] as const) {
      const result = transitionEquipmentRequest(ordered, command);
      if (!result.ok) throw new Error(`fixture: ${JSON.stringify(command)}`);
      ordered = result.next;
    }
    expect(transitionEquipmentRequest(ordered, { type: "cancel", at: T0 + 8, reason: "  " })).toEqual({
      ok: false,
      reasonCode: "CANCEL_REASON_REQUIRED",
    });
    const cancelled = transitionEquipmentRequest(ordered, { type: "cancel", at: T0 + 8, reason: "supplier withdrew" });
    expect(cancelled.ok).toBe(true);
  });

  it("ordered -> [fulfilled | cancelled | disputed]; the terminals never re-transition", () => {
    let request = submitted();
    for (const command of [
      { type: "resolve", at: T0 + 1 },
      { type: "close_offer_window", at: T0 + 2 },
      { type: "compare", at: T0 + 3 },
      { type: "select", at: T0 + 4, offerId: "off-1" },
      { type: "request_approval", at: T0 + 5 },
      { type: "approve", at: T0 + 6 },
      { type: "order", at: T0 + 7 },
    ] as const) {
      const result = transitionEquipmentRequest(request, command);
      if (!result.ok) throw new Error(`fixture: ${JSON.stringify(command)}`);
      request = result.next;
    }
    const disputed = transitionEquipmentRequest(request, { type: "dispute", at: T0 + 8, reason: "" });
    expect(disputed).toEqual({ ok: false, reasonCode: "DISPUTE_REASON_REQUIRED" });
    const ok = transitionEquipmentRequest(request, { type: "dispute", at: T0 + 8, reason: "short delivery" });
    if (!ok.ok) throw new Error("fixture");
    expect(ok.next.status).toBe("disputed");
    expect(transitionEquipmentRequest(ok.next, { type: "fulfill", at: T0 + 9 })).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
    const cancelled = transitionEquipmentRequest(request, { type: "cancel", at: T0 + 8, reason: "supplier withdrew" });
    if (!cancelled.ok) throw new Error("fixture");
    expect(cancelled.next.status).toBe("cancelled");
    expect(transitionEquipmentRequest(cancelled.next, { type: "fulfill", at: T0 + 9 })).toEqual({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("the allowed matrix is the frozen law (terminal states empty)", () => {
    expect(EQUIPMENT_REQUEST_ALLOWED.fulfilled).toEqual([]);
    expect(EQUIPMENT_REQUEST_ALLOWED.cancelled).toEqual([]);
    expect(EQUIPMENT_REQUEST_ALLOWED.disputed).toEqual([]);
    expect(EQUIPMENT_REQUEST_ALLOWED.refused).toEqual([]);
    expect(EQUIPMENT_REQUEST_ALLOWED.draft).toEqual(["submit"]);
    expect(EQUIPMENT_REQUEST_ALLOWED.ordered).toContain("fulfill");
    expect(EQUIPMENT_REQUEST_ALLOWED.ordered).toContain("cancel");
    expect(EQUIPMENT_REQUEST_ALLOWED.ordered).toContain("dispute");
  });
});

describe("fail-closed reads + the deterministic board", () => {
  it("a foreign tenant never sees another tenant's request", () => {
    const request = submitted();
    expect(findEquipmentRequest(TENANT, [request], "req-1")?.status).toBe("submitted");
    expect(findEquipmentRequest(FOREIGN, [request], "req-1")).toBeNull();
    expect(findEquipmentRequest(TENANT, [request], "req-other")).toBeNull();
  });

  it("the board counts by status with the deterministic id order", () => {
    const a = submitted();
    const b = submitted({ requestId: "req-0", naturalKey: "nk-0" });
    const board = buildEquipmentRequestBoard(TENANT, [a, b]);
    expect(board.total).toBe(2);
    expect(board.byStatus.submitted).toBe(2);
    expect(board.requestIds).toEqual(["req-0", "req-1"]);
    const foreignBoard = buildEquipmentMarketplaceForeignBoard();
    expect(foreignBoard.total).toBe(0);
  });

  function buildEquipmentMarketplaceForeignBoard() {
    const a = submitted();
    return buildEquipmentRequestBoard(FOREIGN, [a]);
  }
});
