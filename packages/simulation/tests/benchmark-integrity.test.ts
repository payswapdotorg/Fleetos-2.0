/**
 * Benchmark-integrity tests (F280B, Wave 8 lane B).
 *
 * Behavior under test: positioned tamper detection over REAL benchmark sets
 * (assembled through the REAL defineBenchmarkCase + assembleBenchmarkSet) —
 * every tamper form fails LOUDLY with the tamper position named (case index,
 * caseId, level, component), genuine sets verify, and the A8 cross-tenant
 * case is reported as the structural tenant tamper.
 */
import { describe, it, expect } from "vitest";
import { assembleBenchmarkSet } from "../src/benchmark-definition.ts";
import { verifyBenchmarkSetIntegrity, verifyBenchmarkCaseIntegrity } from "../src/benchmark-integrity.ts";
import type { BenchmarkSet } from "../src/benchmark-definition.ts";
import {
  TENANT,
  NOW_MS,
  standardCase,
  shortCase,
  steepCase,
  CONTEXT_FIELDS,
  buildJournal,
  INVOCATION,
  ENVELOPE,
  defineOrThrow,
} from "./benchmark-fixtures.ts";

function buildSet(): BenchmarkSet {
  const r = assembleBenchmarkSet({
    tenant: TENANT,
    cases: [standardCase(), shortCase(), steepCase()],
    assembledAtMs: NOW_MS,
  });
  if (!r.ok) throw new Error(`fixture set refused: ${r.rejected}/${r.detail}`);
  return r.set;
}

function mustVerify(v: ReturnType<typeof verifyBenchmarkSetIntegrity>) {
  if (!v.verified) throw new Error(`fixture failed integrity: ${v.tamper?.detail}`);
  return v;
}

describe("benchmark integrity — genuine sets verify", () => {
  it("a REAL assembled set verifies with every case checked", () => {
    const v = mustVerify(verifyBenchmarkSetIntegrity(buildSet()));
    expect(v.checkedCases).toBe(3);
    expect(v.tamper).toBeNull();
  });

  it("verification is deterministic", () => {
    const a = verifyBenchmarkSetIntegrity(buildSet());
    const b = verifyBenchmarkSetIntegrity(buildSet());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the per-case variant verifies a genuine case against its manifest row", () => {
    const set = buildSet();
    const v = verifyBenchmarkCaseIntegrity(set.cases[1]!, set.caseDigests[1]!);
    expect(v.verified).toBe(true);
  });
});

describe("benchmark integrity — positioned tamper detection", () => {
  it("an edited case FIELD fails at the case position with the caseId named", () => {
    const set = buildSet();
    const tampered: BenchmarkSet = {
      ...set,
      cases: set.cases.map((c, i) =>
        i === 1 ? { ...c, envelope: { ...c.envelope, maxAbsValue: 999 } } : c,
      ),
    };
    const v = verifyBenchmarkSetIntegrity(tampered);
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({
      level: "case-content", caseIndex: 1, caseId: "case-standard", component: "case-digest",
    });
  });

  it("an edited MANIFEST digest row fails at the case-manifest level", () => {
    const set = buildSet();
    const tampered: BenchmarkSet = {
      ...set,
      caseDigests: set.caseDigests.map((d, i) => (i === 0 ? "deadbeef" : d)),
    };
    const v = verifyBenchmarkSetIntegrity(tampered);
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({
      level: "case-manifest", caseIndex: 0, caseId: "case-short", component: "case-digests",
    });
  });

  it("a REMOVED case fails at the set-manifest level with both counts", () => {
    const set = buildSet();
    const tampered: BenchmarkSet = { ...set, cases: set.cases.slice(0, 2) };
    const v = verifyBenchmarkSetIntegrity(tampered);
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({ level: "set-manifest", component: "case-digests" });
    expect(v.tamper!.detail).toContain("3 digests for 2 cases");
  });

  it("a structural expected-outcome time edit fails with the exact law named", () => {
    const set = buildSet();
    const tampered: BenchmarkSet = {
      ...set,
      cases: set.cases.map((c, i) =>
        i === 0
          ? {
              ...c,
              expectedOutcomes: c.expectedOutcomes.map((o, j) =>
                j === 0 ? { ...o, atMs: o.atMs + 1_000 } : o,
              ),
            }
          : c,
      ),
    };
    const v = verifyBenchmarkSetIntegrity(tampered);
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({
      level: "case-structure", caseIndex: 0, caseId: "case-short", component: "expected-outcomes",
    });
    expect(v.tamper!.detail).toContain("!= journal");
  });

  it("an edited assembledAtMs fails at the set-digest level", () => {
    const set = buildSet();
    const tampered: BenchmarkSet = { ...set, assembledAtMs: set.assembledAtMs + 1 };
    const v = verifyBenchmarkSetIntegrity(tampered);
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({ level: "set-digest", component: "set-digest" });
    expect(v.tamper!.detail).toContain("assembledAtMs");
  });

  it("an edited model-versions manifest fails at the set-manifest level", () => {
    const set = buildSet();
    const tampered: BenchmarkSet = { ...set, modelVersions: ["tampered-version"] };
    const v = verifyBenchmarkSetIntegrity(tampered);
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({ level: "set-manifest", component: "model-versions" });
  });

  it("A8: a cross-tenant case is the structural TENANT tamper, offender named", () => {
    // Build a genuine case for another tenant, then smuggle it into the set
    // with the set's tenant stamp on the wrapper.
    const foreign = defineOrThrow({
      caseId: "case-foreign",
      tenant: { tenantId: "bench-t2" },
      entityId: "e1",
      journal: buildJournal("bench-t2", [
        { atMs: 1000, event: { kind: "entity-registered", entityId: "e1", entityType: "asset" } },
        { atMs: 1000, event: { kind: "observation-recorded", entityId: "e1", entityType: "asset", observationRef: "o1", observedAtMs: 1000, value: 10 } },
        { atMs: 2000, event: { kind: "observation-recorded", entityId: "e1", entityType: "asset", observationRef: "o2", observedAtMs: 2000, value: 20 } },
      ]),
      invocation: INVOCATION,
      expectedOutcomes: [{ replaySeq: 3, step: 1, atMs: 3000, value: 30, observationRef: "r1" }],
      envelope: ENVELOPE,
      contextFields: CONTEXT_FIELDS,
    });
    const set = buildSet();
    // The smuggled set claims the FIRST tenant but carries the foreign case
    // with a forged manifest row to pass layer 2.
    const smuggled: BenchmarkSet = {
      ...set,
      cases: [...set.cases, { ...foreign, tenant: TENANT }],
      caseDigests: [...set.caseDigests, foreign.caseDigest],
    };
    const v = verifyBenchmarkSetIntegrity(smuggled);
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({
      level: "case-structure", caseIndex: 3, caseId: "case-foreign", component: "tenant",
    });
    expect(v.tamper!.detail).toContain("bench-t2");
  });
});

describe("benchmark integrity — per-case variant", () => {
  it("pins a tampered case field in isolation", () => {
    const set = buildSet();
    const c = set.cases[0]!;
    const tampered = { ...c, contextFields: { ...c.contextFields, location: "bay-9" } };
    const v = verifyBenchmarkCaseIntegrity(tampered, set.caseDigests[0]!);
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({ level: "case-content", caseIndex: 0, caseId: c.caseId });
  });

  it("refuses a manifest row that disagrees with the case digest", () => {
    const set = buildSet();
    const v = verifyBenchmarkCaseIntegrity(set.cases[2]!, "forged-digest");
    expect(v.verified).toBe(false);
    expect(v.tamper).toMatchObject({ level: "case-manifest", caseIndex: 0, caseId: "case-steep" });
  });
});
