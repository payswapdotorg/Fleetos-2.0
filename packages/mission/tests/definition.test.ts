/**
 * @fleetos/mission — definition validation tests.
 *
 * Every rejection code: no stages, invalid/duplicate stage ids, guard
 * validation (shape + registry), dependency validation (unknown / self /
 * intra-group / cycle), and the parallel block geometry.
 */

import { describe, expect, it } from "vitest";
import { validateMissionDefinition } from "../src/definition.js";
import { PARALLEL_DEF, SEQUENTIAL_DEF } from "./helpers.js";

describe("validateMissionDefinition — happy paths", () => {
  it("accepts a sequential definition and computes singleton blocks", () => {
    const result = validateMissionDefinition({ definition: SEQUENTIAL_DEF });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blocks).toHaveLength(3);
    expect(result.value.blocks.every((b) => !b.parallel)).toBe(true);
    expect(result.value.stageBlockIndex.get("analyze")).toBe(1);
  });

  it("accepts a parallel-group definition and collapses the run into ONE block", () => {
    const result = validateMissionDefinition({ definition: PARALLEL_DEF });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blocks).toHaveLength(2);
    expect(result.value.blocks[0]?.parallel).toBe(true);
    expect(result.value.blocks[0]?.groupId).toBe("fetch");
    expect(result.value.blocks[0]?.stages.map((s) => s.id)).toEqual([
      "fetch-a",
      "fetch-b",
      "fetch-c",
    ]);
    expect(result.value.blocks[1]?.stages.map((s) => s.id)).toEqual(["merge"]);
  });

  it("accepts guards present in the registry", () => {
    const result = validateMissionDefinition({
      definition: {
        id: "d",
        stages: [
          { id: "s1", guards: [{ kind: "capability", ref: "cap:x" }] },
        ],
      },
      knownGuards: new Set(["capability:cap:x"]),
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateMissionDefinition — structural rejections", () => {
  it("rejects a missing definition id", () => {
    expect(
      validateMissionDefinition({ definition: { id: "", stages: [{ id: "s1" }] } }),
    ).toEqual({ ok: false, reason: "missing-definition-id" });
  });

  it("rejects an empty stage list", () => {
    expect(
      validateMissionDefinition({ definition: { id: "d", stages: [] } }),
    ).toEqual({ ok: false, reason: "no-stages" });
  });

  it("rejects an invalid stage id", () => {
    expect(
      validateMissionDefinition({ definition: { id: "d", stages: [{ id: "" }] } }),
    ).toEqual({ ok: false, reason: "invalid-stage-id" });
    expect(
      validateMissionDefinition({ definition: { id: "d", stages: [{ id: "has space" }] } }),
    ).toEqual({ ok: false, reason: "invalid-stage-id" });
  });

  it("rejects duplicate stage ids", () => {
    expect(
      validateMissionDefinition({
        definition: { id: "d", stages: [{ id: "s1" }, { id: "s1" }] },
      }),
    ).toEqual({ ok: false, reason: "duplicate-stage-id" });
  });
});

describe("validateMissionDefinition — guard rejections", () => {
  it("rejects a malformed guard (bad kind / empty ref)", () => {
    expect(
      validateMissionDefinition({
        definition: {
          id: "d",
          stages: [{ id: "s1", guards: [{ kind: "vibe" as "capability", ref: "x" }] }],
        },
      }),
    ).toEqual({ ok: false, reason: "invalid-guard" });
    expect(
      validateMissionDefinition({
        definition: {
          id: "d",
          stages: [{ id: "s1", guards: [{ kind: "capability", ref: "" }] }],
        },
      }),
    ).toEqual({ ok: false, reason: "invalid-guard" });
  });

  it("rejects a guard unknown to the registry", () => {
    expect(
      validateMissionDefinition({
        definition: {
          id: "d",
          stages: [{ id: "s1", guards: [{ kind: "predicate", ref: "nope" }] }],
        },
        knownGuards: new Set(["capability:cap:x"]),
      }),
    ).toEqual({ ok: false, reason: "unknown-guard" });
  });
});

describe("validateMissionDefinition — dependency rejections", () => {
  it("rejects an unknown dependency", () => {
    expect(
      validateMissionDefinition({
        definition: { id: "d", stages: [{ id: "s1", dependsOn: ["ghost"] }] },
      }),
    ).toEqual({ ok: false, reason: "unknown-dependency" });
  });

  it("rejects a self-dependency", () => {
    expect(
      validateMissionDefinition({
        definition: { id: "d", stages: [{ id: "s1", dependsOn: ["s1"] }] },
      }),
    ).toEqual({ ok: false, reason: "self-dependency" });
  });

  it("rejects a dependency inside the same parallel group", () => {
    expect(
      validateMissionDefinition({
        definition: {
          id: "d",
          stages: [
            { id: "a", parallelGroup: "g" },
            { id: "b", parallelGroup: "g", dependsOn: ["a"] },
          ],
        },
      }),
    ).toEqual({ ok: false, reason: "parallel-group-dependency" });
  });

  it("rejects a 2-cycle: s1 → s2 → s1", () => {
    expect(
      validateMissionDefinition({
        definition: {
          id: "d",
          stages: [
            { id: "s1", dependsOn: ["s2"] },
            { id: "s2", dependsOn: ["s1"] },
          ],
        },
      }),
    ).toEqual({ ok: false, reason: "cycle-detected" });
  });

  it("rejects a forward dependency that contradicts the declared sequence (cycle via block edges)", () => {
    expect(
      validateMissionDefinition({
        definition: {
          id: "d",
          stages: [{ id: "s1" }, { id: "s2", dependsOn: ["s1"] }],
        },
      }),
    ).toEqual({ ok: true, value: expect.anything() });
    // s1 depending on the LATER s2 contradicts s1-before-s2 → cycle.
    expect(
      validateMissionDefinition({
        definition: {
          id: "d",
          stages: [{ id: "s1", dependsOn: ["s2"] }, { id: "s2" }],
        },
      }),
    ).toEqual({ ok: false, reason: "cycle-detected" });
  });

  it("a backward dependency across blocks is legal", () => {
    const result = validateMissionDefinition({
      definition: {
        id: "d",
        stages: [
          { id: "a" },
          { id: "b" },
          { id: "c", dependsOn: ["a"] },
        ],
      },
    });
    expect(result.ok).toBe(true);
  });

  it("a 3-cycle is detected", () => {
    expect(
      validateMissionDefinition({
        definition: {
          id: "d",
          stages: [
            { id: "a", dependsOn: ["c"] },
            { id: "b", dependsOn: ["a"] },
            { id: "c", dependsOn: ["b"] },
          ],
        },
      }),
    ).toEqual({ ok: false, reason: "cycle-detected" });
  });
});
