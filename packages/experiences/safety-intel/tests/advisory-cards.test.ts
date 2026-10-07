/**
 * advisory-cards tests (F240B) — the advisory-law proofs at the view
 * boundary (law A2), integer-bps confidence, staleness classification,
 * redaction proofs, board ordering, determinism.
 *
 * Real predictions are produced by the REAL deterministic reference model
 * (`projectReferenceTwin` — the intra-lane test composition site; the
 * F230B precedent for binding real implementations in tests).
 */
import { beforeAll, describe, it, expect } from "vitest";
import {
  buildAdvisoryBoard,
  buildPredictionAdvisoryCard,
  buildWorldContextAdvisoryCard,
  isAdvisoryCard,
} from "../src/advisory-cards.ts";
import type { AdvisoryCardView } from "../src/advisory-cards.ts";
import { projectReferenceTwin } from "@fleetos/predictive";
import type { Prediction, TwinStateInput } from "@fleetos/predictive";
import type {
  AssembledContext,
  WorldEntitySnapshot,
} from "@fleetos/world-context";
import type {
  FindingIntakeCandidate,
  SecurityFinding,
} from "@fleetos/security";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THRESHOLDS = { freshWithinMs: 1000, staleWithinMs: 5000 };

function twinState(observations: readonly { ref: string; atMs: number; value: number }[] = [
  { ref: "obs-1", atMs: 1000, value: 10 },
  { ref: "obs-2", atMs: 2000, value: 12 },
  { ref: "obs-3", atMs: 3000, value: 14 },
]): TwinStateInput {
  return {
    tenant: { tenantId: "t1" },
    asset: { assetId: "a-1" },
    metric: "temperature",
    observations: observations.map((o) => ({ observationRef: o.ref, atMs: o.atMs, value: o.value })),
    asOfMs: 3000,
  };
}

function prediction(): Prediction {
  const r = projectReferenceTwin(twinState(), { steps: 3, stepMs: 1000 });
  if (!r.ok) throw new Error(`reference model rejected: ${r.rejected}`);
  return r.prediction;
}

function assembledContext(): AssembledContext {
  return {
    schemaVersion: "1.0.0",
    tenantId: "t1",
    purpose: "security-review",
    features: {
      "a-1#temperature": 42,
      "a-1#operatorName": "[REDACTED]",
      "a-1#location": "[REDACTED]",
    },
    entityIds: ["a-1"],
    provenance: [
      { entityId: "a-1", observationRef: "obs-9", observedAtMs: 3000 },
    ],
    redactedFields: ["a-1#operatorName", "a-1#location"],
    digest: "ctx-d-1",
    computedAt: "2026-10-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Prediction cards
// ---------------------------------------------------------------------------

describe("prediction advisory cards", () => {
  it("carries advisory: true STRUCTURALLY and surfaces provenance + integer-bps confidence", () => {
    const r = buildPredictionAdvisoryCard({ prediction: prediction(), nowMs: 3000, thresholds: THRESHOLDS });
    if (!r.ok) throw new Error("expected ok");
    const c = r.card;
    expect(c.advisory).toBe(true);
    expect(c.tenantId).toBe("t1");
    expect(c.title).toBe("Predicted temperature for a-1");
    expect(c.provenance.modelVersion).toBe("reference-twin-1.0.0");
    expect(c.provenance.observationRefs).toEqual(["obs-1", "obs-2", "obs-3"]);
    expect(typeof c.provenance.inputDigest).toBe("string");
    // Conservative headline: the MINIMUM confidence across projected points.
    const confidences = prediction().points.map((p) => p.confidenceBps);
    expect(c.confidenceBps).toBe(Math.min(...confidences));
    expect(Number.isInteger(c.confidenceBps)).toBe(true);
    expect(c.subject).toMatchObject({
      kind: "prediction",
      assetId: "a-1",
      metric: "temperature",
      horizonSteps: 3,
      horizonStepMs: 1000,
    });
  });

  it("classifies staleness from the projection's data anchor at the caller's logical now", () => {
    const fresh = buildPredictionAdvisoryCard({ prediction: prediction(), nowMs: 3500, thresholds: THRESHOLDS });
    const stale = buildPredictionAdvisoryCard({ prediction: prediction(), nowMs: 3000 + 3000, thresholds: THRESHOLDS });
    const unknown = buildPredictionAdvisoryCard({ prediction: prediction(), nowMs: 3000 + 9999, thresholds: THRESHOLDS });
    if (!fresh.ok || !stale.ok || !unknown.ok) throw new Error("expected ok");
    expect(fresh.card.staleness).toBe("fresh");
    expect(fresh.card.ageMs).toBe(500);
    expect(stale.card.staleness).toBe("stale");
    expect(unknown.card.staleness).toBe("unknown");
  });

  it("REFUSES a stripped prediction (the advisory marker verified on input)", () => {
    const stripped = prediction() as unknown as Record<string, unknown>;
    delete stripped["advisory"];
    const r = buildPredictionAdvisoryCard({
      prediction: stripped as unknown as Prediction,
      nowMs: 3000,
      thresholds: THRESHOLDS,
    });
    expect(r).toMatchObject({ ok: false, refused: "card.non-advisory-input" });
  });

  it("refuses a missing tenant, an empty projection and invalid confidence", () => {
    const noTenant = prediction() as unknown as Record<string, unknown>;
    noTenant["tenant"] = { tenantId: "" };
    expect(
      buildPredictionAdvisoryCard({
        prediction: noTenant as unknown as Prediction,
        nowMs: 3000,
        thresholds: THRESHOLDS,
      }),
    ).toMatchObject({ ok: false, refused: "card.missing-tenant" });

    const empty = prediction() as unknown as Record<string, unknown>;
    empty["points"] = [];
    expect(
      buildPredictionAdvisoryCard({ prediction: empty as unknown as Prediction, nowMs: 3000, thresholds: THRESHOLDS }),
    ).toMatchObject({ ok: false, refused: "card.empty-projection" });

    const badConfidence = prediction() as unknown as Record<string, unknown>;
    badConfidence["points"] = (badConfidence["points"] as { confidenceBps: number }[]).map((p) => ({
      ...p,
      confidenceBps: 20000,
    }));
    expect(
      buildPredictionAdvisoryCard({
        prediction: badConfidence as unknown as Prediction,
        nowMs: 3000,
        thresholds: THRESHOLDS,
      }),
    ).toMatchObject({ ok: false, refused: "card.invalid-confidence-bps" });
  });

  it("propagates invalid staleness thresholds honestly", () => {
    const r = buildPredictionAdvisoryCard({
      prediction: prediction(),
      nowMs: 3000,
      thresholds: { freshWithinMs: 5000, staleWithinMs: 1000 },
    });
    expect(r).toMatchObject({ ok: false, refused: "card.invalid-thresholds" });
  });
});

// ---------------------------------------------------------------------------
// World-context cards + redaction proofs
// ---------------------------------------------------------------------------

describe("world-context advisory cards", () => {
  it("presents derived context as advisory with honest null confidence", () => {
    const r = buildWorldContextAdvisoryCard({ context: assembledContext(), nowMs: 3200, thresholds: THRESHOLDS });
    if (!r.ok) throw new Error("expected ok");
    const c = r.card;
    expect(c.advisory).toBe(true);
    expect(c.confidenceBps).toBeNull();
    expect(c.subject).toMatchObject({
      kind: "world-context",
      entityIds: ["a-1"],
      featureCount: 3,
      redactedFieldCount: 2,
    });
    expect(c.staleness).toBe("fresh");
    expect(c.ageMs).toBe(200);
    expect(c.provenance.observationRefs).toEqual(["obs-9"]);
  });

  it("REDACTION PROOF: no feature value, key or redaction sentinel leaks into the card", () => {
    const r = buildWorldContextAdvisoryCard({ context: assembledContext(), nowMs: 3200, thresholds: THRESHOLDS });
    if (!r.ok) throw new Error("expected ok");
    const serialized = JSON.stringify(r.card);
    expect(serialized).not.toContain("[REDACTED]");
    expect(serialized).not.toContain("operatorName");
    expect(serialized).not.toContain("location");
    expect(serialized).not.toContain("temperature");
    // The subject presents counts only — never feature content.
    if (r.card.subject.kind !== "world-context") throw new Error("expected world-context subject");
    expect(r.card.subject.redactedFieldCount).toBe(2);
    expect(r.card.subject.featureCount).toBe(3);
  });

  it("classifies never-observed context as unknown staleness", () => {
    const ctx = assembledContext();
    const r = buildWorldContextAdvisoryCard({
      context: { ...ctx, provenance: [{ entityId: "a-1", observationRef: null, observedAtMs: null }] },
      nowMs: 3200,
      thresholds: THRESHOLDS,
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.card.staleness).toBe("unknown");
    expect(r.card.ageMs).toBeNull();
  });

  it("refuses a missing tenant and invalid thresholds", () => {
    expect(
      buildWorldContextAdvisoryCard({
        context: { ...assembledContext(), tenantId: "" },
        nowMs: 3200,
        thresholds: THRESHOLDS,
      }),
    ).toMatchObject({ ok: false, refused: "card.missing-tenant" });
    expect(
      buildWorldContextAdvisoryCard({
        context: assembledContext(),
        nowMs: 3200,
        thresholds: { freshWithinMs: -1, staleWithinMs: 5000 },
      }),
    ).toMatchObject({ ok: false, refused: "card.invalid-thresholds" });
  });
});

// ---------------------------------------------------------------------------
// ADVISORY LAW at the view boundary — the compile-pinned proofs
// ---------------------------------------------------------------------------

describe("advisory-law proofs at the view boundary (law A2)", () => {
  let card: AdvisoryCardView;
  beforeAll(() => {
    const r = buildPredictionAdvisoryCard({ prediction: prediction(), nowMs: 3000, thresholds: THRESHOLDS });
    if (!r.ok) throw new Error("expected ok");
    card = r.card;
  });

  it("a card is NOT assignable to any authoritative input type (compile-pinned)", () => {
    // @ts-expect-error — a card feeding back as a SecurityFinding is a type error
    const asFinding: SecurityFinding = card;
    // @ts-expect-error — a card feeding back as an intake candidate is a type error
    const asCandidate: FindingIntakeCandidate = card;
    // @ts-expect-error — a card feeding back as a world entity snapshot is a type error
    const asEntity: WorldEntitySnapshot = card;
    // @ts-expect-error — a card feeding back as a twin state input is a type error
    const asTwinState: TwinStateInput = card;
    expect([asFinding, asCandidate, asEntity, asTwinState]).toHaveLength(4);
  });

  it("a card is NOT constructible outside the module (brand is module-private)", () => {
    // @ts-expect-error — the module-private brand cannot be referenced outside
    const forged: AdvisoryCardView = {
      cardId: "advisory|forged",
      tenantId: "t1",
      title: "forged",
      advisory: true,
      confidenceBps: 9000,
      provenance: { modelVersion: "x", method: "y", observationRefs: [], inputDigest: "z" },
      staleness: "fresh",
      ageMs: 0,
      subject: {
        kind: "world-context",
        entityIds: [],
        featureCount: 0,
        redactedFieldCount: 0,
      },
    };
    expect(forged).toBeDefined();
  });

  it("a JSON round-trip cannot re-enter as a typed card (compile-pinned)", () => {
    const serialized = JSON.stringify(card);
    // `unknown` (not `any`) so the assignment below is a genuine type error —
    // deserialized advisory data lacks the brand and cannot re-enter typed.
    // @ts-expect-error — JSON round-trips do not carry the module-private brand
    const round: AdvisoryCardView = JSON.parse(serialized) as unknown;
    expect(round.cardId).toBe(card.cardId);
  });

  it("the runtime guard rejects a marker-stripped copy and accepts the intact one", () => {
    const stripped = JSON.parse(JSON.stringify(card)) as Record<string, unknown>;
    delete stripped["advisory"];
    expect(isAdvisoryCard(stripped)).toBe(false);
    expect(isAdvisoryCard(JSON.parse(JSON.stringify(card)))).toBe(true);
    expect(isAdvisoryCard({ advisory: true })).toBe(false);
    expect(isAdvisoryCard(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

describe("advisory board", () => {
  function twoCards(): AdvisoryCardView[] {
    const a = buildPredictionAdvisoryCard({ prediction: prediction(), nowMs: 3000, thresholds: THRESHOLDS });
    const ctxCard = buildWorldContextAdvisoryCard({ context: assembledContext(), nowMs: 3200, thresholds: THRESHOLDS });
    if (!a.ok || !ctxCard.ok) throw new Error("expected ok");
    return [a.card, ctxCard.card];
  }

  it("orders cards by cardId asc, carries advisory: true, and digests the board", () => {
    const r = buildAdvisoryBoard(twoCards());
    if (!r.ok) throw new Error("expected ok");
    expect(r.board.advisory).toBe(true);
    const ids = r.board.cards.map((c) => c.cardId);
    expect(ids).toEqual([...ids].sort());
    expect(typeof r.board.digest).toBe("string");
  });

  it("refuses an empty board and a cross-tenant card, offender named", () => {
    expect(buildAdvisoryBoard([])).toMatchObject({ ok: false, refused: "card.no-cards" });
    const cards = twoCards();
    const a = cards[0]!;
    const b = cards[1]!;
    const foreign = { ...b, tenantId: "t2" } as AdvisoryCardView;
    const r = buildAdvisoryBoard([a, foreign]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refused).toBe("card.cross-tenant-card");
    expect(r.detail).toContain("t2");
  });

  it("is deterministic — same cards => byte-identical board", () => {
    const a = buildAdvisoryBoard(twoCards());
    const b = buildAdvisoryBoard(twoCards());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// Determinism of the cards themselves
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("same inputs => byte-identical prediction card (canonical JSON)", () => {
    const a = buildPredictionAdvisoryCard({ prediction: prediction(), nowMs: 3000, thresholds: THRESHOLDS });
    const b = buildPredictionAdvisoryCard({ prediction: prediction(), nowMs: 3000, thresholds: THRESHOLDS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("same inputs => byte-identical world-context card", () => {
    const a = buildWorldContextAdvisoryCard({ context: assembledContext(), nowMs: 3200, thresholds: THRESHOLDS });
    const b = buildWorldContextAdvisoryCard({ context: assembledContext(), nowMs: 3200, thresholds: THRESHOLDS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
