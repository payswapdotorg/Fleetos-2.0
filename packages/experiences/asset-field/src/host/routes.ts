/**
 * @fleetos/experience-asset-field — the host route manifest (F300A).
 *
 * Five routes over the lane's real read-models:
 *   fleet-overview   — fleet-wide posture at a glance (fleet overview VM)
 *   asset-discovery  — browse/discover the tenant's assets (same real
 *                      overview read-model; the discovery affordance is
 *                      the enroll intent — no separate truth store)
 *   device-360       — per-asset Device 360 detail sheets (asset detail VM)
 *   health-timeline  — health posture + open-recovery evidence timeline
 *                      (health board + recovery timeline VMs)
 *   field-workflow   — the phone-shaped field operator workflow (field
 *                      view + maintenance board VMs)
 *
 * Drill-down refs are machine-checked (verifyRouteManifest): every ref
 * resolves to a declared route id, and every route's view-model keys
 * exist in the host view models.
 *
 * HONESTY: every route declares its limitation markers explicitly —
 * last-known offline reads, no live telemetry push, and the NOT
 * IMPLEMENTED offline write/sync capability. Nothing is simulated.
 */

import type {
  HostRoute,
  HostRouteLimitation,
  HostRouteManifest,
  HostRouteRef,
  HostViewModelKey,
} from "./contract.js";

const OFFLINE_READ_LAST_KNOWN: HostRouteLimitation = {
  marker: "offline-read:last-known",
  detail:
    "Assembled from the supplied slice as-of the context's logical time; observed entries carry staleness classification (fresh/stale/unknown) and are never claimed fresh when they are not.",
};

const LIVE_TELEMETRY_NOT_IMPLEMENTED: HostRouteLimitation = {
  marker: "live-telemetry:not-implemented",
  detail:
    "No live observation stream exists at this seam: views reflect already-ingested observations only; a host re-render with a fresh slice is required to see new data.",
};

const OFFLINE_WRITE_SYNC_NOT_IMPLEMENTED: HostRouteLimitation = {
  marker: "offline-write-sync:not-implemented",
  detail:
    "Offline command capture and reconnect replay/sync is NOT implemented: command intents are inert drafts and require a live control-plane binding (TL composition) to execute.",
};

export const FLEET_OVERVIEW_ROUTE_ID = "fleet-overview";
export const ASSET_DISCOVERY_ROUTE_ID = "asset-discovery";
export const DEVICE_360_ROUTE_ID = "device-360";
export const HEALTH_TIMELINE_ROUTE_ID = "health-timeline";
export const FIELD_WORKFLOW_ROUTE_ID = "field-workflow";

const DEVICE_360_REF: HostRouteRef = { routeId: DEVICE_360_ROUTE_ID, param: "assetId" };

export const ASSET_FIELD_ROUTES: HostRouteManifest = [
  {
    routeId: FLEET_OVERVIEW_ROUTE_ID,
    path: "/field",
    title: "Fleet Overview",
    summary: "Fleet-wide posture at a glance: one card per managed asset.",
    viewModels: ["fleetOverview"],
    drillDown: [DEVICE_360_REF, { routeId: FIELD_WORKFLOW_ROUTE_ID }],
    limitations: [OFFLINE_READ_LAST_KNOWN, LIVE_TELEMETRY_NOT_IMPLEMENTED],
  },
  {
    routeId: ASSET_DISCOVERY_ROUTE_ID,
    path: "/field/assets",
    title: "Asset Discovery",
    summary: "Discover and browse the tenant's assets (same real overview read-model).",
    viewModels: ["fleetOverview"],
    drillDown: [DEVICE_360_REF],
    limitations: [OFFLINE_READ_LAST_KNOWN, LIVE_TELEMETRY_NOT_IMPLEMENTED],
  },
  {
    routeId: DEVICE_360_ROUTE_ID,
    path: "/field/assets/:assetId",
    title: "Device 360",
    summary: "One asset's full 360: devices, twin provenance, findings, recovery evidence.",
    viewModels: ["device360", "recoveryTimeline"],
    drillDown: [{ routeId: HEALTH_TIMELINE_ROUTE_ID }, { routeId: FIELD_WORKFLOW_ROUTE_ID }],
    limitations: [
      OFFLINE_READ_LAST_KNOWN,
      LIVE_TELEMETRY_NOT_IMPLEMENTED,
      OFFLINE_WRITE_SYNC_NOT_IMPLEMENTED,
    ],
  },
  {
    routeId: HEALTH_TIMELINE_ROUTE_ID,
    path: "/field/health",
    title: "Health & Evidence Timeline",
    summary: "Health posture per asset plus the open-recovery evidence timeline.",
    viewModels: ["healthBoard", "recoveryTimeline"],
    drillDown: [DEVICE_360_REF],
    limitations: [OFFLINE_READ_LAST_KNOWN, LIVE_TELEMETRY_NOT_IMPLEMENTED],
  },
  {
    routeId: FIELD_WORKFLOW_ROUTE_ID,
    path: "/field/workflow",
    title: "Field Workflow",
    summary: "The phone-shaped field operator workflow: alerts, recoveries, next maintenance, connectivity.",
    viewModels: ["fieldWorkflow", "maintenanceBoard"],
    drillDown: [DEVICE_360_REF],
    limitations: [
      OFFLINE_READ_LAST_KNOWN,
      LIVE_TELEMETRY_NOT_IMPLEMENTED,
      OFFLINE_WRITE_SYNC_NOT_IMPLEMENTED,
    ],
  },
];

/** All view-model keys the manifest references (machine-checked union). */
export const MANIFEST_VIEW_MODEL_KEYS: readonly HostViewModelKey[] = [
  "fleetOverview",
  "device360",
  "healthBoard",
  "recoveryTimeline",
  "maintenanceBoard",
  "fieldWorkflow",
];

/** Deterministic route lookup (declared order, first match wins). */
export function routeById(routeId: string): HostRoute | null {
  return ASSET_FIELD_ROUTES.find((r) => r.routeId === routeId) ?? null;
}

/**
 * Machine-check the manifest's integrity: unique route ids, resolvable
 * drill-down refs, existing path params, and view-model keys covered by
 * the host view models. Returns the violation list (empty = valid).
 */
export function verifyRouteManifest(): readonly string[] {
  const problems: string[] = [];
  const routeIds = new Set<string>();
  for (const route of ASSET_FIELD_ROUTES) {
    if (routeIds.has(route.routeId)) {
      problems.push(`duplicate route id ${route.routeId}`);
    }
    routeIds.add(route.routeId);
  }
  for (const route of ASSET_FIELD_ROUTES) {
    for (const ref of route.drillDown) {
      if (!routeIds.has(ref.routeId)) {
        problems.push(`route ${route.routeId} drills into undeclared route ${ref.routeId}`);
      }
    }
    if (route.viewModels.length === 0) {
      problems.push(`route ${route.routeId} renders no view model`);
    }
    for (const key of route.viewModels) {
      if (!MANIFEST_VIEW_MODEL_KEYS.includes(key)) {
        problems.push(`route ${route.routeId} references unknown view model ${key}`);
      }
    }
  }
  for (const key of MANIFEST_VIEW_MODEL_KEYS) {
    const used = ASSET_FIELD_ROUTES.some((r) => r.viewModels.includes(key));
    if (!used) {
      problems.push(`view model ${key} is declared but never rendered`);
    }
  }
  return problems;
}
