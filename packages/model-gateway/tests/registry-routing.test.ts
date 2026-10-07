/**
 * @fleetos/model-gateway — F230C model registry + routing tests.
 */
import { describe, expect, it } from "vitest";
import {
  findModelsByCapabilities,
  selectModel,
  validateModelRegistry,
  type ModelDescriptor,
  type ModelSelectionRequest,
} from "../src/index.js";

function model(overrides: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return {
    id: "model-x",
    providerId: "prov-a",
    capabilityTags: ["chat"],
    costPerUnitMinor: 1,
    maxContextUnits: 100000,
    ...overrides,
  };
}

const REGISTRY: readonly ModelDescriptor[] = [
  model({ id: "cheap-thin", providerId: "prov-a", capabilityTags: ["chat"], costPerUnitMinor: 1 }),
  model({
    id: "rich-costly",
    providerId: "prov-b",
    capabilityTags: ["chat", "vision", "tools"],
    costPerUnitMinor: 4,
  }),
  model({
    id: "rich-cheap",
    providerId: "prov-b",
    capabilityTags: ["chat", "vision", "tools"],
    costPerUnitMinor: 2,
  }),
  model({ id: "tiny-ctx", providerId: "prov-a", capabilityTags: ["chat"], costPerUnitMinor: 1, maxContextUnits: 10 }),
];

function request(overrides: Partial<ModelSelectionRequest> = {}): ModelSelectionRequest {
  return {
    tenantId: "acme",
    requiredCapabilities: ["chat"],
    priority: 3,
    budgetCeilingMinor: 100000,
    estimatedUnits: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Registry.
// ---------------------------------------------------------------------------

describe("validateModelRegistry", () => {
  it("accepts a well-formed registry", () => {
    expect(validateModelRegistry(REGISTRY).ok).toBe(true);
  });

  it("refuses an empty registry with REGISTRY_EMPTY", () => {
    expect(validateModelRegistry([])).toMatchObject({ ok: false, reasonCode: "REGISTRY_EMPTY" });
  });

  it("refuses duplicate model ids with MODEL_ID_DUPLICATED and the id", () => {
    const dup = [model(), model()];
    expect(validateModelRegistry(dup)).toMatchObject({ ok: false, reasonCode: "MODEL_ID_DUPLICATED", modelId: "model-x" });
  });

  it("refuses empty capability tags with CAPABILITY_TAGS_EMPTY", () => {
    expect(validateModelRegistry([model({ capabilityTags: [] })])).toMatchObject({ ok: false, reasonCode: "CAPABILITY_TAGS_EMPTY" });
  });

  it("refuses negative / non-integer cost in minor units", () => {
    expect(validateModelRegistry([model({ costPerUnitMinor: -1 })])).toMatchObject({ ok: false, reasonCode: "NEGATIVE_COST" });
    expect(validateModelRegistry([model({ costPerUnitMinor: 0.5 })])).toMatchObject({ ok: false, reasonCode: "NON_INTEGER_COST" });
  });

  it("refuses negative / non-integer context limits", () => {
    expect(validateModelRegistry([model({ maxContextUnits: -1 })])).toMatchObject({ ok: false, reasonCode: "NEGATIVE_CONTEXT" });
    expect(validateModelRegistry([model({ maxContextUnits: 1.5 })])).toMatchObject({ ok: false, reasonCode: "NON_INTEGER_CONTEXT" });
  });
});

describe("findModelsByCapabilities", () => {
  it("returns models carrying ALL required tags, sorted lexically (deterministic)", () => {
    const found = findModelsByCapabilities(REGISTRY, ["chat", "vision"]);
    expect(found.map((m) => m.id)).toEqual(["rich-cheap", "rich-costly"]);
  });

  it("input array order never leaks into the result order", () => {
    const a = findModelsByCapabilities(REGISTRY, ["chat"]);
    const b = findModelsByCapabilities([...REGISTRY].reverse(), ["chat"]);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });
});

// ---------------------------------------------------------------------------
// Routing — happy paths + ordering rules.
// ---------------------------------------------------------------------------

describe("selectModel — deterministic selection", () => {
  it("low urgency prefers the cheapest capable model (urgency-cost-first)", () => {
    const decision = selectModel(REGISTRY, request({ priority: 4 }));
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.selectedModelId).toBe("cheap-thin");
      expect(decision.orderingRule).toBe("urgency-cost-first");
      expect(decision.estimatedCostMinor).toBe(1000);
    }
  });

  it("high urgency prefers the capability-richest model (urgency-richness-first)", () => {
    const decision = selectModel(REGISTRY, request({ priority: 1 }));
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      // rich-cheap vs rich-costly tie on richness (3 tags) → cheaper wins.
      expect(decision.selectedModelId).toBe("rich-cheap");
      expect(decision.orderingRule).toBe("urgency-richness-first");
    }
  });

  it("exact ties break lexically by model id and the rule is recorded", () => {
    const twins = [
      model({ id: "model-b", providerId: "prov-b", capabilityTags: ["chat"], costPerUnitMinor: 2 }),
      model({ id: "model-a", providerId: "prov-a", capabilityTags: ["chat"], costPerUnitMinor: 2 }),
    ];
    const decision = selectModel(twins, request({ priority: 5 }));
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.selectedModelId).toBe("model-a");
      expect(decision.tieBreakRule).toBe("model-id-lexical");
    }
  });

  it("ranks all budget-fitting candidates with ranks, costs and tag counts", () => {
    const decision = selectModel(REGISTRY, request({ priority: 5 }));
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.rankedCandidates.map((c) => c.modelId)).toEqual([
        "cheap-thin",
        "rich-cheap",
        "rich-costly",
      ]);
      expect(decision.rankedCandidates[0]).toMatchObject({ rank: 1, estimatedCostMinor: 1000, capabilityTagCount: 1 });
    }
  });

  it("identical inputs → byte-identical decision (digest included)", () => {
    const a = selectModel(REGISTRY, request());
    const b = selectModel(REGISTRY, request());
    expect(a).toEqual(b);
  });

  it("the decision digest is mroute_-prefixed and result-sensitive", () => {
    const okDecision = selectModel(REGISTRY, request());
    const refused = selectModel(REGISTRY, request({ requiredCapabilities: ["nonsense"] }));
    if (okDecision.ok && !refused.ok) {
      expect(okDecision.digest).toMatch(/^mroute_[0-9a-f]{8}$/);
      expect(refused.digest).toMatch(/^mroute_[0-9a-f]{8}$/);
      expect(okDecision.digest).not.toBe(refused.digest);
    } else {
      throw new Error("expected ok then refused");
    }
  });
});

// ---------------------------------------------------------------------------
// Routing — typed refusals.
// ---------------------------------------------------------------------------

describe("selectModel — refusals", () => {
  it("refuses unknown capability with NO_MODEL_WITH_CAPABILITIES and the uncovered tags", () => {
    const decision = selectModel(REGISTRY, request({ requiredCapabilities: ["chat", "sonar"] }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reasonCode).toBe("NO_MODEL_WITH_CAPABILITIES");
      expect(decision.missingCapabilities).toEqual(["sonar"]);
    }
  });

  it("refuses when every capability match fails the context filter with the smallest shortfall", () => {
    const decision = selectModel(
      [model({ id: "tiny", capabilityTags: ["chat"], maxContextUnits: 10 })],
      request({ estimatedUnits: 1000 }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reasonCode).toBe("MODEL_CONTEXT_EXCEEDED");
      expect(decision.contextShortfallUnits).toBe(990);
    }
  });

  it("refuses when every context-fitting model exceeds the budget, carrying the cheapest + overshoot", () => {
    const decision = selectModel(
      [model({ id: "m", capabilityTags: ["chat"], costPerUnitMinor: 10 })],
      request({ estimatedUnits: 1000, budgetCeilingMinor: 5000 }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reasonCode).toBe("BUDGET_CEILING_EXCEEDED");
      expect(decision.cheapestCostMinor).toBe(10000);
      expect(decision.budgetOvershootMinor).toBe(5000);
    }
  });

  it("refuses malformed requests with typed precheck codes", () => {
    expect(selectModel(REGISTRY, request({ tenantId: "" }))).toMatchObject({ ok: false, reasonCode: "TENANT_ID_EMPTY" });
    expect(selectModel(REGISTRY, request({ requiredCapabilities: [] }))).toMatchObject({ ok: false, reasonCode: "REQUIRED_CAPABILITIES_EMPTY" });
    expect(selectModel(REGISTRY, request({ priority: 0 }))).toMatchObject({ ok: false, reasonCode: "PRIORITY_OUT_OF_RANGE" });
    expect(selectModel(REGISTRY, request({ priority: 6 }))).toMatchObject({ ok: false, reasonCode: "PRIORITY_OUT_OF_RANGE" });
    expect(selectModel(REGISTRY, request({ budgetCeilingMinor: -1 }))).toMatchObject({ ok: false, reasonCode: "BUDGET_CEILING_NEGATIVE" });
    expect(selectModel(REGISTRY, request({ estimatedUnits: -1 }))).toMatchObject({ ok: false, reasonCode: "ESTIMATED_UNITS_NEGATIVE" });
    expect(selectModel(REGISTRY, request({ budgetCeilingMinor: 1.5 }))).toMatchObject({ ok: false, reasonCode: "NON_INTEGER_AMOUNT" });
  });

  it("refuses an invalid registry with REGISTRY_INVALID and the registry's code as detail", () => {
    const decision = selectModel([model({ id: "" })], request());
    expect(decision).toMatchObject({ ok: false, reasonCode: "REGISTRY_INVALID", detail: "MODEL_ID_EMPTY" });
  });

  it("a context-filter refusal is honest about the candidates it considered", () => {
    const decision = selectModel(REGISTRY, request({ estimatedUnits: 200000 }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      // tiny-ctx and the big models were capability matches (4).
      expect(decision.candidatesConsidered).toBe(4);
    }
  });
});
