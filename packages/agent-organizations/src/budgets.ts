/**
 * @fleetos/agent-organizations — capability budgets at organization grade
 * (F230C, Wave 3 lane C).
 *
 * Laws:
 *   A4  — budget exceedance is REFUSED with the exact overshoot, never
 *         silently clamped or overflowed.
 *   A5/A6 — budgets are CEILINGS, not authorizations. A passing budget
 *           check authorizes NOTHING by itself; Guardian adjudicates.
 *   A8   — tenant isolation, fail-closed.
 *
 * Lifecycle: allocated → consumed → exhausted → replenished (back to
 * consumed/allocated with a larger ceiling — consumption is NEVER reset).
 * Invariants: consumption never exceeds allocation; integer minor units
 * for spend; integer units for usage. Pure functions only.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Budget records — per-role or per-agent scope.
// ---------------------------------------------------------------------------

export type BudgetScopeKind = "role" | "agent";

export interface BudgetScope {
  readonly kind: BudgetScopeKind;
  readonly refId: string;
}

export interface CapabilityBudgetRecord {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly scope: BudgetScope;
  readonly capability: string;
  readonly allocatedUnits: number;
  readonly allocatedSpendMinor: number;
  readonly consumedUnits: number;
  readonly consumedSpendMinor: number;
  /** Lifecycle generation — bumped on each replenishment. */
  readonly generation: number;
}

export type BudgetLifecyclePhase = "allocated" | "consumed" | "exhausted";

/**
 * Deterministic exhaustion classification:
 *   allocated — nothing consumed yet;
 *   consumed  — 0 < consumption < allocation (either axis);
 *   exhausted — consumption has reached the allocation on EITHER axis.
 */
export function classifyBudget(budget: CapabilityBudgetRecord): BudgetLifecyclePhase {
  if (budget.consumedUnits >= budget.allocatedUnits || budget.consumedSpendMinor >= budget.allocatedSpendMinor) {
    return "exhausted";
  }
  if (budget.consumedUnits > 0 || budget.consumedSpendMinor > 0) {
    return "consumed";
  }
  return "allocated";
}

export type BudgetRecordReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "BUDGET_ID_EMPTY"
  | "SCOPE_REF_EMPTY"
  | "CAPABILITY_EMPTY"
  | "NEGATIVE_ALLOCATION_UNITS"
  | "NEGATIVE_ALLOCATION_SPEND"
  | "NEGATIVE_CONSUMPTION"
  | "CONSUMPTION_EXCEEDS_ALLOCATION"
  | "NON_INTEGER_AMOUNT";

export type BudgetRecordValidation =
  | { readonly ok: true; readonly budget: CapabilityBudgetRecord }
  | { readonly ok: false; readonly reasonCode: BudgetRecordReasonCode };

/**
 * Invariant-validating constructor: budgets are never negative-allocated
 * and consumption NEVER exceeds allocation at creation. Pure.
 */
export function validateBudgetRecord(budget: CapabilityBudgetRecord): BudgetRecordValidation {
  const tenantCheck = validateTenantScope(budget.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (typeof budget.id !== "string" || budget.id.length === 0) {
    return { ok: false, reasonCode: "BUDGET_ID_EMPTY" };
  }
  if (typeof budget.scope.refId !== "string" || budget.scope.refId.length === 0) {
    return { ok: false, reasonCode: "SCOPE_REF_EMPTY" };
  }
  if (typeof budget.capability !== "string" || budget.capability.length === 0) {
    return { ok: false, reasonCode: "CAPABILITY_EMPTY" };
  }
  if (!Number.isInteger(budget.allocatedUnits) || !Number.isInteger(budget.allocatedSpendMinor)) {
    return { ok: false, reasonCode: "NON_INTEGER_AMOUNT" };
  }
  if (budget.allocatedUnits < 0) return { ok: false, reasonCode: "NEGATIVE_ALLOCATION_UNITS" };
  if (budget.allocatedSpendMinor < 0) return { ok: false, reasonCode: "NEGATIVE_ALLOCATION_SPEND" };
  if (budget.consumedUnits < 0 || budget.consumedSpendMinor < 0) {
    return { ok: false, reasonCode: "NEGATIVE_CONSUMPTION" };
  }
  if (budget.consumedUnits > budget.allocatedUnits || budget.consumedSpendMinor > budget.allocatedSpendMinor) {
    return { ok: false, reasonCode: "CONSUMPTION_EXCEEDS_ALLOCATION" };
  }
  return { ok: true, budget };
}

// ---------------------------------------------------------------------------
// Consumption — pure budget checks; exceedance refused with exact overshoot.
// ---------------------------------------------------------------------------

export interface ConsumptionRequest {
  readonly units: number;
  readonly spendMinor: number;
}

export type BudgetConsumptionResult =
  | { readonly ok: true; readonly budget: CapabilityBudgetRecord; readonly remainingUnits: number; readonly remainingSpendMinor: number }
  | {
      readonly ok: false;
      readonly reasonCode: "NEGATIVE_UNITS" | "NEGATIVE_SPEND" | "NON_INTEGER_AMOUNT" | "BUDGET_EXHAUSTED_UNITS" | "BUDGET_EXHAUSTED_SPEND";
      readonly overshootUnits: number | null;
      readonly overshootSpendMinor: number | null;
    };

/**
 * Consume from a budget. PURE — returns a new record; the input is never
 * mutated. Over-consumption is REFUSED with the exact overshoot (never
 * clamped to the ceiling, law A4).
 */
export function consumeFromBudget(
  budget: CapabilityBudgetRecord,
  request: ConsumptionRequest,
): BudgetConsumptionResult {
  if (!Number.isInteger(request.units) || !Number.isInteger(request.spendMinor)) {
    return { ok: false, reasonCode: "NON_INTEGER_AMOUNT", overshootUnits: null, overshootSpendMinor: null };
  }
  if (request.units < 0) {
    return { ok: false, reasonCode: "NEGATIVE_UNITS", overshootUnits: null, overshootSpendMinor: null };
  }
  if (request.spendMinor < 0) {
    return { ok: false, reasonCode: "NEGATIVE_SPEND", overshootUnits: null, overshootSpendMinor: null };
  }
  const nextUnits = budget.consumedUnits + request.units;
  const nextSpend = budget.consumedSpendMinor + request.spendMinor;
  if (nextUnits > budget.allocatedUnits) {
    return {
      ok: false,
      reasonCode: "BUDGET_EXHAUSTED_UNITS",
      overshootUnits: nextUnits - budget.allocatedUnits,
      overshootSpendMinor: null,
    };
  }
  if (nextSpend > budget.allocatedSpendMinor) {
    return {
      ok: false,
      reasonCode: "BUDGET_EXHAUSTED_SPEND",
      overshootUnits: null,
      overshootSpendMinor: nextSpend - budget.allocatedSpendMinor,
    };
  }
  const next: CapabilityBudgetRecord = { ...budget, consumedUnits: nextUnits, consumedSpendMinor: nextSpend };
  return {
    ok: true,
    budget: next,
    remainingUnits: budget.allocatedUnits - nextUnits,
    remainingSpendMinor: budget.allocatedSpendMinor - nextSpend,
  };
}

// ---------------------------------------------------------------------------
// Replenishment — grows the ceiling; consumption is preserved, never reset.
// ---------------------------------------------------------------------------

export type BudgetReplenishmentResult =
  | { readonly ok: true; readonly budget: CapabilityBudgetRecord }
  | { readonly ok: false; readonly reasonCode: "NEGATIVE_REPLENISHMENT" | "NON_INTEGER_AMOUNT" | "TENANT_SCOPE_MISSING" };

/**
 * Replenish a budget: allocation grows by the additional amounts and the
 * generation counter increments. Existing consumption is PRESERVED — a
 * replenishment is a ceiling raise, not a reset. Pure.
 */
export function replenishBudget(
  budget: CapabilityBudgetRecord,
  addition: ConsumptionRequest,
): BudgetReplenishmentResult {
  const tenantCheck = validateTenantScope(budget.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!Number.isInteger(addition.units) || !Number.isInteger(addition.spendMinor)) {
    return { ok: false, reasonCode: "NON_INTEGER_AMOUNT" };
  }
  if (addition.units < 0 || addition.spendMinor < 0) {
    return { ok: false, reasonCode: "NEGATIVE_REPLENISHMENT" };
  }
  return {
    ok: true,
    budget: {
      ...budget,
      allocatedUnits: budget.allocatedUnits + addition.units,
      allocatedSpendMinor: budget.allocatedSpendMinor + addition.spendMinor,
      generation: budget.generation + 1,
    },
  };
}

// ---------------------------------------------------------------------------
// The cross-package budget-check SEAM for the model gateway.
//
// This shape is STRUCTURALLY compatible with model-gateway's local
// `BudgetCheckPort` (no runtime import either way — the TL composes them).
// Checking a budget authorizes nothing (law A5/A6): it only answers
// "does the ceiling still have room".
// ---------------------------------------------------------------------------

export interface GatewayBudgetQuery {
  readonly tenantId: string;
  readonly agentId: string;
  readonly capability: string;
  readonly unitsRequested: number;
  readonly spendRequestedMinor: number;
}

export type AgentBudgetReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "BUDGET_NOT_FOUND"
  | "UNITS_EXHAUSTED"
  | "SPEND_EXHAUSTED"
  | "NEGATIVE_REQUEST";

export interface GatewayBudgetDecisionOk {
  readonly ok: true;
  readonly remainingUnits: number;
  readonly remainingSpendMinor: number;
}
export interface GatewayBudgetDecisionRefused {
  readonly ok: false;
  readonly reasonCode: AgentBudgetReasonCode;
  readonly budgetId: string | null;
  readonly overshootUnits: number | null;
  readonly overshootSpendMinor: number | null;
}
export type GatewayBudgetDecision = GatewayBudgetDecisionOk | GatewayBudgetDecisionRefused;

/**
 * Check agent-scoped budgets for a gateway usage request. PURE fold over
 * the budget records: finds the agent's budget for the capability and
 * answers the ceiling question with exact remainders/overshoots. An absent
 * budget OR an ambiguous (duplicate) configuration refuses closed with
 * `BUDGET_NOT_FOUND` — never a silent merge.
 */
export function checkAgentBudget(
  records: readonly CapabilityBudgetRecord[],
  query: GatewayBudgetQuery,
): GatewayBudgetDecision {
  if (query.unitsRequested < 0 || query.spendRequestedMinor < 0) {
    return {
      ok: false,
      reasonCode: "NEGATIVE_REQUEST",
      budgetId: null,
      overshootUnits: null,
      overshootSpendMinor: null,
    };
  }
  const matching = records.filter(
    (r) =>
      r.scope.kind === "agent" &&
      r.scope.refId === query.agentId &&
      r.capability === query.capability &&
      r.tenant.tenantId === query.tenantId,
  );
  if (matching.length !== 1) {
    return {
      ok: false,
      reasonCode: "BUDGET_NOT_FOUND",
      budgetId: null,
      overshootUnits: null,
      overshootSpendMinor: null,
    };
  }
  const budget = matching[0] as CapabilityBudgetRecord;
  const nextUnits = budget.consumedUnits + query.unitsRequested;
  const nextSpend = budget.consumedSpendMinor + query.spendRequestedMinor;
  if (nextUnits > budget.allocatedUnits) {
    return {
      ok: false,
      reasonCode: "UNITS_EXHAUSTED",
      budgetId: budget.id,
      overshootUnits: nextUnits - budget.allocatedUnits,
      overshootSpendMinor: null,
    };
  }
  if (nextSpend > budget.allocatedSpendMinor) {
    return {
      ok: false,
      reasonCode: "SPEND_EXHAUSTED",
      budgetId: budget.id,
      overshootUnits: null,
      overshootSpendMinor: nextSpend - budget.allocatedSpendMinor,
    };
  }
  return {
    ok: true,
    remainingUnits: budget.allocatedUnits - nextUnits,
    remainingSpendMinor: budget.allocatedSpendMinor - nextSpend,
  };
}

// ---------------------------------------------------------------------------
// Budget digest (law A19) + utilization in integer bps.
// ---------------------------------------------------------------------------

export function computeBudgetDigest(budget: CapabilityBudgetRecord): string {
  return `budget_${fnv1a32([
    budget.tenant.tenantId,
    budget.scope.kind,
    budget.scope.refId,
    budget.capability,
    budget.allocatedUnits,
    budget.allocatedSpendMinor,
    budget.consumedUnits,
    budget.consumedSpendMinor,
    budget.generation,
  ])}`;
}

/** Utilization in integer basis points, floored. 0 when allocation is 0. */
export function budgetUtilizationBps(budget: CapabilityBudgetRecord): number {
  if (budget.allocatedUnits === 0) return 0;
  return Math.floor((budget.consumedUnits * 10000) / budget.allocatedUnits);
}
