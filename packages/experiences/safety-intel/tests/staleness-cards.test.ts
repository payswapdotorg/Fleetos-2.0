/**
 * Propagated-staleness card tests (F280B, Wave 8 lane B).
 *
 * THE REAL CHAIN, end to end: world-model `classifyStaleness` (upstream,
 * once) -> predictive `propagateStaleness` (aggregate, no re-scoring) ->
 * the propagated-staleness advisory card (the class surfaces in the output).
 * The card builder takes NO clock — the structural no-re-scoring proof.
 */
import { describe, it, expect } from "vitest";
import { makeReferenceModelPort } from "@fleetos/predictive";
import { propagateStaleness } from "@fleetos/predictive";
import type { Prediction, StalenessPropagation } from "@fleetos/predictive";
import { classifyStaleness } from "@fleetos/world-model";
import {
  buildPropagatedStalenessAdvisoryCard,
  isPropagatedStalenessCard,
} from "../src/index.ts";

const TENANT = "tnt_chain";
const T0 = 1_774_000_000_000;
const THRESHOLDS = { freshWithinMs: 10_000, staleWithinMs: 60_000 };

// ---------------------------------------------------------------------------
// REAL fixtures — a REAL prediction from the REAL reference model port
// ---------------------------------------------------------------------------

function realPrediction(): Prediction {
  const port = makeReferenceModelPort();
  const r = port.project(
    {
      tenant: { tenantId: TENANT },
      asset: { assetId: "asset-1" },
      metric: "temperature",
      observations: [
        { observationRef: "obs-1", atMs: T0 - 3_000, value: 10 },
        { observationRef: "obs-2", atMs: T0 - 2_000, value: 20 },
        { observationRef: "obs-3", atMs: T0 - 1_000, value: 30 },
      ],
      asOfMs: T0,
    },
    { steps: 2, stepMs: 1_000 },
  );
  if (!r.ok) throw new Error(`fixture projection refused: ${r.rejected}/${r.detail}`);
  return r.prediction;
}

/** Classify REAL inputs upstream (the world-model's REAL classifier). */
function classifyUpstream(
  observedAtMs: number,
  classifiedAtMs: number,
  ref: string,
): { ref: string; tenantId: string; staleness: "fresh" | "stale" | "unknown"; ageMs: number | null; classifiedAtMs: number } {
  const c = classifyStaleness(observedAtMs, classifiedAtMs, THRESHOLDS);
  if (!c.ok) throw new Error("fixture classification refused");
  return {
    ref,
    tenantId: TENANT,
    staleness: c.staleness,
    ageMs: c.ageMs,
    classifiedAtMs,
  };
}

function mustPropagation(inputs: Parameters<typeof propagateStaleness>[0], tenant: string): StalenessPropagation {
  const r = propagateStaleness(inputs, tenant);
  if (!r.ok) throw new Error(`fixture propagation refused: ${r.reason}`);
  return r.propagation;
}

function mustCard(prediction: Prediction, propagation: StalenessPropagation) {
  const r = buildPropagatedStalenessAdvisoryCard({ prediction, propagation });
  if (!r.ok) throw new Error(`fixture card refused: ${r.refused}`);
  return r.card;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("propagated-staleness cards — the REAL chain", () => {
  it("a STALE input's class surfaces in the advisory card output", () => {
    // Upstream REAL classification: last observed 40s before classification
    // time -> 'stale' under the thresholds.
    const staleInput = classifyUpstream(T0 - 40_000, T0, "obs-stale");
    expect(staleInput.staleness).toBe("stale");
    const propagation = mustPropagation([staleInput], TENANT);
    const card = mustCard(realPrediction(), propagation);
    expect(card.staleness).toBe("stale");
    expect(card.stalenessSource).toMatchObject({
      kind: "propagated", headlineRef: "obs-stale", rescored: false,
    });
    expect(card.ageMs).toBe(40_000); // age AT CLASSIFICATION TIME
  });

  it("an UNKNOWN input dominates: the card says unknown, never invented", () => {
    const inputs = [
      classifyUpstream(T0 - 5_000, T0, "obs-fresh"),
      classifyUpstream(T0 - 500_000, T0, "obs-ancient"), // beyond stale window
    ];
    expect(inputs[1]!.staleness).toBe("unknown");
    const card = mustCard(realPrediction(), mustPropagation(inputs, TENANT));
    expect(card.staleness).toBe("unknown");
  });

  it("NO RE-SCORING: the card carries the classified class even for a LATER display", () => {
    // Input classified 'fresh' at T0. Building the card happens with NO
    // clock at all — even though a naive re-score at T0+500s would say
    // 'unknown', the card says 'fresh' (the propagated class).
    const freshInput = classifyUpstream(T0 - 5_000, T0, "obs-fresh");
    expect(freshInput.staleness).toBe("fresh");
    const laterRescoreWouldSay = classifyStaleness(T0 - 5_000, T0 + 500_000, THRESHOLDS);
    expect(laterRescoreWouldSay.ok && laterRescoreWouldSay.staleness).toBe("unknown");
    const card = mustCard(realPrediction(), mustPropagation([freshInput], TENANT));
    expect(card.staleness).toBe("fresh");
  });

  it("the card carries REAL prediction provenance and min-bps confidence", () => {
    const card = mustCard(
      realPrediction(),
      mustPropagation([classifyUpstream(T0 - 5_000, T0, "obs-fresh")], TENANT),
    );
    const prediction = realPrediction();
    expect(card.provenance.modelVersion).toBe(prediction.provenance.modelVersion);
    expect(card.provenance.inputDigest).toBe(prediction.provenance.inputDigest);
    expect(card.confidenceBps).toBe(
      Math.min(...prediction.points.map((p) => p.confidenceBps)),
    );
    expect(card.advisory).toBe(true);
  });

  it("is deterministic: identical inputs produce byte-identical cards", () => {
    const build = () =>
      mustCard(
        realPrediction(),
        mustPropagation([classifyUpstream(T0 - 40_000, T0, "obs-stale")], TENANT),
      );
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it("the runtime guard accepts genuine cards and rejects stripped/marked-down forgeries", () => {
    const card = mustCard(
      realPrediction(),
      mustPropagation([classifyUpstream(T0 - 5_000, T0, "obs-fresh")], TENANT),
    );
    expect(isPropagatedStalenessCard(card)).toBe(true);
    // A JSON round-trip keeps the machine-carried marker verifiable.
    expect(isPropagatedStalenessCard(JSON.parse(JSON.stringify(card)))).toBe(true);
    // A marker-stripped forgery is rejected (law A2).
    const stripped = { ...card, advisory: false };
    expect(isPropagatedStalenessCard(stripped)).toBe(false);
    // A forged 'rescored: true' staleness source is rejected.
    const rescored = {
      ...card,
      stalenessSource: { ...card.stalenessSource, rescored: true },
    };
    expect(isPropagatedStalenessCard(rescored)).toBe(false);
  });
});

describe("propagated-staleness cards — refusals", () => {
  it("refuses a prediction whose advisory marker was stripped", () => {
    const prediction = realPrediction();
    const stripped = { ...prediction, advisory: false } as unknown as Prediction;
    const r = buildPropagatedStalenessAdvisoryCard({
      prediction: stripped,
      propagation: mustPropagation([classifyUpstream(T0 - 5_000, T0, "obs-1")], TENANT),
    });
    expect(r).toMatchObject({ ok: false, refused: "card.non-advisory-input" });
  });

  it("A8: refuses a propagation belonging to another tenant", () => {
    const r = buildPropagatedStalenessAdvisoryCard({
      prediction: realPrediction(),
      propagation: mustPropagation(
        [{
          ref: "obs-x", tenantId: "tnt_other", staleness: "fresh",
          ageMs: 1, classifiedAtMs: T0,
        }],
        "tnt_other",
      ),
    });
    expect(r).toMatchObject({ ok: false, refused: "card.tenant-mismatch" });
  });

  it("refuses a FORGED propagation (integrity gate)", () => {
    const propagation = mustPropagation(
      [classifyUpstream(T0 - 40_000, T0, "obs-stale")],
      TENANT,
    );
    const forged = { ...propagation, headline: "fresh" as const };
    const r = buildPropagatedStalenessAdvisoryCard({
      prediction: realPrediction(),
      propagation: forged,
    });
    expect(r).toMatchObject({ ok: false, refused: "card.propagation-integrity" });
    if (!r.ok) expect(r.detail).toContain("headline-mismatch");
  });
});
