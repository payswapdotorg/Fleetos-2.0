/**
 * F251 retry-law tests — the unified backoff-ladder law, the retry
 * classification vocabulary (aligned with the adcos classifier), the
 * per-adapter retry-budget ledger, and the machine consistency proof with
 * NEGATIVE fixtures (intentionally-law-violating policies must be detected).
 */

import { describe, expect, it } from "vitest";
import { classifyAdcosError, defaultRetryPolicy as adcosDefaultPolicy } from "@fleetos/adcos";
import { DEFAULT_RETRY_POLICY as aurumDefaultPolicy } from "@fleetos/aurum";
import { DEFAULT_RETRY_POLICY as apifyDefaultPolicy } from "@fleetos/apify";
import {
  accountRetryBudget,
  adcosRetryClass,
  ladderDelays,
  ladderFromAdcosPolicy,
  ladderFromConstantPolicy,
  laneRetryPolicyRecords,
  openRetryBudget,
  operationalRetryClass,
  proveRetryLawConsistency,
  spendRetryAttempt,
  type LaneRetryPolicyRecord,
} from "../src/retry-law.js";

describe("retry-law — the REAL lane policies pass the unified law", () => {
  it("laneRetryPolicyRecords carries the three transport-lane defaults with provenance", () => {
    const records = laneRetryPolicyRecords();
    expect(records.map((r) => r.adapter)).toEqual(["adcos", "aurum", "apify"]);
    expect(records.map((r) => r.source)).toEqual([
      "adcos:defaultRetryPolicy",
      "aurum:DEFAULT_RETRY_POLICY",
      "apify:DEFAULT_RETRY_POLICY",
    ]);
  });

  it("proveRetryLawConsistency: the REAL lane defaults satisfy the law (monotone, capped, positive)", () => {
    const proof = proveRetryLawConsistency(laneRetryPolicyRecords());
    expect(proof.ok).toBe(true);
    expect(proof.ok && proof.checked).toBe(3);
  });

  it("the adcos default ladder is [100, 200, 400] — bounded attempts, exponential, capped", () => {
    const ladder = ladderFromAdcosPolicy(adcosDefaultPolicy());
    expect(ladder.multiplierBps).toBe(20_000);
    expect(ladderDelays(ladder)).toEqual([100, 200, 400]);
  });

  it("the aurum/apify constant-delay ladders are flat (multiplierBps 10000) and identical across calls", () => {
    const aurum = ladderFromConstantPolicy(aurumDefaultPolicy);
    const apify = ladderFromConstantPolicy(apifyDefaultPolicy);
    expect(aurum.multiplierBps).toBe(10_000);
    expect(apify.multiplierBps).toBe(10_000);
    expect(ladderDelays(aurum)).toEqual([100, 100, 100]);
    expect(ladderDelays(apify)).toEqual(ladderDelays(aurum)); // zero jitter: deterministic
  });

  it("the cap bounds the ladder (never above maxDelayMs; monotonic non-decreasing)", () => {
    const delays = ladderDelays({ maxAttempts: 6, baseDelayMs: 1_000, maxDelayMs: 1_500, multiplierBps: 20_000 });
    expect(delays).toEqual([1_000, 1_500, 1_500, 1_500, 1_500, 1_500]);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]! >= delays[i - 1]!).toBe(true);
    }
  });
});

describe("retry-law — negative fixtures: law violations are DETECTED deterministically", () => {
  const lawful: LaneRetryPolicyRecord = {
    adapter: "adcos",
    source: "fixture:lawful",
    ladder: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5_000, multiplierBps: 20_000 },
  };

  it("a shrinking multiplier violates multiplier-below-unity AND delays-not-monotonic", () => {
    const proof = proveRetryLawConsistency([
      lawful,
      { adapter: "aurum", source: "fixture:shrinking", ladder: { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 8_000, multiplierBps: 5_000 } },
    ]);
    expect(proof.ok).toBe(false);
    if (proof.ok) return;
    expect(proof.violations.map((v) => [v.adapter, v.source, v.violation])).toEqual([
      ["aurum", "fixture:shrinking", "delays-not-monotonic"],
      ["aurum", "fixture:shrinking", "multiplier-below-unity"],
    ]);
  });

  it("zero attempts violates attempts-not-positive", () => {
    const proof = proveRetryLawConsistency([
      { adapter: "apify", source: "fixture:zero-attempts", ladder: { maxAttempts: 0, baseDelayMs: 100, maxDelayMs: 200, multiplierBps: 10_000 } },
    ]);
    expect(proof.ok).toBe(false);
    if (proof.ok) return;
    expect(proof.violations[0]!.violation).toBe("attempts-not-positive");
    expect(proof.violations[0]!.adapter).toBe("apify");
  });

  it("a cap below the base violates cap-below-base; a negative base violates base-delay-negative", () => {
    const proof = proveRetryLawConsistency([
      { adapter: "vendors", source: "fixture:cap", ladder: { maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 100, multiplierBps: 10_000 } },
      { adapter: "arena", source: "fixture:negative-base", ladder: { maxAttempts: 2, baseDelayMs: -1, maxDelayMs: 100, multiplierBps: 10_000 } },
    ]);
    expect(proof.ok).toBe(false);
    if (proof.ok) return;
    const kinds = proof.violations.map((v) => [v.adapter, v.violation]);
    expect(kinds).toContainEqual(["arena", "base-delay-negative"]);
    expect(kinds).toContainEqual(["vendors", "cap-below-base"]);
  });

  it("violations are deterministically ordered (adapter, source, violation) — byte-identical proofs", () => {
    const policies: readonly LaneRetryPolicyRecord[] = [
      { adapter: "apify", source: "fixture:b", ladder: { maxAttempts: 0, baseDelayMs: 1, maxDelayMs: 2, multiplierBps: 10_000 } },
      { adapter: "apify", source: "fixture:a", ladder: { maxAttempts: 0, baseDelayMs: 1, maxDelayMs: 2, multiplierBps: 10_000 } },
      { adapter: "adcos", source: "fixture:c", ladder: { maxAttempts: 0, baseDelayMs: 1, maxDelayMs: 2, multiplierBps: 10_000 } },
    ];
    const first = proveRetryLawConsistency(policies);
    const second = proveRetryLawConsistency([...policies].reverse() as typeof policies);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (first.ok || second.ok) return;
    expect(first.violations.map((v) => [v.adapter, v.source])).toEqual([
      ["adcos", "fixture:c"],
      ["apify", "fixture:a"],
      ["apify", "fixture:b"],
    ]);
  });
});

describe("retry-law — the transient/permanent vocabulary", () => {
  it("adcosRetryClass is the LANE's own classifier (authority alignment)", () => {
    expect(adcosRetryClass("provider-unavailable")).toBe("transient");
    expect(adcosRetryClass("rate-limited")).toBe("transient");
    expect(adcosRetryClass("unknown-error")).toBe("transient");
    expect(adcosRetryClass("device-not-found")).toBe("permanent");
    expect(adcosRetryClass("command-unsupported")).toBe("permanent");
    expect(adcosRetryClass("missing-tenant-id")).toBe("permanent");
    expect(adcosRetryClass("missing-device-id")).toBe("permanent");
    for (const code of ["provider-unavailable", "device-not-found"] as const) {
      expect(adcosRetryClass(code)).toBe(classifyAdcosError(code).class);
    }
  });

  it("operationalRetryClass: known transport codes classify; unknown codes return null (unclassified, never guessed)", () => {
    expect(operationalRetryClass("aurum", "AURUM_UNAVAILABLE")).toBe("transient");
    expect(operationalRetryClass("aurum", "AURUM_DEGRADED")).toBe("transient");
    expect(operationalRetryClass("aurum", "AURUM_REFUSED")).toBe("permanent");
    expect(operationalRetryClass("apify", "APIFY_UNAVAILABLE")).toBe("transient");
    expect(operationalRetryClass("apify", "PROPOSAL_UNAUTHORIZED")).toBe("permanent");
    expect(operationalRetryClass("vendors", "TENANT_MISMATCH")).toBe("permanent");
    expect(operationalRetryClass("aurum", "NOT_A_REAL_CODE")).toBe(null);
    expect(operationalRetryClass("vendors", "AURUM_UNAVAILABLE")).toBe(null); // a code from another lane's table
  });
});

describe("retry-law — the per-adapter retry-budget ledger (ceilings, never authorizations)", () => {
  it("open → spend → account: integer-bps utilization, machine-carried ceiling marker", () => {
    const opened = openRetryBudget("adcos", "2025-W01", 4);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.accounting.note).toBe("ceiling-not-authorization");
    expect(opened.accounting.utilizationBps).toBe(0);
    const one = spendRetryAttempt(opened.ledger, 1_000);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.ledger.attemptsSpent).toBe(1);
    expect(one.ledger.spends).toEqual([{ attempt: 1, at: 1_000 }]);
    expect(one.accounting.utilizationBps).toBe(2_500);
    expect(one.accounting.remainingAttempts).toBe(3);
  });

  it("exhausting the budget refuses RETRY_BUDGET_EXCEEDED (fail-closed, no negative remainder)", () => {
    let ledger = openRetryBudget("apify", "2025-W01", 2);
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    for (let i = 0; i < 2; i++) {
      const spent = spendRetryAttempt(ledger.ledger, 1_000 + i);
      expect(spent.ok).toBe(true);
      if (spent.ok) ledger = spent;
    }
    const exhausted = spendRetryAttempt(ledger.ledger, 2_000);
    expect(exhausted.ok).toBe(false);
    if (exhausted.ok) return;
    expect(exhausted.reason).toBe("RETRY_BUDGET_EXCEEDED");
    expect(exhausted.detail).toContain("apify");
    expect(exhausted.detail).toContain("2025-W01");
    expect(ledger.accounting.utilizationBps).toBe(10_000);
  });

  it("invalid opens refuse: empty window, non-positive budget; invalid spend times refuse", () => {
    expect(openRetryBudget("adcos", "  ", 3).ok).toBe(false);
    expect(openRetryBudget("adcos", "w", 0).ok).toBe(false);
    const opened = openRetryBudget("vendors", "2025-W01", 3);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(spendRetryAttempt(opened.ledger, -1).ok).toBe(false);
    expect(accountRetryBudget(opened.ledger).note).toBe("ceiling-not-authorization");
  });
});
