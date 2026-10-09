/**
 * @fleetos/experience-work-commerce — the HostSurface contract types
 * (F300C, Wave 10 lane C; per spec/integration/WAVE10-HOST-CONTRACT.md §2).
 *
 * The single seam this lane integrates with the TL application host through:
 * a stable surface id, a route manifest (route id -> title, drill-down
 * refs, honest limitation markers), a pure deterministic view-model
 * builder over the lane's REAL read-models, and an intent catalog mapping
 * UI events to the lane's EXISTING inert CommandDraft builders.
 *
 * LAWS (machine-tested in this package's tests):
 * - Pure and deterministic: same slice + context => byte-identical
 *   view models (the existing experience law, extended to the host seam).
 * - No second business-truth store: buildViewModels projects the lane's
 *   real read-model assemblies only — it never caches, derives-new-truth
 *   or embeds a store.
 * - Inert intents: the catalog is DATA; CommandDraft records stay inert.
 *   Binding drafts to the control-plane CommandQueue.submit is TL work.
 * - Tenant fail-closed: a context tenant that does not own the slice
 *   refuses the WHOLE view-model bundle; cross-tenant records inside the
 *   slice keep refusing every per-route assembly (existing lane law,
 *   surfaced verbatim).
 * - Honesty fields: undeployed/unsupported capabilities carry
 *   machine-readable limitation markers, never simulated success.
 *
 * ROLE LENSES are presentation-only (AGENTS.md UI rules): `offeredTo`
 * changes which intents the UI OFFERS, never what is authorized —
 * adjudication belongs to the control plane + Guardian (the draft's
 * capabilityRequirement is a REQUEST, never an authorization).
 *
 * LOCAL structural context (law A20): this package does not depend on
 * @fleetos/identity (worker-a lane); the host context is the documented
 * local seam shape, validated by the lane's own tenant law.
 */

// ---------------------------------------------------------------------------
// The host context (LOCAL structural seam).
// ---------------------------------------------------------------------------

/**
 * The tenant/actor/role context the TL app supplies to every host call.
 * `establishedAt` is the ONLY time source (logical epoch ms — no clock).
 */
export interface HostTenantContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly roleId: string;
  readonly establishedAt: number;
  readonly scope: "self" | "tenant" | "cross-tenant-forbidden";
}

// ---------------------------------------------------------------------------
// The HostSurface interface (WAVE10-HOST-CONTRACT §2 shape).
// ---------------------------------------------------------------------------

export interface HostSurface<Slice = unknown, VM = unknown> {
  /** Stable surface identifier. */
  readonly surfaceId: string;
  readonly surfaceKind: "lane-experience";
  /** Route id -> title, path, view-model refs, drill-down refs, markers. */
  readonly routes: HostRouteManifest;
  /** Pure deterministic projection of the lane's REAL read-models. */
  buildViewModels(slice: Slice, ctx: HostTenantContext): VM;
  /** UI event -> CommandDraft builder id (inert intent catalog). */
  readonly intents: HostIntentCatalog;
}

// ---------------------------------------------------------------------------
// Route manifest vocabulary.
// ---------------------------------------------------------------------------

/** The view-model fields a route renders (keys of the host view models). */
export type HostViewModelKey =
  | "workBoard"
  | "stageGates"
  | "workloadRollup"
  | "spineBoard"
  | "vendorKpi"
  | "quoteScore"
  | "seatView"
  | "roleBoard"
  | "budgetBoard"
  | "usageRollup";

/** A drill-down reference: the target route plus the param it binds. */
export interface HostRouteRef {
  readonly routeId: string;
  /** Route parameter the drill-down supplies (e.g. "projectId"). */
  readonly param?: string;
}

/**
 * A machine-readable honest-limitation marker. Present means the
 * capability is NOT fully provided at this seam — never simulated.
 */
export interface HostRouteLimitation {
  /** Stable marker id, e.g. "external-adapters:contract-only". */
  readonly marker: string;
  readonly detail: string;
}

export interface HostRoute {
  readonly routeId: string;
  /** Shell path template (params as `:name` segments). */
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  /** Which view-model fields this route renders (deterministic order). */
  readonly viewModels: readonly HostViewModelKey[];
  /** Routes this one drills down into. */
  readonly drillDown: readonly HostRouteRef[];
  /** Honest markers for undeployed/unsupported capabilities on this route. */
  readonly limitations: readonly HostRouteLimitation[];
}

export type HostRouteManifest = readonly HostRoute[];

// ---------------------------------------------------------------------------
// Intent catalog vocabulary.
// ---------------------------------------------------------------------------

/**
 * Presentation role lenses offered on this surface. These align with the
 * acceptance lane's fixed 7-persona vocabulary (operations-manager ..
 * finance-controller) and are PRESENTATION-ONLY: they decide which
 * intents the UI offers a role, never what the control plane + Guardian
 * authorize.
 */
export const HOST_SURFACE_ROLES = [
  "operations-manager",
  "procurement-lead",
  "project-manager",
  "vendor-manager",
  "software-admin",
  "org-optimizer",
  "finance-controller",
] as const;
export type HostSurfaceRole = (typeof HOST_SURFACE_ROLES)[number];

export interface HostIntentSpec {
  /** Stable intent id, e.g. "work-commerce.create-work-order". */
  readonly intentId: string;
  /** The UI event that triggers the intent, e.g. "work-board:create-work-order". */
  readonly event: string;
  /** The EXISTING CommandDraft builder id (command-intents.ts). */
  readonly builderId: string;
  /** The route the affordance renders on. */
  readonly routeId: string;
  readonly title: string;
  readonly description: string;
  /** The capability REQUEST the draft carries (Guardian adjudicates). */
  readonly capabilityRequest: string;
  /** Presentation role lenses the UI offers this intent to. */
  readonly offeredTo: readonly HostSurfaceRole[];
}

export type HostIntentCatalog = readonly HostIntentSpec[];
