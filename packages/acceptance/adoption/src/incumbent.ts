/**
 * @fleetos/acceptance-adoption — incumbent capability baselines (DATA).
 *
 * Per industry, the incumbent-vendor capability set: a realistic
 * NAMED-PROFILE list ("incumbent-erp-suite", "incumbent-cmam",
 * "incumbent-fsm", …) with per-capability coverage notes — what the
 * incumbent DOES and what it does NOT do. No vendor trademarks: profiles
 * are generic archetypes, never real products.
 *
 * The verdict rubric (`src/verdicts.ts`) maps each capability to a journey
 * family (ids of the REAL F270A/B/C corpora) and asks, deterministically:
 * can FleetOS replace it for this industry? A capability whose family is
 * EMPTY is an honest incumbent moat — FleetOS has no journey family that
 * claims it, and the verdict records that, never hides it.
 *
 * Pure records. No vendor trademarks. No runner calls.
 */

import { INDUSTRIES } from "./industries.js";

export type Criticality = "core" | "adjunct";

/** A catalog capability: the incumbent's honest shape + its FleetOS journey family. */
export interface IncumbentCapability {
  readonly id: string;
  /** What the incumbent profile does here. */
  readonly summary: string;
  /** What the incumbent does NOT do (the honest gap FleetOS targets). */
  readonly doesNot: string;
  readonly criticality: Criticality;
  /** Journey ids (any corpus) whose PASSING would replace this capability. Empty = incumbent moat. */
  readonly replacementJourneyFamily: readonly string[];
}

interface CatalogEntry {
  readonly summary: string;
  readonly doesNot: string;
  readonly family: readonly string[];
}

const TENANT_FAMILIES = [
  "tenant-isolation-fail-closed",
  "tenant-fail-closed",
  "security.tenant-fail-closed",
] as const;

const CATALOG: Readonly<Record<string, CatalogEntry>> = {
  "asset-registry-enrollment": { summary: "Central asset/device registry with enrollment workflows.", doesNot: "No trustworthy-state recency contract — records go stale silently.", family: ["enroll-new-asset", "trustworthy-state-recency"] },
  "condition-monitoring": { summary: "Alarm/condition monitoring against telemetry thresholds.", doesNot: "No fault-injection investigation trail; alarms lack evidence lineage.", family: ["investigate-injected-fault", "trustworthy-state-recency"] },
  "maintenance-planning": { summary: "Preventive-maintenance calendar/usage scheduling.", doesNot: "No workload-capacity validation — plans overcommit crews.", family: ["maintain-asset-schedule", "workload-allocation"] },
  "work-order-management": { summary: "Work-order lifecycle with approval and execution.", doesNot: "No command discipline per state transition; completion is trust-based.", family: ["create-work-order", "approve-execute-work-order", "workload-allocation"] },
  "field-mobile": { summary: "Mobile field application for technicians.", doesNot: "No machine-checked mobile shape — tables render unbounded on phones.", family: ["mobile-field-shape"] },
  "offline-tolerance": { summary: "Offline work capture with later sync.", doesNot: "No declared tolerance contract — sync conflicts are silent.", family: ["field-mode-offline-tolerance"] },
  "cross-role-handoff": { summary: "Role-to-role task handoff records.", doesNot: "Handoff payloads are opaque — no carrier digest or verification.", family: ["handoff-field-to-operator-publish", "handoff-field-to-operator-consume", "cross-role-handoff"] },
  "connectivity-posture": { summary: "Device online/offline posture board.", doesNot: "No intent-based transitions — posture changes are unaudited.", family: ["connectivity-postures"] },
  "remote-recovery": { summary: "Lost/compromised device recovery workflow.", doesNot: "No command-evidence discipline inside recovery cases.", family: ["recover-lost-device"] },
  "device-remote-command": { summary: "Remote command dispatch to devices.", doesNot: "No reconcile/expire semantics — commands leak silently.", family: ["edge-command-lifecycle"] },
  "mission-continuity": { summary: "Long-running operation campaigns with resume.", doesNot: "No journal-fold projection — campaigns lose history.", family: ["mission-replay-resume"] },
  "asset-simulation": { summary: "What-if simulation over asset fleets.", doesNot: "No emission-ingest contract — results are not reproducible.", family: ["simulation-driven-experiment"] },
  "tenant-isolation": { summary: "Multi-tenant hosting with per-tenant scopes.", doesNot: "Isolation is operational convention, not a fail-closed machine check.", family: [...TENANT_FAMILIES] },
  "procurement-spine": { summary: "Demand→quote→award→order spine.", doesNot: "Guardian authorization refs are absent from awards.", family: ["procure-spine", "quote-scoring"] },
  "order-reconciliation": { summary: "Order vs receipt total reconciliation.", doesNot: "Variance reasons are free-text, never exact bps.", family: ["order-reconciliation"] },
  "vendor-management": { summary: "Vendor lifecycle, capability verification, exposure.", doesNot: "KPI rollups hide revoked capabilities.", family: ["vendor-management", "external-catalog-sync"] },
  "software-entitlements": { summary: "License seat allocation.", doesNot: "No overshoot-exact refusal accounting.", family: ["software-entitlements"] },
  settlement: { summary: "Payment/settlement adapter.", doesNot: "No tenant-scoped idempotency — cross-tenant dedupe risk.", family: ["aurum-settlement-seam"] },
  "project-portfolio": { summary: "Stage-gated capital project management.", doesNot: "Gates are advisory — no frontier view with unlock proof.", family: ["stage-gated-project"] },
  "external-data-automation": { summary: "External catalog/actor data ingestion.", doesNot: "Quarantine is manual — malformed results can launder.", family: ["external-catalog-sync", "apify-actor-job"] },
  "org-analytics": { summary: "Org model-usage analytics and optimization review.", doesNot: "Proposals apply immediately — no what-if separation.", family: ["org-optimization-review"] },
  "security-operations": { summary: "SOC intake, evidence, decisioning, action plans, execution ledger.", doesNot: "Investigation/evidence chains are ticket-thread prose.", family: ["security.investigate-finding", "security.understand-evidence", "security.guardian-decision", "security.action-plan", "security.execution-ledger"] },
  "decision-provenance": { summary: "Why-decision inspection and reasoning context.", doesNot: "No canonical reasoning-context assembly — answers lack lineage.", family: ["security.inspect-why", "security.reasoning-context"] },
  "predictive-maintenance": { summary: "Failure-prediction advisory.", doesNot: "Advice is presented as authoritative, never advisory-labeled.", family: ["security.predictive-advice"] },
  "learning-loop": { summary: "Outcome learning on decisions.", doesNot: "No evaluation loop — learning is manual prose.", family: ["security.learn-from-outcomes"] },
  "counterfactual-analytics": { summary: "Counterfactual what-if replay of decisions.", doesNot: "Replay worlds are unaudited.", family: ["security.counterfactual-reasoning"] },
  "benchmark-trust": { summary: "Third-party decision-benchmark trust scoring.", doesNot: "No trust-tier computation — benchmarks taken at face value.", family: ["security.benchmark-trust"] },
  "agent-autonomy": { summary: "Autonomous agent action safety guardrails.", doesNot: "No agent-safety boundary — agents act unrestricted.", family: ["security.agent-safety"] },
  // Incumbent moats — EMPTY families: FleetOS honestly claims no replacement.
  "bid-exchange": { summary: "Construction bidding marketplace network.", doesNot: "Closed network — no open procurement spine.", family: [] },
  "energy-market-trading": { summary: "Energy trading and scheduling desk.", doesNot: "Position management beyond asset ops.", family: [] },
  "dispatch-routing-optimization": { summary: "Load matching, routing and dispatch optimization.", doesNot: "Network-wide optimization beyond fleet care.", family: [] },
  "agronomy-prescriptive-analytics": { summary: "Crop modeling and prescriptive agronomy.", doesNot: "Field-level prescriptive decisions beyond equipment.", family: [] },
  "clinical-workflow-integration": { summary: "Clinical workflows and EHR integration.", doesNot: "Regulated clinical records beyond facilities ops.", family: [] },
  "service-orchestration-inventory": { summary: "OSS network inventory and service orchestration.", doesNot: "Network service lifecycle beyond field ops.", family: [] },
  "space-and-workplace-management": { summary: "Space planning and workplace experience.", doesNot: "Space allocation beyond work orders.", family: [] },
  "building-plant-command": { summary: "BAS/BMS building-plant command paths.", doesNot: "Closed control loops beyond advisory edge commands.", family: [] },
  "mine-planning-haul-optimization": { summary: "Mine planning and haul-route optimization.", doesNot: "Geology-grade planning beyond fleet care.", family: [] },
  "network-hydraulic-modeling": { summary: "Hydraulic network modeling.", doesNot: "Physics-grade network models beyond telemetry.", family: [] },
};

export interface IncumbentProfile {
  /** Generic archetype id — never a vendor trademark. */
  readonly profileId: string;
  readonly role: string;
  readonly capabilities: readonly IncumbentCapability[];
}

export interface IndustryIncumbentBaseline {
  readonly industryId: string;
  readonly profiles: readonly IncumbentProfile[];
}

interface ProfileSpec {
  readonly profileId: string;
  readonly role: string;
  readonly caps: readonly (readonly [capabilityId: string, criticality: Criticality])[];
}

function expand(spec: ProfileSpec): IncumbentProfile {
  return {
    profileId: spec.profileId,
    role: spec.role,
    capabilities: spec.caps.map(([capabilityId, criticality]) => {
      const entry = CATALOG[capabilityId];
      if (entry === undefined) throw new Error(`unknown incumbent capability: ${capabilityId}`);
      return {
        id: capabilityId,
        summary: entry.summary,
        doesNot: entry.doesNot,
        criticality,
        replacementJourneyFamily: entry.family,
      };
    }),
  };
}

const BASELINES: readonly ProfileSpec[][] = [
  [ // manufacturing — full-stack replacement candidate (SWITCH-ONLY)
    { profileId: "incumbent-cmam", role: "maintenance & asset care", caps: [["asset-registry-enrollment", "core"], ["condition-monitoring", "core"], ["maintenance-planning", "core"], ["work-order-management", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-erp-suite", role: "enterprise resource planning", caps: [["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"], ["project-portfolio", "adjunct"], ["software-entitlements", "adjunct"]] },
    { profileId: "incumbent-fsm", role: "field service", caps: [["field-mobile", "core"], ["offline-tolerance", "core"], ["cross-role-handoff", "core"], ["remote-recovery", "core"]] },
    { profileId: "incumbent-scada-edge", role: "plant-floor OT platform", caps: [["connectivity-posture", "core"], ["device-remote-command", "core"], ["mission-continuity", "core"], ["asset-simulation", "core"]] },
    { profileId: "incumbent-security-siem", role: "plant security & intelligence", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "core"], ["learning-loop", "adjunct"], ["counterfactual-analytics", "adjunct"], ["benchmark-trust", "adjunct"], ["agent-autonomy", "adjunct"]] },
    { profileId: "incumbent-scm", role: "supply chain & settlement", caps: [["settlement", "adjunct"], ["external-data-automation", "adjunct"], ["org-analytics", "adjunct"]] },
  ],
  [ // construction — MAIN-INTERFACE (bid network + PMO retained)
    { profileId: "incumbent-construction-erp", role: "project & procurement ERP", caps: [["project-portfolio", "core"], ["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-fsm", role: "field service", caps: [["field-mobile", "core"], ["offline-tolerance", "core"], ["cross-role-handoff", "core"], ["maintenance-planning", "core"], ["work-order-management", "core"], ["asset-registry-enrollment", "core"], ["condition-monitoring", "core"], ["remote-recovery", "core"], ["connectivity-posture", "core"], ["device-remote-command", "core"]] },
    { profileId: "incumbent-safety-suite", role: "site safety analytics", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "adjunct"], ["learning-loop", "adjunct"]] },
    { profileId: "incumbent-bid-marketplace", role: "bidding network", caps: [["bid-exchange", "adjunct"]] },
    { profileId: "incumbent-pmo-suite", role: "program management office", caps: [["mission-continuity", "adjunct"]] },
  ],
  [ // energy-utilities — MAIN-INTERFACE (trading desk retained)
    { profileId: "incumbent-scada-historian", role: "grid telemetry & control", caps: [["connectivity-posture", "core"], ["device-remote-command", "core"], ["condition-monitoring", "core"], ["asset-simulation", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-erp-suite", role: "enterprise resource planning", caps: [["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"], ["project-portfolio", "core"], ["software-entitlements", "adjunct"], ["settlement", "adjunct"], ["org-analytics", "adjunct"], ["external-data-automation", "adjunct"]] },
    { profileId: "incumbent-utility-cmam", role: "asset care", caps: [["asset-registry-enrollment", "core"], ["maintenance-planning", "core"], ["work-order-management", "core"], ["mission-continuity", "core"], ["remote-recovery", "core"]] },
    { profileId: "incumbent-utility-fsm", role: "field service", caps: [["field-mobile", "core"], ["offline-tolerance", "core"], ["cross-role-handoff", "core"]] },
    { profileId: "incumbent-utility-soc", role: "grid security operations", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "core"], ["learning-loop", "adjunct"], ["counterfactual-analytics", "adjunct"], ["benchmark-trust", "adjunct"], ["agent-autonomy", "adjunct"]] },
    { profileId: "incumbent-energy-trading-desk", role: "energy trading", caps: [["energy-market-trading", "adjunct"]] },
  ],
  [ // transportation-logistics — COMPLEMENT (TMS optimization moat)
    { profileId: "incumbent-tms", role: "transportation management", caps: [["dispatch-routing-optimization", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-fleet-maintenance", role: "fleet maintenance", caps: [["maintenance-planning", "core"], ["work-order-management", "core"], ["asset-registry-enrollment", "core"], ["condition-monitoring", "core"], ["remote-recovery", "core"], ["connectivity-posture", "core"], ["device-remote-command", "core"]] },
    { profileId: "incumbent-fleet-fsm", role: "driver & field service", caps: [["field-mobile", "core"], ["offline-tolerance", "core"], ["cross-role-handoff", "core"]] },
    { profileId: "incumbent-erp-suite", role: "enterprise resource planning", caps: [["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"], ["software-entitlements", "adjunct"], ["settlement", "adjunct"], ["external-data-automation", "adjunct"], ["project-portfolio", "adjunct"]] },
    { profileId: "incumbent-safety-analytics", role: "fleet safety analytics", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "core"], ["learning-loop", "adjunct"]] },
  ],
  [ // agriculture — COMPLEMENT (agronomy platform moat)
    { profileId: "incumbent-agronomy-platform", role: "agronomy decision platform", caps: [["agronomy-prescriptive-analytics", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-machinery-dealer-cmam", role: "machinery care", caps: [["maintenance-planning", "core"], ["work-order-management", "core"], ["asset-registry-enrollment", "core"], ["remote-recovery", "core"], ["condition-monitoring", "core"]] },
    { profileId: "incumbent-farm-fsm", role: "farm field service", caps: [["field-mobile", "core"], ["offline-tolerance", "core"], ["cross-role-handoff", "core"], ["connectivity-posture", "core"], ["device-remote-command", "core"]] },
    { profileId: "incumbent-co-op-accounting", role: "co-op & procurement accounting", caps: [["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"]] },
    { profileId: "incumbent-farm-safety", role: "machinery safety", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "core"]] },
  ],
  [ // healthcare-facilities — COMPLEMENT (clinical EHR moat)
    { profileId: "incumbent-ehr-suite", role: "clinical records", caps: [["clinical-workflow-integration", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-clinical-engineering-cmam", role: "medical equipment care", caps: [["maintenance-planning", "core"], ["work-order-management", "core"], ["asset-registry-enrollment", "core"], ["condition-monitoring", "core"], ["remote-recovery", "core"]] },
    { profileId: "incumbent-facilities-fsm", role: "facilities field service", caps: [["field-mobile", "core"], ["cross-role-handoff", "core"], ["connectivity-posture", "core"]] },
    { profileId: "incumbent-facilities-scm", role: "supply chain", caps: [["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"], ["software-entitlements", "adjunct"]] },
    { profileId: "incumbent-facilities-compliance", role: "compliance analytics", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "core"], ["learning-loop", "adjunct"]] },
  ],
  [ // facilities-management — MAIN-INTERFACE (space mgmt + BAS command retained)
    { profileId: "incumbent-ifm-suite", role: "integrated FM platform", caps: [["work-order-management", "core"], ["maintenance-planning", "core"], ["vendor-management", "core"], ["procurement-spine", "core"], ["order-reconciliation", "core"], ["cross-role-handoff", "core"], ["field-mobile", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-bas-bms", role: "building automation", caps: [["connectivity-posture", "core"], ["condition-monitoring", "core"], ["asset-registry-enrollment", "core"], ["remote-recovery", "core"], ["building-plant-command", "adjunct"]] },
    { profileId: "incumbent-space-workplace", role: "space & workplace", caps: [["space-and-workplace-management", "adjunct"]] },
    { profileId: "incumbent-fm-accounting", role: "client billing", caps: [["settlement", "adjunct"], ["org-analytics", "adjunct"], ["software-entitlements", "adjunct"]] },
    { profileId: "incumbent-fm-security", role: "FM security", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "adjunct"], ["learning-loop", "adjunct"]] },
  ],
  [ // telecommunications — COMPLEMENT (OSS/BSS orchestration moat)
    { profileId: "incumbent-oss-bss", role: "network operations & billing", caps: [["service-orchestration-inventory", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-network-fsm", role: "network field service", caps: [["maintenance-planning", "core"], ["work-order-management", "core"], ["asset-registry-enrollment", "core"], ["condition-monitoring", "core"], ["remote-recovery", "core"], ["field-mobile", "core"], ["offline-tolerance", "core"], ["cross-role-handoff", "core"], ["mission-continuity", "core"], ["connectivity-posture", "core"], ["device-remote-command", "core"]] },
    { profileId: "incumbent-erp-suite", role: "enterprise resource planning", caps: [["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"], ["software-entitlements", "adjunct"], ["external-data-automation", "adjunct"]] },
    { profileId: "incumbent-noc-security", role: "NOC security", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "core"], ["learning-loop", "adjunct"], ["counterfactual-analytics", "adjunct"], ["benchmark-trust", "adjunct"], ["agent-autonomy", "adjunct"]] },
  ],
  [ // mining — MAIN-INTERFACE (mine planning + haul simulation retained)
    { profileId: "incumbent-mine-planning-suite", role: "mine engineering", caps: [["mine-planning-haul-optimization", "adjunct"], ["asset-simulation", "adjunct"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-mining-fleet-cmam", role: "fleet & fixed plant care", caps: [["maintenance-planning", "core"], ["work-order-management", "core"], ["asset-registry-enrollment", "core"], ["condition-monitoring", "core"], ["remote-recovery", "core"], ["mission-continuity", "core"], ["device-remote-command", "core"], ["connectivity-posture", "core"]] },
    { profileId: "incumbent-mining-fsm", role: "mine field service", caps: [["offline-tolerance", "core"], ["field-mobile", "core"], ["cross-role-handoff", "core"]] },
    { profileId: "incumbent-mining-erp", role: "enterprise resource planning", caps: [["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"], ["software-entitlements", "adjunct"], ["external-data-automation", "adjunct"], ["settlement", "adjunct"], ["org-analytics", "adjunct"], ["project-portfolio", "adjunct"]] },
    { profileId: "incumbent-mining-safety", role: "mine safety", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "core"], ["learning-loop", "adjunct"], ["counterfactual-analytics", "adjunct"], ["benchmark-trust", "adjunct"], ["agent-autonomy", "adjunct"]] },
  ],
  [ // water-waste — MAIN-INTERFACE (hydraulic modeling + settlement retained)
    { profileId: "incumbent-scada-integrator", role: "network telemetry & control", caps: [["connectivity-posture", "core"], ["device-remote-command", "core"], ["condition-monitoring", "core"], ["mission-continuity", "core"], ["tenant-isolation", "core"]] },
    { profileId: "incumbent-network-modeling-suite", role: "network engineering", caps: [["network-hydraulic-modeling", "adjunct"], ["asset-simulation", "adjunct"]] },
    { profileId: "incumbent-utility-cmam", role: "asset care", caps: [["asset-registry-enrollment", "core"], ["maintenance-planning", "core"], ["work-order-management", "core"], ["remote-recovery", "core"]] },
    { profileId: "incumbent-utility-fsm", role: "field service", caps: [["field-mobile", "core"], ["offline-tolerance", "core"], ["cross-role-handoff", "core"]] },
    { profileId: "incumbent-utility-erp", role: "enterprise resource planning", caps: [["procurement-spine", "core"], ["order-reconciliation", "core"], ["vendor-management", "core"], ["software-entitlements", "adjunct"], ["external-data-automation", "adjunct"], ["settlement", "adjunct"], ["org-analytics", "adjunct"]] },
    { profileId: "incumbent-utility-security", role: "utility security", caps: [["security-operations", "core"], ["decision-provenance", "core"], ["predictive-maintenance", "core"], ["learning-loop", "adjunct"], ["counterfactual-analytics", "adjunct"], ["benchmark-trust", "adjunct"], ["agent-autonomy", "adjunct"]] },
  ],
];

const INDUSTRY_IDS: readonly string[] = INDUSTRIES.map((i) => i.id);

/** All ten incumbent baselines keyed by industry id. */
export const INCUMBENT_BASELINES: readonly IndustryIncumbentBaseline[] = BASELINES.map((specs, i) => ({
  industryId: INDUSTRY_IDS[i] as string,
  profiles: specs.map(expand),
}));

/** The incumbent baseline of one industry (undefined = unknown industry). */
export function incumbentBaseline(industryId: string): IndustryIncumbentBaseline | undefined {
  return INCUMBENT_BASELINES.find((b) => b.industryId === industryId);
}

/** Every incumbent capability of an industry, flattened (profile attached). */
export function incumbentCapabilities(
  industryId: string,
): ReadonlyArray<IncumbentCapability & { readonly profileId: string }> {
  const baseline = incumbentBaseline(industryId);
  if (baseline === undefined) return [];
  return baseline.profiles.flatMap((p) => p.capabilities.map((c) => ({ ...c, profileId: p.profileId })));
}
