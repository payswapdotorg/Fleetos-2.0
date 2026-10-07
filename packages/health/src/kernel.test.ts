import { describe, it, expect } from "vitest";
import {
  applyDiagnosisCommand,
  currentDiagnosisForDevice,
  emptyDiagnosisRegistry,
  listDiagnosesForDevice,
  lookupDiagnosis,
  proposeDiagnosis,
  registerDiagnosis,
  supersedeDiagnosis,
  triageWithConfidence,
  type DiagnosisHypothesisRecord,
} from "./kernel.js";
import type { ObservationLike } from "./health.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV1 = "dev_truck-001";

function obs(kind: string, deviceId: string = DEV1, at: number = NOW): ObservationLike {
  return { tenantId: TENANT_A, deviceId, seq: 1, observedAt: at, kind, payloadDigest: "0".repeat(64) };
}

function ev(digest: string) {
  return { digest, kind: "test", observedAt: NOW };
}

function propose(id: string, confidence = 0.6): { ok: true; hypothesis: DiagnosisHypothesisRecord; audit: any } | { ok: false; reason: any } {
  return proposeDiagnosis({
    id,
    tenantId: TENANT_A,
    deviceId: DEV1,
    candidateCauses: ["fault-1"],
    confidence,
    evidence: [ev("a".repeat(64))],
    emittedAt: NOW,
    actor: "act_a",
  });
}

describe("health kernel: triageWithConfidence", () => {
  it("returns degradation=insufficient-data for empty observations", () => {
    const r = triageWithConfidence([], NOW, TENANT_A);
    expect(r.degradation).toBe("insufficient-data");
    expect(r.findings).toHaveLength(0);
    expect(r.audit.intent).toBe("triage:degraded:insufficient-data");
  });

  it("returns degradation=unknown-signal-vocabulary for unknown kind", () => {
    const r = triageWithConfidence([obs("weird.kind")], NOW, TENANT_A);
    expect(r.degradation).toBe("unknown-signal-vocabulary");
  });

  it("returns a finding with confidence=0.2 for a single .error observation", () => {
    const r = triageWithConfidence([obs("telemetry.error")], NOW, TENANT_A);
    expect(r.findings).toHaveLength(1);
    if (r.findings.length > 0) {
      expect(r.findings[0]!.severity).toBe("warning");
      expect(r.findings[0]!.confidence).toBeCloseTo(1 / 5, 5);
    }
  });

  it("escalates to critical when count >= 3 for .error kind", () => {
    const r = triageWithConfidence([obs("telemetry.error"), obs("telemetry.error"), obs("telemetry.error")], NOW, TENANT_A);
    const f = r.findings[0]!;
    expect(f.severity).toBe("critical");
    expect(f.confidence).toBeCloseTo(3 / 5, 5);
  });

  it("saturates confidence at 1.0 when count >= 5", () => {
    const many = Array.from({ length: 6 }, () => obs("telemetry.error"));
    const r = triageWithConfidence(many, NOW, TENANT_A);
    expect(r.findings[0]!.confidence).toBe(1);
  });

  it("audit digest is deterministic for identical inputs", () => {
    const a = triageWithConfidence([obs("telemetry.error")], NOW, TENANT_A);
    const b = triageWithConfidence([obs("telemetry.error")], NOW, TENANT_A);
    expect(a.audit.digest).toBe(b.audit.digest);
  });

  it("audit intent is triage:complete when no degradation", () => {
    const r = triageWithConfidence([obs("telemetry.error")], NOW, TENANT_A);
    expect(r.audit.intent).toBe("triage:complete");
  });

  it("sorts findings by severity then deviceId for determinism", () => {
    const r = triageWithConfidence([obs("telemetry.error", "dev_zzz"), obs("telemetry.error", "dev_aaa")], NOW, TENANT_A);
    expect(r.findings[0]!.deviceId).toBe("dev_aaa");
    expect(r.findings[1]!.deviceId).toBe("dev_zzz");
  });
});

describe("health kernel: proposeDiagnosis validation", () => {
  it("proposes a diagnosis in the proposed state with seq=1", () => {
    const r = propose("diag_001");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hypothesis.state).toBe("proposed");
      expect(r.hypothesis.transitionSeq).toBe(1);
      expect(r.audit.intent).toBe("diagnosis:propose");
    }
  });

  it("rejects missing candidate causes (missing-reason)", () => {
    const r = proposeDiagnosis({
      id: "diag_001",
      tenantId: TENANT_A,
      deviceId: DEV1,
      candidateCauses: [],
      confidence: 0.5,
      evidence: [ev("a".repeat(64))],
      emittedAt: NOW,
      actor: "act_a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-reason");
  });

  it("rejects missing evidence (missing-evidence)", () => {
    const r = proposeDiagnosis({
      id: "diag_001",
      tenantId: TENANT_A,
      deviceId: DEV1,
      candidateCauses: ["fault-1"],
      confidence: 0.5,
      evidence: [],
      emittedAt: NOW,
      actor: "act_a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-evidence");
  });

  it("rejects out-of-range confidence (>1)", () => {
    const r = proposeDiagnosis({
      id: "diag_001",
      tenantId: TENANT_A,
      deviceId: DEV1,
      candidateCauses: ["fault-1"],
      confidence: 1.5,
      evidence: [ev("a".repeat(64))],
      emittedAt: NOW,
      actor: "act_a",
    });
    expect(r.ok).toBe(false);
  });
});

describe("health kernel: diagnosis hypothesis lifecycle", () => {
  it("proposed -> corroborated via corroborate", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const r = applyDiagnosisCommand(p.hypothesis, {
      kind: "corroborate",
      at: NOW + 1000,
      newEvidence: [ev("b".repeat(64))],
      actor: "act_a",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.to).toBe("corroborated");
      expect(r.next.transitionSeq).toBe(2);
      expect(r.audit.intent).toBe("diagnosis:corroborate");
    }
  });

  it("proposed -> resolved via resolve (with new evidence)", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const r = applyDiagnosisCommand(p.hypothesis, {
      kind: "resolve",
      at: NOW + 1000,
      newEvidence: [ev("c".repeat(64))],
      actor: "act_a",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("resolved");
  });

  it("resolve requires new evidence (missing-evidence)", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const r = applyDiagnosisCommand(p.hypothesis, {
      kind: "resolve",
      at: NOW + 1000,
      actor: "act_a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-evidence");
  });

  it("corroborated -> resolved via resolve", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const c = applyDiagnosisCommand(p.hypothesis, { kind: "corroborate", at: NOW + 1000, newEvidence: [ev("b".repeat(64))], actor: "act_a" });
    if (!c.ok) throw new Error("corroborate failed");
    const r = applyDiagnosisCommand(c.next, { kind: "resolve", at: NOW + 2000, newEvidence: [ev("d".repeat(64))], actor: "act_a" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.to).toBe("resolved");
  });

  it("resolved -> resolved (already-in-target-state)", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const r1 = applyDiagnosisCommand(p.hypothesis, { kind: "resolve", at: NOW + 1000, newEvidence: [ev("c".repeat(64))], actor: "act_a" });
    if (!r1.ok) throw new Error("resolve failed");
    const r2 = applyDiagnosisCommand(r1.next, { kind: "resolve", at: NOW + 2000, newEvidence: [ev("e".repeat(64))], actor: "act_a" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("already-in-target-state");
  });

  it("unknown command -> unknown-command", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const r = applyDiagnosisCommand(p.hypothesis, { kind: "frob" as never, at: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-command");
  });

  it("superseded is terminal (illegal-transition on corroborate)", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    // Force the hypothesis into superseded state via supersedeDiagnosis.
    const s = supersedeDiagnosis({
      prior: p.hypothesis,
      successorId: "diag_002",
      candidateCauses: ["fault-2"],
      confidence: 0.7,
      evidence: [ev("f".repeat(64))],
      at: NOW + 1000,
      actor: "act_a",
    });
    if (!s.ok) throw new Error("supersede failed");
    const r = applyDiagnosisCommand(s.prior, { kind: "corroborate", at: NOW + 2000, newEvidence: [ev("g".repeat(64))], actor: "act_a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });
});

describe("health kernel: supersession discipline (never mutate prior)", () => {
  it("supersedeDiagnosis creates a successor in proposed state with supersedes pointer", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const r = supersedeDiagnosis({
      prior: p.hypothesis,
      successorId: "diag_002",
      candidateCauses: ["fault-2"],
      confidence: 0.7,
      evidence: [ev("f".repeat(64))],
      at: NOW + 1000,
      actor: "act_a",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.successor.state).toBe("proposed");
      expect(r.successor.supersedes).toBe("diag_001");
      expect(r.prior.state).toBe("superseded");
      expect(r.prior.supersededBy).toBe("diag_002");
      expect(r.audit.intent).toBe("diagnosis:supersede");
    }
  });

  it("supersedeDiagnosis on already-superseded prior -> already-in-target-state", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const s1 = supersedeDiagnosis({ prior: p.hypothesis, successorId: "diag_002", candidateCauses: ["x"], confidence: 0.5, evidence: [ev("a".repeat(64))], at: NOW + 1000, actor: "a" });
    if (!s1.ok) throw new Error("supersede1 failed");
    const s2 = supersedeDiagnosis({ prior: s1.prior, successorId: "diag_003", candidateCauses: ["y"], confidence: 0.6, evidence: [ev("b".repeat(64))], at: NOW + 2000, actor: "a" });
    expect(s2.ok).toBe(false);
    if (!s2.ok) expect(s2.reason).toBe("already-in-target-state");
  });

  it("the prior's evidence list is not mutated by supersession", () => {
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const priorEvidenceCount = p.hypothesis.evidence.length;
    const s = supersedeDiagnosis({ prior: p.hypothesis, successorId: "diag_002", candidateCauses: ["x"], confidence: 0.5, evidence: [ev("c".repeat(64))], at: NOW + 1000, actor: "a" });
    if (!s.ok) throw new Error("supersede failed");
    expect(p.hypothesis.evidence.length).toBe(priorEvidenceCount);
    expect(s.prior.evidence.length).toBe(priorEvidenceCount);
  });
});

describe("health kernel: registry tenant fail-closed", () => {
  it("registerDiagnosis stores and lookupDiagnosis retrieves within tenant", () => {
    const reg = emptyDiagnosisRegistry();
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const next = registerDiagnosis(reg, p.hypothesis);
    expect(lookupDiagnosis(next, TENANT_A, "diag_001")).not.toBeNull();
  });

  it("lookupDiagnosis returns null for cross-tenant reads (fail-closed)", () => {
    const reg = emptyDiagnosisRegistry();
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const next = registerDiagnosis(reg, p.hypothesis);
    expect(lookupDiagnosis(next, TENANT_B, "diag_001")).toBeNull();
  });

  it("listDiagnosesForDevice returns only the matching tenant's diagnoses", () => {
    const reg = emptyDiagnosisRegistry();
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    const next = registerDiagnosis(reg, p.hypothesis);
    expect(listDiagnosesForDevice(next, TENANT_A, DEV1)).toHaveLength(1);
    expect(listDiagnosesForDevice(next, TENANT_B, DEV1)).toHaveLength(0);
  });

  it("currentDiagnosisForDevice returns the live (non-superseded) hypothesis", () => {
    const reg = emptyDiagnosisRegistry();
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    let next = registerDiagnosis(reg, p.hypothesis);
    expect(currentDiagnosisForDevice(next, TENANT_A, DEV1)?.id).toBe("diag_001");
    // Supersede and register the successor.
    const s = supersedeDiagnosis({ prior: p.hypothesis, successorId: "diag_002", candidateCauses: ["y"], confidence: 0.6, evidence: [ev("z".repeat(64))], at: NOW + 1000, actor: "a" });
    if (!s.ok) throw new Error("supersede failed");
    next = registerDiagnosis(next, s.prior);
    next = registerDiagnosis(next, s.successor);
    // The current diagnosis is now diag_002 (the successor).
    expect(currentDiagnosisForDevice(next, TENANT_A, DEV1)?.id).toBe("diag_002");
  });

  it("currentDiagnosisForDevice returns null when all hypotheses are superseded", () => {
    const reg = emptyDiagnosisRegistry();
    const p = propose("diag_001");
    if (!p.ok) throw new Error("propose failed");
    let next = registerDiagnosis(reg, p.hypothesis);
    const s = supersedeDiagnosis({ prior: p.hypothesis, successorId: "diag_002", candidateCauses: ["y"], confidence: 0.6, evidence: [ev("z".repeat(64))], at: NOW + 1000, actor: "a" });
    if (!s.ok) throw new Error("supersede failed");
    next = registerDiagnosis(next, s.prior);
    next = registerDiagnosis(next, s.successor);
    // Now supersede diag_002 with diag_003 but don't register diag_003.
    const s2 = supersedeDiagnosis({ prior: s.successor, successorId: "diag_003", candidateCauses: ["z"], confidence: 0.7, evidence: [ev("w".repeat(64))], at: NOW + 2000, actor: "a" });
    if (!s2.ok) throw new Error("supersede2 failed");
    next = registerDiagnosis(next, s2.prior);
    expect(currentDiagnosisForDevice(next, TENANT_A, DEV1)).toBeNull();
  });
});
