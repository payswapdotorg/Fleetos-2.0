import { describe, it, expect } from "vitest";
import {
  isArenaEvaluationProposal,
  makeReferenceArenaAdapter,
  type ArenaEvaluationRequest,
  type EvaluationCase,
} from "../src/index.ts";

const tenant = { tenantId: "t1" };
const cap = { capabilityId: "cap.test", version: "1.0.0" };

function cases(n: number): readonly EvaluationCase<number>[] {
  return Array.from({ length: n }, (_, i) => ({
    caseId: `c${i}`,
    tenant,
    capability: cap,
    inputs: { x: i },
    expected: i,
    description: `case ${i}`,
    tags: [],
  }));
}

function request(): ArenaEvaluationRequest<number> {
  return {
    tenant,
    capability: cap,
    cases: cases(3),
    requester: "u1",
    requestedAt: "0",
  };
}

describe("reference arena adapter: never submits", () => {
  it("returns an ArenaEvaluationProposal, not an outcome or authorization", () => {
    const a = makeReferenceArenaAdapter();
    const out = a.evaluate(request());
    expect(out.kind).toBe("ARENA_PROPOSAL");
    expect(out.proposalId).toContain("arena-prop-");
    expect(out.caseIds).toEqual(["c0", "c1", "c2"]);
  });

  it("the adapter has NO submit/adopt/authorize method", () => {
    const a = makeReferenceArenaAdapter() as unknown as Record<string, unknown>;
    expect(a.submit).toBeUndefined();
    expect(a.adopt).toBeUndefined();
    expect(a.authorize).toBeUndefined();
    expect(typeof a.evaluate).toBe("function");
  });
});

describe("reference arena adapter: determinism", () => {
  it("produces identical proposals for identical requests", () => {
    const a = makeReferenceArenaAdapter();
    const r1 = a.evaluate(request());
    const r2 = a.evaluate(request());
    expect(r1).toEqual(r2);
  });

  it("produces stable proposal IDs across instances", () => {
    const a1 = makeReferenceArenaAdapter();
    const a2 = makeReferenceArenaAdapter();
    expect(a1.evaluate(request()).proposalId).toBe(a2.evaluate(request()).proposalId);
  });
});

describe("ArenaEvaluationProposal: type-distinct from outcome/authorization", () => {
  it("is not assignable to a Learning OutcomeObservation shape", () => {
    const out = makeReferenceArenaAdapter().evaluate(request());
    // Compile-time: out.kind is "ARENA_PROPOSAL", incompatible with { kind: "OBSERVED" }.
    // @ts-expect-error — ARENA_PROPOSAL is not an outcome observation
    const _bad: { kind: "OBSERVED" } = out;
    void _bad;
  });
});

describe("isArenaEvaluationProposal runtime guard", () => {
  it("returns true for an actual proposal", () => {
    const out = makeReferenceArenaAdapter().evaluate(request());
    expect(isArenaEvaluationProposal(out)).toBe(true);
  });

  it("returns false for foreign-shaped objects", () => {
    expect(isArenaEvaluationProposal({ kind: "OBSERVED" })).toBe(false);
    expect(isArenaEvaluationProposal(null)).toBe(false);
    expect(isArenaEvaluationProposal(42)).toBe(false);
  });
});

describe("arena adapter: tenant carried through", () => {
  it("proposal carries the tenant from the request", () => {
    const out = makeReferenceArenaAdapter().evaluate(request());
    expect(out.tenant.tenantId).toBe("t1");
  });

  it("proposal carries the capability version", () => {
    const out = makeReferenceArenaAdapter().evaluate(request());
    expect(out.capability.capabilityId).toBe("cap.test");
    expect(out.capability.version).toBe("1.0.0");
  });
});

describe("arena adapter: empty case set", () => {
  it("still produces a valid proposal with empty caseIds", () => {
    const req: ArenaEvaluationRequest<number> = { ...request(), cases: [] };
    const out = makeReferenceArenaAdapter().evaluate(req);
    expect(out.caseIds).toEqual([]);
    expect(isArenaEvaluationProposal(out)).toBe(true);
  });
});
