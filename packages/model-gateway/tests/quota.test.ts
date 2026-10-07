/**
 * @fleetos/model-gateway — F230C quota-window enforcement tests.
 */
import { describe, expect, it } from "vitest";
import {
  applyQuotaRequest,
  nextWindowStart,
  openQuotaWindow,
  quotaUtilizationBps,
  type QuotaWindowPolicy,
  type QuotaWindowState,
} from "../src/index.js";

const POLICY: QuotaWindowPolicy = { maxRequestsPerWindow: 3, maxUnitsPerWindow: 1000 };

function window(overrides: Partial<QuotaWindowState> = {}): QuotaWindowState {
  return {
    windowStartAt: 0,
    windowEndAt: 3600,
    requestsAccepted: 0,
    unitsConsumed: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Window application.
// ---------------------------------------------------------------------------

describe("applyQuotaRequest", () => {
  it("accepts an in-window request and reports exact remainders", () => {
    const result = applyQuotaRequest(POLICY, window(), { at: 10, units: 400 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.requestsAccepted).toBe(1);
      expect(result.state.unitsConsumed).toBe(400);
      expect(result.remainingRequests).toBe(2);
      expect(result.remainingUnits).toBe(600);
    }
  });

  it("accepts at the window start; refuses at exactly windowEndAt (half-open window)", () => {
    expect(applyQuotaRequest(POLICY, window(), { at: 0, units: 1 }).ok).toBe(true);
    expect(applyQuotaRequest(POLICY, window(), { at: 3600, units: 1 })).toMatchObject({
      ok: false,
      reasonCode: "REQUEST_OUTSIDE_WINDOW",
    });
  });

  it("refuses request-count exhaustion with the exact overshoot — never a silent drop", () => {
    let state = window();
    for (let i = 0; i < 3; i++) {
      const step = applyQuotaRequest(POLICY, state, { at: 10 + i, units: 1 });
      if (!step.ok) throw new Error("expected ok");
      state = step.state;
    }
    const fourth = applyQuotaRequest(POLICY, state, { at: 20, units: 1 });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) {
      expect(fourth.reasonCode).toBe("QUOTA_REQUESTS_EXHAUSTED");
      expect(fourth.overshootRequests).toBe(1);
    }
  });

  it("refuses unit exhaustion with the exact overshoot", () => {
    const state = window({ requestsAccepted: 1, unitsConsumed: 900 });
    const result = applyQuotaRequest(POLICY, state, { at: 10, units: 200 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("QUOTA_UNITS_EXHAUSTED");
      expect(result.overshootUnits).toBe(100);
    }
  });

  it("a refused request consumes NOTHING (state untouched on refusal)", () => {
    const state = window({ requestsAccepted: 2, unitsConsumed: 900 });
    const refused = applyQuotaRequest(POLICY, state, { at: 10, units: 200 });
    expect(refused.ok).toBe(false);
    expect(state.requestsAccepted).toBe(2);
    expect(state.unitsConsumed).toBe(900);
  });

  it("refuses malformed windows, policies and requests with typed codes", () => {
    expect(applyQuotaRequest(POLICY, window({ windowStartAt: 100, windowEndAt: 100 }), { at: 100, units: 1 })).toMatchObject({ ok: false, reasonCode: "QUOTA_WINDOW_INVALID" });
    expect(applyQuotaRequest(POLICY, window({ windowStartAt: 200, windowEndAt: 100 }), { at: 150, units: 1 })).toMatchObject({ ok: false, reasonCode: "QUOTA_WINDOW_INVALID" });
    expect(applyQuotaRequest({ maxRequestsPerWindow: -1, maxUnitsPerWindow: 10 }, window(), { at: 1, units: 1 })).toMatchObject({ ok: false, reasonCode: "QUOTA_POLICY_INVALID" });
    expect(applyQuotaRequest({ maxRequestsPerWindow: 1.5, maxUnitsPerWindow: 10 }, window(), { at: 1, units: 1 })).toMatchObject({ ok: false, reasonCode: "QUOTA_POLICY_INVALID" });
    expect(applyQuotaRequest(POLICY, window(), { at: -1, units: 1 })).toMatchObject({ ok: false, reasonCode: "NEGATIVE_TIME" });
    expect(applyQuotaRequest(POLICY, window(), { at: 1, units: -1 })).toMatchObject({ ok: false, reasonCode: "NEGATIVE_UNITS" });
    expect(applyQuotaRequest(POLICY, window(), { at: 1, units: 1.5 })).toMatchObject({ ok: false, reasonCode: "NON_INTEGER_UNITS" });
  });

  it("exhaustion on the request-count axis still refuses even with unit room (and vice versa)", () => {
    const zeroRequests = { maxRequestsPerWindow: 0, maxUnitsPerWindow: 1000 };
    expect(applyQuotaRequest(zeroRequests, window(), { at: 1, units: 1 })).toMatchObject({
      ok: false,
      reasonCode: "QUOTA_REQUESTS_EXHAUSTED",
      overshootRequests: 1,
    });
    const zeroUnits = { maxRequestsPerWindow: 5, maxUnitsPerWindow: 0 };
    expect(applyQuotaRequest(zeroUnits, window(), { at: 1, units: 1 })).toMatchObject({
      ok: false,
      reasonCode: "QUOTA_UNITS_EXHAUSTED",
      overshootUnits: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Window arithmetic + utilization.
// ---------------------------------------------------------------------------

describe("openQuotaWindow + nextWindowStart + utilization", () => {
  it("opens a fresh zero-consumption window for [start, start+length)", () => {
    const result = openQuotaWindow(7200, 3600);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toEqual({ windowStartAt: 7200, windowEndAt: 10800, requestsAccepted: 0, unitsConsumed: 0 });
    }
  });

  it("refuses invalid window parameters", () => {
    expect(openQuotaWindow(-1, 3600)).toMatchObject({ ok: false, reasonCode: "QUOTA_WINDOW_INVALID" });
    expect(openQuotaWindow(0, 0)).toMatchObject({ ok: false, reasonCode: "QUOTA_WINDOW_INVALID" });
    expect(openQuotaWindow(0, 1.5)).toMatchObject({ ok: false, reasonCode: "QUOTA_WINDOW_INVALID" });
  });

  it("the next window starts where this one ends (pure arithmetic on logical time)", () => {
    expect(nextWindowStart(window({ windowStartAt: 0, windowEndAt: 3600 }))).toBe(3600);
  });

  it("utilization is integer bps, floored; 0 when the ceiling is 0", () => {
    const state = window({ requestsAccepted: 1, unitsConsumed: 250 });
    expect(quotaUtilizationBps(POLICY, state)).toEqual({ requestsBps: 3333, unitsBps: 2500 });
    expect(quotaUtilizationBps({ maxRequestsPerWindow: 0, maxUnitsPerWindow: 0 }, window())).toEqual({
      requestsBps: 0,
      unitsBps: 0,
    });
  });
});
