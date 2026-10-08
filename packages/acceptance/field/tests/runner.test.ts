/**
 * @fleetos/acceptance-field — runner tests: determinism, handoff threading,
 * refusal semantics, digest stamping. The runner is the ONLY thing that
 * executes journeys; these tests pin its laws.
 */

import { describe, expect, it } from "vitest";
import { FIELD_JOURNEYS } from "../src/journeys/index.js";
import { handoffConsumeJourney, trustworthyStateJourney, enrollNewAssetJourney } from "../src/journeys/index.js";
import { executeJourney, runJourneyCorpus } from "../src/runner.js";
import { journeyOutcomeDigest, verifyJourneyOutcome } from "../src/journey-contracts.js";

describe("journey runner", () => {
  it("re-running the whole corpus is byte-identical (same outcome digests)", () => {
    const first = runJourneyCorpus(FIELD_JOURNEYS);
    const second = runJourneyCorpus(FIELD_JOURNEYS);
    expect(first.map((o) => o.digest)).toEqual(second.map((o) => o.digest));
  });

  it("re-running a single journey is byte-identical, from a fresh context", () => {
    const first = executeJourney(enrollNewAssetJourney);
    const second = executeJourney(enrollNewAssetJourney);
    expect(first.outcome.digest).toBe(second.outcome.digest);
    expect(first.outcome.steps).toEqual(second.outcome.steps);
    expect(first.outcome.assertions).toEqual(second.outcome.assertions);
  });

  it("the corpus returns outcomes in declared journey order", () => {
    const outcomes = runJourneyCorpus(FIELD_JOURNEYS);
    expect(outcomes.map((o) => o.journeyId)).toEqual(FIELD_JOURNEYS.map((j) => j.id));
  });

  it("step outcomes carry the operation kind + persona-facing summary", () => {
    const { outcome } = executeJourney(enrollNewAssetJourney);
    expect(outcome.steps[0]?.kind).toBe("asset.admit");
    expect(outcome.steps[0]?.summary).toContain("admit the truck asset");
    expect(outcome.steps.every((s) => typeof s.summary === "string" && s.summary.length > 0)).toBe(true);
  });

  it("a refusal step marked expectRefusal passes and records the REAL reason code", () => {
    const { outcome } = executeJourney(trustworthyStateJourney);
    const t9 = outcome.steps.find((s) => s.id === "t9");
    expect(t9?.ok).toBe(true);
    expect(t9?.note).toContain("invalid-seq");
    // The refusal's reason code is ALSO pinned by a declarative assertion.
    const s16 = outcome.assertions.find((a) => a.id === "s16");
    expect(s16?.pass).toBe(true);
    expect(s16?.actual).toBe("invalid-seq");
  });

  it("the handoff chain is threaded: the consumer runs on the publisher's context", () => {
    const outcomes = runJourneyCorpus(FIELD_JOURNEYS);
    const publish = outcomes.find((o) => o.journeyId === "handoff-field-to-operator-publish");
    const consume = outcomes.find((o) => o.journeyId === "handoff-field-to-operator-consume");
    expect(publish?.passed).toBe(true);
    expect(publish?.handoff).not.toBeNull();
    expect(publish?.handoff?.handoffId).toBe("hd_field-to-ops-01");
    expect(consume?.passed).toBe(true);
    expect(consume?.handoff).not.toBeNull();
  });

  it("handoff-chain integrity: consuming with NO carrier FAILS the journey (no soft passes)", () => {
    // Fresh context => no published carrier => the consume steps must fail
    // and the journey must fail honestly.
    const { outcome } = executeJourney(handoffConsumeJourney);
    expect(outcome.passed).toBe(false);
    const t1 = outcome.steps.find((s) => s.id === "t1");
    expect(t1?.ok).toBe(false);
    expect(t1?.note).toBe("no-carrier");
    const k1 = outcome.assertions.find((a) => a.id === "k1");
    expect(k1?.pass).toBe(false);
    expect(k1?.actual).toBe(false);
  });

  it("every outcome digest verifies and re-stamps identically", () => {
    for (const outcome of runJourneyCorpus(FIELD_JOURNEYS)) {
      expect(verifyJourneyOutcome(outcome)).toBe(true);
      const { digest, ...rest } = outcome;
      expect(journeyOutcomeDigest(rest)).toBe(digest);
    }
  });

  it("a failing step poisons the journey even when all assertions pass", () => {
    // Drop expectRefusal from a step the REAL API refuses: the step now fails.
    const broken = {
      ...trustworthyStateJourney,
      steps: trustworthyStateJourney.steps.map((s) =>
        s.id === "t9" ? { ...s, expectRefusal: undefined } : s,
      ),
    };
    const { outcome } = executeJourney(broken);
    expect(outcome.steps.find((s) => s.id === "t9")?.ok).toBe(false);
    expect(outcome.passed).toBe(false);
  });

  it("caller-supplied tenant + logical start time thread through the context", () => {
    const a = executeJourney(enrollNewAssetJourney, { tenantId: "tnt_probe-a", startedAt: 1_000 });
    const b = executeJourney(enrollNewAssetJourney, { tenantId: "tnt_probe-b", startedAt: 2_000 });
    expect(a.ctx.tenantId).toBe("tnt_probe-a");
    expect(b.ctx.tenantId).toBe("tnt_probe-b");
    expect(a.ctx.startedAt).toBe(1_000);
    expect(b.ctx.startedAt).toBe(2_000);
    expect(a.outcome.passed).toBe(true);
    expect(b.outcome.passed).toBe(true);
    expect(verifyJourneyOutcome(a.outcome)).toBe(true);
    expect(verifyJourneyOutcome(b.outcome)).toBe(true);
    // The REAL tenant-scoped state is separated: a's asset is invisible to b's tenant.
    expect(a.ctx.assets.listAssets("tnt_probe-a").length).toBe(1);
    expect(a.ctx.assets.listAssets("tnt_probe-b").length).toBe(0);
    expect(b.ctx.assets.listAssets("tnt_probe-b").length).toBe(1);
    expect(b.ctx.assets.listAssets("tnt_probe-a").length).toBe(0);
  });
});
