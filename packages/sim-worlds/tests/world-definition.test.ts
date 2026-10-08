/**
 * @fleetos/sim-worlds — world definition tests (F260A).
 *
 * World digest + verify (tamper-evident); fail-closed validation with
 * reason codes: tenant mandatory, deterministic ordering, parameter
 * bounds (zero/negative rates REFUSED), reference resolution.
 */

import { describe, expect, it } from "vitest";
import {
  validateWorld,
  verifyWorldDigest,
  worldDigest,
  worldTenantMatches,
} from "../src/world-definition.js";
import type { FleetWorld } from "../src/world-definition.js";
import { baseWorld } from "./helpers.js";

describe("world digest — FNV-1a convention", () => {
  it("is stable and verifies for a valid world", () => {
    const w = baseWorld();
    const d = worldDigest(w);
    expect(d).toMatch(/^world_[0-9a-f]{8}$/);
    expect(d).toBe(worldDigest(w));
    expect(verifyWorldDigest(w, d)).toBe(true);
  });

  it("ignores object key order (canonical form)", () => {
    const w1 = baseWorld();
    const w2 = { ...baseWorld(), healthPolicy: { recoveryGraceSteps: 1, downAfterSteps: 3 } };
    expect(worldDigest(w1)).toBe(worldDigest(w2 as FleetWorld));
  });

  it("changes when ANY world field is tampered (tamper-evident)", () => {
    const w = baseWorld();
    const d = worldDigest(w);
    expect(verifyWorldDigest({ ...w, description: "tampered" }, d)).toBe(false);
    expect(verifyWorldDigest({ ...w, seed: "seed-beta" }, d)).toBe(false);
    const bumpedRate = w.assets.map((a, i) => (i === 0 ? { ...a, failureRateBps: 2 } : a));
    expect(verifyWorldDigest({ ...w, assets: bumpedRate }, d)).toBe(false);
  });
});

describe("validateWorld — happy path", () => {
  it("accepts the base world and returns its digest", () => {
    const v = validateWorld(baseWorld());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.digest).toBe(worldDigest(baseWorld()));
  });

  it("accepts a world with no links and no policies", () => {
    const v = validateWorld(baseWorld({ links: [], maintenancePolicies: [] }));
    expect(v.ok).toBe(true);
  });
});

describe("validateWorld — tenant + identity fail-closed", () => {
  it("refuses a missing tenant", () => {
    const v = validateWorld(baseWorld({ tenantId: "" }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.issues.some((i) => i.code === "missing-tenant")).toBe(true);
  });

  it("refuses a missing worldId, seed, bad version and bad time unit", () => {
    const cases: readonly [Partial<FleetWorld>, string][] = [
      [{ worldId: "" }, "missing-world-id"],
      [{ seed: "" }, "missing-seed"],
      [{ version: 0 }, "invalid-version"],
      [{ timeUnitMs: 0 }, "invalid-time-unit"],
    ];
    for (const [override, code] of cases) {
      const v = validateWorld(baseWorld(override));
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.issues.some((i) => i.code === code)).toBe(true);
    }
  });

  it("worldTenantMatches is an exact equality gate", () => {
    const w = baseWorld();
    expect(worldTenantMatches(w, "tenant-a")).toBe(true);
    expect(worldTenantMatches(w, "tenant-b")).toBe(false);
    expect(worldTenantMatches(w, "")).toBe(false);
  });
});

describe("validateWorld — parameter bounds (zero/negative rates REFUSED)", () => {
  it("refuses zero, negative and out-of-bounds failure rates with reason codes", () => {
    for (const bad of [0, -5, 10_001, 12.5]) {
      const v = validateWorld(baseWorld({
        assets: [
          { assetId: "asset-alpha", assetClass: "pump", failureRateBps: bad },
          { assetId: "asset-beta", assetClass: "vehicle", failureRateBps: 1 },
        ],
      }));
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.issues.some((i) => i.code === "invalid-failure-rate" && i.ref === "asset-alpha")).toBe(true);
    }
  });

  it("refuses out-of-bounds dropout and uptime rates", () => {
    const v1 = validateWorld(baseWorld({
      devices: [
        { deviceId: "dev-alpha-1", assetId: "asset-alpha", dropoutBps: 0, emitEverySteps: 1, streams: [{ kind: "temperature", unit: "C", baseValue: 40, jitterMinOffset: -2, jitterMaxOffset: 2 }] },
        { deviceId: "dev-beta-1", assetId: "asset-beta", dropoutBps: 1, emitEverySteps: 2, streams: [{ kind: "pressure", unit: "kPa", baseValue: 100, jitterMinOffset: -5, jitterMaxOffset: 5 }] },
      ],
    }));
    expect(v1.ok).toBe(false);
    if (v1.ok) return;
    expect(v1.issues.some((i) => i.code === "invalid-dropout-rate")).toBe(true);

    const v2 = validateWorld(baseWorld({
      links: [{ linkId: "link-a1-b1", endpoints: ["dev-alpha-1", "dev-beta-1"], uptimeBps: 10_001 }],
    }));
    expect(v2.ok).toBe(false);
    if (v2.ok) return;
    expect(v2.issues.some((i) => i.code === "invalid-uptime-bps")).toBe(true);
  });

  it("refuses an empty-asset world outright", () => {
    const v = validateWorld(baseWorld({ assets: [], devices: [], links: [], maintenancePolicies: [], initialHealthPostures: [] }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.issues.some((i) => i.code === "empty-assets")).toBe(true);
  });
});

describe("validateWorld — references and ordering", () => {
  it("refuses devices that reference unknown assets", () => {
    const v = validateWorld(baseWorld({
      devices: [
        { deviceId: "dev-alpha-1", assetId: "asset-gamma", dropoutBps: 1, emitEverySteps: 1, streams: [{ kind: "temperature", unit: "C", baseValue: 40, jitterMinOffset: -2, jitterMaxOffset: 2 }] },
      ],
    }));
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.issues.some((i) => i.code === "unknown-asset-ref")).toBe(true);
  });

  it("refuses links with unknown endpoints and postures for unknown assets", () => {
    const v1 = validateWorld(baseWorld({
      links: [{ linkId: "link-x", endpoints: ["dev-alpha-1", "dev-ghost"], uptimeBps: 9_000 }],
    }));
    expect(v1.ok).toBe(false);
    if (v1.ok) return;
    expect(v1.issues.some((i) => i.code === "unknown-link-endpoint")).toBe(true);

    const v2 = validateWorld(baseWorld({
      initialHealthPostures: [{ assetId: "asset-ghost", posture: "healthy" }],
    }));
    expect(v2.ok).toBe(false);
    if (v2.ok) return;
    expect(v2.issues.some((i) => i.code === "unknown-posture-asset")).toBe(true);
  });

  it("refuses unsorted arrays (non-deterministic ordering)", () => {
    const unsorted = baseWorld({
      assets: [
        { assetId: "asset-beta", assetClass: "vehicle", failureRateBps: 1 },
        { assetId: "asset-alpha", assetClass: "pump", failureRateBps: 1 },
      ],
    });
    const v = validateWorld(unsorted);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.issues.some((i) => i.code === "non-deterministic-asset-order")).toBe(true);
  });

  it("refuses duplicates (assets, devices, postures, policies, policy-assets)", () => {
    const dupAsset = baseWorld({
      assets: [
        { assetId: "asset-alpha", assetClass: "pump", failureRateBps: 1 },
        { assetId: "asset-alpha", assetClass: "pump", failureRateBps: 2 },
      ],
    });
    const v1 = validateWorld(dupAsset);
    expect(v1.ok).toBe(false);
    if (v1.ok) return;
    expect(v1.issues.some((i) => i.code === "duplicate-asset")).toBe(true);

    const dupPolicyAsset = baseWorld({
      maintenancePolicies: [
        { policyId: "pol-a", assetId: "asset-alpha", windowEverySteps: 5, windowLengthSteps: 2, serviceLevel: "standard", mtbfSteps: 6 },
        { policyId: "pol-b", assetId: "asset-alpha", windowEverySteps: 7, windowLengthSteps: 1, serviceLevel: "basic", mtbfSteps: 9 },
      ],
    });
    const v2 = validateWorld(dupPolicyAsset);
    expect(v2.ok).toBe(false);
    if (v2.ok) return;
    expect(v2.issues.some((i) => i.code === "duplicate-policy-asset")).toBe(true);
  });

  it("refuses invalid maintenance windows, mtbf and emit intervals", () => {
    const cases: readonly [Partial<FleetWorld>, string][] = [
      [{ maintenancePolicies: [{ policyId: "pol-alpha", assetId: "asset-alpha", windowEverySteps: 2, windowLengthSteps: 3, serviceLevel: "standard", mtbfSteps: 6 }] }, "invalid-window"],
      [{ maintenancePolicies: [{ policyId: "pol-alpha", assetId: "asset-alpha", windowEverySteps: 5, windowLengthSteps: 2, serviceLevel: "standard", mtbfSteps: 0 }] }, "invalid-mtbf"],
      [{ devices: [
        { deviceId: "dev-alpha-1", assetId: "asset-alpha", dropoutBps: 1, emitEverySteps: 0, streams: [{ kind: "temperature", unit: "C", baseValue: 40, jitterMinOffset: -2, jitterMaxOffset: 2 }] },
        { deviceId: "dev-beta-1", assetId: "asset-beta", dropoutBps: 1, emitEverySteps: 2, streams: [{ kind: "pressure", unit: "kPa", baseValue: 100, jitterMinOffset: -5, jitterMaxOffset: 5 }] },
      ] }, "invalid-emit-interval"],
      [{ healthPolicy: { downAfterSteps: 0, recoveryGraceSteps: 1 } }, "invalid-health-policy"],
    ];
    for (const [override, code] of cases) {
      const v = validateWorld(baseWorld(override));
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.issues.some((i) => i.code === code)).toBe(true);
    }
  });
});
