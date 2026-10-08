/**
 * F270B runner tests — determinism, honest failure semantics (a broken
 * journey MUST fail; no soft passes), step-error capture, and the negative
 * fixture required by the packet.
 */

import { describe, expect, it } from "vitest";
import { runJourney, runAllJourneys, verifyRunnerDeterminism } from "../src/runner.ts";
import type { AcceptanceJourney } from "../src/journey-contracts.ts";
import { canonicalEquals, verifyJourneyOutcome } from "../src/journey-contracts.ts";
import { SECURITY_JOURNEYS } from "../src/journeys/index.ts";
import { investigateFindingJourney } from "../src/journeys/investigate-finding.ts";
import { TENANT } from "../src/journeys/fixture-world.ts";

function brokenJourney(wrongExpected: string | number | boolean): AcceptanceJourney {
  return {
    journeyId: "fixture.broken-journey",
    persona: "security-analyst",
    capabilities: ["investigate-findings"],
    goal: "A deliberately broken journey — must FAIL, never softly pass",
    steps: [
      {
        stepId: "record-one-fact",
        kind: "intake",
        description: "Records a fact the assertion then contradicts",
        packages: ["@fleetos/security"],
        operations: ["runFindingIntake"],
        run: (ctx) => {
          ctx.record("fact", "real-value");
        },
      },
    ],
    assertions: [
      { assertionId: "broken-1", description: "Wrong expectation", path: "fact", expected: wrongExpected },
    ],
  };
}

const throwingJourney: AcceptanceJourney = {
  journeyId: "fixture.throwing-journey",
  persona: "security-analyst",
  capabilities: ["investigate-findings"],
  goal: "A step that throws must fail the journey with the message captured",
  steps: [
    {
      stepId: "throws",
      kind: "intake",
      description: "Throws a domain-shaped error",
      packages: ["@fleetos/security"],
      operations: ["runFindingIntake"],
      run: () => {
        throw new Error("domain refused: simulate");
      },
    },
  ],
  assertions: [],
};

describe("F270B journey runner", () => {
  it("runs the full corpus and produces one outcome per journey", () => {
    const outcomes = runAllJourneys(SECURITY_JOURNEYS);
    expect(outcomes.length).toBe(SECURITY_JOURNEYS.length);
    expect(outcomes.every((o) => o.pass)).toBe(true);
  });

  it("is byte-identical on re-run for every journey in the corpus", () => {
    for (const j of SECURITY_JOURNEYS) {
      const check = verifyRunnerDeterminism(j);
      expect(check.deterministic, j.journeyId).toBe(true);
    }
  });

  it("produces the same outcome object on repeated runs (canonical equality)", () => {
    const a = runJourney(investigateFindingJourney);
    const b = runJourney(investigateFindingJourney);
    expect(canonicalEquals(a.outcome, b.outcome)).toBe(true);
    expect(canonicalEquals(a.facts, b.facts)).toBe(true);
  });

  it("NEGATIVE FIXTURE: a deliberately-broken journey FAILS with actual vs expected", () => {
    const { outcome } = runJourney(brokenJourney("wrong-value"));
    expect(outcome.pass).toBe(false);
    expect(outcome.failedAssertionCount).toBe(1);
    const failed = outcome.assertions.find((a) => !a.pass);
    expect(failed).toBeDefined();
    expect(failed?.actual).toBe("real-value");
    expect(failed?.expected).toBe("wrong-value");
    expect(failed?.reason).toContain("actual");
    expect(outcome.steps.every((s) => s.ok)).toBe(true);
    expect(verifyJourneyOutcome(outcome)).toBe(true);
  });

  it("a step that throws FAILS the journey with the message captured", () => {
    const { outcome } = runJourney(throwingJourney);
    expect(outcome.pass).toBe(false);
    expect(outcome.passedStepCount).toBe(0);
    expect(outcome.steps[0]?.ok).toBe(false);
    expect(outcome.steps[0]?.detail).toBe("domain refused: simulate");
  });

  it("an assertion against a path nobody recorded is an honest failure", () => {
    const missingPath: AcceptanceJourney = {
      ...brokenJourney("x"),
      assertions: [{ assertionId: "missing-1", description: "No fact at this path", path: "never.recorded", expected: 1 }],
    };
    const { outcome } = runJourney(missingPath);
    expect(outcome.pass).toBe(false);
    expect(outcome.assertions[0]?.reason).toContain('no fact recorded at path "never.recorded"');
  });

  it("a duplicate fact path is surfaced as a step failure (fail-loud, no hidden overwrites)", () => {
    const duplicate: AcceptanceJourney = {
      ...brokenJourney("x"),
      steps: [
        {
          stepId: "records-twice",
          kind: "intake",
          description: "Records the same path twice",
          packages: ["@fleetos/security"],
          operations: ["runFindingIntake"],
          run: (ctx) => {
            ctx.record("fact", "a");
            ctx.record("fact", "b");
          },
        },
      ],
    };
    const { outcome } = runJourney(duplicate);
    expect(outcome.pass).toBe(false);
    expect(outcome.steps[0]?.ok).toBe(false);
    expect(outcome.steps[0]?.detail).toContain("duplicate fact path");
  });

  it("an empty-path record is refused as a step failure", () => {
    const emptyPath: AcceptanceJourney = {
      ...brokenJourney("x"),
      steps: [
        {
          stepId: "records-empty",
          kind: "intake",
          description: "Records under an empty path",
          packages: ["@fleetos/security"],
          operations: ["runFindingIntake"],
          run: (ctx) => {
            ctx.record("", "value");
          },
        },
      ],
    };
    const { outcome } = runJourney(emptyPath);
    expect(outcome.pass).toBe(false);
    expect(outcome.steps[0]?.detail).toContain("empty path");
  });

  it("journey outcomes carry the persona, capabilities and goal verbatim", () => {
    const { outcome } = runJourney(investigateFindingJourney);
    expect(outcome.persona).toBe("security-analyst");
    expect(outcome.capabilities).toEqual(["investigate-findings"]);
    expect(outcome.goal).toContain("real pipeline");
  });

  it("every failing assertion is listed, not just the first (no short-circuit hiding)", () => {
    const multi: AcceptanceJourney = {
      ...brokenJourney("wrong-1"),
      assertions: [
        { assertionId: "b-1", description: "first wrong", path: "fact", expected: "wrong-1" },
        { assertionId: "b-2", description: "second wrong", path: "fact", expected: "wrong-2" },
      ],
    };
    const { outcome } = runJourney(multi);
    expect(outcome.failedAssertionCount).toBe(2);
    expect(outcome.assertions.filter((a) => !a.pass).map((a) => a.assertionId)).toEqual(["b-1", "b-2"]);
  });

  it("tenancy is fail-closed INSIDE journeys: the fixture tenant is isolated", () => {
    const { facts } = runJourney(SECURITY_JOURNEYS[SECURITY_JOURNEYS.length - 1]!);
    expect(facts["views.offenderNamed"]).toBe("finding-foreign");
    expect(facts["posture.readRefused"]).toBe("posture.tenant-mismatch");
    expect(TENANT.tenantId).toBe("acme-ops");
  });
});
