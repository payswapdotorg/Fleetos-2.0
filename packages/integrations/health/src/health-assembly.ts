/**
 * @fleetos/integration-health — `assembleIntegrationHealth` (F251 deliverable 1).
 *
 * The tenant-scoped integration-plane health view: per-adapter sections
 * composed from the seven Wave-5 lanes' REAL health/read-model outputs
 * (adcos adapter-health rollup + circuit classification, connectivity posture
 * rollups, arena honest degraded states, learning trend classification,
 * aurum sync-reconciliation classes, apify run/job signals, vendors
 * verification expiry + scorecard exclusions), a global rollup over a FIXED
 * deterministic severity ladder (see `health-sections.ts`), and ONE chained
 * FNV-1a digest (␟ join) covering every section digest.
 *
 * TENANT FAIL-CLOSED across the WHOLE assembly: a missing tenant, an
 * adapter-slice tenant mismatch, or any lane refusing its own computation
 * refuses the ENTIRE assembly — there is no partial health view. Lane
 * refusal codes are surfaced verbatim in `laneCode`. (Where a lane silently
 * FILTERS foreign-tenant records — connectivity — this assembly refuses
 * first; the tower-level narrowing is deliberate, mirroring the F241 S4
 * precedent.)
 *
 * READ-ONLY composition (no command emission, no state mutation, no
 * Guardian bypass). Adapter-carried reason codes are surfaced verbatim.
 *
 * Determinism: pure fold over caller-supplied state; identical inputs
 * produce a byte-identical view including the digest.
 */

import {
  defaultAdapterCircuitConfig,
  defaultAdapterHealthConfig,
  evaluateAdapterCircuit,
  rollupAdapterHealth,
  type AdapterCircuitConfig,
  type AdapterCircuitStatus,
  type AdapterHealthConfig,
  type CommandOutcomeObservation,
  type PostureSignalLike,
  type SessionHealthSummary,
} from "@fleetos/adcos";
import {
  defaultHeartbeatTtl,
  rollupFleetPosture,
  type HeartbeatTtl,
  type IntentRegistryState,
  type TenantStatusRecord,
} from "@fleetos/connectivity";
import {
  evaluateWithDegradation,
  makeReferenceArenaAdapter,
  type ArenaAdapter,
  type ArenaDegradedState,
  type ArenaEvaluationRequest,
} from "@fleetos/integrations/arena";
import { summarizeCapabilityEvaluations, type CapabilityEvaluation } from "@fleetos/learning";
import { reconcileProjectionSet, type ExternalProjectionSnapshot, type ProjectionStore } from "@fleetos/aurum";
import { foldRunJournal, verifyRunJournalChain, type RunJournal } from "@fleetos/apify";
import {
  classifyVerificationExpiry,
  rollupVendorScorecards,
  type VendorCatalog,
  type VendorMetricRecord,
  type VerificationRegistry,
} from "@fleetos/external-vendors";
import { healthDigestOf } from "./health-core.js";
import {
  assemblyDigestBody,
  buildAdcosSection,
  buildApifySection,
  buildArenaSection,
  buildAurumSection,
  buildConnectivitySection,
  buildLearningSection,
  buildRollup,
  buildVendorsSection,
  INTEGRATION_HEALTH_SCHEMA_VERSION,
  sectionDigest,
  sectionsOf,
  stampSectionDigests,
  type AdapterHealthSection,
  type IntegrationHealthView,
} from "./health-sections.js";

export type {
  AdapterSeverity,
  AdcosSection,
  ApifySection,
  ArenaSection,
  AurumSection,
  ConnectivitySection,
  HealthSection,
  IntegrationHealthRollup,
  IntegrationHealthView,
  LearningSection,
  VendorsSection,
} from "./health-sections.js";

// ---------------------------------------------------------------------------
// Input state — the per-lane domain slices (the lanes' own input shapes).
// ---------------------------------------------------------------------------

export interface AdcosHealthSlice {
  readonly commandOutcomes: readonly CommandOutcomeObservation[];
  readonly sessionSummary: SessionHealthSummary;
  readonly postureSignals: readonly PostureSignalLike[];
  readonly circuit: AdapterCircuitStatus;
  readonly healthConfig?: AdapterHealthConfig;
  readonly circuitConfig?: AdapterCircuitConfig;
}

export interface ConnectivityHealthSlice {
  readonly records: readonly TenantStatusRecord[];
  readonly registry: IntentRegistryState;
  readonly ttl?: HeartbeatTtl;
}

export interface AurumHealthSlice {
  readonly store: ProjectionStore;
  readonly snapshots: readonly ExternalProjectionSnapshot[];
  readonly source: string;
}

export interface ApifyHealthSlice {
  readonly journal: RunJournal;
}

export interface VendorsHealthSlice {
  readonly catalog: VendorCatalog;
  readonly registry: VerificationRegistry;
  readonly metrics: readonly VendorMetricRecord[];
  readonly currentWindow: string;
  readonly previousWindow: string;
}

export interface ArenaHealthSlice {
  readonly requests: readonly ArenaEvaluationRequest[];
  readonly adapter?: ArenaAdapter;
}

export interface LearningHealthSlice {
  readonly evaluations: readonly CapabilityEvaluation[];
}

export interface IntegrationHealthState {
  readonly tenantId: string;
  readonly adcos: AdcosHealthSlice;
  readonly connectivity: ConnectivityHealthSlice;
  readonly arena: ArenaHealthSlice;
  readonly learning: LearningHealthSlice;
  readonly aurum: AurumHealthSlice;
  readonly apify: ApifyHealthSlice;
  readonly vendors: VendorsHealthSlice;
}

export interface IntegrationHealthOptions {
  readonly now: number;
}

export type HealthRefusal =
  | "missing-tenant"
  | "invalid-now"
  | "tenant-mismatch"
  | "arena-refused"
  | "learning-refused"
  | "aurum-refused"
  | "apify-refused"
  | "vendors-refused";

export type IntegrationHealthResult =
  | { readonly ok: true; readonly view: IntegrationHealthView }
  | {
      readonly ok: false;
      readonly refused: HealthRefusal;
      readonly detail: string;
      /** The refusing lane's own code, surfaced verbatim. */
      readonly laneCode?: string;
    };

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

function refuse(refused: HealthRefusal, detail: string, laneCode?: string): { ok: false; refused: HealthRefusal; detail: string; laneCode?: string } {
  return laneCode === undefined ? { ok: false, refused, detail } : { ok: false, refused, detail, laneCode };
}

/** The first adapter-slice tenant that differs from the assembly scope. */
function firstSliceTenantMismatch(state: IntegrationHealthState, tenantId: string): string | null {
  for (const record of state.connectivity.records) {
    if (record.tenantId !== tenantId) return `connectivity.record:${record.deviceId}`;
  }
  for (const intent of state.connectivity.registry.byId.values()) {
    if (intent.tenantId !== tenantId) return `connectivity.intent:${intent.intentId}`;
  }
  if (state.aurum.store.tenant.tenantId !== tenantId) return "aurum.store";
  if (state.apify.journal.tenant.tenantId !== tenantId) return "apify.journal";
  if (state.vendors.catalog.tenant.tenantId !== tenantId) return "vendors.catalog";
  if (state.vendors.registry.tenant.tenantId !== tenantId) return "vendors.registry";
  for (const request of state.arena.requests) {
    if (request.tenant.tenantId !== tenantId) return `arena.request:${request.capability.capabilityId}`;
  }
  return null;
}

/** Assemble the tenant-scoped integration-plane health view. */
export function assembleIntegrationHealth(
  state: IntegrationHealthState,
  options: IntegrationHealthOptions,
): IntegrationHealthResult {
  if (!Number.isFinite(options.now) || options.now <= 0) {
    return refuse("invalid-now", `logical now must be finite and positive, got ${String(options.now)}`);
  }
  if (state.tenantId === "") {
    return refuse("missing-tenant", "health tenant scope is empty");
  }
  const mismatched = firstSliceTenantMismatch(state, state.tenantId);
  if (mismatched !== null) {
    return refuse(
      "tenant-mismatch",
      `adapter slice "${mismatched}" does not belong to tenant "${state.tenantId}" (fail-closed: no partial assembly)`,
    );
  }
  const tenant = state.tenantId;
  const now = options.now;

  // --- adcos: the REAL adapter-health rollup over the REAL circuit machine ---
  const circuit = evaluateAdapterCircuit(
    state.adcos.circuit,
    now,
    state.adcos.circuitConfig ?? defaultAdapterCircuitConfig(),
  );
  const report = rollupAdapterHealth(
    {
      tenantId: tenant,
      now,
      commandOutcomes: state.adcos.commandOutcomes,
      sessionSummary: state.adcos.sessionSummary,
      postureSignals: state.adcos.postureSignals,
    },
    circuit,
    state.adcos.healthConfig ?? defaultAdapterHealthConfig(),
  );

  // --- connectivity: the REAL fleet posture rollup ---
  const posture = rollupFleetPosture({
    tenantId: tenant,
    records: state.connectivity.records,
    registry: state.connectivity.registry,
    ttl: state.connectivity.ttl ?? defaultHeartbeatTtl(),
    now,
  });

  // --- aurum: the REAL periodic sync-reconciliation (refusal = no assembly) ---
  const reconciliation = reconcileProjectionSet(state.aurum.store, state.aurum.snapshots, state.aurum.source, now);
  if (!reconciliation.ok) {
    return refuse("aurum-refused", reconciliation.detail, reconciliation.reasonCode);
  }

  // --- apify: the REAL run-registry fold, over a chain-VERIFIED journal ---
  const chain = verifyRunJournalChain(state.apify.journal);
  if (!chain.ok) {
    return refuse("apify-refused", `run journal chain broken at seq ${String(chain.brokenAtSeq)}`, chain.reasonCode);
  }
  const runs = foldRunJournal(state.apify.journal);

  // --- vendors: the REAL scorecard rollup + verification expiry classes ---
  const scorecards = rollupVendorScorecards(state.vendors.metrics, {
    tenant: { tenantId: tenant },
    currentWindow: state.vendors.currentWindow,
    previousWindow: state.vendors.previousWindow,
  });
  if (!scorecards.ok) return refuse("vendors-refused", scorecards.detail, scorecards.reasonCode);
  const expiry = classifyVerificationExpiry(state.vendors.registry, now);
  const revokedCount = [...state.vendors.registry.records.values()].filter((r) => r.state === "revoked").length;

  // --- arena: the REAL honest-degradation evaluation ---
  const arenaAdapter = state.arena.adapter ?? makeReferenceArenaAdapter();
  const arenaDegraded: ArenaDegradedState[] = [];
  for (const request of state.arena.requests) {
    const evaluated = evaluateWithDegradation(arenaAdapter, request);
    if (!evaluated.ok) arenaDegraded.push(evaluated.degraded);
  }

  // --- learning: the REAL capability-evaluation summary (advisory) ---
  const summary = summarizeCapabilityEvaluations(state.learning.evaluations, {
    tenant: { tenantId: tenant },
    summarizedAtMs: now,
  });
  if (!summary.ok) return refuse("learning-refused", summary.reason, summary.code);

  // --- sections (fixed severity ladder; lane codes verbatim) ---
  const adcos = buildAdcosSection(report);
  const connectivity = buildConnectivitySection(posture);
  const arena = buildArenaSection(state.arena.requests.length, arenaDegraded);
  const learning = buildLearningSection(summary.summary);
  const aurum = buildAurumSection(reconciliation.report);
  const apify = buildApifySection(runs);
  const vendors = buildVendorsSection(expiry, revokedCount, scorecards.rollups);
  const sections: readonly AdapterHealthSection[] = [adcos, connectivity, arena, learning, aurum, apify, vendors];
  stampSectionDigests(sections);
  const rollup = buildRollup(sections);
  const view: IntegrationHealthView = {
    schemaVersion: INTEGRATION_HEALTH_SCHEMA_VERSION,
    tenantId: tenant,
    asOf: now,
    adcos,
    connectivity,
    arena,
    learning,
    aurum,
    apify,
    vendors,
    rollup,
    digest: healthDigestOf("integration-health", assemblyDigestBody(sections, tenant, now, rollup)),
  };
  return { ok: true, view };
}

/** Recompute the assembly digest from the presented view; false = tampered. */
export function verifyIntegrationHealthDigest(view: IntegrationHealthView): boolean {
  const sections = sectionsOf(view);
  for (const section of sections) {
    if (sectionDigest(section) !== section.digest) return false;
  }
  return healthDigestOf("integration-health", assemblyDigestBody(sections, view.tenantId, view.asOf, view.rollup)) === view.digest;
}
