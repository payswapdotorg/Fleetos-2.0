/**
 * Findings intake pipeline tests (F220B, Wave 2).
 *
 * Behavior under test: per-stage rejection codes, deterministic fingerprints,
 * correlation-window escalation, per-candidate acks, pipeline metrics.
 */
import { describe, it, expect } from "vitest";
import {
  runFindingIntake,
  validateCandidate,
  dedupeCandidate,
  correlateCandidate,
  triageCandidate,
  escalateSeverity,
  findingDedupeFingerprint,
  findingCorrelationKey,
  DEFAULT_ESCALATION_RULES,
} from "../src/index.ts";
import type { FindingIntakeCandidate, AdmittedFinding } from "../src/index.ts";

const WINDOW = 60_000;

function makeCandidate(overrides: Partial<FindingIntakeCandidate> = {}): FindingIntakeCandidate {
  return {
    tenantId: "t1",
    kind: "auth.weak_credential",
    declaredSeverity: "medium",
    confidence: "confirmed",
    detectedAt: 1_000,
    assetIds: ["a1"],
    description: "weak credential detected",
    evidenceRefs: [],
    signalCount: 2,
    ...overrides,
  };
}

function mediumBurst(count: number, startAt: number, step = 10_000): FindingIntakeCandidate[] {
  return Array.from({ length: count }, (_, i) =>
    makeCandidate({ detectedAt: startAt + i * step, description: `occurrence ${i}` }),
  );
}

// ---------- Stage 1: validate ----------

describe("intake validate stage", () => {
  it("refuses a candidate without a tenant scope (fail-closed, A8)", () => {
    const v = validateCandidate(makeCandidate({ tenantId: "" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("validate.missing-tenant");
  });

  it("refuses an unknown finding kind", () => {
    const v = validateCandidate(makeCandidate({ kind: "not.a_kind" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("validate.unknown-kind");
  });

  it("refuses an invalid severity", () => {
    const v = validateCandidate(makeCandidate({ declaredSeverity: "ultra" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("validate.invalid-severity");
  });

  it("refuses an invalid confidence", () => {
    const v = validateCandidate(makeCandidate({ confidence: "maybe" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("validate.invalid-confidence");
  });

  it("refuses a negative / non-integer detectedAt", () => {
    expect(validateCandidate(makeCandidate({ detectedAt: -1 })).ok).toBe(false);
    const v = validateCandidate(makeCandidate({ detectedAt: 1.5 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("validate.invalid-detected-at");
  });

  it("refuses empty or non-string asset ids", () => {
    const v = validateCandidate(makeCandidate({ assetIds: ["a1", ""] }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("validate.invalid-asset-ids");
  });

  it("refuses an empty description", () => {
    const v = validateCandidate(makeCandidate({ description: "   " }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("validate.missing-description");
  });

  it("accepts a well-formed candidate", () => {
    expect(validateCandidate(makeCandidate()).ok).toBe(true);
  });
});

// ---------- Stage 2: dedupe ----------

describe("intake dedupe stage", () => {
  it("computes a deterministic fingerprint — identical inputs, identical digest", () => {
    const a = findingDedupeFingerprint(makeCandidate());
    const b = findingDedupeFingerprint(makeCandidate());
    expect(a).toBe(b);
  });

  it("fingerprint is order-insensitive over asset ids", () => {
    const a = findingDedupeFingerprint(makeCandidate({ assetIds: ["a1", "a2"] }));
    const b = findingDedupeFingerprint(makeCandidate({ assetIds: ["a2", "a1"] }));
    expect(a).toBe(b);
  });

  it("fingerprint differs when detectedAt differs (new detection, not duplicate)", () => {
    const a = findingDedupeFingerprint(makeCandidate({ detectedAt: 1_000 }));
    const b = findingDedupeFingerprint(makeCandidate({ detectedAt: 2_000 }));
    expect(a).not.toBe(b);
  });

  it("refuses an exact duplicate with duplicate-finding and the original finding id", () => {
    const run = runFindingIntake([makeCandidate(), makeCandidate()], { correlationWindowMs: WINDOW });
    const first = run.acks[0];
    const second = run.acks[1];
    expect(first?.ok).toBe(true);
    expect(second?.ok).toBe(false);
    if (second && !second.ok) {
      expect(second.reason).toBe("dedupe.duplicate-finding");
      expect(second.refusedAt).toBe("dedupe");
    }
    expect(run.admitted).toHaveLength(1);
    expect(run.metrics.failedByStage.dedupe).toBe(1);
  });

  it("dedupeCandidate reports the duplicate-of finding id", () => {
    const run = runFindingIntake([makeCandidate()], { correlationWindowMs: WINDOW });
    const d = dedupeCandidate(makeCandidate(), run.admitted);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.duplicateOf).toBe(run.admitted[0]!.findingId);
  });
});

// ---------- Stage 3: correlate ----------

describe("intake correlate stage", () => {
  it("correlation key is tenant|kind|sorted-assets — without time or description", () => {
    const key = findingCorrelationKey(makeCandidate({ assetIds: ["a2", "a1"] }));
    expect(key).toBe("t1|auth.weak_credential|a1,a2");
  });

  it("counts prior repeats within the window (occurrences includes the candidate)", () => {
    const run = runFindingIntake(mediumBurst(2, 1_000), { correlationWindowMs: WINDOW });
    const corr = correlateCandidate(makeCandidate({ detectedAt: 30_000, description: "third" }), run.admitted, WINDOW);
    expect(corr.occurrences).toBe(3);
  });

  it("does NOT correlate across tenants (A8 isolation)", () => {
    const run = runFindingIntake(mediumBurst(1, 1_000), { correlationWindowMs: WINDOW });
    const corr = correlateCandidate(
      makeCandidate({ tenantId: "t2", detectedAt: 2_000, description: "other tenant" }),
      run.admitted,
      WINDOW,
    );
    expect(corr.occurrences).toBe(1);
    expect(corr.correlationKey.startsWith("t2|")).toBe(true);
  });

  it("does NOT correlate repeats outside the window", () => {
    const run = runFindingIntake(mediumBurst(1, 1_000), { correlationWindowMs: WINDOW });
    const corr = correlateCandidate(
      makeCandidate({ detectedAt: 1_000 + WINDOW + 1, description: "much later" }),
      run.admitted,
      WINDOW,
    );
    expect(corr.occurrences).toBe(1);
  });
});

// ---------- Stage 4: triage + escalation ----------

describe("intake triage + escalation", () => {
  it("escalates medium -> high at the 3rd repeat within the window (deterministic)", () => {
    const run = runFindingIntake(mediumBurst(3, 1_000), { correlationWindowMs: WINDOW });
    const [f1, f2, f3] = run.admitted;
    expect(f1!.severity).toBe("medium");
    expect(f2!.severity).toBe("medium");
    expect(f3!.severity).toBe("high");
    expect(f3!.escalated).toBe(true);
    expect(f3!.declaredSeverity).toBe("medium");
    expect(f3!.occurrences).toBe(3);
  });

  it("two repeats within the window do NOT escalate (threshold is 3)", () => {
    const run = runFindingIntake(mediumBurst(2, 1_000), { correlationWindowMs: WINDOW });
    expect(run.admitted.every((f) => f.severity === "medium")).toBe(true);
  });

  it("a repeat OUTSIDE the window resets the occurrence count (no escalation)", () => {
    const burst = [
      makeCandidate({ detectedAt: 1_000, description: "1" }),
      makeCandidate({ detectedAt: 1_000 + WINDOW + 1, description: "2" }),
      makeCandidate({ detectedAt: 1_000 + 2 * (WINDOW + 1), description: "3" }),
    ];
    const run = runFindingIntake(burst, { correlationWindowMs: WINDOW });
    expect(run.admitted.every((f) => f.severity === "medium")).toBe(true);
  });

  it("escalation is stepwise and deterministic: high -> critical at 5 repeats", () => {
    expect(escalateSeverity("medium", 4)).toBe("high");
    expect(escalateSeverity("medium", 5)).toBe("critical"); // medium->high, then high->critical@5
    expect(escalateSeverity("high", 4)).toBe("high");
    expect(escalateSeverity("high", 5)).toBe("critical");
    expect(escalateSeverity("low", 99)).toBe("low"); // no rule for low
    expect(escalateSeverity("critical", 99)).toBe("critical"); // no rule above critical
  });

  it("custom escalation rules are honored deterministically", () => {
    const rules = [{ from: "low", to: "medium", repeatThreshold: 2 }] as const;
    expect(escalateSeverity("low", 1, rules)).toBe("low");
    expect(escalateSeverity("low", 2, rules)).toBe("medium");
    expect(escalateSeverity("medium", 2, rules)).toBe("medium");
  });

  it("a degraded-escalation never hides: declared severity stays on the record", () => {
    const run = runFindingIntake(mediumBurst(3, 1_000), { correlationWindowMs: WINDOW });
    const f3 = run.admitted[2]!;
    expect(f3.declaredSeverity).toBe("medium");
    expect(f3.severity).toBe("high");
  });

  it("tentative confidence degrades to info with fewer than 2 signals (honest unknown)", () => {
    const t = triageCandidate(makeCandidate({ confidence: "tentative", signalCount: 1 }), 1);
    expect(t.severity).toBe("info");
    expect(t.degraded).toBe(true);
    expect(t.escalated).toBe(false);
  });

  it("tentative confidence with enough signals keeps severity but flags degraded", () => {
    const t = triageCandidate(makeCandidate({ confidence: "tentative", signalCount: 3 }), 1);
    expect(t.severity).toBe("medium");
    expect(t.degraded).toBe(true);
  });
});

// ---------- The pipeline ----------

describe("intake pipeline", () => {
  it("acks each candidate independently — a refused candidate never aborts the batch", () => {
    const candidates = [
      makeCandidate({ tenantId: "" }),               // refused at validate
      makeCandidate({ detectedAt: 2_000, description: "ok" }), // admitted
      makeCandidate({ kind: "bogus" }),              // refused at validate
    ];
    const run = runFindingIntake(candidates, { correlationWindowMs: WINDOW });
    expect(run.acks).toHaveLength(3);
    expect(run.acks[0]!.ok).toBe(false);
    expect(run.acks[1]!.ok).toBe(true);
    expect(run.acks[2]!.ok).toBe(false);
    expect(run.admitted).toHaveLength(1);
    expect(run.metrics.received).toBe(3);
    expect(run.metrics.failedByStage.validate).toBe(2);
    expect(run.metrics.admitted).toBe(1);
  });

  it("refuses zero-signal candidates at the triage stage (insufficient signals)", () => {
    const run = runFindingIntake([makeCandidate({ signalCount: 0 })], { correlationWindowMs: WINDOW });
    const ack = run.acks[0]!;
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.refusedAt).toBe("triage");
      expect(ack.reason).toBe("triage.insufficient-signals");
    }
    expect(run.admitted).toHaveLength(0);
  });

  it("is deterministic — the same batch always yields the same admitted findings", () => {
    const batch = [
      ...mediumBurst(3, 1_000),
      makeCandidate({ kind: "device.firmware_outdated", assetIds: ["a9"], description: "fw old" }),
    ];
    const a = runFindingIntake(batch, { correlationWindowMs: WINDOW });
    const b = runFindingIntake(batch, { correlationWindowMs: WINDOW });
    expect(JSON.stringify(a.admitted)).toBe(JSON.stringify(b.admitted));
    expect(JSON.stringify(a.metrics)).toBe(JSON.stringify(b.metrics));
  });

  it("escalation happens WITHIN one batch (in-batch correlation is visible)", () => {
    const run = runFindingIntake(mediumBurst(3, 1_000), { correlationWindowMs: WINDOW });
    expect(run.admitted[2]!.severity).toBe("high");
  });

  it("admitted finding ids are content-addressed from the fingerprint + detectedAt", () => {
    const run = runFindingIntake([makeCandidate()], { correlationWindowMs: WINDOW });
    const f: AdmittedFinding = run.admitted[0]!;
    expect(f.findingId).toBe(`finding-${f.fingerprint}-${String(f.detectedAt)}`);
  });

  it("DEFAULT_ESCALATION_RULES are the documented table", () => {
    expect(DEFAULT_ESCALATION_RULES).toEqual([
      { from: "medium", to: "high", repeatThreshold: 3 },
      { from: "high", to: "critical", repeatThreshold: 5 },
    ]);
  });

  it("property-style loop: escalating bursts never exceed the rule table targets", () => {
    // Deterministic seeded loop — occurrences 1..12 over every base severity.
    for (const base of ["info", "low", "medium", "high", "critical"] as const) {
      for (let occ = 1; occ <= 12; occ += 1) {
        const result = escalateSeverity(base, occ);
        expect(["info", "low", "medium", "high", "critical"]).toContain(result);
        if (base === "info" || base === "low") expect(result).toBe(base);
        if (base === "critical") expect(result).toBe("critical");
      }
    }
  });
});
