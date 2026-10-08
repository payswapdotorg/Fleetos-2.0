/**
 * Journey 7 — receive predictive advice (persona: site-reliability-engineer).
 *
 * An SRE receives predictive advice from the REAL reference model
 * (`makeReferenceModelPort` -> `project`), presented through the REAL
 * advisory card + board views:
 *   - every prediction carries the machine-carried `advisory: true` marker
 *     (law A2) — a stripped copy is REJECTED by the runtime guard;
 *   - confidence is presented as INTEGER basis points (the minimum across
 *     points — conservative headline);
 *   - provenance (model version, observation refs, input digest) is surfaced;
 *   - a world-context card carries `confidenceBps: null` — honest
 *     no-confidence, never invented.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { makeReferenceModelPort, isAdvisoryPrediction, REFERENCE_MODEL_VERSION } from "@fleetos/predictive";
import {
  buildAdvisoryBoard,
  buildPredictionAdvisoryCard,
  buildWorldContextAdvisoryCard,
} from "@fleetos/experience-safety-intel";
import { assembleContext } from "@fleetos/world-context";
import { NOW_MS, NOW_ISO, STALENESS_THRESHOLDS, TENANT, pumpTwinState } from "./fixture-world.ts";

const HORIZON = { steps: 3, stepMs: 1_000 } as const;

export const predictiveAdviceJourney: AcceptanceJourney = {
  journeyId: "security.predictive-advice",
  persona: "site-reliability-engineer",
  capabilities: ["predictive-advice"],
  goal: "Receive predictive advice with uncertainty + provenance, marked advisory",
  steps: [
    {
      stepId: "project-and-card",
      kind: "projection",
      description: "Project the REAL reference model and present the REAL advisory card",
      packages: ["@fleetos/predictive", "@fleetos/experience-safety-intel"],
      operations: ["makeReferenceModelPort", "buildPredictionAdvisoryCard", "isAdvisoryPrediction"],
      run: (ctx) => {
        const port = makeReferenceModelPort();
        const result = port.project(pumpTwinState(), HORIZON);
        if (!result.ok) throw new Error(`projection rejected: ${result.rejected} (${result.detail})`);
        const prediction = result.prediction;
        ctx.record("prediction.kind", prediction.kind);
        ctx.record("prediction.advisory", prediction.advisory);
        ctx.record("prediction.pointCount", prediction.points.length);
        ctx.record("prediction.lastValue", prediction.points[prediction.points.length - 1]!.value);
        const minConfidence = prediction.points.reduce((min, p) => Math.min(min, p.confidenceBps), 10000);
        ctx.record("prediction.minConfidenceBps", minConfidence);
        ctx.record("prediction.provenance.modelVersion", prediction.provenance.modelVersion);
        ctx.record(
          "prediction.provenance.observationRefs",
          prediction.provenance.observationRefs,
        );
        ctx.record("prediction.provenance.inputDigestLength", prediction.provenance.inputDigest.length);
        const again = port.project(pumpTwinState(), HORIZON);
        if (!again.ok) throw new Error("re-projection rejected");
        ctx.record("prediction.digestStable", again.prediction.provenance.inputDigest === prediction.provenance.inputDigest);
        ctx.record("prediction.guardAccepts", isAdvisoryPrediction(prediction));
        const stripped: unknown = { ...prediction, advisory: false };
        ctx.record("prediction.guardRejectsStripped", !isAdvisoryPrediction(stripped));

        const card = buildPredictionAdvisoryCard({ prediction, nowMs: NOW_MS, thresholds: STALENESS_THRESHOLDS });
        if (!card.ok) throw new Error(`card refused: ${card.refused} (${card.detail})`);
        ctx.record("card.advisory", card.card.advisory);
        ctx.record("card.confidenceBps", card.card.confidenceBps);
        ctx.record("card.staleness", card.card.staleness);
        ctx.record("card.headlineValue", card.card.subject.kind === "prediction" ? card.card.subject.headlineValue : "n/a");
        ctx.record("card.bounds", card.card.subject.kind === "prediction" ? card.card.subject.bounds : "n/a");
        ctx.record("card.provenance.modelVersion", card.card.provenance.modelVersion);
        const strippedCard = buildPredictionAdvisoryCard({
          prediction: { ...prediction, advisory: false } as unknown as typeof prediction,
          nowMs: NOW_MS,
          thresholds: STALENESS_THRESHOLDS,
        });
        ctx.record("card.strippedRefused", strippedCard.ok ? "unexpected-accept" : strippedCard.refused);
      },
    },
    {
      stepId: "board-and-context-card",
      kind: "view-read",
      description: "Present the advisory board + the honest world-context card",
      packages: ["@fleetos/experience-safety-intel", "@fleetos/world-context"],
      operations: ["buildWorldContextAdvisoryCard", "buildAdvisoryBoard"],
      run: (ctx) => {
        const context = assembleContext({
          focus: {
            tenant: TENANT,
            entities: [
              {
                entityId: "pump-7",
                entityType: "asset",
                tenantId: TENANT.tenantId,
                fields: { temperature: 41, location: "bay-7" },
                lastObservationRef: "obs-pump-7-3",
                lastObservedAtMs: NOW_MS - 5_000,
              },
            ],
            purpose: "operational-monitoring",
          },
          computedAt: NOW_ISO,
        });
        if (!context.ok) throw new Error(`assembly refused: ${context.rejected}`);
        const ctxCard = buildWorldContextAdvisoryCard({
          context: context.context,
          nowMs: NOW_MS,
          thresholds: STALENESS_THRESHOLDS,
        });
        if (!ctxCard.ok) throw new Error(`context card refused: ${ctxCard.refused}`);
        ctx.record("ctxCard.confidenceBps", ctxCard.card.confidenceBps);
        ctx.record("ctxCard.advisory", ctxCard.card.advisory);
        ctx.record("ctxCard.featureCount", ctxCard.card.subject.kind === "world-context" ? ctxCard.card.subject.featureCount : -1);
        ctx.record("ctxCard.redactedFieldCount", ctxCard.card.subject.kind === "world-context" ? ctxCard.card.subject.redactedFieldCount : -1);
        ctx.record("ctxCard.staleness", ctxCard.card.staleness);

        const port = makeReferenceModelPort();
        const result = port.project(pumpTwinState(), HORIZON);
        if (!result.ok) throw new Error("projection rejected");
        const predCard = buildPredictionAdvisoryCard({ prediction: result.prediction, nowMs: NOW_MS, thresholds: STALENESS_THRESHOLDS });
        if (!predCard.ok) throw new Error("prediction card refused");
        const board = buildAdvisoryBoard([predCard.card, ctxCard.card]);
        if (!board.ok) throw new Error(`board refused: ${board.refused} (${board.detail})`);
        ctx.record("board.advisory", board.board.advisory);
        ctx.record("board.cardCount", board.board.cards.length);
        ctx.record(
          "board.cardIds",
          board.board.cards.map((c) => c.cardId.split("|")[1] ?? "none"),
        );
        ctx.record("board.digestLength", board.board.digest.length);
      },
    },
  ],
  assertions: [
    { assertionId: "pa-1", description: "Prediction envelope kind", path: "prediction.kind", expected: "PREDICTION" },
    { assertionId: "pa-2", description: "Advisory marker machine-carried (A2)", path: "prediction.advisory", expected: true },
    { assertionId: "pa-3", description: "Three projected points", path: "prediction.pointCount", expected: 3 },
    { assertionId: "pa-4", description: "Linear drift headroom: last point is 60", path: "prediction.lastValue", expected: 60 },
    { assertionId: "pa-5", description: "Minimum integer-bps confidence across points (decays with horizon)", path: "prediction.minConfidenceBps", expected: 2500 },
    { assertionId: "pa-6", description: "Provenance model version pinned", path: "prediction.provenance.modelVersion", expected: REFERENCE_MODEL_VERSION },
    { assertionId: "pa-7", description: "Provenance carries the observation refs", path: "prediction.provenance.observationRefs", expected: ["obs-pump-7-1", "obs-pump-7-2", "obs-pump-7-3"] },
    { assertionId: "pa-8", description: "Provenance input digest is FNV-1a 8-hex", path: "prediction.provenance.inputDigestLength", expected: 8 },
    { assertionId: "pa-9", description: "Same inputs -> same input digest", path: "prediction.digestStable", expected: true },
    { assertionId: "pa-10", description: "Runtime guard accepts the marked prediction", path: "prediction.guardAccepts", expected: true },
    { assertionId: "pa-11", description: "Runtime guard rejects a marker-stripped copy", path: "prediction.guardRejectsStripped", expected: true },
    { assertionId: "pa-12", description: "Card carries the advisory marker", path: "card.advisory", expected: true },
    { assertionId: "pa-13", description: "Card confidence is the min across points (conservative headline)", path: "card.confidenceBps", expected: 2500 },
    { assertionId: "pa-14", description: "Data anchor classified honestly", path: "card.staleness", expected: "unknown" },
    { assertionId: "pa-15", description: "Headline value is the last projected point", path: "card.headlineValue", expected: 60 },
    { assertionId: "pa-16", description: "Bounds presented with the headline (sqrt-widened at step 3)", path: "card.bounds", expected: { lower: 58.633975, upper: 61.366025 } },
    { assertionId: "pa-17", description: "Card provenance model version", path: "card.provenance.modelVersion", expected: REFERENCE_MODEL_VERSION },
    { assertionId: "pa-18", description: "Marker-stripped prediction input refused at the card boundary", path: "card.strippedRefused", expected: "card.non-advisory-input" },
    { assertionId: "pa-19", description: "World-context card carries honest null confidence", path: "ctxCard.confidenceBps", expected: null },
    { assertionId: "pa-20", description: "Context card is advisory too", path: "ctxCard.advisory", expected: true },
    { assertionId: "pa-21", description: "Context card presents feature counts only", path: "ctxCard.featureCount", expected: 2 },
    { assertionId: "pa-22", description: "No redacted fields for this monitoring context", path: "ctxCard.redactedFieldCount", expected: 0 },
    { assertionId: "pa-23", description: "Fresh context classified fresh", path: "ctxCard.staleness", expected: "fresh" },
    { assertionId: "pa-24", description: "Board carries the advisory marker", path: "board.advisory", expected: true },
    { assertionId: "pa-25", description: "Board holds both cards", path: "board.cardCount", expected: 2 },
    { assertionId: "pa-26", description: "Cards ordered deterministically (ctx before pred)", path: "board.cardIds", expected: ["ctx", "pred"] },
    { assertionId: "pa-27", description: "Board digest is FNV-1a 8-hex", path: "board.digestLength", expected: 8 },
  ],
};
