/**
 * Journey 8 — counterfactual reasoning (persona: ml-engineer).
 *
 * An ML engineer asks "what if the vibration were offset by +15?" The REAL
 * reference model drives the counterfactual divergence:
 *   - the result is a HYPOTHETICAL projection (law A11) — machine-carried
 *     `hypothetical: true`, never a Prediction, never an observation;
 *   - divergence accounting records every step: baseline vs counterfactual
 *     values, deltas, bps-of-baseline;
 *   - BOTH branches carry full provenance digests (baseline + own).
 *
 * HONEST SEAM NOTE: the experience plane (@fleetos/experience-safety-intel)
 * has no counterfactual VIEW yet — this journey asserts the DOMAIN
 * provenance surfaces (both branches carry PredictionProvenance digests) and
 * the baseline branch's REAL advisory card. The gap is reported for TL
 * adjudication (see docs/evidence/F270B/report.md).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { makeReferenceModelPort, isAdvisoryPrediction } from "@fleetos/predictive";
import { buildPredictionAdvisoryCard } from "@fleetos/experience-safety-intel";
import { NOW_MS, STALENESS_THRESHOLDS, pumpTwinState } from "./fixture-world.ts";

const HORIZON = { steps: 3, stepMs: 1_000 } as const;
const PREMISE = "what-if vibration offset +15 during maintenance window";
const OFFSET = 15;

export const counterfactualJourney: AcceptanceJourney = {
  journeyId: "security.counterfactual-reasoning",
  persona: "ml-engineer",
  capabilities: ["counterfactual-reasoning"],
  goal: "Ask a what-if question and see both branches with provenance digests",
  steps: [
    {
      stepId: "counterfactual-divergence",
      kind: "counterfactual",
      description: "Run the REAL counterfactual against the baseline projection",
      packages: ["@fleetos/predictive"],
      operations: ["makeReferenceModelPort", "project", "runCounterfactual"],
      run: (ctx) => {
        const port = makeReferenceModelPort();
        const baselineRun = port.project(pumpTwinState(), HORIZON);
        if (!baselineRun.ok) throw new Error("baseline projection rejected");
        ctx.record("baseline.advisory", baselineRun.prediction.advisory);
        ctx.record("baseline.lastValue", baselineRun.prediction.points[2]!.value);
        ctx.record("baseline.inputDigestLength", baselineRun.prediction.provenance.inputDigest.length);

        const cfRun = port.runCounterfactual({
          baseline: pumpTwinState(),
          horizon: HORIZON,
          premise: PREMISE,
          intervention: { kind: "offset", offset: OFFSET },
        });
        if (!cfRun.ok) throw new Error(`counterfactual rejected: ${cfRun.rejected} (${cfRun.detail})`);
        const cf = cfRun.projection;
        ctx.record("cf.kind", cf.kind);
        ctx.record("cf.hypotheticalMarker", cf.hypothetical);
        ctx.record("cf.premise", cf.premise);
        ctx.record("cf.lastValue", cf.points[2]!.value);
        ctx.record("cf.changedSteps", cf.changedSteps);
        ctx.record("cf.divergenceCount", cf.divergence.length);
        const last = cf.divergence[2];
        if (last === undefined) throw new Error("divergence entry missing");
        ctx.record("cf.divergence3.baselineValue", last.baselineValue);
        ctx.record("cf.divergence3.counterfactualValue", last.counterfactualValue);
        ctx.record("cf.divergence3.delta", last.delta);
        ctx.record("cf.divergence3.deltaBpsOfBaseline", last.deltaBpsOfBaseline);
        ctx.record("cf.baselineProvenanceDigestLength", cf.baselineProvenance.inputDigest.length);
        ctx.record("cf.ownProvenanceDigestLength", cf.provenance.inputDigest.length);
        ctx.record("cf.provenancesDiffer", cf.provenance.inputDigest !== cf.baselineProvenance.inputDigest);
        ctx.record("cf.isPredictionShaped", isAdvisoryPrediction(cf));
        ctx.record("cf.confidenceHalved", cf.points[0]!.confidenceBps === Math.floor(baselineRun.prediction.points[0]!.confidenceBps / 2));
        ctx.record(
          "cf.boundsWidened",
          cf.points[2]!.bounds.upper - cf.points[2]!.bounds.lower >
            baselineRun.prediction.points[2]!.bounds.upper - baselineRun.prediction.points[2]!.bounds.lower,
        );
      },
    },
    {
      stepId: "baseline-branch-view",
      kind: "view-read",
      description: "Present the baseline branch's REAL advisory card (provenance-inspect surface)",
      packages: ["@fleetos/experience-safety-intel"],
      operations: ["buildPredictionAdvisoryCard"],
      run: (ctx) => {
        const port = makeReferenceModelPort();
        const baselineRun = port.project(pumpTwinState(), HORIZON);
        if (!baselineRun.ok) throw new Error("baseline projection rejected");
        const card = buildPredictionAdvisoryCard({
          prediction: baselineRun.prediction,
          nowMs: NOW_MS,
          thresholds: STALENESS_THRESHOLDS,
        });
        if (!card.ok) throw new Error(`card refused: ${card.refused}`);
        ctx.record("view.cardAdvisory", card.card.advisory);
        ctx.record("view.cardProvenanceDigestLength", card.card.provenance.inputDigest.length);
        ctx.record(
          "view.cardProvenanceMatchesBaseline",
          card.card.provenance.inputDigest === baselineRun.prediction.provenance.inputDigest,
        );
      },
    },
  ],
  assertions: [
    { assertionId: "cf-1", description: "Baseline is a PREDICTION envelope (advisory)", path: "baseline.advisory", expected: true },
    { assertionId: "cf-2", description: "Baseline last projected value 60", path: "baseline.lastValue", expected: 60 },
    { assertionId: "cf-3", description: "Baseline provenance digest is FNV-1a 8-hex", path: "baseline.inputDigestLength", expected: 8 },
    { assertionId: "cf-4", description: "Counterfactual kind is HYPOTHETICAL (A11)", path: "cf.kind", expected: "HYPOTHETICAL" },
    { assertionId: "cf-5", description: "Machine-carried hypothetical marker", path: "cf.hypotheticalMarker", expected: true },
    { assertionId: "cf-6", description: "The what-if premise is carried", path: "cf.premise", expected: "what-if vibration offset +15 during maintenance window" },
    { assertionId: "cf-7", description: "Offset applied: last value is baseline + 15", path: "cf.lastValue", expected: 75 },
    { assertionId: "cf-8", description: "Every step diverged", path: "cf.changedSteps", expected: [1, 2, 3] },
    { assertionId: "cf-9", description: "Divergence accounting covers every step", path: "cf.divergenceCount", expected: 3 },
    { assertionId: "cf-10", description: "Step-3 baseline value recorded", path: "cf.divergence3.baselineValue", expected: 60 },
    { assertionId: "cf-11", description: "Step-3 counterfactual value recorded", path: "cf.divergence3.counterfactualValue", expected: 75 },
    { assertionId: "cf-12", description: "Step-3 delta is the offset", path: "cf.divergence3.delta", expected: 15 },
    { assertionId: "cf-13", description: "Step-3 delta in bps of baseline is 2500 (25%)", path: "cf.divergence3.deltaBpsOfBaseline", expected: 2500 },
    { assertionId: "cf-14", description: "Baseline branch provenance digest carried", path: "cf.baselineProvenanceDigestLength", expected: 8 },
    { assertionId: "cf-15", description: "Counterfactual branch provenance digest carried", path: "cf.ownProvenanceDigestLength", expected: 8 },
    { assertionId: "cf-16", description: "The two branches carry DIFFERENT provenance digests", path: "cf.provenancesDiffer", expected: true },
    { assertionId: "cf-17", description: "A HYPOTHETICAL is not prediction-shaped (A11)", path: "cf.isPredictionShaped", expected: false },
    { assertionId: "cf-18", description: "Hypothetical confidence halved (less certain)", path: "cf.confidenceHalved", expected: true },
    { assertionId: "cf-19", description: "Hypothetical bounds widened 2x", path: "cf.boundsWidened", expected: true },
    { assertionId: "cf-20", description: "Baseline branch card is advisory", path: "view.cardAdvisory", expected: true },
    { assertionId: "cf-21", description: "Card provenance digest present", path: "view.cardProvenanceDigestLength", expected: 8 },
    { assertionId: "cf-22", description: "Card provenance matches the baseline branch", path: "view.cardProvenanceMatchesBaseline", expected: true },
  ],
};
