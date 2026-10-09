/**
 * Journey 16 — predictive honesty (F300B deliverable 4; persona:
 * ml-engineer).
 *
 * An ML engineer inspects EVERY predictive surface this lane can present and
 * verifies the honesty laws end-to-end:
 *   - the REAL reference twin and the REAL JEPA structural analogue both
 *     project deterministic outputs with machine-carried provenance;
 *   - the JEPA hash-derived structural analogue is labeled
 *     deterministic-structural-reference with trainedValidated: false and
 *     structuralAnalogue: true — NEVER claimed as trained/validated
 *     accuracy (the packet's explicit law);
 *   - the structural-vs-trained differentiation is MACHINE-READABLE on the
 *     host view models (ModelHonestyDisclosure.modelClass) and the trained
 *     registry is honestly EMPTY;
 *   - an UNKNOWN model identity is REFUSED (fail-closed honesty — the host
 *     never renders an advisory whose class it cannot certify);
 *   - advisory markers survive end-to-end; a marker-stripped prediction is
 *     refused at the card boundary.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import { makeReferenceModelPort } from "@fleetos/predictive";
import { makeJepaSpace, predictJepa } from "@fleetos/world-model";
import {
  buildAdvisoryBoardRouteView,
  classifyModelHonesty,
  modelHonestyRegistryView,
} from "@fleetos/experience-safety-intel";
import { assembleContext } from "@fleetos/world-context";
import { NOW_MS, NOW_ISO, STALENESS_THRESHOLDS, TENANT, pumpTwinState } from "./fixture-world.ts";

const HORIZON = { steps: 3, stepMs: 1_000 } as const;

export const predictiveHonestyJourney: AcceptanceJourney = {
  journeyId: "security.predictive-honesty",
  persona: "ml-engineer",
  capabilities: ["predictive-honesty", "predictive-advice"],
  goal: "Verify every predictive output discloses its model class, provenance and uncertainty honestly",
  steps: [
    {
      stepId: "structural-models",
      kind: "projection",
      description: "Project the REAL reference twin and the REAL JEPA structural analogue",
      packages: ["@fleetos/predictive", "@fleetos/world-model"],
      operations: ["makeReferenceModelPort", "makeJepaSpace", "predictJepa"],
      run: (ctx) => {
        const port = makeReferenceModelPort();
        const twin = port.project(pumpTwinState(), HORIZON);
        if (!twin.ok) throw new Error(`projection rejected: ${twin.rejected}`);
        ctx.record("twin.advisory", twin.prediction.advisory);
        ctx.record("twin.modelVersion", twin.prediction.provenance.modelVersion);
        ctx.record("twin.method", twin.prediction.provenance.method);
        ctx.record("twin.inputDigestLength", twin.prediction.provenance.inputDigest.length);

        const space = makeJepaSpace();
        const jepa = predictJepa(space, {
          tenant: TENANT,
          asset: { assetId: "pump-7" },
          features: { vibration: 40, temperature: 60 },
          horizon: 3,
          computedAt: NOW_ISO,
        });
        if (!jepa.ok) throw new Error(`jepa prediction rejected: ${jepa.rejected}`);
        const predicted = jepa.prediction.predicted;
        ctx.record("jepa.spaceVersion", jepa.prediction.spaceVersion);
        ctx.record("jepa.kind", predicted.kind);
        ctx.record("jepa.modelVersion", predicted.provenance.modelVersion);
        ctx.record("jepa.uncertaintyMethod", predicted.uncertainty.method);
        ctx.record("jepa.featureDigestLength", predicted.provenance.featureDigest.length);
        const jepaAgain = predictJepa(space, {
          tenant: TENANT,
          asset: { assetId: "pump-7" },
          features: { vibration: 40, temperature: 60 },
          horizon: 3,
          computedAt: NOW_ISO,
        });
        if (!jepaAgain.ok) throw new Error("jepa re-prediction rejected");
        ctx.record("jepa.deterministic", jepaAgain.prediction.predicted.provenance.inputsDigest === predicted.provenance.inputsDigest);
        ctx.record("jepa.readoutKeys", Object.keys(jepa.prediction.readouts).sort());
      },
    },
    {
      stepId: "honesty-classification",
      kind: "evaluation",
      description: "Classify both models through the fail-closed host honesty registry",
      packages: ["@fleetos/experience-safety-intel"],
      operations: ["classifyModelHonesty", "modelHonestyRegistryView"],
      run: (ctx) => {
        const jepa = classifyModelHonesty({ modelVersion: "jepa-1.0.0" });
        if (!jepa.ok) throw new Error(`jepa classification refused: ${jepa.refused}`);
        ctx.record("class.jepa.modelClass", jepa.disclosure.modelClass);
        ctx.record("class.jepa.trainedValidated", jepa.disclosure.trainedValidated);
        ctx.record("class.jepa.structuralAnalogue", jepa.disclosure.structuralAnalogue);
        ctx.record("class.jepa.statementNamesStructural", jepa.disclosure.statement.includes("structural"));
        ctx.record("class.jepa.statementDeniesTraining", jepa.disclosure.statement.includes("NOT a trained model"));

        const twin = classifyModelHonesty({ modelVersion: "reference-twin-1.0.0", method: "reference.linear-drift" });
        if (!twin.ok) throw new Error(`twin classification refused: ${twin.refused}`);
        ctx.record("class.twin.modelClass", twin.disclosure.modelClass);
        ctx.record("class.twin.trainedValidated", twin.disclosure.trainedValidated);

        const registry = modelHonestyRegistryView();
        ctx.record("registry.structuralCount", registry.structuralReference.length);
        ctx.record("registry.trainedCount", registry.trainedValidated.length);
        ctx.record("registry.anyClaimingTrained", registry.structuralReference.some((e) => e.trainedValidated));

        // NEGATIVE: an unknown model identity is refused — never guessed.
        const unknown = classifyModelHonesty({ modelVersion: "vendor-forecast-9", method: "trained.nn" });
        ctx.record("class.unknownOk", unknown.ok);
        ctx.record("class.unknownReason", unknown.ok ? "unexpected-allow" : unknown.refused);
        ctx.record("class.unknownDetailNamesModel", unknown.ok ? "none" : (unknown.detail.includes("vendor-forecast-9") ?? false));
      },
    },
    {
      stepId: "advisory-route-honesty",
      kind: "view-read",
      description: "Present the host advisory route with per-card honesty disclosures over REAL outputs",
      packages: ["@fleetos/experience-safety-intel", "@fleetos/predictive", "@fleetos/world-context"],
      operations: ["buildAdvisoryBoardRouteView"],
      run: (ctx) => {
        const port = makeReferenceModelPort();
        const twin = port.project(pumpTwinState(), HORIZON);
        if (!twin.ok) throw new Error("projection rejected");
        const context = assembleContext({
          focus: {
            tenant: TENANT,
            entities: [
              {
                entityId: "pump-7",
                entityType: "asset",
                tenantId: TENANT.tenantId,
                fields: { temperature: 41 },
                lastObservationRef: "obs-pump-7-3",
                lastObservedAtMs: NOW_MS - 5_000,
              },
            ],
            purpose: "operational-monitoring",
          },
          computedAt: NOW_ISO,
        });
        if (!context.ok) throw new Error(`assembly refused: ${context.rejected}`);
        const route = buildAdvisoryBoardRouteView({
          tenantId: TENANT.tenantId,
          nowMs: NOW_MS,
          thresholds: STALENESS_THRESHOLDS,
          predictions: [twin.prediction],
          worldContexts: [context.context],
        });
        if (!route.ok) throw new Error(`advisory route refused: ${route.refused} (${route.detail})`);
        if (!route.view.composed) throw new Error("advisory route unexpectedly not composed");
        ctx.record("route.advisory", route.view.advisory);
        ctx.record("route.cardCount", route.view.board.cards.length);
        ctx.record("route.cardHonestyCount", route.view.cardHonesty.length);
        const predEntry = route.view.cardHonesty.find((e) => e.cardId.includes("|pred|"));
        const ctxEntry = route.view.cardHonesty.find((e) => e.cardId.includes("|ctx|"));
        if (predEntry === undefined || ctxEntry === undefined) throw new Error("honesty entries missing");
        ctx.record("route.pred.modelClass", predEntry.modelIdentity.modelClass);
        ctx.record("route.pred.trainedValidated", predEntry.modelIdentity.trainedValidated);
        ctx.record("route.pred.structuralAnalogue", predEntry.modelIdentity.structuralAnalogue);
        ctx.record("route.pred.confidenceBps", predEntry.confidenceBps);
        ctx.record("route.pred.modelVersion", predEntry.modelIdentity.modelVersion);
        ctx.record("route.ctx.modelClass", ctxEntry.modelIdentity.modelClass);
        ctx.record("route.ctx.confidenceBps", ctxEntry.confidenceBps);
        ctx.record("route.registryTrainedCount", route.view.modelRegistry.trainedValidated.length);

        // NEGATIVE: a marker-stripped prediction refuses at the card boundary.
        const stripped = buildAdvisoryBoardRouteView({
          tenantId: TENANT.tenantId,
          nowMs: NOW_MS,
          thresholds: STALENESS_THRESHOLDS,
          predictions: [{ ...twin.prediction, advisory: false } as unknown as typeof twin.prediction],
          worldContexts: [],
        });
        ctx.record("route.strippedOk", stripped.ok);
        ctx.record("route.strippedReason", stripped.ok ? "unexpected-allow" : stripped.refused);

        // NEGATIVE: an advisory whose model identity is not in the honesty
        // registry REFUSES the whole route (fail-closed, never guessed).
        const unknownModel = {
          ...twin.prediction,
          provenance: { ...twin.prediction.provenance, modelVersion: "vendor-forecast-9" },
        };
        const unknownRoute = buildAdvisoryBoardRouteView({
          tenantId: TENANT.tenantId,
          nowMs: NOW_MS,
          thresholds: STALENESS_THRESHOLDS,
          predictions: [unknownModel],
          worldContexts: [],
        });
        ctx.record("route.unknownModelOk", unknownRoute.ok);
        ctx.record("route.unknownModelReason", unknownRoute.ok ? "unexpected-allow" : unknownRoute.refused);
      },
    },
  ],
  assertions: [
    { assertionId: "ph-1", description: "The reference twin prediction is advisory (A2)", path: "twin.advisory", expected: true },
    { assertionId: "ph-2", description: "Twin model identity carried", path: "twin.modelVersion", expected: "reference-twin-1.0.0" },
    { assertionId: "ph-3", description: "Twin method carried (linear drift — structural, not learned)", path: "twin.method", expected: "reference.linear-drift" },
    { assertionId: "ph-4", description: "Twin input digest is FNV-1a 8-hex", path: "twin.inputDigestLength", expected: 8 },
    { assertionId: "ph-5", description: "JEPA space version carried", path: "jepa.spaceVersion", expected: "jepa-1.0.0" },
    { assertionId: "ph-6", description: "JEPA predicted value is the A11 PREDICTED kind", path: "jepa.kind", expected: "PREDICTED" },
    { assertionId: "ph-7", description: "JEPA provenance carries its model identity", path: "jepa.modelVersion", expected: "jepa-1.0.0" },
    { assertionId: "ph-8", description: "JEPA uncertainty method is the latent-sqrt convention", path: "jepa.uncertaintyMethod", expected: "jepa.latent-sqrt" },
    { assertionId: "ph-9", description: "JEPA feature digest is FNV-1a 8-hex", path: "jepa.featureDigestLength", expected: 8 },
    { assertionId: "ph-10", description: "JEPA is deterministic (same inputs, same inputs digest)", path: "jepa.deterministic", expected: true },
    { assertionId: "ph-11", description: "JEPA readouts decode per feature, sorted", path: "jepa.readoutKeys", expected: ["temperature", "vibration"] },
    { assertionId: "ph-12", description: "JEPA disclosed as deterministic structural/reference", path: "class.jepa.modelClass", expected: "deterministic-structural-reference" },
    { assertionId: "ph-13", description: "JEPA NEVER claimed trained/validated", path: "class.jepa.trainedValidated", expected: false },
    { assertionId: "ph-14", description: "JEPA marked as the structural analogue", path: "class.jepa.structuralAnalogue", expected: true },
    { assertionId: "ph-15", description: "The JEPA statement names its structural nature", path: "class.jepa.statementNamesStructural", expected: true },
    { assertionId: "ph-16", description: "The JEPA statement explicitly denies training", path: "class.jepa.statementDeniesTraining", expected: true },
    { assertionId: "ph-17", description: "Reference twin disclosed as deterministic structural/reference", path: "class.twin.modelClass", expected: "deterministic-structural-reference" },
    { assertionId: "ph-18", description: "Reference twin never claimed trained/validated", path: "class.twin.trainedValidated", expected: false },
    { assertionId: "ph-19", description: "Registry lists three structural/reference models", path: "registry.structuralCount", expected: 3 },
    { assertionId: "ph-20", description: "The trained/validated registry is honestly EMPTY", path: "registry.trainedCount", expected: 0 },
    { assertionId: "ph-21", description: "No registry entry claims trained/validated", path: "registry.anyClaimingTrained", expected: false },
    { assertionId: "ph-22", description: "An unknown model identity is refused (never guessed)", path: "class.unknownOk", expected: false },
    { assertionId: "ph-23", description: "Unknown-identity refusal code", path: "class.unknownReason", expected: "honesty.unknown-model-identity" },
    { assertionId: "ph-24", description: "The refusal names the model it cannot certify", path: "class.unknownDetailNamesModel", expected: true },
    { assertionId: "ph-25", description: "The advisory route is machine-carried advisory", path: "route.advisory", expected: true },
    { assertionId: "ph-26", description: "Both REAL cards presented", path: "route.cardCount", expected: 2 },
    { assertionId: "ph-27", description: "Every card joined with its honesty disclosure", path: "route.cardHonestyCount", expected: 2 },
    { assertionId: "ph-28", description: "Prediction card class machine-readable on the route", path: "route.pred.modelClass", expected: "deterministic-structural-reference" },
    { assertionId: "ph-29", description: "Prediction card never claims trained/validated", path: "route.pred.trainedValidated", expected: false },
    { assertionId: "ph-30", description: "Prediction card marked structural analogue", path: "route.pred.structuralAnalogue", expected: true },
    { assertionId: "ph-31", description: "Uncertainty surfaced as integer bps", path: "route.pred.confidenceBps", expected: 2500 },
    { assertionId: "ph-32", description: "Model identity surfaced on the card join", path: "route.pred.modelVersion", expected: "reference-twin-1.0.0" },
    { assertionId: "ph-33", description: "World-context card class machine-readable", path: "route.ctx.modelClass", expected: "deterministic-structural-reference" },
    { assertionId: "ph-34", description: "World-context card carries the honest null confidence", path: "route.ctx.confidenceBps", expected: null },
    { assertionId: "ph-35", description: "The route registry's trained list is honestly empty", path: "route.registryTrainedCount", expected: 0 },
    { assertionId: "ph-36", description: "A marker-stripped prediction refuses at the card boundary", path: "route.strippedOk", expected: false },
    { assertionId: "ph-37", description: "Stripped-marker refusal code", path: "route.strippedReason", expected: "advisory.card-refused" },
    { assertionId: "ph-38", description: "An unknown-model advisory refuses the whole route (fail-closed honesty)", path: "route.unknownModelOk", expected: false },
    { assertionId: "ph-39", description: "Unknown-model refusal code", path: "route.unknownModelReason", expected: "advisory.model-honesty-refused" },
  ],
};
