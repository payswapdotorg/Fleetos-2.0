/**
 * Incident-audit tests (F280B, Wave 8 lane B).
 *
 * Behavior under test: the unified audit trail over the lane's three REAL
 * decision surfaces — Guardian DecisionRecords (built via the REAL
 * evaluateCapability + buildDecisionRecord), action emissions (built via the
 * REAL proposeAction → advanceActionState → emitAuditTrail chain), and REAL
 * execution ledger entries — with canonical assembly order, gap/tamper
 * semantics, and A8 cross-tenant fail-closed refusals.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateCapability,
  buildDecisionRecord,
} from "@fleetos/policy";
import type { Policy, PolicyRule, Capability, GuardianContext, DecisionRecord } from "@fleetos/policy";
import {
  proposeAction,
  advanceActionState,
  emitAuditTrail,
} from "@fleetos/actions";
import type { ActionAuditEvent, ActionIntent } from "@fleetos/actions";
import {
  appendExecutionLedger,
  verifyExecutionLedger,
} from "../src/index.ts";
import type { ExecutionLedgerEntry } from "../src/index.ts";
import {
  sealGuardianEvaluation,
  sealActionEmission,
  sealExecutionLedgerEntry,
  buildIncidentAuditTrail,
  verifyIncidentAuditTrail,
} from "../src/index.ts";
import {
  dropAuditEvent,
  tamperAuditPayload,
  sealAuditLedgerHead,
  verifyAuditLedgerAgainstAnchor,
} from "@fleetos/security";

const TENANT = "tnt_incident";

// ---------------------------------------------------------------------------
// REAL fixtures
// ---------------------------------------------------------------------------

function readCap(): Capability {
  return {
    id: "cap.read.health", category: "read", risk: "low",
    requiredAuthority: ["tenant.engineer"], tenantScope: "single",
    resourceScope: { assetIds: ["asset-1"] }, sideEffects: [],
    idempotency: { supported: true, keyShape: ["tenantId", "assetId"] },
    verification: { kind: "domain.read" }, inputs: ["assetId"], outputs: ["healthSummary"],
    description: "Read asset health summary", version: "1.0.0",
  };
}

function policy(rules: readonly PolicyRule[]): Policy {
  return { id: "pol-1", version: "1.0.0", tenantId: TENANT, rules, defaultVerdict: "BLOCK", failClosed: true };
}

const ALLOW_READ: PolicyRule = {
  id: "rule.allow_low_risk_read", description: "allow low-risk reads",
  riskFloor: "none", riskCeiling: "low", requiredAuthority: ["tenant.engineer"],
  tenantScope: "any", verdict: "ALLOW", priority: 10,
};

function guardianDecision(cap: Capability, risk: "low" | "high" = "low") {
  const ctx: GuardianContext = {
    tenant: { tenantId: TENANT },
    capability: cap,
    actor: { actorId: "engineer-1", authority: ["tenant.engineer"], isAutonomous: false },
    degraded: false,
  };
  return evaluateCapability(policy([ALLOW_READ]), risk === "low" ? readCap() : cap, ctx);
}

function decisionRecord(cap: Capability): DecisionRecord {
  const decision = guardianDecision(cap);
  return buildDecisionRecord(decision, {
    policyId: "pol-1", policyVersion: "1.0.0", capability: cap,
    actorId: "engineer-1", actorIsAutonomous: false,
    actorAuthority: ["tenant.engineer"],
    evaluatedAt: "2026-10-13T00:00:00.000Z",
    matchedFacts: [{ fact: "rule.matched", value: "rule.allow_low_risk_read" }],
  });
}

function actionIntent(): ActionIntent {
  const cap = readCap();
  return {
    intentId: "intent-1",
    tenant: { tenantId: TENANT },
    capability: cap,
    idempotencyKey: { tenantId: TENANT, capabilityId: cap.id, nonce: "n-1" },
    inputs: { assetId: "asset-1" },
    proposedAt: "2026-10-13T00:00:01.000Z",
    proposedBy: "engineer-1",
  };
}

function actionEmissions(): readonly ActionAuditEvent[] {
  const decision = guardianDecision(readCap());
  let record = proposeAction(actionIntent());
  record = advanceActionState(record, "authorized", {
    at: "2026-10-13T00:00:02.000Z", authorization: decision, tenantId: TENANT,
  }).record;
  record = advanceActionState(record, "confirmed", {
    at: "2026-10-13T00:00:03.000Z", confirmedBy: "engineer-1", tenantId: TENANT,
  }).record;
  return emitAuditTrail(record, "engineer-1");
}

function executionLedger(): readonly ExecutionLedgerEntry[] {
  let ledger: readonly ExecutionLedgerEntry[] = [];
  for (const [kind, at, detail] of [
    ["submitted", 1_000, ""],
    ["acked", 1_100, ""],
    ["completed", 1_200, "ok"],
  ] as const) {
    const r = appendExecutionLedger(ledger, {
      tenantId: TENANT, idempotencyKey: "plan|step|n-1", kind, at, detail,
    });
    if (!r.ok) throw new Error(`fixture append refused: ${r.reason}`);
    ledger = r.ledger;
  }
  return ledger;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("surface sealers — REAL records", () => {
  it("seals a REAL Guardian DecisionRecord with its full justification chain", () => {
    const record = decisionRecord(readCap());
    const sealed = sealGuardianEvaluation(record, 1_000);
    expect(sealed.tenantId).toBe(TENANT);
    expect(sealed.surface).toBe("guardian.evaluation");
    expect(sealed.subjectId).toBe(record.recordId);
    expect(sealed.payload).toMatchObject({
      verdict: "ALLOW", reasonCode: "allow.matched_rule",
      matchedRuleId: "rule.allow_low_risk_read",
      decisionDigest: record.decision.decisionDigest,
    });
  });

  it("seals REAL action emissions with transition digests", () => {
    const emissions = actionEmissions();
    expect(emissions.length).toBeGreaterThanOrEqual(2);
    const sealed = sealActionEmission(emissions[0]!);
    expect(sealed.subjectId).toBe(emissions[0]!.eventId);
    expect(sealed.payload).toMatchObject({
      intentId: "intent-1", kind: "action.authorized",
      transitionDigest: emissions[0]!.transitionDigest,
    });
  });

  it("seals REAL execution ledger entries, chaining their own digests in", () => {
    const ledger = executionLedger();
    const sealed = sealExecutionLedgerEntry(ledger[2]!);
    expect(sealed.subjectId).toBe("plan|step|n-1#2");
    expect(sealed.payload).toMatchObject({ kind: "completed", index: 2, entryDigest: ledger[2]!.entryDigest });
  });
});

describe("trail assembly — canonical, tamper-evident", () => {
  it("assembles the three REAL surfaces into one verified hash chain", () => {
    const r = buildIncidentAuditTrail({
      tenantId: TENANT,
      decisions: [{ record: decisionRecord(readCap()), atMs: 1_000 }],
      emissions: actionEmissions(),
      entries: executionLedger(),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.trail.length).toBe(1 + 2 + 3);
    const v = verifyIncidentAuditTrail(r.trail);
    expect(v.verified).toBe(true);
    expect(v.checkedEntries).toBe(r.trail.length);
  });

  it("assembly is order-independent: input order never leaks into the chain", () => {
    const decisions = [{ record: decisionRecord(readCap()), atMs: 1_000 }];
    const emissions = actionEmissions();
    const entries = executionLedger();
    const a = buildIncidentAuditTrail({ tenantId: TENANT, decisions, emissions, entries });
    const b = buildIncidentAuditTrail({ tenantId: TENANT, entries, decisions, emissions });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.trail)).toBe(JSON.stringify(b.trail));
  });

  it("is deterministic: identical inputs produce byte-identical trails", () => {
    const build = () =>
      buildIncidentAuditTrail({
        tenantId: TENANT,
        decisions: [{ record: decisionRecord(readCap()), atMs: 1_000 }],
        emissions: actionEmissions(),
        entries: executionLedger(),
      });
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it("a removed audit event fails verification naming the gap position", () => {
    const r = buildIncidentAuditTrail({
      tenantId: TENANT,
      decisions: [{ record: decisionRecord(readCap()), atMs: 1_000 }],
      emissions: actionEmissions(),
      entries: executionLedger(),
    });
    if (!r.ok) throw new Error("assembly failed");
    const withGap = dropAuditEvent(r.trail, 3);
    const v = verifyIncidentAuditTrail(withGap);
    expect(v.verified).toBe(false);
    expect(v.gapAt).toBe(3);
    expect(v.reason).toBe("audit.gap");
  });

  it("payload tampering on any surface fails at the exact position", () => {
    const r = buildIncidentAuditTrail({
      tenantId: TENANT, entries: executionLedger(),
      decisions: [{ record: decisionRecord(readCap()), atMs: 1_000 }],
    });
    if (!r.ok) throw new Error("assembly failed");
    const tampered = tamperAuditPayload(r.trail, 1, { verdict: "BLOCK" });
    const v = verifyIncidentAuditTrail(tampered);
    expect(v.verified).toBe(false);
    expect(v.brokenAt).toBe(1);
    expect(v.reason).toBe("audit.payload_digest_mismatch");
  });

  it("the execution ledger's own verification is preserved inside the trail inputs", () => {
    const entries = executionLedger();
    expect(verifyExecutionLedger(entries).verified).toBe(true);
  });

  it("anchoring detects tail truncation of the assembled trail", () => {
    const r = buildIncidentAuditTrail({ tenantId: TENANT, entries: executionLedger() });
    if (!r.ok) throw new Error("assembly failed");
    const anchor = sealAuditLedgerHead(r.trail)!;
    const truncated = dropAuditEvent(r.trail, r.trail.length - 1);
    const v = verifyAuditLedgerAgainstAnchor(truncated, anchor);
    expect(v.truncated).toBe(true);
    expect(v.verified).toBe(false);
  });
});

describe("trail assembly — A8 tenant fail-closed", () => {
  it("refuses a cross-tenant Guardian decision, naming the offender", () => {
    const foreign = { ...decisionRecord(readCap()), tenantId: "tnt_other" };
    const r = buildIncidentAuditTrail({
      tenantId: TENANT,
      decisions: [{ record: foreign, atMs: 1_000 }],
    });
    expect(r).toMatchObject({ ok: false, reason: "trail.tenant-mismatch" });
    if (!r.ok) expect(r.offender).toContain("guardian.evaluation:");
  });

  it("refuses a cross-tenant action emission, naming the offender", () => {
    const [first] = actionEmissions();
    const foreign: ActionAuditEvent = { ...first!, tenantId: "tnt_other" };
    const r = buildIncidentAuditTrail({ tenantId: TENANT, emissions: [foreign] });
    expect(r).toMatchObject({ ok: false, reason: "trail.tenant-mismatch" });
    if (!r.ok) expect(r.offender).toContain("action.emission:");
  });

  it("refuses a cross-tenant execution entry, naming the offender", () => {
    const ledger = executionLedger();
    const foreign: ExecutionLedgerEntry = { ...ledger[0]!, tenantId: "tnt_other" };
    const r = buildIncidentAuditTrail({ tenantId: TENANT, entries: [foreign] });
    expect(r).toMatchObject({ ok: false, reason: "trail.tenant-mismatch" });
    if (!r.ok) expect(r.offender).toContain("execution.entry:");
  });

  it("refuses an empty tenant scope", () => {
    expect(buildIncidentAuditTrail({ tenantId: "" })).toMatchObject({
      ok: false, reason: "trail.missing-tenant",
    });
  });
});
