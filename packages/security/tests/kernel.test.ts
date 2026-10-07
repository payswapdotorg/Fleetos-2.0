/**
 * Security kernel tests — finding lifecycle, suppression discipline,
 * posture worst-wins, honest unknown.
 *
 * Wave 1 (F210B) additions.
 */
import { describe, it, expect } from "vitest";
import {
  initLifecycle,
  suppressFinding,
  resolveFinding,
  expireSuppressions,
  isEffectivelyOpen,
  computePostureWorstWins,
  honestUnknownPosture,
  proposeRemediation,
} from "../src/index.ts";
import type { SecurityFinding } from "../src/index.ts";

function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    findingId: "f1",
    tenantId: "t1",
    kind: "auth.weak_credential",
    severity: "high",
    confidence: "confirmed",
    detectedAt: "2026-01-01T00:00:00.000Z",
    assetIds: ["a1"],
    description: "test finding",
    evidenceRefs: [],
    findingDigest: "dig1",
    ...overrides,
  };
}

// ---------- Lifecycle ----------

describe("Finding lifecycle", () => {
  it("initLifecycle starts in open state", () => {
    const fwl = initLifecycle(makeFinding());
    expect(fwl.state).toBe("open");
    expect(fwl.suppression).toBeNull();
    expect(fwl.transitions).toHaveLength(0);
  });

  it("suppressFinding transitions to suppressed state", () => {
    const fwl = initLifecycle(makeFinding());
    const suppressed = suppressFinding(fwl, {
      suppressionId: "s1",
      suppressedBy: "user-1",
      suppressedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      reason: "false positive — under investigation",
    });
    expect(suppressed.state).toBe("suppressed");
    expect(suppressed.suppression).not.toBeNull();
    expect(suppressed.suppression!.active).toBe(true);
    expect(suppressed.transitions).toHaveLength(1);
    expect(suppressed.transitions[0]!.from).toBe("open");
    expect(suppressed.transitions[0]!.to).toBe("suppressed");
  });

  it("suppressed finding is NOT effectively open", () => {
    const fwl = initLifecycle(makeFinding());
    const suppressed = suppressFinding(fwl, {
      suppressionId: "s1",
      suppressedBy: "user-1",
      suppressedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      reason: "test",
    });
    expect(isEffectivelyOpen(suppressed)).toBe(false);
  });

  it("resolveFinding transitions to resolved state", () => {
    const fwl = initLifecycle(makeFinding());
    const resolved = resolveFinding(fwl, "2026-01-03T00:00:00.000Z", "user-1");
    expect(resolved.state).toBe("resolved");
    expect(resolved.suppression).toBeNull();
    expect(resolved.transitions).toHaveLength(1);
  });

  it("resolveFinding clears suppression", () => {
    const fwl = initLifecycle(makeFinding());
    const suppressed = suppressFinding(fwl, {
      suppressionId: "s1",
      suppressedBy: "user-1",
      suppressedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      reason: "test",
    });
    const resolved = resolveFinding(suppressed, "2026-01-03T00:00:00.000Z", "user-1");
    expect(resolved.state).toBe("resolved");
    expect(resolved.suppression).toBeNull();
  });

  it("suppressed != resolved (the key invariant)", () => {
    const fwl = initLifecycle(makeFinding());
    const suppressed = suppressFinding(fwl, {
      suppressionId: "s1",
      suppressedBy: "user-1",
      suppressedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      reason: "test",
    });
    expect(suppressed.state).toBe("suppressed");
    expect(suppressed.state).not.toBe("resolved");
  });
});

// ---------- Suppression expiry ----------

describe("expireSuppressions", () => {
  it("does not expire suppressions that haven't reached expiry", () => {
    const fwl = initLifecycle(makeFinding());
    const suppressed = suppressFinding(fwl, {
      suppressionId: "s1",
      suppressedBy: "user-1",
      suppressedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-12-31T00:00:00.000Z",
      reason: "test",
    });
    const result = expireSuppressions([suppressed], "2026-06-01T00:00:00.000Z");
    expect(result[0]!.state).toBe("suppressed");
    expect(result[0]!.suppression!.active).toBe(true);
  });

  it("expires suppressions past their expiresAt", () => {
    const fwl = initLifecycle(makeFinding());
    const suppressed = suppressFinding(fwl, {
      suppressionId: "s1",
      suppressedBy: "user-1",
      suppressedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      reason: "test",
    });
    const result = expireSuppressions([suppressed], "2026-03-01T00:00:00.000Z");
    expect(result[0]!.state).toBe("expired_suppression");
    expect(result[0]!.suppression!.active).toBe(false);
    expect(result[0]!.transitions).toHaveLength(2);
  });

  it("expired suppression finding IS effectively open", () => {
    const fwl = initLifecycle(makeFinding());
    const suppressed = suppressFinding(fwl, {
      suppressionId: "s1",
      suppressedBy: "user-1",
      suppressedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      reason: "test",
    });
    const result = expireSuppressions([suppressed], "2026-03-01T00:00:00.000Z");
    expect(isEffectivelyOpen(result[0]!)).toBe(true);
  });

  it("does not affect open or resolved findings", () => {
    const open = initLifecycle(makeFinding({ findingId: "f-open" }));
    const resolved = resolveFinding(initLifecycle(makeFinding({ findingId: "f-resolved" })), "2026-01-03T00:00:00.000Z", "u1");
    const result = expireSuppressions([open, resolved], "2026-12-01T00:00:00.000Z");
    expect(result[0]!.state).toBe("open");
    expect(result[1]!.state).toBe("resolved");
  });
});

// ---------- Posture worst-wins ----------

describe("computePostureWorstWins", () => {
  it("returns score=100 when no open findings", () => {
    const fwl = initLifecycle(makeFinding({ severity: "critical" }));
    const resolved = resolveFinding(fwl, "2026-01-03T00:00:00.000Z", "u1");
    const posture = computePostureWorstWins("t1", [resolved]);
    expect(posture.postureScore).toBe(100);
    expect(posture.totalFindings).toBe(0);
  });

  it("worst-wins: critical open finding => score=0", () => {
    const fwl = initLifecycle(makeFinding({ severity: "critical" }));
    const posture = computePostureWorstWins("t1", [fwl]);
    expect(posture.postureScore).toBe(0);
    expect(posture.bySeverity.critical).toBe(1);
  });

  it("worst-wins: high open finding => score=20", () => {
    const fwl = initLifecycle(makeFinding({ severity: "high" }));
    const posture = computePostureWorstWins("t1", [fwl]);
    expect(posture.postureScore).toBe(20);
  });

  it("worst-wins: medium open finding => score=40", () => {
    const fwl = initLifecycle(makeFinding({ severity: "medium" }));
    const posture = computePostureWorstWins("t1", [fwl]);
    expect(posture.postureScore).toBe(40);
  });

  it("suppressed findings are excluded from posture", () => {
    const open = initLifecycle(makeFinding({ findingId: "f-open", severity: "medium" }));
    const suppressed = suppressFinding(initLifecycle(makeFinding({ findingId: "f-supp", severity: "critical" })), {
      suppressionId: "s1",
      suppressedBy: "user-1",
      suppressedAt: "2026-01-02T00:00:00.000Z",
      expiresAt: "2026-12-31T00:00:00.000Z",
      reason: "test",
    });
    const posture = computePostureWorstWins("t1", [open, suppressed]);
    // Only the medium open finding counts — the critical is suppressed
    expect(posture.postureScore).toBe(40);
    expect(posture.totalFindings).toBe(1);
  });

  it("degraded=true when any open finding has tentative confidence", () => {
    const fwl = initLifecycle(makeFinding({ confidence: "tentative" }));
    const posture = computePostureWorstWins("t1", [fwl]);
    expect(posture.degraded).toBe(true);
  });

  it("degraded=false when all open findings are confirmed", () => {
    const fwl = initLifecycle(makeFinding({ confidence: "confirmed" }));
    const posture = computePostureWorstWins("t1", [fwl]);
    expect(posture.degraded).toBe(false);
  });
});

// ---------- Honest unknown posture ----------

describe("honestUnknownPosture", () => {
  it("returns degraded=true when all findings are tentative", () => {
    const findings = [makeFinding({ confidence: "tentative" })];
    const posture = honestUnknownPosture("t1", findings);
    expect(posture.degraded).toBe(true);
    expect(posture.postureScore).toBe(50); // middle — honest unknown
  });

  it("returns score=100 when no findings", () => {
    const posture = honestUnknownPosture("t1", []);
    expect(posture.postureScore).toBe(100);
    expect(posture.degraded).toBe(false);
  });
});

// ---------- Remediation workflow ----------

describe("Remediation workflow tied to action-protocol", () => {
  it("proposeRemediation requires Guardian authorization for high severity", () => {
    const findings = [makeFinding({ severity: "high" })];
    const proposal = proposeRemediation(findings);
    expect(proposal.requiresGuardianAuthorization).toBe(true);
  });

  it("proposeRemediation does NOT require Guardian for low severity", () => {
    const findings = [makeFinding({ severity: "low" })];
    const proposal = proposeRemediation(findings);
    expect(proposal.requiresGuardianAuthorization).toBe(false);
  });

  it("proposeRemediation uses isolate for critical severity", () => {
    const findings = [makeFinding({ severity: "critical" })];
    const proposal = proposeRemediation(findings);
    expect(proposal.remediationKind).toBe("isolate");
  });

  it("proposeRemediation is deterministic — same inputs => same proposalId", () => {
    const findings = [makeFinding({ findingId: "f1" }), makeFinding({ findingId: "f2", severity: "low" })];
    const p1 = proposeRemediation(findings);
    const p2 = proposeRemediation(findings);
    expect(p1.proposalId).toBe(p2.proposalId);
  });
});
