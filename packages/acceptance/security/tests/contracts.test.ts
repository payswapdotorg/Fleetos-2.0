/**
 * F270B contract tests — vocabulary laws, corpus invariants, boundary
 * declarations, and the pure deterministic helpers.
 */

import { describe, expect, it } from "vitest";
import {
  JOURNEY_ALLOWED_PACKAGES,
  JOURNEY_CAPABILITIES,
  JOURNEY_PERSONAS,
  canonicalEquals,
  canonicalJson,
  fnv1a,
  toJourneyReport,
  verifyJourneyReport,
} from "../src/journey-contracts.ts";
import type { JourneyReport } from "../src/journey-contracts.ts";
import { SECURITY_JOURNEYS } from "../src/journeys/index.ts";
import { isoOfEpochMs, BASE_MS, NOW_MS } from "../src/journeys/fixture-world.ts";
import { runJourney } from "../src/runner.ts";

describe("F270B journey contracts", () => {
  it("the persona vocabulary is fixed at exactly 7", () => {
    expect(JOURNEY_PERSONAS.length).toBe(7);
    expect(JOURNEY_PERSONAS).toEqual([
      "security-analyst",
      "remediation-engineer",
      "tenant-operator",
      "automation-agent",
      "site-reliability-engineer",
      "compliance-auditor",
      "ml-engineer",
    ]);
  });

  it("the capability vocabulary covers the F270B deliverable list", () => {
    expect(JOURNEY_CAPABILITIES.length).toBe(13);
    for (const capability of [
      "investigate-findings",
      "understand-evidence",
      "guardian-decision",
      "action-plans",
      "execution-ledger",
      "reasoning-context",
      "predictive-advice",
      "counterfactual-reasoning",
      "decision-provenance",
      "learning-from-outcomes",
      "benchmark-trust",
      "agent-safety",
      "tenant-isolation",
    ]) {
      expect(JOURNEY_CAPABILITIES).toContain(capability);
    }
  });

  it("every journey id is unique", () => {
    const ids = SECURITY_JOURNEYS.map((j) => j.journeyId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("security."))).toBe(true);
  });

  it("every journey persona and capabilities come from the fixed vocabularies", () => {
    for (const j of SECURITY_JOURNEYS) {
      expect(JOURNEY_PERSONAS).toContain(j.persona);
      expect(j.capabilities.length).toBeGreaterThan(0);
      for (const capability of j.capabilities) {
        expect(JOURNEY_CAPABILITIES).toContain(capability);
      }
    }
  });

  it("every step declares only THIS lane's packages", () => {
    for (const j of SECURITY_JOURNEYS) {
      for (const step of j.steps) {
        expect(step.packages.length).toBeGreaterThan(0);
        for (const pkg of step.packages) {
          expect(JOURNEY_ALLOWED_PACKAGES).toContain(pkg);
        }
      }
    }
  });

  it("every journey drives at least two steps and asserts at least ten facts", () => {
    for (const j of SECURITY_JOURNEYS) {
      expect(j.steps.length).toBeGreaterThanOrEqual(2);
      expect(j.assertions.length).toBeGreaterThanOrEqual(10);
      expect(j.goal.length).toBeGreaterThan(20);
    }
  });

  it("every step names the REAL public operations it drives", () => {
    for (const j of SECURITY_JOURNEYS) {
      for (const step of j.steps) {
        expect(step.operations.length).toBeGreaterThan(0);
        expect(step.description.length).toBeGreaterThan(10);
      }
    }
  });

  it("every assertion path is recorded by a step run (no aspirational assertions)", () => {
    for (const j of SECURITY_JOURNEYS) {
      const { facts } = runJourney(j);
      for (const a of j.assertions) {
        expect(Object.keys(facts)).toContain(a.path);
      }
    }
  });

  it("the corpus covers all seven personas", () => {
    const used = new Set(SECURITY_JOURNEYS.map((j) => j.persona));
    expect(used.size).toBe(7);
  });

  it("the corpus covers all thirteen capabilities", () => {
    const used = new Set(SECURITY_JOURNEYS.flatMap((j) => [...j.capabilities]));
    expect(used.size).toBe(13);
  });
});

describe("F270B deterministic helpers", () => {
  it("isoOfEpochMs converts logical epochs to exact ISO strings (pure integer math)", () => {
    expect(isoOfEpochMs(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(isoOfEpochMs(BASE_MS)).toBe("2026-10-12T18:40:00.000Z");
    expect(isoOfEpochMs(NOW_MS)).toBe("2026-10-12T18:50:00.000Z");
    expect(isoOfEpochMs(1_753_526_400_000)).toBe("2025-07-26T10:40:00.000Z");
  });

  it("fnv1a is stable and 8-hex", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("fleetos")).toBe(fnv1a("fleetos"));
    expect(fnv1a("fleetos")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("canonicalJson sorts object keys recursively (key order never matters)", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonicalJson([1, { z: 1, a: 2 }])).toBe('[1,{"a":2,"z":1}]');
  });

  it("canonicalEquals deep-compares JSON-safe values", () => {
    expect(canonicalEquals({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(canonicalEquals({ a: 1 }, { a: 2 })).toBe(false);
    expect(canonicalEquals([1, 2], [2, 1])).toBe(false);
    expect(canonicalEquals(null, null)).toBe(true);
  });
});

describe("F270B journey report (double-digest form)", () => {
  const outcome = runJourney(SECURITY_JOURNEYS[0]!).outcome;
  const report = toJourneyReport(outcome);

  it("wraps an outcome with a report digest distinct from the inner digest", () => {
    expect(report.reportDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(report.reportDigest).not.toBe(report.digest);
    expect(report.journeyId).toBe(outcome.journeyId);
    expect(report.pass).toBe(outcome.pass);
  });

  it("verifyJourneyReport accepts a genuine report", () => {
    expect(verifyJourneyReport(report)).toBe(true);
  });

  it("every corpus outcome converts to a report that verifies", () => {
    for (const j of SECURITY_JOURNEYS) {
      const r = toJourneyReport(runJourney(j).outcome);
      expect(verifyJourneyReport(r), j.journeyId).toBe(true);
    }
  });

  it("tampering with any presented field breaks the report digest", () => {
    const flipPass: JourneyReport = { ...report, pass: !report.pass };
    expect(verifyJourneyReport(flipPass)).toBe(false);
    const editedStep: JourneyReport = {
      ...report,
      steps: report.steps.map((s, i) => (i === 0 ? { ...s, detail: "forged" } : s)),
    };
    expect(verifyJourneyReport(editedStep)).toBe(false);
  });

  it("tampering with the INNER digest also breaks the report digest", () => {
    const forgedInner: JourneyReport = { ...report, digest: "deadbeef" };
    expect(verifyJourneyReport(forgedInner)).toBe(false);
  });

  it("a forged report digest is detected", () => {
    const forged: JourneyReport = { ...report, reportDigest: "deadbeef" };
    expect(verifyJourneyReport(forged)).toBe(false);
  });
});
