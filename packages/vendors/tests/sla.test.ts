/**
 * @fleetos/vendors — Wave 8 (F280C) SLA contract math tests: definitions
 * as data, deterministic evaluation with exact breach evidence, penalty
 * caps, scorecards verbatim-by-reference, tenant fail-closed probes.
 */
import { describe, expect, it } from "vitest";
import {
  validateSlaDefinition,
  evaluateSla,
  buildSlaScorecard,
  slaEvaluationDigest,
  type SlaDefinition,
  type SlaResponseBand,
  type FulfillmentOutcomeRecord,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const OTHER_TENANT: TenantScope = { tenantId: "globex" };

const BANDS: readonly SlaResponseBand[] = [
  { bandId: "minor", maxLatenessMs: 3_600_000, penaltyBps: 50 },
  { bandId: "major", maxLatenessMs: 86_400_000, penaltyBps: 200 },
  { bandId: "critical", maxLatenessMs: 604_800_000, penaltyBps: 500 },
];

function definition(overrides: Partial<SlaDefinition> = {}): SlaDefinition {
  return {
    slaId: "sla-alpha",
    tenant: TENANT,
    vendorId: "v-alpha",
    availabilityTargetBps: 9000,
    responseBands: BANDS,
    creditCapBps: 1000,
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides,
  };
}

function outcome(overrides: Partial<FulfillmentOutcomeRecord> = {}): FulfillmentOutcomeRecord {
  return {
    vendorId: "v-alpha",
    tenant: TENANT,
    orderId: "o-1",
    promisedAt: 1_000_000,
    deliveredAt: 1_000_000,
    quantityOrdered: 10,
    quantityReceived: 10,
    ...overrides,
  };
}

describe("validateSlaDefinition — definitions are DATA", () => {
  it("accepts a well-formed definition and returns it verbatim", () => {
    const def = definition();
    const result = validateSlaDefinition(def);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.definition).toEqual(def);
  });

  it("refuses bands that are not strictly ascending", () => {
    const result = validateSlaDefinition(
      definition({
        responseBands: [
          { bandId: "a", maxLatenessMs: 100, penaltyBps: 10 },
          { bandId: "b", maxLatenessMs: 100, penaltyBps: 20 },
        ],
      }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "INVALID_BAND_ORDER" });
  });

  it("refuses duplicate band ids", () => {
    const result = validateSlaDefinition(
      definition({
        responseBands: [
          { bandId: "a", maxLatenessMs: 100, penaltyBps: 10 },
          { bandId: "a", maxLatenessMs: 200, penaltyBps: 20 },
        ],
      }),
    );
    expect(result).toEqual({ ok: false, reasonCode: "BAND_ID_DUPLICATE" });
  });

  it("refuses out-of-range penalties, caps, targets and empty bands", () => {
    expect(
      validateSlaDefinition(definition({ responseBands: [] })),
    ).toEqual({ ok: false, reasonCode: "NO_RESPONSE_BANDS" });
    expect(
      validateSlaDefinition(
        definition({ responseBands: [{ bandId: "a", maxLatenessMs: 10, penaltyBps: 10001 }] }),
      ),
    ).toEqual({ ok: false, reasonCode: "INVALID_PENALTY_BPS" });
    expect(validateSlaDefinition(definition({ creditCapBps: -1 }))).toEqual({
      ok: false,
      reasonCode: "INVALID_CREDIT_CAP_BPS",
    });
    expect(validateSlaDefinition(definition({ availabilityTargetBps: 20000 }))).toEqual({
      ok: false,
      reasonCode: "INVALID_AVAILABILITY_TARGET",
    });
  });

  it("refuses an inverted effective window", () => {
    expect(
      validateSlaDefinition(definition({ effectiveFrom: 500, effectiveTo: 400 })),
    ).toEqual({ ok: false, reasonCode: "INVALID_WINDOW" });
  });
});

describe("evaluateSla — deterministic evaluation with exact evidence", () => {
  it("all on-time outcomes: no breaches, availability 10000 bps, target met", () => {
    const result = evaluateSla(
      TENANT,
      definition(),
      [outcome(), outcome({ orderId: "o-2" }), outcome({ orderId: "o-3" })],
      9_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const e = result.evaluation;
    expect(e.outcomeCount).toBe(3);
    expect(e.onTimeCount).toBe(3);
    expect(e.availabilityBps).toBe(10000);
    expect(e.availabilityMet).toBe(true);
    expect(e.breaches).toEqual([]);
    expect(e.totalPenaltyBps).toBe(0);
    expect(e.capApplied).toBe(false);
    expect(e.evaluatedAt).toBe(9_000_000);
  });

  it("breach lands in the FIRST band whose maxLatenessMs covers the lateness", () => {
    const result = evaluateSla(
      TENANT,
      definition(),
      [
        outcome(),
        outcome({ orderId: "o-late", deliveredAt: 1_000_000 + 3_600_000 }),
      ],
      9_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.breaches).toEqual([
      {
        orderId: "o-late",
        bandId: "minor",
        latenessMs: 3_600_000,
        penaltyBps: 50,
        promisedAt: 1_000_000,
        deliveredAt: 4_600_000,
      },
    ]);
  });

  it("band boundaries are inclusive; lateness beyond the last band uses the terminal band", () => {
    const result = evaluateSla(
      TENANT,
      definition(),
      [
        outcome({ orderId: "o-edge", deliveredAt: 1_000_000 + 86_400_000 }),
        outcome({ orderId: "o-beyond", deliveredAt: 1_000_000 + 999_999_999 }),
      ],
      9_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bands = result.evaluation.breaches.map((b) => b.bandId);
    expect(bands).toEqual(["major", "critical"]);
  });

  it("penalties sum, then cap at creditCapBps with capApplied recorded", () => {
    const result = evaluateSla(
      TENANT,
      definition({ creditCapBps: 300 }),
      [
        outcome(),
        outcome({ orderId: "o-1", deliveredAt: 1_000_000 + 1 }),
        outcome({ orderId: "o-2", deliveredAt: 1_000_000 + 999_999_999 }),
        outcome({ orderId: "o-3", deliveredAt: 1_000_000 + 999_999_999 }),
      ],
      9_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const e = result.evaluation;
    expect(e.totalPenaltyBpsUncapped).toBe(1050);
    expect(e.totalPenaltyBps).toBe(300);
    expect(e.capApplied).toBe(true);
  });

  it("availability is the fill-rate floor(received/ordered) in bps, distinct from response breaches", () => {
    // On time, but short-shipped: 5 + 10 received of 10 + 10 ordered -> 7500 bps.
    const result = evaluateSla(
      TENANT,
      definition(),
      [
        outcome({ orderId: "o-1", quantityOrdered: 10, quantityReceived: 5 }),
        outcome({ orderId: "o-2", quantityOrdered: 10, quantityReceived: 10 }),
      ],
      9_000_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.availabilityBps).toBe(7500);
    expect(result.evaluation.availabilityMet).toBe(false);
    expect(result.evaluation.breaches).toEqual([]);
    expect(result.evaluation.onTimeCount).toBe(2);
  });

  it("the effective window filters by promisedAt inclusively on both ends", () => {
    const result = evaluateSla(
      TENANT,
      definition({ effectiveFrom: 1_000, effectiveTo: 2_000 }),
      [
        outcome({ orderId: "before", promisedAt: 999, deliveredAt: 999 }),
        outcome({ orderId: "in", promisedAt: 1_000, deliveredAt: 1_000 }),
        outcome({ orderId: "in2", promisedAt: 2_000, deliveredAt: 2_000 }),
        outcome({ orderId: "after", promisedAt: 2_001, deliveredAt: 2_001 }),
      ],
      9_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.outcomeCount).toBe(2);
  });

  it("window filtering to nothing refuses EMPTY_SLA_HISTORY", () => {
    const result = evaluateSla(
      TENANT,
      definition({ effectiveTo: 500 }),
      [outcome()],
      9_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "EMPTY_SLA_HISTORY" });
  });

  it("identical inputs produce byte-identical digests; different evidence differs", () => {
    const history = [outcome(), outcome({ orderId: "o-2", deliveredAt: 5_000_000 })];
    const a = evaluateSla(TENANT, definition(), history, 100);
    const b = evaluateSla(TENANT, definition(), history, 100);
    expect(a.ok && b.ok && a.evaluation.digest === b.evaluation.digest).toBe(true);
    const c = evaluateSla(TENANT, definition(), history, 101);
    expect(a.ok && c.ok && a.evaluation.digest !== c.evaluation.digest).toBe(true);
  });

  it("refuses non-integer or negative quantities (NEGATIVE_QUANTITY)", () => {
    const result = evaluateSla(
      TENANT,
      definition(),
      [outcome({ quantityReceived: -1 })],
      1,
    );
    expect(result).toEqual({ ok: false, reasonCode: "NEGATIVE_QUANTITY" });
  });

  it("zero ordered quantity yields honest 10000 bps availability", () => {
    const result = evaluateSla(
      TENANT,
      definition(),
      [outcome({ quantityOrdered: 0, quantityReceived: 0 })],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.availabilityBps).toBe(10000);
  });

  it("TENANT fail-closed: a foreign-tenant outcome refuses (never silently filtered)", () => {
    const result = evaluateSla(
      TENANT,
      definition(),
      [outcome(), outcome({ tenant: OTHER_TENANT, orderId: "o-x" })],
      9_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("VENDOR fail-closed: another vendor's outcome refuses the evaluation", () => {
    const result = evaluateSla(
      TENANT,
      definition(),
      [outcome({ vendorId: "v-beta", orderId: "o-x" })],
      9_000,
    );
    expect(result).toEqual({ ok: false, reasonCode: "VENDOR_MISMATCH" });
  });

  it("definition structural problems propagate verbatim", () => {
    const result = evaluateSla(
      TENANT,
      definition({ responseBands: [] }),
      [outcome()],
      1,
    );
    expect(result).toEqual({ ok: false, reasonCode: "NO_RESPONSE_BANDS" });
  });

  it("slaEvaluationDigest is pure and deterministic over its inputs", () => {
    const breaches = [
      { orderId: "o-1", bandId: "minor", latenessMs: 5, penaltyBps: 50, promisedAt: 1, deliveredAt: 6 },
    ];
    const a = slaEvaluationDigest("s", "v", "t", 1, 2, 1, breaches, 50);
    const b = slaEvaluationDigest("s", "v", "t", 1, 2, 1, breaches, 50);
    expect(a).toBe(b);
    expect(a).toMatch(/^sla_[0-9a-f]{8}$/);
  });
});

describe("buildSlaScorecard — verbatim by reference, never recomputed", () => {
  it("copies every number verbatim and reuses the breach evidence BY REFERENCE", () => {
    const result = evaluateSla(
      TENANT,
      definition({ creditCapBps: 90 }),
      [
        outcome(),
        outcome({ orderId: "o-2", deliveredAt: 1_000_000 + 1 }),
        outcome({ orderId: "o-3", deliveredAt: 1_000_000 + 2 }),
    ],
      9_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const e = result.evaluation;
    const card = buildSlaScorecard(TENANT, e);
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    const s = card.scorecard;
    expect(s.slaId).toBe(e.slaId);
    expect(s.vendorId).toBe(e.vendorId);
    expect(s.evaluationDigest).toBe(e.digest);
    expect(s.evaluatedAt).toBe(e.evaluatedAt);
    expect(s.availabilityBps).toBe(e.availabilityBps);
    expect(s.availabilityMet).toBe(e.availabilityMet);
    expect(s.breachCount).toBe(e.breaches.length);
    expect(s.totalPenaltyBps).toBe(e.totalPenaltyBps);
    expect(s.capApplied).toBe(e.capApplied);
    // THE never-recomputed proof: same array reference, not a copy.
    expect(s.breachEvidence).toBe(e.breaches);
    expect(s.status).toBe("penalty");
  });

  it("status is compliant when no breaches and availability met", () => {
    const result = evaluateSla(TENANT, definition(), [outcome()], 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const card = buildSlaScorecard(TENANT, result.evaluation);
    expect(card.ok && card.scorecard.status).toBe("compliant");
  });

  it("status is availability-breach when no response breaches but the fill-rate target is missed", () => {
    // On time, no breach — but short-shipped: 5/10 -> 5000 bps < 9000 target.
    const result = evaluateSla(
      TENANT,
      definition({ availabilityTargetBps: 9000 }),
      [outcome({ orderId: "o-1", quantityOrdered: 10, quantityReceived: 5 })],
      1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evaluation.breaches).toEqual([]);
    expect(result.evaluation.availabilityMet).toBe(false);
    const card = buildSlaScorecard(TENANT, result.evaluation);
    expect(card.ok && card.scorecard.status).toBe("availability-breach");
  });

  it("TENANT fail-closed: another tenant cannot read a scorecard", () => {
    const result = evaluateSla(TENANT, definition(), [outcome()], 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildSlaScorecard(OTHER_TENANT, result.evaluation)).toEqual({
      ok: false,
      reasonCode: "TENANT_MISMATCH",
    });
  });
});
