/**
 * @fleetos/convergence — model-stack composition tests (F231).
 *
 * Bind the REAL implementations at the sanctioned composition site:
 * model-gateway routing + provider fallback bound against
 * agent-organization budgets through the gateway's BudgetCheckPort TYPE
 * seam (its concrete binding here is the org package's checkAgentBudget).
 */

import { describe, expect, it } from "vitest";
import { checkAgentBudget } from "@fleetos/agent-organizations";
import { assembleModelStack } from "../src/model-stack-assembly.js";
import {
  AGENT_A,
  budgetFixture,
  CAPABILITY,
  CHAIN_ORDER,
  NOW,
  providersFixture,
  REGISTRY,
  TENANT_A,
  TENANT_B,
} from "./helpers.js";

function stackFixture(
  budgets = [budgetFixture()],
  providers = providersFixture(),
) {
  return assembleModelStack({
    registry: REGISTRY,
    providers,
    chainOrder: CHAIN_ORDER,
    budgets,
  });
}

function requestFixture(overrides?: {
  readonly requestRef?: string;
  readonly priority?: number;
  readonly estimatedUnits?: number;
  readonly tenantId?: string;
  readonly agentId?: string;
  readonly budgetCeilingMinor?: number;
}) {
  return {
    tenantId: overrides?.tenantId ?? TENANT_A,
    agentId: overrides?.agentId ?? AGENT_A,
    capability: CAPABILITY,
    requiredCapabilities: ["reasoning", "tools"],
    priority: overrides?.priority ?? 1,
    estimatedUnits: overrides?.estimatedUnits ?? 100,
    budgetCeilingMinor: overrides?.budgetCeilingMinor ?? 10_000,
    requestRef: overrides?.requestRef ?? "req_000001",
    at: NOW,
  };
}

describe("model stack composition", () => {
  it("binds the REAL checkAgentBudget behind the gateway BudgetCheckPort", () => {
    const stack = stackFixture();
    const port = stack.budgetPort();
    const decision = port.check({
      tenantId: TENANT_A,
      agentId: AGENT_A,
      capability: CAPABILITY,
      unitsRequested: 100,
      spendRequestedMinor: 1000,
    });
    expect(decision.ok).toBe(true);
    // Identical answer from the direct org-side call — same implementation.
    const direct = checkAgentBudget([budgetFixture()], {
      tenantId: TENANT_A,
      agentId: AGENT_A,
      capability: CAPABILITY,
      unitsRequested: 100,
      spendRequestedMinor: 1000,
    });
    expect(JSON.stringify(decision)).toBe(JSON.stringify(direct));
  });

  it("selects the primary model when the org budget allows (rank 1, no fallback)", () => {
    const stack = stackFixture();
    const selection = stack.selectForRequest(requestFixture());
    expect(selection.ok).toBe(true);
    expect(selection.selectedModelId).toBe("mdl_primary");
    expect(selection.selectedProviderId).toBe("prov_a");
    expect(selection.budgetReasonCode).toBeNull();
    expect(selection.budgetRefused).toHaveLength(0);
    expect(selection.fallback?.ok).toBe(true);
    expect(selection.fallback?.hops[0]?.reasonCode).toBe("SELECTED");
    expect(selection.degradedMode.mode).toBe("full");
  });

  it("routes to the fallback model with the ORG's reason code when the budget is short", () => {
    // Remaining spend 400: primary costs 1000 (refused SPEND_EXHAUSTED),
    // alt costs 400 (served). Units are per-request so the units axis is
    // uniform across candidates — the spend axis is the routing signal.
    const stack = stackFixture([
      budgetFixture({ allocatedUnits: 10_000, allocatedSpendMinor: 400 }),
    ]);
    const selection = stack.selectForRequest(requestFixture());
    expect(selection.ok).toBe(true);
    expect(selection.selectedModelId).toBe("mdl_alt");
    expect(selection.selectedProviderId).toBe("prov_b");
    expect(selection.budgetReasonCode).toBe("SPEND_EXHAUSTED");
    expect(selection.budgetRefused.map((c) => c.modelId)).toEqual(["mdl_primary"]);
    expect(selection.usage?.costMinor).toBe(400);
  });

  it("refuses with the propagated UNITS_EXHAUSTED when no candidate fits the units axis", () => {
    // estimatedUnits 100 > allocatedUnits 50 for EVERY candidate — the
    // honest refusal, never a silent clamp (law A4).
    const stack = stackFixture([
      budgetFixture({ allocatedUnits: 50, allocatedSpendMinor: 10_000 }),
    ]);
    const selection = stack.selectForRequest(requestFixture());
    expect(selection.ok).toBe(false);
    expect(selection.budgetReasonCode).toBe("UNITS_EXHAUSTED");
    expect(selection.budgetRefused.map((c) => c.modelId)).toEqual([
      "mdl_primary",
      "mdl_alt",
    ]);
    expect(selection.usage).toBeNull();
    expect(stack.usageLedger()).toHaveLength(0);
  });

  it("refuses with the propagated SPEND_EXHAUSTED when even the cheapest tagged model is too dear", () => {
    // Remaining spend 100 < alt's 400 — both tagged candidates refused.
    const stack = stackFixture([
      budgetFixture({ allocatedUnits: 10_000, allocatedSpendMinor: 100 }),
    ]);
    const selection = stack.selectForRequest(requestFixture());
    expect(selection.ok).toBe(false);
    expect(selection.budgetReasonCode).toBe("SPEND_EXHAUSTED");
    expect(selection.usage).toBeNull();
    expect(stack.usageLedger()).toHaveLength(0);
  });

  it("replenishment restores the primary model (ceiling raised, consumption kept)", () => {
    const stack = stackFixture([
      budgetFixture({ allocatedUnits: 10_000, allocatedSpendMinor: 400 }),
    ]);
    const fallback = stack.selectForRequest(requestFixture());
    expect(fallback.selectedModelId).toBe("mdl_alt");
    const replenished = stack.replenish({
      tenantId: TENANT_A,
      agentId: AGENT_A,
      capability: CAPABILITY,
      additionalUnits: 0,
      additionalSpendMinor: 2_000,
    });
    expect(replenished.ok).toBe(true);
    const after = stack.selectForRequest(requestFixture({ requestRef: "req_000002" }));
    expect(after.selectedModelId).toBe("mdl_primary");
    expect(after.budgetReasonCode).toBeNull();
    // Consumption was PRESERVED across the replenishment (generation bump):
    // 400 (the mdl_alt fallback) + 1000 (the restored mdl_primary selection).
    const budget = stack.budgets().find(
      (b) => b.scope.refId === AGENT_A && b.capability === CAPABILITY,
    );
    expect(budget?.consumedSpendMinor).toBe(1400);
    expect(budget?.consumedUnits).toBe(200);
    expect(budget?.generation).toBe(2);
  });

  it("consumption after a successful selection is reflected in the org budget records", () => {
    const stack = stackFixture();
    const selection = stack.selectForRequest(requestFixture());
    expect(selection.ok).toBe(true);
    const budget = stack.budgets().find(
      (b) => b.scope.refId === AGENT_A && b.capability === CAPABILITY,
    );
    expect(budget?.consumedUnits).toBe(100);
    expect(budget?.consumedSpendMinor).toBe(1000);
  });

  it("surfaces the degraded mode + the full fallback ladder on every decision", () => {
    // prov_a down → mdl_primary unreachable → prov_b serves mdl_alt.
    const stack = stackFixture([budgetFixture()], providersFixture("down", "healthy"));
    const selection = stack.selectForRequest(requestFixture());
    expect(selection.ok).toBe(true);
    expect(selection.selectedModelId).toBe("mdl_alt");
    expect(selection.selectedProviderId).toBe("prov_b");
    expect(selection.degradedMode.mode).toBe("partial");
    expect(selection.fallback?.hops.map((h) => h.reasonCode)).toEqual([
      "PROVIDER_DOWN",
      "SELECTED",
    ]);
  });

  it("refuses honestly when NO provider can serve (all down, emergency-only)", () => {
    const stack = stackFixture(
      [budgetFixture()],
      providersFixture("down", "down"),
    );
    const selection = stack.selectForRequest(requestFixture());
    expect(selection.ok).toBe(false);
    expect(selection.degradedMode.mode).toBe("emergency-only");
    expect(selection.usage).toBeNull();
    expect(stack.usageLedger()).toHaveLength(0);
    expect(selection.routed?.ok).toBe(true); // routing itself succeeded
  });

  it("refuses with the propagated org reason when the agent has NO budget", () => {
    const stack = stackFixture([]);
    const selection = stack.selectForRequest(requestFixture());
    expect(selection.ok).toBe(false);
    expect(selection.budgetReasonCode).toBe("BUDGET_NOT_FOUND");
    expect(selection.usage).toBeNull();
    expect(stack.usageLedger()).toHaveLength(0);
  });

  it("fails closed cross-tenant: tenant B cannot spend tenant A's budget", () => {
    const stack = stackFixture();
    const selection = stack.selectForRequest(
      requestFixture({ tenantId: TENANT_B, requestRef: "req_cross_001" }),
    );
    expect(selection.ok).toBe(false);
    expect(selection.budgetReasonCode).toBe("BUDGET_NOT_FOUND");
    expect(stack.usageLedger()).toHaveLength(0);
  });

  it("appends chained usage entries and the ledger verifies", () => {
    const stack = stackFixture();
    stack.selectForRequest(requestFixture({ requestRef: "req_a" }));
    stack.selectForRequest(requestFixture({ requestRef: "req_b" }));
    const ledger = stack.usageLedger();
    expect(ledger).toHaveLength(2);
    expect(ledger[1]?.prevDigest).toBe(ledger[0]?.digest);
    const verification = stack.verifyUsageChain();
    expect(verification.ok).toBe(true);
  });

  it("a duplicate requestRef refuses DUPLICATE_REQUEST_REF — retries never double-charge", () => {
    const stack = stackFixture();
    const first = stack.selectForRequest(requestFixture({ requestRef: "req_dupe" }));
    expect(first.ok).toBe(true);
    const retry = stack.selectForRequest(requestFixture({ requestRef: "req_dupe" }));
    expect(retry.ok).toBe(false);
    expect(retry.usageReasonCode).toBe("DUPLICATE_REQUEST_REF");
    expect(stack.usageLedger()).toHaveLength(1);
    expect(stack.budgets()[0]?.consumedUnits).toBe(100); // charged ONCE
  });

  it("respects the gateway priority policy: low urgency orders cost-first", () => {
    const stack = stackFixture();
    const selection = stack.selectForRequest(requestFixture({ priority: 5 }));
    expect(selection.ok).toBe(true);
    // Cost-first: mdl_cheap (2 minor/unit) is the rank-1 candidate but lacks
    // the "tools" tag → the cheapest WITH the tags is mdl_alt (4 minor/unit).
    expect(selection.selectedModelId).toBe("mdl_alt");
    expect(selection.routed?.ok).toBe(true);
    if (selection.routed?.ok) {
      expect(selection.routed.orderingRule).toBe("urgency-cost-first");
    }
  });

  it("propagates typed routing refusals from the gateway (no capabilities match)", () => {
    const stack = stackFixture();
    const selection = stack.selectForRequest({
      ...requestFixture(),
      requiredCapabilities: ["quantum-entanglement"],
    });
    expect(selection.ok).toBe(false);
    expect(selection.routed?.ok).toBe(false);
    if (selection.routed && !selection.routed.ok) {
      expect(selection.routed.reasonCode).toBe("NO_MODEL_WITH_CAPABILITIES");
      expect(selection.routed.missingCapabilities).toEqual(["quantum-entanglement"]);
    }
    expect(stack.usageLedger()).toHaveLength(0);
  });

  it("is deterministic: identical requests on fresh stacks are byte-identical", () => {
    const a = stackFixture().selectForRequest(requestFixture());
    const b = stackFixture().selectForRequest(requestFixture());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
