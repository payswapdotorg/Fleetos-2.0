import { describe, expect, it } from "vitest";
import type { RoleAssignment, CapabilityBudgetRecord } from "@fleetos/agent-organizations";
import type {
  UsageLedgerEntry,
  ModelSelectionDecision,
  BudgetCheckPort,
  SelectionReasonCode,
} from "@fleetos/model-gateway";
import { appendUsage } from "@fleetos/model-gateway";
import {
  buildRoleAssignmentBoard,
  buildCapabilityBudgetBoard,
  buildModelUsageRollup,
  summarizeSelectionReasonCodes,
} from "../src/org-views.js";

const TENANT = { tenantId: "acme" };
const OTHER = { tenantId: "other" };
const NOW = "2026-01-01T00:00:00Z";

const alwaysOkPort: BudgetCheckPort = {
  check: () => ({ ok: true, remainingUnits: 1000, remainingSpendMinor: 100000 }),
};

function assignment(
  id: string,
  status: RoleAssignment["status"],
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  return {
    id,
    tenant: TENANT,
    organizationId: "org-1",
    agentId: `agent-${id}`,
    roleId: "role-technician",
    status,
    assignedAt: 100,
    activatedAt: status === "assigned" ? null : 200,
    relievedAt: status === "relieved" ? 300 : null,
    reliefReason: status === "relieved" ? "rotation" : null,
    digest: `assignment-digest-${id}`,
    ...overrides,
  };
}

describe("buildRoleAssignmentBoard", () => {
  it("groups assignments into the three lifecycle columns, carrying the domain digest", () => {
    const result = buildRoleAssignmentBoard({
      tenant: TENANT,
      assignments: [
        assignment("a-2", "active"),
        assignment("a-1", "assigned"),
        assignment("a-3", "relieved"),
      ],
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.board.columns.map((c) => c.status)).toEqual(["assigned", "active", "relieved"]);
    const relieved = result.board.columns[2]?.cards[0];
    expect(relieved?.reliefReason).toBe("rotation");
    expect(relieved?.recordDigest).toBe("assignment-digest-a-3");
    expect(relieved?.provenance).toEqual([
      { recordKind: "role-assignment", recordId: "a-3" },
    ]);
  });

  it("sorts cards lexically and is input-order independent", () => {
    const items = [assignment("a-b", "active"), assignment("a-a", "active")];
    const a = buildRoleAssignmentBoard({ tenant: TENANT, assignments: items, computedAt: NOW });
    const b = buildRoleAssignmentBoard({
      tenant: TENANT,
      assignments: [...items].reverse(),
      computedAt: NOW,
    });
    if (!a.ok || !b.ok) throw new Error("refused");
    expect(JSON.stringify(a.board)).toBe(JSON.stringify(b.board));
    expect(a.board.columns[1]?.cards.map((c) => c.assignmentId)).toEqual(["a-a", "a-b"]);
  });

  it("refuses the whole board on a cross-tenant assignment", () => {
    const result = buildRoleAssignmentBoard({
      tenant: TENANT,
      assignments: [assignment("a-1", "active"), { ...assignment("a-x", "active"), tenant: OTHER }],
      computedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("TENANT_MISMATCH");
      expect(result.detail).toBe("a-x");
    }
  });
});

describe("buildCapabilityBudgetBoard", () => {
  const budget = (
    id: string,
    allocatedUnits: number,
    consumedUnits: number,
    allocatedSpend: number,
    consumedSpend: number,
  ): CapabilityBudgetRecord => ({
    id,
    tenant: TENANT,
    scope: { kind: "agent", refId: `agent-${id}` },
    capability: "model-inference",
    allocatedUnits,
    allocatedSpendMinor: allocatedSpend,
    consumedUnits,
    consumedSpendMinor: consumedSpend,
    generation: 2,
  });

  it("computes unit + spend utilization in exact integer bps with domain phases", () => {
    const result = buildCapabilityBudgetBoard({
      tenant: TENANT,
      budgets: [
        budget("b-1", 10, 3, 10000, 2500),
        budget("b-2", 5, 5, 5000, 100),
        budget("b-3", 8, 0, 8000, 0),
      ],
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.rows[0]).toMatchObject({
      budgetId: "b-1",
      unitUtilizationBps: 3000,
      spendUtilizationBps: 2500,
      remainingUnits: 7,
      remainingSpendMinor: 7500,
      generation: 2,
      phase: "consumed",
    });
    // exhausted on EITHER axis (units at ceiling, spend far below) — domain rule
    expect(result.rows[1]?.phase).toBe("exhausted");
    expect(result.rows[2]?.phase).toBe("allocated");
    expect(result.totals).toEqual({ budgetCount: 3, exhaustedCount: 1 });
  });

  it("presents every ceiling as ceiling-satisfied-not-authorization", () => {
    const result = buildCapabilityBudgetBoard({
      tenant: TENANT,
      budgets: [budget("b-1", 10, 3, 10000, 2500)],
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.rows.every((r) => r.ceilingNote === "ceiling-satisfied-not-authorization")).toBe(
      true,
    );
  });

  it("refuses on a cross-tenant budget record", () => {
    const result = buildCapabilityBudgetBoard({
      tenant: TENANT,
      budgets: [{ ...budget("b-x", 10, 3, 10000, 2500), tenant: OTHER }],
      computedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TENANT_MISMATCH");
  });
});

describe("buildModelUsageRollup", () => {
  function ledgerOf(): readonly UsageLedgerEntry[] {
    let ledger: readonly UsageLedgerEntry[] = [];
    const specs = [
      { agentId: "agent-2", modelId: "m-small", providerId: "p-1", units: 100, costMinor: 500, at: 1 },
      { agentId: "agent-1", modelId: "m-big", providerId: "p-2", units: 50, costMinor: 1500, at: 2 },
      { agentId: "agent-2", modelId: "m-big", providerId: "p-2", units: 25, costMinor: 750, at: 3 },
    ];
    for (const spec of specs) {
      const appended = appendUsage(ledger, alwaysOkPort, {
        tenantId: TENANT.tenantId,
        requestRef: `req-${spec.at}`,
        capability: "model-inference",
        ...spec,
      });
      if (!appended.ok) throw new Error(appended.reasonCode);
      ledger = appended.ledger;
    }
    return ledger;
  }

  it("aggregates per agent and per model with exact integer totals", () => {
    const result = buildModelUsageRollup({
      tenant: TENANT,
      usage: ledgerOf(),
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.rollup.totals).toEqual({ entries: 3, totalUnits: 175, totalCostMinor: 2750 });
    expect(result.rollup.byAgent).toEqual([
      { agentId: "agent-1", requests: 1, units: 50, costMinor: 1500 },
      { agentId: "agent-2", requests: 2, units: 125, costMinor: 1250 },
    ]);
    expect(result.rollup.byModel).toEqual([
      { modelId: "m-big", providerId: "p-2", requests: 2, units: 75, costMinor: 2250 },
      { modelId: "m-small", providerId: "p-1", requests: 1, units: 100, costMinor: 500 },
    ]);
    expect(result.rollup.chain).toEqual({ ok: true, reasonCode: null, brokenAtSeq: null });
  });

  it("surfaces chain tampering honestly — the earliest broken seq is named", () => {
    const ledger = ledgerOf();
    const tampered = ledger.map((e) =>
      e.seq === 2 ? { ...e, costMinor: e.costMinor + 1 } : e,
    );
    const result = buildModelUsageRollup({
      tenant: TENANT,
      usage: tampered,
      computedAt: NOW,
    });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.rollup.chain.ok).toBe(false);
    expect(result.rollup.chain.reasonCode).toBe("CHAIN_DIGEST_MISMATCH");
    expect(result.rollup.chain.brokenAtSeq).toBe(2);
  });

  it("refuses on a cross-tenant usage entry", () => {
    const ledger = ledgerOf().map((e) => ({ ...e, tenantId: OTHER.tenantId }));
    const result = buildModelUsageRollup({
      tenant: TENANT,
      usage: ledger,
      computedAt: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TENANT_MISMATCH");
  });
});

describe("summarizeSelectionReasonCodes", () => {
  const selected = (orderingRule: "urgency-richness-first" | "urgency-cost-first"): ModelSelectionDecision => ({
    ok: true,
    selectedModelId: "m-1",
    providerId: "p-1",
    estimatedCostMinor: 100,
    orderingRule,
    tieBreakRule: "model-id-lexical",
    rankedCandidates: [],
    candidatesConsidered: 1,
    digest: "sel_x",
  });
  const refused = (reasonCode: SelectionReasonCode): ModelSelectionDecision => ({
    ok: false,
    reasonCode,
    detail: null,
    missingCapabilities: null,
    contextShortfallUnits: null,
    cheapestCostMinor: null,
    budgetOvershootMinor: null,
    candidatesConsidered: 0,
    digest: "sel_y",
  });

  it("counts every decision with its reason code — the nothing-silent invariant", () => {
    const summary = summarizeSelectionReasonCodes([
      selected("urgency-richness-first"),
      selected("urgency-cost-first"),
      selected("urgency-cost-first"),
      refused("NO_MODEL_WITH_CAPABILITIES"),
      refused("NO_MODEL_WITH_CAPABILITIES"),
      refused("BUDGET_CEILING_EXCEEDED"),
    ]);
    expect(summary.decisions).toBe(6);
    expect(summary.selected).toBe(3);
    expect(summary.selectedByOrderingRule).toEqual([
      { code: "urgency-cost-first", count: 2 },
      { code: "urgency-richness-first", count: 1 },
    ]);
    expect(summary.refusedByReasonCode).toEqual([
      { code: "BUDGET_CEILING_EXCEEDED", count: 1 },
      { code: "NO_MODEL_WITH_CAPABILITIES", count: 2 },
    ]);
    expect(summary.accountedFor).toBe(6);
  });

  it("is deterministic and handles the empty decision list", () => {
    const empty = summarizeSelectionReasonCodes([]);
    expect(empty).toEqual({
      kind: "selection-reason-summary",
      decisions: 0,
      selected: 0,
      selectedByOrderingRule: [],
      refusedByReasonCode: [],
      accountedFor: 0,
    });
    const twice = summarizeSelectionReasonCodes([refused("TENANT_ID_EMPTY"), selected("urgency-cost-first")]);
    expect(JSON.stringify(twice)).toBe(
      JSON.stringify(summarizeSelectionReasonCodes([refused("TENANT_ID_EMPTY"), selected("urgency-cost-first")])),
    );
  });
});
