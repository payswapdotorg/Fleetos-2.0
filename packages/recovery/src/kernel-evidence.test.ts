/**
 * @fleetos/recovery — Wave 2 evidence-chain tests (F220A).
 *
 * Covers:
 *   - Recovery case workflows with evidence-chain requirements — a
 *     transition without its required evidence refs is refused.
 *   - verifyEvidenceChain returns typed refusal codes.
 *   - Post-mortem verification of a fully-resolved case's evidence chain.
 */

import { describe, it, expect } from "vitest";
import {
  applyRecoveryCommandWithEvidenceChain,
  defaultEvidenceChainRules,
  verifyCaseEvidenceChainPostMortem,
  verifyEvidenceChain,
} from "./kernel-evidence.js";
import { openRecoveryCase, applyRecoveryCommand, type RecoveryCommand, type RecoveryCase } from "./recovery.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const DEV1 = "dev_truck-001";

function openCase() {
  return openRecoveryCase({
    id: "rc_test01" as never,
    tenantId: TENANT_A,
    deviceId: DEV1,
    openedAt: NOW,
  });
}

function evidenceRef(kind: string, observedAt: number = NOW) {
  return { digest: `dg_${kind}_${observedAt}`, kind, observedAt };
}

// Helper: apply a recovery command and throw if it fails (test-time
// convenience). Tests in this file construct valid command sequences, so
// a failure here is a test bug, not a kernel behavior.
function apply(rc: RecoveryCase, command: RecoveryCommand): RecoveryCase {
  const r = applyRecoveryCommand(rc, command);
  if (!r.ok) throw new Error("applyRecoveryCommand failed in test setup");
  return r.case;
}

// ---------------------------------------------------------------------------
// verifyEvidenceChain — typed refusal codes.
// ---------------------------------------------------------------------------

describe("recovery evidence-chain: verifyEvidenceChain", () => {
  it("returns no-rule when no rule matches the (state, command) pair", () => {
    const r = verifyEvidenceChain("open", "investigate", [], defaultEvidenceChainRules());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("no-rule");
  });

  it("returns insufficient-evidence-count when required evidence is missing", () => {
    const r = verifyEvidenceChain("proposal", "resolve", [], defaultEvidenceChainRules());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("insufficient-evidence-count");
  });

  it("returns insufficient-evidence-count when only one of two required kinds is present", () => {
    const evidence = [evidenceRef("verification:success")];
    const r = verifyEvidenceChain("proposal", "resolve", evidence, defaultEvidenceChainRules());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("insufficient-evidence-count");
  });

  it("returns ok when all required evidence is present (resolve from proposal)", () => {
    const evidence = [
      evidenceRef("verification:success"),
      evidenceRef("diagnosis:root-cause"),
    ];
    const r = verifyEvidenceChain("proposal", "resolve", evidence, defaultEvidenceChainRules());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rule.required).toHaveLength(2);
    expect(r.satisfied).toHaveLength(2);
  });

  it("returns ok for close from investigating when audit + verification present", () => {
    const evidence = [
      evidenceRef("audit:case-opened"),
      evidenceRef("verification:device-located"),
    ];
    const r = verifyEvidenceChain("investigating", "close", evidence, defaultEvidenceChainRules());
    expect(r.ok).toBe(true);
  });

  it("returns ok for close from resolved when audit present", () => {
    const evidence = [evidenceRef("audit:resolution-recorded")];
    const r = verifyEvidenceChain("resolved", "close", evidence, defaultEvidenceChainRules());
    expect(r.ok).toBe(true);
  });

  it("classifies evidence by prefix (observation, diagnosis, verification, audit)", () => {
    // Mix of evidence refs with different prefixes.
    const evidence = [
      evidenceRef("telemetry.temp"),
      evidenceRef("diagnosis:overheat"),
      evidenceRef("verification:fix-applied"),
      evidenceRef("audit:case-resolved"),
    ];
    // resolve from proposal requires verification + diagnosis -> both present.
    const r = verifyEvidenceChain("proposal", "resolve", evidence, defaultEvidenceChainRules());
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyRecoveryCommandWithEvidenceChain — refuses transitions without
// required evidence.
// ---------------------------------------------------------------------------

describe("recovery evidence-chain: gated transitions", () => {
  it("refuses resolve without required evidence", () => {
    let rc = openCase();
    rc = apply(rc, { kind: "investigate", initiatedAt: NOW + 1 });
    rc = apply(rc, { kind: "propose", initiatedAt: NOW + 2 });
    // Now in 'proposal' — resolve without evidence.
    const r = applyRecoveryCommandWithEvidenceChain(rc, { kind: "resolve", initiatedAt: NOW + 3, reason: "fixed" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("insufficient-evidence-count");
  });

  it("allows resolve with required evidence (verification + diagnosis)", () => {
    let rc = openCase();
    rc = apply(rc, { kind: "investigate", initiatedAt: NOW + 1 });
    rc = apply(rc, { kind: "propose", initiatedAt: NOW + 2 });
    const r = applyRecoveryCommandWithEvidenceChain(rc, {
      kind: "resolve",
      initiatedAt: NOW + 3,
      reason: "fixed",
      evidence: [
        evidenceRef("verification:fix-applied"),
        evidenceRef("diagnosis:root-cause"),
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.to).toBe("resolved");
    expect(r.evidenceChain.ok).toBe(true);
  });

  it("refuses close from investigating without audit + verification", () => {
    let rc = openCase();
    rc = apply(rc, { kind: "investigate", initiatedAt: NOW + 1 });
    const r = applyRecoveryCommandWithEvidenceChain(rc, { kind: "close", initiatedAt: NOW + 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("insufficient-evidence-count");
  });

  it("allows close from investigating with audit + verification", () => {
    let rc = openCase();
    rc = apply(rc, { kind: "investigate", initiatedAt: NOW + 1 });
    const r = applyRecoveryCommandWithEvidenceChain(rc, {
      kind: "close",
      initiatedAt: NOW + 2,
      evidence: [evidenceRef("audit:aborted"), evidenceRef("verification:no-fix")],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.to).toBe("closed");
  });

  it("uses evidence already attached to the case (not just supplied with the command)", () => {
    let rc = openCase();
    // investigate + propose attach evidence to the case.
    rc = apply(rc, {
      kind: "investigate",
      initiatedAt: NOW + 1,
      evidence: [evidenceRef("verification:device-located")],
    });
    rc = apply(rc, {
      kind: "propose",
      initiatedAt: NOW + 2,
      evidence: [evidenceRef("diagnosis:root-cause")],
    });
    // The Wave 0 contract requires the resolve command itself to carry at
    // least one piece of evidence. The Wave 2 evidence-chain wrapper
    // additionally consults the case's accumulated evidence. So the
    // command supplies one verification (satisfying the Wave 0 contract),
    // and the diagnosis from the case's history satisfies the second
    // requirement of the rule.
    const r = applyRecoveryCommandWithEvidenceChain(rc, {
      kind: "resolve",
      initiatedAt: NOW + 3,
      reason: "fixed",
      evidence: [evidenceRef("verification:fix-applied")],
    });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Post-mortem verification — verify the evidence chain of a fully-resolved case.
// ---------------------------------------------------------------------------

describe("recovery evidence-chain: post-mortem verification", () => {
  it("verifies a complete case where every transition had required evidence", () => {
    let rc = openCase();
    rc = apply(rc, { kind: "investigate", initiatedAt: NOW + 1, evidence: [evidenceRef("verification:device-located")] });
    rc = apply(rc, { kind: "propose", initiatedAt: NOW + 2, evidence: [evidenceRef("diagnosis:root-cause")] });
    rc = apply(rc, {
      kind: "resolve",
      initiatedAt: NOW + 3,
      reason: "fixed",
      evidence: [evidenceRef("verification:fix-applied"), evidenceRef("diagnosis:confirmed")],
    });
    rc = apply(rc, { kind: "close", initiatedAt: NOW + 4, evidence: [evidenceRef("audit:case-closed")] });
    const v = verifyCaseEvidenceChainPostMortem(rc);
    expect(v.transitionsChecked).toBe(4);
    // resolve + close had rules; investigate and propose had no rules.
    expect(v.rulesSatisfied).toBeGreaterThanOrEqual(2);
    expect(v.failedTransitions).toHaveLength(0);
  });

  it("flags transitions that had insufficient evidence", () => {
    let rc = openCase();
    // resolve from proposal WITHOUT evidence — but applyRecoveryCommand
    // (Wave 0) does not enforce evidence-chain rules. We're testing the
    // post-mortem verifier's ability to detect this.
    let r = applyRecoveryCommand(rc, { kind: "investigate", initiatedAt: NOW + 1 });
    if (!r.ok) throw new Error();
    rc = r.case;
    r = applyRecoveryCommand(rc, { kind: "propose", initiatedAt: NOW + 2 });
    if (!r.ok) throw new Error();
    rc = r.case;
    r = applyRecoveryCommand(rc, {
      kind: "resolve",
      initiatedAt: NOW + 3,
      reason: "fixed",
      evidence: [evidenceRef("verification:fix-applied")], // missing diagnosis
    });
    if (!r.ok) throw new Error();
    rc = r.case;
    r = applyRecoveryCommand(rc, { kind: "close", initiatedAt: NOW + 4, evidence: [evidenceRef("audit:close")] });
    if (!r.ok) throw new Error();
    rc = r.case;
    const v = verifyCaseEvidenceChainPostMortem(rc);
    expect(v.failedTransitions.length).toBeGreaterThan(0);
    const failedResolve = v.failedTransitions.find((f) => f.command === "resolve");
    expect(failedResolve).toBeDefined();
    expect(failedResolve?.reason).toBe("insufficient-evidence-count");
  });

  it("post-mortem treats transitions with no rule as 'no requirement' (NOT a failure)", () => {
    // investigate from open has no rule — should NOT count as a failure.
    let rc = openCase();
    const r1 = applyRecoveryCommand(rc, {
      kind: "investigate",
      initiatedAt: NOW + 1,
      evidence: [],
    });
    if (!r1.ok) throw new Error("investigate should succeed");
    rc = r1.case;
    const v = verifyCaseEvidenceChainPostMortem(rc);
    expect(v.failedTransitions).toHaveLength(0);
    expect(v.transitionsChecked).toBe(1);
    expect(v.rulesSatisfied).toBe(0); // no rule was satisfied either
  });

  it("defaultEvidenceChainRules exposes 3 rules (resolve from proposal, close from investigating, close from resolved)", () => {
    const rules = defaultEvidenceChainRules();
    expect(rules).toHaveLength(3);
    const commands = rules.map((r) => `${r.fromState}:${r.command}`).sort();
    expect(commands).toContain("proposal:resolve");
    expect(commands).toContain("investigating:close");
    expect(commands).toContain("resolved:close");
  });
});
