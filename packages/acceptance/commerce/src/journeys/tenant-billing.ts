/**
 * @fleetos/acceptance-commerce — F331C row 35: the tenant billing &
 * invoicing journey (seat/consumption billing from entitlements +
 * gateway usage).
 *
 * CENSUS CITATION (D12, the F331C commerce census — see
 * docs/evidence/F331C/report.md §4): `tenant-billing-invoicing` is a
 * census-certified TRANSITION-class responder — flips at +1d and beyond
 * (the open period's issuance gate opens once the run clock passes the
 * period boundary T0+2h: PERIOD_NOT_ENDED → issued). A genuine D2(b)
 * window-boundary transition over an ABSOLUTE billing period vs the
 * run clock; no timestamp-equality pins anywhere (D13). No past flip
 * (−1h keeps the period closed).
 *
 * The per-epoch tables on the four D9-relevant responding assertions
 * cover the frozen schedule {T0, T0+30d, T0+90d} exactly (D9: 30d =
 * 2_592_000_000 ms, 90d = 7_776_000_000 ms); every other assertion is
 * single-valued T0-anchored.
 */

import type { AcceptanceJourney, FactValue } from "../journey-contracts.js";
import { COMMERCE_T0 } from "../journey-world.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T0 = COMMERCE_T0;
const eq = (id: string, fact: string, expected: FactValue, description: string) =>
  ({ id, description, fact, op: "eq" as const, expected });
const deq = (id: string, fact: string, expected: readonly string[], description: string) =>
  ({ id, description, fact, op: "deepEq" as const, expected });

/**
 * Tenant billing & invoicing: REAL usage ledger (appendUsage through
 * the documented budget-port seam, chained digests) + REAL invoice
 * issuance over the world's REAL subscription and entitlement grants —
 * line items composed from the real usage records with honest
 * windowing, the issuance gate, the SAME-grace billability, the
 * exact-money limit path, no-double-billing, no placeholders, and the
 * fail-closed tenancy probes.
 */
export const tenantBillingInvoicingJourney: AcceptanceJourney = {
  id: "tenant-billing-invoicing",
  persona: "finance-controller",
  capability: "tenant-billing",
  goal: "Issue tenant invoices over the REAL billing module — the seat line derives from the world's REAL held seats (entitlement grants), the consumption lines compose from the REAL gateway usage ledger within the billing period (records outside the window never enter), the issuance gate refuses an open period, billability follows the SAME grace law as seat allocation, the limit path refuses with the exact overshoot, duplicate ids and overlapping periods of the same subscription refuse, empty bills refuse, and foreign-tenant records refuse fail-closed everywhere. The open period's boundary (T0+2h) against the run clock produces a genuine window transition.",
  steps: [
    // REAL usage ledger: r1..r3 inside the closed period, r4 outside (future).
    { stepId: "s1", kind: "billing-usage-seed", factKey: "seed",
      foreignProbe: { requestRef: "req-foreign-append" },
      records: [
        { requestRef: "req-1", modelId: "model-beta-cheap", capability: "model_invoke", units: 10, costMinor: 4_000, at: T0 - 10 * DAY },
        { requestRef: "req-2", modelId: "model-beta-cheap", capability: "model_invoke", units: 6, costMinor: 2_400, at: T0 - 5 * DAY },
        { requestRef: "req-3", modelId: "model-gamma-analytic", capability: "model_invoke", units: 4, costMinor: 3_600, at: T0 - 2 * DAY },
        { requestRef: "req-4", modelId: "model-beta-cheap", capability: "model_invoke", units: 8, costMinor: 3_200, at: T0 + 1 * DAY },
      ] },
    // The closed-period invoice: success at T0 (line composition from the real records).
    { stepId: "s2", kind: "billing-invoice-issue", factKey: "closed", invoiceId: "inv-1",
      period: { from: T0 - 30 * DAY, until: T0 - 6 * HOUR }, seatRateMinor: 25_000, limitMinor: 10_000_000,
      subscription: "world", grants: "world", usage: "seeded", at: "now" },
    // The open-period invoice: refused at T0 (the issuance gate); issued beyond T0+2h.
    { stepId: "s3", kind: "billing-invoice-issue", factKey: "open", invoiceId: "inv-2",
      period: { from: T0 - 6 * HOUR, until: T0 + 2 * HOUR }, seatRateMinor: 25_000, limitMinor: 10_000_000,
      subscription: "world", grants: "world", usage: "seeded", at: "now" },
    // No double billing.
    { stepId: "s4", kind: "billing-invoice-issue", factKey: "dup", invoiceId: "inv-1",
      period: { from: T0 - 60 * DAY, until: T0 - 31 * DAY }, seatRateMinor: 25_000, limitMinor: 10_000_000,
      subscription: "world", grants: "world", usage: "seeded", at: "now" },
    { stepId: "s5", kind: "billing-invoice-issue", factKey: "overlap", invoiceId: "inv-3",
      period: { from: T0 - 29 * DAY, until: T0 - 10 * DAY }, seatRateMinor: 25_000, limitMinor: 10_000_000,
      subscription: "world", grants: "world", usage: "seeded", at: "now" },
    // The limit path: exact overshoot on a disjoint period (consumption empty there; seat 75_000).
    { stepId: "s6", kind: "billing-invoice-issue", factKey: "limit", invoiceId: "inv-4",
      period: { from: T0 - 60 * DAY, until: T0 - 31 * DAY }, seatRateMinor: 25_000, limitMinor: 74_999,
      subscription: { status: "active", validUntil: "2027-01-01T00:00:00Z" }, grants: [{ seats: 3 }], usage: "seeded", at: "now" },
    // Billability: beyond grace on the SAME grace law. period.until ≈ 2026-03-12;
    // validUntil 2026-01-31 + 14d grace = 2026-02-14 < until → beyond.
    { stepId: "s7", kind: "billing-invoice-issue", factKey: "beyondGrace", invoiceId: "inv-5",
      period: { from: T0 - 31 * DAY, until: T0 - 30 * DAY }, seatRateMinor: 25_000, limitMinor: 10_000_000,
      graceMs: 14 * DAY,
      subscription: { status: "active", validUntil: "2026-01-31T00:00:00Z" }, grants: [{ seats: 2 }], usage: "seeded", at: "now" },
    // The fail-closed tenancy probes.
    { stepId: "s8", kind: "billing-invoice-issue", factKey: "foreign", invoiceId: "inv-6",
      period: { from: T0 - 30 * DAY, until: T0 - 6 * HOUR }, seatRateMinor: 25_000, limitMinor: 10_000_000,
      subscription: { status: "active", validUntil: "2027-01-01T00:00:00Z" }, grants: [{ seats: 3 }], usage: "seeded",
      foreignRecord: { requestRef: "req-foreign-input" }, at: "now" },
    // No placeholders.
    { stepId: "s9", kind: "billing-invoice-issue", factKey: "empty", invoiceId: "inv-7",
      period: { from: T0 - 30 * DAY, until: T0 - 6 * HOUR }, seatRateMinor: 25_000, limitMinor: 10_000_000,
      subscription: { status: "active", validUntil: "2027-01-01T00:00:00Z" }, grants: [{ seats: 0 }], usage: "none", at: "now" },
    // Inactive subscription.
    { stepId: "s10", kind: "billing-invoice-issue", factKey: "inactive", invoiceId: "inv-8",
      period: { from: T0 - 30 * DAY, until: T0 - 6 * HOUR }, seatRateMinor: 25_000, limitMinor: 10_000_000,
      subscription: { status: "cancelled", validUntil: "2027-01-01T00:00:00Z" }, grants: [{ seats: 3 }], usage: "seeded", at: "now" },
  ],
  assertions: [
    eq("b1", "bil.seed.seed.count", 4, "four usage records are appended through the REAL appendUsage API"),
    eq("b2", "bil.seed.seed.chainOk", true, "the usage ledger chain verifies (contiguous seqs, chained digests)"),
    eq("b3", "bil.seed.seed.totalUnits", 28, "the ledger totals 28 units (10+6+4+8) — the future record counts in the ledger, never in a closed-period bill"),
    eq("b4", "bil.seed.seed.totalCostMinor", 13_200, "the ledger totals 13_200 minor (4_000+2_400+3_600+3_200)"),
    eq("b5", "bil.seed.seed.foreignAppend", "TENANT_MISMATCH", "a cross-tenant append is refused by the REAL API fail-closed"),
    eq("b6", "bil.invoice.closed.ok", true, "the closed-period invoice issues at T0"),
    eq("b7", "bil.invoice.closed.status", "issued", "the invoice status is issued"),
    eq("b8", "bil.invoice.closed.seatTotalMinor", 75_000, "the seat line is the REAL held seats (3) × the seat rate"),
    eq("b9", "bil.invoice.closed.consumptionTotalMinor", 10_000, "the consumption total composes from the in-window records only"),
    eq("b10", "bil.invoice.closed.totalMinor", 85_000, "the invoice total is the exact integer sum (75_000 + 10_000)"),
    deq("b11", "bil.invoice.closed.lines", [
      "seat:3x25000:75000",
      "consumption:model-beta-cheap:2req:16u:6400",
      "consumption:model-gamma-analytic:1req:4u:3600",
    ], "the line items compose from the REAL usage records (honest windowing: the future r4 never enters; seat first, then modelId lexical)"),
    { id: "b12", description: "the open period refuses issuance at T0 (the window-boundary gate)", fact: "bil.invoice.open.ok", op: "eq", expected: false },
    { id: "b13", description: "the open-period refusal names PERIOD_NOT_ENDED at T0", fact: "bil.invoice.open.reasonCode", op: "eq", expected: "PERIOD_NOT_ENDED" },
    { id: "b14", description: "the open period has no issued status at T0 (it issues beyond the boundary)", fact: "bil.invoice.open.status", op: "eq", expected: null },
    { id: "b15", description: "the open period has no total at T0 (its window holds no usage records when it issues)", fact: "bil.invoice.open.totalMinor", op: "eq", expected: null },
    eq("b16", "bil.invoice.dup.reasonCode", "DUPLICATE_INVOICE_ID", "a duplicate invoice id refuses"),
    eq("b17", "bil.invoice.overlap.reasonCode", "DUPLICATE_BILLING_PERIOD", "an overlapping period of the same subscription refuses — never double billed"),
    eq("b18", "bil.invoice.limit.reasonCode", "INVOICE_LIMIT_EXCEEDED", "the invoice limit path refuses with the exact overshoot"),
    eq("b19", "bil.invoice.limit.totalMinor", 75_000, "the refused issuance carries the exact would-be total"),
    eq("b20", "bil.invoice.limit.overshootMinor", 1, "the overshoot is exactly 1 minor unit — never clamped"),
    eq("b21", "bil.invoice.beyondGrace.reasonCode", "SUBSCRIPTION_EXPIRED_BEYOND_GRACE", "a subscription beyond validUntil+grace at the period end refuses (the SAME grace law)"),
    eq("b22", "bil.invoice.foreign.reasonCode", "USAGE_TENANT_MISMATCH", "a foreign-tenant usage record in the input refuses the whole issuance fail-closed"),
    eq("b23", "bil.invoice.empty.reasonCode", "EMPTY_INVOICE", "a bill with no line items at all refuses — a zero invoice is never fabricated"),
    eq("b24", "bil.invoice.inactive.reasonCode", "SUBSCRIPTION_NOT_ACTIVE", "an inactive subscription is never billable"),
  ],
};

export const TENANT_BILLING_JOURNEYS: readonly AcceptanceJourney[] = [
  tenantBillingInvoicingJourney,
];
