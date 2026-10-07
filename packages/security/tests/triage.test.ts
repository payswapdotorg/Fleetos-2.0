import { describe, it, expect } from "vitest";
import {
  triageSeverity,
  computePosture,
  proposeRemediation,
  type SecurityFinding,
} from "../src/index.ts";

function finding(severity: SecurityFinding["severity"], confidence: SecurityFinding["confidence"] = "confirmed"): SecurityFinding {
  return {
    findingId: `f-${severity}-${confidence}`,
    tenantId: "tenant-1",
    kind: "auth.weak_credential",
    severity,
    confidence,
    detectedAt: "1970-01-01T00:00:00.000Z",
    assetIds: ["a-1"],
    description: "test",
    evidenceRefs: [],
    findingDigest: `dig-${severity}-${confidence}`,
  };
}

describe("triageSeverity: determinism", () => {
  it("returns the same result for identical inputs", () => {
    const a = triageSeverity({ declared: "high", confidence: "confirmed", signalCount: 3 });
    const b = triageSeverity({ declared: "high", confidence: "confirmed", signalCount: 3 });
    expect(a).toEqual(b);
  });
});

describe("triageSeverity: honest degradation", () => {
  it("returns degraded for zero signals", () => {
    const r = triageSeverity({ declared: "critical", confidence: "confirmed", signalCount: 0 });
    expect(r.degraded).toBe(true);
    expect(r.reasonCode).toBe("triage.degraded_insufficient_signals");
  });

  it("returns degraded for tentative confidence with < 2 signals", () => {
    const r = triageSeverity({ declared: "high", confidence: "tentative", signalCount: 1 });
    expect(r.degraded).toBe(true);
    expect(r.severity).toBe("info");
    expect(r.reasonCode).toBe("triage.degraded_low_confidence");
  });

  it("downgrades tentative severity by one step when enough signals", () => {
    const r = triageSeverity({ declared: "high", confidence: "tentative", signalCount: 3 });
    expect(r.degraded).toBe(true);
    expect(r.severity).toBe("medium");
  });

  it("keeps confirmed severity as-declared", () => {
    const r = triageSeverity({ declared: "critical", confidence: "confirmed", signalCount: 5 });
    expect(r.degraded).toBe(false);
    expect(r.severity).toBe("critical");
    expect(r.reasonCode).toBe("triage.confirmed_critical");
  });
});

describe("computePosture", () => {
  it("returns 100 posture score for zero findings", () => {
    const p = computePosture("t1", []);
    expect(p.postureScore).toBe(100);
    expect(p.totalFindings).toBe(0);
    expect(p.degraded).toBe(false);
  });

  it("penalizes higher severities more than lower ones", () => {
    const low = computePosture("t1", [finding("low")]);
    const high = computePosture("t1", [finding("high")]);
    expect(high.postureScore).toBeLessThan(low.postureScore);
  });

  it("flags degraded when any finding is tentative", () => {
    const p = computePosture("t1", [finding("low", "tentative")]);
    expect(p.degraded).toBe(true);
  });

  it("is deterministic — same input => same output", () => {
    const inputs: readonly SecurityFinding[] = [finding("high"), finding("low"), finding("critical")];
    expect(computePosture("t1", inputs)).toEqual(computePosture("t1", inputs));
  });
});

describe("proposeRemediation", () => {
  it("requires Guardian authorization for high+ severity findings", () => {
    const p = proposeRemediation([finding("high"), finding("low")]);
    expect(p.requiresGuardianAuthorization).toBe(true);
  });

  it("does not require Guardian for sub-high findings", () => {
    const p = proposeRemediation([finding("low"), finding("medium")]);
    expect(p.requiresGuardianAuthorization).toBe(false);
  });

  it("picks isolate for critical findings", () => {
    const p = proposeRemediation([finding("critical")]);
    expect(p.remediationKind).toBe("isolate");
  });

  it("produces a stable proposalId for the same finding set", () => {
    const a = proposeRemediation([finding("high"), finding("low")]);
    const b = proposeRemediation([finding("low"), finding("high")]);
    expect(a.proposalId).toBe(b.proposalId);
  });
});
