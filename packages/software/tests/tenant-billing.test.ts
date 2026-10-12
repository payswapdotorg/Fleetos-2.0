/**
 * @fleetos/software — F331C row 35: tenant billing & invoicing.
 * Machine tests of the invoice-generation laws: the issuance gate
 * (PERIOD_NOT_ENDED), honest windowing, the fail-closed usage tenancy,
 * the seat line from REAL held seats, the SAME-grace billability, the
 * documented line order, exact-money limit refusals, no placeholders,
 * and no double billing.
 */

import { describe, expect, it } from "vitest";
import {
  issueTenantInvoice,
  type BillingPeriod,
  type EntitlementGrant,
  type GatewayUsageRecordLike,
  type Subscription,
  type TenantInvoice,
} from "../src/index.js";

const TENANT = { tenantId: "acme" } as const;
const T0 = 1_774_000_000_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: { kind: "subscription", value: "sub-1" },
    tenant: TENANT,
    sku: "FLEET-OPS-PRO",
    seatsTotal: 5,
    status: "active",
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    ...overrides,
  };
}

function grant(overrides: Partial<EntitlementGrant> = {}): EntitlementGrant {
  return {
    id: "grant-1",
    tenant: TENANT,
    subscriptionId: "sub-1",
    catalogEntryId: "cat-routeplanner",
    assigneeId: "agent-1",
    seats: 3,
    status: "granted",
    grantedAt: 1,
    assignedAt: null,
    revokedAt: null,
    revokedReason: null,
    expiresAt: null,
    ...overrides,
  };
}

function usage(overrides: Partial<GatewayUsageRecordLike> = {}): GatewayUsageRecordLike {
  return {
    tenantId: "acme",
    agentId: "agent-1",
    requestRef: "req-1",
    modelId: "model-beta-cheap",
    capability: "summarize",
    units: 10,
    costMinor: 4_000,
    at: T0 - DAY,
    ...overrides,
  };
}

const CLOSED_PERIOD: BillingPeriod = { from: T0 - 30 * DAY, until: T0 - 6 * HOUR };

function input(overrides: Partial<Parameters<typeof issueTenantInvoice>[1]> = {}) {
  return {
    invoiceId: "inv-1",
    subscription: subscription(),
    grants: [grant()],
    usageRecords: [usage()],
    period: CLOSED_PERIOD,
    seatRateMinor: 25_000,
    limitMinor: 10_000_000,
    ...overrides,
  };
}

describe("issueTenantInvoice — the issuance gate + line composition", () => {
  it("issues over a closed period: seat line from REAL held seats, consumption lines by model lexical order", () => {
    const result = issueTenantInvoice(TENANT, input({
      usageRecords: [
        usage({ modelId: "model-gamma-analytic", costMinor: 9_000, requestRef: "r2", at: T0 - 2 * DAY }),
        usage({ modelId: "model-beta-cheap", costMinor: 4_000, at: T0 - DAY }),
        usage({ modelId: "model-beta-cheap", costMinor: 2_000, requestRef: "r3", at: T0 - 12 * HOUR }),
      ],
    }), [], T0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inv = result.invoice;
    expect(inv.lines).toEqual([
      { kind: "seat", seats: 3, unitRateMinor: 25_000, amountMinor: 75_000 },
      { kind: "consumption", modelId: "model-beta-cheap", requests: 2, units: 20, amountMinor: 6_000 },
      { kind: "consumption", modelId: "model-gamma-analytic", requests: 1, units: 10, amountMinor: 9_000 },
    ]);
    expect(inv.seatTotalMinor).toBe(75_000);
    expect(inv.consumptionTotalMinor).toBe(15_000);
    expect(inv.totalMinor).toBe(90_000);
    expect(inv.status).toBe("issued");
    expect(inv.issuedAt).toBe(T0);
  });

  it("ISSUANCE GATE: an open period refuses PERIOD_NOT_ENDED (the window-boundary law)", () => {
    const result = issueTenantInvoice(TENANT, input({ period: { from: T0 - 30 * DAY, until: T0 + 2 * HOUR } }), [], T0);
    expect(result).toMatchObject({ ok: false, reasonCode: "PERIOD_NOT_ENDED" });
    // exactly at the boundary is fine:
    const boundary = issueTenantInvoice(TENANT, input(), [], CLOSED_PERIOD.until);
    expect(boundary.ok).toBe(true);
  });

  it("HONEST WINDOWING: records outside [from, until) never enter; an empty window refuses EMPTY_INVOICE", () => {
    const allOutside = issueTenantInvoice(TENANT, input({
      usageRecords: [usage({ at: T0 - 40 * DAY }), usage({ at: CLOSED_PERIOD.until })],
      grants: [],
    }), [], T0);
    expect(allOutside).toMatchObject({ ok: false, reasonCode: "EMPTY_INVOICE" });
    const mixed = issueTenantInvoice(TENANT, input({
      usageRecords: [usage({ at: T0 - 40 * DAY }), usage({ requestRef: "r-in", at: T0 - DAY }), usage({ at: CLOSED_PERIOD.until })],
    }), [], T0);
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(mixed.invoice.lines.filter((l) => l.kind === "consumption")).toEqual([
      { kind: "consumption", modelId: "model-beta-cheap", requests: 1, units: 10, amountMinor: 4_000 },
    ]);
  });

  it("TENANT FAIL-CLOSED: a foreign-tenant usage record refuses the whole issuance", () => {
    const result = issueTenantInvoice(TENANT, input({
      usageRecords: [usage(), usage({ tenantId: "globex", requestRef: "r-foreign" })],
    }), [], T0);
    expect(result).toMatchObject({ ok: false, reasonCode: "USAGE_TENANT_MISMATCH" });
  });

  it("billability: inactive and beyond-grace subscriptions refuse (the SAME grace law)", () => {
    const inactive = issueTenantInvoice(TENANT, input({ subscription: subscription({ status: "cancelled" }) }), [], T0);
    expect(inactive).toMatchObject({ ok: false, reasonCode: "SUBSCRIPTION_NOT_ACTIVE" });
    const graceMs = 14 * DAY;
    // period.until ≈ 2026-04-11T03:33Z; validUntil 2026-03-01 + 14d grace = 2026-03-15 < until → beyond.
    const beyond = issueTenantInvoice(TENANT, input({
      subscription: subscription({ validUntil: "2026-03-01T00:00:00Z" }),
      graceMs,
    }), [], T0);
    expect(beyond).toMatchObject({ ok: false, reasonCode: "SUBSCRIPTION_EXPIRED_BEYOND_GRACE" });
    // 14d + 60d grace from 2026-03-01 ≈ 2026-05-14 > until → still billable.
    const within = issueTenantInvoice(TENANT, input({
      subscription: subscription({ validUntil: "2026-03-01T00:00:00Z" }),
      graceMs: graceMs + 60 * DAY,
    }), [], T0);
    expect(within.ok).toBe(true);
  });

  it("the limit path refuses with the exact overshoot — never clamped", () => {
    // default input total: seat 75_000 + consumption 4_000 = 79_000.
    const result = issueTenantInvoice(TENANT, input({ limitMinor: 78_999 }), [], T0);
    expect(result).toMatchObject({ ok: false, reasonCode: "INVOICE_LIMIT_EXCEEDED" });
    if (result.ok) return;
    expect(result.totalMinor).toBe(79_000);
    expect(result.limitMinor).toBe(78_999);
    expect(result.overshootMinor).toBe(1);
  });

  it("NO DOUBLE BILLING: duplicate ids and overlapping periods of the same subscription refuse", () => {
    const first = issueTenantInvoice(TENANT, input(), [], T0);
    expect(first.ok).toBe(true);
    const existing: readonly TenantInvoice[] = first.ok ? [first.invoice] : [];
    const dupId = issueTenantInvoice(TENANT, input({ period: { from: T0 - 60 * DAY, until: T0 - 31 * DAY } }), existing, T0);
    expect(dupId).toMatchObject({ ok: false, reasonCode: "DUPLICATE_INVOICE_ID" });
    const overlap = issueTenantInvoice(TENANT, input({
      invoiceId: "inv-2",
      period: { from: T0 - 10 * DAY, until: T0 - 1 * HOUR },
    }), existing, T0);
    expect(overlap).toMatchObject({ ok: false, reasonCode: "DUPLICATE_BILLING_PERIOD" });
    // a NON-overlapping period of the same subscription is fine:
    const disjoint = issueTenantInvoice(TENANT, input({
      invoiceId: "inv-3",
      period: { from: T0 - 60 * DAY, until: T0 - 30 * DAY - HOUR },
    }), existing, T0);
    expect(disjoint.ok).toBe(true);
  });

  it("invalid inputs refuse with exact reason codes (period, rate, issuance time)", () => {
    const badPeriod = issueTenantInvoice(TENANT, input({ period: { from: T0, until: T0 } }), [], T0);
    expect(badPeriod).toMatchObject({ ok: false, reasonCode: "INVALID_BILLING_PERIOD" });
    const badRate = issueTenantInvoice(TENANT, input({ seatRateMinor: -1 }), [], T0);
    expect(badRate).toMatchObject({ ok: false, reasonCode: "INVALID_SEAT_RATE" });
    const badAt = issueTenantInvoice(TENANT, input(), [], -1);
    expect(badAt).toMatchObject({ ok: false, reasonCode: "INVALID_ISSUANCE_TIME" });
    const emptyId = issueTenantInvoice(TENANT, input({ invoiceId: "" }), [], T0);
    expect(emptyId).toMatchObject({ ok: false, reasonCode: "INVOICE_ID_EMPTY" });
  });
});
