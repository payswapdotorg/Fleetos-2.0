import { describe, it, expect } from "vitest";
import {
  WORLD_CONTEXT_SCHEMA_VERSION,
  hasValidSchemaVersion,
  projectProject,
  projectWorkload,
  type ObservationProvenance,
  type WorkItemRef,
  type ProjectRef,
  type TenantScopeLike,
} from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };
const project: ProjectRef = { projectId: "p1" };
const workItems: readonly WorkItemRef[] = [{ workItemId: "w1", missionId: "m1" }];
const observations: readonly ObservationProvenance[] = [
  { observationRef: "o1", observedAt: "0", observer: "sensor-1", sensorKind: "temperature" },
];

describe("projectWorkload", () => {
  it("produces a projection with the canonical schema version", () => {
    const p = projectWorkload({
      tenant, workloadId: "wl-1", assetIds: ["a-1"], workItemRefs: workItems, projectRefs: [project],
      observations, utilization: 0.5, computedAt: "0",
    });
    expect(p.schemaVersion).toBe(WORLD_CONTEXT_SCHEMA_VERSION);
    expect(hasValidSchemaVersion(p)).toBe(true);
  });

  it("is degraded when no observations are present", () => {
    const p = projectWorkload({
      tenant, workloadId: "wl-1", assetIds: [], workItemRefs: [], projectRefs: [],
      observations: [], utilization: 0.5, computedAt: "0",
    });
    expect(p.degraded).toBe(true);
  });

  it("is degraded when utilization is negative", () => {
    const p = projectWorkload({
      tenant, workloadId: "wl-1", assetIds: ["a-1"], workItemRefs: [], projectRefs: [],
      observations, utilization: -0.1, computedAt: "0",
    });
    expect(p.degraded).toBe(true);
  });

  it("carries per-observation provenance refs", () => {
    const p = projectWorkload({
      tenant, workloadId: "wl-1", assetIds: ["a-1"], workItemRefs: [], projectRefs: [],
      observations, utilization: 0.5, computedAt: "0",
    });
    expect(p.provenance).toHaveLength(1);
    expect(p.provenance[0]?.observationRef).toBe("o1");
  });

  it("is pure — same inputs => same output", () => {
    const a = projectWorkload({
      tenant, workloadId: "wl-1", assetIds: ["a-1"], workItemRefs: [], projectRefs: [],
      observations, utilization: 0.5, computedAt: "0",
    });
    const b = projectWorkload({
      tenant, workloadId: "wl-1", assetIds: ["a-1"], workItemRefs: [], projectRefs: [],
      observations, utilization: 0.5, computedAt: "0",
    });
    expect(a).toEqual(b);
  });
});

describe("projectProject", () => {
  it("counts active work items", () => {
    const p = projectProject({
      tenant, project, workItems: [...workItems, { workItemId: "w2" }], assetIds: ["a-1"], observations, computedAt: "0",
    });
    expect(p.activeWorkItems).toBe(2);
  });

  it("carries project + tenant refs", () => {
    const p = projectProject({ tenant, project, workItems, assetIds: [], observations, computedAt: "0" });
    expect(p.project.projectId).toBe("p1");
    expect(p.tenant.tenantId).toBe("t1");
  });

  it("has the canonical schema version", () => {
    const p = projectProject({ tenant, project, workItems, assetIds: [], observations, computedAt: "0" });
    expect(hasValidSchemaVersion(p)).toBe(true);
  });
});

describe("hasValidSchemaVersion", () => {
  it("rejects a projection with a foreign schema version", () => {
    const bad = { schemaVersion: "0.0.0-foreign" };
    expect(hasValidSchemaVersion(bad)).toBe(false);
  });
});
