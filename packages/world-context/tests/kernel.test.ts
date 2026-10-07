/**
 * World-context kernel tests — windowed projections, horizon discipline.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  projectWindowedWorkload,
  projectWindowedProject,
  isObservationMature,
  filterMatureObservations,
  verifyWindowIntegrity,
  WORLD_CONTEXT_SCHEMA_VERSION,
} from "../src/index.ts";
import type { ObservationProvenance } from "../src/index.ts";

const tenant = { tenantId: "t1" };

function makeObservations(): ObservationProvenance[] {
  return [
    { observationRef: "o1", observedAt: "2026-01-01T00:00:00.000Z", observer: "sensor-1", sensorKind: "temp" },
    { observationRef: "o2", observedAt: "2026-01-02T00:00:00.000Z", observer: "sensor-1", sensorKind: "temp" },
    { observationRef: "o3", observedAt: "2026-01-03T00:00:00.000Z", observer: "sensor-1", sensorKind: "temp" },
    { observationRef: "o4", observedAt: "2026-01-04T00:00:00.000Z", observer: "sensor-1", sensorKind: "temp" },
    { observationRef: "o5", observedAt: "2026-01-05T00:00:00.000Z", observer: "sensor-1", sensorKind: "temp" },
  ];
}

describe("projectWindowedWorkload", () => {
  it("includes only observations within the window", () => {
    const proj = projectWindowedWorkload({
      tenant,
      workloadId: "w1",
      assetIds: ["a1"],
      workItemRefs: [{ workItemId: "wi1" }],
      projectRefs: [{ projectId: "p1" }],
      observations: makeObservations(),
      utilization: 0.5,
      computedAt: "2026-01-06T00:00:00.000Z",
      windowStart: "2026-01-02T00:00:00.000Z",
      windowEnd: "2026-01-04T00:00:00.000Z",
    });
    expect(proj.provenance).toHaveLength(3);
    expect(proj.provenance.map((o) => o.observationRef)).toEqual(["o2", "o3", "o4"]);
    expect(proj.windowStart).toBe("2026-01-02T00:00:00.000Z");
    expect(proj.windowEnd).toBe("2026-01-04T00:00:00.000Z");
  });

  it("carries the schema version", () => {
    const proj = projectWindowedWorkload({
      tenant, workloadId: "w1", assetIds: [], workItemRefs: [], projectRefs: [],
      observations: [], utilization: 0, computedAt: "t",
      windowStart: "t", windowEnd: "t",
    });
    expect(proj.schemaVersion).toBe(WORLD_CONTEXT_SCHEMA_VERSION);
  });

  it("is deterministic", () => {
    const input = {
      tenant, workloadId: "w1", assetIds: ["a1"], workItemRefs: [], projectRefs: [],
      observations: makeObservations(), utilization: 0.5, computedAt: "t",
      windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-01-05T00:00:00.000Z",
    };
    expect(projectWindowedWorkload(input)).toEqual(projectWindowedWorkload(input));
  });
});

describe("projectWindowedProject", () => {
  it("includes only observations within the window", () => {
    const proj = projectWindowedProject({
      tenant,
      project: { projectId: "p1" },
      workItems: [{ workItemId: "wi1" }],
      assetIds: ["a1"],
      observations: makeObservations(),
      computedAt: "2026-01-06T00:00:00.000Z",
      windowStart: "2026-01-03T00:00:00.000Z",
      windowEnd: "2026-01-05T00:00:00.000Z",
    });
    expect(proj.provenance).toHaveLength(3);
    expect(proj.activeWorkItems).toBe(1);
  });
});

describe("isObservationMature", () => {
  it("returns true when now >= producedAt + horizonMs", () => {
    expect(isObservationMature("2026-01-01T00:00:00.000Z", 86_400_000, "2026-01-02T00:00:00.000Z")).toBe(true);
  });

  it("returns false when now < producedAt + horizonMs", () => {
    expect(isObservationMature("2026-01-01T00:00:00.000Z", 86_400_000, "2026-01-01T12:00:00.000Z")).toBe(false);
  });

  it("returns true at exactly producedAt + horizonMs", () => {
    expect(isObservationMature("2026-01-01T00:00:00.000Z", 86_400_000, "2026-01-02T00:00:00.000Z")).toBe(true);
  });
});

describe("filterMatureObservations", () => {
  it("filters out immature observations (horizon discipline)", () => {
    const obs = [
      { observationRef: "o1", observedAt: "2026-01-01T00:00:00.000Z", observer: "s", sensorKind: "t" },
      { observationRef: "o2", observedAt: "2026-01-02T00:00:00.000Z", observer: "s", sensorKind: "t" },
      { observationRef: "o3", observedAt: "2026-01-03T00:00:00.000Z", observer: "s", sensorKind: "t" },
    ];
    // horizon = 2 days; now = 2026-01-04 => o1 (needs 2026-01-03) and o2 (needs 2026-01-04) are mature, o3 (needs 2026-01-05) is not
    const mature = filterMatureObservations(obs, 2 * 86_400_000, "2026-01-04T00:00:00.000Z");
    expect(mature).toHaveLength(2);
    expect(mature.map((o) => o.observationRef)).toEqual(["o1", "o2"]);
  });

  it("returns empty when all observations are immature", () => {
    const obs = [
      { observationRef: "o1", observedAt: "2026-01-01T00:00:00.000Z", observer: "s", sensorKind: "t" },
    ];
    const mature = filterMatureObservations(obs, 86_400_000, "2026-01-01T00:00:00.000Z");
    expect(mature).toHaveLength(0);
  });
});

describe("verifyWindowIntegrity", () => {
  it("returns ok=true when all observations are within the window", () => {
    const proj = projectWindowedWorkload({
      tenant, workloadId: "w1", assetIds: [], workItemRefs: [], projectRefs: [],
      observations: makeObservations().slice(0, 3),
      utilization: 0.5, computedAt: "t",
      windowStart: "2026-01-01T00:00:00.000Z", windowEnd: "2026-01-03T00:00:00.000Z",
    });
    const result = verifyWindowIntegrity(proj);
    expect(result.ok).toBe(true);
    expect(result.outOfWindow).toBe(0);
  });
});
