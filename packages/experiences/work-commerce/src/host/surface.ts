/**
 * @fleetos/experience-work-commerce — the HostSurface view-model builder
 * (F300C; WAVE10-HOST-CONTRACT §2).
 *
 * `buildViewModels(slice, ctx)` projects the lane's REAL read-model
 * assemblies over the tenant-scoped slice, as-of the context's logical
 * time (ctx.establishedAt — the ONLY time source; no clock, no Date.now,
 * no randomness; every builder's `computedAt` is the derived ISO instant).
 * Same slice + same context => byte-identical view models
 * (machine-tested), because every underlying assembly is pure and
 * deterministic and the per-project sheets are built in projectId order.
 *
 * NO SECOND BUSINESS-TRUTH STORE: each field is the REAL assembly's own
 * output (work board, per-project stage gates, workload rollup, spine
 * board, vendor KPI, seat view, role board, capability budgets, gateway
 * usage) — nothing is cached or re-derived here; refusals surface
 * VERBATIM per route assembly (the existing lane law).
 *
 * TENANT FAIL-CLOSED at the seam: the context's tenant must own the
 * slice — otherwise the WHOLE bundle is refused (`tenant-mismatch`)
 * before any projection runs. Cross-tenant records inside the slice keep
 * refusing the per-route assemblies (existing lane law, verbatim).
 *
 * HONEST NOT-COMPOSED: quote scoring is a caller-composed analysis —
 * when the TL did not compose scoring inputs, the bundle carries an
 * explicit `composed: false` marker (never a fabricated ranking).
 */

import type { WorkItem } from "@fleetos/work";
import type { Project, Milestone, ProjectStage } from "@fleetos/projects";
import type { WorkloadCapacity, WorkloadAllocation } from "@fleetos/workloads";
import type { Need, ProcurementDemand, Quote, Order, Fulfillment, QuoteScoreInput, ScoringWeights } from "@fleetos/procurement";
import type { VendorLifecycleRecord, ServiceExposureLedger } from "@fleetos/vendors";
import type { Subscription, Entitlement } from "@fleetos/software";
import type { RoleAssignment, CapabilityBudgetRecord } from "@fleetos/agent-organizations";
import type { UsageLedgerEntry } from "@fleetos/model-gateway";
import type { HostRouteLimitation, HostTenantContext } from "./contract.js";
import { WORK_COMMERCE_ROUTES } from "./routes.js";
import { buildWorkBoard, buildProjectStageGateView, buildWorkloadRollup, type WorkBoardResult, type StageGateResult, type WorkloadRollupResult } from "../work-views.js";
import { buildSpineBoard, buildVendorKpiRollup, buildSeatView, buildQuoteScoreView, type SpineBoardResult, type VendorKpiResult, type SeatViewResult, type QuoteScoreViewResult } from "../commerce-views.js";
import { buildRoleAssignmentBoard, buildCapabilityBudgetBoard, buildModelUsageRollup, type RoleAssignmentBoardResult, type BudgetBoardResult, type ModelUsageRollupResult } from "../org-views.js";
import { checkTenantScope, fnv1a32 } from "../internal-view.js";

// ---------------------------------------------------------------------------
// The slice — the lane's REAL read-models (TL-composed, caller-supplied).
// ---------------------------------------------------------------------------

/** Quote-scoring analysis inputs (caller-composed, per demand). */
export interface QuoteScoreSheetInput {
  readonly demandId: string;
  readonly requiredCapabilityTags: readonly string[];
  readonly quotes: readonly QuoteScoreInput[];
  readonly weights?: ScoringWeights;
}

/**
 * The composed lane state the host projects. The TL app assembles this
 * from the real domain state (the acceptance-suite composition pattern);
 * this adapter never caches it, never mutates it, never embeds a store.
 */
export interface WorkCommerceSlice {
  readonly tenantId: string;
  // work-board
  readonly workItems: readonly WorkItem[];
  // project-stage-gates
  readonly projects: readonly Project[];
  readonly stages: readonly ProjectStage[];
  readonly milestones: readonly Milestone[];
  // workload-rollup
  readonly capacities: readonly WorkloadCapacity[];
  readonly allocations: readonly WorkloadAllocation[];
  // procurement-spine
  readonly needs: readonly Need[];
  readonly demands: readonly ProcurementDemand[];
  readonly quotes: readonly Quote[];
  readonly orders: readonly Order[];
  readonly fulfillments: readonly Fulfillment[];
  // vendor-kpi
  readonly vendors: readonly VendorLifecycleRecord[];
  readonly exposures: readonly ServiceExposureLedger[];
  // quote-scoring (OPTIONAL caller-composed analysis)
  readonly quoteScoreInputs?: readonly QuoteScoreSheetInput[];
  // software-entitlements
  readonly subscriptions: readonly Subscription[];
  readonly entitlements: readonly Entitlement[];
  // org-budgets
  readonly assignments: readonly RoleAssignment[];
  readonly budgets: readonly CapabilityBudgetRecord[];
  readonly usage: readonly UsageLedgerEntry[];
}

// ---------------------------------------------------------------------------
// The view models.
// ---------------------------------------------------------------------------

export type HostSurfaceRejection =
  | "tenant-mismatch"
  | "malformed-context"
  | "invalid-established-at"
  | "forbidden-scope";

export type HostViewModelResult =
  | { readonly ok: true; readonly models: WorkCommerceHostViewModels }
  | { readonly ok: false; readonly rejected: HostSurfaceRejection; readonly detail: string };

/** One stage-gate sheet: the REAL project assembly's own outcome. */
export interface StageGateSheet {
  readonly projectId: string;
  readonly outcome: StageGateResult;
}

/** One quote-score sheet: the REAL scoring view's own outcome. */
export interface QuoteScoreSheet {
  readonly demandId: string;
  readonly outcome: QuoteScoreViewResult;
}

/** Honest not-composed marker when the TL composed no scoring inputs. */
export interface QuoteScoreNotComposed {
  readonly composed: false;
  readonly marker: "quote-scoring:caller-composed";
}

export type QuoteScoreSheets =
  | { readonly composed: true; readonly sheets: readonly QuoteScoreSheet[] }
  | QuoteScoreNotComposed;

/** Honest per-route limitation markers, surfaced with every build. */
export interface RouteLimitations {
  readonly routeId: string;
  readonly markers: readonly string[];
}

export interface WorkCommerceHostViewModels {
  readonly surfaceId: "work-commerce";
  readonly tenantId: string;
  /** Logical build instant (ctx.establishedAt) — every view's asOf. */
  readonly asOf: number;
  /** Derived ISO instant — every assembly's computedAt/now. */
  readonly computedAt: string;
  readonly workBoard: WorkBoardResult;
  /** Route project-stage-gates: one sheet per project, projectId order. */
  readonly stageGates: readonly StageGateSheet[];
  readonly workloadRollup: WorkloadRollupResult;
  readonly spineBoard: SpineBoardResult;
  readonly vendorKpi: VendorKpiResult;
  readonly quoteScore: QuoteScoreSheets;
  readonly seatView: SeatViewResult;
  readonly roleBoard: RoleAssignmentBoardResult;
  readonly budgetBoard: BudgetBoardResult;
  readonly usageRollup: ModelUsageRollupResult;
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
 * well-formed tenant (the LANE's own tenant law), non-empty actor/role,
 * finite positive logical time, no forbidden scope.
 */
function guardHostContext(ctx: HostTenantContext): ReturnType<typeof refuse> | null {
  if (typeof ctx.establishedAt !== "number" || !Number.isFinite(ctx.establishedAt) || ctx.establishedAt <= 0) {
    return refuse("invalid-established-at", "context establishedAt must be finite and positive");
  }
  const tenant = checkTenantScope(ctx);
  if (!tenant.ok) {
    return refuse("malformed-context", `context tenantId ${String(ctx.tenantId)} fails the lane tenant law`);
  }
  if (typeof ctx.actorId !== "string" || ctx.actorId.length === 0) {
    return refuse("malformed-context", "context actorId must be a non-empty string");
  }
  if (typeof ctx.roleId !== "string" || ctx.roleId.length === 0) {
    return refuse("malformed-context", "context roleId must be a non-empty string");
  }
  if (ctx.scope === "cross-tenant-forbidden") {
    return refuse("forbidden-scope", "cross-tenant scope is refused at the host boundary");
  }
  return null;
}

function hostViewModelsDigestOf(models: Omit<WorkCommerceHostViewModels, "digest">): string {
  return `wchost_${fnv1a32([JSON.stringify(models)])}`;
}

/** Recompute the bundle digest; false means tampered view models. */
export function verifyHostViewModelsDigest(models: WorkCommerceHostViewModels): boolean {
  const { digest, ...rest } = models;
  return hostViewModelsDigestOf(rest) === digest;
}

/** The stage-gate sheet for one project (null when the id is unknown). */
export function stageGateSheetFor(
  models: WorkCommerceHostViewModels,
  projectId: string,
): { readonly ok: true; readonly sheet: StageGateSheet } | { readonly ok: false; readonly detail: string } {
  const sheet = models.stageGates.find((s) => s.projectId === projectId);
  if (sheet === undefined) return { ok: false, detail: `no project ${projectId} in the slice` };
  return { ok: true, sheet };
}

/**
 * Build the whole surface's view models over the REAL read-models.
 * Pure, deterministic, tenant fail-closed at the seam.
 */
export function buildViewModels(slice: WorkCommerceSlice, ctx: HostTenantContext): HostViewModelResult {
  const contextFailure = guardHostContext(ctx);
  if (contextFailure) return contextFailure;
  const sliceTenant = checkTenantScope(slice);
  if (!sliceTenant.ok) {
    return refuse("malformed-context", `slice tenantId ${String(slice.tenantId)} fails the lane tenant law`);
  }
  if (ctx.tenantId !== slice.tenantId) {
    return refuse(
      "tenant-mismatch",
      `context tenant ${ctx.tenantId} does not own slice tenant ${slice.tenantId}`,
    );
  }
  const now = ctx.establishedAt;
  const computedAt = new Date(now).toISOString();
  const tenant = { tenantId: slice.tenantId };

  const workBoard = buildWorkBoard({ tenant, workItems: slice.workItems, computedAt });

  const stageGates: StageGateSheet[] = [...slice.projects]
    .sort((a, b) => a.id.value.localeCompare(b.id.value))
    .map((project) => ({
      projectId: project.id.value,
      outcome: buildProjectStageGateView({
        tenant,
        project,
        stages: slice.stages.filter((s) => s.projectId === project.id.value),
        milestones: slice.milestones.filter((m) => m.projectId === project.id.value),
        workItems: slice.workItems.filter((w) => w.projectId === project.id.value),
        computedAt,
      }),
    }));

  const workloadRollup = buildWorkloadRollup({
    tenant,
    capacities: slice.capacities,
    allocations: slice.allocations,
    computedAt,
  });

  const spineBoard = buildSpineBoard({
    tenant,
    needs: slice.needs,
    demands: slice.demands,
    quotes: slice.quotes,
    orders: slice.orders,
    fulfillments: slice.fulfillments,
    computedAt,
  });

  const vendorKpi = buildVendorKpiRollup({
    tenant,
    vendors: slice.vendors,
    quotes: slice.quotes,
    exposures: slice.exposures,
    computedAt,
  });

  const quoteScore: QuoteScoreSheets =
    slice.quoteScoreInputs === undefined
      ? { composed: false, marker: "quote-scoring:caller-composed" }
      : {
          composed: true,
          sheets: [...slice.quoteScoreInputs]
            .sort((a, b) => a.demandId.localeCompare(b.demandId))
            .map((input) => ({
              demandId: input.demandId,
              outcome: buildQuoteScoreView({
                tenant,
                demand: { requiredCapabilityTags: input.requiredCapabilityTags },
                quotes: input.quotes,
                ...(input.weights === undefined ? {} : { weights: input.weights }),
                computedAt,
              }),
            })),
        };

  const seatView = buildSeatView({
    tenant,
    subscriptions: slice.subscriptions,
    entitlements: slice.entitlements,
    now: computedAt,
    computedAt,
  });

  const roleBoard = buildRoleAssignmentBoard({
    tenant,
    assignments: slice.assignments,
    computedAt,
  });

  const budgetBoard = buildCapabilityBudgetBoard({
    tenant,
    budgets: slice.budgets,
    computedAt,
  });

  const usageRollup = buildModelUsageRollup({
    tenant,
    usage: slice.usage,
    computedAt,
  });

  const routeLimitations: RouteLimitations[] = WORK_COMMERCE_ROUTES.map((route) => ({
    routeId: route.routeId,
    markers: route.limitations.map((l: HostRouteLimitation) => l.marker),
  }));

  const base: Omit<WorkCommerceHostViewModels, "digest"> = {
    surfaceId: "work-commerce",
    tenantId: slice.tenantId,
    asOf: now,
    computedAt,
    workBoard,
    stageGates,
    workloadRollup,
    spineBoard,
    vendorKpi,
    quoteScore,
    seatView,
    roleBoard,
    budgetBoard,
    usageRollup,
    routeLimitations,
  };
  return { ok: true, models: { ...base, digest: hostViewModelsDigestOf(base) } };
}
