/**
 * @fleetos/acceptance-commerce — the model-gateway world state (F300C).
 *
 * The REAL gateway model registry + quota window the routing journeys
 * run against: validated by the DOMAIN's own registry check at world
 * build (a broken registry refuses at the source, never at the journey),
 * and the initial quota window opened through the domain's own
 * openQuotaWindow. Also hosts the seeded REAL role assignment used by
 * the role-handoff journeys.
 */

import type { ModelDescriptor, QuotaWindowPolicy, QuotaWindowState } from "@fleetos/model-gateway";
import { openQuotaWindow, validateModelRegistry } from "@fleetos/model-gateway";
import type { RoleAssignment } from "@fleetos/agent-organizations";
import { assignRole } from "@fleetos/agent-organizations";
import { CLOCK, type JourneyState } from "./journey-world.js";

/** The REAL gateway model registry for the F300C routing journeys. */
export const GATEWAY_REGISTRY: readonly ModelDescriptor[] = [
  { id: "model-alpha-rich", providerId: "provider-one", capabilityTags: ["summarize", "long-context"], costPerUnitMinor: 4, maxContextUnits: 200_000 },
  { id: "model-beta-cheap", providerId: "provider-one", capabilityTags: ["summarize"], costPerUnitMinor: 1, maxContextUnits: 32_000 },
  { id: "model-gamma-analytic", providerId: "provider-two", capabilityTags: ["summarize", "long-context", "analytics"], costPerUnitMinor: 9, maxContextUnits: 500_000 },
];

/** The gateway quota window policy: 2 requests / 300 units per window. */
export const GATEWAY_QUOTA_POLICY: QuotaWindowPolicy = {
  maxRequestsPerWindow: 2,
  maxUnitsPerWindow: 300,
};

/** Build the validated gateway world state (registry + open quota window). */
export function buildGatewayState(): {
  readonly registry: readonly ModelDescriptor[];
  readonly quotaPolicy: QuotaWindowPolicy;
  readonly quotaState: QuotaWindowState;
} {
  const registryCheck = validateModelRegistry(GATEWAY_REGISTRY);
  if (!registryCheck.ok) throw new Error("world: gateway registry invalid");
  const quotaWindow = openQuotaWindow(CLOCK.t0, 10_000);
  if (!quotaWindow.ok) throw new Error("world: openQuotaWindow refused");
  return {
    registry: GATEWAY_REGISTRY,
    quotaPolicy: GATEWAY_QUOTA_POLICY,
    quotaState: quotaWindow.state,
  };
}

/**
 * The initial REAL role assignment of the world's organization — created
 * through the REAL assignRole lifecycle (tenant-validated, digest-stamped).
 * Used by the role-handoff journeys as the pre-existing assignment.
 */
export function seedRoleAssignment(state: JourneyState): RoleAssignment | null {
  const role = state.org.roles.find((r) => r.id === "role-ops");
  if (role === undefined) return null;
  const result = assignRole({
    tenant: state.tenant,
    organizationId: "org-1",
    agentId: "agent-1",
    role,
    assignmentId: "ra-seed-1",
    at: CLOCK.t0,
    maxConcurrentRoles: 2,
    existing: [],
  });
  return result.ok ? result.assignment : null;
}
