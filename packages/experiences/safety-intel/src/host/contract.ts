/**
 * @fleetos/experience-safety-intel — host contract (F300B deliverable 1).
 *
 * LOCAL structural mirror of the TL's WAVE10-HOST-CONTRACT §2 seam
 * (`spec/integration/WAVE10-HOST-CONTRACT.md` — TL-owned; workers propose,
 * only the TL edits that file). There is NO import of any TL-owned package
 * here: the mirror is LOCAL and compile-pinned by tests, exactly like the
 * `SubmitCommandInputMirror` seam in `../command-intents.ts`. If the host
 * contract changes, the TL re-adjudicates this seam.
 *
 * Laws machine-tested in `tests/host-surface.test.ts`:
 *   - the surface is PURE + DETERMINISTIC (same slice + ctx => byte-identical
 *     view models — the existing experience law extended to the host boundary);
 *   - NO second business-truth store: `buildViewModels` reads the lane's REAL
 *     read-models only — it never caches, derives-new-truth, or embeds a store;
 *   - intents are INERT CommandDraft records (the TL app binds them to the
 *     real control-plane submit — never this package);
 *   - tenant fail-closed (A8): cross-tenant records refuse the WHOLE view,
 *     offender named, no partial state;
 *   - honesty fields: unsupported/undeployed capabilities carry machine-
 *     readable limitation markers, never simulated success.
 */

// ---------------------------------------------------------------------------
// TenantContext — LOCAL structural mirror (the kernel owns the real one)
// ---------------------------------------------------------------------------

/**
 * LOCAL structural mirror of the kernel's `TenantContext`
 * (packages/kernel/src/tenant.ts — fields copied verbatim for the seam).
 * `"cross-tenant-forbidden"` is rejected by construction upstream, so the
 * mirror accepts only the legal scopes; a context that does not shape-match
 * the kernel value fails the host's own validation.
 */
export interface HostTenantContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly establishedAt: number;
  readonly scope: "self" | "tenant";
}

// ---------------------------------------------------------------------------
// Route manifest — the 7 F300B routes (packet deliverable 1)
// ---------------------------------------------------------------------------

/** The stable route ids of the safety/intelligence surface. */
export type HostRouteId =
  | "findings-board"
  | "evidence-chain"
  | "guardian-decision"
  | "action-authorization"
  | "execution-results"
  | "inspect-why"
  | "advisory-board";

export interface HostRouteDescriptor {
  readonly routeId: HostRouteId;
  readonly title: string;
  readonly description: string;
  /** Drill-down refs to sibling routes (no dangling refs — machine-tested). */
  readonly drills: readonly HostRouteId[];
}

/** route id -> descriptor (complete over the 7-route vocabulary). */
export type HostRouteManifest = Readonly<Record<HostRouteId, HostRouteDescriptor>>;

export const SAFETY_INTEL_ROUTES: HostRouteManifest = {
  "findings-board": {
    routeId: "findings-board",
    title: "Security Findings Board",
    description:
      "Severity rollups, triage queue and evidence-gated remediation progress over the real findings read-model",
    drills: ["evidence-chain", "guardian-decision"],
  },
  "evidence-chain": {
    routeId: "evidence-chain",
    title: "Evidence Chain",
    description:
      "The tamper-evident evidence chain with per-entry digests, verification outcome and A13 traceability links",
    drills: ["findings-board", "inspect-why"],
  },
  "guardian-decision": {
    routeId: "guardian-decision",
    title: "Guardian Decision View",
    description:
      "Rule catalog with applicability summaries and the capability-ceiling board (ceilings are NOT authorizations)",
    drills: ["action-authorization", "inspect-why"],
  },
  "action-authorization": {
    routeId: "action-authorization",
    title: "Action Authorization",
    description:
      "The action-plan board joined against the real command queue with dead-letter visibility and step authorization state",
    drills: ["guardian-decision", "execution-results"],
  },
  "execution-results": {
    routeId: "execution-results",
    title: "Execution Results + Audit Trail",
    description:
      "Execution ledger entries with hash-chain verification, ledger replay summary and the action audit trail",
    drills: ["inspect-why", "action-authorization"],
  },
  "inspect-why": {
    routeId: "inspect-why",
    title: "Inspect Why (Decision Provenance)",
    description:
      "Decision provenance: guardian block, reason chain, grants, execution journal slice and evidence refs, digest-covered",
    drills: ["evidence-chain", "guardian-decision"],
  },
  "advisory-board": {
    routeId: "advisory-board",
    title: "Predictive Advisory Board",
    description:
      "Advisory cards with provenance, uncertainty and model identity; every model disclosed as deterministic structural/reference unless genuinely trained",
    drills: ["findings-board"],
  },
};

// ---------------------------------------------------------------------------
// Intent catalog — UI events -> the lane's existing inert CommandDraft builders
// ---------------------------------------------------------------------------

/** The stable UI-event ids this surface emits. */
export type HostIntentEventId =
  | "security.findings.request-remediation"
  | "security.plans.propose-step"
  | "security.advisory.request-refresh";

/** The builder ids of the lane's existing inert intent builders. */
export type HostIntentBuilderId =
  | "requestRemediation"
  | "proposeActionPlanStep"
  | "requestAdvisoryRefresh";

export interface HostIntentDescriptor {
  readonly eventId: HostIntentEventId;
  readonly title: string;
  readonly builderId: HostIntentBuilderId;
  /** Payload fields the UI must supply (besides the intent identity block). */
  readonly requiredInputs: readonly string[];
  /** Machine-carried: a host intent is an INERT draft, never an execution. */
  readonly inert: true;
}

/** UI event id -> descriptor (complete over the 3-event vocabulary). */
export type HostIntentCatalog = Readonly<Record<HostIntentEventId, HostIntentDescriptor>>;

export const SAFETY_INTEL_INTENTS: HostIntentCatalog = {
  "security.findings.request-remediation": {
    eventId: "security.findings.request-remediation",
    title: "Request remediation for a finding set",
    builderId: "requestRemediation",
    requiredInputs: ["proposalId", "findingIds", "remediationKind"],
    inert: true,
  },
  "security.plans.propose-step": {
    eventId: "security.plans.propose-step",
    title: "Propose an action-plan step",
    builderId: "proposeActionPlanStep",
    requiredInputs: ["planId", "stepId", "stepCapabilityId", "stepInputs"],
    inert: true,
  },
  "security.advisory.request-refresh": {
    eventId: "security.advisory.request-refresh",
    title: "Request an advisory refresh",
    builderId: "requestAdvisoryRefresh",
    requiredInputs: ["assetId", "metric", "horizonSteps", "horizonStepMs"],
    inert: true,
  },
};

/** Runtime guard for untrusted event ids (the catalog is the truth). */
export function isKnownIntentEvent(eventId: string): eventId is HostIntentEventId {
  return (
    eventId === "security.findings.request-remediation" ||
    eventId === "security.plans.propose-step" ||
    eventId === "security.advisory.request-refresh"
  );
}

// ---------------------------------------------------------------------------
// HostSurface — the seam shape (contract §2, verbatim)
// ---------------------------------------------------------------------------

/**
 * The HostSurface adapter shape per WAVE10-HOST-CONTRACT §2. `VM` is the
 * lane's honest view-model RESULT: a discriminated ok/refused union — tenant
 * fail-closed refusals are part of the honest value the host renders.
 */
export interface HostSurface<Slice, VM> {
  /** Stable surface id (never renumbered — the shell routes on it). */
  readonly surfaceId: string;
  readonly surfaceKind: "lane-experience";
  readonly routes: HostRouteManifest;
  /** Pure, deterministic: same slice + ctx => byte-identical view models. */
  readonly buildViewModels: (slice: Slice, ctx: HostTenantContext) => VM;
  readonly intents: HostIntentCatalog;
}
