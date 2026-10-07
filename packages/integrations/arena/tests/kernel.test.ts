/**
 * Arena kernel tests — degraded states, adoption proposals, no-submit.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateWithDegradation,
  makeHonestReferenceArenaAdapter,
  assertNoSubmitOrAdopt,
  generateArenaAdoptionProposal,
  isArenaAdoptionProposal,
  makeReferenceArenaAdapter,
  isArenaEvaluationProposal,
} from "../src/index.ts";
import type { ArenaEvaluationRequest, TenantScopeLike, CapabilityVersionRef } from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };
const cap: CapabilityVersionRef = { capabilityId: "cap.test", version: "1.0.0" };

function makeRequest<T = unknown>(overrides: Partial<ArenaEvaluationRequest<T>> = {}): ArenaEvaluationRequest<T> {
  return {
    tenant,
    capability: cap,
    cases: [
      { caseId: "c1", tenant, capability: cap, inputs: {}, expected: 1 as T, description: "test", tags: [] },
    ],
    requester: "user-1",
    requestedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------- evaluateWithDegradation ----------

describe("evaluateWithDegradation", () => {
  it("returns ok=true with proposal when everything is OK", () => {
    const adapter = makeReferenceArenaAdapter();
    const result = evaluateWithDegradation(adapter, makeRequest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.kind).toBe("ARENA_PROPOSAL");
      expect(result.proposal.caseIds).toEqual(["c1"]);
    }
  });

  it("returns degraded=capability_missing when capabilityId is empty", () => {
    const adapter = makeReferenceArenaAdapter();
    const result = evaluateWithDegradation(adapter, makeRequest({
      capability: { capabilityId: "", version: "1.0.0" },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("capability_missing");
    }
  });

  it("returns degraded=empty_case_set when cases are empty", () => {
    const adapter = makeReferenceArenaAdapter();
    const result = evaluateWithDegradation(adapter, makeRequest({ cases: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.degraded).toBe("empty_case_set");
    }
  });
});

// ---------- makeHonestReferenceArenaAdapter ----------

describe("makeHonestReferenceArenaAdapter", () => {
  it("produces a proposal for valid requests", () => {
    const adapter = makeHonestReferenceArenaAdapter();
    const proposal = adapter.evaluate(makeRequest());
    expect(proposal.kind).toBe("ARENA_PROPOSAL");
    expect(proposal.caseIds).toEqual(["c1"]);
  });
});

// ---------- assertNoSubmitOrAdopt ----------

describe("assertNoSubmitOrAdopt", () => {
  it("returns ok=true for the arena module surface", () => {
    const moduleExports = { makeReferenceArenaAdapter: () => {}, evaluateWithDegradation: () => {} };
    const probe = assertNoSubmitOrAdopt(moduleExports);
    expect(probe.ok).toBe(true);
  });

  it("catches forbidden submit/adopt/authorize", () => {
    const badExports = { submit: () => {}, adopt: () => {}, authorize: () => {} };
    const probe = assertNoSubmitOrAdopt(badExports);
    expect(probe.ok).toBe(false);
    expect(probe.forbidden).toContain("submit");
    expect(probe.forbidden).toContain("adopt");
    expect(probe.forbidden).toContain("authorize");
  });
});

// ---------- generateArenaAdoptionProposal ----------

describe("generateArenaAdoptionProposal", () => {
  it("generates a proposal with kind ARENA_ADOPTION_PROPOSAL", () => {
    const adapter = makeReferenceArenaAdapter();
    const evalProposal = adapter.evaluate(makeRequest());
    const adoptProposal = generateArenaAdoptionProposal(evalProposal, "good results", "2026-01-01T00:00:00.000Z");
    expect(adoptProposal.kind).toBe("ARENA_ADOPTION_PROPOSAL");
    expect(adoptProposal.proposalId).toContain("arena-adopt-");
    expect(adoptProposal.arenaProposalRef).toBe(evalProposal.proposalId);
  });

  it("isArenaAdoptionProposal guard works", () => {
    const adapter = makeReferenceArenaAdapter();
    const evalProposal = adapter.evaluate(makeRequest());
    const adoptProposal = generateArenaAdoptionProposal(evalProposal, "test", "t");
    expect(isArenaAdoptionProposal(adoptProposal)).toBe(true);
    expect(isArenaAdoptionProposal({ kind: "WRONG" })).toBe(false);
    expect(isArenaAdoptionProposal(null)).toBe(false);
  });
});

// ---------- isArenaEvaluationProposal ----------

describe("isArenaEvaluationProposal", () => {
  it("validates a well-formed proposal", () => {
    const adapter = makeReferenceArenaAdapter();
    const proposal = adapter.evaluate(makeRequest());
    expect(isArenaEvaluationProposal(proposal)).toBe(true);
  });

  it("rejects non-proposal values", () => {
    expect(isArenaEvaluationProposal(null)).toBe(false);
    expect(isArenaEvaluationProposal({})).toBe(false);
    expect(isArenaEvaluationProposal({ kind: "WRONG" })).toBe(false);
  });
});
