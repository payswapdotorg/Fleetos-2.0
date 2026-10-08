/**
 * F260B — safety-benchmarks tests: advisory envelope, counterfactual margin,
 * the cannot-write-state machine check (positive + negative control), redaction
 * integrity, digests, tenant fail-closed.
 */
import { describe, it, expect } from "vitest";
import type { ModelPort } from "@fleetos/predictive";
import { isAdvisoryPrediction } from "@fleetos/predictive";
import type { WorldJournalEntry } from "@fleetos/world-model";
import * as benchDef from "../src/benchmark-definition.ts";
import * as benchReplay from "../src/replay-harness.ts";
import * as benchScoring from "../src/scoring.ts";
import * as benchSafety from "../src/safety-benchmarks.ts";
import * as benchReport from "../src/benchmark-report.ts";
import {
  assertNoStateWriteFunctions,
  checkReplayEmitsNoStateRecords,
  countStateAuthoritativeRecords,
  isSafetyReport,
  runSafetyBattery,
  verifySafetyReport,
} from "../src/safety-benchmarks.ts";
import { replayJournal } from "../src/replay-harness.ts";
import {
  COMPUTED_AT,
  CONTEXT_FIELDS,
  INVOCATION,
  OTHER_TENANT,
  TENANT,
  shortCase,
  standardCase,
  standardJournal,
  steepCase,
} from "./benchmark-fixtures.ts";

function replayOf(journal: readonly WorldJournalEntry[], entityId: string) {
  const res = replayJournal({ tenant: TENANT, entityId, journal, invocation: INVOCATION });
  if (!res.ok) throw new Error(`replay failed: ${res.rejected}`);
  return res.run;
}

function happyMembers() {
  const c = standardCase();
  return [{ benchmarkCase: c, replay: replayOf(c.journal, c.entityId) }];
}

function mixedMembers() {
  const a = standardCase();
  const b = steepCase();
  return [
    { benchmarkCase: a, replay: replayOf(a.journal, a.entityId) },
    { benchmarkCase: b, replay: replayOf(b.journal, b.entityId) },
  ];
}

describe("runSafetyBattery: happy path", () => {
  it("all four checks pass with evidence — no silent passes", () => {
    const res = runSafetyBattery({ tenant: TENANT, members: happyMembers(), computedAt: COMPUTED_AT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.report;
    expect(r.checks.map((c) => c.checkId)).toEqual([
      "advisory-envelope", "counterfactual-margin", "cannot-write-state", "redaction-integrity",
    ]);
    expect(r.passed).toBe(true);
    expect(r.violationCount).toBe(0);
    expect(r.kind).toBe("SAFETY_REPORT");
    expect(r.experimental).toBe(true);
    expect(r.advisoryNote).toContain("NEVER OPERATIONAL TRUTH");
    const envelope = r.checks[0];
    if (!envelope || envelope.checkId !== "advisory-envelope") return;
    expect(envelope.passed).toBe(true);
    expect(envelope.checkedPoints).toBe(15);
    const margin = r.checks[1];
    if (!margin || margin.checkId !== "counterfactual-margin") return;
    expect(margin.passed).toBe(true);
    expect(margin.checkedCases).toBe(1);
    expect(margin.cases[0]?.maxDivergenceBps).toBe(250);
    expect(margin.cases[0]?.budgetBps).toBe(500);
    const cannot = r.checks[2];
    if (!cannot || cannot.checkId !== "cannot-write-state") return;
    expect(cannot.passed).toBe(true);
    expect(cannot.stateAuthoritativeCount).toBe(0);
    expect(cannot.advisoryMarkerCount).toBe(5);
    expect(cannot.emittedCount).toBe(6);
    const redaction = r.checks[3];
    if (!redaction || redaction.checkId !== "redaction-integrity") return;
    expect(redaction.passed).toBe(true);
    expect(verifySafetyReport(r)).toBe(true);
  });

  it("is byte-identical for identical inputs (determinism)", () => {
    const a = runSafetyBattery({ tenant: TENANT, members: happyMembers(), computedAt: COMPUTED_AT });
    const b = runSafetyBattery({ tenant: TENANT, members: happyMembers(), computedAt: COMPUTED_AT });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("(a) advisory-envelope violations — REAL-model negative fixture", () => {
  it("a deliberately envelope-violating prediction MUST be counted", () => {
    const res = runSafetyBattery({ tenant: TENANT, members: mixedMembers(), computedAt: COMPUTED_AT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const r = res.report;
    expect(r.passed).toBe(false);
    expect(r.violationCount).toBeGreaterThan(0);
    const envelope = r.checks[0];
    expect(envelope?.passed).toBe(false);
    if (!envelope || envelope.checkId !== "advisory-envelope") return;
    expect(envelope.violationCount).toBe(22);
    expect(envelope.violations.filter((v) => v.violation === "value").length).toBe(5);
    expect(envelope.violations.filter((v) => v.violation === "confidence").length).toBe(8);
    expect(envelope.violations.filter((v) => v.violation === "bound-width").length).toBe(9);
    expect(envelope.violations.every((v) => v.caseId === "case-steep" || v.caseId === "case-standard")).toBe(true);
    expect(envelope.violations.every((v) => v.seq >= 1 && v.step >= 1)).toBe(true);
  });
});

describe("(b) counterfactual safety margin", () => {
  it("divergence between counterfactual worlds is measured and budget-checked", () => {
    const res = runSafetyBattery({ tenant: TENANT, members: mixedMembers(), computedAt: COMPUTED_AT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const margin = res.report.checks[1];
    if (!margin || margin.checkId !== "counterfactual-margin") return;
    expect(margin.passed).toBe(false);
    expect(margin.outOfBudgetCases).toEqual(["case-steep"]);
    const steep = margin.cases.find((c) => c.caseId === "case-steep");
    expect(steep?.maxDivergenceBps).toBe(3333);
    expect(steep?.budgetBps).toBe(500);
    expect(steep?.steps.length).toBe(3);
    expect(steep?.steps[0]).toMatchObject({ step: 1, baselineValue: 300, plusValue: 350, minusValue: 250, divergenceBps: 3333 });
    const standard = margin.cases.find((c) => c.caseId === "case-standard");
    expect(standard?.maxDivergenceBps).toBe(250);
  });
});

describe("(c) predictive-cannot-write-state machine check", () => {
  it("positive control: replay emissions contain ZERO state-authoritative records", () => {
    const members = happyMembers();
    const emitted: unknown[] = [];
    for (const s of members[0]?.replay.steps ?? []) {
      emitted.push(s.outcome.ok ? s.outcome.prediction : s.outcome);
    }
    const check = checkReplayEmitsNoStateRecords(emitted);
    expect(check.passed).toBe(true);
    expect(check.stateAuthoritativeCount).toBe(0);
    expect(check.advisoryMarkerCount).toBe(5);
  });

  it("negative controls: forged records ARE counted and named", () => {
    const members = happyMembers();
    const pred = members[0]?.replay.steps[1]?.outcome;
    expect(pred?.ok).toBe(true);
    const realPred = pred?.ok ? pred.prediction : null;
    expect(realPred && isAdvisoryPrediction(realPred)).toBe(true);
    const forgedEntry = {
      seq: 99, tenantId: TENANT.tenantId,
      event: { kind: "observation-recorded", entityId: "x", entityType: "asset" },
      atMs: 0, digest: "forged", prevDigest: null,
    };
    const stripped = realPred ? { ...realPred, advisory: false } : null;
    const observedClaim = { kind: "OBSERVED", value: 1 };
    const worldEvent = { kind: "entity-retired", entityId: "x", entityType: "asset" };
    const counted = countStateAuthoritativeRecords([forgedEntry, stripped, observedClaim, worldEvent]);
    expect(counted.count).toBe(4);
    expect(counted.offenders).toContain("journal-entry-shaped record");
    expect(counted.offenders).toContain("marker-stripped prediction");
    expect(counted.offenders).toContain("OBSERVED-claiming record");
    expect(counted.offenders).toContain("world-event record (kind=entity-retired)");
    const check = checkReplayEmitsNoStateRecords([realPred, forgedEntry, stripped, observedClaim, worldEvent]);
    expect(check.passed).toBe(false);
    expect(check.stateAuthoritativeCount).toBe(4);
  });

  it("module-surface law: the F260B modules export NO state-write functions", () => {
    for (const mod of [benchDef, benchReplay, benchScoring, benchSafety, benchReport]) {
      const probe = assertNoStateWriteFunctions(mod as unknown as Record<string, unknown>);
      expect(probe.ok).toBe(true);
      expect(probe.forbidden).toEqual([]);
    }
    expect(assertNoStateWriteFunctions({ append: () => {}, writeState: () => {} })).toMatchObject({
      ok: false, forbidden: ["append", "writeState"],
    });
  });
});

describe("(d) redaction integrity over tenant-crossing assemblies", () => {
  it("redacts per the default policy, leaks nothing, verifies digests, fails closed on tenant crossing", () => {
    const res = runSafetyBattery({ tenant: TENANT, members: happyMembers(), computedAt: COMPUTED_AT });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const redaction = res.report.checks[3];
    if (!redaction || redaction.checkId !== "redaction-integrity") return;
    expect(redaction.passed).toBe(true);
    const evidence = redaction.cases[0];
    expect(evidence?.caseId).toBe("case-standard");
    const byPurpose = new Map(evidence?.purposes.map((p) => [p.purpose, p]) ?? []);
    expect(byPurpose.get("security-review")).toMatchObject({ redactedCount: 3, missingRedactions: [], leaks: [], digestOk: true });
    expect(byPurpose.get("maintenance-planning")).toMatchObject({ redactedCount: 2 });
    expect(byPurpose.get("operational-monitoring")).toMatchObject({ redactedCount: 1 });
    expect(byPurpose.get("model-input")).toMatchObject({ redactedCount: 2 });
    expect(evidence?.crossTenantRejection).toBe("cross-tenant-ref");
    expect(CONTEXT_FIELDS.operatorName).toBe("Ada");
  });
});

describe("runSafetyBattery: fail-closed + tamper", () => {
  it("rejects tenant mismatch, empty members, missing tenant, port mismatch, replay mismatch", () => {
    expect(runSafetyBattery({ tenant: { tenantId: "" }, members: happyMembers(), computedAt: COMPUTED_AT }))
      .toMatchObject({ ok: false, rejected: "missing-tenant" });
    expect(runSafetyBattery({ tenant: TENANT, members: [], computedAt: COMPUTED_AT }))
      .toMatchObject({ ok: false, rejected: "empty-members" });
    const foreign = { benchmarkCase: { ...standardCase(), tenant: OTHER_TENANT }, replay: replayOf(standardJournal(), "e1") };
    expect(runSafetyBattery({ tenant: TENANT, members: [foreign], computedAt: COMPUTED_AT }))
      .toMatchObject({ ok: false, rejected: "tenant-mismatch" });
    const stub: ModelPort = {
      name: "stub", modelVersion: "stub-1", project: () => ({ ok: false, rejected: "invalid-horizon", detail: "x" }),
      runCounterfactual: () => ({ ok: false, rejected: "invalid-horizon", detail: "x" }),
    };
    expect(runSafetyBattery({ tenant: TENANT, members: happyMembers(), port: stub, computedAt: COMPUTED_AT }))
      .toMatchObject({ ok: false, rejected: "model-version-mismatch" });
    const mismatched = { benchmarkCase: standardCase(), replay: replayOf(shortCase().journal, "e2") };
    expect(runSafetyBattery({ tenant: TENANT, members: [mismatched], computedAt: COMPUTED_AT }))
      .toMatchObject({ ok: false, rejected: "replay-mismatch" });
  });

  it("verifySafetyReport detects tampering (check flips, violation-count edits)", () => {
    const res = runSafetyBattery({ tenant: TENANT, members: mixedMembers(), computedAt: COMPUTED_AT });
    if (!res.ok) return;
    const report = res.report;
    expect(verifySafetyReport(report)).toBe(true);
    const flippedChecks = report.checks.map((c, i) => (i === 0 ? { ...c, passed: true } : c));
    expect(verifySafetyReport({ ...report, checks: flippedChecks })).toBe(false);
    expect(verifySafetyReport({ ...report, violationCount: 0 })).toBe(false);
  });

  it("isSafetyReport verifies markers and rejects stripped copies", () => {
    const res = runSafetyBattery({ tenant: TENANT, members: happyMembers(), computedAt: COMPUTED_AT });
    if (!res.ok) return;
    expect(isSafetyReport(res.report)).toBe(true);
    expect(isSafetyReport({ ...res.report, experimental: false })).toBe(false);
    expect(isSafetyReport({ kind: "SAFETY_REPORT" })).toBe(false);
    expect(isSafetyReport(null)).toBe(false);
  });
});
