/**
 * @fleetos/agent-organizations — model routing optimization PROPOSALS
 * (F260C), over the REAL model-gateway registry, routing, providers and
 * fallback-ladder implementations.
 *
 * Per request class: a deterministic tradeoff frontier (capability vs cost
 * vs priority) whose ordering rule mirrors the gateway's own urgency
 * semantics; every point and every proposal carries reason codes from the
 * gateway's vocabulary. When degradation history indicates, fallback
 * ladders are proposed for REORDERING — the projected hops come from the
 * REAL `resolveFallbackLadder`.
 *
 * LAW: the optimizer PROPOSES, never applies (A5/A6). Pure deterministic
 * TS; integer bps everywhere.
 */

import type { OptimizationProblem } from "./optimization-inputs.js";
import { verifyOptimizationProblemDigest } from "./optimization-inputs.js";
import type {
  FallbackHop,
  ModelDescriptor,
  ProviderRecord,
  SelectionOrderingRule,
} from "@fleetos/model-gateway";
import {
  resolveFallbackLadder,
  selectModel,
  validateModelRegistry,
  validateProviderRecords,
  URGENCY_RICHNESS_THRESHOLD,
} from "@fleetos/model-gateway";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Inputs + proposal records.
// ---------------------------------------------------------------------------

export interface RequestClassSpec {
  readonly classId: string;
  readonly requiredCapabilities: readonly string[];
  readonly estimatedUnits: number;
  /** Gateway priority range: 1 (highest urgency) … 5 (lowest). */
  readonly priority: number;
  readonly budgetCeilingMinor: number;
}

export interface ProviderDegradationEvent {
  readonly providerId: string;
  readonly downEvents: number;
}

export interface LadderSpec {
  readonly modelId: string;
  readonly currentChainOrder: readonly string[];
}

export interface RoutingFrontierPoint {
  readonly modelId: string;
  readonly providerId: string;
  readonly capabilityTagCount: number;
  readonly capabilityRichnessBps: number;
  readonly estimatedCostMinor: number;
  readonly costBps: number;
  readonly latencyBps: number;
  readonly fitsContext: boolean;
  readonly fitsBudget: boolean;
  readonly scoreBps: number;
}

export interface RoutingOutcome {
  readonly selectedModelId: string | null;
  readonly estimatedCostMinor: number | null;
  readonly reasonCode: string;
}

export interface RequestClassRouting {
  readonly classId: string;
  readonly orderingRule: SelectionOrderingRule;
  readonly current: RoutingOutcome;
  readonly proposed: RoutingOutcome;
  readonly frontier: readonly RoutingFrontierPoint[];
  readonly infeasible: readonly {
    readonly modelId: string;
    readonly reasonCode: "MODEL_CONTEXT_EXCEEDED" | "BUDGET_CEILING_EXCEEDED";
  }[];
}

export interface LadderReorderProposal {
  readonly modelId: string;
  readonly currentChainOrder: readonly string[];
  readonly proposedChainOrder: readonly string[];
  readonly currentSelectedProviderId: string | null;
  readonly proposedSelectedProviderId: string | null;
  readonly currentHops: readonly FallbackHop[];
  readonly proposedHops: readonly FallbackHop[];
  readonly reasonCode: "degradation-history-reorder" | "ladder-already-optimal";
  readonly digest: string;
}

export interface RoutingOptimizationProposal {
  readonly kind: "routing-optimization-proposal";
  readonly note: "proposal-only-guardian-path";
  readonly tenantId: string;
  readonly perClass: readonly RequestClassRouting[];
  readonly ladderProposals: readonly LadderReorderProposal[];
  readonly digest: string;
}

export interface RoutingOptimizationInput {
  readonly registry: readonly ModelDescriptor[];
  readonly providers: readonly ProviderRecord[];
  readonly degradationHistory: readonly ProviderDegradationEvent[];
  readonly requestClasses: readonly RequestClassSpec[];
  readonly ladders: readonly LadderSpec[];
}

export type RoutingOptimizationResult =
  | { readonly ok: true; readonly proposal: RoutingOptimizationProposal }
  | {
      readonly ok: false;
      readonly reasonCode:
        | "PROBLEM_DIGEST_MISMATCH"
        | "REGISTRY_INVALID"
        | "PROVIDERS_INVALID"
        | "CLASS_ID_EMPTY"
        | "REQUIRED_CAPABILITIES_EMPTY"
        | "PRIORITY_OUT_OF_RANGE"
        | "BUDGET_CEILING_NEGATIVE"
        | "NON_INTEGER_AMOUNT"
        | "ESTIMATED_UNITS_NEGATIVE"
        | "DEGRADATION_HISTORY_INVALID"
        | "LADDER_EMPTY"
        | "MODEL_ID_EMPTY";
      readonly detail: string | null;
    };

// ---------------------------------------------------------------------------
// The routing optimizer.
// ---------------------------------------------------------------------------

/**
 * Optimize model routing. Deterministic: identical inputs → a byte-identical
 * proposal (including digests). `current` outcomes come from the REAL
 * `selectModel`; proposed ladder hops come from the REAL
 * `resolveFallbackLadder`. Nothing is applied — the output is a proposal
 * for the Guardian/governance path.
 */
export function optimizeRouting(
  problem: OptimizationProblem,
  input: RoutingOptimizationInput,
): RoutingOptimizationResult {
  if (!verifyOptimizationProblemDigest(problem)) {
    return { ok: false, reasonCode: "PROBLEM_DIGEST_MISMATCH", detail: null };
  }
  const registryCheck = validateModelRegistry(input.registry);
  if (!registryCheck.ok) {
    return { ok: false, reasonCode: "REGISTRY_INVALID", detail: registryCheck.reasonCode };
  }
  const providersCheck = validateProviderRecords(input.providers);
  if (!providersCheck.ok) {
    return { ok: false, reasonCode: "PROVIDERS_INVALID", detail: providersCheck.reasonCode };
  }
  for (const event of input.degradationHistory) {
    if (typeof event.providerId !== "string" || event.providerId.length === 0) {
      return { ok: false, reasonCode: "DEGRADATION_HISTORY_INVALID", detail: "PROVIDER_ID_EMPTY" };
    }
    if (!Number.isInteger(event.downEvents) || event.downEvents < 0) {
      return { ok: false, reasonCode: "DEGRADATION_HISTORY_INVALID", detail: event.providerId };
    }
  }
  for (const spec of input.requestClasses) {
    const check = validateRequestClass(spec);
    if (check) return { ok: false, reasonCode: check.reasonCode, detail: check.detail };
  }
  for (const spec of input.ladders) {
    if (typeof spec.modelId !== "string" || spec.modelId.length === 0) {
      return { ok: false, reasonCode: "MODEL_ID_EMPTY", detail: null };
    }
    if (!Array.isArray(spec.currentChainOrder) || spec.currentChainOrder.length === 0) {
      return { ok: false, reasonCode: "LADDER_EMPTY", detail: spec.modelId };
    }
  }

  const downEvents = new Map(input.degradationHistory.map((e) => [e.providerId, e.downEvents]));
  const perClass = input.requestClasses.map((spec) => buildClassRouting(problem, input, spec));
  const ladderProposals = input.ladders.map((spec) =>
    buildLadderProposal(input, spec, downEvents),
  );

  const proposalBase = {
    kind: "routing-optimization-proposal" as const,
    note: "proposal-only-guardian-path" as const,
    tenantId: problem.tenant.tenantId,
    perClass,
    ladderProposals,
  };
  return {
    ok: true,
    proposal: { ...proposalBase, digest: `mopt_${fnv1a32([
      problem.digest,
      perClass
        .map((c) => `${c.classId}>${c.proposed.selectedModelId ?? "none"}:${c.proposed.reasonCode}`)
        .join(";"),
      ladderProposals.map((l) => `${l.modelId}>${l.proposedChainOrder.join(",")}:${l.reasonCode}`).join(";"),
    ])}` },
  };
}

type RequestClassIssue = {
  readonly reasonCode:
    | "CLASS_ID_EMPTY"
    | "REQUIRED_CAPABILITIES_EMPTY"
    | "PRIORITY_OUT_OF_RANGE"
    | "BUDGET_CEILING_NEGATIVE"
    | "NON_INTEGER_AMOUNT"
    | "ESTIMATED_UNITS_NEGATIVE";
  readonly detail: string | null;
};

function validateRequestClass(spec: RequestClassSpec): RequestClassIssue | null {
  if (typeof spec.classId !== "string" || spec.classId.length === 0) {
    return { reasonCode: "CLASS_ID_EMPTY", detail: null };
  }
  if (!Array.isArray(spec.requiredCapabilities) || spec.requiredCapabilities.length === 0) {
    return { reasonCode: "REQUIRED_CAPABILITIES_EMPTY", detail: spec.classId };
  }
  if (!Number.isInteger(spec.priority) || spec.priority < 1 || spec.priority > 5) {
    return { reasonCode: "PRIORITY_OUT_OF_RANGE", detail: String(spec.priority) };
  }
  if (!Number.isInteger(spec.estimatedUnits) || !Number.isInteger(spec.budgetCeilingMinor)) {
    return { reasonCode: "NON_INTEGER_AMOUNT", detail: spec.classId };
  }
  if (spec.budgetCeilingMinor < 0) {
    return { reasonCode: "BUDGET_CEILING_NEGATIVE", detail: spec.classId };
  }
  if (spec.estimatedUnits < 0) {
    return { reasonCode: "ESTIMATED_UNITS_NEGATIVE", detail: spec.classId };
  }
  return null;
}

function buildClassRouting(
  problem: OptimizationProblem,
  input: RoutingOptimizationInput,
  spec: RequestClassSpec,
): RequestClassRouting {
  const decision = selectModel(input.registry, {
    tenantId: problem.tenant.tenantId,
    requiredCapabilities: spec.requiredCapabilities,
    priority: spec.priority,
    budgetCeilingMinor: spec.budgetCeilingMinor,
    estimatedUnits: spec.estimatedUnits,
  });
  const current: RoutingOutcome = decision.ok
    ? { selectedModelId: decision.selectedModelId, estimatedCostMinor: decision.estimatedCostMinor, reasonCode: decision.orderingRule }
    : { selectedModelId: null, estimatedCostMinor: null, reasonCode: decision.reasonCode };

  const matching = input.registry.filter((m) =>
    spec.requiredCapabilities.every((tag) => m.capabilityTags.includes(tag)),
  );
  const downEvents = new Map(input.degradationHistory.map((e) => [e.providerId, e.downEvents]));
  let maxTags = 0;
  let maxCost = 0;
  let maxDown = 0;
  for (const model of matching) {
    maxTags = Math.max(maxTags, model.capabilityTags.length);
    maxCost = Math.max(maxCost, spec.estimatedUnits * model.costPerUnitMinor);
    maxDown = Math.max(maxDown, downEvents.get(model.providerId) ?? 0);
  }
  const weightSum =
    problem.goals.costWeightBps + problem.goals.capabilityFitWeightBps + problem.goals.latencyWeightBps;

  const points: RoutingFrontierPoint[] = matching.map((model) => {
    const estimatedCostMinor = spec.estimatedUnits * model.costPerUnitMinor;
    const latencyBps =
      maxDown === 0 ? 0 : Math.floor(((downEvents.get(model.providerId) ?? 0) * 10000) / maxDown);
    const richnessBps = maxTags === 0 ? 0 : Math.floor((model.capabilityTags.length * 10000) / maxTags);
    const costBps = maxCost === 0 ? 0 : Math.floor((estimatedCostMinor * 10000) / maxCost);
    const scoreBps = Math.floor(
      (richnessBps * problem.goals.capabilityFitWeightBps +
        (10000 - costBps) * problem.goals.costWeightBps +
        (10000 - latencyBps) * problem.goals.latencyWeightBps) /
        weightSum,
    );
    return {
      modelId: model.id,
      providerId: model.providerId,
      capabilityTagCount: model.capabilityTags.length,
      capabilityRichnessBps: richnessBps,
      estimatedCostMinor,
      costBps,
      latencyBps,
      fitsContext: spec.estimatedUnits <= model.maxContextUnits,
      fitsBudget: estimatedCostMinor <= spec.budgetCeilingMinor,
      scoreBps,
    };
  });
  const infeasible = points
    .filter((p) => !p.fitsContext || !p.fitsBudget)
    .map((p) => ({
      modelId: p.modelId,
      reasonCode: !p.fitsContext ? ("MODEL_CONTEXT_EXCEEDED" as const) : ("BUDGET_CEILING_EXCEEDED" as const),
    }))
    .sort((a, b) => cmpString(a.modelId, b.modelId));
  const orderingRule: SelectionOrderingRule =
    spec.priority <= URGENCY_RICHNESS_THRESHOLD ? "urgency-richness-first" : "urgency-cost-first";
  const frontier = points
    .filter((p) => p.fitsContext && p.fitsBudget)
    .sort((a, b) =>
      orderingRule === "urgency-richness-first"
        ? b.capabilityRichnessBps - a.capabilityRichnessBps || a.costBps - b.costBps || b.scoreBps - a.scoreBps || cmpString(a.modelId, b.modelId)
        : a.costBps - b.costBps || b.capabilityRichnessBps - a.capabilityRichnessBps || b.scoreBps - a.scoreBps || cmpString(a.modelId, b.modelId),
    );
  const top = frontier[0] ?? null;
  const proposed: RoutingOutcome = top
    ? { selectedModelId: top.modelId, estimatedCostMinor: top.estimatedCostMinor, reasonCode: "frontier-top-weighted-score" }
    : {
        selectedModelId: null,
        estimatedCostMinor: null,
        // Unreachable in practice (a successful selectModel implies a
        // non-empty frontier), but the fallback stays honest + typed.
        reasonCode: decision.ok ? "NO_FEASIBLE_FRONTIER_POINT" : decision.reasonCode,
      };
  return { classId: spec.classId, orderingRule, current, proposed, frontier, infeasible };
}

function buildLadderProposal(
  input: RoutingOptimizationInput,
  spec: LadderSpec,
  downEvents: ReadonlyMap<string, number>,
): LadderReorderProposal {
  const byId = new Map(input.providers.map((p) => [p.id, p]));
  const healthRank = (id: string): number => {
    const provider = byId.get(id);
    if (!provider) return 3;
    return provider.health === "healthy" ? 0 : provider.health === "degraded" ? 1 : 2;
  };
  const proposedChainOrder = [...spec.currentChainOrder].sort(
    (a, b) =>
      (downEvents.get(a) ?? 0) - (downEvents.get(b) ?? 0) ||
      healthRank(a) - healthRank(b) ||
      cmpString(a, b),
  );
  const currentResolution = resolveFallbackLadder(input.providers, spec.currentChainOrder, spec.modelId);
  const proposedResolution = resolveFallbackLadder(input.providers, proposedChainOrder, spec.modelId);
  const unchanged =
    proposedChainOrder.length === spec.currentChainOrder.length &&
    proposedChainOrder.every((id, i) => id === spec.currentChainOrder[i]);
  const reasonCode = unchanged ? "ladder-already-optimal" : "degradation-history-reorder";
  const digest = `moptlad_${fnv1a32([
    spec.modelId,
    spec.currentChainOrder.join(","),
    proposedChainOrder.join(","),
    reasonCode,
  ])}`;
  return {
    modelId: spec.modelId,
    currentChainOrder: spec.currentChainOrder,
    proposedChainOrder,
    currentSelectedProviderId: currentResolution.selectedProviderId,
    proposedSelectedProviderId: proposedResolution.selectedProviderId,
    currentHops: currentResolution.hops,
    proposedHops: proposedResolution.hops,
    reasonCode,
    digest,
  };
}

function cmpString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
