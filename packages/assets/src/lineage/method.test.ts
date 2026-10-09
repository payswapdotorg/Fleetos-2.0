/**
 * @fleetos/assets — Wave 9 lineage versioned-method tests (F290A).
 *
 * Covers:
 *   - register: happy path, malformed id/version, duplicate, schema validation.
 *   - deprecate: marks deprecated; stays readable (lookup returns def); refuses
 *     re-deprecate + stale timestamp.
 *   - applyMethodToAsset: REAL asset binding via port, parameter validation
 *     (missing/invalid-type/invalid-enum/unknown-param), deprecated refusal,
 *     unknown-method, unknown-asset, asset-tenant-mismatch, missing-tenant-id,
 *     malformed-application-id, invalid-applied-at.
 *   - digest: byte-identical re-runs; changes with parameter content.
 *
 * Honest refusals actually hit (every refusal code has a test that triggers it).
 */

import { describe, it, expect } from "vitest";
import {
  registerMethod,
  deprecateMethod,
  lookupMethod,
  applyMethodToAsset,
  methodApplicationDigest,
  emptyMethodRegistry,
  type MethodRegistry,
  type AssetLookupPort,
  type MethodDefinition,
  type MethodParameterSchema,
  type MethodApplicationResult,
} from "./method.js";
import type { AssetId, TenantIdLike } from "../assets.js";

const NOW = 1_774_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const ASSET_1 = "ast_truck-0001" as AssetId;
const ASSET_2 = "ast_truck-0002" as AssetId;

function fakeAssetLookup(
  assets: ReadonlyArray<{ readonly id: AssetId; readonly tenantId: TenantIdLike }>,
): AssetLookupPort {
  return {
    findAsset: (tenantId, assetId) => {
      const hit = assets.find((a) => a.id === assetId && a.tenantId === tenantId);
      return hit ?? null;
    },
  };
}

function oilChangeSchema(): ReadonlyArray<MethodParameterSchema> {
  return [
    { name: "oilGrade", type: "enum", required: true, enumValues: ["5W-30", "10W-40", "0W-20"] },
    { name: "volumeLitres", type: "number", required: true },
    { name: "notes", type: "text", required: false, defaultValue: "" },
  ];
}

function registerOilChange(): MethodRegistry {
  const r = registerMethod(emptyMethodRegistry(), {
    methodId: "mth_oil-change",
    version: "1.0.0",
    kind: "maintenance",
    displayName: "Oil Change",
    parameterSchema: oilChangeSchema(),
    createdAt: NOW,
    description: "Standard oil change procedure",
  });
  if (!r.ok) throw new Error(`registerMethod failed: ${r.reason}`);
  return r.registry;
}

describe("method: registerMethod", () => {
  it("registers an active method with the documented fields", () => {
    const reg = registerOilChange();
    const def = lookupMethod(reg, "mth_oil-change" as MethodDefinition["methodId"], "1.0.0");
    expect(def).not.toBeNull();
    expect(def?.status).toBe("active");
    expect(def?.deprecatedAt).toBeNull();
    expect(def?.kind).toBe("maintenance");
    expect(def?.parameterSchema).toHaveLength(3);
  });

  it("rejects malformed method id (malformed-method-id)", () => {
    const r = registerMethod(emptyMethodRegistry(), {
      methodId: "bad id!",
      version: "1.0.0",
      kind: "maintenance",
      displayName: "X",
      parameterSchema: [],
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-method-id");
  });

  it("rejects invalid version (invalid-version)", () => {
    const r = registerMethod(emptyMethodRegistry(), {
      methodId: "mth_x-001",
      version: "1.0",
      kind: "maintenance",
      displayName: "X",
      parameterSchema: [],
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-version");
  });

  it("rejects unknown kind (unknown-kind)", () => {
    const r = registerMethod(emptyMethodRegistry(), {
      methodId: "mth_x-002",
      version: "1.0.0",
      kind: "magic" as never,
      displayName: "X",
      parameterSchema: [],
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-kind");
  });

  it("rejects missing display name (missing-display-name)", () => {
    const r = registerMethod(emptyMethodRegistry(), {
      methodId: "mth_x-003",
      version: "1.0.0",
      kind: "maintenance",
      displayName: "",
      parameterSchema: [],
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-display-name");
  });

  it("rejects malformed parameter schema (malformed-parameter-schema)", () => {
    // Duplicate parameter name.
    const badSchema: ReadonlyArray<MethodParameterSchema> = [
      { name: "p", type: "string", required: true },
      { name: "p", type: "string", required: false },
    ];
    const r = registerMethod(emptyMethodRegistry(), {
      methodId: "mth_x-004",
      version: "1.0.0",
      kind: "maintenance",
      displayName: "X",
      parameterSchema: badSchema,
      createdAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-parameter-schema");
  });

  it("rejects duplicate (methodId, version) (duplicate-method-version)", () => {
    const reg = registerOilChange();
    const r = registerMethod(reg, {
      methodId: "mth_oil-change",
      version: "1.0.0",
      kind: "maintenance",
      displayName: "Oil Change Again",
      parameterSchema: [],
      createdAt: NOW + 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate-method-version");
  });

  it("allows a new version of the same method id (registry grows)", () => {
    const reg = registerOilChange();
    const r = registerMethod(reg, {
      methodId: "mth_oil-change",
      version: "1.1.0",
      kind: "maintenance",
      displayName: "Oil Change v1.1",
      parameterSchema: oilChangeSchema(),
      createdAt: NOW + 5000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(lookupMethod(r.registry, "mth_oil-change" as MethodDefinition["methodId"], "1.0.0")).not.toBeNull();
      expect(lookupMethod(r.registry, "mth_oil-change" as MethodDefinition["methodId"], "1.1.0")).not.toBeNull();
    }
  });
});

describe("method: deprecateMethod — append-only history", () => {
  it("marks deprecated and stays readable via lookupMethod", () => {
    const reg = registerOilChange();
    const r = deprecateMethod(reg, {
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      version: "1.0.0",
      deprecatedAt: NOW + 10_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.method.status).toBe("deprecated");
      expect(r.method.deprecatedAt).toBe(NOW + 10_000);
      const lookup = lookupMethod(r.registry, "mth_oil-change" as MethodDefinition["methodId"], "1.0.0");
      expect(lookup).not.toBeNull();
      expect(lookup?.status).toBe("deprecated");
    }
  });

  it("refuses to re-deprecate an already-deprecated method (already-deprecated)", () => {
    const reg = registerOilChange();
    const r1 = deprecateMethod(reg, {
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      version: "1.0.0",
      deprecatedAt: NOW + 10_000,
    });
    if (!r1.ok) throw new Error("setup deprecate failed");
    const r2 = deprecateMethod(r1.registry, {
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      version: "1.0.0",
      deprecatedAt: NOW + 20_000,
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("already-deprecated");
  });

  it("refuses deprecation of unknown method (unknown-method)", () => {
    const reg = registerOilChange();
    const r = deprecateMethod(reg, {
      methodId: "mth_missing-001" as MethodDefinition["methodId"],
      version: "1.0.0",
      deprecatedAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-method");
  });

  it("refuses stale deprecatedAt (stale-deprecated-at)", () => {
    const reg = registerOilChange();
    const r = deprecateMethod(reg, {
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      version: "1.0.0",
      deprecatedAt: NOW - 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("stale-deprecated-at");
  });
});

describe("method: applyMethodToAsset — REAL asset binding + parameter validation", () => {
  it("applies a method to a REAL asset, returns application with audit + digest", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0001",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5, notes: "first change" },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const app = r.application;
      expect(app.id).toBe("app_apply-0001");
      expect(app.tenantId).toBe(TENANT_A);
      expect(app.assetId).toBe(ASSET_1);
      expect(app.methodVersion).toBe("1.0.0");
      expect(app.outcome).toBe("succeeded");
      expect(app.audit.intent).toBe("method:apply");
      expect(app.audit.tenant).toBe(TENANT_A);
      expect(app.applicationDigest).toMatch(/^[0-9a-f]{8}$/);
      // Caller-supplied value preserved verbatim.
      expect(app.parameters["notes"]).toBe("first change");
    }
  });

  it("applies the documented default for omitted optional parameters", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0001b",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5 }, // notes omitted
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Default applied for the omitted optional parameter.
      expect(r.application.parameters["notes"]).toBe("");
    }
  });

  it("refuses deprecated method (method-deprecated)", () => {
    const reg = registerOilChange();
    const r1 = deprecateMethod(reg, {
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      version: "1.0.0",
      deprecatedAt: NOW + 10_000,
    });
    if (!r1.ok) throw new Error("deprecate failed");
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(r1.registry, port, {
      applicationId: "app_apply-0002",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("method-deprecated");
  });

  it("refuses unknown method (unknown-method)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0003",
      tenantId: TENANT_A,
      methodId: "mth_missing-002" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: {},
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-method");
  });

  it("refuses unknown asset (unknown-asset)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([]); // empty registry — no assets
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0004",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-asset");
  });

  it("refuses asset-tenant-mismatch (asset exists but owned by another tenant)", () => {
    const reg = registerOilChange();
    // ASSET_1 is in TENANT_B; caller asks for TENANT_A — port returns null,
    // which surfaces as unknown-asset (fail-closed: never leaks asset existence
    // across tenants). The asset-tenant-mismatch code is reserved for the
    // case where the port itself returns a foreign-tenant record.
    const port: AssetLookupPort = {
      findAsset: (_t, _id) => ({ id: ASSET_1, tenantId: TENANT_B }),
    };
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0005",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("asset-tenant-mismatch");
  });

  it("refuses missing required parameter (missing-parameter)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0006",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30" }, // volumeLitres missing
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-parameter");
  });

  it("refuses invalid parameter type (invalid-parameter-type)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0007",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: "six" },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-parameter-type");
  });

  it("refuses invalid enum value (invalid-enum-value)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0008",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "20W-50", volumeLitres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-enum-value");
  });

  it("refuses unknown parameter (invalid-parameter-type — schema is the contract)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0009",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5, extraField: true },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-parameter-type");
  });

  it("refuses malformed application id (malformed-application-id)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "bad id!",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-application-id");
  });

  it("refuses empty tenant id (missing-tenant-id)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0010",
      tenantId: "",
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5 },
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
      actor: "act_tech-001",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("refuses invalid applied-at (invalid-applied-at)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    for (const at of [0, -1, NaN, Infinity]) {
      const r = applyMethodToAsset(reg, port, {
        applicationId: "app_apply-0011",
        tenantId: TENANT_A,
        methodId: "mth_oil-change" as MethodDefinition["methodId"],
        methodVersion: "1.0.0",
        assetId: ASSET_1,
        parameters: { oilGrade: "5W-30", volumeLitres: 6.5 },
        outcome: "succeeded",
        appliedAt: at,
        actor: "act_tech-001",
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("invalid-applied-at");
    }
  });

  it("records the outcome verbatim (succeeded / failed / skipped)", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_1, tenantId: TENANT_A }]);
    for (const outcome of ["succeeded", "failed", "skipped"] as const) {
      const r = applyMethodToAsset(reg, port, {
        applicationId: `app_apply-0012-${outcome}`,
        tenantId: TENANT_A,
        methodId: "mth_oil-change" as MethodDefinition["methodId"],
        methodVersion: "1.0.0",
        assetId: ASSET_1,
        parameters: { oilGrade: "5W-30", volumeLitres: 6.5 },
        outcome,
        appliedAt: NOW + 60_000,
        actor: "act_tech-001",
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.application.outcome).toBe(outcome);
    }
  });

  it("uses asset 2 just as well — REAL asset binding, not a fixture hack", () => {
    const reg = registerOilChange();
    const port = fakeAssetLookup([{ id: ASSET_2, tenantId: TENANT_A }]);
    const r = applyMethodToAsset(reg, port, {
      applicationId: "app_apply-0013",
      tenantId: TENANT_A,
      methodId: "mth_oil-change" as MethodDefinition["methodId"],
      methodVersion: "1.0.0",
      assetId: ASSET_2,
      parameters: { oilGrade: "10W-40", volumeLitres: 8 },
      outcome: "succeeded",
      appliedAt: NOW + 70_000,
      actor: "act_tech-002",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.application.assetId).toBe(ASSET_2);
  });
});

describe("method: digest — determinism + content sensitivity", () => {
  it("byte-identical re-runs over the same inputs", () => {
    const args = {
      id: "app_apply-dig1",
      tenantId: TENANT_A,
      methodId: "mth_oil-change",
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: { oilGrade: "5W-30", volumeLitres: 6.5 } as Record<string, unknown>,
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
    };
    expect(methodApplicationDigest(args)).toBe(methodApplicationDigest(args));
  });

  it("digest changes when parameter content changes (content is on the chain)", () => {
    const base = {
      id: "app_apply-dig2",
      tenantId: TENANT_A,
      methodId: "mth_oil-change",
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
    };
    const d1 = methodApplicationDigest({ ...base, parameters: { a: 1 } });
    const d2 = methodApplicationDigest({ ...base, parameters: { a: 2 } });
    expect(d1).not.toBe(d2);
  });

  it("digest changes when observation anchor changes (anchor is on the chain)", () => {
    const base = {
      id: "app_apply-dig3",
      tenantId: TENANT_A,
      methodId: "mth_oil-change",
      methodVersion: "1.0.0",
      assetId: ASSET_1,
      parameters: {} as Record<string, unknown>,
      outcome: "succeeded",
      appliedAt: NOW + 60_000,
    };
    const d1 = methodApplicationDigest({ ...base, observationAnchor: { observationId: "obs_a-001-aaaaaaaa" } });
    const d2 = methodApplicationDigest({ ...base, observationAnchor: { observationId: "obs_a-002-bbbbbbbb" } });
    expect(d1).not.toBe(d2);
  });
});

// Type-only consumer — proves the discriminated union shape.
function _appResultTypeCheck(r: MethodApplicationResult): string {
  if (r.ok) return r.application.id;
  return r.reason;
}
void _appResultTypeCheck;
