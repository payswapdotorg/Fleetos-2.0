/**
 * @fleetos/acceptance-commerce — the marketplace offer step drivers
 * (F361C, Wave 17 lane C).
 *
 * Interprets the moff-* typed journey steps against the REAL public
 * entry points of `@fleetos/procurement`:
 *   - captureMarketplaceOffer — the full §3.2 schema validation (the
 *     malformed seeds refuse honestly with the exact reason codes);
 *   - buildCurrentOfferSheet — THE FRESHNESS LAW read model (only fresh
 *     offers appear current; every exclusion is reported with its
 *     verdict; foreign-tenant offers refuse the whole sheet fail-closed);
 *   - compareMarketplaceOffers — the hard-constraint vs
 *     preference-weight comparison composing the EXISTING compareQuotes
 *     + matchVendors kernels, with the per-offer explainable rationale
 *     (hard-constraint reports, ranks, integer-bps score decomposition,
 *     recorded tie-break rules, supplier match scores).
 *
 * The captured-offer population lives in a WeakMap keyed by
 * JourneyState — a fresh world per run keeps every run pure and
 * deterministic. Refusals are honest facts carrying the domain reason
 * codes.
 */

import type { FactValue } from "./journey-contracts.js";
import type { MarketplaceOfferStep } from "./journey-contracts-f361c.js";
import type { JourneyState } from "./journey-world.js";
import { OTHER_TENANT, logPush } from "./journey-world.js";
import type { MarketplaceOffer } from "@fleetos/procurement";
import {
  captureMarketplaceOffer,
  buildCurrentOfferSheet,
  compareMarketplaceOffers,
} from "@fleetos/procurement";

export type DriverFacts = Record<string, FactValue>;

interface OfferSeam {
  offers: MarketplaceOffer[];
}

const seams = new WeakMap<JourneyState, OfferSeam>();

function seamFor(state: JourneyState): OfferSeam {
  let seam = seams.get(state);
  if (seam === undefined) {
    seam = { offers: [] };
    seams.set(state, seam);
  }
  return seam;
}

export async function runMarketplaceOfferStep(
  step: MarketplaceOfferStep,
  state: JourneyState,
): Promise<DriverFacts> {
  const seam = seamFor(state);
  switch (step.kind) {
    case "moff-capture": {
      const seed = step.offer;
      const tenant = (seed.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT;
      const result = captureMarketplaceOffer(tenant, {
        offerId: seed.offerId,
        supplierId: seed.supplierId,
        sku: seed.sku,
        quantity: seed.quantity,
        unitCostMinor: seed.unitCostMinor,
        totalCostMinor: seed.totalCostMinor,
        currency: seed.currency,
        taxMinor: seed.taxMinor,
        feesMinor: seed.feesMinor,
        deliveryEstimateDays: seed.deliveryEstimateDays,
        condition: seed.condition,
        warrantyMonths: seed.warrantyMonths,
        validFrom: seed.validFrom,
        validUntil: seed.validUntil,
        source: { kind: seed.sourceKind, reference: seed.sourceReference },
        capturedAt: seed.capturedAt,
      });
      if (!result.ok) {
        logPush(state, "moff.log", `capture:${seed.offerId}:refused:${result.reasonCode}`);
        return {
          [`moff.capture.${step.factKey}.ok`]: false,
          [`moff.capture.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      seam.offers.push(result.offer);
      logPush(state, "moff.log", `capture:${seed.offerId}:ok:${seed.supplierId}`);
      return {
        [`moff.capture.${step.factKey}.ok`]: true,
        [`moff.capture.${step.factKey}.reasonCode`]: null,
        [`moff.capture.${step.factKey}.offerId`]: result.offer.offerId,
        [`moff.capture.${step.factKey}.sourceKind`]: result.offer.source.kind,
        [`moff.capture.${step.factKey}.capturedAt`]: result.offer.capturedAt,
        [`moff.capture.${step.factKey}.totalCostMinor`]: result.offer.totalCostMinor,
      };
    }
    case "moff-sheet": {
      const result = buildCurrentOfferSheet(state.tenant, seam.offers, step.at);
      if (!result.ok) {
        logPush(state, "moff.log", `sheet:${step.factKey}:refused:${result.reasonCode}`);
        return {
          [`moff.sheet.${step.factKey}.ok`]: false,
          [`moff.sheet.${step.factKey}.reasonCode`]: result.reasonCode,
        };
      }
      logPush(
        state,
        "moff.log",
        `sheet:${step.factKey}:fresh:${result.freshOffers.map((o) => o.offerId).join(",") || "-"}:excluded:${result.excluded.map((e) => `${e.offerId}:${e.verdict}`).join(",") || "-"}`,
      );
      return {
        [`moff.sheet.${step.factKey}.ok`]: true,
        [`moff.sheet.${step.factKey}.reasonCode`]: null,
        [`moff.sheet.${step.factKey}.freshOfferIds`]: result.freshOffers.map((o) => o.offerId),
        [`moff.sheet.${step.factKey}.freshCount`]: result.freshCount,
        [`moff.sheet.${step.factKey}.expiredCount`]: result.expiredCount,
        [`moff.sheet.${step.factKey}.notYetValidCount`]: result.notYetValidCount,
        [`moff.sheet.${step.factKey}.excluded`]: result.excluded.map((e) => `${e.offerId}:${e.verdict}`),
      };
    }
    case "moff-compare": {
      const verifications = step.verifications.map((v) => ({
        supplierId: v.supplierId,
        tenant: (v.tenant ?? "own") === "own" ? state.tenant : OTHER_TENANT,
        status: v.status,
        expiresAt: v.expiresAt,
      }));
      const result = compareMarketplaceOffers(
        {
          tenant: state.tenant,
          sku: step.demandSku,
          currency: step.demandCurrency,
          acceptableConditions: [...step.acceptableConditions],
        },
        seam.offers,
        verifications,
        { at: step.at, weights: step.weights },
      );
      if (!result.ok) {
        logPush(state, "moff.log", `compare:${step.factKey}:refused:${result.reasonCode}`);
        return {
          [`moff.compare.${step.factKey}.ok`]: false,
          [`moff.compare.${step.factKey}.reasonCode`]: result.reasonCode,
          [`moff.compare.${step.factKey}.rationaleCount`]: result.rationales?.length ?? 0,
        };
      }
      logPush(
        state,
        "moff.log",
        `compare:${step.factKey}:ranked:${result.ranked.map((r) => `${r.rank}:${r.quoteId}:${r.totalScoreBps}`).join("|")}`,
      );
      const failures = result.rationales
        .flatMap((r) =>
          r.hardConstraints
            .filter((c) => !c.pass && c.reasonCode !== null)
            .map((c) => `${r.offerId}:${c.constraint}:${c.reasonCode}`),
        )
        .sort();
      return {
        [`moff.compare.${step.factKey}.ok`]: true,
        [`moff.compare.${step.factKey}.reasonCode`]: null,
        [`moff.compare.${step.factKey}.rankedOrder`]: result.ranked.map((r) => r.quoteId),
        [`moff.compare.${step.factKey}.ranks`]: result.ranked.map((r) => `${r.quoteId}:${r.rank}`),
        [`moff.compare.${step.factKey}.totals`]: result.ranked.map((r) => `${r.quoteId}:${r.totalScoreBps}`),
        [`moff.compare.${step.factKey}.priceScores`]: result.ranked.map((r) => `${r.quoteId}:${r.priceScoreBps}`),
        [`moff.compare.${step.factKey}.termsScores`]: result.ranked.map((r) => `${r.quoteId}:${r.termsScoreBps}`),
        [`moff.compare.${step.factKey}.capabilityScores`]: result.ranked.map((r) => `${r.quoteId}:${r.capabilityScoreBps}`),
        [`moff.compare.${step.factKey}.tieBreakRules`]: result.ranked.map((r) => `${r.quoteId}:${r.tieBreakRule ?? "none"}`),
        [`moff.compare.${step.factKey}.eligibleCount`]: result.eligibleCount,
        [`moff.compare.${step.factKey}.ineligibleCount`]: result.ineligibleCount,
        [`moff.compare.${step.factKey}.rationaleOrder`]: result.rationales.map((r) => `${r.offerId}:${r.eligible ? "eligible" : "ineligible"}`),
        [`moff.compare.${step.factKey}.hardFailures`]: failures,
        [`moff.compare.${step.factKey}.supplierMatches`]: result.supplierMatches.map((m) => `${m.vendorId}:${m.score.toFixed(6)}:${m.tieBreakRule ?? "none"}`),
        [`moff.compare.${step.factKey}.matchedTags`]: result.supplierMatches.map((m) => `${m.vendorId}:${m.matchedTags.join("+")}`),
      };
    }
  }
}
