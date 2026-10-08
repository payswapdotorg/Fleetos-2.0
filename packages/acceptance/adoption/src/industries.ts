/**
 * @fleetos/acceptance-adoption — industry definitions (DATA).
 *
 * TEN industries, each carrying a stable id, an asset-profile mix
 * (heavy-equipment / vehicle / fixed-asset / instrument weights as integer
 * bps-of-100), a posture emphasis, and APPLICABILITY MASKS over the three
 * REAL acceptance corpora's journey ids (F270A field 14 / F270B security 13
 * / F270C commerce 15).
 *
 * HONESTY LAW: a mask is an explicit EXCLUSION with a recorded rationale —
 * an industry never silently inherits a journey it cannot honestly run.
 * Masked journeys are excluded from that industry's coverage denominator
 * (never counted as covered, never counted as failed). Industries keep the
 * mobile-shape journey and the cross-role handoff family whenever they have
 * any field applicability — which all ten do.
 *
 * Pure deterministic TS (DATA only — no runner calls live here).
 */

import { FIELD_JOURNEYS } from "@fleetos/acceptance-field/journeys";
import { SECURITY_JOURNEYS } from "@fleetos/acceptance-security/journeys";
import { JOURNEYS as COMMERCE_JOURNEYS } from "@fleetos/acceptance-commerce/journeys";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Integer weights (sum 100) describing the industry's asset mix. */
export interface AssetProfileWeights {
  readonly heavyEquipment: number;
  readonly vehicle: number;
  readonly fixedAsset: number;
  readonly instrument: number;
}

/** Where the industry's operational pressure concentrates. */
export type PostureEmphasis =
  | "connectivity-edge"
  | "security-intelligence"
  | "work-commerce";

/** Masked (excluded) journeys per corpus: journey id -> honest rationale. */
export interface IndustryApplicabilityMask {
  readonly field: Readonly<Record<string, string>>;
  readonly commerce: Readonly<Record<string, string>>;
  readonly security: Readonly<Record<string, string>>;
}

export interface IndustryDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly assetProfile: AssetProfileWeights;
  readonly postureEmphasis: PostureEmphasis;
  /** Key into the incumbent baselines (`src/incumbent.ts`). */
  readonly incumbentProfileId: string;
  readonly masked: IndustryApplicabilityMask;
}

// ---------------------------------------------------------------------------
// The ten industries (the packet's ordered list)
// ---------------------------------------------------------------------------

export const INDUSTRIES: readonly IndustryDefinition[] = [
  {
    id: "manufacturing",
    displayName: "Manufacturing",
    assetProfile: { heavyEquipment: 50, vehicle: 10, fixedAsset: 25, instrument: 15 },
    postureEmphasis: "connectivity-edge",
    incumbentProfileId: "manufacturing",
    masked: { field: {}, commerce: {}, security: {} },
  },
  {
    id: "construction",
    displayName: "Construction",
    assetProfile: { heavyEquipment: 45, vehicle: 30, fixedAsset: 15, instrument: 10 },
    postureEmphasis: "work-commerce",
    incumbentProfileId: "construction",
    masked: {
      field: {
        "mission-replay-resume":
          "Construction work is project-scoped and stage-gated, not a recurring multi-stage mission campaign; the incumbent PMO tooling owns program scheduling.",
      },
      commerce: {},
      security: {
        "security.counterfactual-reasoning":
          "Site analytics maturity targets incident investigation and corrective action; counterfactual replay of safety decisions is not a construction practice (the incumbent safety suite owns incident analytics).",
        "security.benchmark-trust":
          "No third-party decision-benchmark feed is trusted on site; the incumbent safety suite is the sole reference.",
      },
    },
  },
  {
    id: "energy-utilities",
    displayName: "Energy & Utilities",
    assetProfile: { heavyEquipment: 25, vehicle: 15, fixedAsset: 35, instrument: 25 },
    postureEmphasis: "connectivity-edge",
    incumbentProfileId: "energy-utilities",
    masked: { field: {}, commerce: {}, security: {} },
  },
  {
    id: "transportation-logistics",
    displayName: "Transportation & Logistics",
    assetProfile: { heavyEquipment: 10, vehicle: 70, fixedAsset: 10, instrument: 10 },
    postureEmphasis: "work-commerce",
    incumbentProfileId: "transportation-logistics",
    masked: {
      field: {
        "simulation-driven-experiment":
          "Network simulation and route modeling live in the incumbent TMS planning suite; FleetOS is not the dispatch-planning system.",
        "mission-replay-resume":
          "Transport operations are real-time dispatch, not durable multi-stage missions; the incumbent TMS owns the route lifecycle.",
      },
      commerce: {
        "stage-gated-project":
          "Capital projects (terminal/dock builds) run in the incumbent PMO; logistics operations are continuous, not stage-gated.",
        "org-optimization-review":
          "Org-level model-usage analytics live in the incumbent BI stack.",
      },
      security: {
        "security.counterfactual-reasoning":
          "Counterfactual what-if on equipment/safety decisions is not a fleet-operations practice; the incumbent TMS analytics own network what-if.",
        "security.benchmark-trust":
          "Decision benchmarking feeds are not consumed by dispatch operations.",
      },
    },
  },
  {
    id: "agriculture",
    displayName: "Agriculture",
    assetProfile: { heavyEquipment: 45, vehicle: 35, fixedAsset: 10, instrument: 10 },
    postureEmphasis: "connectivity-edge",
    incumbentProfileId: "agriculture",
    masked: {
      field: {
        "simulation-driven-experiment":
          "Crop/field modeling lives in the incumbent agronomy platform; FleetOS is not the agronomy simulation system.",
        "mission-replay-resume":
          "Operations are seasonal and episodic (sowing/harvest windows), not durable multi-stage missions.",
      },
      commerce: {
        "stage-gated-project":
          "Farm infrastructure projects are small and contractor-run; the incumbent farm-management suite tracks them.",
        "software-entitlements":
          "Seat-heavy software entitlement management is not a farm-systems need; the incumbent handles occasional licenses.",
        "aurum-settlement-seam":
          "Co-op and grain settlement runs through incumbent accounting integrations.",
        "external-catalog-sync":
          "Input/dealer catalogs are handled by the incumbent input-supply network.",
        "apify-actor-job":
          "No external data-actor automation is operated in-house.",
        "org-optimization-review":
          "Small organizations run no model-usage optimization practice.",
      },
      security: {
        "security.counterfactual-reasoning":
          "Agronomy what-if analysis is the incumbent platform's domain; FleetOS records what happened on the machinery, never crop counterfactuals.",
        "security.benchmark-trust":
          "No trusted third-party decision-benchmark feed exists for field decisions.",
        "security.agent-safety":
          "No in-house autonomous agents; machinery autonomy is OEM-embedded and the incumbent machinery vendor owns it.",
      },
    },
  },
  {
    id: "healthcare-facilities",
    displayName: "Healthcare Facilities",
    assetProfile: { heavyEquipment: 5, vehicle: 5, fixedAsset: 35, instrument: 55 },
    postureEmphasis: "security-intelligence",
    incumbentProfileId: "healthcare-facilities",
    masked: {
      field: {
        "field-mode-offline-tolerance":
          "Hospital campuses provide managed indoor connectivity for biomed rounds; the incumbent CMAM is certified for connected-only operation, so offline tolerance is not a driver.",
        "edge-command-lifecycle":
          "Remote command of networked medical devices is regulatorily excluded — patient-safety controls own command paths; FleetOS observes and triages only.",
        "simulation-driven-experiment":
          "Equipment simulation lives in the incumbent clinical-engineering modeling tools.",
        "mission-replay-resume":
          "Regulatory maintenance is calendar/usage-based, not durable mission campaigns.",
      },
      commerce: {
        "aurum-settlement-seam":
          "Claims and procurement settlement run through the incumbent EDI clearinghouse.",
        "apify-actor-job":
          "External data automation is not operated in-house; the integration office owns EDI.",
        "org-optimization-review":
          "Org analytics live in the incumbent hospital BI stack.",
      },
      security: {
        "security.counterfactual-reasoning":
          "Clinical what-if lives in the incumbent EHR analytics; FleetOS records facility-equipment decisions.",
        "security.benchmark-trust":
          "Benchmark feeds are not trusted for regulated facility decisions.",
        "security.agent-safety":
          "No autonomous agents operate in regulated clinical environments.",
      },
    },
  },
  {
    id: "facilities-management",
    displayName: "Facilities Management",
    assetProfile: { heavyEquipment: 10, vehicle: 15, fixedAsset: 45, instrument: 30 },
    postureEmphasis: "work-commerce",
    incumbentProfileId: "facilities-management",
    masked: {
      field: {
        "edge-command-lifecycle":
          "Building-equipment command paths belong to the incumbent BAS; FleetOS advises and records, it never commands building plant.",
        "simulation-driven-experiment":
          "Building-energy modeling lives in the incumbent BMS analytics.",
        "mission-replay-resume":
          "FM work is ticket/SLA-driven, not durable mission campaigns.",
      },
      commerce: {
        "apify-actor-job":
          "Supplier data automation is not operated in-house; the incumbent procurement network handles it.",
        "org-optimization-review":
          "Org analytics live in the incumbent IFM BI stack.",
        "aurum-settlement-seam":
          "Client billing and settlement run in the incumbent accounting stack.",
      },
      security: {
        "security.counterfactual-reasoning":
          "Counterfactual replay of FM decisions is not an industry practice.",
        "security.benchmark-trust":
          "No trusted decision-benchmark feed for FM operations.",
        "security.agent-safety":
          "No autonomous agents operate building plant.",
      },
    },
  },
  {
    id: "telecommunications",
    displayName: "Telecommunications",
    assetProfile: { heavyEquipment: 10, vehicle: 20, fixedAsset: 45, instrument: 25 },
    postureEmphasis: "connectivity-edge",
    incumbentProfileId: "telecommunications",
    masked: {
      field: {
        "simulation-driven-experiment":
          "Network planning simulation lives in the incumbent OSS planning suite.",
      },
      commerce: {
        "apify-actor-job":
          "External data actor jobs are not operated in-house; incumbent OSS adapters own integrations.",
        "aurum-settlement-seam":
          "Interconnect settlement runs in the incumbent BSS.",
        "org-optimization-review":
          "Org analytics live in the incumbent BSS stack.",
      },
      security: {},
    },
  },
  {
    id: "mining",
    displayName: "Mining",
    assetProfile: { heavyEquipment: 60, vehicle: 25, fixedAsset: 10, instrument: 5 },
    postureEmphasis: "security-intelligence",
    incumbentProfileId: "mining",
    masked: {
      field: {
        "simulation-driven-experiment":
          "Haul and mine simulation live in the incumbent mine-planning suite; FleetOS is not the mine-planning system.",
      },
      commerce: {
        "org-optimization-review":
          "Org analytics live in the incumbent mining BI stack.",
      },
      security: {},
    },
  },
  {
    id: "water-waste",
    displayName: "Water & Waste",
    assetProfile: { heavyEquipment: 35, vehicle: 10, fixedAsset: 30, instrument: 25 },
    postureEmphasis: "security-intelligence",
    incumbentProfileId: "water-waste",
    masked: {
      field: {
        "simulation-driven-experiment":
          "Hydraulic/network modeling lives in the incumbent modeling suite.",
      },
      commerce: {
        "apify-actor-job":
          "Telemetry data automation is not operated in-house; SCADA integrators own it.",
        "org-optimization-review":
          "Org analytics live in the incumbent utility BI stack.",
        "aurum-settlement-seam":
          "Customer billing and settlement run in the incumbent CIS.",
      },
      security: {},
    },
  },
];

// ---------------------------------------------------------------------------
// Journey applicability (pure filters over the REAL corpora)
// ---------------------------------------------------------------------------

function fieldJourneyIds(): readonly string[] {
  return FIELD_JOURNEYS.map((j) => j.id);
}

function commerceJourneyIds(): readonly string[] {
  return COMMERCE_JOURNEYS.map((j) => j.id);
}

function securityJourneyIds(): readonly string[] {
  return SECURITY_JOURNEYS.map((j) => j.journeyId);
}

/** Industry-applicable field journeys (REAL corpus objects, declared order). */
export function applicableFieldJourneys(industry: IndustryDefinition) {
  return FIELD_JOURNEYS.filter((j) => !(j.id in industry.masked.field));
}

/** Industry-applicable commerce journeys (REAL corpus objects, declared order). */
export function applicableCommerceJourneys(industry: IndustryDefinition) {
  return COMMERCE_JOURNEYS.filter((j) => !(j.id in industry.masked.commerce));
}

/** Industry-applicable security journeys (REAL corpus objects, declared order). */
export function applicableSecurityJourneys(industry: IndustryDefinition) {
  return SECURITY_JOURNEYS.filter((j) => !(j.journeyId in industry.masked.security));
}

/** Every masked journey id (all corpora) with its recorded rationale. */
export function maskedJourneyRationales(
  industry: IndustryDefinition,
): ReadonlyArray<{ readonly corpus: "field" | "commerce" | "security"; readonly journeyId: string; readonly rationale: string }> {
  const out: { corpus: "field" | "commerce" | "security"; journeyId: string; rationale: string }[] = [];
  for (const [journeyId, rationale] of Object.entries(industry.masked.field)) {
    out.push({ corpus: "field", journeyId, rationale });
  }
  for (const [journeyId, rationale] of Object.entries(industry.masked.commerce)) {
    out.push({ corpus: "commerce", journeyId, rationale });
  }
  for (const [journeyId, rationale] of Object.entries(industry.masked.security)) {
    out.push({ corpus: "security", journeyId, rationale });
  }
  return out;
}

/** The three corpora's full journey-id vocabularies (for validation/tests). */
export const CORPUS_JOURNEY_IDS: {
  readonly field: readonly string[];
  readonly commerce: readonly string[];
  readonly security: readonly string[];
} = {
  field: fieldJourneyIds(),
  commerce: commerceJourneyIds(),
  security: securityJourneyIds(),
};

/** Lookup by stable id. */
export function industryById(id: string): IndustryDefinition | undefined {
  return INDUSTRIES.find((i) => i.id === id);
}
