/**
 * @fleetos/acceptance-commerce — agent-organization/model-gateway drivers.
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/agent-organizations and @fleetos/model-gateway (composed at
 * this composition site through the documented BudgetCheckPort seam —
 * `checkAgentBudget` is the REAL budget ceiling fold). Facts are verbatim
 * REAL outputs.
 */

import type { FactValue, OrgStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, logPush, realBudgetPort } from "./journey-world.js";
import type { OrgEvent, OrgJournalEntry } from "@fleetos/agent-organizations";
import {
  nextOrgEntry,
  prepareOptimizationInputs,
  allocateRoles,
  projectWhatIf,
  foldOrgSnapshot,
} from "@fleetos/agent-organizations";
import { appendUsage, verifyUsageLedgerChain } from "@fleetos/model-gateway";
import { buildModelUsageRollup, buildCapabilityBudgetBoard } from "@fleetos/experience-work-commerce";

export type DriverFacts = Record<string, FactValue>;

export async function runOrgStep(step: OrgStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "usage-append": {
      const result = appendUsage(state.org.usage, realBudgetPort(state), {
        tenantId: state.tenant.tenantId,
        agentId: step.agentId,
        requestRef: step.requestRef,
        modelId: step.modelId,
        providerId: step.providerId,
        capability: step.capability,
        units: step.units,
        costMinor: step.costMinor,
        at: CLOCK.t1,
      });
      if (!result.ok) {
        logPush(state, "usage.log", `false:${result.reasonCode}:${result.budgetReasonCode ?? "-"}`);
        return {
          "usage.ok": false,
          "usage.reasonCode": result.reasonCode,
          "usage.budgetReasonCode": result.budgetReasonCode,
        };
      }
      state.org.usage = [...result.ledger];
      logPush(state, "usage.log", `true:${result.appended.seq}`);
      return {
        "usage.ok": true,
        "usage.seq": result.appended.seq,
        "usage.chainOk": verifyUsageLedgerChain(result.ledger).ok,
        "usage.entryCount": result.ledger.length,
      };
    }
    case "usage-rollup-view": {
      const result = buildModelUsageRollup({
        tenant: state.tenant,
        usage: state.org.usage,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "usageRollup.ok": false, "usageRollup.reasonCode": result.reasonCode };
      return {
        "usageRollup.ok": true,
        "usageRollup.totalEntries": result.rollup.totals.entries,
        "usageRollup.totalUnits": result.rollup.totals.totalUnits,
        "usageRollup.totalCostMinor": result.rollup.totals.totalCostMinor,
        "usageRollup.chainOk": result.rollup.chain.ok,
        "usageRollup.byAgentCount": result.rollup.byAgent.length,
        "usageRollup.digest": result.rollup.digest,
      };
    }
    case "org-journal-append": {
      let prev: OrgJournalEntry | null = state.org.journal[state.org.journal.length - 1] ?? null;
      for (const [index, event] of step.events.entries()) {
        const orgEvent: OrgEvent = {
          kind: event.kind as OrgEvent["kind"],
          teamId: event.teamId,
          agentId: event.agentId,
          roleId: event.roleId,
          capability: event.capability,
          units: event.units,
          spendMinor: event.spendMinor,
        };
        const entry = nextOrgEntry({
          tenant: state.tenant,
          organizationId: "org-1",
          event: orgEvent,
          at: CLOCK.t0 + index,
          prev,
        });
        state.org.journal = [...state.org.journal, entry];
        prev = entry;
      }
      const snapshot = foldOrgSnapshot(state.org.journal);
      state.org.baselineSnapshotDigest = snapshot.digest;
      return {
        "journal.entries": state.org.journal.length,
        "journal.snapshotDigest": snapshot.digest,
        "journal.enrolledAgents": snapshot.enrolledAgents.length,
      };
    }
    case "org-prepare-optimization": {
      const validation = prepareOptimizationInputs({
        tenant: state.tenant,
        organizationId: "org-1",
        journal: state.org.journal,
        usageExcerpt: state.org.usage,
        roles: state.org.roles,
        budgets: state.org.budgets,
        goals: { costWeightBps: 3000, capabilityFitWeightBps: 6000, latencyWeightBps: 1000 },
        constraints: {
          policyCeilings: {
            maxConcurrentRolesPerAgent: 2,
            maxRoleBudgetUnits: 1000,
            maxRoleBudgetSpendMinor: 50_000,
            maxAgentsPerTeam: 5,
          },
          budgetFloors: [{ capability: "model_invoke", minUnits: 200, minSpendMinor: 10_000 }],
          revokedCapabilities: [],
        },
      });
      if (!validation.ok) {
        return {
          "opt.prepare.ok": false,
          "opt.prepare.reasonCode": validation.reasonCode,
          "opt.prepare.detail": validation.detail ?? null,
        };
      }
      state.org.problem = validation.problem;
      return {
        "opt.prepare.ok": true,
        "opt.prepare.digest": validation.problem.digest,
        "opt.prepare.enrolledAgents": validation.problem.snapshot.enrolledAgents.length,
        "opt.prepare.usageEntries": validation.problem.usageExcerpt.length,
      };
    }
    case "org-allocate-roles": {
      const problem = state.org.problem;
      if (problem === null) return { "opt.allocate.ok": false, "opt.allocate.reasonCode": "PROBLEM_NOT_PREPARED" };
      const result = allocateRoles(problem, state.org.roleDemand);
      if (!result.ok) {
        return { "opt.allocate.ok": false, "opt.allocate.reasonCode": result.reasonCode, "opt.allocate.detail": result.detail ?? null };
      }
      state.org.proposal = result.proposal;
      const assignedInTrace = result.proposal.scoringTrace.filter((t) => t.outcome === "assigned").length;
      return {
        "opt.allocate.ok": true,
        "opt.allocate.note": result.proposal.note,
        "opt.allocate.assignedCount": result.proposal.assignments.length,
        "opt.allocate.assignedInTrace": assignedInTrace,
        "opt.allocate.refusalCount": result.proposal.refusals.length,
        "opt.allocate.traceLength": result.proposal.scoringTrace.length,
        "opt.allocate.totalFitBps": result.proposal.totals.totalFitBps,
        "opt.allocate.digest": result.proposal.digest,
      };
    }
    case "org-what-if": {
      const problem = state.org.problem;
      const proposal = state.org.proposal;
      if (problem === null || proposal === null) {
        return { "opt.whatif.ok": false, "opt.whatif.reasonCode": "PROPOSAL_NOT_READY" };
      }
      const result = projectWhatIf({
        tenant: state.tenant,
        snapshot: problem.snapshot,
        proposals: { roleAllocations: [proposal], budgetRebalances: [], routing: [] },
      });
      if (!result.ok) {
        return { "opt.whatif.ok": false, "opt.whatif.reasonCode": result.reasonCode, "opt.whatif.detail": result.detail ?? null };
      }
      state.org.whatIf = result.analysis;
      const snapshotAfter = foldOrgSnapshot(state.org.journal);
      return {
        "opt.whatif.ok": true,
        "opt.whatif.state": result.analysis.state,
        "opt.whatif.note": result.analysis.note,
        "opt.whatif.roleAssignments": result.analysis.delta.applied.roleAssignments,
        "opt.whatif.digest": result.analysis.digest,
        "opt.whatif.orgDigestUnchanged": snapshotAfter.digest === state.org.baselineSnapshotDigest,
      };
    }
    case "org-budget-board": {
      const result = buildCapabilityBudgetBoard({
        tenant: state.tenant,
        budgets: state.org.budgets,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "orgBudgetBoard.ok": false, "orgBudgetBoard.reasonCode": result.reasonCode };
      const row = result.rows.find((r) => r.budgetId === "bud-agent-1");
      return {
        "orgBudgetBoard.ok": true,
        "orgBudgetBoard.phase": row?.phase ?? null,
        "orgBudgetBoard.unitUtilizationBps": row?.unitUtilizationBps ?? -1,
        "orgBudgetBoard.spendUtilizationBps": row?.spendUtilizationBps ?? -1,
        "orgBudgetBoard.ceilingNote": row?.ceilingNote ?? null,
        "orgBudgetBoard.exhaustedCount": result.totals.exhaustedCount,
      };
    }
  }
}
