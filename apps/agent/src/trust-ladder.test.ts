/**
 * @fleetos/agent — Wave 3 trust ladder tests (F230A).
 *
 * Covers:
 *   - Trust level ordering: trustGe
 *   - Capabilities by level: untrusted=none, low=observe, standard=+routine, elevated=+destructive+manage
 *   - hasCapability: the canonical gate predicate
 *   - Evidence requirements: low=attestation, standard=+behavior, elevated=+operator-auth
 *   - Trust transitions: upward requires evidence; downward requires reason
 *   - Refusal reasons: insufficient-evidence, missing-evidence-kind, missing-reason, same-level
 *   - Capability gate: trust-too-low refusal (low-trust agent CANNOT execute commands)
 *   - TrustState: initialTrustState + applyTrustTransition
 *   - Audit emission stability
 */

import { describe, it, expect } from "vitest";
import {
  applyTrustTransition,
  CAPABILITIES_BY_LEVEL,
  capabilitiesFor,
  evaluateTrustTransition,
  evidenceRequirementFor,
  gateCapability,
  hasCapability,
  initialTrustState,
  TRUST_LEVEL_ORDER,
  trustGe,
  type Capability,
  type EvidenceRef,
  type TrustLevel,
  type TrustTransitionInput,
} from "./trust-ladder.js";

const NOW = 1_727_000_000_000;
const AGENT = "agent-001";
const TENANT = "tnt_acme";

function mkEvidence(kinds: ReadonlyArray<string>): ReadonlyArray<EvidenceRef> {
  return kinds.map((k, i) => ({ kind: k, digest: `d-${i}`, observedAt: NOW + i }));
}

function mkTransition(from: TrustLevel, to: TrustLevel, evidence: ReadonlyArray<EvidenceRef> = [], reason?: string): TrustTransitionInput {
  return { agentId: AGENT, tenantId: TENANT, from, to, evidence, reason, at: NOW };
}

// ---------------------------------------------------------------------------
// Trust level ordering
// ---------------------------------------------------------------------------

describe("agent trust-ladder: level ordering", () => {
  it("TRUST_LEVEL_ORDER: untrusted=0, low=1, standard=2, elevated=3", () => {
    expect(TRUST_LEVEL_ORDER.untrusted).toBe(0);
    expect(TRUST_LEVEL_ORDER.low).toBe(1);
    expect(TRUST_LEVEL_ORDER.standard).toBe(2);
    expect(TRUST_LEVEL_ORDER.elevated).toBe(3);
  });

  it("trustGe: greater-or-equal predicate", () => {
    expect(trustGe("elevated", "untrusted")).toBe(true);
    expect(trustGe("untrusted", "elevated")).toBe(false);
    expect(trustGe("standard", "standard")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Capabilities by level
// ---------------------------------------------------------------------------

describe("agent trust-ladder: capabilities by level", () => {
  it("untrusted: no capabilities", () => {
    expect(CAPABILITIES_BY_LEVEL.untrusted).toEqual([]);
    expect(capabilitiesFor("untrusted")).toEqual([]);
  });

  it("low: observe only", () => {
    expect(capabilitiesFor("low")).toEqual(["observe"]);
  });

  it("standard: observe + execute-routine", () => {
    expect(capabilitiesFor("standard")).toEqual(["observe", "execute-routine"]);
  });

  it("elevated: observe + execute-routine + execute-destructive + manage-trust", () => {
    expect(capabilitiesFor("elevated")).toEqual(["observe", "execute-routine", "execute-destructive", "manage-trust"]);
  });

  it("hasCapability: low has observe but not execute-routine", () => {
    expect(hasCapability("low", "observe")).toBe(true);
    expect(hasCapability("low", "execute-routine")).toBe(false);
  });

  it("hasCapability: standard has execute-routine but not execute-destructive", () => {
    expect(hasCapability("standard", "execute-routine")).toBe(true);
    expect(hasCapability("standard", "execute-destructive")).toBe(false);
  });

  it("hasCapability: elevated has all capabilities", () => {
    const caps: Capability[] = ["observe", "execute-routine", "execute-destructive", "manage-trust"];
    for (const c of caps) expect(hasCapability("elevated", c)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Evidence requirements
// ---------------------------------------------------------------------------

describe("agent trust-ladder: evidence requirements", () => {
  it("untrusted -> low requires attestation", () => {
    const req = evidenceRequirementFor("untrusted", "low")!;
    expect(req.requiredKinds).toContain("attestation");
    expect(req.minCount).toBe(1);
  });

  it("low -> standard requires attestation + behavior-record", () => {
    const req = evidenceRequirementFor("low", "standard")!;
    expect(req.requiredKinds).toContain("attestation");
    expect(req.requiredKinds).toContain("behavior-record");
    expect(req.minCount).toBe(2);
  });

  it("standard -> elevated requires attestation + behavior + operator-authorization", () => {
    const req = evidenceRequirementFor("standard", "elevated")!;
    expect(req.requiredKinds).toContain("operator-authorization");
    expect(req.minCount).toBe(3);
  });

  it("downward transitions have no evidence requirement (null)", () => {
    expect(evidenceRequirementFor("elevated", "untrusted")).toBeNull();
    expect(evidenceRequirementFor("standard", "low")).toBeNull();
  });

  it("same-level transition has no evidence requirement (null)", () => {
    expect(evidenceRequirementFor("standard", "standard")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Trust transitions
// ---------------------------------------------------------------------------

describe("agent trust-ladder: transitions", () => {
  it("upward transition with full evidence succeeds", () => {
    const r = evaluateTrustTransition(mkTransition("untrusted", "low", mkEvidence(["attestation"])));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe("untrusted");
      expect(r.to).toBe("low");
      expect(r.grantedCapabilities).toEqual(["observe"]);
      expect(r.audit.intent).toBe("agent:trust:up:untrusted->low");
    }
  });

  it("upward transition with insufficient evidence is refused", () => {
    const r = evaluateTrustTransition(mkTransition("untrusted", "low", []));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("insufficient-evidence");
  });

  it("upward transition missing required evidence kind is refused", () => {
    // low -> standard requires attestation + behavior-record; provide 2 attestations (count ok, kind missing)
    const r = evaluateTrustTransition(mkTransition("low", "standard", mkEvidence(["attestation", "attestation"])));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-evidence-kind");
  });

  it("upward transition with all required kinds succeeds (standard -> elevated)", () => {
    const r = evaluateTrustTransition(mkTransition("standard", "elevated", mkEvidence(["attestation", "behavior-record", "operator-authorization"])));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.grantedCapabilities).toContain("execute-destructive");
  });

  it("downward transition without reason is refused (missing-reason)", () => {
    const r = evaluateTrustTransition(mkTransition("elevated", "untrusted", [], undefined));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("downward transition with reason succeeds (can skip levels)", () => {
    const r = evaluateTrustTransition(mkTransition("elevated", "untrusted", [], "security-incident"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe("elevated");
      expect(r.to).toBe("untrusted");
      expect(r.audit.intent).toContain("down");
    }
  });

  it("same-level transition is refused (same-level)", () => {
    const r = evaluateTrustTransition(mkTransition("standard", "standard", [], "no-op"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("same-level");
  });

  it("audit digest is stable for identical inputs (deterministic)", () => {
    const r1 = evaluateTrustTransition(mkTransition("untrusted", "low", mkEvidence(["attestation"])));
    const r2 = evaluateTrustTransition(mkTransition("untrusted", "low", mkEvidence(["attestation"])));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.audit.digest).toBe(r2.audit.digest);
  });
});

// ---------------------------------------------------------------------------
// Capability gate — trust-too-low refusal (low-trust agent CANNOT execute)
// ---------------------------------------------------------------------------

describe("agent trust-ladder: capability gate", () => {
  it("untrusted agent CANNOT observe (gate refuses)", () => {
    const r = gateCapability("untrusted", "observe");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("trust-too-low");
      expect(r.level).toBe("untrusted");
      expect(r.required).toBe("observe");
    }
  });

  it("low-trust agent CANNOT execute-routine (the spec requirement)", () => {
    const r = gateCapability("low", "execute-routine");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("trust-too-low");
  });

  it("standard-trust agent CAN execute-routine", () => {
    const r = gateCapability("standard", "execute-routine");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.granted).toBe("execute-routine");
  });

  it("standard-trust agent CANNOT execute-destructive", () => {
    const r = gateCapability("standard", "execute-destructive");
    expect(r.ok).toBe(false);
  });

  it("elevated-trust agent CAN execute-destructive", () => {
    const r = gateCapability("elevated", "execute-destructive");
    expect(r.ok).toBe(true);
  });

  it("elevated-trust agent CAN manage-trust", () => {
    const r = gateCapability("elevated", "manage-trust");
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TrustState lifecycle
// ---------------------------------------------------------------------------

describe("agent trust-ladder: TrustState lifecycle", () => {
  it("initialTrustState: untrusted level, zero transitions", () => {
    const s = initialTrustState(AGENT, TENANT, NOW);
    expect(s.level).toBe("untrusted");
    expect(s.transitionCount).toBe(0);
    expect(s.establishedAt).toBe(NOW);
    expect(s.lastTransitionAt).toBe(NOW);
  });

  it("applyTrustTransition: updates level + transitionCount on success", () => {
    const s0 = initialTrustState(AGENT, TENANT, NOW);
    const result = evaluateTrustTransition(mkTransition("untrusted", "low", mkEvidence(["attestation"])));
    const s1 = applyTrustTransition(s0, result, NOW + 1);
    expect(s1.level).toBe("low");
    expect(s1.transitionCount).toBe(1);
    expect(s1.lastTransitionAt).toBe(NOW + 1);
  });

  it("applyTrustTransition: NO change on failed transition", () => {
    const s0 = initialTrustState(AGENT, TENANT, NOW);
    const result = evaluateTrustTransition(mkTransition("untrusted", "low", [])); // insufficient evidence
    const s1 = applyTrustTransition(s0, result, NOW + 1);
    expect(s1.level).toBe(s0.level);
    expect(s1.transitionCount).toBe(s0.transitionCount);
  });

  it("applyTrustTransition: chain of transitions accumulates count", () => {
    let s = initialTrustState(AGENT, TENANT, NOW);
    const r1 = evaluateTrustTransition(mkTransition("untrusted", "low", mkEvidence(["attestation"])));
    s = applyTrustTransition(s, r1, NOW + 1);
    const r2 = evaluateTrustTransition({ ...mkTransition("low", "standard", mkEvidence(["attestation", "behavior-record"])), from: "low" });
    s = applyTrustTransition(s, r2, NOW + 2);
    const r3 = evaluateTrustTransition({ ...mkTransition("standard", "elevated", mkEvidence(["attestation", "behavior-record", "operator-authorization"])), from: "standard" });
    s = applyTrustTransition(s, r3, NOW + 3);
    expect(s.level).toBe("elevated");
    expect(s.transitionCount).toBe(3);
  });
});
