/**
 * @fleetos/experience-asset-field — the host seam public module
 * (`@fleetos/experience-asset-field/host`, F300A subpath export).
 *
 * Exports the lane's HostSurface adapter — the single integration seam
 * of WAVE10-HOST-CONTRACT §2 — plus its route manifest, intent catalog,
 * view-model types and integrity verifiers. The TL application shell
 * mounts this surface; lanes never touch TL-owned paths.
 */

import type { HostSurface } from "./contract.js";
import type { ExperienceStateSlice } from "../state.js";
import type { HostViewModelResult } from "./surface.js";
import { ASSET_FIELD_ROUTES } from "./routes.js";
import { ASSET_FIELD_INTENTS } from "./intents.js";
import { buildViewModels } from "./surface.js";

/**
 * The asset/field lane's HostSurface adapter. `buildViewModels` is the
 * bound pure projection (same law as the standalone function).
 */
export const assetFieldHostSurface: HostSurface<ExperienceStateSlice, HostViewModelResult> = {
  surfaceId: "asset-field",
  surfaceKind: "lane-experience",
  routes: ASSET_FIELD_ROUTES,
  buildViewModels,
  intents: ASSET_FIELD_INTENTS,
};

export type { HostSurface } from "./contract.js";
export type {
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
  FLEET_OVERVIEW_ROUTE_ID,
  ASSET_DISCOVERY_ROUTE_ID,
  DEVICE_360_ROUTE_ID,
  HEALTH_TIMELINE_ROUTE_ID,
  FIELD_WORKFLOW_ROUTE_ID,
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
  buildViewModels as buildAssetFieldHostViewModels,
  verifyHostViewModelsDigest,
  device360SheetFor,
} from "./surface.js";
export type {
  HostSurfaceRejection,
  HostViewModelResult,
  AssetFieldHostViewModels,
  Device360Sheet,
  RouteLimitations,
} from "./surface.js";
