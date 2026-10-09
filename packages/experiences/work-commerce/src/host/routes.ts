/**
 * @fleetos/experience-work-commerce — the host route manifest (F300C).
 *
 * Five routes over the lane's real read-models (WAVE10-HOST-CONTRACT §2
 * route vocabulary for this lane — work board, project/workload views,
 * procurement demand→quote→order, org + gateway budgets, software
 * entitlements):
 *
 *   work-board          — the tenant's work order board (create affordance)
 *   project-stage-gates — per-project stage-gate frontier + milestone
 *                         gates + the workload rollup
 *   procurement-spine   — the Need→Demand→Quote→Order→Fulfillment board,
 *                         vendor KPI rollup and (when composed) quote
 *                         scoring
 *   software-entitlements — subscription seat view (over-allocation honest)
 *   org-budgets         — role assignments, capability budget ceilings and
 *                         the model-gateway usage rollup
 *
 * Drill-down refs are machine-checked (verifyRouteManifest): every ref
 * resolves to a declared route id, and every route's view-model keys
 * exist in the host view models.
 *
 * HONESTY: every route declares its limitation markers explicitly —
 * logical-time (not wall-clock) reads, inert intents that require the
 * TL control-plane binding, the optional quote-scoring analysis, and the
 * CONTRACT_ONLY state of the lane's external adapters (Aurum settlement,
 * Apify actor jobs, external vendor catalogs — deterministic reference
 * adapters, NOT live connectivity; evidence: docs/evidence/F300C/report.md
 * integration matrix). Nothing is simulated.
 */

import type {
  HostRoute,
  HostRouteLimitation,
  HostRouteManifest,
  HostRouteRef,
  HostViewModelKey,
} from "./contract.js";

const READ_AS_OF_LOGICAL_TIME: HostRouteLimitation = {
  marker: "read-as-of:logical-time",
  detail:
    "Assembled from the supplied slice as-of the context's establishedAt (the only time source); a host re-render with a fresh slice is required to see newer domain state.",
};

const INTENT_EXECUTION_NOT_AT_LANE: HostRouteLimitation = {
  marker: "intent-execution:not-at-lane",
  detail:
    "Command intents are inert CommandDraft records; execution requires the TL composition binding to the control-plane CommandQueue.submit and Guardian adjudication (WAVE10-HOST-CONTRACT §3).",
};

const EXTERNAL_ADAPTERS_CONTRACT_ONLY: HostRouteLimitation = {
  marker: "external-adapters:contract-only",
  detail:
    "The lane's external connectors (Aurum settlement, Apify actor jobs, external vendor catalogs) are deterministic CONTRACT_ONLY reference adapters behind ports — no live provider connectivity exists at this seam; statuses and sanitized evidence are recorded in the F300C integration matrix.",
};

const QUOTE_SCORING_OPTIONAL: HostRouteLimitation = {
  marker: "quote-scoring:caller-composed",
  detail:
    "Deterministic quote scoring is a caller-composed analysis: the view renders ranked quotes only when the TL composes scoring inputs into the slice; otherwise the bundle carries an explicit not-composed marker (never a fabricated ranking).",
};

const BUDGETS_ARE_CEILINGS: HostRouteLimitation = {
  marker: "budgets-are-ceilings:not-authorizations",
  detail:
    "Capability budgets and gateway usage are CEILINGS, never authorizations: every row carries the domain's ceiling note and over-limit refusals propagate verbatim (law A5/A6).",
};

export const WORK_BOARD_ROUTE_ID = "work-board";
export const PROJECT_STAGE_GATES_ROUTE_ID = "project-stage-gates";
export const PROCUREMENT_SPINE_ROUTE_ID = "procurement-spine";
export const SOFTWARE_ENTITLEMENTS_ROUTE_ID = "software-entitlements";
export const ORG_BUDGETS_ROUTE_ID = "org-budgets";

const STAGE_GATES_REF: HostRouteRef = { routeId: PROJECT_STAGE_GATES_ROUTE_ID, param: "projectId" };
const WORK_BOARD_REF: HostRouteRef = { routeId: WORK_BOARD_ROUTE_ID };
const PROCUREMENT_SPINE_REF: HostRouteRef = { routeId: PROCUREMENT_SPINE_ROUTE_ID };

export const WORK_COMMERCE_ROUTES: HostRouteManifest = [
  {
    routeId: WORK_BOARD_ROUTE_ID,
    path: "/commerce/work",
    title: "Work Board",
    summary: "The tenant's work orders grouped by domain status, with the create-work-order affordance.",
    viewModels: ["workBoard"],
    drillDown: [STAGE_GATES_REF, PROCUREMENT_SPINE_REF],
    limitations: [READ_AS_OF_LOGICAL_TIME, INTENT_EXECUTION_NOT_AT_LANE],
  },
  {
    routeId: PROJECT_STAGE_GATES_ROUTE_ID,
    path: "/commerce/projects",
    title: "Projects & Workloads",
    summary:
      "Per-project stage-gate frontier (exactly what unlocks the next stage), milestone gates, and the workload rollup with honest over-allocation flags.",
    viewModels: ["stageGates", "workloadRollup"],
    drillDown: [WORK_BOARD_REF],
    limitations: [READ_AS_OF_LOGICAL_TIME],
  },
  {
    routeId: PROCUREMENT_SPINE_ROUTE_ID,
    path: "/commerce/procurement",
    title: "Procurement Spine",
    summary:
      "Need → Demand → Quote → Order → Fulfillment lineage board with supersession visibility, vendor KPI rollup, and (when composed) deterministic quote scoring.",
    viewModels: ["spineBoard", "vendorKpi", "quoteScore"],
    drillDown: [WORK_BOARD_REF],
    limitations: [
      READ_AS_OF_LOGICAL_TIME,
      INTENT_EXECUTION_NOT_AT_LANE,
      QUOTE_SCORING_OPTIONAL,
      EXTERNAL_ADAPTERS_CONTRACT_ONLY,
    ],
  },
  {
    routeId: SOFTWARE_ENTITLEMENTS_ROUTE_ID,
    path: "/commerce/software",
    title: "Software Entitlements",
    summary: "Subscription seat utilization with honest over-allocation and expiry state.",
    viewModels: ["seatView"],
    drillDown: [PROCUREMENT_SPINE_REF],
    limitations: [READ_AS_OF_LOGICAL_TIME],
  },
  {
    routeId: ORG_BUDGETS_ROUTE_ID,
    path: "/commerce/organization",
    title: "Agent Organization & Gateway Budgets",
    summary:
      "Role assignment board, capability budget utilization (ceilings, never authorizations) and the model-gateway usage rollup with chain integrity.",
    viewModels: ["roleBoard", "budgetBoard", "usageRollup"],
    drillDown: [WORK_BOARD_REF],
    limitations: [READ_AS_OF_LOGICAL_TIME, INTENT_EXECUTION_NOT_AT_LANE, BUDGETS_ARE_CEILINGS],
  },
];

/** Route lookup by id (null when unknown). */
export function routeById(routeId: string): HostRoute | null {
  return WORK_COMMERCE_ROUTES.find((r) => r.routeId === routeId) ?? null;
}

/** Every view-model key declared across the manifest (manifest order). */
export const MANIFEST_VIEW_MODEL_KEYS: readonly HostViewModelKey[] = [
  ...new Set(WORK_COMMERCE_ROUTES.flatMap((r) => r.viewModels)),
];

/**
 * Machine-check manifest integrity: unique route ids + paths, declared
 * drill-down targets, every route renders at least one view model, and
 * honest limitation markers on every route. Empty = valid.
 */
export function verifyRouteManifest(): readonly string[] {
  const problems: string[] = [];
  const routeIds = new Set<string>();
  const paths = new Set<string>();
  for (const route of WORK_COMMERCE_ROUTES) {
    if (routeIds.has(route.routeId)) problems.push(`duplicate route id ${route.routeId}`);
    routeIds.add(route.routeId);
    if (paths.has(route.path)) problems.push(`duplicate route path ${route.path}`);
    paths.add(route.path);
    if (route.viewModels.length === 0) {
      problems.push(`route ${route.routeId} renders no view models`);
    }
    if (route.limitations.length === 0) {
      problems.push(`route ${route.routeId} carries no honest limitation marker`);
    }
    for (const ref of route.drillDown) {
      if (!routeIds.has(ref.routeId) && !WORK_COMMERCE_ROUTES.some((r) => r.routeId === ref.routeId)) {
        problems.push(`route ${route.routeId} drills into undeclared route ${ref.routeId}`);
      }
    }
  }
  return problems;
}
