/**
 * F321B journey — JEPA family honesty (persona: ml-engineer).
 *
 * The PREDICTIVE HONESTY LAW (binding, from the Wave-12 handoff): JEPA-family
 * outputs are deterministic STRUCTURAL references — hash-derived latent
 * predictions, never trained weights; no predictive-accuracy claims anywhere.
 * This journey machine-proves the family's honest behavior end to end
 * (@fleetos/world-model jepa — Wave 9, F290B):
 *   - the masked adapter (I-JEPA analogue) predicts a MASKED feature from
 *     the unmasked context with honest masked-vs-full divergence accounting
 *     and 2x-widened uncertainty (less evidence, wider interval);
 *   - the rollout adapter (V-JEPA analogue) rolls a 2-frame window when
 *     jepa.prev.* keys exist and falls back to a single frame without them;
 *     both adapters are TOTAL and deterministic (same inputs => same
 *     inputsDigest, byte-identical);
 *   - latentCounterfactual intervenes in LATENT space: the scenario value
 *     carries the machine-enforced `hypothetical: true` marker with
 *     composed (sqrt + factor-2) widening, and per-feature divergence
 *     accounting records baseline vs counterfactual decodes — never hidden;
 *   - runJepaBenchmark drives EVERY family adapter over EVERY fixture with
 *     the full seam contract; the report is byte-identical on re-run AND on
 *     a freshly-constructed space (construction determinism);
 *   - an invalid horizon or a non-finite intervention delta REFUSES.
 *
 * Determinism: the adapters take a caller-supplied logical `now` (NOW_ISO);
 * no clock, no randomness, no network, no provider. Distinct from
 * security.predictive-honesty (which drives the core predictor + host
 * honesty registry): this journey drives the MASKED/ROLLOUT adapters, the
 * latent counterfactual and the family benchmark.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  defaultMaskPolicy,
  jepaUncertaintyAt,
  latentCounterfactual,
  makeJepaMaskedAdapter,
  makeJepaRolloutAdapter,
  makeJepaSpace,
  maskedLatentPrediction,
  runJepaBenchmark,
} from "@fleetos/world-model";
import { NOW_ISO, TENANT } from "./fixture-world.ts";

const ASSET = { assetId: "pump-7" } as const;
const FEATURES = { temperature: 42, vibration: 40, "jepa.horizon": 2 } as const;

export const jepaFamilyJourney: AcceptanceJourney = {
  journeyId: "security.jepa-family-honesty",
  persona: "ml-engineer",
  capabilities: ["predictive-honesty"],
  goal: "Prove the JEPA family's masked/rollout/counterfactual surfaces stay deterministic structural references",
  steps: [
    {
      stepId: "masked-and-rollout",
      kind: "projection",
      description: "Drive the masked (I-JEPA) and rollout (V-JEPA) adapters: total, deterministic, honestly widened",
      packages: ["@fleetos/world-model"],
      operations: ["makeJepaMaskedAdapter", "makeJepaRolloutAdapter", "defaultMaskPolicy", "maskedLatentPrediction"],
      run: (ctx) => {
        const space = makeJepaSpace();
        const masked = makeJepaMaskedAdapter(space, NOW_ISO);
        ctx.record("family.masked.name", masked.name);

        const rep = masked.represent({ tenant: TENANT, asset: ASSET, features: FEATURES });
        ctx.record("family.masked.repId", rep.representationId);
        ctx.record("family.masked.version", rep.version);
        ctx.record("family.masked.computedAt", rep.computedAt);

        const prediction = masked.predict(rep);
        ctx.record("family.masked.kind", prediction.kind);
        ctx.record("family.masked.modelVersion", prediction.provenance.modelVersion);
        ctx.record("family.masked.uncertaintyMethod", prediction.uncertainty.method);
        ctx.record("family.masked.valueRounded", Math.round(prediction.value * 1_000) / 1_000);
        // Determinism: same inputs => same inputsDigest (byte-identical).
        const again = masked.predict(masked.represent({ tenant: TENANT, asset: ASSET, features: FEATURES }));
        ctx.record("family.masked.deterministic", again.provenance.inputsDigest === prediction.provenance.inputsDigest);
        ctx.record("family.masked.valueStable", again.value === prediction.value);
        // The masked prediction is LESS certain: its interval is EXACTLY 2x
        // the core uncertainty at the same horizon (A11 discipline, machine-checked).
        const coreUncertainty = jepaUncertaintyAt(1, prediction.value);
        const coreWidth = coreUncertainty.upper - coreUncertainty.lower;
        const maskedWidth = prediction.uncertainty.upper - prediction.uncertainty.lower;
        ctx.record("family.masked.widthPositive", maskedWidth > 0);
        ctx.record("family.masked.widthIsDoubled", Math.abs(maskedWidth - 2 * coreWidth) < 1e-9);
        ctx.record("family.masked.confidenceHalved", Math.abs(prediction.uncertainty.confidence - coreUncertainty.confidence / 2) < 1e-9);

        // The DEFAULT MASK POLICY: lexicographically later ceil(n/2) payload keys.
        ctx.record("family.mask.defaultPolicy", defaultMaskPolicy(["temperature", "vibration"]));

        // HONEST DIVERGENCE ACCOUNTING: masked vs full decodes, both recorded.
        const accounting = maskedLatentPrediction(space, { features: FEATURES, mask: ["vibration"] });
        if (!accounting.ok) throw new Error(`masked prediction rejected: ${accounting.rejected}`);
        ctx.record("family.accounting.maskedFeatures", accounting.masked.maskedFeatures);
        ctx.record("family.accounting.contextFeatures", accounting.masked.contextFeatures);
        ctx.record("family.accounting.divergenceNonNegative", accounting.masked.maskedDivergenceTotal >= 0);
        ctx.record("family.accounting.perTargetCount", accounting.masked.perTarget.length);
        const target = accounting.masked.perTarget[0];
        ctx.record("family.accounting.target.feature", target?.feature ?? "none");
        ctx.record("family.accounting.bothDecoded", target !== undefined && typeof target.maskedValue === "number" && typeof target.fullValue === "number");

        // An UNKNOWN mask target REFUSES (reserved keys cannot be masked).
        const unknown = maskedLatentPrediction(space, { features: FEATURES, mask: ["jepa.horizon"] });
        ctx.record("family.mask.unknownOk", unknown.ok);
        ctx.record("family.mask.unknownReason", unknown.ok ? "unexpected-accept" : unknown.rejected);

        // The ROLLOUT adapter: 2-frame window with prev keys.
        const rollout = makeJepaRolloutAdapter(space, NOW_ISO);
        ctx.record("family.rollout.name", rollout.name);
        const rolloutFeatures = { temperature: 42, "jepa.prev.temperature": 38, "jepa.horizon": 2 } as const;
        const rolloutRep = rollout.represent({ tenant: TENANT, asset: ASSET, features: rolloutFeatures });
        const rolloutPrediction = rollout.predict(rolloutRep);
        ctx.record("family.rollout.kind", rolloutPrediction.kind);
        ctx.record("family.rollout.modelVersion", rolloutPrediction.provenance.modelVersion);
        ctx.record("family.rollout.valueRounded", Math.round(rolloutPrediction.value * 1_000) / 1_000);
        const rolloutAgain = rollout.predict(rollout.represent({ tenant: TENANT, asset: ASSET, features: rolloutFeatures }));
        ctx.record("family.rollout.deterministic", rolloutAgain.provenance.inputsDigest === rolloutPrediction.provenance.inputsDigest);
        // Without prev keys: a single-frame window — total, never throws.
        const single = rollout.predict(rollout.represent({ tenant: TENANT, asset: ASSET, features: { temperature: 42 } }));
        ctx.record("family.rollout.singleFrame.kind", single.kind);
        ctx.record("family.rollout.singleFrameDeterministic", single.value === rollout.predict(rollout.represent({ tenant: TENANT, asset: ASSET, features: { temperature: 42 } })).value);
        // The two adapters are distinct family members with distinct ids.
        ctx.record("family.namesDistinct", masked.name !== rollout.name);
      },
    },
    {
      stepId: "latent-counterfactual",
      kind: "counterfactual",
      description: "Intervene in latent space: hypothetical brand, composed widening, per-feature divergence accounting",
      packages: ["@fleetos/world-model"],
      operations: ["latentCounterfactual"],
      run: (ctx) => {
        const space = makeJepaSpace();
        const adapter = makeJepaMaskedAdapter(space, NOW_ISO);
        const rep = adapter.represent({ tenant: TENANT, asset: ASSET, features: FEATURES });
        const cf = latentCounterfactual(space, {
          rep,
          premise: "raise coolant flow",
          intervention: { kind: "feature-shift", deltas: { temperature: 8 } },
          horizon: 2,
        });
        if (!cf.ok) throw new Error(`latent counterfactual rejected: ${cf.rejected}`);
        const scenario = cf.counterfactual.scenario;
        ctx.record("cf.kind", scenario.value.kind);
        ctx.record("cf.hypothetical", scenario.value.hypothetical);
        ctx.record("cf.premise", scenario.value.premise);
        ctx.record("cf.modelVersion", scenario.value.provenance.modelVersion);
        ctx.record("cf.featureDigestLength", scenario.value.provenance.featureDigest.length);
        ctx.record("cf.uncertaintyMethod", scenario.value.uncertainty.method);
        ctx.record("cf.uncertaintyWidthPositive", scenario.value.uncertainty.upper > scenario.value.uncertainty.lower);
        ctx.record("cf.divergenceFeatures", cf.counterfactual.divergence.map((d) => d.feature));
        ctx.record(
          "cf.divergenceAccounted",
          cf.counterfactual.divergence.every((d) => typeof d.baselineValue === "number" && typeof d.counterfactualValue === "number" && typeof d.delta === "number"),
        );
        ctx.record("cf.latentsCarried", cf.counterfactual.baselineLatent.length === cf.counterfactual.counterfactualLatent.length);
        ctx.record("cf.representationRef", scenario.representationRef);

        // Determinism: the same intervention => the byte-identical scenario.
        const cfAgain = latentCounterfactual(space, {
          rep,
          premise: "raise coolant flow",
          intervention: { kind: "feature-shift", deltas: { temperature: 8 } },
          horizon: 2,
        });
        ctx.record("cf.deterministic", cfAgain.ok && cfAgain.counterfactual.scenario.value.provenance.inputsDigest === scenario.value.provenance.inputsDigest);

        // NEGATIVE: an invalid horizon REFUSES.
        const badHorizon = latentCounterfactual(space, {
          rep,
          premise: "p",
          intervention: { kind: "feature-shift", deltas: { temperature: 1 } },
          horizon: 0,
        });
        ctx.record("cf.badHorizonOk", badHorizon.ok);
        ctx.record("cf.badHorizonReason", badHorizon.ok ? "unexpected-accept" : badHorizon.rejected);

        // NEGATIVE: a non-finite intervention delta REFUSES.
        const badDelta = latentCounterfactual(space, {
          rep,
          premise: "p",
          intervention: { kind: "feature-shift", deltas: { temperature: Number.NaN } },
          horizon: 2,
        });
        ctx.record("cf.badDeltaOk", badDelta.ok);
        ctx.record("cf.badDeltaReason", badDelta.ok ? "unexpected-accept" : badDelta.rejected);
      },
    },
    {
      stepId: "family-benchmark",
      kind: "benchmark",
      description: "Run the full family benchmark: every adapter x every fixture, byte-identical on re-run and fresh construction",
      packages: ["@fleetos/world-model"],
      operations: ["runJepaBenchmark"],
      run: (ctx) => {
        const space = makeJepaSpace();
        const report = runJepaBenchmark(space);
        ctx.record("bench.spaceVersion", report.spaceVersion);
        ctx.record("bench.fixtureCount", report.fixtureCount);
        ctx.record("bench.familyIds", report.family.map((f) => f.adapterId));
        ctx.record("bench.rowCount", report.family.reduce((acc, f) => acc + f.rows.length, 0));
        ctx.record("bench.everyRowHypothetical", report.family.every((f) => f.rows.every((r) => r.hypothetical)));
        ctx.record("bench.adapterDigestsLength8", report.family.every((f) => f.adapterDigest.length === 8));
        ctx.record("bench.aggregateDigestLength", report.aggregateDigest.length);

        // Re-run over the SAME space: byte-identical report.
        const again = runJepaBenchmark(space);
        ctx.record("bench.rerunIdentical", JSON.stringify(again) === JSON.stringify(report));

        // A FRESHLY-CONSTRUCTED space: byte-identical too (construction determinism).
        const fresh = runJepaBenchmark(makeJepaSpace());
        ctx.record("bench.freshSpaceIdentical", JSON.stringify(fresh) === JSON.stringify(report));

        // Every row carries a digest and a scenario id (the seam contract).
        const rows = report.family.flatMap((f) => f.rows);
        ctx.record("bench.everyRowDigested", rows.every((r) => r.rowDigest.length === 8));
        ctx.record("bench.everyRowScenarioId", rows.every((r) => r.scenarioId.length > 0));
        ctx.record("bench.predictedValuesFinite", rows.every((r) => Number.isFinite(r.predictedValue)));
      },
    },
  ],
  assertions: [
    { assertionId: "jf-1", description: "The masked adapter carries its family name", path: "family.masked.name", expected: "jepa.masked" },
    { assertionId: "jf-2", description: "The representation id names the variant", path: "family.masked.repId", expected: "jepa-masked-acme-ops-pump-7" },
    { assertionId: "jf-3", description: "The family version is the structural jepa-1.0.0 (NOT trained weights)", path: "family.masked.version", expected: "jepa-1.0.0" },
    { assertionId: "jf-4", description: "The logical now is caller-supplied", path: "family.masked.computedAt", expected: "2026-10-12T18:50:00.000Z" },
    { assertionId: "jf-5", description: "The masked prediction is a PREDICTED value", path: "family.masked.kind", expected: "PREDICTED" },
    { assertionId: "jf-6", description: "The model identity is the structural jepa-1.0.0", path: "family.masked.modelVersion", expected: "jepa-1.0.0" },
    { assertionId: "jf-7", description: "The uncertainty method names the latent-sqrt convention", path: "family.masked.uncertaintyMethod", expected: "jepa.latent-sqrt" },
    { assertionId: "jf-8", description: "The masked prediction is deterministic (same inputsDigest)", path: "family.masked.deterministic", expected: true },
    { assertionId: "jf-9", description: "The masked value is stable across re-prediction", path: "family.masked.valueStable", expected: true },
    { assertionId: "jf-10", description: "The masked interval width is positive", path: "family.masked.widthPositive", expected: true },
    { assertionId: "jf-11", description: "Masked uncertainty is 2x-widened (less evidence, wider interval)", path: "family.masked.widthIsDoubled", expected: true },
    { assertionId: "jf-11b", description: "Masked confidence is halved (less evidence, less confidence)", path: "family.masked.confidenceHalved", expected: true },
    { assertionId: "jf-12", description: "The default mask policy masks the later ceil(n/2) keys", path: "family.mask.defaultPolicy", expected: ["vibration"] },
    { assertionId: "jf-13", description: "The masked feature is named in the accounting", path: "family.accounting.maskedFeatures", expected: ["vibration"] },
    { assertionId: "jf-14", description: "The unmasked context is named", path: "family.accounting.contextFeatures", expected: ["temperature"] },
    { assertionId: "jf-15", description: "The divergence total is honest and non-negative", path: "family.accounting.divergenceNonNegative", expected: true },
    { assertionId: "jf-16", description: "One per-target accounting record", path: "family.accounting.perTargetCount", expected: 1 },
    { assertionId: "jf-17", description: "The accounted target is the masked feature", path: "family.accounting.target.feature", expected: "vibration" },
    { assertionId: "jf-18", description: "BOTH the masked and full decodes are recorded", path: "family.accounting.bothDecoded", expected: true },
    { assertionId: "jf-19", description: "Masking a reserved control key REFUSES", path: "family.mask.unknownOk", expected: false },
    { assertionId: "jf-20", description: "Unknown-mask-target refusal code", path: "family.mask.unknownReason", expected: "unknown-mask-target" },
    { assertionId: "jf-21", description: "The rollout adapter carries its family name", path: "family.rollout.name", expected: "jepa.rollout" },
    { assertionId: "jf-22", description: "The rollout prediction is a PREDICTED value", path: "family.rollout.kind", expected: "PREDICTED" },
    { assertionId: "jf-23", description: "The rollout model identity is jepa-1.0.0", path: "family.rollout.modelVersion", expected: "jepa-1.0.0" },
    { assertionId: "jf-24", description: "The rollout prediction is deterministic", path: "family.rollout.deterministic", expected: true },
    { assertionId: "jf-25", description: "A single-frame window is total (never throws)", path: "family.rollout.singleFrame.kind", expected: "PREDICTED" },
    { assertionId: "jf-26", description: "The single-frame path is deterministic too", path: "family.rollout.singleFrameDeterministic", expected: true },
    { assertionId: "jf-27", description: "The family adapters are distinct members", path: "family.namesDistinct", expected: true },
    { assertionId: "jf-28", description: "The counterfactual value is HYPOTHETICAL-branded", path: "cf.kind", expected: "HYPOTHETICAL" },
    { assertionId: "jf-29", description: "The hypothetical marker is machine-carried", path: "cf.hypothetical", expected: true },
    { assertionId: "jf-30", description: "The premise is carried on the value", path: "cf.premise", expected: "raise coolant flow" },
    { assertionId: "jf-31", description: "The counterfactual model identity is jepa-1.0.0", path: "cf.modelVersion", expected: "jepa-1.0.0" },
    { assertionId: "jf-32", description: "The feature digest is 8-hex (the lane convention)", path: "cf.featureDigestLength", expected: 8 },
    { assertionId: "jf-33", description: "The counterfactual uncertainty method", path: "cf.uncertaintyMethod", expected: "jepa.latent-sqrt" },
    { assertionId: "jf-34", description: "The counterfactual interval is wider than a point", path: "cf.uncertaintyWidthPositive", expected: true },
    { assertionId: "jf-35", description: "Divergence accounted per payload feature, sorted", path: "cf.divergenceFeatures", expected: ["temperature", "vibration"] },
    { assertionId: "jf-36", description: "Every divergence record carries baseline + counterfactual + delta", path: "cf.divergenceAccounted", expected: true },
    { assertionId: "jf-37", description: "Baseline and counterfactual latents both carried", path: "cf.latentsCarried", expected: true },
    { assertionId: "jf-38", description: "The scenario references its representation", path: "cf.representationRef", expected: "jepa-masked-acme-ops-pump-7" },
    { assertionId: "jf-39", description: "The latent counterfactual is deterministic", path: "cf.deterministic", expected: true },
    { assertionId: "jf-40", description: "An invalid horizon REFUSES the counterfactual", path: "cf.badHorizonOk", expected: false },
    { assertionId: "jf-41", description: "Invalid-horizon refusal code", path: "cf.badHorizonReason", expected: "invalid-horizon" },
    { assertionId: "jf-42", description: "A non-finite delta REFUSES the intervention", path: "cf.badDeltaOk", expected: false },
    { assertionId: "jf-43", description: "Invalid-intervention refusal code", path: "cf.badDeltaReason", expected: "invalid-intervention" },
    { assertionId: "jf-44", description: "The benchmark covers the three family members", path: "bench.familyIds", expected: ["jepa.core", "jepa.masked", "jepa.rollout"] },
    { assertionId: "jf-45", description: "Five reference fixtures", path: "bench.fixtureCount", expected: 5 },
    { assertionId: "jf-46", description: "15 rows (3 adapters x 5 fixtures)", path: "bench.rowCount", expected: 15 },
    { assertionId: "jf-47", description: "Every benchmark counterfactual is hypothetical-branded", path: "bench.everyRowHypothetical", expected: true },
    { assertionId: "jf-48", description: "Every adapter digest is 8-hex", path: "bench.adapterDigestsLength8", expected: true },
    { assertionId: "jf-49", description: "The aggregate digest is 8-hex", path: "bench.aggregateDigestLength", expected: 8 },
    { assertionId: "jf-50", description: "The benchmark re-run is byte-identical", path: "bench.rerunIdentical", expected: true },
    { assertionId: "jf-51", description: "A freshly-constructed space reproduces the report byte-identically", path: "bench.freshSpaceIdentical", expected: true },
    { assertionId: "jf-52", description: "Every row carries its own digest", path: "bench.everyRowDigested", expected: true },
    { assertionId: "jf-53", description: "Every row references its scenario", path: "bench.everyRowScenarioId", expected: true },
    { assertionId: "jf-54", description: "Every predicted value is finite (no NaN honesty)", path: "bench.predictedValuesFinite", expected: true },
  ],
};
