/**
 * Finding-storm tests (F280B, Wave 8 lane B).
 *
 * Behavior under test: deterministic duplicate-storm dedupe (permutation
 * invariance), insert-order-stable correlation groups, stepwise escalation
 * inside the storm, bounded triage with honest overflow refusals, and A8
 * cross-tenant fail-closed probes with reason codes asserted.
 */
import { describe, it, expect } from "vitest";
import {
  dedupeFindingStorm,
  correlateFindingStorm,
  buildStormTriageQueue,
  runStormIntake,
} from "../src/index.ts";
import type { FindingIntakeCandidate } from "../src/index.ts";

const TENANT = "tnt_storm";

function candidate(overrides: Partial<FindingIntakeCandidate> = {}): FindingIntakeCandidate {
  return {
    tenantId: TENANT,
    kind: "auth.weak_credential",
    declaredSeverity: "medium",
    confidence: "confirmed",
    detectedAt: 10_000,
    assetIds: ["a1", "a2"],
    description: "weak credential on a1/a2",
    evidenceRefs: [],
    signalCount: 2,
    ...overrides,
  };
}

/** Fixed permutations (no randomness — deterministic fixtures). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((head, i) => {
    const rest = items.filter((_, j) => j !== i);
    for (const tail of permutations(rest)) out.push([head, ...tail]);
  });
  return out;
}

describe("storm dedupe — deterministic under storms", () => {
  it("a duplicate storm collapses to one survivor per fingerprint class", () => {
    const storm = [
      candidate({ detectedAt: 10_000 }),
      candidate({ detectedAt: 10_000 }), // exact duplicate
      candidate({ detectedAt: 10_000, confidence: "probable" }), // same fingerprint (confidence not in fingerprint)
      candidate({ detectedAt: 20_000, description: "second detection" }),
      candidate({ detectedAt: 20_000, description: "second detection" }), // duplicate of the above
    ];
    const r = dedupeFindingStorm(storm);
    expect(r.survivors).toHaveLength(2);
    expect(r.metrics).toMatchObject({
      received: 5, validated: 5, duplicates: 3, invalid: 0, survived: 2, distinctClasses: 2,
    });
    expect(r.acks.filter((a) => !a.ok).every((a) => a.reason === "dedupe.duplicate-finding")).toBe(true);
  });

  it("PERMUTATION INVARIANCE: the survivor set is identical under every arrival order", () => {
    const storm = [
      candidate({ detectedAt: 10_000, description: "d1" }),
      candidate({ detectedAt: 10_000, description: "d1" }),
      candidate({ detectedAt: 11_000, description: "d2" }),
      candidate({ detectedAt: 11_000, description: "d2" }),
      candidate({ detectedAt: 11_000, description: "d2" }),
      candidate({ detectedAt: 12_000, description: "d3", assetIds: ["a9"] }),
    ];
    const baseline = JSON.stringify(dedupeFindingStorm(storm).survivors);
    for (const order of permutations(storm)) {
      expect(JSON.stringify(dedupeFindingStorm(order).survivors)).toBe(baseline);
    }
  });

  it("invalid candidates are refused with their REAL validation codes", () => {
    const r = dedupeFindingStorm([
      candidate({ tenantId: "" }),
      candidate({ kind: "not.a.kind" }),
      candidate({ declaredSeverity: "extreme" }),
      candidate({ signalCount: 0 }), // valid at dedupe; signalCount only matters at triage
    ]);
    expect(r.metrics.invalid).toBe(3);
    expect(r.acks[0]!.reason).toBe("validate.missing-tenant");
    expect(r.acks[1]!.reason).toBe("validate.unknown-kind");
    expect(r.acks[2]!.reason).toBe("validate.invalid-severity");
    expect(r.acks[3]!.ok).toBe(true);
  });

  it("duplicate acks name the surviving finding id", () => {
    const r = dedupeFindingStorm([candidate(), candidate()]);
    expect(r.acks[1]!.duplicateOf).toBe(r.survivors[0]!.findingId);
  });
});

describe("storm correlation — stable under insert order", () => {
  it("groups by correlation key, ordered canonically", () => {
    const survivors = dedupeFindingStorm([
      candidate({ detectedAt: 30_000 }),
      candidate({ detectedAt: 10_000 }),
      candidate({ detectedAt: 40_000, kind: "device.firmware_outdated", assetIds: ["a1"], description: "fw" }),
    ]).survivors;
    const groups = correlateFindingStorm(survivors);
    const keys = groups.map((g) => g.correlationKey);
    expect(keys).toEqual([...keys].sort());
    expect(groups).toHaveLength(2);
    const first = groups.find((g) => g.kind === "auth.weak_credential") ?? groups[0]!;
    expect(first.occurrences).toBe(2); // 10_000 + 30_000 share the correlation key
  });

  it("INSERT-ORDER STABILITY: identical groups under every permutation", () => {
    const survivors = dedupeFindingStorm([
      candidate({ detectedAt: 10_000 }),
      candidate({ detectedAt: 11_000, description: "repeat 1" }),
      candidate({ detectedAt: 12_000, description: "repeat 2" }),
      candidate({ detectedAt: 12_000, kind: "device.unmanaged", assetIds: ["c3"], description: "other" }),
    ]).survivors;
    const baseline = JSON.stringify(correlateFindingStorm(survivors));
    for (const order of permutations(survivors)) {
      expect(JSON.stringify(correlateFindingStorm(order))).toBe(baseline);
    }
  });

  it("repeat pressure inside the storm escalates via the REAL stepwise rules", () => {
    const survivors = dedupeFindingStorm([
      candidate({ detectedAt: 10_000, declaredSeverity: "medium" }),
      candidate({ detectedAt: 10_500, description: "r1" }),
      candidate({ detectedAt: 11_000, description: "r2" }),
    ]).survivors;
    const groups = correlateFindingStorm(survivors, { correlationWindowMs: 60_000 });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.occurrences).toBe(3);
    expect(groups[0]!.escalatedTo).toBe("high"); // medium x3 -> high (REAL rule)
    expect(groups[0]!.peakSeverity).toBe("high");
  });

  it("window discipline: repeats outside the window do not escalate", () => {
    const survivors = dedupeFindingStorm([
      candidate({ detectedAt: 10_000 }),
      candidate({ detectedAt: 500_000, description: "far later" }),
    ]).survivors;
    const groups = correlateFindingStorm(survivors, { correlationWindowMs: 60_000 });
    expect(groups[0]!.occurrences).toBe(1);
    expect(groups[0]!.escalatedTo).toBeNull();
  });
});

describe("storm triage — bounds with honest overflow", () => {
  const survivors = dedupeFindingStorm([
    candidate({ detectedAt: 10_000, declaredSeverity: "low" }),
    candidate({ detectedAt: 11_000, declaredSeverity: "high", description: "h1" }),
    candidate({ detectedAt: 12_000, declaredSeverity: "critical", description: "c1" }),
  ]).survivors;

  it("orders the queue by severity desc and REFUSES over-bound input with counts", () => {
    const ok = buildStormTriageQueue(survivors, { tenantId: TENANT, limit: 3 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.queue.map((f) => f.severity)).toEqual(["critical", "high", "low"]);
      expect(ok.depth).toBe(3);
    }
    const over = buildStormTriageQueue(survivors, { tenantId: TENANT, limit: 2 });
    expect(over).toMatchObject({ ok: false, refused: "triage.queue-overflow", received: 3, limit: 2 });
  });

  it("never silently truncates: the overflow refusal carries no partial queue", () => {
    const over = buildStormTriageQueue(survivors, { tenantId: TENANT, limit: 1 });
    expect(over.ok).toBe(false);
    expect("queue" in over).toBe(false);
    if (!over.ok && over.refused === "triage.queue-overflow") {
      expect(over.received).toBe(3);
      expect(over.limit).toBe(1);
    }
  });

  it("refuses an empty queue honestly", () => {
    expect(buildStormTriageQueue([], { tenantId: TENANT, limit: 5 })).toMatchObject({
      ok: false, refused: "triage.empty-queue",
    });
  });

  it("A8 fail-closed: a cross-tenant finding refuses the queue, naming the offender", () => {
    const mixed = dedupeFindingStorm([
      candidate(),
      candidate({ tenantId: "tnt_other", detectedAt: 15_000, description: "foreign" }),
    ]).survivors;
    const r = buildStormTriageQueue(mixed, { tenantId: TENANT, limit: 10 });
    expect(r).toMatchObject({
      ok: false,
      refused: "storm.tenant-mismatch",
      offenderTenantId: "tnt_other",
    });
    if (!r.ok && r.refused === "storm.tenant-mismatch") {
      expect(r.offenderFindingId).toContain("finding-");
    }
  });
});

describe("runStormIntake — the full hardened pipeline", () => {
  it("threads validate → dedupe → correlate → bounded triage", () => {
    const storm = [
      candidate({ detectedAt: 10_000 }),
      candidate({ detectedAt: 10_000 }),
      candidate({ detectedAt: 11_000, description: "r1" }),
      candidate({ detectedAt: 12_000, description: "r2" }),
      candidate({ tenantId: "", detectedAt: 13_000, description: "invalid" }),
    ];
    const r = runStormIntake(storm, { tenantId: TENANT, triageLimit: 10, correlationWindowMs: 60_000 });
    expect(r.dedupe.metrics.survived).toBe(3);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.escalatedTo).toBe("high"); // 3 mediums in-window
    expect(r.triage.ok).toBe(true);
    if (r.triage.ok) expect(r.triage.queue[0]!.severity).toBe("high");
  });

  it("the pipeline surfaces triage overflow honestly end-to-end", () => {
    const storm = [
      candidate({ detectedAt: 10_000 }),
      candidate({ detectedAt: 11_000, description: "a" }),
      candidate({ detectedAt: 12_000, description: "b" }),
    ];
    const r = runStormIntake(storm, { tenantId: TENANT, triageLimit: 2 });
    expect(r.triage).toMatchObject({ ok: false, refused: "triage.queue-overflow", received: 3, limit: 2 });
  });

  it("is deterministic: identical storms produce byte-identical results", () => {
    const storm = [candidate(), candidate({ detectedAt: 11_000, description: "x" })];
    const a = runStormIntake(storm, { tenantId: TENANT, triageLimit: 5 });
    const b = runStormIntake(storm, { tenantId: TENANT, triageLimit: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
