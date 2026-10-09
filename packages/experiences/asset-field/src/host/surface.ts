/**
 * @fleetos/experience-asset-field — the HostSurface view-model builder
 * (F300A; WAVE10-HOST-CONTRACT §2).
 *
 * `buildViewModels(slice, ctx)` projects the lane's REAL read-model
 * assemblies over the tenant-scoped slice, as-of the context's logical
 * time (ctx.establishedAt — the ONLY time source; no clock, no Date.now,
 * no randomness). Same slice + same context => byte-identical view
 * models (machine-tested), because every underlying assembly is pure
 * and deterministic and the per-asset sheets are built in assetId order.
 *
 * NO SECOND BUSINESS-TRUTH STORE: each field is the REAL assembly's own
 * output (fleet overview, per-asset Device 360 detail, health board,
 * recovery timeline, maintenance board, field view) — nothing is cached
 * or re-derived here; refusals surface VERBATIM per route.
 *
 * TENANT FAIL-CLOSED at the seam: the context's tenant must own the
 * slice — otherwise the WHOLE bundle is refused (`tenant-mismatch`),
 * before any projection runs. Cross-tenant records inside the slice
 * keep refusing every per-route assembly (existing lane law).
 */

import { isActorId, isRoleId, isTenantId } from "@fleetos/identity";
import type { TenantContext } from "@fleetos/identity";
import type { AssetDetail } from "../asset-detail.js";
import type { FleetOverview } from "../asset-overview.js";
import type { FieldView } from "../field-mode.js";
import type { HealthBoard } from "../ops/health-board.js";
import type { MaintenanceBoard } from "../ops/maintenance-board.js";
import type { RecoveryTimeline } from "../ops/recovery-timeline.js";
import type { ExperienceStateSlice } from "../state.js";
import type { ViewRejection, ViewResult } from "../view-support.js";
import { assembleFleetOverview } from "../asset-overview.js";
import { assembleAssetDetail } from "../asset-detail.js";
import { assembleHealthBoard } from "../ops/health-board.js";
import { assembleMaintenanceBoard } from "../ops/maintenance-board.js";
import { assembleRecoveryTimeline } from "../ops/recovery-timeline.js";
import { assembleFieldView } from "../field-mode.js";
import { viewDigestOf } from "../digest.js";
import type { HostRouteLimitation } from "./contract.js";
import { ASSET_FIELD_ROUTES } from "./routes.js";

export type HostSurfaceRejection =
  | "tenant-mismatch"
  | "malformed-context"
  | "invalid-established-at"
  | "forbidden-scope";

export type HostViewModelResult =
  | { readonly ok: true; readonly models: AssetFieldHostViewModels }
  | { readonly ok: false; readonly rejected: HostSurfaceRejection; readonly detail: string };

/** One Device 360 sheet: the REAL asset-detail assembly's own outcome. */
export interface Device360Sheet {
  readonly assetId: string;
  readonly outcome: ViewResult<AssetDetail>;
}

/** Honest per-route limitation markers, surfaced with every build. */
export interface RouteLimitations {
  readonly routeId: string;
  readonly markers: readonly string[];
}

export interface AssetFieldHostViewModels {
  readonly surfaceId: string;
  readonly tenantId: string;
  /** Logical build instant (ctx.establishedAt) — every view's `asOf`. */
  readonly asOf: number;
  readonly fleetOverview: ViewResult<FleetOverview>;
  /** Route device-360: one sheet per asset, assetId order. */
  readonly device360: readonly Device360Sheet[];
  readonly healthBoard: ViewResult<HealthBoard>;
  readonly recoveryTimeline: ViewResult<RecoveryTimeline>;
  readonly maintenanceBoard: ViewResult<MaintenanceBoard>;
  readonly fieldWorkflow: ViewResult<FieldView>;
  readonly routeLimitations: readonly RouteLimitations[];
  readonly digest: string;
}

function refuse(
  rejected: HostSurfaceRejection,
  detail: string,
): { readonly ok: false; readonly rejected: HostSurfaceRejection; readonly detail: string } {
  return { ok: false, rejected, detail };
}

/**
 * Validate the host context honestly (runtime values may be widened):
 * well-formed ids, finite positive logical time, no forbidden scope.
 */
function guardHostContext(ctx: TenantContext): ReturnType<typeof refuse> | null {
  if (typeof ctx.establishedAt !== "number" || !Number.isFinite(ctx.establishedAt) || ctx.establishedAt <= 0) {
    return refuse("invalid-established-at", "context establishedAt must be finite and positive");
  }
  if (typeof ctx.tenantId !== "string" || !isTenantId(ctx.tenantId)) {
    return refuse("malformed-context", `context tenantId ${String(ctx.tenantId)} fails the tnt_ format`);
  }
  if (typeof ctx.actorId !== "string" || !isActorId(ctx.actorId)) {
    return refuse("malformed-context", `context actorId ${String(ctx.actorId)} fails the act_ format`);
  }
  if (typeof ctx.roleId !== "string" || !isRoleId(ctx.roleId)) {
    return refuse("malformed-context", `context roleId ${String(ctx.roleId)} fails the role_ format`);
  }
  if (ctx.scope === "cross-tenant-forbidden") {
    return refuse("forbidden-scope", "cross-tenant scope is refused at the host boundary");
  }
  return null;
}

function hostViewModelsDigestOf(models: Omit<AssetFieldHostViewModels, "digest">): string {
  return viewDigestOf("host-view-models", models);
}

/** Recompute the bundle digest; false means tampered view models. */
export function verifyHostViewModelsDigest(models: AssetFieldHostViewModels): boolean {
  const { digest, ...rest } = models;
  return hostViewModelsDigestOf(rest) === digest;
}

/**
 * Build the whole surface's view models over the REAL read-models.
 * Pure, deterministic, tenant fail-closed at the seam.
 */
export function buildViewModels(slice: ExperienceStateSlice, ctx: TenantContext): HostViewModelResult {
  const contextFailure = guardHostContext(ctx);
  if (contextFailure) return contextFailure;
  if (ctx.tenantId !== slice.tenantId) {
    return refuse(
      "tenant-mismatch",
      `context tenant ${ctx.tenantId} does not own slice tenant ${String(slice.tenantId)}`,
    );
  }
  const now = ctx.establishedAt;

  const assetIds = [...slice.assets].map((a) => a.id).sort((a, b) => (a < b ? -1 : 1));
  const device360: Device360Sheet[] = assetIds.map((assetId) => ({
    assetId,
    outcome: assembleAssetDetail(slice, { now, assetId }),
  }));

  const routeLimitations: RouteLimitations[] = ASSET_FIELD_ROUTES.map((route) => ({
    routeId: route.routeId,
    markers: route.limitations.map((l: HostRouteLimitation) => l.marker),
  }));

  const base: Omit<AssetFieldHostViewModels, "digest"> = {
    surfaceId: "asset-field",
    tenantId: slice.tenantId,
    asOf: now,
    fleetOverview: assembleFleetOverview(slice, { now }),
    device360,
    healthBoard: assembleHealthBoard(slice, { now }),
    recoveryTimeline: assembleRecoveryTimeline(slice, { now }),
    maintenanceBoard: assembleMaintenanceBoard(slice, { now }),
    fieldWorkflow: assembleFieldView(slice, { now }),
    routeLimitations,
  };
  return { ok: true, models: Object.freeze({ ...base, digest: hostViewModelsDigestOf(base) }) };
}

/**
 * Resolve the Device 360 sheet for one asset from built view models —
 * the route's param binding. Unknown asset => refused `unknown-asset`
 * (fail closed; no existence probing beyond the refusal itself).
 */
export function device360SheetFor(
  models: AssetFieldHostViewModels,
  assetId: string,
):
  | { readonly ok: true; readonly sheet: Device360Sheet }
  | { readonly ok: false; readonly rejected: ViewRejection; readonly detail: string } {
  const sheet = models.device360.find((s) => s.assetId === assetId);
  if (!sheet) {
    return {
      ok: false,
      rejected: "unknown-asset",
      detail: `asset ${assetId} is not part of tenant ${models.tenantId}`,
    };
  }
  return { ok: true, sheet };
}
