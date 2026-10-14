/**
 * @fleetos/acceptance-commerce — quote-comparison step drivers (F351C,
 * Wave 15 lane C).
 *
 * Interprets typed journey steps against the REAL public entry point of
 * `@fleetos/procurement` commerce-math.ts: `compareQuotes` — the domain
 * scoring kernel. Integer-bps score decomposition (cheapest unit cost
 * scores 10000, shortest lead time scores 10000, capability coverage in
 * bps of the required tags), the weighted total
 * floor((p*wP + t*wT + c*wC) / 10000), ranking with the tie-break rules
 * RECORDED on each entry that tied with its predecessor
 * (lower-total-cost → shorter-lead-time → earlier-submission →
 * vendor-id-lexical), and the honest refusals (NO_QUOTES,
 * WEIGHTS_MUST_SUM_TO_10000, INVALID_UNIT_COST, INVALID_LEAD_TIME,
 * TENANT_MISMATCH — a foreign-tenant quote refuses the whole comparison
 * fail-closed).
 *
 * The step data supplies literal quotes/weights; the driver passes them
 * through untouched. Pure and deterministic.
 */

import type { FactValue } from "./journey-contracts.js";
import type { QuoteComparisonStep } from "./journey-contracts-f351c.js";
import type { JourneyState } from "./journey-world.js";
import { OTHER_TENANT, logPush } from "./journey-world.js";
import { compareQuotes } from "@fleetos/procurement";

export type DriverFacts = Record<string, FactValue>;

export async function runQuoteComparisonStep(
  step: QuoteComparisonStep,
  state: JourneyState,
): Promise<DriverFacts> {
  switch (step.kind) {
    case "qcmp-compare": {
      const quotes = step.quotes.map((q) => ({
        quoteId: q.quoteId,
        vendorId: q.vendorId,
        tenant: (q.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT,
        unitCostMinor: q.unitCostMinor,
        totalCostMinor: q.totalCostMinor,
        leadTimeDays: q.leadTimeDays,
        capabilityTags: [...q.capabilityTags],
        submittedAtEpoch: q.submittedAtEpoch,
      }));
      const result = compareQuotes(
        { tenant: state.tenant, requiredCapabilityTags: [...step.demandTags] },
        quotes,
        step.weights,
      );
      if (!result.ok) {
        logPush(state, "qcmp.log", `${step.factKey}:refused:${result.reasonCode}`);
        return {
          [`qcmp.${step.factKey}.ok`]: false,
          [`qcmp.${step.factKey}.reasonCode`]: result.reasonCode,
          [`qcmp.${step.factKey}.rankedCount`]: 0,
        };
      }
      const ranked = result.ranked;
      logPush(state, "qcmp.log", `${step.factKey}:${ranked.map((r) => `${r.rank}:${r.quoteId}:${r.totalScoreBps}`).join("|")}`);
      return {
        [`qcmp.${step.factKey}.ok`]: true,
        [`qcmp.${step.factKey}.reasonCode`]: null,
        [`qcmp.${step.factKey}.rankedCount`]: ranked.length,
        [`qcmp.${step.factKey}.quoteOrder`]: ranked.map((r) => r.quoteId),
        [`qcmp.${step.factKey}.vendorOrder`]: ranked.map((r) => r.vendorId),
        [`qcmp.${step.factKey}.ranks`]: ranked.map((r) => `${r.quoteId}:${r.rank}`),
        [`qcmp.${step.factKey}.totals`]: ranked.map((r) => `${r.quoteId}:${r.totalScoreBps}`),
        [`qcmp.${step.factKey}.priceScores`]: ranked.map((r) => `${r.quoteId}:${r.priceScoreBps}`),
        [`qcmp.${step.factKey}.termsScores`]: ranked.map((r) => `${r.quoteId}:${r.termsScoreBps}`),
        [`qcmp.${step.factKey}.capabilityScores`]: ranked.map((r) => `${r.quoteId}:${r.capabilityScoreBps}`),
        [`qcmp.${step.factKey}.tieBreakRules`]: ranked.map((r) => `${r.quoteId}:${r.tieBreakRule ?? "none"}`),
      };
    }
  }
}
