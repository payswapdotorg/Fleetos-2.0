/**
 * Arena case-registry tests — intake validation, digest dedupe, capability
 * correlation, case-set assembly + tamper detection (Wave 5, F250B).
 */
import { describe, it, expect } from "vitest";
import {
  intakeCases,
  caseDigest,
  correlateByCapability,
  assembleCaseSet,
  verifyCaseSetDigest,
  type CaseIntakeCandidate,
  type RegistryCase,
} from "../src/index.ts";

const tenant = { tenantId: "t1" };
const foreign = { tenantId: "t2" };
const cap = { capabilityId: "cap.test", version: "1.0.0" };
const otherCap = { capabilityId: "cap.other", version: "2.0.0" };

function candidate(i: number, overrides: Partial<CaseIntakeCandidate<number>> = {}): CaseIntakeCandidate<number> {
  return {
    caseId: `c${i}`,
    tenant,
    capability: cap,
    inputs: { x: i },
    expected: i,
    description: `case ${i}`,
    tags: ["unit"],
    source: `suite-${i % 2}`,
    submittedAtMs: 1000 + i,
    ...overrides,
  };
}

function registered(n: number): RegistryCase<number>[] {
  const r = intakeCases(Array.from({ length: n }, (_, i) => candidate(i)), tenant);
  if (!r.ok) throw new Error(`fixture intake failed: ${JSON.stringify(r)}`);
  return [...r.cases];
}

describe("case intake: validation (fail-closed)", () => {
  it("accepts valid candidates and stamps provenance on every case", () => {
    const r = intakeCases([candidate(0), candidate(1)], tenant);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cases).toHaveLength(2);
      expect(r.cases[0]!.provenance.source).toBe("suite-0");
      expect(r.cases[0]!.provenance.submittedAtMs).toBe(1000);
      expect(r.cases[0]!.provenance.capability).toEqual(cap);
      expect(r.cases[0]!.provenance.caseDigest).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("rejects an empty registry tenant", () => {
    const r = intakeCases([candidate(0)], { tenantId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing-tenant");
  });

  it("rejects a cross-tenant case naming the offender", () => {
    const r = intakeCases([candidate(0), candidate(1, { tenant: foreign })], tenant);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("cross-tenant-case");
      expect(r.reason).toContain("c1");
      expect(r.reason).toContain("t2");
    }
  });

  it("rejects an empty caseId", () => {
    const r = intakeCases([candidate(0, { caseId: "" })], tenant);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("empty-case-id");
  });

  it("rejects an empty provenance source", () => {
    const r = intakeCases([candidate(0, { source: "" })], tenant);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("empty-source");
  });

  it("rejects non-integer and negative submittedAtMs", () => {
    expect(intakeCases([candidate(0, { submittedAtMs: 1.5 })], tenant)).toMatchObject({ ok: false, code: "invalid-submitted-at" });
    expect(intakeCases([candidate(0, { submittedAtMs: -1 })], tenant)).toMatchObject({ ok: false, code: "invalid-submitted-at" });
  });

  it("rejects non-string tags", () => {
    const bad = { ...candidate(0), tags: ["ok", 42 as unknown as string] };
    const r = intakeCases([bad], tenant);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid-tags");
  });

  it("rejects the same caseId with different content", () => {
    const r = intakeCases([candidate(0), candidate(0, { expected: 999 })], tenant);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("duplicate-case-id");
      expect(r.reason).toContain("c0");
    }
  });
});

describe("case digest + dedupe", () => {
  it("is deterministic and order/tag-normalized", () => {
    const a = candidate(0);
    const b = candidate(0, { tags: ["alpha", "unit", "alpha"] });
    const c = candidate(0, { tags: ["unit", "alpha"] });
    expect(caseDigest(b)).toBe(caseDigest(c));
    expect(caseDigest(a)).not.toBe(caseDigest(candidate(0, { expected: 1 })));
  });

  it("dedupes exact duplicates by digest and reports them", () => {
    const r = intakeCases([candidate(0), candidate(1), candidate(0)], tenant);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cases.map((c) => c.caseId)).toEqual(["c0", "c1"]);
      expect(r.duplicates).toEqual(["c0"]);
    }
  });

  it("dedupe is order-independent (reversed input, same result)", () => {
    const list = [candidate(0), candidate(1), candidate(2), candidate(0)];
    const a = intakeCases(list, tenant);
    const b = intakeCases([...list].reverse(), tenant);
    expect(a).toEqual(b);
  });

  it("produces cases ordered by caseId regardless of input order", () => {
    const r = intakeCases([candidate(2), candidate(0), candidate(1)], tenant);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.cases.map((c) => c.caseId)).toEqual(["c0", "c1", "c2"]);
  });
});

describe("capability correlation", () => {
  it("groups by capability version in deterministic order", () => {
    const r = intakeCases(
      [candidate(0, { capability: otherCap }), candidate(1), candidate(2, { capability: otherCap })],
      tenant,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const groups = correlateByCapability(r.cases);
      expect(groups.map((g) => g.capability.capabilityId)).toEqual(["cap.other", "cap.test"]);
      expect(groups[1]!.cases.map((c) => c.caseId)).toEqual(["c1"]);
      expect(groups[0]!.cases.map((c) => c.caseId)).toEqual(["c0", "c2"]);
    }
  });
});

describe("case-set assembly", () => {
  it("assembles with deterministic ordering, digest and sorted sources", () => {
    const cases = registered(3);
    const r = assembleCaseSet([...cases].reverse(), { tenant, capability: cap, assembledAtMs: 5000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const set = r.caseSet;
      expect(set.cases.map((c) => c.caseId)).toEqual(["c0", "c1", "c2"]);
      expect(set.caseCount).toBe(3);
      expect(set.sources).toEqual(["suite-0", "suite-1"]);
      expect(set.caseSetDigest).toMatch(/^[0-9a-f]{8}$/);
      expect(verifyCaseSetDigest(set)).toBe(true);
    }
  });

  it("is deterministic — reversed input gives the identical case set", () => {
    const cases = registered(4);
    const a = assembleCaseSet(cases, { tenant, capability: cap, assembledAtMs: 5000 });
    const b = assembleCaseSet([...cases].reverse(), { tenant, capability: cap, assembledAtMs: 5000 });
    expect(a).toEqual(b);
  });

  it("rejects an empty case set", () => {
    const r = assembleCaseSet([], { tenant, capability: cap, assembledAtMs: 5000 });
    expect(r).toMatchObject({ ok: false, code: "empty-case-set" });
  });

  it("rejects an empty tenant", () => {
    const r = assembleCaseSet(registered(1), { tenant: { tenantId: "" }, capability: cap, assembledAtMs: 5000 });
    expect(r).toMatchObject({ ok: false, code: "missing-tenant" });
  });

  it("rejects a capability mismatch naming the offender", () => {
    const r = assembleCaseSet(registered(2), { tenant, capability: otherCap, assembledAtMs: 5000 });
    expect(r).toMatchObject({ ok: false, code: "capability-mismatch" });
    if (!r.ok) expect(r.reason).toContain("c0");
  });
});

describe("case-set tamper detection", () => {
  function built(n: number) {
    const cases = registered(n);
    const r = assembleCaseSet(cases, { tenant, capability: cap, assembledAtMs: 5000 });
    if (!r.ok) throw new Error("fixture set failed");
    return r.caseSet;
  }

  it("detects a tampered case content (description edit)", () => {
    const set = built(2);
    const tampered = {
      ...set,
      cases: [{ ...set.cases[0]!, description: "EVIL" }, set.cases[1]!],
    };
    expect(verifyCaseSetDigest(tampered)).toBe(false);
    expect(verifyCaseSetDigest(set)).toBe(true);
  });

  it("detects a removed case and a forged set digest", () => {
    const set = built(2);
    expect(verifyCaseSetDigest({ ...set, cases: [set.cases[0]!] })).toBe(false);
    expect(verifyCaseSetDigest({ ...set, caseSetDigest: "deadbeef" })).toBe(false);
    expect(verifyCaseSetDigest({ ...set, assembledAtMs: 6000 })).toBe(false);
  });
});
