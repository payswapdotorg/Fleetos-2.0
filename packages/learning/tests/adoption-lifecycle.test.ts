/**
 * Learning adoption-lifecycle tests — legal/illegal transitions, Guardian
 * authorization as an INPUT, idempotency, rejection reason codes,
 * certification-revocation cascade, tenant fail-closed (Wave 5, F250B).
 */
import { describe, it, expect } from "vitest";
import {
  proposeAdoption,
  evaluateCapability,
  assertNoAdoptFunction,
  openAdoptionLifecycle,
  beginGuardianReview,
  authorizeAdoption,
  rejectAdoption,
  completeAdoption,
  withdrawAdoption,
  cascadeCertificationRevocation,
  ADOPTION_TRANSITIONS,
  type AdoptionLifecycleRecord,
  type CapabilityAdoptionProposal,
  type CapabilityVersionRef,
  type EvaluationCase,
  type GuardianAuthorization,
  type OutcomeObservation,
  type TenantScopeLike,
} from "../src/index.ts";

const tenant: TenantScopeLike = { tenantId: "t1" };
const cap: CapabilityVersionRef = { capabilityId: "cap.test", version: "1.0.0" };

function proposal(id = "p1"): CapabilityAdoptionProposal {
  const cases: EvaluationCase<number>[] = Array.from({ length: 3 }, (_, i) => ({
    caseId: `c${i}`,
    tenant,
    capability: cap,
    inputs: { x: i },
    expected: i,
    description: "case",
    tags: [],
  }));
  const outcomes: OutcomeObservation<number>[] = cases.map((c, i) => ({
    observationId: `o${i}`,
    caseId: c.caseId,
    actual: i,
    observedAt: "2026-01-01T00:00:00.000Z",
    observationRef: `ref-${i}`,
    success: true,
  }));
  const evaluation = evaluateCapability(cases, outcomes, tenant, cap);
  const p = proposeAdoption({ tenant, capability: cap, evaluation, proposedBy: "u1", rationale: "good", proposedAt: "2026-01-01T00:00:00.000Z" });
  return { ...p, proposalId: id };
}

const guardian: GuardianAuthorization = {
  guardianDecisionId: "gd-1",
  decidedAtMs: 2000,
  authorizedBy: "guardian",
  decisionDigest: "ab12cd34",
};

function proposed(certificationId?: string, id = "p1"): AdoptionLifecycleRecord {
  const r = openAdoptionLifecycle({ tenant, proposal: proposal(id), certificationId, openedAtMs: 1000 });
  if (!r.ok) throw new Error("fixture open failed");
  return r.record;
}

function inReview(certificationId?: string, id = "p1"): AdoptionLifecycleRecord {
  const r = beginGuardianReview(proposed(certificationId, id), 1500);
  if (!r.ok) throw new Error("fixture review failed");
  return r.record;
}

function authorized(certificationId?: string, id = "p1"): AdoptionLifecycleRecord {
  const r = authorizeAdoption(inReview(certificationId, id), guardian, 2500);
  if (!r.ok) throw new Error("fixture authorize failed");
  return r.record;
}

describe("openAdoptionLifecycle (proposed)", () => {
  it("opens a lifecycle for a pending proposal with a deterministic digest", () => {
    const r = openAdoptionLifecycle({ tenant, proposal: proposal(), openedAtMs: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.stage).toBe("proposed");
      expect(r.record.kind).toBe("ADOPTION_LIFECYCLE");
      expect(r.record.certificationId).toBeNull();
      expect(r.record.proposal.status).toBe("pending");
      expect(r.record.recordDigest).toMatch(/^[0-9a-f]{8}$/);
      expect(r.record.history).toEqual([]);
    }
  });

  it("is tenant fail-closed and requires a pending proposal", () => {
    expect(openAdoptionLifecycle({ tenant: { tenantId: "" }, proposal: proposal(), openedAtMs: 1 })).toMatchObject({ ok: false, code: "missing-tenant" });
    expect(openAdoptionLifecycle({ tenant: { tenantId: "t2" }, proposal: proposal(), openedAtMs: 1 })).toMatchObject({ ok: false, code: "cross-tenant-proposal" });
    const authorizedProposal = { ...proposal(), status: "authorized" as const };
    expect(openAdoptionLifecycle({ tenant, proposal: authorizedProposal, openedAtMs: 1 })).toMatchObject({ ok: false, code: "invalid-proposal-state" });
    expect(openAdoptionLifecycle({ tenant, proposal: proposal(), openedAtMs: -1 })).toMatchObject({ ok: false, code: "invalid-input" });
  });
});

describe("legal + illegal transitions", () => {
  it("proposed -> guardian-review (history recorded)", () => {
    const r = beginGuardianReview(proposed(), 1500);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.stage).toBe("guardian-review");
      expect(r.record.history).toEqual([{ from: "proposed", to: "guardian-review", atMs: 1500, note: "entered guardian review" }]);
    }
  });

  it("the transition table is the packet lifecycle (terminals immutable)", () => {
    expect(ADOPTION_TRANSITIONS.proposed).toEqual(["guardian-review", "withdrawn"]);
    expect(ADOPTION_TRANSITIONS["guardian-review"]).toEqual(["authorized", "rejected", "withdrawn"]);
    expect(ADOPTION_TRANSITIONS.authorized).toEqual(["adopted", "withdrawn"]);
    expect(ADOPTION_TRANSITIONS.rejected).toEqual([]);
    expect(ADOPTION_TRANSITIONS.adopted).toEqual([]);
    expect(ADOPTION_TRANSITIONS.withdrawn).toEqual([]);
  });

  it("cannot authorize from proposed — guardian review is mandatory", () => {
    expect(authorizeAdoption(proposed(), guardian, 2000)).toMatchObject({ ok: false, code: "illegal-transition" });
  });

  it("cannot adopt without authorization", () => {
    expect(completeAdoption(inReview(), "evidence://1", 3000)).toMatchObject({ ok: false, code: "illegal-transition" });
  });

  it("cannot adopt without evidence (fail-closed)", () => {
    expect(completeAdoption(authorized(), "", 3000)).toMatchObject({ ok: false, code: "missing-adoption-evidence" });
  });

  it("rejected/adopted/withdrawn are terminal", () => {
    const rejected = rejectAdoption(inReview(), { reasonCode: "guardian-rejected", note: "no", rejectedBy: "guardian", rejectedAtMs: 3000 });
    expect(rejected.ok).toBe(true);
    if (rejected.ok) {
      expect(beginGuardianReview(rejected.record, 3100)).toMatchObject({ ok: false, code: "illegal-transition" });
      expect(authorizeAdoption(rejected.record, guardian, 3100)).toMatchObject({ ok: false, code: "illegal-transition" });
    }
    const adopted = completeAdoption(authorized(), "evidence://1", 3000);
    expect(adopted.ok).toBe(true);
    if (adopted.ok) {
      expect(withdrawAdoption(adopted.record, "late", 3100)).toMatchObject({ ok: false, code: "illegal-transition" });
      expect(rejectAdoption(adopted.record, { reasonCode: "policy-violation", note: "x", rejectedBy: "g", rejectedAtMs: 3100 })).toMatchObject({ ok: false, code: "illegal-transition" });
    }
  });
});

describe("guardian authorization is an INPUT", () => {
  it("authorized -> applied via markProposalAuthorized (status becomes authorized)", () => {
    const r = authorizeAdoption(inReview(), guardian, 2500);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.stage).toBe("authorized");
      expect(r.record.guardian).toEqual(guardian);
      expect(r.record.proposal.status).toBe("authorized");
    }
  });

  it("rejects malformed authorizations", () => {
    expect(authorizeAdoption(inReview(), { ...guardian, guardianDecisionId: "" }, 2500)).toMatchObject({ ok: false, code: "invalid-input" });
    expect(authorizeAdoption(inReview(), { ...guardian, decidedAtMs: -1 }, 2500)).toMatchObject({ ok: false, code: "invalid-input" });
    expect(authorizeAdoption(inReview(), { ...guardian, decisionDigest: "" }, 2500)).toMatchObject({ ok: false, code: "invalid-input" });
  });

  it("is idempotent with the SAME authorization; a different one is rejected", () => {
    const a = authorizeAdoption(inReview(), guardian, 2500);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const again = authorizeAdoption(a.record, guardian, 9999);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.record).toEqual(a.record);
    const other = authorizeAdoption(a.record, { ...guardian, guardianDecisionId: "gd-2" }, 9999);
    expect(other).toMatchObject({ ok: false, code: "already-authorized" });
  });
});

describe("rejection with reason codes", () => {
  it("rejects from guardian-review with a code and syncs the proposal status", () => {
    const r = rejectAdoption(inReview(), { reasonCode: "insufficient-evidence", note: "too few cases", rejectedBy: "guardian", rejectedAtMs: 3000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.stage).toBe("rejected");
      expect(r.record.rejection!.reasonCode).toBe("insufficient-evidence");
      expect(r.record.proposal.status).toBe("rejected");
    }
  });

  it("is idempotent with the same rejection; rejects malformed ones", () => {
    const rejection = { reasonCode: "policy-violation" as const, note: "x", rejectedBy: "g", rejectedAtMs: 3000 };
    const a = rejectAdoption(inReview(), rejection);
    expect(a.ok).toBe(true);
    if (a.ok) {
      const again = rejectAdoption(a.record, rejection);
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.record).toEqual(a.record);
    }
    expect(rejectAdoption(inReview(), { ...rejection, note: "" })).toMatchObject({ ok: false, code: "invalid-input" });
    expect(rejectAdoption(inReview(), { ...rejection, rejectedAtMs: -1 })).toMatchObject({ ok: false, code: "invalid-input" });
  });
});

describe("adoption + withdrawal", () => {
  it("authorized -> adopted carries the evidence ref (idempotent)", () => {
    const a = completeAdoption(authorized(), "evidence://1", 3000);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.record.stage).toBe("adopted");
      expect(a.record.adoptionEvidenceRef).toBe("evidence://1");
      const again = completeAdoption(a.record, "evidence://1", 9999);
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.record).toEqual(a.record);
      expect(completeAdoption(a.record, "evidence://2", 9999)).toMatchObject({ ok: false, code: "illegal-transition" });
    }
  });

  it("withdraws from proposed, guardian-review and authorized (idempotent)", () => {
    for (const record of [proposed(), inReview(), authorized()]) {
      const w = withdrawAdoption(record, "changed mind", 4000);
      expect(w.ok).toBe(true);
      if (w.ok) {
        expect(w.record.stage).toBe("withdrawn");
        const again = withdrawAdoption(w.record, "changed mind", 5000);
        expect(again.ok).toBe(true);
        if (again.ok) expect(again.record).toEqual(w.record);
      }
    }
    expect(withdrawAdoption(proposed(), "", 4000)).toMatchObject({ ok: false, code: "invalid-input" });
  });
});

describe("determinism", () => {
  it("the same lifecycle operations produce byte-identical records", () => {
    const run = () => {
      const rev = beginGuardianReview(proposed(), 1500);
      if (!rev.ok) throw new Error("rev");
      const auth = authorizeAdoption(rev.record, guardian, 2500);
      if (!auth.ok) throw new Error("auth");
      const adopted = completeAdoption(auth.record, "evidence://1", 3000);
      if (!adopted.ok) throw new Error("adopted");
      return JSON.stringify(adopted.record);
    };
    expect(run()).toBe(run());
  });

  it("every transition advances the record digest", () => {
    const p = proposed();
    const rev = inReview();
    const auth = authorized();
    const adopted = completeAdoption(auth, "evidence://1", 3000);
    expect(adopted.ok).toBe(true);
    const digests = [p.recordDigest, rev.recordDigest, auth.recordDigest, adopted.ok ? adopted.record.recordDigest : ""];
    expect(new Set(digests).size).toBe(4);
  });
});

describe("certification-revocation cascade (fail-closed)", () => {
  const notice = {
    certificationId: "cert-1",
    tenantId: "t1",
    reason: "evaluation-fraud",
    revokedAtMs: 5000,
    revocationDigest: "ff00ff00",
  };

  it("force-rejects dependent non-terminal records with certification-revoked", () => {
    const r = cascadeCertificationRevocation(
      [proposed("cert-1", "p1"), inReview("cert-1", "p2"), authorized("cert-1", "p3"), proposed("cert-2", "p4")],
      notice,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect([...r.rejected].sort()).toEqual(["p1", "p2", "p3"]);
      expect(r.skipped).toEqual([]);
      for (const rec of r.records) {
        if (rec.certificationId === "cert-1") {
          expect(rec.stage).toBe("rejected");
          expect(rec.rejection!.reasonCode).toBe("certification-revoked");
          expect(rec.rejection!.note).toContain("ff00ff00");
          expect(rec.proposal.status).toBe("rejected");
        } else {
          expect(rec.stage).toBe("proposed");
        }
      }
    }
  });

  it("skips terminal records without rewriting history", () => {
    const adopted = completeAdoption(authorized("cert-1"), "evidence://1", 3000);
    if (!adopted.ok) throw new Error("fixture adopted failed");
    const r = cascadeCertificationRevocation([adopted.record], notice);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.rejected).toEqual([]);
      expect(r.skipped).toEqual([{ proposalId: adopted.record.proposalId, stage: "adopted" }]);
      expect(r.records[0]!.stage).toBe("adopted");
      expect(r.records[0]!.recordDigest).toBe(adopted.record.recordDigest);
    }
  });

  it("is tenant fail-closed (empty notice tenant, cross-tenant record)", () => {
    expect(cascadeCertificationRevocation([proposed("cert-1")], { ...notice, tenantId: "" })).toMatchObject({ ok: false, code: "missing-tenant" });
    const foreign = { ...proposed("cert-1"), tenantId: "t2" };
    const r = cascadeCertificationRevocation([foreign], notice);
    expect(r).toMatchObject({ ok: false, code: "cross-tenant-proposal" });
    if (!r.ok) expect(r.reason).toContain(foreign.proposalId);
    expect(cascadeCertificationRevocation([proposed("cert-1")], { ...notice, certificationId: "" })).toMatchObject({ ok: false, code: "invalid-input" });
    expect(cascadeCertificationRevocation([proposed("cert-1")], { ...notice, revokedAtMs: -1 })).toMatchObject({ ok: false, code: "invalid-input" });
  });
});

describe("no self-adoption anywhere (law A5)", () => {
  it("the new lifecycle modules export no adopt/execute/activate function", async () => {
    for (const path of ["../src/adoption-lifecycle.ts", "../src/outcome-intake.ts", "../src/evaluation-summary.ts"]) {
      const mod = await import(path);
      const probe = assertNoAdoptFunction(mod as unknown as Record<string, unknown>);
      expect(probe.ok).toBe(true);
      expect(probe.forbidden).toEqual([]);
    }
  });

  it("the lifecycle record is not a Guardian decision (compile-pinned)", () => {
    const record = proposed();
    // @ts-expect-error — a lifecycle record is not a Guardian decision
    const _bad: { verdict: "authorized" } = record;
    void _bad;
  });
});
