/**
 * @fleetos/sim-worlds — fault injection tests (F260A).
 *
 * Scenario digests + tamper, fail-closed validation (cross-tenant and
 * cross-world refusal, unknown targets, bad windows, ordering law),
 * deterministic application ordering inside the engine, and the
 * maintenance-skip fault path.
 */

import { describe, expect, it } from "vitest";
import {
  assetFailuresAt,
  linkForcedDownAt,
  maintenanceSkippedAt,
  scenarioAppliesTo,
  scenarioDigest,
  validateFaultScenario,
  verifyScenarioDigest,
} from "../src/fault-injection.js";
import type { FaultScenario } from "../src/fault-injection.js";
import { runWorld } from "../src/world-engine.js";
import { baseWorld } from "./helpers.js";

function scenario(overrides?: Partial<FaultScenario>): FaultScenario {
  return {
    scenarioId: "scen-alpha",
    worldId: "world-test",
    tenantId: "tenant-a",
    description: "test scenario",
    faults: [
      { kind: "link-outage", linkId: "link-a1-b1", fromStep: 2, untilStep: 5 },
      { kind: "asset-failure", assetId: "asset-alpha", atStep: 3 },
      { kind: "maintenance-skip", assetId: "asset-alpha", atStep: 6 },
    ],
    ...overrides,
  };
}

describe("scenario digest", () => {
  it("is stable and verifies (FNV-1a convention)", () => {
    const s = scenario();
    const d = scenarioDigest(s);
    expect(d).toMatch(/^scenario_[0-9a-f]{8}$/);
    expect(d).toBe(scenarioDigest(s));
    expect(verifyScenarioDigest(s, d)).toBe(true);
  });

  it("changes when any fault parameter is tampered", () => {
    const d = scenarioDigest(scenario());
    const tampered = scenario({ faults: [{ kind: "asset-failure", assetId: "asset-alpha", atStep: 4 }] });
    expect(verifyScenarioDigest(tampered, d)).toBe(false);
    expect(verifyScenarioDigest(scenario({ description: "other" }), d)).toBe(false);
  });
});

describe("validateFaultScenario — fail-closed", () => {
  it("accepts a valid scenario and returns its digest", () => {
    const v = validateFaultScenario(scenario(), baseWorld());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.digest).toBe(scenarioDigest(scenario()));
  });

  it("refuses world-id and tenant mismatches (cross-tenant law)", () => {
    const v1 = validateFaultScenario(scenario({ worldId: "world-other" }), baseWorld());
    expect(v1.ok).toBe(false);
    if (v1.ok) return;
    expect(v1.issues.some((i) => i.code === "world-id-mismatch")).toBe(true);

    const v2 = validateFaultScenario(scenario({ tenantId: "tenant-b" }), baseWorld());
    expect(v2.ok).toBe(false);
    if (v2.ok) return;
    expect(v2.issues.some((i) => i.code === "tenant-mismatch")).toBe(true);
  });

  it("scenarioAppliesTo refuses cross-world and cross-tenant application", () => {
    expect(scenarioAppliesTo(scenario({ worldId: "world-x" }), baseWorld())).toEqual({ ok: false, reason: "scenario-world-mismatch" });
    expect(scenarioAppliesTo(scenario({ tenantId: "tenant-b" }), baseWorld())).toEqual({ ok: false, reason: "scenario-tenant-mismatch" });
    expect(scenarioAppliesTo(scenario(), baseWorld())).toEqual({ ok: true });
  });

  it("refuses unknown assets and links", () => {
    const v1 = validateFaultScenario(scenario({ faults: [{ kind: "asset-failure", assetId: "asset-ghost", atStep: 1 }] }), baseWorld());
    expect(v1.ok).toBe(false);
    if (v1.ok) return;
    expect(v1.issues.some((i) => i.code === "unknown-asset")).toBe(true);

    const v2 = validateFaultScenario(scenario({ faults: [{ kind: "link-outage", linkId: "link-ghost", fromStep: 1, untilStep: 2 }] }), baseWorld());
    expect(v2.ok).toBe(false);
    if (v2.ok) return;
    expect(v2.issues.some((i) => i.code === "unknown-link")).toBe(true);
  });

  it("refuses invalid steps and outage windows", () => {
    const v1 = validateFaultScenario(scenario({ faults: [{ kind: "asset-failure", assetId: "asset-alpha", atStep: -1 }] }), baseWorld());
    expect(v1.ok).toBe(false);
    if (v1.ok) return;
    expect(v1.issues.some((i) => i.code === "invalid-step")).toBe(true);

    const v2 = validateFaultScenario(scenario({ faults: [{ kind: "link-outage", linkId: "link-a1-b1", fromStep: 5, untilStep: 5 }] }), baseWorld());
    expect(v2.ok).toBe(false);
    if (v2.ok) return;
    expect(v2.issues.some((i) => i.code === "invalid-outage-window")).toBe(true);
  });

  it("refuses unsorted and duplicate faults (deterministic ordering law)", () => {
    const unsorted = scenario({ faults: [
      { kind: "asset-failure", assetId: "asset-alpha", atStep: 4 },
      { kind: "asset-failure", assetId: "asset-alpha", atStep: 2 },
    ] });
    const v1 = validateFaultScenario(unsorted, baseWorld());
    expect(v1.ok).toBe(false);
    if (v1.ok) return;
    expect(v1.issues.some((i) => i.code === "non-deterministic-fault-order")).toBe(true);

    const dup = scenario({ faults: [
      { kind: "asset-failure", assetId: "asset-alpha", atStep: 2 },
      { kind: "asset-failure", assetId: "asset-alpha", atStep: 2 },
    ] });
    const v2 = validateFaultScenario(dup, baseWorld());
    expect(v2.ok).toBe(false);
    if (v2.ok) return;
    expect(v2.issues.some((i) => i.code === "duplicate-fault")).toBe(true);
  });
});

describe("fault application — deterministic ordering and semantics", () => {
  it("an asset-failure fault fires at exactly its step with cause injected", () => {
    const s = scenario({ faults: [{ kind: "asset-failure", assetId: "asset-beta", atStep: 3 }] });
    const r = runWorld(baseWorld(), 5, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const failures = r.events.filter((e) => e.kind === "asset-failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ assetId: "asset-beta", cause: "injected", step: 3 });
    expect(r.state.assets.get("asset-beta")?.operational).toBe(false);
  });

  it("a link-outage fault forces the link down exactly inside [from, until)", () => {
    const s = scenario({ faults: [{ kind: "link-outage", linkId: "link-a1-b1", fromStep: 2, untilStep: 5 }] });
    const r = runWorld(baseWorld(), 8, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const down = r.events.find((e) => e.kind === "link-down");
    expect(down).toMatchObject({ linkId: "link-a1-b1", cause: "injected", step: 2 });
    expect(r.state.links.get("link-a1-b1")?.up).toBe(true); // recovered by step 8 (10000-free uptime draws resume)
    // window membership helpers agree with the applied window
    expect(linkForcedDownAt(s, "link-a1-b1", 2)).toBe(true);
    expect(linkForcedDownAt(s, "link-a1-b1", 4)).toBe(true);
    expect(linkForcedDownAt(s, "link-a1-b1", 5)).toBe(false);
  });

  it("a maintenance-skip fault defers the repair to the next window", () => {
    const s: FaultScenario = {
      scenarioId: "scen-skip", worldId: "world-test", tenantId: "tenant-a",
      description: "fail at 2, skip the step-5 window",
      faults: [
        { kind: "asset-failure", assetId: "asset-alpha", atStep: 2 },
        { kind: "maintenance-skip", assetId: "asset-alpha", atStep: 5 },
      ],
    };
    const w = baseWorld({
      maintenancePolicies: [{
        policyId: "pol-alpha", assetId: "asset-alpha", windowEverySteps: 5,
        windowLengthSteps: 1, serviceLevel: "standard", mtbfSteps: 6,
      }],
    });
    const r = runWorld(w, 12, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lifecycle = r.events
      .filter((e) => ["asset-failed", "maintenance-due", "maintenance-started", "maintenance-skipped", "maintenance-completed"].includes(e.kind))
      .map((e) => ({ kind: e.kind, step: e.step }));
    expect(lifecycle).toEqual([
      { kind: "asset-failed", step: 2 },
      { kind: "maintenance-due", step: 2 },
      { kind: "maintenance-skipped", step: 5 },
      { kind: "maintenance-started", step: 10 },
      { kind: "maintenance-completed", step: 12 },
    ]);
    expect(r.state.assets.get("asset-alpha")).toMatchObject({ operational: true });
  });

  it("same scenario twice => identical journals (faults are deterministic)", () => {
    const s = scenario();
    const a = runWorld(baseWorld(), 10, s);
    const b = runWorld(baseWorld(), 10, s);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
  });

  it("lookup helpers are exact (assetFailuresAt / maintenanceSkippedAt)", () => {
    const s = scenario();
    expect(assetFailuresAt(s, 3).map((f) => f.assetId)).toEqual(["asset-alpha"]);
    expect(assetFailuresAt(s, 4)).toHaveLength(0);
    expect(maintenanceSkippedAt(s, "asset-alpha", 6)).toBe(true);
    expect(maintenanceSkippedAt(s, "asset-alpha", 7)).toBe(false);
    expect(maintenanceSkippedAt(s, "asset-beta", 6)).toBe(false);
  });
});
