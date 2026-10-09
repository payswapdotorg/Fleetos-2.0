/**
 * @fleetos/acceptance-commerce — model-gateway routing/quota/burn and
 * role-assignment step drivers (F300C).
 *
 * Interprets typed journey steps against the REAL public entry points of
 * @fleetos/model-gateway (selectModel, applyQuotaRequest,
 * projectBudgetBurn, compareProviderCosts) and @fleetos/agent-organizations
 * (assignRole, transitionRoleAssignment, buildRoleAssignmentBoard via the
 * experience plane). Facts are verbatim REAL outputs; refusals — including
 * OVER-LIMIT refusals (budget ceiling, quota exhaustion, concurrency
 * ceiling) — are recorded honestly, never swallowed.
 */

import type { FactValue, GatewayStep } from "./journey-contracts.js";
import type { JourneyState } from "./journey-world.js";
import { CLOCK, logPush } from "./journey-world.js";
import { seedRoleAssignment } from "./gateway-world.js";
import {
  selectModel,
  applyQuotaRequest,
  projectBudgetBurn,
  compareProviderCosts,
} from "@fleetos/model-gateway";
import {
  assignRole,
  transitionRoleAssignment,
  type AssignmentCommand,
  type RoleAssignment,
} from "@fleetos/agent-organizations";
import { buildRoleAssignmentBoard } from "@fleetos/experience-work-commerce";

export type DriverFacts = Record<string, FactValue>;

export async function runGatewayStep(step: GatewayStep, state: JourneyState): Promise<DriverFacts> {
  switch (step.kind) {
    case "gw-select-model": {
      const decision = selectModel(state.gateway.registry, {
        tenantId: state.tenant.tenantId,
        requiredCapabilities: step.requiredCapabilities,
        priority: step.priority,
        budgetCeilingMinor: step.budgetCeilingMinor,
        estimatedUnits: step.estimatedUnits,
      });
      logPush(
        state,
        "gw.select.log",
        decision.ok
          ? `ok:${decision.selectedModelId}:${decision.orderingRule}`
          : `refused:${decision.reasonCode}`,
      );
      return {
        "gw.select.ok": decision.ok,
        "gw.select.modelId": decision.ok ? decision.selectedModelId : null,
        "gw.select.providerId": decision.ok ? decision.providerId : null,
        "gw.select.orderingRule": decision.ok ? decision.orderingRule : null,
        "gw.select.estimatedCostMinor": decision.ok ? decision.estimatedCostMinor : null,
        "gw.select.reasonCode": decision.ok ? null : decision.reasonCode,
        "gw.select.candidatesConsidered": decision.candidatesConsidered,
      };
    }
    case "gw-quota-request": {
      const decision = applyQuotaRequest(state.gateway.quotaPolicy, state.gateway.quotaState, {
        at: step.at,
        units: step.units,
      });
      if (decision.ok) state.gateway.quotaState = decision.state;
      logPush(
        state,
        "gw.quota.log",
        decision.ok
          ? `ok:${decision.remainingRequests}:${decision.remainingUnits}`
          : `refused:${decision.reasonCode}`,
      );
      return {
        "gw.quota.ok": decision.ok,
        "gw.quota.reasonCode": decision.ok ? null : decision.reasonCode,
        "gw.quota.remainingRequests": decision.ok ? decision.remainingRequests : null,
        "gw.quota.remainingUnits": decision.ok ? decision.remainingUnits : null,
        "gw.quota.overshootRequests": decision.ok ? null : decision.overshootRequests,
        "gw.quota.overshootUnits": decision.ok ? null : decision.overshootUnits,
        "gw.quota.requestsAccepted": state.gateway.quotaState.requestsAccepted,
        "gw.quota.unitsConsumed": state.gateway.quotaState.unitsConsumed,
      };
    }
    case "gw-burn-projection": {
      const result = projectBudgetBurn(
        state.tenant.tenantId,
        state.org.usage,
        step.schedule.map((p) => ({
          label: p.label,
          units: p.units,
          costMinor: p.costMinor,
          at: p.at,
          assumption: p.assumption,
        })),
        {
          ceilingMinor: step.ceilingMinor,
          ...(step.warningThresholdBps === undefined ? {} : { warningThresholdBps: step.warningThresholdBps }),
        },
      );
      if (!result.ok) return { "gw.burn.ok": false, "gw.burn.reasonCode": result.reasonCode };
      const p = result.projection;
      return {
        "gw.burn.ok": true,
        "gw.burn.severity": p.severity,
        "gw.burn.projectedTotalCostMinor": p.projectedTotalCostMinor,
        "gw.burn.projectedRemainingMinor": p.projectedRemainingMinor,
        "gw.burn.projectedUtilizationBps": p.projectedUtilizationBps,
        "gw.burn.points": p.projected.length,
        "gw.burn.assumptions": p.assumptions,
        "gw.burn.projectionMarker": p.projection === true,
      };
    }
    case "gw-cost-comparison": {
      const result = compareProviderCosts(
        state.tenant.tenantId,
        step.quotes.map((q) => ({ providerId: q.providerId, modelId: q.modelId, unitCostMinor: q.unitCostMinor })),
        state.org.usage,
      );
      if (!result.ok) return { "gw.cost.ok": false, "gw.cost.reasonCode": result.reasonCode };
      const c = result.comparison;
      const first = c.rows[0] ?? null;
      return {
        "gw.cost.ok": true,
        "gw.cost.providerIds": c.rows.map((r) => r.providerId),
        "gw.cost.unquotedProviders": c.unquotedProviders,
        "gw.cost.ordering": c.ordering,
        "gw.cost.firstUsageCostMinor": first?.usageCostMinor ?? null,
        "gw.cost.firstQuoteCostMinor": first?.quoteCostMinor ?? null,
        "gw.cost.firstDeltaBps": first?.deltaBps ?? null,
      };
    }
    case "org-assign-role": {
      const role = state.org.roles.find((r) => r.id === step.roleId);
      if (role === undefined) {
        return { "role.assign.ok": false, "role.assign.reasonCode": "ROLE_NOT_FOUND" };
      }
      const result = assignRole({
        tenant: step.foreignTenant === true ? state.otherTenant : state.tenant,
        organizationId: "org-1",
        agentId: step.agentId,
        role,
        assignmentId: step.assignmentId,
        at: CLOCK.t1,
        maxConcurrentRoles: step.maxConcurrentRoles ?? 2,
        existing: state.org.assignments,
      });
      if (result.ok) state.org.assignments = [...state.org.assignments, result.assignment];
      logPush(
        state,
        "role.assign.log",
        result.ok ? `ok:${result.assignment.id}:${result.assignment.status}` : `refused:${result.reasonCode}:${result.detail ?? "-"}`,
      );
      return {
        "role.assign.ok": result.ok,
        "role.assign.status": result.ok ? result.assignment.status : null,
        "role.assign.reasonCode": result.ok ? null : result.reasonCode,
        "role.assign.detail": result.ok ? null : (result.detail ?? null),
        "role.assign.digestVerified": result.ok ? result.assignment.digest.length > 0 : false,
      };
    }
    case "org-transition-role": {
      const target: RoleAssignment | null =
        state.org.assignments[state.org.assignments.length - 1] ?? seedRoleAssignment(state);
      if (target === null) {
        return { "role.transition.ok": false, "role.transition.reasonCode": "NO_ASSIGNMENT" };
      }
      if (state.org.assignments.length === 0 && target !== null) {
        state.org.assignments = [target];
      }
      const command: AssignmentCommand =
        step.command === "relieve"
          ? { kind: "relieve", at: CLOCK.t2, reason: step.reason ?? "rotation" }
          : { kind: "activate", at: CLOCK.t2 };
      const result = transitionRoleAssignment(target, command);
      if (result.ok) {
        state.org.assignments = state.org.assignments.map((a) => (a.id === target.id ? result.assignment : a));
      }
      logPush(
        state,
        "role.transition.log",
        result.ok ? `ok:${result.assignment.status}` : `refused:${result.reasonCode}`,
      );
      return {
        "role.transition.ok": result.ok,
        "role.transition.status": result.ok ? result.assignment.status : null,
        "role.transition.reasonCode": result.ok ? null : result.reasonCode,
        "role.transition.reliefReason": result.ok ? result.assignment.reliefReason : null,
      };
    }
    case "org-role-board": {
      const result = buildRoleAssignmentBoard({
        tenant: state.tenant,
        assignments: state.org.assignments,
        computedAt: step.computedAt,
      });
      if (!result.ok) return { "roleBoard.ok": false, "roleBoard.reasonCode": result.reasonCode };
      const active = result.board.columns.find((c) => c.status === "active")?.cards ?? [];
      const relieved = result.board.columns.find((c) => c.status === "relieved")?.cards ?? [];
      return {
        "roleBoard.ok": true,
        "roleBoard.activeIds": active.map((c) => c.assignmentId),
        "roleBoard.relievedIds": relieved.map((c) => c.assignmentId),
        "roleBoard.digest": result.board.digest,
      };
    }
  }
}
