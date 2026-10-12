/**
 * @fleetos/acceptance-commerce — tenant-billing step drivers (F331C row
 * 35, Wave 13 lane C).
 *
 * Interprets typed journey steps against the REAL public entry points:
 * the seed appends usage records through the REAL @fleetos/model-gateway
 * appendUsage (chained digests, the documented budget-port seam bound to
 * the REAL agent-organizations check — the world's composition site),
 * then every invoice step drives the REAL @fleetos/software
 * issueTenantInvoice over the world's REAL subscription + entitlement
 * grants (or constructed REAL records for the refusal probes).
 *
 * Time law: `at: "now"` resolves to the run anchor
 * `state.time.startedAt` (the F331C seam); the usage records and billing
 * periods are ABSOLUTE world facts. The issuance gate compares the two
 * (PERIOD_NOT_ENDED) — a genuine window-boundary transition. Fresh world
 * per run keeps everything deterministic; refusals are honest facts.
 */

import type { FactValue } from "./journey-contracts.js";
import type { TenantBillingStep } from "./journey-contracts-f331c.js";
import type { JourneyState } from "./journey-world.js";
import { realBudgetPort, logPush } from "./journey-world.js";
import type { UsageLedgerEntry } from "@fleetos/model-gateway";
import { appendUsage, verifyUsageLedgerChain, sumUsageLedger } from "@fleetos/model-gateway";
import type { Subscription, EntitlementGrant, TenantInvoice } from "@fleetos/software";
import { issueTenantInvoice } from "@fleetos/software";

export type DriverFacts = Record<string, FactValue>;

interface BillingSeam {
  ledger: UsageLedgerEntry[];
  invoices: TenantInvoice[];
}

const seams = new WeakMap<JourneyState, BillingSeam>();

function seamFor(state: JourneyState): BillingSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { ledger: [], invoices: [] };
    seams.set(state, seam);
  }
  return seam;
}

function resolveAt(at: "now" | number, state: JourneyState): number {
  return at === "now" ? state.time.startedAt : at;
}

let constructedCounter = 0;
function constructedSubscription(
  state: JourneyState,
  spec: { readonly status: "active" | "expired" | "cancelled"; readonly validUntil: string | null },
): Subscription {
  constructedCounter += 1;
  return {
    id: { kind: "subscription", value: `sub-tx-${constructedCounter}` },
    tenant: state.tenant,
    sku: "FLEET-OPS-PRO",
    seatsTotal: 5,
    status: spec.status,
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: spec.validUntil,
  };
}

function constructedGrants(state: JourneyState, spec: readonly { seats: number }[], subscription: Subscription): EntitlementGrant[] {
  const subscriptionId = subscription.id.kind === "subscription" ? subscription.id.value : "";
  return spec.map((g, i) => ({
    id: `grant-tx-${i + 1}`,
    tenant: state.tenant,
    subscriptionId,
    catalogEntryId: "cat-routeplanner",
    assigneeId: `agent-${i + 1}`,
    seats: g.seats,
    status: "granted" as const,
    grantedAt: 1,
    assignedAt: null,
    revokedAt: null,
    revokedReason: null,
    expiresAt: null,
  }));
}

function serializeLines(invoice: TenantInvoice): readonly string[] {
  return invoice.lines.map((l) =>
    l.kind === "seat"
      ? `seat:${l.seats}x${l.unitRateMinor}:${l.amountMinor}`
      : `consumption:${l.modelId}:${l.requests}req:${l.units}u:${l.amountMinor}`,
  );
}

export async function runTenantBillingStep(
  step: TenantBillingStep,
  state: JourneyState,
): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "billing-usage-seed": {
      for (const record of step.records) {
        const result = appendUsage(seam.ledger, realBudgetPort(state), {
          tenantId: state.tenant.tenantId,
          agentId: "agent-1",
          requestRef: record.requestRef,
          modelId: record.modelId,
          providerId: "provider-one",
          capability: record.capability,
          units: record.units,
          costMinor: record.costMinor,
          at: record.at,
        });
        if (!result.ok) throw new Error(`billing-seed: appendUsage refused ${result.reasonCode}`);
        seam.ledger = [...result.ledger];
      }
      const foreign = step.foreignProbe === undefined
        ? null
        : appendUsage(seam.ledger, realBudgetPort(state), {
            tenantId: state.otherTenant.tenantId,
            agentId: "agent-1",
            requestRef: step.foreignProbe.requestRef,
            modelId: "model-beta-cheap",
            providerId: "provider-one",
            capability: "model_invoke",
            units: 1,
            costMinor: 100,
            at: state.time.startedAt - 86_400_000,
          });
      const chain = verifyUsageLedgerChain(seam.ledger);
      const totals = sumUsageLedger(seam.ledger);
      const foreignNote = foreign !== null && !foreign.ok ? `|foreign:refused:${foreign.reasonCode}` : "";
      logPush(state, "bil.seedLog", `${seam.ledger.map((e) => `${e.seq}:${e.requestRef}`).join("|")}${foreignNote}`);
      return {
        [`bil.seed.${step.factKey}.count`]: totals.entries,
        [`bil.seed.${step.factKey}.totalUnits`]: totals.totalUnits,
        [`bil.seed.${step.factKey}.totalCostMinor`]: totals.totalCostMinor,
        [`bil.seed.${step.factKey}.chainOk`]: chain.ok,
        [`bil.seed.${step.factKey}.foreignAppend`]: foreign !== null && !foreign.ok ? foreign.reasonCode : "appended",
      };
    }
    case "billing-invoice-issue": {
      const subscription = step.subscription === "world"
        ? state.software.subscription
        : constructedSubscription(state, step.subscription);
      const grants = step.grants === "world"
        ? state.software.grants
        : constructedGrants(state, step.grants, subscription);
      const usage = step.usage === "seeded" ? seam.ledger : [];
      const foreignRecord = step.foreignRecord === undefined
        ? []
        : [{
            tenantId: state.otherTenant.tenantId,
            agentId: "agent-2",
            requestRef: step.foreignRecord.requestRef,
            modelId: "model-beta-cheap",
            capability: "model_invoke",
            units: 5,
            costMinor: 500,
            at: state.time.startedAt - 2 * 86_400_000,
          }];
      const result = issueTenantInvoice(
        state.tenant,
        {
          invoiceId: step.invoiceId,
          subscription,
          grants,
          usageRecords: [...usage, ...foreignRecord],
          period: { from: step.period.from, until: step.period.until },
          seatRateMinor: step.seatRateMinor,
          limitMinor: step.limitMinor,
          ...(step.graceMs !== undefined ? { graceMs: step.graceMs } : {}),
        },
        seam.invoices,
        resolveAt(step.at, state),
      );
      if (!result.ok) {
        logPush(state, "bil.invoiceLog", `${step.invoiceId}:refused:${result.reasonCode}`);
        return {
          [`bil.invoice.${step.factKey}.ok`]: false,
          [`bil.invoice.${step.factKey}.reasonCode`]: result.reasonCode,
          [`bil.invoice.${step.factKey}.status`]: null,
          [`bil.invoice.${step.factKey}.totalMinor`]: result.totalMinor,
          [`bil.invoice.${step.factKey}.overshootMinor`]: result.overshootMinor,
        };
      }
      seam.invoices = [...seam.invoices, result.invoice];
      logPush(state, "bil.invoiceLog", `${step.invoiceId}:issued:${result.invoice.totalMinor}`);
      return {
        [`bil.invoice.${step.factKey}.ok`]: true,
        [`bil.invoice.${step.factKey}.reasonCode`]: null,
        [`bil.invoice.${step.factKey}.status`]: result.invoice.status,
        [`bil.invoice.${step.factKey}.totalMinor`]: result.invoice.totalMinor,
        [`bil.invoice.${step.factKey}.seatTotalMinor`]: result.invoice.seatTotalMinor,
        [`bil.invoice.${step.factKey}.consumptionTotalMinor`]: result.invoice.consumptionTotalMinor,
        [`bil.invoice.${step.factKey}.lines`]: serializeLines(result.invoice),
        [`bil.invoice.${step.factKey}.issuedAt`]: result.invoice.issuedAt,
      };
    }
  }
}
