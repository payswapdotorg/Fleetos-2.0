/**
 * @fleetos/model-gateway — model ROUTING (F230C, Wave 3 lane C).
 *
 * Deterministic model selection over the registry:
 *   1. capability match filter — the model must carry ALL required tags;
 *   2. cost/budget filter — estimated cost (estimatedUnits × integer
 *      minor-unit cost per unit) must fit the request's budget ceiling;
 *      plus the context filter (estimatedUnits ≤ model context limit);
 *   3. priority ordering — urgency-richness-first for high urgency,
 *      urgency-cost-first for low urgency, with a documented, recorded
 *      tie-break (model id lexical).
 *
 * EVERY decision — success or refusal — carries machine-stable reason
 * codes and a decision digest byte-identical for identical inputs
 * (laws A12, A19). Pure function: no I/O, no wall clock, no randomness.
 */

import type { ModelDescriptor } from "./registry.js";
import { validateModelRegistry } from "./registry.js";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Selection request + decision.
// ---------------------------------------------------------------------------

/** Integer priority: 1 (highest urgency) … 5 (lowest). */
export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 5;
/** Urgency at or below this value prefers capability-rich models. */
export const URGENCY_RICHNESS_THRESHOLD = 2;

export interface ModelSelectionRequest {
  readonly tenantId: string;
  readonly requiredCapabilities: readonly string[];
  readonly priority: number;
  /** Budget ceiling for the whole request, integer minor units. */
  readonly budgetCeilingMinor: number;
  /** Estimated usage units (e.g. tokens) for the request. */
  readonly estimatedUnits: number;
}

export interface RankedCandidate {
  readonly rank: number;
  readonly modelId: string;
  readonly providerId: string;
  readonly costPerUnitMinor: number;
  readonly estimatedCostMinor: number;
  readonly capabilityTagCount: number;
}

export type SelectionOrderingRule = "urgency-richness-first" | "urgency-cost-first";

export type ModelSelectionDecision =
  | {
      readonly ok: true;
      readonly selectedModelId: string;
      readonly providerId: string;
      readonly estimatedCostMinor: number;
      readonly orderingRule: SelectionOrderingRule;
      readonly tieBreakRule: "model-id-lexical";
      readonly rankedCandidates: readonly RankedCandidate[];
      readonly candidatesConsidered: number;
      readonly digest: string;
    }
  | {
      readonly ok: false;
      readonly reasonCode: SelectionReasonCode;
      readonly detail: string | null;
      readonly missingCapabilities: readonly string[] | null;
      readonly contextShortfallUnits: number | null;
      readonly cheapestCostMinor: number | null;
      readonly budgetOvershootMinor: number | null;
      readonly candidatesConsidered: number;
      readonly digest: string;
    };

export type SelectionReasonCode =
  | "TENANT_ID_EMPTY"
  | "REQUIRED_CAPABILITIES_EMPTY"
  | "PRIORITY_OUT_OF_RANGE"
  | "BUDGET_CEILING_NEGATIVE"
  | "NON_INTEGER_AMOUNT"
  | "ESTIMATED_UNITS_NEGATIVE"
  | "REGISTRY_INVALID"
  | "NO_MODEL_WITH_CAPABILITIES"
  | "MODEL_CONTEXT_EXCEEDED"
  | "BUDGET_CEILING_EXCEEDED";

// ---------------------------------------------------------------------------
// The pure selection function.
// ---------------------------------------------------------------------------

export function selectModel(
  registry: readonly ModelDescriptor[],
  request: ModelSelectionRequest,
): ModelSelectionDecision {
  const pre = precheckRequest(request);
  if (!pre.ok) return pre.refusal;

  const registryCheck = validateModelRegistry(registry);
  if (!registryCheck.ok) {
    return refuseSelection(request, "REGISTRY_INVALID", registryCheck.reasonCode, null, null, null, null, 0);
  }

  // Stage 1 — capability match filter.
  const capabilityMatches = registry.filter((model) => {
    const tags = new Set(model.capabilityTags);
    return request.requiredCapabilities.every((tag) => tags.has(tag));
  });
  if (capabilityMatches.length === 0) {
    const missing = missingCapabilitiesNoModelHas(registry, request.requiredCapabilities);
    return refuseSelection(
      request,
      "NO_MODEL_WITH_CAPABILITIES",
      "capability-filter-empty",
      missing,
      null,
      null,
      null,
      registry.length,
    );
  }

  // Stage 2 — context filter, then cost/budget filter.
  const contextFits = capabilityMatches.filter((m) => request.estimatedUnits <= m.maxContextUnits);
  if (contextFits.length === 0) {
    let smallestShortfall = Number.POSITIVE_INFINITY;
    for (const m of capabilityMatches) {
      const shortfall = request.estimatedUnits - m.maxContextUnits;
      if (shortfall < smallestShortfall) smallestShortfall = shortfall;
    }
    return refuseSelection(
      request,
      "MODEL_CONTEXT_EXCEEDED",
      "context-filter-empty",
      null,
      smallestShortfall,
      null,
      null,
      capabilityMatches.length,
    );
  }
  const affordableWithContext = contextFits.map((m) => ({
    model: m,
    estimatedCostMinor: request.estimatedUnits * m.costPerUnitMinor,
  }));
  const budgetFits = affordableWithContext.filter((c) => c.estimatedCostMinor <= request.budgetCeilingMinor);
  if (budgetFits.length === 0) {
    let cheapest: number | null = null;
    for (const c of affordableWithContext) {
      if (cheapest === null || c.estimatedCostMinor < cheapest) cheapest = c.estimatedCostMinor;
    }
    return refuseSelection(
      request,
      "BUDGET_CEILING_EXCEEDED",
      "budget-filter-empty",
      null,
      null,
      cheapest,
      cheapest === null ? null : cheapest - request.budgetCeilingMinor,
      contextFits.length,
    );
  }

  // Stage 3 — priority ordering with documented, recorded tie-breaks.
  const orderingRule: SelectionOrderingRule =
    request.priority <= URGENCY_RICHNESS_THRESHOLD ? "urgency-richness-first" : "urgency-cost-first";
  const ordered = [...budgetFits].sort((a, b) => {
    if (orderingRule === "urgency-richness-first") {
      if (a.model.capabilityTags.length !== b.model.capabilityTags.length) {
        return b.model.capabilityTags.length - a.model.capabilityTags.length;
      }
      if (a.estimatedCostMinor !== b.estimatedCostMinor) return a.estimatedCostMinor - b.estimatedCostMinor;
      return a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0;
    }
    if (a.estimatedCostMinor !== b.estimatedCostMinor) return a.estimatedCostMinor - b.estimatedCostMinor;
    if (a.model.capabilityTags.length !== b.model.capabilityTags.length) {
      return b.model.capabilityTags.length - a.model.capabilityTags.length;
    }
    return a.model.id < b.model.id ? -1 : a.model.id > b.model.id ? 1 : 0;
  });
  const rankedCandidates: RankedCandidate[] = ordered.map((c, index) => ({
    rank: index + 1,
    modelId: c.model.id,
    providerId: c.model.providerId,
    costPerUnitMinor: c.model.costPerUnitMinor,
    estimatedCostMinor: c.estimatedCostMinor,
    capabilityTagCount: c.model.capabilityTags.length,
  }));
  const top = ordered[0] as { model: ModelDescriptor; estimatedCostMinor: number };
  return {
    ok: true,
    selectedModelId: top.model.id,
    providerId: top.model.providerId,
    estimatedCostMinor: top.estimatedCostMinor,
    orderingRule,
    tieBreakRule: "model-id-lexical",
    rankedCandidates,
    candidatesConsidered: budgetFits.length,
    digest: computeSelectionDigest(request, top.model.id),
  };
}

// ---------------------------------------------------------------------------
// Request precheck — typed refusals for malformed inputs.
// ---------------------------------------------------------------------------

interface PrecheckOk {
  readonly ok: true;
}
type Precheck = PrecheckOk | { readonly ok: false; readonly refusal: Extract<ModelSelectionDecision, { ok: false }> };

function precheckRequest(request: ModelSelectionRequest): Precheck {
  if (typeof request.tenantId !== "string" || request.tenantId.length === 0) {
    return { ok: false, refusal: refuseSelection(request, "TENANT_ID_EMPTY", null, null, null, null, null, 0) };
  }
  if (!Array.isArray(request.requiredCapabilities) || request.requiredCapabilities.length === 0) {
    return { ok: false, refusal: refuseSelection(request, "REQUIRED_CAPABILITIES_EMPTY", null, null, null, null, null, 0) };
  }
  if (
    !Number.isInteger(request.priority) ||
    request.priority < PRIORITY_MIN ||
    request.priority > PRIORITY_MAX
  ) {
    return { ok: false, refusal: refuseSelection(request, "PRIORITY_OUT_OF_RANGE", String(request.priority), null, null, null, null, 0) };
  }
  if (!Number.isInteger(request.budgetCeilingMinor) || !Number.isInteger(request.estimatedUnits)) {
    return { ok: false, refusal: refuseSelection(request, "NON_INTEGER_AMOUNT", null, null, null, null, null, 0) };
  }
  if (request.budgetCeilingMinor < 0) {
    return { ok: false, refusal: refuseSelection(request, "BUDGET_CEILING_NEGATIVE", null, null, null, null, null, 0) };
  }
  if (request.estimatedUnits < 0) {
    return { ok: false, refusal: refuseSelection(request, "ESTIMATED_UNITS_NEGATIVE", null, null, null, null, null, 0) };
  }
  return { ok: true };
}

function refuseSelection(
  request: ModelSelectionRequest,
  reasonCode: SelectionReasonCode,
  detail: string | null,
  missingCapabilities: readonly string[] | null,
  contextShortfallUnits: number | null,
  cheapestCostMinor: number | null,
  budgetOvershootMinor: number | null,
  candidatesConsidered: number,
): Extract<ModelSelectionDecision, { ok: false }> {
  return {
    ok: false,
    reasonCode,
    detail,
    missingCapabilities,
    contextShortfallUnits,
    cheapestCostMinor,
    budgetOvershootMinor,
    candidatesConsidered,
    digest: computeSelectionDigest(request, reasonCode),
  };
}

function missingCapabilitiesNoModelHas(
  registry: readonly ModelDescriptor[],
  required: readonly string[],
): readonly string[] {
  const covered = new Set<string>();
  for (const model of registry) {
    for (const tag of model.capabilityTags) covered.add(tag);
  }
  return required.filter((tag) => !covered.has(tag));
}

// ---------------------------------------------------------------------------
// Decision digest (law A19).
// ---------------------------------------------------------------------------

export function computeSelectionDigest(
  request: ModelSelectionRequest,
  result: string,
): string {
  return `mroute_${fnv1a32([
    request.tenantId,
    request.requiredCapabilities.join(","),
    request.priority,
    request.estimatedUnits,
    request.budgetCeilingMinor,
    result,
  ])}`;
}
