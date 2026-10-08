/**
 * F260B — benchmark-definition tests: case/set definition, digests, tenant
 * fail-closed, deterministic ordering.
 */
import { describe, it, expect } from "vitest";
import {
  assembleBenchmarkSet,
  benchmarkCaseDigest,
  defineBenchmarkCase,
  verifyBenchmarkSetDigest,
} from "../src/benchmark-definition.ts";
import type { BenchmarkSet } from "../src/benchmark-definition.ts";
import { buildComparison } from "../src/index.ts";
import {
  CONTEXT_FIELDS,
  ENVELOPE,
  INVOCATION,
  OTHER_TENANT,
  TENANT,
  buildJournal,
  standardCase,
  standardJournal,
  steepCase,
} from "./benchmark-fixtures.ts";

describe("defineBenchmarkCase: validation", () => {
  it("defines a valid case with a digest + journal-head provenance", () => {
    const c = standardCase();
    const head = c.journal[c.journal.length - 1];
    expect(c.kind).toBe("BENCHMARK_CASE");
    expect(c.caseDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(c.entityType).toBe("asset");
    expect(head?.digest).toBeTruthy();
    expect(c.invocation.modelVersion).toBe(INVOCATION.modelVersion);
  });

  it("is byte-identical for identical inputs (determinism)", () => {
    expect(JSON.stringify(standardCase())).toBe(JSON.stringify(standardCase()));
  });

  it("expected-outcome input order never changes the case digest", () => {
    const a = standardCase();
    const res = defineBenchmarkCase({
      caseId: "case-standard",
      tenant: TENANT,
      entityId: "e1",
      journal: standardJournal(),
      invocation: INVOCATION,
      expectedOutcomes: [...a.expectedOutcomes].reverse(),
      envelope: ENVELOPE,
      contextFields: CONTEXT_FIELDS,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.benchmarkCase.caseDigest).toBe(a.caseDigest);
  });

  it("rejects every malformed-input code fail-closed", () => {
    const base = {
      caseId: "c",
      tenant: TENANT,
      entityId: "e1",
      journal: standardJournal(),
      invocation: INVOCATION,
      expectedOutcomes: [{ replaySeq: 4, step: 1, atMs: 4000, value: 40, observationRef: "r" }],
      envelope: ENVELOPE,
      contextFields: CONTEXT_FIELDS,
    };
    expect(defineBenchmarkCase({ ...base, tenant: { tenantId: "" } })).toMatchObject({ ok: false, rejected: "missing-tenant" });
    expect(defineBenchmarkCase({ ...base, caseId: "" })).toMatchObject({ ok: false, rejected: "missing-case-id" });
    expect(defineBenchmarkCase({ ...base, entityId: "" })).toMatchObject({ ok: false, rejected: "missing-entity" });
    expect(defineBenchmarkCase({ ...base, invocation: { ...INVOCATION, metric: "" } })).toMatchObject({ ok: false, rejected: "invalid-invocation" });
    expect(defineBenchmarkCase({ ...base, invocation: { ...INVOCATION, horizon: { steps: 0, stepMs: 1000 } } })).toMatchObject({ ok: false, rejected: "invalid-horizon" });
    expect(defineBenchmarkCase({ ...base, invocation: { ...INVOCATION, horizon: { steps: 1001, stepMs: 1000 } } })).toMatchObject({ ok: false, rejected: "invalid-horizon" });
    expect(defineBenchmarkCase({ ...base, journal: [] })).toMatchObject({ ok: false, rejected: "empty-journal" });
    expect(defineBenchmarkCase({ ...base, entityId: "nope" })).toMatchObject({ ok: false, rejected: "unknown-entity" });
    expect(defineBenchmarkCase({ ...base, contextFields: {} })).toMatchObject({ ok: false, rejected: "invalid-context-fields" });
    expect(defineBenchmarkCase({ ...base, envelope: { ...ENVELOPE, maxAbsValue: 0 } })).toMatchObject({ ok: false, rejected: "invalid-envelope" });
    expect(defineBenchmarkCase({ ...base, envelope: { ...ENVELOPE, minConfidenceBps: 10001 } })).toMatchObject({ ok: false, rejected: "invalid-envelope" });
    expect(defineBenchmarkCase({ ...base, envelope: { ...ENVELOPE, perturbationOffset: 0 } })).toMatchObject({ ok: false, rejected: "invalid-envelope" });
    expect(defineBenchmarkCase({ ...base, expectedOutcomes: [] })).toMatchObject({ ok: false, rejected: "missing-expected-outcomes" });
    expect(defineBenchmarkCase({ ...base, expectedOutcomes: [{ replaySeq: 0, step: 1, atMs: 4000, value: 1, observationRef: "r" }] })).toMatchObject({ ok: false, rejected: "invalid-expected-outcome" });
    expect(defineBenchmarkCase({ ...base, expectedOutcomes: [{ replaySeq: 4, step: 4, atMs: 4000, value: 1, observationRef: "r" }] })).toMatchObject({ ok: false, rejected: "invalid-expected-outcome" });
    expect(defineBenchmarkCase({ ...base, expectedOutcomes: [{ replaySeq: 4, step: 1, atMs: 4100, value: 1, observationRef: "r" }] })).toMatchObject({ ok: false, rejected: "expected-time-mismatch" });
    expect(defineBenchmarkCase({ ...base, expectedOutcomes: [
      { replaySeq: 4, step: 1, atMs: 4000, value: 1, observationRef: "r" },
      { replaySeq: 4, step: 1, atMs: 4000, value: 2, observationRef: "r2" },
    ] })).toMatchObject({ ok: false, rejected: "duplicate-expected-step" });
  });

  it("rejects a tampered digest chain (journal-invalid) fail-closed", () => {
    const journal = standardJournal();
    const tampered = journal.map((e, i) => (i === 2 ? { ...e, event: { ...e.event, value: 99 } } : e));
    const res = defineBenchmarkCase({
      caseId: "c", tenant: TENANT, entityId: "e1", journal: tampered, invocation: INVOCATION,
      expectedOutcomes: [{ replaySeq: 4, step: 1, atMs: 4000, value: 40, observationRef: "r" }],
      envelope: ENVELOPE, contextFields: CONTEXT_FIELDS,
    });
    expect(res).toMatchObject({ ok: false, rejected: "journal-invalid" });
  });

  it("rejects a journal from another tenant (tenant-mismatch, fail-closed)", () => {
    const foreign = buildJournal(OTHER_TENANT.tenantId, [
      { atMs: 1000, event: { kind: "entity-registered", entityId: "e1", entityType: "asset" } },
      { atMs: 1000, event: { kind: "observation-recorded", entityId: "e1", entityType: "asset", observationRef: "o", observedAtMs: 1000, value: 1 } },
    ]);
    const res = defineBenchmarkCase({
      caseId: "c", tenant: TENANT, entityId: "e1", journal: foreign, invocation: INVOCATION,
      expectedOutcomes: [{ replaySeq: 2, step: 1, atMs: 2000, value: 1, observationRef: "r" }],
      envelope: ENVELOPE, contextFields: CONTEXT_FIELDS,
    });
    expect(res).toMatchObject({ ok: false, rejected: "tenant-mismatch" });
  });

  it("rejects an entity with no observations (empty-history)", () => {
    const journal = buildJournal(TENANT.tenantId, [
      { atMs: 1000, event: { kind: "entity-registered", entityId: "e1", entityType: "asset" } },
    ]);
    const res = defineBenchmarkCase({
      caseId: "c", tenant: TENANT, entityId: "e1", journal, invocation: INVOCATION,
      expectedOutcomes: [{ replaySeq: 1, step: 1, atMs: 2000, value: 1, observationRef: "r" }],
      envelope: ENVELOPE, contextFields: CONTEXT_FIELDS,
    });
    expect(res).toMatchObject({ ok: false, rejected: "empty-history" });
  });
});

describe("assembleBenchmarkSet", () => {
  it("orders cases deterministically and digests the set", () => {
    const a = standardCase();
    const b = steepCase();
    const res = assembleBenchmarkSet({ tenant: TENANT, cases: [b, a], assembledAtMs: 1000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.set.cases.map((c) => c.caseId)).toEqual(["case-standard", "case-steep"]);
    expect(res.set.caseDigests).toEqual([a.caseDigest, b.caseDigest]);
    expect(res.set.modelVersions).toEqual([INVOCATION.modelVersion]);
    expect(res.set.setDigest).toMatch(/^[0-9a-f]{8}$/);
    // Reversed input => byte-identical set.
    const res2 = assembleBenchmarkSet({ tenant: TENANT, cases: [a, b], assembledAtMs: 1000 });
    expect(JSON.stringify(res2.ok ? res2.set : null)).toBe(JSON.stringify(res.set));
  });

  it("rejects empty sets, cross-tenant cases, duplicate ids, bad times", () => {
    expect(assembleBenchmarkSet({ tenant: TENANT, cases: [], assembledAtMs: 1 })).toMatchObject({ ok: false, rejected: "empty-set" });
    expect(assembleBenchmarkSet({ tenant: TENANT, cases: [standardCase(), steepCase()], assembledAtMs: -1 })).toMatchObject({ ok: false, rejected: "invalid-assembled-at" });
    const otherTenantCase = { ...standardCase(), tenant: OTHER_TENANT };
    const res = assembleBenchmarkSet({ tenant: TENANT, cases: [otherTenantCase], assembledAtMs: 1 });
    expect(res).toMatchObject({ ok: false, rejected: "cross-tenant-case" });
    if (!res.ok) expect(res.detail).toContain("case-standard");
    const dup = assembleBenchmarkSet({ tenant: TENANT, cases: [standardCase(), standardCase()], assembledAtMs: 1 });
    expect(dup).toMatchObject({ ok: false, rejected: "duplicate-case-id" });
  });
});

describe("verifyBenchmarkSetDigest: two-level tamper detection", () => {
  let set: BenchmarkSet;
  it("verifies an honest set", () => {
    const res = assembleBenchmarkSet({ tenant: TENANT, cases: [standardCase(), steepCase()], assembledAtMs: 1000 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      set = res.set;
      expect(verifyBenchmarkSetDigest(set)).toBe(true);
    }
  });

  it("detects member-content tampering (envelope edit)", () => {
    const tampered: BenchmarkSet = {
      ...set,
      cases: set.cases.map((c, i) => (i === 0 ? { ...c, envelope: { ...c.envelope, maxAbsValue: 42 } } : c)),
    };
    expect(verifyBenchmarkSetDigest(tampered)).toBe(false);
  });

  it("detects case removal, set-digest forgery and assembly-time edits", () => {
    expect(verifyBenchmarkSetDigest({ ...set, cases: set.cases.slice(0, 1), caseDigests: set.caseDigests.slice(0, 1) })).toBe(false);
    expect(verifyBenchmarkSetDigest({ ...set, setDigest: "deadbeef" })).toBe(false);
    expect(verifyBenchmarkSetDigest({ ...set, assembledAtMs: 2000 })).toBe(false);
  });

  it("recomputes the case digest from stored content (benchmarkCaseDigest)", () => {
    const c = standardCase();
    const { caseDigest, ...rest } = c;
    expect(benchmarkCaseDigest(rest)).toBe(caseDigest);
    expect(benchmarkCaseDigest({ ...rest, caseId: "other" })).not.toBe(caseDigest);
  });
});

describe("F260B conventions", () => {
  it("extends the existing buildComparison convention (kernel export unchanged)", () => {
    const cmp = buildComparison(["r2", "r1"], "aggregate-bps", "t0");
    expect(cmp.comparisonId).toBe("cmp-r1,r2");
  });
});
