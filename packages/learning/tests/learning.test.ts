import { describe, it, expect } from "vitest";
import {
  evaluateCapability,
  markProposalAuthorized,
  markProposalRejected,
  proposeAdoption,
  type CapabilityAdoptionProposal,
  type CapabilityVersionRef,
  type EvaluationCase,
  type OutcomeObservation,
  type TenantScopeLike,
} from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };
const cap: CapabilityVersionRef = { capabilityId: "cap.test", version: "1.0.0" };

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

function outcomes(cases: readonly EvaluationCase<number>[], success: boolean): readonly OutcomeObservation<number>[] {
  return cases.map((c) => ({
    observationId: `o-${c.caseId}`,
    caseId: c.caseId,
    actual: success ? c.expected : -1,
    observedAt: "0",
    observationRef: `obsref-${c.caseId}`,
    success,
  }));
}

describe("evaluateCapability", () => {
  it("counts successes and failures correctly", () => {
    const cs = cases(5);
    const eval_ = evaluateCapability(cs, outcomes(cs, true), tenant, cap);
    expect(eval_.totalCases).toBe(5);
    expect(eval_.successes).toBe(5);
    expect(eval_.failures).toBe(0);
    expect(eval_.successRate).toBe(1);
  });

  it("returns successRate=0 when there are no cases", () => {
    const eval_ = evaluateCapability([], [], tenant, cap);
    expect(eval_.successRate).toBe(0);
    expect(eval_.totalCases).toBe(0);
  });

  it("treats missing outcomes as failures", () => {
    const cs = cases(3);
    const eval_ = evaluateCapability(cs, [outcomes(cs, true)[0]!], tenant, cap);
    expect(eval_.successes).toBe(1);
    expect(eval_.failures).toBe(2);
  });

  it("is deterministic — same inputs => same evaluationId", () => {
    const cs = cases(3);
    const a = evaluateCapability(cs, outcomes(cs, true), tenant, cap);
    const b = evaluateCapability(cs, outcomes(cs, true), tenant, cap);
    expect(a).toEqual(b);
  });

  it("carries outcome refs for traceability", () => {
    const cs = cases(2);
    const eval_ = evaluateCapability(cs, outcomes(cs, true), tenant, cap);
    expect(eval_.outcomeRefs).toEqual(["obsref-c0", "obsref-c1"]);
  });
});

describe("proposeAdoption: never auto-adopts", () => {
  it("returns a proposal with status=pending", () => {
    const cs = cases(3);
    const eval_ = evaluateCapability(cs, outcomes(cs, true), tenant, cap);
    const p = proposeAdoption({
      tenant, capability: cap, evaluation: eval_, proposedBy: "u1", rationale: "high success rate", proposedAt: "0",
    });
    expect(p.status).toBe("pending");
    expect(p.evaluationRef).toBe(eval_.evaluationId);
  });

  it("produces a stable proposalId for the same capability+tenant", () => {
    const cs = cases(3);
    const eval_ = evaluateCapability(cs, outcomes(cs, true), tenant, cap);
    const a = proposeAdoption({ tenant, capability: cap, evaluation: eval_, proposedBy: "u1", rationale: "x", proposedAt: "0" });
    const b = proposeAdoption({ tenant, capability: cap, evaluation: eval_, proposedBy: "u2", rationale: "y", proposedAt: "1" });
    expect(a.proposalId).toBe(b.proposalId);
  });

  it("markProposalAuthorized only changes status — does not auto-execute anything", () => {
    const cs = cases(3);
    const eval_ = evaluateCapability(cs, outcomes(cs, true), tenant, cap);
    const p = proposeAdoption({ tenant, capability: cap, evaluation: eval_, proposedBy: "u1", rationale: "x", proposedAt: "0" });
    const authorized = markProposalAuthorized(p);
    expect(authorized.status).toBe("authorized");
    // Original is unchanged (immutable)
    expect(p.status).toBe("pending");
  });

  it("markProposalRejected produces a rejected proposal", () => {
    const p: CapabilityAdoptionProposal = {
      proposalId: "p1",
      tenant,
      capability: cap,
      evaluationRef: "e1",
      proposedAt: "0",
      proposedBy: "u1",
      rationale: "x",
      status: "pending",
    };
    expect(markProposalRejected(p).status).toBe("rejected");
  });
});

describe("learning package: no auto-adoption", () => {
  it("does NOT export an `adopt` function", async () => {
    const mod = await import("../src/index.ts");
    expect((mod as unknown as Record<string, unknown>).adopt).toBeUndefined();
  });
});
