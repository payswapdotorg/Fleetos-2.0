/**
 * @fleetos/experience-work-commerce — the host seam public module
 * (`@fleetos/experience-work-commerce/host`, F300C subpath export).
 *
 * Exports the lane's HostSurface adapter — the single integration seam
 * of WAVE10-HOST-CONTRACT §2 — plus its route manifest, intent catalog,
 * view-model types and integrity verifiers. The TL application shell
 * mounts this surface; lanes never touch TL-owned paths.
 */

import type { HostSurface } from "./contract.js";
import type { WorkCommerceSlice, HostViewModelResult } from "./surface.js";
import { buildViewModels } from "./surface.js";
import { WORK_COMMERCE_ROUTES } from "./routes.js";
import { WORK_COMMERCE_INTENTS } from "./intents.js";

/**
 * The work/commerce lane's HostSurface adapter. `buildViewModels` is the
 * bound pure projection (same law as the standalone function).
 */
export const workCommerceHostSurface: HostSurface<WorkCommerceSlice, HostViewModelResult> = {
  surfaceId: "work-commerce",
  surfaceKind: "lane-experience",
  routes: WORK_COMMERCE_ROUTES,
  buildViewModels,
  intents: WORK_COMMERCE_INTENTS,
};

export type { HostSurface } from "./contract.js";
export type {
  HostTenantContext,
  HostRoute,
  HostRouteManifest,
  HostRouteRef,
  HostRouteLimitation,
  HostIntentCatalog,
  HostIntentSpec,
  HostSurfaceRole,
  HostViewModelKey,
} from "./contract.js";
export { HOST_SURFACE_ROLES } from "./contract.js";

export {
  WORK_BOARD_ROUTE_ID,
  PROJECT_STAGE_GATES_ROUTE_ID,
  PROCUREMENT_SPINE_ROUTE_ID,
  SOFTWARE_ENTITLEMENTS_ROUTE_ID,
  ORG_BUDGETS_ROUTE_ID,
  MANIFEST_VIEW_MODEL_KEYS,
  routeById,
  verifyRouteManifest,
} from "./routes.js";

export {
  intentForEvent,
  intentsForRoute,
  intentsOfferedTo,
  isIntentOfferedToRole,
  verifyIntentCatalog,
  buildIntentForEvent,
} from "./intents.js";
export type { HostIntentInput, HostIntentRejection, HostIntentBuildResult } from "./intents.js";

export {
  buildViewModels as buildWorkCommerceHostViewModels,
  verifyHostViewModelsDigest,
  stageGateSheetFor,
} from "./surface.js";
export type {
  HostSurfaceRejection,
  HostViewModelResult,
  WorkCommerceHostViewModels,
  WorkCommerceSlice,
  StageGateSheet,
  QuoteScoreSheet,
  QuoteScoreSheetInput,
  QuoteScoreSheets,
  QuoteScoreNotComposed,
  RouteLimitations,
} from "./surface.js";
