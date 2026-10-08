/**
 * @fleetos/agent-organizations — F260C routing-optimizer tests: frontier
 * ordering + hand-computed scores, gateway reason-code alignment, ladder
 * reordering via the REAL fallback resolution, determinism, refusals.
 */
import { describe, expect, it } from "vitest";
import type { ModelDescriptor, ProviderRecord } from "@fleetos/model-gateway";
import { optimizeRouting, type ProviderDegradationEvent, type RequestClassSpec } from "../src/index.js";
import { buildProblem } from "./optimize-fixtures.js";

const REGISTRY: readonly ModelDescriptor[] = [
  { id: "model-alpha", providerId: "p1", capabilityTags: ["reasoning", "summarize"], costPerUnitMinor: 100, maxContextUnits: 100000 },
  { id: "model-beta", providerId: "p2", capabilityTags: ["reasoning"], costPerUnitMinor: 30, maxContextUnits: 50000 },
  { id: "model-gamma", providerId: "p3", capabilityTags: ["reasoning", "summarize", "code"], costPerUnitMinor: 250, maxContextUnits: 200000 },
  { id: "model-tiny", providerId: "p1", capabilityTags: ["reasoning", "summarize"], costPerUnitMinor: 5, maxContextUnits: 100 },
];

const PROVIDERS: readonly ProviderRecord[] = [
  { id: "p1", declaredModels: ["model-alpha", "model-tiny"], health: "healthy" },
  { id: "p2", declaredModels: ["model-beta"], health: "healthy" },
  { id: "p3", declaredModels: ["model-gamma"], health: "degraded" },
];

const HISTORY: readonly ProviderDegradationEvent[] = [
  { providerId: "p1", downEvents: 2 },
  { providerId: "p2", downEvents: 0 },
  { providerId: "p3", downEvents: 1 },
];

function runOptimize(
  classes: readonly RequestClassSpec[],
  ladders: readonly { modelId: string; currentChainOrder: readonly string[] }[] = [],
  overrides: { registry?: readonly ModelDescriptor[]; history?: readonly ProviderDegradationEvent[] } = {},
) {
  return optimizeRouting(buildProblem(), {
    registry: overrides.registry ?? REGISTRY,
    providers: PROVIDERS,
    degradationHistory: overrides.history ?? HISTORY,
    requestClasses: classes,
    ladders,
  });
}

describe("routing frontier — per request class", () => {
  it("builds the frontier with hand-computed bps and gateway-aligned reason codes", () => {
    const result = runOptimize([
      { classId: "class-a", requiredCapabilities: ["reasoning", "summarize"], estimatedUnits: 1000, priority: 1, budgetCeilingMinor: 150000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const routing = result.proposal.perClass[0];
    if (!routing) throw new Error("missing routing");
    expect(routing.orderingRule).toBe("urgency-richness-first");
    // The CURRENT outcome is the REAL gateway selection.
    expect(routing.current).toEqual({
      selectedModelId: "model-alpha",
      estimatedCostMinor: 100000,
      reasonCode: "urgency-richness-first",
    });
    // Infeasible candidates carry gateway refusal codes.
    expect(routing.infeasible).toEqual([
      { modelId: "model-gamma", reasonCode: "BUDGET_CEILING_EXCEEDED" },
      { modelId: "model-tiny", reasonCode: "MODEL_CONTEXT_EXCEEDED" },
    ]);
    // Frontier: only model-alpha is feasible. Hand-computed bps:
    // richness 2/3 → 6666; cost 100000/250000 → 4000; latency p1 2/2 → 10000;
    // score floor((6666*6000 + 6000*3000 + 0*1000) / 10000) = 5799.
    expect(routing.frontier).toEqual([
      {
        modelId: "model-alpha",
        providerId: "p1",
        capabilityTagCount: 2,
        capabilityRichnessBps: 6666,
        estimatedCostMinor: 100000,
        costBps: 4000,
        latencyBps: 10000,
        fitsContext: true,
        fitsBudget: true,
        scoreBps: 5799,
      },
    ]);
    expect(routing.proposed).toEqual({
      selectedModelId: "model-alpha",
      estimatedCostMinor: 100000,
      reasonCode: "frontier-top-weighted-score",
    });
  });

  it("orders the frontier by capability-richness for high urgency and by cost for low urgency", () => {
    const rich = runOptimize([
      { classId: "class-hi", requiredCapabilities: ["reasoning", "summarize"], estimatedUnits: 1000, priority: 1, budgetCeilingMinor: 300000 },
    ]);
    const cheap = runOptimize([
      { classId: "class-lo", requiredCapabilities: ["reasoning", "summarize"], estimatedUnits: 1000, priority: 4, budgetCeilingMinor: 300000 },
    ]);
    expect(rich.ok && cheap.ok).toBe(true);
    if (!rich.ok || !cheap.ok) return;
    const hi = rich.proposal.perClass[0];
    const lo = cheap.proposal.perClass[0];
    if (!hi || !lo) throw new Error("missing routing");
    expect(hi.orderingRule).toBe("urgency-richness-first");
    expect(lo.orderingRule).toBe("urgency-cost-first");
    expect(hi.frontier.map((p) => p.modelId)).toEqual(["model-gamma", "model-alpha"]);
    expect(lo.frontier.map((p) => p.modelId)).toEqual(["model-alpha", "model-gamma"]);
    // The REAL gateway selection agrees with the frontier top in both modes.
    expect(hi.current.selectedModelId).toBe("model-gamma");
    expect(hi.proposed.selectedModelId).toBe("model-gamma");
    expect(lo.current.selectedModelId).toBe("model-alpha");
    expect(lo.proposed.selectedModelId).toBe("model-alpha");
  });

  it("the latency-weighted score breaks full ties the gateway cannot see", () => {
    // Two models with identical richness and cost on different providers:
    // the gateway breaks the tie by model id; the optimizer's weighted
    // score prefers the provider with the cleaner degradation history.
    const registry: readonly ModelDescriptor[] = [
      { id: "m-x", providerId: "pA", capabilityTags: ["reasoning", "summarize"], costPerUnitMinor: 100, maxContextUnits: 100000 },
      { id: "m-y", providerId: "pB", capabilityTags: ["reasoning", "summarize"], costPerUnitMinor: 100, maxContextUnits: 100000 },
    ];
    const history: readonly ProviderDegradationEvent[] = [
      { providerId: "pA", downEvents: 3 },
      { providerId: "pB", downEvents: 0 },
    ];
    const result = runOptimize(
      [{ classId: "class-tie", requiredCapabilities: ["reasoning", "summarize"], estimatedUnits: 1000, priority: 3, budgetCeilingMinor: 500000 }],
      [],
      { registry, history },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const routing = result.proposal.perClass[0];
    if (!routing) throw new Error("missing routing");
    expect(routing.current.selectedModelId).toBe("m-x"); // gateway id tie-break.
    expect(routing.proposed.selectedModelId).toBe("m-y"); // latency-aware score.
    expect(routing.frontier.map((p) => p.modelId)).toEqual(["m-y", "m-x"]);
    expect(routing.frontier[0]?.scoreBps).toBeGreaterThan(routing.frontier[1]?.scoreBps ?? 0);
  });

  it("reports the gateway's own refusal code when no model can serve the class", () => {
    const result = runOptimize([
      { classId: "class-none", requiredCapabilities: ["quantum"], estimatedUnits: 10, priority: 2, budgetCeilingMinor: 10000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const routing = result.proposal.perClass[0];
    if (!routing) throw new Error("missing routing");
    expect(routing.current.reasonCode).toBe("NO_MODEL_WITH_CAPABILITIES");
    expect(routing.proposed).toEqual({
      selectedModelId: null,
      estimatedCostMinor: null,
      reasonCode: "NO_MODEL_WITH_CAPABILITIES",
    });
    expect(routing.frontier).toEqual([]);
  });
});

describe("routing optimizer — fallback ladder reordering", () => {
  it("reorders the ladder by degradation history and projects hops via the REAL resolution", () => {
    const result = runOptimize([], [
      { modelId: "model-beta", currentChainOrder: ["p3", "p2", "p1"] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ladder = result.proposal.ladderProposals[0];
    if (!ladder) throw new Error("missing ladder");
    expect(ladder.reasonCode).toBe("degradation-history-reorder");
    // downEvents: p2=0, p3=1, p1=2 → [p2, p3, p1].
    expect(ladder.proposedChainOrder).toEqual(["p2", "p3", "p1"]);
    // Current resolution: p3 lacks model-beta → PROVIDER_MISSING_MODEL at hop 1.
    expect(ladder.currentHops).toEqual([
      { rank: 1, providerId: "p3", health: "degraded", reasonCode: "PROVIDER_MISSING_MODEL" },
      { rank: 2, providerId: "p2", health: "healthy", reasonCode: "SELECTED" },
      { rank: 3, providerId: "p1", health: "healthy", reasonCode: "NOT_ATTEMPTED" },
    ]);
    expect(ladder.currentSelectedProviderId).toBe("p2");
    expect(ladder.proposedSelectedProviderId).toBe("p2");
    expect(ladder.proposedHops[0]).toEqual({ rank: 1, providerId: "p2", health: "healthy", reasonCode: "SELECTED" });
    expect(ladder.digest).toMatch(/^moptlad_[0-9a-f]{8}$/);
  });

  it("reports ladder-already-optimal when the current order equals the proposed one", () => {
    const result = runOptimize(
      [],
      [{ modelId: "model-alpha", currentChainOrder: ["p1", "p2", "p3"] }],
      { history: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ladder = result.proposal.ladderProposals[0];
    if (!ladder) throw new Error("missing ladder");
    expect(ladder.reasonCode).toBe("ladder-already-optimal");
    expect(ladder.proposedChainOrder).toEqual(["p1", "p2", "p3"]);
    expect(ladder.currentSelectedProviderId).toBe("p1");
  });
});

describe("routing optimizer — validation refusals (gateway vocabulary)", () => {
  it("refuses invalid registries and provider records", () => {
    const invalidRegistry = runOptimize([], [], {
      registry: [...REGISTRY, REGISTRY[0] as ModelDescriptor],
    });
    expect(invalidRegistry).toMatchObject({ ok: false, reasonCode: "REGISTRY_INVALID" });
    const invalidProviders = optimizeRouting(buildProblem(), {
      registry: REGISTRY,
      providers: [...PROVIDERS, PROVIDERS[0] as ProviderRecord],
      degradationHistory: HISTORY,
      requestClasses: [],
      ladders: [],
    });
    expect(invalidProviders).toMatchObject({ ok: false, reasonCode: "PROVIDERS_INVALID" });
  });

  it("refuses malformed request classes with the gateway codes", () => {
    expect(runOptimize([{ classId: "", requiredCapabilities: ["reasoning"], estimatedUnits: 1, priority: 1, budgetCeilingMinor: 1 }])).toMatchObject({ ok: false, reasonCode: "CLASS_ID_EMPTY" });
    expect(runOptimize([{ classId: "c", requiredCapabilities: [], estimatedUnits: 1, priority: 1, budgetCeilingMinor: 1 }])).toMatchObject({ ok: false, reasonCode: "REQUIRED_CAPABILITIES_EMPTY" });
    expect(runOptimize([{ classId: "c", requiredCapabilities: ["reasoning"], estimatedUnits: 1, priority: 9, budgetCeilingMinor: 1 }])).toMatchObject({ ok: false, reasonCode: "PRIORITY_OUT_OF_RANGE" });
    expect(runOptimize([{ classId: "c", requiredCapabilities: ["reasoning"], estimatedUnits: 1, priority: 1, budgetCeilingMinor: -1 }])).toMatchObject({ ok: false, reasonCode: "BUDGET_CEILING_NEGATIVE" });
    expect(runOptimize([{ classId: "c", requiredCapabilities: ["reasoning"], estimatedUnits: -5, priority: 1, budgetCeilingMinor: 1 }])).toMatchObject({ ok: false, reasonCode: "ESTIMATED_UNITS_NEGATIVE" });
    expect(runOptimize([{ classId: "c", requiredCapabilities: ["reasoning"], estimatedUnits: 1.5, priority: 1, budgetCeilingMinor: 1 }])).toMatchObject({ ok: false, reasonCode: "NON_INTEGER_AMOUNT" });
  });

  it("refuses malformed degradation history and ladders", () => {
    expect(runOptimize([], [], { history: [{ providerId: "p1", downEvents: -1 }] })).toMatchObject({
      ok: false,
      reasonCode: "DEGRADATION_HISTORY_INVALID",
    });
    expect(runOptimize([], [{ modelId: "model-beta", currentChainOrder: [] }])).toMatchObject({
      ok: false,
      reasonCode: "LADDER_EMPTY",
    });
    expect(runOptimize([], [{ modelId: "", currentChainOrder: ["p1"] }])).toMatchObject({
      ok: false,
      reasonCode: "MODEL_ID_EMPTY",
    });
  });

  it("refuses a tampered problem (digest mismatch)", () => {
    const problem = buildProblem();
    const tampered = { ...problem, goals: { ...problem.goals, latencyWeightBps: 4000 } };
    expect(optimizeRouting(tampered, {
      registry: REGISTRY,
      providers: PROVIDERS,
      degradationHistory: HISTORY,
      requestClasses: [],
      ladders: [],
    })).toMatchObject({ ok: false, reasonCode: "PROBLEM_DIGEST_MISMATCH" });
  });
});

describe("routing optimizer — determinism + proposal vocabulary", () => {
  it("is deterministic — identical inputs → byte-identical proposals", () => {
    const classes: RequestClassSpec[] = [
      { classId: "class-a", requiredCapabilities: ["reasoning", "summarize"], estimatedUnits: 1000, priority: 2, budgetCeilingMinor: 300000 },
    ];
    const ladders = [{ modelId: "model-beta", currentChainOrder: ["p3", "p2", "p1"] }];
    expect(JSON.stringify(runOptimize(classes, ladders))).toBe(JSON.stringify(runOptimize(classes, ladders)));
  });

  it("emits the proposal vocabulary (kind + note + digest)", () => {
    const result = runOptimize([
      { classId: "class-a", requiredCapabilities: ["reasoning"], estimatedUnits: 10, priority: 3, budgetCeilingMinor: 10000 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.kind).toBe("routing-optimization-proposal");
    expect(result.proposal.note).toBe("proposal-only-guardian-path");
    expect(result.proposal.digest).toMatch(/^mopt_[0-9a-f]{8}$/);
  });
});
