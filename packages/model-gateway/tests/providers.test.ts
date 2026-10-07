/**
 * @fleetos/model-gateway — F230C provider fallback + degraded-mode tests.
 */
import { describe, expect, it } from "vitest";
import {
  classifyDegradedMode,
  resolveFallbackLadder,
  validateProviderRecords,
  type ProviderRecord,
} from "../src/index.js";

function provider(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: "prov-a",
    declaredModels: ["model-x"],
    health: "healthy",
    ...overrides,
  };
}

const PROVIDERS: readonly ProviderRecord[] = [
  provider({ id: "primary", declaredModels: ["model-x", "model-y"] }),
  provider({ id: "secondary", declaredModels: ["model-x"] }),
  provider({ id: "tertiary", declaredModels: ["model-z"] }),
];

// ---------------------------------------------------------------------------
// Provider record validation.
// ---------------------------------------------------------------------------

describe("validateProviderRecords", () => {
  it("accepts well-formed provider records", () => {
    expect(validateProviderRecords(PROVIDERS).ok).toBe(true);
  });

  it("refuses empty/duplicate provider ids", () => {
    expect(validateProviderRecords([provider({ id: "" })])).toMatchObject({ ok: false, reasonCode: "PROVIDER_ID_EMPTY" });
    expect(validateProviderRecords([provider(), provider()])).toMatchObject({ ok: false, reasonCode: "PROVIDER_ID_DUPLICATED" });
  });

  it("refuses empty / duplicate / blank declared models", () => {
    expect(validateProviderRecords([provider({ declaredModels: [] })])).toMatchObject({ ok: false, reasonCode: "DECLARED_MODELS_EMPTY" });
    expect(validateProviderRecords([provider({ declaredModels: ["m", "m"] })])).toMatchObject({ ok: false, reasonCode: "DECLARED_MODEL_DUPLICATED" });
    expect(validateProviderRecords([provider({ declaredModels: [""] })])).toMatchObject({ ok: false, reasonCode: "DECLARED_MODEL_EMPTY" });
  });
});

// ---------------------------------------------------------------------------
// Fallback ladder resolution.
// ---------------------------------------------------------------------------

describe("resolveFallbackLadder", () => {
  it("selects the healthy primary and marks the rest NOT_ATTEMPTED", () => {
    const result = resolveFallbackLadder(PROVIDERS, ["primary", "secondary", "tertiary"], "model-x");
    expect(result.ok).toBe(true);
    expect(result.selectedProviderId).toBe("primary");
    expect(result.hops.map((h) => h.reasonCode)).toEqual(["SELECTED", "NOT_ATTEMPTED", "NOT_ATTEMPTED"]);
  });

  it("falls back to the secondary when the primary is down, recording PROVIDER_DOWN at hop 1", () => {
    const providers = [
      provider({ id: "primary", health: "down" }),
      provider({ id: "secondary" }),
    ];
    const result = resolveFallbackLadder(providers, ["primary", "secondary"], "model-x");
    expect(result.ok).toBe(true);
    expect(result.selectedProviderId).toBe("secondary");
    expect(result.hops.map((h) => h.reasonCode)).toEqual(["PROVIDER_DOWN", "SELECTED"]);
  });

  it("records PROVIDER_MISSING_MODEL when a healthy provider does not declare the model", () => {
    const result = resolveFallbackLadder(PROVIDERS, ["tertiary", "primary"], "model-x");
    expect(result.ok).toBe(true);
    expect(result.selectedProviderId).toBe("primary");
    expect(result.hops.map((h) => h.reasonCode)).toEqual(["PROVIDER_MISSING_MODEL", "SELECTED"]);
  });

  it("records UNKNOWN_PROVIDER for chain entries with no provider record", () => {
    const result = resolveFallbackLadder(PROVIDERS, ["ghost", "primary"], "model-x");
    expect(result.ok).toBe(true);
    expect(result.hops.map((h) => h.reasonCode)).toEqual(["UNKNOWN_PROVIDER", "SELECTED"]);
  });

  it("refuses with NO_PROVIDER_CAN_SERVE when no hop can serve (each hop carries its reason)", () => {
    const providers = [
      provider({ id: "p1", health: "down" }),
      provider({ id: "p2", declaredModels: ["other-model"] }),
    ];
    const result = resolveFallbackLadder(providers, ["p1", "p2"], "model-x");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("NO_PROVIDER_CAN_SERVE");
      expect(result.hops.map((h) => h.reasonCode)).toEqual(["PROVIDER_DOWN", "PROVIDER_MISSING_MODEL"]);
    }
  });

  it("refuses an empty ladder with LADDER_EMPTY", () => {
    const result = resolveFallbackLadder(PROVIDERS, [], "model-x");
    expect(result).toMatchObject({ ok: false, reasonCode: "LADDER_EMPTY", hops: [] });
  });

  it("a degraded (not down) provider still serves — only DOWN is skipped", () => {
    const providers = [provider({ id: "p1", health: "degraded" })];
    const result = resolveFallbackLadder(providers, ["p1"], "model-x");
    expect(result.ok).toBe(true);
    expect(result.selectedProviderId).toBe("p1");
  });

  it("is deterministic: identical inputs → identical ladder and digest", () => {
    const a = resolveFallbackLadder(PROVIDERS, ["primary", "secondary"], "model-x");
    const b = resolveFallbackLadder(PROVIDERS, ["primary", "secondary"], "model-x");
    expect(a).toEqual(b);
    expect(a.digest).toMatch(/^mladder_[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// Degraded-mode classification.
// ---------------------------------------------------------------------------

describe("classifyDegradedMode", () => {
  it("all healthy → full", () => {
    const result = classifyDegradedMode(PROVIDERS);
    expect(result.mode).toBe("full");
    expect(result.healthyProviders).toBe(3);
    expect(result.servingProviders).toBe(3);
  });

  it("some healthy + some not → partial with exact counts", () => {
    const result = classifyDegradedMode([
      provider({ id: "a" }),
      provider({ id: "b", health: "down" }),
      provider({ id: "c", health: "degraded" }),
    ]);
    expect(result.mode).toBe("partial");
    expect(result).toMatchObject({ healthyProviders: 1, degradedProviders: 1, downProviders: 1, servingProviders: 2 });
  });

  it("no healthy but a degraded one → emergency-only, serving through degraded", () => {
    const result = classifyDegradedMode([provider({ id: "a", health: "degraded" }), provider({ id: "b", health: "down" })]);
    expect(result.mode).toBe("emergency-only");
    expect(result.servingProviders).toBe(1);
  });

  it("everything down → emergency-only with servingProviders 0 (honest, never 'full')", () => {
    const result = classifyDegradedMode([provider({ id: "a", health: "down" })]);
    expect(result.mode).toBe("emergency-only");
    expect(result.servingProviders).toBe(0);
  });

  it("empty provider set → emergency-only with 0 serving", () => {
    const result = classifyDegradedMode([]);
    expect(result).toMatchObject({ mode: "emergency-only", servingProviders: 0 });
  });

  it("is deterministic and digest-stamped regardless of input order", () => {
    const a = classifyDegradedMode(PROVIDERS);
    const b = classifyDegradedMode([...PROVIDERS].reverse());
    expect(a).toEqual(b);
    expect(a.digest).toMatch(/^mdegrade_[0-9a-f]{8}$/);
  });
});
