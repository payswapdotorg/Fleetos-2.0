/**
 * F251 integration-health test fixtures — deterministic, REAL-implementation
 * bindings only. Logical `now`, fixed tenants, no clock, no randomness.
 *
 * Every lane slice is built through the lanes' REAL public builders (the
 * adcos circuit fold + health inputs, the connectivity intent registry +
 * status records, the aurum projection store via a REAL applied batch, the
 * apify run journal via REAL appends, the vendors catalog/registry/metrics
 * via REAL imports, arena evaluation requests, learning evaluations via the
 * REAL evaluateCapability fold).
 */

import {
  foldAdapterCircuitAll,
  sessionSummaryFromClasses,
  type CommandOutcomeObservation,
} from "@fleetos/adcos";
import {
  emptyIntentRegistry,
  proposeIntent,
  transitionRegistryIntent,
  type TenantStatusRecord,
} from "@fleetos/connectivity";
import {
  applyDeltaBatch,
  openProjectionStore,
  type ExternalProjectionBatch,
  type ExternalProjectionDelta,
  type ExternalProjectionSnapshot,
  type ProjectionStore,
} from "@fleetos/aurum";
import { appendRunEvent, openRunJournal, type RunJournal } from "@fleetos/apify";
import {
  importCatalogBatch,
  ingestVendorMetrics,
  openVendorCatalog,
  openVerificationRegistry,
  verifyCapability,
  type MetricDraft,
  type VerificationRegistry,
  type VendorCatalog,
  type VendorMetricRecord,
} from "@fleetos/external-vendors";
import type { ArenaEvaluationRequest } from "@fleetos/integrations/arena";
import { evaluateCapability, type CapabilityEvaluation } from "@fleetos/learning";
import type { IntegrationHealthState } from "../src/health-assembly.js";

export const TENANT = "t_f241health01";
export const TENANT_B = "t_other99x";
export const NOW = 1_700_000_000_000;
export const AURUM_SOURCE = "aurum-erp-01";
export const WINDOW = "2025-W01";
export const WINDOW_PREV = "2024-W52";

// ---------------------------------------------------------------------------
// adcos slice.
// ---------------------------------------------------------------------------

export function adcosOutcomes(ok: boolean, count: number): CommandOutcomeObservation[] {
  return Array.from({ length: count }, (_, i) => ({ ok, at: NOW - 1_000 - i }));
}

export function adcosSlice(input?: {
  readonly outcomes?: readonly CommandOutcomeObservation[];
  readonly classes?: readonly ("fresh" | "stale" | "expired" | "revoked")[];
  readonly postures?: readonly ("connected" | "degraded" | "offline")[];
}): IntegrationHealthState["adcos"] {
  return {
    commandOutcomes: input?.outcomes ?? adcosOutcomes(true, 3),
    sessionSummary: sessionSummaryFromClasses(input?.classes ?? ["fresh", "fresh"]),
    postureSignals: input?.postures ?? ["connected"],
    circuit: foldAdapterCircuitAll(input?.outcomes ?? adcosOutcomes(true, 3), { failureThreshold: 3, cooldownMs: 60_000 }),
  };
}

// ---------------------------------------------------------------------------
// connectivity slice — an ACTIVE online intent + a fresh online record.
// ---------------------------------------------------------------------------

export function connectivitySlice(tenant: string = TENANT): IntegrationHealthState["connectivity"] {
  const proposed = proposeIntent(emptyIntentRegistry(), {
    tenantId: tenant,
    deviceId: "dev_truck-001",
    desiredState: "online",
    idempotencyKey: "ik-health-connect-1",
    at: NOW - 10_000,
    actor: "act_healthop",
  });
  if (!proposed.ok) throw new Error(`connectivity fixture refused: ${proposed.reason}`);
  const authorized = transitionRegistryIntent(proposed.state, {
    tenantId: tenant,
    intentId: proposed.intentId,
    eventKind: "authorize",
    now: NOW - 9_000,
    actor: "guardian",
    authorization: { grantedBy: "guardian", authorizationDigest: "auth-digest-1", grantedAt: NOW - 10_000, expiresAt: NOW + 100_000 },
    ceiling: { effect: "allow", reason: "fixture policy" },
  });
  if (!authorized.ok) throw new Error(`connectivity authorize refused: ${authorized.reason}`);
  const activated = transitionRegistryIntent(authorized.state, {
    tenantId: tenant,
    intentId: proposed.intentId,
    eventKind: "activate",
    now: NOW - 8_000,
    actor: "act_healthop",
  });
  if (!activated.ok) throw new Error(`connectivity activate refused: ${activated.reason}`);
  const records: TenantStatusRecord[] = [
    { tenantId: tenant, deviceId: "dev_truck-001", state: "online", observedAt: NOW - 500 },
  ];
  return { records, registry: activated.state };
}

// ---------------------------------------------------------------------------
// aurum slice — a REAL applied batch, then a matching snapshot set (in-sync).
// ---------------------------------------------------------------------------

export function aurumDelta(externalId: string, logicalTime: number, payload: Readonly<Record<string, unknown>> = { status: "ok" }): ExternalProjectionDelta {
  return { op: "upsert", externalId, payload, logicalTime, idempotencyKey: `ik-aurum-${externalId}-${String(logicalTime)}` };
}

export function appliedAurumStore(tenant: string = TENANT, deltas: readonly ExternalProjectionDelta[] = [aurumDelta("ext-001", 100)]): ProjectionStore {
  const opened = openProjectionStore({ tenantId: tenant }, AURUM_SOURCE);
  if (!opened.ok) throw new Error(`aurum store refused: ${opened.reasonCode}`);
  const batch: ExternalProjectionBatch = {
    kind: "external-projection-batch",
    tenant: { tenantId: tenant },
    source: AURUM_SOURCE,
    deltas: [...deltas],
  };
  const applied = applyDeltaBatch(opened.store, batch);
  if (!applied.ok) throw new Error(`aurum batch refused: ${applied.reasonCode}`);
  return applied.store;
}

export function snapshotsOf(store: ProjectionStore): ExternalProjectionSnapshot[] {
  return [...store.projections.values()].map((p) => ({
    externalId: p.externalId,
    payload: p.payload ?? {},
    logicalTime: p.logicalTime,
  }));
}

export function aurumSlice(input?: { readonly store?: ProjectionStore; readonly snapshots?: readonly ExternalProjectionSnapshot[] }): IntegrationHealthState["aurum"] {
  const store = input?.store ?? appliedAurumStore();
  return { store, snapshots: input?.snapshots ?? snapshotsOf(store), source: AURUM_SOURCE };
}

// ---------------------------------------------------------------------------
// apify slice — a REAL journaled job that reaches `completed`.
// ---------------------------------------------------------------------------

export function apifyJournalWithJob(tenant: string = TENANT, jobId = "job-001", status: "job-completed" | "job-failed" = "job-completed"): RunJournal {
  const opened = openRunJournal({ tenantId: tenant });
  if (!opened.ok) throw new Error(`apify journal refused: ${opened.reasonCode}`);
  let journal = opened.journal;
  const appends: readonly { kind: Parameters<typeof appendRunEvent>[1]["kind"]; reasonCode?: string }[] = [
    { kind: "job-created" },
    { kind: "job-authorized" },
    { kind: "job-scheduled" },
    { kind: "job-started" },
    { kind: status },
  ];
  let at = NOW - 5_000;
  for (const append of appends) {
    const result = appendRunEvent(journal, {
      kind: append.kind,
      tenant: { tenantId: tenant },
      jobId,
      at,
      actorId: "actor-prices-v1",
      window: WINDOW,
      reasonCode: append.reasonCode,
    });
    if (!result.ok) throw new Error(`apify append refused: ${result.reasonCode}`);
    journal = result.journal;
    at += 100;
  }
  return journal;
}

// ---------------------------------------------------------------------------
// vendors slice — a REAL imported catalog entry + verified capability.
// ---------------------------------------------------------------------------

export function vendorsSlice(input?: {
  readonly tenant?: string;
  readonly quarantinedMetric?: boolean;
}): { slice: IntegrationHealthState["vendors"]; catalog: VendorCatalog; registry: VerificationRegistry; metrics: readonly VendorMetricRecord[] } {
  const tenant = input?.tenant ?? TENANT;
  const opened = openVendorCatalog({ tenantId: tenant }, "vendor-crm-01");
  if (!opened.ok) throw new Error(`vendors catalog refused: ${opened.reasonCode}`);
  const imported = importCatalogBatch(opened.catalog, [
    { externalId: "ext-crm-001", vendorExternalId: "vendor-crm-01", displayName: "CRM Vendor", capabilities: ["catalog-sync"], logicalTime: 100 },
  ], NOW - 50_000);
  if (!imported.ok) throw new Error(`vendors import refused: ${imported.reasonCode}`);
  let catalog = imported.catalog;
  const registryOpened = openVerificationRegistry({ tenantId: tenant });
  if (!registryOpened.ok) throw new Error(`vendors registry refused: ${registryOpened.reasonCode}`);
  let registry = registryOpened.registry;
  const verified = verifyCapability(catalog, registry, {
    tenant: { tenantId: tenant },
    externalId: "ext-crm-001",
    capability: "catalog-sync",
    evidence: { evidenceId: "ev-001", tenantId: tenant },
    verifiedAt: NOW - 40_000,
    expiresAt: NOW + 400_000,
  });
  if (!verified.ok) throw new Error(`vendors verify refused: ${verified.reasonCode}`);
  catalog = verified.catalog;
  registry = verified.registry;
  const drafts: MetricDraft[] = [
    {
      tenant: { tenantId: tenant },
      metricId: "met-001",
      // The lane's convention: a metric's `vendorExternalId` is matched
      // against the catalog's entry key (the entry's `externalId`).
      vendorExternalId: "ext-crm-001",
      metric: "delivery-ontime",
      window: WINDOW,
      valueBps: 9_500,
      weightBps: 1_000,
      dependsOnCapability: input?.quarantinedMetric === true ? "not-verified-cap" : null,
      ingestedAt: NOW - 1_000,
    },
  ];
  const ingested = ingestVendorMetrics([], catalog, registry, drafts);
  if (!ingested.ok) throw new Error(`vendors metrics refused: ${ingested.reasonCode}`);
  const metrics = ingested.metrics;
  return {
    slice: { catalog, registry, metrics, currentWindow: WINDOW, previousWindow: WINDOW_PREV },
    catalog,
    registry,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// arena + learning slices.
// ---------------------------------------------------------------------------

export function arenaRequest(tenant: string = TENANT, capabilityId = "cap-routing"): ArenaEvaluationRequest {
  return {
    tenant: { tenantId: tenant },
    capability: { capabilityId, version: "1.0.0" },
    cases: [
      {
        caseId: "case-001",
        tenant: { tenantId: tenant },
        capability: { capabilityId, version: "1.0.0" },
        inputs: { input: 1 },
        expected: 1,
        description: "deterministic case",
        tags: ["fixture"],
      },
    ],
    requester: "act_healthop",
    requestedAt: "2025-01-01T00:00:00.000Z",
  };
}

export function learningEvaluations(tenant: string = TENANT): CapabilityEvaluation[] {
  // Five cases with five successes → `strong` band (>= SUMMARY_BANDS.minCasesForEvidence),
  // stable trend (single evaluation) — the NOMINAL learning signal.
  const cases = Array.from({ length: 5 }, (_, i) => ({
    caseId: `case-${String(i + 1).padStart(3, "0")}`,
    tenant: { tenantId: tenant },
    capability: { capabilityId: "cap-routing", version: "1.0.0" },
    inputs: { input: i + 1 },
    expected: i + 1,
    description: "deterministic case",
    tags: ["fixture"],
  }));
  const outcomes = cases.map((c, i) => ({
    observationId: `obs-${String(i + 1).padStart(3, "0")}`,
    caseId: c.caseId,
    actual: c.expected,
    observedAt: "2025-01-01T00:00:01.000Z",
    observationRef: `obsref-${String(i + 1).padStart(3, "0")}`,
    success: true,
  }));
  return [
    evaluateCapability(cases, outcomes, { tenantId: tenant }, { capabilityId: "cap-routing", version: "1.0.0" }, "2025-01-01T00:00:02.000Z"),
  ];
}

// ---------------------------------------------------------------------------
// The full healthy state.
// ---------------------------------------------------------------------------

export function healthyState(tenant: string = TENANT): IntegrationHealthState {
  const vendors = vendorsSlice();
  return {
    tenantId: tenant,
    adcos: adcosSlice(),
    connectivity: connectivitySlice(tenant),
    arena: { requests: [arenaRequest(tenant)] },
    learning: { evaluations: learningEvaluations(tenant) },
    aurum: aurumSlice(),
    apify: { journal: apifyJournalWithJob(tenant) },
    vendors: vendors.slice,
  };
}
