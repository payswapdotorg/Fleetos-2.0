/**
 * inspect-views tests (F240B) — decision-provenance ("why did this happen")
 * views: reason chains, grants, evidence refs, journal presentation,
 * honest authorization-pending, tamper-evident digests, tenant fail-closed.
 */
import { describe, it, expect } from "vitest";
import {
  buildDecisionProvenance,
  verifyDecisionProvenanceDigest,
} from "../src/inspect-views.ts";
import type { DecisionProvenanceView } from "../src/inspect-views.ts";
import type { ActionRecord } from "@fleetos/actions";
import type { ExecutionLedgerEntry } from "@fleetos/execution";
import type {
  GrantRecord,
  GuardianDecision,
  OrderedRuleEvaluation,
} from "@fleetos/policy";
import type { TraceabilityChain } from "@fleetos/evidence";
import type { Capability } from "@fleetos/policy";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cap: Capability = {
  id: "cap.device.reboot",
  category: "execute.device",
  risk: "high",
  requiredAuthority: ["asset.owner"],
  tenantScope: "single",
  resourceScope: { assetIds: ["a-1"] },
  sideEffects: [{ kind: "device.command", target: "a-1", reversible: false, description: "reboot" }],
  idempotency: { supported: true, keyShape: ["tenantId", "capabilityId"] },
  verification: { kind: "device.ack" },
  inputs: [],
  outputs: [],
  description: "reboot a device",
  version: "1.2.0",
};

const decision: GuardianDecision = {
  verdict: "REQUIRE_APPROVAL",
  reasonCode: "require_approval.high_risk",
  matchedRuleId: "rule.require_human_approval_for_high_risk",
  tenantId: "t1",
  capabilityId: "cap.device.reboot",
  conditions: ["human approval required before dispatch"],
  decisionDigest: "dec-42",
};

function action(over: Partial<ActionRecord> = {}): ActionRecord {
  return {
    intent: {
      intentId: "intent-1",
      tenant: { tenantId: "t1" },
      capability: cap,
      idempotencyKey: { tenantId: "t1", capabilityId: "cap.device.reboot", nonce: "n1" },
      inputs: { assetId: "a-1" },
      proposedAt: "2026-10-01T00:00:00.000Z",
      proposedBy: "actor-7",
    },
    state: "authorized",
    authorization: decision,
    evidenceRef: "ev-1",
    lastTransitionAt: "2026-10-01T00:10:00.000Z",
    stateHistory: [],
    ...over,
  };
}

function evaluation(): OrderedRuleEvaluation {
  return {
    policyId: "pol-1",
    policyVersion: "3.0.0",
    tenantId: "t1",
    capabilityId: "cap.device.reboot",
    decisions: [
      {
        ruleId: "rule.allow_low_risk_read",
        verdict: "ALLOW",
        flavor: "allow",
        priority: 10,
        reasonCode: "allow.rule.rule.allow_low_risk_read",
        matchedFacts: [{ fact: "rule.matched", value: "rule.allow_low_risk_read" }],
      },
      {
        ruleId: "rule.require_human_approval_for_high_risk",
        verdict: "REQUIRE_APPROVAL",
        flavor: "escalate",
        priority: 80,
        reasonCode: "escalate.rule.rule.require_human_approval_for_high_risk",
        matchedFacts: [
          { fact: "rule.matched", value: "rule.require_human_approval_for_high_risk" },
          { fact: "risk.within_range", value: "high" },
        ],
      },
    ],
    resolution: {
      verdict: "REQUIRE_APPROVAL",
      winningRuleId: "rule.require_human_approval_for_high_risk",
      mode: "deny_overrides_allow",
      conflictingVerdicts: ["ALLOW"],
      reason: "escalate wins over allow",
    },
    inputsDigest: "in-9",
  };
}

function grant(over: Partial<GrantRecord> = {}): GrantRecord {
  return {
    grantId: "g-1",
    tenantId: "t1",
    capabilityId: "cap.device.reboot",
    granteeActorId: "actor-7",
    grantedByActorId: "guardian",
    grantedAt: 100,
    expiresAt: 9000,
    parentGrantId: null,
    status: "active",
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    ...over,
  };
}

function journalEntry(index: number, over: Partial<ExecutionLedgerEntry> = {}): ExecutionLedgerEntry {
  return {
    index,
    tenantId: "t1",
    idempotencyKey: "t1|cap.device.reboot|n1",
    kind: "submitted",
    at: 600 + index,
    detail: "command submitted",
    previousDigest: index === 0 ? null : `prev-${index - 1}`,
    entryDigest: `ent-${index}`,
    ...over,
  };
}

function trace(): TraceabilityChain {
  return {
    chainId: "chain-1",
    tenantId: "t1",
    links: [
      { kind: "intent", ref: "intent-1", recordedAt: "2026-10-01T00:00:01.000Z", details: {} },
      { kind: "authorization", ref: "dec-42", recordedAt: "2026-10-01T00:05:00.000Z", details: {} },
      { kind: "actor", ref: "actor-7", recordedAt: "2026-10-01T00:00:01.000Z", details: {} },
    ],
    computedAt: "2026-10-01T00:20:00.000Z",
    chainDigest: "chain-d-1",
  };
}

// ---------------------------------------------------------------------------
// Provenance presentation
// ---------------------------------------------------------------------------

describe("decision provenance", () => {
  it("links guardian decision, reason chain, grants, journal and evidence refs", () => {
    const r = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      evaluation: evaluation(),
      grants: [grant()],
      journal: [journalEntry(0), journalEntry(1, { kind: "acked", detail: "claimed" })],
      trace: trace(),
    });
    if (!r.ok) throw new Error("expected ok");
    const v = r.view;
    expect(v.intentId).toBe("intent-1");
    expect(v.capabilityId).toBe("cap.device.reboot");
    expect(v.actionState).toBe("authorized");
    expect(v.authorizationPending).toBe(false);
    expect(v.guardian).toMatchObject({
      verdict: "REQUIRE_APPROVAL",
      reasonCode: "require_approval.high_risk",
      matchedRuleId: "rule.require_human_approval_for_high_risk",
      decisionDigest: "dec-42",
    });
    expect(v.reasonChain.map((l) => l.ruleId)).toEqual([
      "rule.allow_low_risk_read",
      "rule.require_human_approval_for_high_risk",
    ]);
    expect(v.reasonChain[1]?.matchedFactCount).toBe(2);
    expect(v.grants).toHaveLength(1);
    expect(v.grants[0]).toMatchObject({ grantId: "g-1", granteeActorId: "actor-7", status: "active" });
    expect(v.executionJournal.map((j) => j.kind)).toEqual(["submitted", "acked"]);
    expect(v.executionJournal[1]?.entryDigest).toBe("ent-1");
    expect(v.evidenceRefs).toEqual([
      { kind: "action-evidence", ref: "ev-1" },
      { kind: "trace", ref: "intent:intent-1" },
      { kind: "trace", ref: "authorization:dec-42" },
      { kind: "trace", ref: "actor:actor-7" },
    ]);
    expect(typeof v.chainDigest).toBe("string");
    expect(v.chainDigest).not.toBe("");
  });

  it("presents an unauthorized action honestly (authorizationPending, null guardian)", () => {
    const r = buildDecisionProvenance({
      tenantId: "t1",
      action: action({ state: "proposed", authorization: undefined, evidenceRef: undefined }),
      grants: [],
      journal: [],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.view.authorizationPending).toBe(true);
    expect(r.view.guardian).toBeNull();
    expect(r.view.evidenceRefs).toEqual([]);
    expect(verifyDecisionProvenanceDigest(r.view)).toBe(true);
  });

  it("presents grants for the action's capability only, ordered by grantId", () => {
    const r = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      grants: [
        grant({ grantId: "g-b" }),
        grant({ grantId: "g-a" }),
        grant({ grantId: "g-x", capabilityId: "cap.other" }),
      ],
      journal: [],
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.view.grants.map((g) => g.grantId)).toEqual(["g-a", "g-b"]);
  });
});

// ---------------------------------------------------------------------------
// Tamper-evident digest
// ---------------------------------------------------------------------------

describe("tamper-evident chain digest", () => {
  const baseInput = {
    tenantId: "t1",
    action: action(),
    evaluation: evaluation(),
    grants: [grant()],
    journal: [journalEntry(0)],
    trace: trace(),
  };

  function view(): DecisionProvenanceView {
    const r = buildDecisionProvenance(baseInput);
    if (!r.ok) throw new Error("expected ok");
    return r.view;
  }

  it("verifies an untouched view", () => {
    expect(verifyDecisionProvenanceDigest(view())).toBe(true);
  });

  const tamperCases: readonly { label: string; mutate: (v: DecisionProvenanceView) => DecisionProvenanceView }[] = [
    {
      label: "guardian verdict",
      mutate: (v) => ({ ...v, guardian: v.guardian === null ? null : { ...v.guardian, verdict: "ALLOW" } }),
    },
    {
      label: "guardian reason code",
      mutate: (v) => ({ ...v, guardian: v.guardian === null ? null : { ...v.guardian, reasonCode: "allow.low_risk_read" } }),
    },
    {
      label: "reason chain link",
      mutate: (v) => ({ ...v, reasonChain: v.reasonChain.map((l, i) => (i === 0 ? { ...l, reasonCode: "tampered" } : l)) }),
    },
    {
      label: "grant",
      mutate: (v) => ({ ...v, grants: v.grants.map((g, i) => (i === 0 ? { ...g, status: "revoked" } : g)) }),
    },
    {
      label: "journal entry digest",
      mutate: (v) => ({ ...v, executionJournal: v.executionJournal.map((j, i) => (i === 0 ? { ...j, entryDigest: "forged" } : j)) }),
    },
    {
      label: "evidence ref",
      mutate: (v) => ({ ...v, evidenceRefs: v.evidenceRefs.map((e, i) => (i === 0 ? { ...e, ref: "forged-ev" } : e)) }),
    },
    { label: "action state", mutate: (v) => ({ ...v, actionState: "executed" }) },
    { label: "intent id", mutate: (v) => ({ ...v, intentId: "intent-other" }) },
    { label: "authorization-pending flag", mutate: (v) => ({ ...v, authorizationPending: true }) },
  ];

  for (const c of tamperCases) {
    it(`detects tampering with the presented ${c.label}`, () => {
      const tampered = c.mutate(view());
      expect(verifyDecisionProvenanceDigest(tampered)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Refusals (fail-closed, offender named)
// ---------------------------------------------------------------------------

describe("refusals", () => {
  it("refuses an empty tenant", () => {
    const r = buildDecisionProvenance({
      tenantId: "",
      action: action(),
      grants: [],
      journal: [],
    });
    expect(r).toMatchObject({ ok: false, refused: "views.missing-tenant" });
  });

  it("refuses a cross-tenant action, naming the offender", () => {
    const r = buildDecisionProvenance({
      tenantId: "t1",
      action: action({ intent: { ...action().intent, tenant: { tenantId: "t2" } } }),
      grants: [],
      journal: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe("views.cross-tenant-action");
    expect(r.detail).toContain("intent-1");
    expect(r.detail).toContain("t2");
  });

  it("refuses cross-tenant grants, journal entries, evaluation and trace", () => {
    const crossGrant = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      grants: [grant({ tenantId: "t2" })],
      journal: [],
    });
    expect(crossGrant).toMatchObject({ ok: false, refused: "views.cross-tenant-grant" });
    const crossJournal = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      grants: [],
      journal: [journalEntry(0, { tenantId: "t2" })],
    });
    expect(crossJournal).toMatchObject({ ok: false, refused: "views.cross-tenant-journal" });
    const crossEvaluation = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      evaluation: { ...evaluation(), tenantId: "t2" },
      grants: [],
      journal: [],
    });
    expect(crossEvaluation).toMatchObject({ ok: false, refused: "views.cross-tenant-evaluation" });
    const crossTrace = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      grants: [],
      journal: [],
      trace: { ...trace(), tenantId: "t2" },
    });
    expect(crossTrace).toMatchObject({ ok: false, refused: "views.cross-tenant-trace" });
  });

  it("refuses an evaluation for a different capability and an out-of-order journal", () => {
    const wrongCap = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      evaluation: { ...evaluation(), capabilityId: "cap.other" },
      grants: [],
      journal: [],
    });
    expect(wrongCap).toMatchObject({ ok: false, refused: "views.evaluation-capability-mismatch" });
    const outOfOrder = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      grants: [],
      journal: [journalEntry(3), journalEntry(1)],
    });
    expect(outOfOrder).toMatchObject({ ok: false, refused: "views.journal-out-of-order" });
  });

  it("refuses a traceability chain linked to a different intent", () => {
    const r = buildDecisionProvenance({
      tenantId: "t1",
      action: action(),
      grants: [],
      journal: [],
      trace: {
        ...trace(),
        links: trace().links.map((l) => (l.kind === "intent" ? { ...l, ref: "intent-OTHER" } : l)),
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe("views.trace-intent-mismatch");
    expect(r.detail).toContain("intent-OTHER");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("same inputs => byte-identical view including the chain digest", () => {
    const input = {
      tenantId: "t1",
      action: action(),
      evaluation: evaluation(),
      grants: [grant()],
      journal: [journalEntry(0), journalEntry(1)],
      trace: trace(),
    };
    const a = buildDecisionProvenance(input);
    const b = buildDecisionProvenance(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
