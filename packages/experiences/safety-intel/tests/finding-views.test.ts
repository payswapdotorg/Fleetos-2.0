/**
 * finding-views tests (F240B) — severity rollups, triage queue ordering,
 * evidence-gated remediation progress (never auto-done), tenant fail-closed,
 * determinism, digests.
 */
import { describe, it, expect } from "vitest";
import {
  buildFindingViews,
  type RemediationProgressStage,
} from "../src/finding-views.ts";
import type {
  FindingKind,
  RemediationProposalRecord,
  SecurityFinding,
} from "@fleetos/security";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function finding(over: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    findingId: "f-1",
    tenantId: "t1",
    kind: "device.firmware_outdated",
    severity: "high",
    confidence: "confirmed",
    detectedAt: "2026-10-01T00:00:00.000Z",
    assetIds: ["a-1"],
    description: "firmware outdated",
    evidenceRefs: ["ev-1"],
    findingDigest: "d1",
    ...over,
  };
}

function proposal(over: Partial<RemediationProposalRecord> = {}): RemediationProposalRecord {
  return {
    proposalId: "rem-1",
    tenantId: "t1",
    findingIds: ["f-1"],
    remediationKind: "patch",
    state: "proposed",
    approvalRef: null,
    verificationEvidenceRef: null,
    verificationOutcome: null,
    transitions: [],
    lastTransitionAt: 100,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

describe("severity rollups", () => {
  it("counts findings by severity and confidence", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [
        finding(),
        finding({ findingId: "f-2", severity: "critical", confidence: "tentative" }),
        finding({ findingId: "f-3", severity: "high", confidence: "probable" }),
      ],
      remediations: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.views.rollup.totalFindings).toBe(3);
    expect(r.views.rollup.bySeverity).toEqual({ critical: 1, high: 2, medium: 0, low: 0, info: 0 });
    expect(r.views.rollup.byConfidence).toEqual({ tentative: 1, probable: 1, confirmed: 1 });
  });

  it("orders top kinds by count desc then kind asc", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [
        finding({ kind: "network.open_ingress" }),
        finding({ findingId: "f-2", kind: "network.open_ingress" }),
        finding({ findingId: "f-3", kind: "device.unmanaged" }),
        finding({ findingId: "f-4", kind: "auth.missing_mfa" }),
      ],
      remediations: [],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.views.rollup.topKinds.map((k) => k.kind)).toEqual([
      "network.open_ingress",
      "auth.missing_mfa",
      "device.unmanaged",
    ]);
    expect(r.views.rollup.topKinds[0]?.count).toBe(2);
  });

  it("caps top kinds at 5", () => {
    const kinds: readonly FindingKind[] = [
      "auth.weak_credential",
      "auth.exposed_credential",
      "auth.missing_mfa",
      "device.firmware_outdated",
      "device.unmanaged",
      "network.open_ingress",
      "supply_chain.unverified_dependency",
    ];
    const r = buildFindingViews({
      tenantId: "t1",
      findings: kinds.map((kind, i) => finding({ findingId: `f-${i}`, kind })),
      remediations: [],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.views.rollup.topKinds).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Triage queue ordering
// ---------------------------------------------------------------------------

describe("triage queue", () => {
  it("orders by severity desc, then confidence desc, then findingId asc", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [
        finding({ findingId: "f-c", severity: "low", confidence: "confirmed" }),
        finding({ findingId: "f-a", severity: "critical", confidence: "probable" }),
        finding({ findingId: "f-b", severity: "critical", confidence: "confirmed" }),
        finding({ findingId: "f-d", severity: "critical", confidence: "confirmed" }),
      ],
      remediations: [],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.views.triageQueue.items.map((i) => i.findingId)).toEqual(["f-b", "f-d", "f-a", "f-c"]);
    expect(r.views.triageQueue.items.map((i) => i.queueRank)).toEqual([1, 2, 3, 4]);
  });

  it("input order never leaks into the queue order", () => {
    const findings = [
      finding({ findingId: "f-1" }),
      finding({ findingId: "f-2", severity: "critical" }),
      finding({ findingId: "f-3" }),
    ];
    const a = buildFindingViews({ tenantId: "t1", findings, remediations: [] });
    const b = buildFindingViews({ tenantId: "t1", findings: [...findings].reverse(), remediations: [] });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.views.triageQueue.items.map((i) => i.findingId)).toEqual(
      b.views.triageQueue.items.map((i) => i.findingId),
    );
    expect(a.views.triageQueue.digest).toBe(b.views.triageQueue.digest);
  });

  it("surfaces evidence ref and asset counts per item", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [finding({ evidenceRefs: ["e1", "e2"], assetIds: ["a1", "a2", "a3"] })],
      remediations: [],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.views.triageQueue.items[0]?.evidenceRefCount).toBe(2);
    expect(r.views.triageQueue.items[0]?.assetCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Evidence-gated remediation progress
// ---------------------------------------------------------------------------

describe("remediation progress (evidence-gated)", () => {
  const cases: readonly { label: string; record: RemediationProposalRecord; stage: RemediationProgressStage; remediated: boolean }[] = [
    { label: "proposed, no approval evidence", record: proposal(), stage: "proposed-awaiting-approval", remediated: false },
    {
      label: "approved with approval evidence",
      record: proposal({ state: "approved", approvalRef: "guardian-42" }),
      stage: "approved-awaiting-verification-evidence",
      remediated: false,
    },
    {
      label: "applied with verification evidence, no outcome",
      record: proposal({ state: "applied", approvalRef: "guardian-42", verificationEvidenceRef: "ev-9" }),
      stage: "applied-awaiting-verification-outcome",
      remediated: false,
    },
    {
      label: "applied with FAILED verification outcome — honest failure",
      record: proposal({
        state: "applied",
        approvalRef: "guardian-42",
        verificationEvidenceRef: "ev-9",
        verificationOutcome: { verified: false, evidenceRef: "ev-10" },
      }),
      stage: "applied-verification-failed",
      remediated: false,
    },
    {
      label: "verified with positive outcome",
      record: proposal({
        state: "verified",
        approvalRef: "guardian-42",
        verificationEvidenceRef: "ev-9",
        verificationOutcome: { verified: true, evidenceRef: "ev-10" },
      }),
      stage: "verified",
      remediated: true,
    },
    {
      label: "FORGED verified without outcome — never auto-done",
      record: proposal({ state: "verified", approvalRef: "guardian-42", verificationEvidenceRef: "ev-9" }),
      stage: "evidence-inconsistent",
      remediated: false,
    },
    {
      label: "FORGED approved without approval evidence",
      record: proposal({ state: "approved" }),
      stage: "evidence-inconsistent",
      remediated: false,
    },
    {
      label: "FORGED applied without verification evidence",
      record: proposal({ state: "applied", approvalRef: "guardian-42" }),
      stage: "evidence-inconsistent",
      remediated: false,
    },
  ];

  for (const c of cases) {
    it(`presents "${c.label}" as ${c.stage}`, () => {
      const r = buildFindingViews({ tenantId: "t1", findings: [], remediations: [c.record] });
      if (!r.ok) throw new Error("expected ok");
      const p = r.views.remediation.proposals[0]!;
      expect(p.stage).toBe(c.stage);
      expect(p.remediated).toBe(c.remediated);
    });
  }

  it("presents the three evidence gates with their refs", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [],
      remediations: [
        proposal({ state: "applied", approvalRef: "ap-1", verificationEvidenceRef: "ve-1" }),
      ],
    });
    if (!r.ok) throw new Error("expected ok");
    const gates = r.views.remediation.proposals[0]!.gates;
    expect(gates.map((g) => g.gate)).toEqual(["approval-evidence", "verification-evidence", "verification-outcome"]);
    expect(gates.map((g) => g.satisfied)).toEqual([true, true, false]);
    expect(gates[0]?.evidenceRef).toBe("ap-1");
    expect(gates[1]?.evidenceRef).toBe("ve-1");
    expect(gates[2]?.evidenceRef).toBeNull();
  });

  it("counts remediated and inconsistent proposals in the summary", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [],
      remediations: [
        proposal({
          proposalId: "rem-a",
          state: "verified",
          approvalRef: "g-1",
          verificationEvidenceRef: "v-1",
          verificationOutcome: { verified: true, evidenceRef: "v-2" },
        }),
        proposal({ proposalId: "rem-b", state: "verified" }),
        proposal({ proposalId: "rem-c", state: "proposed" }),
      ],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.views.remediation.totalProposals).toBe(3);
    expect(r.views.remediation.remediatedCount).toBe(1);
    expect(r.views.remediation.inconsistentCount).toBe(1);
    expect(r.views.remediation.byStage["evidence-inconsistent"]).toBe(1);
    expect(r.views.remediation.byStage["verified"]).toBe(1);
    expect(r.views.remediation.byStage["proposed-awaiting-approval"]).toBe(1);
  });

  it("orders proposals by proposalId asc regardless of input order", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [],
      remediations: [proposal({ proposalId: "rem-z" }), proposal({ proposalId: "rem-a" })],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.views.remediation.proposals.map((p) => p.proposalId)).toEqual(["rem-a", "rem-z"]);
  });
});

// ---------------------------------------------------------------------------
// Tenant fail-closed
// ---------------------------------------------------------------------------

describe("tenant fail-closed", () => {
  it("refuses an empty tenant with no partial state", () => {
    const r = buildFindingViews({ tenantId: "", findings: [finding()], remediations: [proposal()] });
    expect(r).toMatchObject({ ok: false, refused: "views.missing-tenant" });
  });

  it("refuses a cross-tenant finding, naming the offender", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [finding(), finding({ findingId: "f-evil", tenantId: "t2" })],
      remediations: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe("views.cross-tenant-finding");
    expect(r.detail).toContain("f-evil");
    expect(r.detail).toContain("t2");
  });

  it("refuses a cross-tenant remediation proposal, naming the offender", () => {
    const r = buildFindingViews({
      tenantId: "t1",
      findings: [],
      remediations: [proposal({ proposalId: "rem-evil", tenantId: "t2" })],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe("views.cross-tenant-proposal");
    expect(r.detail).toContain("rem-evil");
  });

  it("refuses duplicate finding ids and duplicate proposal ids", () => {
    const dupF = buildFindingViews({ tenantId: "t1", findings: [finding(), finding()], remediations: [] });
    expect(dupF).toMatchObject({ ok: false, refused: "views.duplicate-finding-id" });
    const dupP = buildFindingViews({
      tenantId: "t1",
      findings: [],
      remediations: [proposal(), proposal()],
    });
    expect(dupP).toMatchObject({ ok: false, refused: "views.duplicate-proposal-id" });
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  const findings = [
    finding(),
    finding({ findingId: "f-2", severity: "critical", kind: "auth.missing_mfa" }),
  ];
  const remediations = [proposal(), proposal({ proposalId: "rem-2", state: "approved", approvalRef: "g-9" })];

  it("same inputs => byte-identical views including digests", () => {
    const a = buildFindingViews({ tenantId: "t1", findings, remediations });
    const b = buildFindingViews({ tenantId: "t1", findings, remediations });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("reversed input order => identical digests (order-independence)", () => {
    const a = buildFindingViews({ tenantId: "t1", findings, remediations });
    const b = buildFindingViews({
      tenantId: "t1",
      findings: [...findings].reverse(),
      remediations: [...remediations].reverse(),
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.views.rollup.digest).toBe(b.views.rollup.digest);
    expect(a.views.triageQueue.digest).toBe(b.views.triageQueue.digest);
    expect(a.views.remediation.digest).toBe(b.views.remediation.digest);
  });
});
