/**
 * @fleetos/acceptance-convergence — acceptance-family journey applicability.
 *
 * The industry's REAL journey applicability over the three acceptance
 * corpora, derived from the F271 adoption package's industry definitions
 * (the TL-owned taxonomy) and its applicability MASKS: which REAL journeys
 * apply, which are masked (each with the recorded rationale), and the REAL
 * corpus lengths imported from the packages (never hardcoded — the F281
 * convention).
 *
 * HONESTY LAW: an F290C industry with NO counterpart in the adoption
 * taxonomy (field-services) is reported UNMAPPED — the corpora totals are
 * cited, but NO applicable/masked split is claimed for it (an unmapped
 * industry is never silently treated as fully covered or fully masked).
 *
 * Pure deterministic TS. No clock, no randomness, no network.
 */

import { applicableCommerceJourneys, applicableFieldJourneys, applicableSecurityJourneys, industryById, maskedJourneyRationales } from "@fleetos/acceptance-adoption/industries";
import type { IndustryDefinition } from "@fleetos/acceptance-adoption/industries";
import { FIELD_JOURNEYS } from "@fleetos/acceptance-field/journeys";
import { SECURITY_JOURNEYS } from "@fleetos/acceptance-security/journeys";
import { JOURNEYS as COMMERCE_JOURNEYS } from "@fleetos/acceptance-commerce/journeys";
import type { Industry } from "@fleetos/agent-organizations";
import { fnv1a } from "./digest.js";

export type CorpusName = "field" | "security" | "commerce";

/**
 * Per-corpus applicability: `mapped` carries the applicable/masked split
 * (applicable + masked === total, the integrity law); `unmapped` honestly
 * reports that no adoption industry exists to mask against (totals only).
 */
export type CorpusApplicability =
  | { readonly status: "mapped"; readonly total: number; readonly applicable: number; readonly masked: number }
  | { readonly status: "unmapped"; readonly total: number };

export interface IndustryJourneyApplicability {
  /** The adoption taxonomy id this F290C industry maps to (null = unmapped). */
  readonly adoptionIndustryId: string | null;
  readonly field: CorpusApplicability;
  readonly security: CorpusApplicability;
  readonly commerce: CorpusApplicability;
  /** Count of masked journeys across the corpora (0 when unmapped). */
  readonly maskedCount: number;
  /** FNV-1a over the REAL masked-journey rationales (evidence, not recompute). */
  readonly maskedRationalesDigest: string;
}

/**
 * The F290C industry → adoption industry mapping. `field-services` has NO
 * adoption counterpart (the adoption taxonomy is firm-facing; field
 * services is an operator posture) — recorded honestly as unmapped.
 */
const ADOPTION_ID_BY_INDUSTRY: Readonly<Record<Industry, string | null>> = {
  manufacturing: "manufacturing",
  logistics: "transportation-logistics",
  "energy-utilities": "energy-utilities",
  facilities: "facilities-management",
  "field-services": null,
  construction: "construction",
};

/** The adoption industry id for an F290C industry (null = no counterpart). */
export function adoptionIndustryIdFor(industry: Industry): string | null {
  return ADOPTION_ID_BY_INDUSTRY[industry];
}

/** Build the REAL journey applicability for an F290C industry. */
export function buildJourneyApplicability(industry: Industry): IndustryJourneyApplicability {
  const adoptionId = adoptionIndustryIdFor(industry);
  const adoption: IndustryDefinition | undefined = adoptionId === null ? undefined : industryById(adoptionId);
  if (adoption === undefined) {
    // Honest unmapped: totals from the REAL corpora; no split is claimed.
    return {
      adoptionIndustryId: null,
      field: { status: "unmapped", total: FIELD_JOURNEYS.length },
      security: { status: "unmapped", total: SECURITY_JOURNEYS.length },
      commerce: { status: "unmapped", total: COMMERCE_JOURNEYS.length },
      maskedCount: 0,
      maskedRationalesDigest: fnv1a("unmapped"),
    };
  }
  const field = applicableFieldJourneys(adoption).length;
  const security = applicableSecurityJourneys(adoption).length;
  const commerce = applicableCommerceJourneys(adoption).length;
  const rationales = maskedJourneyRationales(adoption);
  return {
    adoptionIndustryId: adoption.id,
    field: { status: "mapped", total: FIELD_JOURNEYS.length, applicable: field, masked: FIELD_JOURNEYS.length - field },
    security: { status: "mapped", total: SECURITY_JOURNEYS.length, applicable: security, masked: SECURITY_JOURNEYS.length - security },
    commerce: { status: "mapped", total: COMMERCE_JOURNEYS.length, applicable: commerce, masked: COMMERCE_JOURNEYS.length - commerce },
    maskedCount: rationales.length,
    maskedRationalesDigest: fnv1a(
      rationales.map((r) => `${r.corpus}/${r.journeyId}=${r.rationale}`).join(";"),
    ),
  };
}
