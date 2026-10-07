/**
 * Remediation proposal lifecycle tests (F220B, Wave 2).
 *
 * Behavior under test: legal-transition enforcement, evidence-gated
 * transitions (approval ref / verification evidence / verification outcome),
 * tenant fail-closed, post-mortem history verification.
 */
import { describe, it, expect } from "vitest";
import {
  proposeRemediationRecord,
  advanceRemediation,
  legalRemediationTransitions,
  verifyRemediationHistory,
} from "../src/index.ts";
import type { RemediationProposalRecord } from "../src/index.ts";

function makeRecord(overrides: { tenantId?: string } = {}): RemediationProposalRecord {
  const proposal = proposeRemediationRecord({
    proposalId: "rem-1",
    tenantId: overrides.tenantId ?? "t1",
    findingIds: ["f1", "f2"],
    remediationKind: "patch",
    at: 100,
  });
  if (!proposal.ok) throw new Error(proposal.reason);
  return proposal.record;
}

function ctx(overrides: Partial<{ tenantId: string; approvalRef: string; verificationEvidenceRef: string; verificationOutcome: { verified: boolean; evidenceRef: string }; at: number }> = {}) {
  return {
    tenantId: "t1",
    actorId: "actor-1",
    at: 200,
    ...overrides,
  };
}

describe("remediation construction", () => {
  it("refuses to propose without a tenant scope (fail-closed, A8)", () => {
    const r = proposeRemediationRecord({ proposalId: "rem-1", tenantId: "", findingIds: ["f1"], remediationKind: "patch", at: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.missing-tenant");
  });

  it("refuses a missing proposal id", () => {
    const r = proposeRemediationRecord({ proposalId: "", tenantId: "t1", findingIds: ["f1"], remediationKind: "patch", at: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.missing-proposal-id");
  });

  it("refuses an empty finding set", () => {
    const r = proposeRemediationRecord({ proposalId: "rem-1", tenantId: "t1", findingIds: [], remediationKind: "patch", at: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.empty-findings");
  });

  it("refuses a negative or non-integer at", () => {
    expect(proposeRemediationRecord({ proposalId: "r", tenantId: "t1", findingIds: ["f"], remediationKind: "patch", at: -1 }).ok).toBe(false);
    expect(proposeRemediationRecord({ proposalId: "r", tenantId: "t1", findingIds: ["f"], remediationKind: "patch", at: 1.5 }).ok).toBe(false);
  });

  it("proposes in the proposed state with no evidence attached", () => {
    const rec = makeRecord();
    expect(rec.state).toBe("proposed");
    expect(rec.approvalRef).toBeNull();
    expect(rec.verificationEvidenceRef).toBeNull();
    expect(rec.verificationOutcome).toBeNull();
    expect(rec.transitions).toHaveLength(0);
  });
});

describe("remediation legal transitions", () => {
  it("the legal transition table is exactly proposed->approved->applied->verified", () => {
    expect(legalRemediationTransitions("proposed")).toEqual(["approved"]);
    expect(legalRemediationTransitions("approved")).toEqual(["applied"]);
    expect(legalRemediationTransitions("applied")).toEqual(["verified"]);
    expect(legalRemediationTransitions("verified")).toEqual([]);
  });

  it("refuses skipping proposed -> applied (illegal even with evidence present)", () => {
    const rec = makeRecord();
    const r = advanceRemediation(rec, "applied", ctx({ verificationEvidenceRef: "ev-1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.illegal-transition");
  });

  it("refuses going backwards (applied -> approved)", () => {
    let rec = makeRecord();
    rec = advanceRemediation(rec, "approved", ctx({ approvalRef: "appr-1" })).record;
    rec = advanceRemediation(rec, "applied", ctx({ verificationEvidenceRef: "ev-1" })).record;
    const r = advanceRemediation(rec, "approved", ctx({ approvalRef: "appr-1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.illegal-transition");
  });

  it("refuses any transition from the terminal verified state", () => {
    let rec = makeRecord();
    rec = advanceRemediation(rec, "approved", ctx({ approvalRef: "a" })).record;
    rec = advanceRemediation(rec, "applied", ctx({ verificationEvidenceRef: "e" })).record;
    rec = advanceRemediation(rec, "verified", ctx({ verificationOutcome: { verified: true, evidenceRef: "e" } })).record;
    for (const target of ["proposed", "approved", "applied", "verified"] as const) {
      const r = advanceRemediation(rec, target, ctx({}));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("remediation.illegal-transition");
    }
  });
});

describe("remediation evidence gating", () => {
  it("refuses proposed -> approved without an approval ref (Guardian gate)", () => {
    const r = advanceRemediation(makeRecord(), "approved", ctx({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.missing-approval-ref");
  });

  it("refuses proposed -> approved with an EMPTY approval ref", () => {
    const r = advanceRemediation(makeRecord(), "approved", ctx({ approvalRef: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.missing-approval-ref");
  });

  it("refuses approved -> applied without a verification evidence ref", () => {
    const rec = advanceRemediation(makeRecord(), "approved", ctx({ approvalRef: "appr-1" })).record;
    const r = advanceRemediation(rec, "applied", ctx({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.missing-verification-evidence");
  });

  it("applies ONLY with a verification evidence ref attached", () => {
    const rec = advanceRemediation(makeRecord(), "approved", ctx({ approvalRef: "appr-1" })).record;
    const r = advanceRemediation(rec, "applied", ctx({ verificationEvidenceRef: "ev-42" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.state).toBe("applied");
      expect(r.record.verificationEvidenceRef).toBe("ev-42");
      expect(r.record.transitions).toHaveLength(2);
    }
  });

  it("refuses applied -> verified without a verification outcome", () => {
    let rec = makeRecord();
    rec = advanceRemediation(rec, "approved", ctx({ approvalRef: "a" })).record;
    rec = advanceRemediation(rec, "applied", ctx({ verificationEvidenceRef: "e" })).record;
    const r = advanceRemediation(rec, "verified", ctx({}));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.missing-verification-outcome");
  });

  it("refuses applied -> verified when the outcome is verified=false — record stays applied (honest failure)", () => {
    let rec = makeRecord();
    rec = advanceRemediation(rec, "approved", ctx({ approvalRef: "a" })).record;
    rec = advanceRemediation(rec, "applied", ctx({ verificationEvidenceRef: "e" })).record;
    const r = advanceRemediation(rec, "verified", ctx({ verificationOutcome: { verified: false, evidenceRef: "e" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("remediation.verification-failed");
      expect(r.record.state).toBe("applied");
    }
  });

  it("the full happy path appends one transition per step with monotonic timestamps", () => {
    let rec = makeRecord();
    rec = advanceRemediation(rec, "approved", ctx({ approvalRef: "a", at: 200 })).record;
    rec = advanceRemediation(rec, "applied", ctx({ verificationEvidenceRef: "e", at: 300 })).record;
    rec = advanceRemediation(rec, "verified", ctx({ verificationOutcome: { verified: true, evidenceRef: "e" }, at: 400 })).record;
    expect(rec.state).toBe("verified");
    expect(rec.transitions.map((t) => t.to)).toEqual(["approved", "applied", "verified"]);
    expect(rec.transitions.every((t, i) => i === 0 || rec.transitions[i - 1]!.at <= t.at)).toBe(true);
    expect(rec.lastTransitionAt).toBe(400);
  });
});

describe("remediation tenant fail-closed (A8)", () => {
  it("refuses advancing under a missing tenant scope", () => {
    const r = advanceRemediation(makeRecord(), "approved", ctx({ tenantId: "", approvalRef: "a" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.missing-tenant");
  });

  it("refuses advancing under a different tenant scope — even with full evidence", () => {
    const r = advanceRemediation(makeRecord(), "approved", ctx({ tenantId: "t2", approvalRef: "a" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.tenant-mismatch");
  });

  it("refuses an invalid at (negative / non-integer) — time is an explicit integer input", () => {
    const r = advanceRemediation(makeRecord(), "approved", ctx({ approvalRef: "a", at: -5 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("remediation.invalid-at");
  });
});

describe("remediation post-mortem verification", () => {
  it("a fully-gated happy path verifies clean", () => {
    let rec = makeRecord();
    rec = advanceRemediation(rec, "approved", ctx({ approvalRef: "a" })).record;
    rec = advanceRemediation(rec, "applied", ctx({ verificationEvidenceRef: "e" })).record;
    rec = advanceRemediation(rec, "verified", ctx({ verificationOutcome: { verified: true, evidenceRef: "e" } })).record;
    const pm = verifyRemediationHistory(rec);
    expect(pm.ok).toBe(true);
    expect(pm.reason).toBeNull();
  });

  it("flags a hand-crafted record that reached applied without verification evidence", () => {
    const rec: RemediationProposalRecord = {
      ...makeRecord(),
      state: "applied",
      approvalRef: "a",
      verificationEvidenceRef: null,
      transitions: [
        { from: "proposed", to: "approved", at: 200, reason: "guardian-approval-attached", actorId: "actor-1" },
        { from: "approved", to: "applied", at: 300, reason: "verification-evidence-attached", actorId: "actor-1" },
      ],
    };
    const pm = verifyRemediationHistory(rec);
    expect(pm.ok).toBe(false);
    if (!pm.ok) expect(pm.reason).toBe("remediation.missing-verification-evidence");
  });

  it("flags a record whose history does not chain from proposed", () => {
    const rec: RemediationProposalRecord = {
      ...makeRecord(),
      state: "applied",
      verificationEvidenceRef: "e",
      transitions: [
        { from: "approved", to: "applied", at: 300, reason: "x", actorId: "actor-1" },
      ],
    };
    const pm = verifyRemediationHistory(rec);
    expect(pm.ok).toBe(false);
    if (!pm.ok) expect(pm.reason).toBe("remediation.illegal-transition");
  });

  it("flags a record whose terminal state disagrees with its history", () => {
    let rec = makeRecord();
    rec = advanceRemediation(rec, "approved", ctx({ approvalRef: "a" })).record;
    const tampered: RemediationProposalRecord = { ...rec, state: "verified" };
    const pm = verifyRemediationHistory(tampered);
    expect(pm.ok).toBe(false);
    if (!pm.ok) expect(pm.reason).toBe("remediation.illegal-transition");
  });
});
