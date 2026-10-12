/**
 * @fleetos/software — Tenant billing & invoicing (F331C row 35):
 * seat/consumption billing derived from entitlements + gateway usage as
 * a REAL new capability — invoice generation with line-item composition
 * from real usage records, honest windowing and refusal/limit paths.
 *
 * Bounded-context placement (BOUNDED-CONTEXTS.md): software owns
 * subscriptions, entitlements, allocations — the seat side of the bill.
 * The model-gateway usage record enters through the LOCAL structural
 * seam below (the TYPE-seam pattern of model-gateway's BudgetCheckPort:
 * no runtime import of @fleetos/model-gateway; the acceptance lane is
 * the documented composition site that binds the REAL ledger entries).
 *
 * Documented laws (machine-tested in tests/tenant-billing.test.ts):
 *   - ISSUANCE GATE: an invoice may only be issued once its billing
 *     period has ENDED (at >= period.until); an open period refuses
 *     PERIOD_NOT_ENDED — a window-boundary gate, never a partial bill.
 *   - HONEST WINDOWING: a usage record enters the invoice IFF
 *     period.from <= record.at < period.until. Records outside the
 *     window NEVER enter — never silently absorbed.
 *   - TENANT FAIL-CLOSED: a foreign-tenant usage record in the input
 *     REFUSES the whole issuance (USAGE_TENANT_MISMATCH) — never
 *     silently filtered (law A8).
 *   - SEAT BILLING: held seats are counted through the REAL
 *     countHeldSeats (granted + assigned grants only — expired/revoked
 *     release their seats). The seat line is heldSeats × seatRateMinor.
 *   - BILLABILITY (the SAME grace law as seat-allocation.ts): at the
 *     period end the subscription must be active and not beyond
 *     validUntil + graceMs, or the issuance refuses.
 *   - LINE ORDER: the seat line first (if any), then consumption lines
 *     in modelId lexical order — the documented total order.
 *   - EXACT MONEY: integer minor units only; the limit path refuses
 *     INVOICE_LIMIT_EXCEEDED with the exact overshoot — never clamped.
 *   - NO PLACEHOLDERS: an invoice with no line items at all refuses
 *     EMPTY_INVOICE — a zero bill is never fabricated.
 *   - NO DOUBLE BILLING: a duplicate invoiceId or an invoice of the
 *     same subscription with an OVERLAPPING period refuses.
 *
 * Laws: A1, A4 (refuse, never clamp), A8, A16 (an invoice is never a
 * subscription), A19, A20. Pure deterministic TS; time is an explicit
 * `number` input (epoch ms).
 */

import type { TenantScope, Subscription } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import type { EntitlementGrant } from "./entitlement-grants.js";
import { countHeldSeats } from "./entitlement-grants.js";

// ---------------------------------------------------------------------------
// LOCAL structural usage-record seam (cross-context, law A13) —
// structurally compatible with @fleetos/model-gateway `UsageLedgerEntry`
// (the extra ledger fields are additive); the acceptance composition
// site binds the REAL ledger entries (F331C).
// ---------------------------------------------------------------------------

export interface GatewayUsageRecordLike {
  readonly tenantId: string;
  readonly agentId: string;
  readonly requestRef: string;
  readonly modelId: string;
  readonly capability: string;
  readonly units: number;
  readonly costMinor: number;
  readonly at: number;
}

// ---------------------------------------------------------------------------
// The invoice.
// ---------------------------------------------------------------------------

export type InvoiceLine =
  | {
      readonly kind: "seat";
      readonly seats: number;
      readonly unitRateMinor: number;
      readonly amountMinor: number;
    }
  | {
      readonly kind: "consumption";
      readonly modelId: string;
      readonly requests: number;
      readonly units: number;
      readonly amountMinor: number;
    };

export interface BillingPeriod {
  /** Inclusive period start (epoch ms). */
  readonly from: number;
  /** Exclusive period end (epoch ms). */
  readonly until: number;
}

export interface TenantInvoice {
  readonly invoiceId: string;
  readonly tenant: TenantScope;
  readonly subscriptionId: string;
  readonly period: BillingPeriod;
  readonly issuedAt: number;
  /** Seat line first (if any), then consumption lines by modelId lexical. */
  readonly lines: readonly InvoiceLine[];
  readonly seatTotalMinor: number;
  readonly consumptionTotalMinor: number;
  readonly totalMinor: number;
  readonly limitMinor: number;
  readonly status: "issued";
}

export interface TenantBillingInput {
  readonly invoiceId: string;
  readonly subscription: Subscription;
  readonly grants: readonly EntitlementGrant[];
  readonly usageRecords: readonly GatewayUsageRecordLike[];
  readonly period: BillingPeriod;
  /** Per-seat rate for the period (integer minor units). */
  readonly seatRateMinor: number;
  /** Invoice ceiling (refusal carries the exact overshoot). */
  readonly limitMinor: number;
  /** Renewal grace in ms — the SAME grace law as seat-allocation.ts. */
  readonly graceMs?: number;
}

export type TenantBillingReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "INVOICE_ID_EMPTY"
  | "DUPLICATE_INVOICE_ID"
  | "DUPLICATE_BILLING_PERIOD"
  | "INVALID_BILLING_PERIOD"
  | "PERIOD_NOT_ENDED"
  | "INVALID_ISSUANCE_TIME"
  | "SUBSCRIPTION_NOT_ACTIVE"
  | "SUBSCRIPTION_EXPIRED_BEYOND_GRACE"
  | "INVALID_SEAT_RATE"
  | "USAGE_TENANT_MISMATCH"
  | "INVALID_USAGE_RECORD"
  | "EMPTY_INVOICE"
  | "INVOICE_LIMIT_EXCEEDED";

export type TenantBillingResult =
  | { readonly ok: true; readonly invoice: TenantInvoice }
  | {
      readonly ok: false;
      readonly reasonCode: TenantBillingReasonCode;
      readonly totalMinor: number | null;
      readonly limitMinor: number | null;
      readonly overshootMinor: number | null;
    };

/**
 * issueTenantInvoice — generate one invoice from the REAL seat population
 * and the REAL gateway usage records. PURE: returns the issued invoice;
 * applies nothing.
 */
export function issueTenantInvoice(
  tenant: TenantScope,
  input: TenantBillingInput,
  existingInvoices: readonly TenantInvoice[],
  at: number,
): TenantBillingResult {
  const fail = (
    reasonCode: TenantBillingReasonCode,
    extras: { totalMinor?: number; limitMinor?: number; overshootMinor?: number } = {},
  ): TenantBillingResult => ({
    ok: false,
    reasonCode,
    totalMinor: extras.totalMinor ?? null,
    limitMinor: extras.limitMinor ?? null,
    overshootMinor: extras.overshootMinor ?? null,
  });
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return fail("TENANT_SCOPE_MISSING");
  if (input.invoiceId.length === 0) return fail("INVOICE_ID_EMPTY");
  if (!Number.isInteger(at) || at < 0) return fail("INVALID_ISSUANCE_TIME");
  if (existingInvoices.some((i) => i.invoiceId === input.invoiceId)) {
    return fail("DUPLICATE_INVOICE_ID");
  }
  const subscriptionId = input.subscription.id.kind === "subscription" ? input.subscription.id.value : "";
  if (!Number.isInteger(input.period.from) || !Number.isInteger(input.period.until) || input.period.until <= input.period.from) {
    return fail("INVALID_BILLING_PERIOD");
  }
  if (existingInvoices.some((i) => i.subscriptionId === subscriptionId && i.period.from < input.period.until && input.period.from < i.period.until)) {
    return fail("DUPLICATE_BILLING_PERIOD");
  }
  // ISSUANCE GATE: the period must have ENDED at the issuance instant.
  if (at < input.period.until) return fail("PERIOD_NOT_ENDED");
  // Billability at the period end — the SAME grace law as seat-allocation.ts.
  if (input.subscription.status !== "active") return fail("SUBSCRIPTION_NOT_ACTIVE");
  if (input.subscription.validUntil !== null) {
    const validUntilMs = Date.parse(input.subscription.validUntil);
    if (!Number.isNaN(validUntilMs) && input.period.until > validUntilMs + (input.graceMs ?? 0)) {
      return fail("SUBSCRIPTION_EXPIRED_BEYOND_GRACE");
    }
  }
  if (!Number.isInteger(input.seatRateMinor) || input.seatRateMinor < 0) {
    return fail("INVALID_SEAT_RATE");
  }
  // Tenant fail-closed over the usage input (law A8) + record validation.
  for (const record of input.usageRecords) {
    if (record.tenantId !== tenantCheck.scope.tenantId) return fail("USAGE_TENANT_MISMATCH");
    if (record.modelId.length === 0 || record.requestRef.length === 0) return fail("INVALID_USAGE_RECORD");
    if (!Number.isInteger(record.units) || record.units < 0) return fail("INVALID_USAGE_RECORD");
    if (!Number.isInteger(record.costMinor) || record.costMinor < 0) return fail("INVALID_USAGE_RECORD");
    if (!Number.isInteger(record.at) || record.at < 0) return fail("INVALID_USAGE_RECORD");
  }
  // HONEST WINDOWING: a record enters IFF period.from <= at < period.until.
  const inWindow = input.usageRecords.filter((r) => r.at >= input.period.from && r.at < input.period.until);

  const lines: InvoiceLine[] = [];
  const heldSeats = countHeldSeats(subscriptionId, input.grants);
  if (heldSeats > 0) {
    lines.push({
      kind: "seat",
      seats: heldSeats,
      unitRateMinor: input.seatRateMinor,
      amountMinor: heldSeats * input.seatRateMinor,
    });
  }
  // Consumption lines: per modelId, lexical order.
  const byModel = new Map<string, { requests: number; units: number; amountMinor: number }>();
  for (const record of inWindow) {
    const slot = byModel.get(record.modelId) ?? { requests: 0, units: 0, amountMinor: 0 };
    slot.requests += 1;
    slot.units += record.units;
    slot.amountMinor += record.costMinor;
    byModel.set(record.modelId, slot);
  }
  for (const modelId of [...byModel.keys()].sort((a, b) => a.localeCompare(b))) {
    const slot = byModel.get(modelId)!;
    lines.push({ kind: "consumption", modelId, requests: slot.requests, units: slot.units, amountMinor: slot.amountMinor });
  }
  if (lines.length === 0) return fail("EMPTY_INVOICE");

  const seatTotalMinor = lines
    .filter((l): l is Extract<InvoiceLine, { kind: "seat" }> => l.kind === "seat")
    .reduce((sum, l) => sum + l.amountMinor, 0);
  const consumptionTotalMinor = lines
    .filter((l): l is Extract<InvoiceLine, { kind: "consumption" }> => l.kind === "consumption")
    .reduce((sum, l) => sum + l.amountMinor, 0);
  const totalMinor = seatTotalMinor + consumptionTotalMinor;
  if (totalMinor > input.limitMinor) {
    return fail("INVOICE_LIMIT_EXCEEDED", {
      totalMinor,
      limitMinor: input.limitMinor,
      overshootMinor: totalMinor - input.limitMinor,
    });
  }
  return {
    ok: true,
    invoice: {
      invoiceId: input.invoiceId,
      tenant: tenantCheck.scope,
      subscriptionId,
      period: { from: input.period.from, until: input.period.until },
      issuedAt: at,
      lines,
      seatTotalMinor,
      consumptionTotalMinor,
      totalMinor,
      limitMinor: input.limitMinor,
      status: "issued",
    },
  };
}
