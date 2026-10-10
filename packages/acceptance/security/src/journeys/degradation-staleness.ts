/**
 * F321B journey — degradation and staleness honesty (persona: site-reliability-engineer).
 *
 * The honest-degradation laws, machine-proven (@fleetos/predictive
 * feature-projection + staleness-propagation — F280B/F210B):
 *   - predictWithDegradation NEVER invents a value: an unavailable model,
 *     empty features or a missing tenant each return the named degraded
 *     state (model_unavailable / insufficient_history / tenant_isolated),
 *     never a fake prediction;
 *   - the healthy path returns a REAL PREDICTED value with provenance
 *     digests (the deterministic structural reference);
 *   - widenUncertainty applies law A11 exactly: symmetric 2x widening with
 *     halved confidence, and buildCounterfactualWithWidenedUncertainty
 *     brands the hypothetical (`hypothetical: true`, kind HYPOTHETICAL)
 *     with an interval STRICTLY wider than the baseline's;
 *   - propagateStaleness AGGREGATES the inputs' upstream staleness classes
 *     (worst-of: unknown > stale > fresh) — it never re-scores: the
 *     headline age is the classification-time age, and `rescored: false`
 *     is machine-carried;
 *   - the propagation verifies by digest; a FORGED headline (a "fresh"
 *     stamp over stale inputs) FAILS verification;
 *   - refusals: no inputs, a cross-tenant input (the offender named, A8).
 *
 * PREDICTIVE HONESTY LAW: everything here is a deterministic structural
 * reference — no trained-model or accuracy claims anywhere.
 *
 * Determinism: logical epochs (NOW_MS offsets) only; no clock, no
 * randomness, no network. Distinct from security.predictive-advice (host
 * cards) and security.predictive-honesty (honesty registry): this journey
 * drives the degraded-state surface, the widening law and the staleness
 * propagation engine.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  buildCounterfactualWithWidenedUncertainty,
  predictWithDegradation,
  propagateStaleness,
  referencePredict,
  verifyStalenessPropagation,
  widenUncertainty,
} from "@fleetos/predictive";
import type { ClassifiedInput, FeatureProjection, UncertaintyInterval } from "@fleetos/predictive";
import { BASE_MS, TENANT, FOREIGN_TENANT, NOW_MS } from "./fixture-world.ts";

const ASSET = { assetId: "pump-7" } as const;
const FEATURES: FeatureProjection = {
  tenant: TENANT,
  asset: ASSET,
  features: { mean: 30, min: 10, max: 50, stddev: 12.9 },
  computedAt: "2026-10-12T18:50:00.000Z",
  sourceObservationRefs: ["obs-pump-7-1", "obs-pump-7-2", "obs-pump-7-3"],
};

const BASELINE_UNCERTAINTY: UncertaintyInterval = {
  lower: 28,
  upper: 32,
  confidence: 0.9,
  method: "reference.constant",
};

const HEALTHY_OPTIONS = {
  value: 30,
  uncertainty: BASELINE_UNCERTAINTY,
  modelVersion: "reference-twin-1.0.0",
  capabilityVersion: "1.0.0",
  validUntil: "9999-12-31T00:00:00.000Z",
} as const;

function input(ref: string, staleness: ClassifiedInput["staleness"], ageMs: number | null, classifiedAtMs: number): ClassifiedInput {
  return { ref, tenantId: TENANT.tenantId, staleness, ageMs, classifiedAtMs };
}

export const degradationStalenessJourney: AcceptanceJourney = {
  journeyId: "security.degradation-staleness-honesty",
  persona: "site-reliability-engineer",
  capabilities: ["predictive-advice"],
  goal: "Verify degraded predictions refuse honestly, uncertainty widens by law, and staleness propagates without re-scoring",
  steps: [
    {
      stepId: "degradation-honesty",
      kind: "projection",
      description: "Drive every honest degraded state and the healthy structural reference path",
      packages: ["@fleetos/predictive"],
      operations: ["predictWithDegradation", "referencePredict"],
      run: (ctx) => {
        // The model is unavailable => the named degraded state, never a value.
        const unavailable = predictWithDegradation(FEATURES, { ...HEALTHY_OPTIONS, modelAvailable: false });
        ctx.record("degraded.unavailableOk", unavailable.ok);
        ctx.record("degraded.unavailableState", unavailable.ok ? "unexpected-value" : unavailable.degraded);
        ctx.record("degraded.unavailableReason", unavailable.ok ? "none" : unavailable.reason);

        // Empty features => insufficient history.
        const noHistory = predictWithDegradation(
          { ...FEATURES, features: {} },
          { ...HEALTHY_OPTIONS, modelAvailable: true },
        );
        ctx.record("degraded.noHistoryOk", noHistory.ok);
        ctx.record("degraded.noHistoryState", noHistory.ok ? "unexpected-value" : noHistory.degraded);

        // Empty tenant => tenant isolation (A8).
        const noTenant = predictWithDegradation(
          { ...FEATURES, tenant: { tenantId: "" } },
          { ...HEALTHY_OPTIONS, modelAvailable: true },
        );
        ctx.record("degraded.noTenantOk", noTenant.ok);
        ctx.record("degraded.noTenantState", noTenant.ok ? "unexpected-value" : noTenant.degraded);

        // The healthy path: a REAL PREDICTED value with provenance.
        const healthy = predictWithDegradation(FEATURES, { ...HEALTHY_OPTIONS, modelAvailable: true });
        if (!healthy.ok) throw new Error(`healthy prediction degraded: ${healthy.degraded}`);
        ctx.record("healthy.kind", healthy.value.kind);
        ctx.record("healthy.value", healthy.value.value);
        ctx.record("healthy.modelVersion", healthy.value.provenance.modelVersion);
        ctx.record("healthy.featureDigestLength", healthy.value.provenance.featureDigest.length);
        ctx.record("healthy.uncertaintyMethod", healthy.value.uncertainty.method);
        // Determinism: the same inputs => the same inputsDigest.
        const healthyAgain = referencePredict(FEATURES, HEALTHY_OPTIONS);
        ctx.record(
          "healthy.deterministic",
          healthyAgain.ok && healthyAgain.value.provenance.inputsDigest === healthy.value.provenance.inputsDigest,
        );
      },
    },
    {
      stepId: "widening-law",
      kind: "counterfactual",
      description: "Apply law A11 exactly: symmetric widening, halved confidence, hypothetical brand",
      packages: ["@fleetos/predictive"],
      operations: ["widenUncertainty", "buildCounterfactualWithWidenedUncertainty"],
      run: (ctx) => {
        const widened = widenUncertainty(BASELINE_UNCERTAINTY, 2);
        ctx.record("widen.lower", widened.lower);
        ctx.record("widen.upper", widened.upper);
        ctx.record("widen.confidence", widened.confidence);
        ctx.record("widen.method", widened.method);
        ctx.record("widen.symmetric", widened.upper - 30 === 30 - widened.lower);
        ctx.record("widen.widthDoubled", widened.upper - widened.lower === 2 * (BASELINE_UNCERTAINTY.upper - BASELINE_UNCERTAINTY.lower));

        // The counterfactual built over the healthy prediction.
        const baseline = referencePredict(FEATURES, HEALTHY_OPTIONS);
        if (!baseline.ok) throw new Error("baseline prediction degraded");
        const hypothetical = buildCounterfactualWithWidenedUncertainty(baseline.value, "raise coolant flow", 30, 2);
        ctx.record("cf.kind", hypothetical.kind);
        ctx.record("cf.hypothetical", hypothetical.hypothetical);
        ctx.record("cf.premise", hypothetical.premise);
        ctx.record("cf.lower", hypothetical.uncertainty.lower);
        ctx.record("cf.upper", hypothetical.uncertainty.upper);
        ctx.record("cf.widerThanBaseline", hypothetical.uncertainty.upper - hypothetical.uncertainty.lower > baseline.value.uncertainty.upper - baseline.value.uncertainty.lower);
        ctx.record("cf.confidenceHalved", hypothetical.uncertainty.confidence === baseline.value.uncertainty.confidence / 2);
      },
    },
    {
      stepId: "staleness-propagation",
      kind: "negative-check",
      description: "Propagate worst-of staleness without re-scoring; verify by digest; refuse empty and cross-tenant inputs",
      packages: ["@fleetos/predictive"],
      operations: ["propagateStaleness", "verifyStalenessPropagation"],
      run: (ctx) => {
        // A mixed bag: fresh + stale + unknown — worst-of wins (unknown).
        const inputs: readonly ClassifiedInput[] = [
          input("obs-pump-7-1", "fresh", 2_000, NOW_MS),
          input("obs-pump-7-2", "stale", 45_000, NOW_MS),
          input("obs-pump-7-3", "unknown", null, NOW_MS),
        ];
        const propagated = propagateStaleness(inputs, TENANT.tenantId);
        if (!propagated.ok) throw new Error(`propagation refused: ${propagated.reason}`);
        ctx.record("staleness.headline", propagated.propagation.headline);
        ctx.record("staleness.headlineRef", propagated.propagation.headlineRef);
        ctx.record("staleness.headlineAgeMs", propagated.propagation.headlineAgeMs);
        ctx.record("staleness.rescored", propagated.propagation.rescored);
        ctx.record("staleness.inputCount", propagated.propagation.inputs.length);
        ctx.record("staleness.inputsCanonicallyOrdered", propagated.propagation.inputs.map((i) => i.ref));
        ctx.record("staleness.digestLength", propagated.propagation.propagationDigest.length);

        // The propagation verifies (digest + headline recompute).
        const verified = verifyStalenessPropagation(propagated.propagation);
        ctx.record("staleness.verified", verified.verified);
        ctx.record("staleness.verifyReason", verified.reason);

        // Arrival order never leaks: reversed inputs => identical digest.
        const reversed = propagateStaleness([...inputs].reverse(), TENANT.tenantId);
        ctx.record(
          "staleness.orderInvariant",
          reversed.ok && reversed.propagation.propagationDigest === propagated.propagation.propagationDigest,
        );

        // NEGATIVE: a FORGED headline (fresh stamp over the mixed inputs) FAILS.
        const forged = { ...propagated.propagation, headline: "fresh" as const };
        const forgedCheck = verifyStalenessPropagation(forged);
        ctx.record("staleness.forgedVerified", forgedCheck.verified);
        ctx.record("staleness.forgedReason", forgedCheck.reason);

        // NEGATIVE: an empty input set REFUSES.
        const empty = propagateStaleness([], TENANT.tenantId);
        ctx.record("staleness.emptyOk", empty.ok);
        ctx.record("staleness.emptyReason", empty.ok ? "unexpected-allow" : empty.reason);

        // NEGATIVE: a cross-tenant input REFUSES naming the offender (A8).
        const cross = propagateStaleness(
          [input("obs-pump-7-1", "fresh", 2_000, NOW_MS), { ...input("obs-foreign-1", "fresh", 1_000, NOW_MS), tenantId: FOREIGN_TENANT.tenantId }],
          TENANT.tenantId,
        );
        ctx.record("staleness.crossOk", cross.ok);
        ctx.record("staleness.crossReason", cross.ok ? "unexpected-allow" : cross.reason);
        ctx.record("staleness.crossOffender", cross.ok ? "none" : cross.offender);

        // NEGATIVE: an empty tenant scope REFUSES.
        const noTenant = propagateStaleness(inputs, "");
        ctx.record("staleness.noTenantOk", noTenant.ok);
        ctx.record("staleness.noTenantReason", noTenant.ok ? "unexpected-allow" : noTenant.reason);

        // Stale-wins propagation (no unknown in the bag).
        const staleOnly = propagateStaleness(
          [input("obs-a", "fresh", 2_000, NOW_MS), input("obs-b", "stale", 45_000, NOW_MS)],
          TENANT.tenantId,
        );
        ctx.record("staleness.staleWins", staleOnly.ok ? staleOnly.propagation.headline : "refused");
      },
    },
  ],
  assertions: [
    { assertionId: "ds-1", description: "An unavailable model degrades honestly", path: "degraded.unavailableOk", expected: false },
    { assertionId: "ds-2", description: "The named degraded state is model_unavailable", path: "degraded.unavailableState", expected: "model_unavailable" },
    { assertionId: "ds-3", description: "The degradation reason carried", path: "degraded.unavailableReason", expected: "model is not available" },
    { assertionId: "ds-4", description: "Empty features degrade (insufficient history)", path: "degraded.noHistoryOk", expected: false },
    { assertionId: "ds-5", description: "The named degraded state is insufficient_history", path: "degraded.noHistoryState", expected: "insufficient_history" },
    { assertionId: "ds-6", description: "An empty tenant degrades (isolation)", path: "degraded.noTenantOk", expected: false },
    { assertionId: "ds-7", description: "The named degraded state is tenant_isolated", path: "degraded.noTenantState", expected: "tenant_isolated" },
    { assertionId: "ds-8", description: "The healthy path yields a PREDICTED value", path: "healthy.kind", expected: "PREDICTED" },
    { assertionId: "ds-9", description: "The healthy value is carried verbatim", path: "healthy.value", expected: 30 },
    { assertionId: "ds-10", description: "The model identity is the structural reference twin", path: "healthy.modelVersion", expected: "reference-twin-1.0.0" },
    { assertionId: "ds-11", description: "The feature digest is FNV-1a 8-hex (the lane convention)", path: "healthy.featureDigestLength", expected: 8 },
    { assertionId: "ds-12", description: "The baseline uncertainty method carried", path: "healthy.uncertaintyMethod", expected: "reference.constant" },
    { assertionId: "ds-13", description: "The healthy prediction is deterministic", path: "healthy.deterministic", expected: true },
    { assertionId: "ds-14", description: "Widening keeps the center (lower 26)", path: "widen.lower", expected: 26 },
    { assertionId: "ds-15", description: "Widening keeps the center (upper 34)", path: "widen.upper", expected: 34 },
    { assertionId: "ds-16", description: "Confidence halves under widening", path: "widen.confidence", expected: 0.45 },
    { assertionId: "ds-17", description: "The widening keeps the method label", path: "widen.method", expected: "reference.constant" },
    { assertionId: "ds-18", description: "The widening is symmetric around the center", path: "widen.symmetric", expected: true },
    { assertionId: "ds-19", description: "The interval width exactly doubles", path: "widen.widthDoubled", expected: true },
    { assertionId: "ds-20", description: "The counterfactual is HYPOTHETICAL-branded", path: "cf.kind", expected: "HYPOTHETICAL" },
    { assertionId: "ds-21", description: "The hypothetical marker is machine-carried", path: "cf.hypothetical", expected: true },
    { assertionId: "ds-22", description: "The premise carried on the value", path: "cf.premise", expected: "raise coolant flow" },
    { assertionId: "ds-23", description: "The hypothetical lower bound is widened", path: "cf.lower", expected: 26 },
    { assertionId: "ds-24", description: "The hypothetical upper bound is widened", path: "cf.upper", expected: 34 },
    { assertionId: "ds-25", description: "The hypothetical is STRICTLY wider than the baseline", path: "cf.widerThanBaseline", expected: true },
    { assertionId: "ds-26", description: "The hypothetical confidence halves", path: "cf.confidenceHalved", expected: true },
    { assertionId: "ds-27", description: "Worst-of propagation: unknown wins the headline", path: "staleness.headline", expected: "unknown" },
    { assertionId: "ds-28", description: "The headline input is named", path: "staleness.headlineRef", expected: "obs-pump-7-3" },
    { assertionId: "ds-29", description: "The headline age is the classification-time age (never re-derived)", path: "staleness.headlineAgeMs", expected: null },
    { assertionId: "ds-30", description: "The propagation machine-carries rescored=false", path: "staleness.rescored", expected: false },
    { assertionId: "ds-31", description: "Every input carried verbatim", path: "staleness.inputCount", expected: 3 },
    { assertionId: "ds-32", description: "Inputs are canonically ordered by ref", path: "staleness.inputsCanonicallyOrdered", expected: ["obs-pump-7-1", "obs-pump-7-2", "obs-pump-7-3"] },
    { assertionId: "ds-33", description: "The propagation digest is 8-hex", path: "staleness.digestLength", expected: 8 },
    { assertionId: "ds-34", description: "The propagation verifies (digest + headline)", path: "staleness.verified", expected: true },
    { assertionId: "ds-35", description: "A clean verification carries no reason", path: "staleness.verifyReason", expected: null },
    { assertionId: "ds-36", description: "Arrival order never leaks (identical digests)", path: "staleness.orderInvariant", expected: true },
    { assertionId: "ds-37", description: "A FORGED fresh headline fails verification", path: "staleness.forgedVerified", expected: false },
    { assertionId: "ds-38", description: "The forged-headline reason", path: "staleness.forgedReason", expected: "staleness.headline-mismatch" },
    { assertionId: "ds-39", description: "An empty input set refuses", path: "staleness.emptyOk", expected: false },
    { assertionId: "ds-40", description: "Empty-input refusal code", path: "staleness.emptyReason", expected: "staleness.no-inputs" },
    { assertionId: "ds-41", description: "A cross-tenant input refuses (A8)", path: "staleness.crossOk", expected: false },
    { assertionId: "ds-42", description: "Cross-tenant refusal code", path: "staleness.crossReason", expected: "staleness.tenant-mismatch" },
    { assertionId: "ds-43", description: "The cross-tenant offender is named", path: "staleness.crossOffender", expected: "obs-foreign-1" },
    { assertionId: "ds-44", description: "An empty tenant scope refuses", path: "staleness.noTenantOk", expected: false },
    { assertionId: "ds-45", description: "Empty-tenant refusal code", path: "staleness.noTenantReason", expected: "staleness.tenant-mismatch" },
    { assertionId: "ds-46", description: "Without unknowns, stale wins the headline", path: "staleness.staleWins", expected: "stale" },
  ],
};
