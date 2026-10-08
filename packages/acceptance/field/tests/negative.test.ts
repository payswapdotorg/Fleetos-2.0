/**
 * @fleetos/acceptance-field — fail-detection negative fixtures: a deliberately
 * broken journey MUST fail, with the actual vs expected values recorded. The
 * runner can never soft-pass a broken assertion.
 */

import { describe, expect, it } from "vitest";
import { enrollNewAssetJourney, trustworthyStateJourney } from "../src/journeys/index.js";
import { executeJourney } from "../src/runner.js";
import { verifyJourneyOutcome } from "../src/journey-contracts.js";
import { makeHandoffCarrier, verifyHandoffCarrier } from "../src/handoff.js";

describe("fail-detection negative fixtures", () => {
  it("a WRONG expected value fails the journey and records actual vs expected", () => {
    const broken = {
      ...enrollNewAssetJourney,
      assertions: enrollNewAssetJourney.assertions.map((a) =>
        a.id === "e11" ? { ...a, expected: 42 } : a,
      ),
    };
    const { outcome } = executeJourney(broken);
    expect(outcome.passed).toBe(false);
    expect(outcome.steps.every((s) => s.ok)).toBe(true); // steps fine — assertion caught it
    const e11 = outcome.assertions.find((a) => a.id === "e11");
    expect(e11?.pass).toBe(false);
    expect(e11?.expected).toBe(42);
    expect(e11?.actual).toBe(1);
  });

  it("a reading that was never recorded fails with the missing-reading marker", () => {
    const broken = {
      ...enrollNewAssetJourney,
      assertions: [
        ...enrollNewAssetJourney.assertions,
        { id: "e-missing", description: "reading never recorded", reading: "t99.overview.assets", op: "deep-equals" as const, expected: 1 },
      ],
    };
    const { outcome } = executeJourney(broken);
    expect(outcome.passed).toBe(false);
    const missing = outcome.assertions.find((a) => a.id === "e-missing");
    expect(missing?.pass).toBe(false);
    expect(missing?.actual).toBe("<missing-reading>");
  });

  it("an unmarked refusal step fails the journey (expectRefusal is opt-in)", () => {
    const broken = {
      ...trustworthyStateJourney,
      steps: trustworthyStateJourney.steps.map((s) =>
        s.id === "t10" ? { ...s, expectRefusal: undefined } : s,
      ),
    };
    const { outcome } = executeJourney(broken);
    expect(outcome.passed).toBe(false);
    expect(outcome.steps.find((s) => s.id === "t10")?.ok).toBe(false);
  });

  it("expectRefusal on a step the REAL API allows FAILS (no fake refusals)", () => {
    const broken = {
      ...enrollNewAssetJourney,
      steps: enrollNewAssetJourney.steps.map((s) =>
        s.id === "t1" ? { ...s, expectRefusal: true } : s,
      ),
    };
    const { outcome } = executeJourney(broken);
    expect(outcome.steps.find((s) => s.id === "t1")?.ok).toBe(false);
    expect(outcome.passed).toBe(false);
  });

  it("a tampered journey outcome digest no longer verifies", () => {
    const { outcome } = executeJourney(enrollNewAssetJourney);
    expect(verifyJourneyOutcome(outcome)).toBe(true);
    const tampered = { ...outcome, passed: false };
    expect(verifyJourneyOutcome(tampered)).toBe(false);
    const tamperedSteps = { ...outcome, steps: outcome.steps.slice(0, 1) };
    expect(verifyJourneyOutcome(tamperedSteps)).toBe(false);
  });

  it("tenancy fail-closed INSIDE journeys: the foreign-tenant taint refuses every view", () => {
    // The tenant-isolation journey already asserts this end-to-end; here the
    // same law is re-checked directly: a fresh context + a foreign-asset
    // taint must make the fleet overview refuse BEFORE any assertion runs.
    const { ctx, outcome } = executeJourney(enrollNewAssetJourney);
    expect(outcome.passed).toBe(true);
    ctx.foreignAsset = { id: "ast_foreign-9999", tenantId: "tnt_other-operator-9" };
    const tainted = executeJourney(
      {
        ...enrollNewAssetJourney,
        id: "taint-probe",
        steps: [{ id: "v1", summary: "assemble the overview over the tainted slice", op: { kind: "view.fleet-overview", now: 1_774_000_005_000 } }],
        assertions: [{ id: "q1", description: "the overview refuses the whole slice", reading: "v1.overview.rejected", op: "deep-equals", expected: "cross-tenant-ref" }],
      },
      { ctx },
    );
    expect(tainted.outcome.passed).toBe(true); // the probe journey documents the refusal
    expect(tainted.outcome.steps[0]?.ok).toBe(true); // refusal is an honest ok outcome
  });

  it("handoff carriers are tamper-evident (digest recompute)", () => {
    const carrier = makeHandoffCarrier({
      handoffId: "hd_test-01",
      fromRole: "field-technician",
      toRole: "fleet-operator",
      tenantId: "tnt_field-accept-01",
      producedAt: 1_774_000_000_000,
      summary: {
        findings: 1,
        openCaseIds: ["rc_1"],
        deviceIds: ["dev_1"],
        intentIdempotencyKey: "key-1",
        intentDigest: "d1",
        fieldViewDigest: "f1",
      },
    });
    expect(verifyHandoffCarrier(carrier)).toBe(true);
    expect(verifyHandoffCarrier({ ...carrier, summary: { ...carrier.summary, findings: 99 } })).toBe(false);
    expect(verifyHandoffCarrier({ ...carrier, tenantId: "tnt_other" })).toBe(false);
  });
});
