/**
 * @fleetos/experience-asset-field — the host intent catalog (F300A).
 *
 * Maps UI events to the lane's EXISTING inert CommandDraft builders
 * (command-intents.ts): asset.enroll / recovery.request /
 * maintenance.schedule. The catalog is DATA; drafts stay inert frozen
 * records — binding them to the control-plane CommandQueue.submit is TL
 * composition work (WAVE10-HOST-CONTRACT §2/§3).
 *
 * ROLE LENSES (fail-closed presentation): `offeredTo` decides which role
 * lenses the UI offers an intent to. A role NOT in the list is REFUSED
 * at the seam (`intent-not-offered-to-role`) — the UI never renders the
 * affordance. This is PRESENTATION gating only: authorization is always
 * the control plane + Guardian's (the draft's capabilityRequirement is
 * a REQUEST, never an authorization).
 *
 * Determinism: pure data + pure helpers; no clock, no randomness.
 */

import type { CommandDraft, IntentRejection, IntentResult, IntentSchedule } from "../command-intents.js";
import {
  buildEnrollAssetIntent,
  buildRequestRecoveryIntent,
  buildScheduleMaintenanceIntent,
} from "../command-intents.js";
import type { HostIntentCatalog, HostIntentSpec, HostSurfaceRole } from "./contract.js";
import {
  ASSET_DISCOVERY_ROUTE_ID,
  DEVICE_360_ROUTE_ID,
  FIELD_WORKFLOW_ROUTE_ID,
  routeById,
} from "./routes.js";

export const ASSET_FIELD_INTENTS: HostIntentCatalog = [
  {
    intentId: "asset-field.enroll-asset",
    event: "asset-discovery:enroll-asset",
    builderId: "asset.enroll",
    routeId: ASSET_DISCOVERY_ROUTE_ID,
    title: "Enroll a new asset",
    description: "Enroll a new asset + device into the fleet (asset.discovery affordance).",
    capabilityRequest: "assets.enroll",
    offeredTo: ["fleet-operator", "site-manager"],
  },
  {
    intentId: "asset-field.request-recovery",
    event: "device-360:request-recovery",
    builderId: "recovery.request",
    routeId: DEVICE_360_ROUTE_ID,
    title: "Request recovery",
    description: "Request recovery for the device shown on Device 360.",
    capabilityRequest: "recovery.request",
    offeredTo: ["field-technician", "recovery-coordinator", "fleet-operator", "site-manager"],
  },
  {
    intentId: "asset-field.request-recovery-field",
    event: "field-workflow:request-recovery",
    builderId: "recovery.request",
    routeId: FIELD_WORKFLOW_ROUTE_ID,
    title: "Request recovery (field)",
    description: "Request recovery for a degraded device from the field workflow.",
    capabilityRequest: "recovery.request",
    offeredTo: ["field-technician", "recovery-coordinator"],
  },
  {
    intentId: "asset-field.schedule-maintenance",
    event: "device-360:schedule-maintenance",
    builderId: "maintenance.schedule",
    routeId: DEVICE_360_ROUTE_ID,
    title: "Schedule maintenance",
    description: "Schedule a service plan for the asset shown on Device 360.",
    capabilityRequest: "maintenance.schedule",
    offeredTo: ["maintenance-planner", "fleet-operator", "site-manager"],
  },
  {
    intentId: "asset-field.schedule-maintenance-field",
    event: "field-workflow:schedule-maintenance",
    builderId: "maintenance.schedule",
    routeId: FIELD_WORKFLOW_ROUTE_ID,
    title: "Schedule maintenance (field)",
    description: "Schedule maintenance from the field workflow's next-maintenance section.",
    capabilityRequest: "maintenance.schedule",
    offeredTo: ["maintenance-planner"],
  },
];

/** Deterministic event lookup (first match; events are unique by law). */
export function intentForEvent(event: string): HostIntentSpec | null {
  return ASSET_FIELD_INTENTS.find((i) => i.event === event) ?? null;
}

/** Intents offered from a route, in catalog order. */
export function intentsForRoute(routeId: string): HostIntentCatalog {
  return ASSET_FIELD_INTENTS.filter((i) => i.routeId === routeId);
}

/** Intents offered to a role lens, in catalog order. */
export function intentsOfferedTo(role: string): HostIntentCatalog {
  return ASSET_FIELD_INTENTS.filter((i) => i.offeredTo.includes(role as HostSurfaceRole));
}

/** The presentation gate: is this event's intent offered to this role? */
export function isIntentOfferedToRole(event: string, role: string): boolean {
  const spec = intentForEvent(event);
  return spec !== null && spec.offeredTo.includes(role as HostSurfaceRole);
}

/**
 * Machine-check catalog integrity: unique intent ids + events, known
 * builder ids, declared routes, non-empty offeredTo. Empty = valid.
 */
export function verifyIntentCatalog(): readonly string[] {
  const problems: string[] = [];
  const intentIds = new Set<string>();
  const events = new Set<string>();
  const builders = new Set<string>(["asset.enroll", "recovery.request", "maintenance.schedule"]);
  for (const intent of ASSET_FIELD_INTENTS) {
    if (intentIds.has(intent.intentId)) problems.push(`duplicate intent id ${intent.intentId}`);
    intentIds.add(intent.intentId);
    if (events.has(intent.event)) problems.push(`duplicate intent event ${intent.event}`);
    events.add(intent.event);
    if (!builders.has(intent.builderId)) {
      problems.push(`intent ${intent.intentId} names unknown builder ${intent.builderId}`);
    }
    if (routeById(intent.routeId) === null) {
      problems.push(`intent ${intent.intentId} names undeclared route ${intent.routeId}`);
    }
    if (intent.offeredTo.length === 0) {
      problems.push(`intent ${intent.intentId} is offered to no role`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Draft building — UI event -> the EXISTING inert CommandDraft builder.
// ---------------------------------------------------------------------------

/** The caller-supplied draft input (logical time only — never a clock). */
export interface HostIntentInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly issuedAt: number;
  readonly reason: string;
  readonly notBefore?: number;
  // Builder-specific fields (validated by the builders themselves):
  readonly assetId?: string;
  readonly deviceId?: string;
  readonly serial?: string;
  readonly displayName?: string;
  readonly planId?: string;
  readonly schedule?: IntentSchedule;
}

export type HostIntentRejection = "unknown-intent-event" | "missing-intent-input" | IntentRejection;

export type HostIntentBuildResult =
  | { readonly ok: true; readonly draft: CommandDraft; readonly intent: HostIntentSpec }
  | { readonly ok: false; readonly rejected: HostIntentRejection; readonly detail: string };

function missingField(field: string): HostIntentBuildResult {
  return {
    ok: false,
    rejected: "missing-intent-input",
    detail: `intent input is missing required field ${field}`,
  };
}

/**
 * Build the inert CommandDraft for a UI event by dispatching to the
 * EXISTING builder (the catalog's builderId). The draft remains inert:
 * it never executes here; the TL binds it to the control plane.
 */
export function buildIntentForEvent(event: string, input: HostIntentInput): HostIntentBuildResult {
  const spec = intentForEvent(event);
  if (spec === null) {
    return {
      ok: false,
      rejected: "unknown-intent-event",
      detail: `no catalog intent binds UI event ${event}`,
    };
  }
  let result: IntentResult;
  switch (spec.builderId) {
    case "asset.enroll":
      if (input.assetId === undefined) return missingField("assetId");
      if (input.deviceId === undefined) return missingField("deviceId");
      result = buildEnrollAssetIntent({
        tenantId: input.tenantId,
        actorId: input.actorId,
        assetId: input.assetId,
        deviceId: input.deviceId,
        ...(input.serial !== undefined ? { serial: input.serial } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        issuedAt: input.issuedAt,
        ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
        reason: input.reason,
      });
      break;
    case "recovery.request":
      if (input.deviceId === undefined) return missingField("deviceId");
      result = buildRequestRecoveryIntent({
        tenantId: input.tenantId,
        actorId: input.actorId,
        deviceId: input.deviceId,
        issuedAt: input.issuedAt,
        ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
        reason: input.reason,
      });
      break;
    case "maintenance.schedule":
      if (input.assetId === undefined) return missingField("assetId");
      if (input.planId === undefined) return missingField("planId");
      if (input.schedule === undefined) return missingField("schedule");
      result = buildScheduleMaintenanceIntent({
        tenantId: input.tenantId,
        actorId: input.actorId,
        assetId: input.assetId,
        planId: input.planId,
        schedule: input.schedule,
        issuedAt: input.issuedAt,
        ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
        reason: input.reason,
      });
      break;
  }
  if (!result.ok) return { ok: false, rejected: result.rejected, detail: result.detail };
  return { ok: true, draft: result.draft, intent: spec };
}
