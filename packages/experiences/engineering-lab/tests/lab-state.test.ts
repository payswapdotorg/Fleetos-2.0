/**
 * F261 — lab state guard tests: tenant fail-closed over the whole slice,
 * deterministic normalization, digest verify/tamper, determinism and input
 * order-independence. All fixtures are REAL lane outputs.
 */

import { describe, expect, it } from "vitest";
import {
  guardLabState,
  labStateDigestOf,
  verifyLabStateDigest,
  type LabStateSlice,
} from "../src/lab-state.js";
import { LAB_TENANT, makeLabState } from "./helpers.js";
import { makeWorldRun } from "./fixtures-sim.js";

describe("guardLabState — acceptance + normalization", () => {
  it("accepts the composed REAL slice (worlds/runs/benchmarks/optimizations)", () => {
    const result = guardLabState(makeLabState());
    expect(result.ok).toBe(true);
  });

  it("normalizes deterministic ordering: input array order never leaks", () => {
    const a = guardLabState(makeLabState());
    const reversed: LabStateSlice = {
      ...makeLabState(),
      benchmarks: [...makeLabState().benchmarks].reverse(),
      worlds: [...makeLabState().worlds].reverse(),
    };
    const b = guardLabState(reversed);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(labStateDigestOf(a.slice)).toBe(labStateDigestOf(b.slice));
    expect(JSON.stringify(a.slice.benchmarks.map((x) => x.report.runId))).toBe(
      JSON.stringify(["bench-run-clean", "bench-run-tight"]),
    );
  });

  it("is byte-identical for identical inputs (pure fold, same digest)", () => {
    const a = guardLabState(makeLabState());
    const b = guardLabState(makeLabState());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.slice)).toBe(JSON.stringify(b.slice));
  });
});

describe("guardLabState — fail-closed tenancy with exact codes", () => {
  it("refuses a missing tenant (missing-tenant)", () => {
    const result = guardLabState({ ...makeLabState(), tenantId: "" });
    expect(result).toMatchObject({ ok: false, refused: "missing-tenant" });
  });

  it("refuses an invalid logical now (invalid-now)", () => {
    expect(guardLabState({ ...makeLabState(), now: 0 })).toMatchObject({
      ok: false,
      refused: "invalid-now",
    });
    expect(guardLabState({ ...makeLabState(), now: 1.5 })).toMatchObject({
      ok: false,
      refused: "invalid-now",
    });
  });

  it("refuses a cross-tenant world naming the offender", () => {
    const slice = makeLabState();
    const world = { ...slice.worlds[0]!, tenantId: "tenant-other" };
    const result = guardLabState({ ...slice, worlds: [world] });
    expect(result).toMatchObject({ ok: false, refused: "cross-tenant-ref" });
    if (result.ok) return;
    expect(result.detail).toContain("world-lab-main");
    expect(result.detail).toContain("tenant-other");
  });

  it("refuses a cross-tenant run output naming the run", () => {
    const slice = makeLabState();
    const run = slice.worldRuns[0]!;
    const output = { ...run.output, tenant: { tenantId: "tenant-other" } };
    const result = guardLabState({ ...slice, worldRuns: [{ ...run, output }] });
    expect(result).toMatchObject({ ok: false, refused: "cross-tenant-ref" });
    if (result.ok) return;
    expect(result.detail).toContain("run-world-lab-main-scenario-lab-1");
  });

  it("refuses a cross-tenant benchmark report naming the report", () => {
    const slice = makeLabState();
    const bench = slice.benchmarks[0]!;
    const report = { ...bench.report, tenant: { tenantId: "tenant-other" } };
    const result = guardLabState({ ...slice, benchmarks: [{ ...bench, report }] });
    expect(result).toMatchObject({ ok: false, refused: "cross-tenant-ref" });
    if (result.ok) return;
    expect(result.detail).toContain("bench-run-clean");
  });

  it("refuses a cross-tenant role-allocation proposal naming its digest", () => {
    const slice = makeLabState();
    const opt = slice.optimizations[0]!;
    const proposal = { ...opt.roleAllocations[0]!, tenantId: "tenant-other" };
    const result = guardLabState({ ...slice, optimizations: [{ ...opt, roleAllocations: [proposal] }] });
    expect(result).toMatchObject({ ok: false, refused: "cross-tenant-ref" });
    if (result.ok) return;
    expect(result.detail).toContain("roalloc_");
  });
});

describe("guardLabState — reference integrity with exact codes", () => {
  it("refuses an unknown world ref naming the run (unknown-world-ref)", () => {
    const slice = makeLabState();
    const run = slice.worldRuns[0]!;
    const output = { ...run.output, worldId: "world-nope" };
    const result = guardLabState({ ...slice, worldRuns: [{ ...run, output }] });
    expect(result).toMatchObject({ ok: false, refused: "unknown-world-ref" });
    if (result.ok) return;
    expect(result.detail).toContain("world-nope");
  });

  it("refuses a report whose setDigest does not resolve to its set (unknown-benchmark-ref)", () => {
    const slice = makeLabState();
    const bench = slice.benchmarks[0]!;
    const report = { ...bench.report, setDigest: "bench-set-nope" };
    const result = guardLabState({ ...slice, benchmarks: [{ ...bench, report }] });
    expect(result).toMatchObject({ ok: false, refused: "unknown-benchmark-ref" });
    if (result.ok) return;
    expect(result.detail).toContain("bench-run-clean");
  });

  it("refuses a role-allocation proposal for a foreign organization (unknown-organization-ref)", () => {
    const slice = makeLabState();
    const opt = slice.optimizations[0]!;
    const proposal = { ...opt.roleAllocations[0]!, organizationId: "org-other" };
    const result = guardLabState({ ...slice, optimizations: [{ ...opt, roleAllocations: [proposal] }] });
    expect(result).toMatchObject({ ok: false, refused: "unknown-organization-ref" });
  });

  it("refuses a what-if for a foreign organization (unknown-organization-ref)", () => {
    const slice = makeLabState();
    const opt = slice.optimizations[0]!;
    const whatIf = { ...opt.whatIfs[0]!, organizationId: "org-other" };
    const result = guardLabState({ ...slice, optimizations: [{ ...opt, whatIfs: [whatIf] }] });
    expect(result).toMatchObject({ ok: false, refused: "unknown-organization-ref" });
  });

  it("refuses a tampered world journal through the lane's OWN verifier (journal-invalid)", () => {
    const run = makeWorldRun(6, LAB_TENANT);
    const events = run.events.map((e, i) => (i === 1 ? { ...e, digest: "deadbeef" } : e));
    const slice: LabStateSlice = {
      tenantId: LAB_TENANT,
      now: 1,
      worlds: [run.world],
      worldRuns: [{ scenario: run.scenario, output: run.output, events }],
      benchmarks: [],
      optimizations: [],
    };
    const result = guardLabState(slice);
    expect(result).toMatchObject({ ok: false, refused: "journal-invalid" });
    if (result.ok) return;
    expect(result.detail).toContain("run-world-lab-main-scenario-lab-1");
  });

  it("refuses duplicate world ids (duplicate-world)", () => {
    const slice = makeLabState();
    const result = guardLabState({ ...slice, worlds: [...slice.worlds, ...slice.worlds] });
    expect(result).toMatchObject({ ok: false, refused: "duplicate-world" });
  });

  it("refuses duplicate benchmark report ids (duplicate-report)", () => {
    const slice = makeLabState();
    const result = guardLabState({ ...slice, benchmarks: [...slice.benchmarks, ...slice.benchmarks] });
    expect(result).toMatchObject({ ok: false, refused: "duplicate-report" });
  });
});

describe("lab state digest", () => {
  it("verifies and detects tampering", () => {
    const guarded = guardLabState(makeLabState());
    expect(guarded.ok).toBe(true);
    if (!guarded.ok) return;
    const digest = labStateDigestOf(guarded.slice);
    expect(verifyLabStateDigest(guarded.slice, digest)).toBe(true);
    const tampered = { ...guarded.slice, now: guarded.slice.now + 1 };
    expect(verifyLabStateDigest(tampered, digest)).toBe(false);
  });

  it("is stable across independent guard runs (determinism)", () => {
    const a = guardLabState(makeLabState());
    const b = guardLabState(makeLabState());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(labStateDigestOf(a.slice)).toBe(labStateDigestOf(b.slice));
  });
});
