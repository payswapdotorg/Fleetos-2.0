/**
 * @fleetos/acceptance-field — the journey execution context.
 *
 * The caller-threaded state a journey's typed operations execute against.
 * Every field is produced by a REAL public API of this lane's packages
 * (directories, admission stores, journals, registries); the context owns
 * NO domain truth of its own — it is the deterministic in-memory substrate
 * the runner wires the REAL packages onto.
 *
 * Pure deterministic TS. Logical `now` everywhere (ctx.clock), never a wall
 * clock. Tenant fail-closed: the context is single-tenant by construction;
 * cross-tenant probes are explicit journey operations that assert the REAL
 * refusals.
 */

import {
  AssetDirectory,
  InMemoryAssetRepository,
  EnrollmentDirectory,
  InMemoryEnrollmentRegistry,
  type Device,
  type DeviceTwin,
  type EnrollmentRecord,
} from "@fleetos/assets";
import { emptyAdmissionStore, type AdmissionStore, type Observation, type StageMetrics, emptyStageMetrics } from "@fleetos/observations";
import type { Finding } from "@fleetos/health";
import type { RecoveryCase } from "@fleetos/recovery";
import type { MaintenanceOrder, ServicePlan } from "@fleetos/maintenance";
import {
  ConnectivityDirectory,
  InMemoryConnectivityDirectory,
  emptyIntentRegistry,
  type IntentRegistryState,
  type TenantStatusRecord,
} from "@fleetos/connectivity";
import { emptyCommandJournal, type CommandJournalState } from "@fleetos/adcos";
import type { CommandDraft, ExperienceStateSlice } from "@fleetos/experience-asset-field";
import type { HandoffCarrier } from "./handoff.js";
import type { MirrorMissionJournal } from "./mission-mirror.js";
// F321A (Wave 12 lane A) — REAL state structures for the ten new journeys.
import {
  emptyBundleReceptionLog,
  type BundleReceptionLog,
  type ObservationBundle,
  emptyTenantAdmissionCaps,
  type IngestionBuffer,
  type TenantAdmissionCaps,
} from "@fleetos/observations";
import type { OfflineBuffer } from "@fleetos/connectivity";
import type { DiagnosisHypothesisRecord, AnomalyState } from "@fleetos/health";
import { emptyMaintenanceCalendar, type MaintenanceCalendar } from "@fleetos/maintenance";
import {
  emptyLineageGraph,
  type LineageGraph,
  type MaterialLot,
  type LineageRef,
} from "@fleetos/assets";
import type { MembershipRecord, Role, Actor, SessionRecord } from "@fleetos/identity";
import { TenantRegistry, InMemoryTenantRegistry } from "@fleetos/tenancy";

/** A JSON-shaped reading value (assertions compare these canonically). */
export type ReadingValue = string | number | boolean | null | ReadonlyArray<unknown> | { readonly [k: string]: unknown };

export interface SimEmissionRecord {
  readonly deviceId: string;
  readonly seq: number;
  readonly streamKind: string;
  readonly unit: string;
  readonly value: number;
  readonly observedAt: number;
  readonly payloadDigest: string;
}

export interface SimRunRecord {
  readonly runId: string;
  readonly worldId: string;
  readonly steps: number;
  readonly eventCount: number;
  readonly finalStep: number;
  readonly assetFailureEvents: ReadonlyArray<{ readonly assetId: string; readonly cause: string; readonly step: number }>;
  readonly emissions: ReadonlyArray<SimEmissionRecord>;
}

/** A signed bundle plus its source payloads and signing key (the receive
 * executor re-feeds the REAL pipeline with them — the admission side of
 * store-and-forward). */
export interface StoredBundle {
  readonly bundle: ObservationBundle;
  readonly agentKey: string;
  readonly payloads: ReadonlyArray<{ readonly seq: number; readonly payload: Readonly<Record<string, unknown>> }>;
}

/** The deterministic execution substrate for one journey (or a handoff pair). */
export interface JourneyContext {
  readonly tenantId: string;
  readonly startedAt: number;
  /** Logical clock — advanced only by journey operations, never by a wall clock. */
  clock: number;
  assets: AssetDirectory;
  devices: Map<string, Device>;
  enrollment: EnrollmentDirectory;
  admission: AdmissionStore;
  metrics: StageMetrics;
  observations: Observation[];
  twins: Map<string, DeviceTwin>;
  findings: Finding[];
  recoveryCases: Map<string, RecoveryCase>;
  plans: ServicePlan[];
  orders: Map<string, MaintenanceOrder>;
  connectivity: ConnectivityDirectory;
  intentRegistry: IntentRegistryState;
  adcos: CommandJournalState;
  simRuns: Map<string, SimRunRecord>;
  missions: Map<string, MirrorMissionJournal>;
  /** Per-mission execution parameters (device + batch shape) for resume. */
  missionParams: Map<string, {
    readonly deviceId: string;
    readonly batchPerStage: number;
    readonly observationKind: string;
    readonly firstObservedAt: number;
    readonly stepMs: number;
  }>;
  /** The last built experience command draft (REAL output of the intent builders). */
  lastDraft: CommandDraft | null;
  /** The last REAL enrollment record (device.enroll output) — the tenancy
   * probes re-check it against a foreign tenant through checkEnrollment. */
  lastEnrollment: EnrollmentRecord | null;
  handoff: HandoffCarrier | null;
  /** Optional taint used ONLY by the tenant-isolation journey (documents the
   * injected foreign-tenant record the REAL state guard must refuse). */
  foreignAsset: { readonly id: string; readonly tenantId: string } | null;
  readings: Map<string, ReadingValue>;
  // -------------------------------------------------------------------------
  // F321A (Wave 12 lane A) — caller-threaded state for the ten new journeys.
  // Every field is a REAL public structure of this lane's packages; the
  // context owns no domain logic of its own.
  // -------------------------------------------------------------------------
  /** Store-and-forward receiving side: the REAL reception log + the signed
   * bundle workbench (bundles built by REAL signBundle in ops). */
  storeForward: { log: BundleReceptionLog; bundles: Map<string, StoredBundle> };
  /** Per-device REAL offline buffers (connectivity offline-buffer). */
  offlineBuffers: Map<string, OfflineBuffer>;
  /** REAL bounded ingestion buffer + per-tenant admission caps. */
  ingestionBuffer: IngestionBuffer | null;
  admissionCaps: TenantAdmissionCaps;
  /** REAL maintenance calendar (scheduling-scale). */
  calendar: MaintenanceCalendar;
  /** REAL tamper-evident lineage graph + material lots + declared lineage refs. */
  lineage: {
    graph: LineageGraph;
    lots: Map<string, MaterialLot>;
    refs: LineageRef[];
  };
  /** REAL diagnosis hypothesis records (health kernel) by id. */
  diagnoses: Map<string, DiagnosisHypothesisRecord>;
  /** REAL per-device anomaly states (health kernel-signals). */
  anomalyStates: Map<string, AnomalyState>;
  /** REAL identity session records + role bindings + per-actor seq. */
  identity: {
    sessions: Map<string, SessionRecord & { readonly seq: number }>;
    memberships: MembershipRecord[];
    lastSeqByActor: Map<string, number>;
    knownActors: ReadonlyArray<Actor>;
    knownRoles: ReadonlyArray<Role>;
  };
  /** REAL tenant registry (tenancy kernel over the in-memory port). */
  tenants: TenantRegistry;
}

export function createJourneyContext(tenantId: string, startedAt: number): JourneyContext {
  return {
    tenantId,
    startedAt,
    clock: startedAt,
    assets: new AssetDirectory(new InMemoryAssetRepository()),
    devices: new Map(),
    enrollment: new EnrollmentDirectory(new InMemoryEnrollmentRegistry()),
    admission: emptyAdmissionStore(),
    metrics: emptyStageMetrics(),
    observations: [],
    twins: new Map(),
    findings: [],
    recoveryCases: new Map(),
    plans: [],
    orders: new Map(),
    connectivity: new ConnectivityDirectory(new InMemoryConnectivityDirectory()),
    intentRegistry: emptyIntentRegistry(),
    adcos: emptyCommandJournal(),
    simRuns: new Map(),
    missions: new Map(),
    missionParams: new Map(),
    lastDraft: null,
    lastEnrollment: null,
    handoff: null,
    foreignAsset: null,
    readings: new Map(),
    // F321A state — REAL empty structures + the fixed actor/role fixtures
    // bindRole validates against (same fixture discipline as FIELD_LAB_WORLD).
    storeForward: { log: emptyBundleReceptionLog(), bundles: new Map() },
    offlineBuffers: new Map(),
    ingestionBuffer: null,
    admissionCaps: emptyTenantAdmissionCaps(500),
    calendar: emptyMaintenanceCalendar(),
    lineage: { graph: emptyLineageGraph(), lots: new Map(), refs: [] },
    diagnoses: new Map(),
    anomalyStates: new Map(),
    identity: {
      sessions: new Map(),
      memberships: [],
      lastSeqByActor: new Map(),
      knownActors: [
        { id: "act_operator-ada-01" as never, tenantId: tenantId as never, displayName: "Operator Ada", kind: "human", createdAt: startedAt },
        { id: "act_tech-tomas-01" as never, tenantId: tenantId as never, displayName: "Tech Tomas", kind: "human", createdAt: startedAt },
        { id: "act_edge-edda-01" as never, tenantId: tenantId as never, displayName: "Edge Edda", kind: "service", createdAt: startedAt },
      ],
      knownRoles: [
        { id: "role_field-ops-01" as never, scope: "tenant", label: "Field Operations", capabilities: ["fleet.read", "case.open"] },
        { id: "role_tech-01" as never, scope: "tenant", label: "Field Technician", capabilities: ["asset.inspect"] },
        { id: "role_edge-01" as never, scope: "tenant", label: "Edge Agent", capabilities: ["device.command"] },
      ],
    },
    tenants: new TenantRegistry(new InMemoryTenantRegistry()),
  };
}

/**
 * Project the accumulated REAL domain state onto the experience plane's
 * state slice (the read-model input contract of @fleetos/experience-asset-field).
 * Every record in the slice was produced by a REAL public API call in a
 * previous journey step; the foreign-asset taint, when present, is the
 * tenant-isolation journey's injected cross-tenant record.
 */
export function buildStateSlice(ctx: JourneyContext): ExperienceStateSlice {
  const assets = ctx.assets
    .listAssets(ctx.tenantId)
    .map((record) => ({
      id: record.id,
      tenantId: record.tenantId,
      kind: record.kind,
      displayName: record.displayName,
      lifecycle: record.lifecycle,
      createdAt: record.createdAt,
    }));
  if (ctx.foreignAsset) {
    // The injected foreign-tenant asset — the REAL guard must refuse it.
    assets.push({
      id: ctx.foreignAsset.id as never,
      tenantId: ctx.foreignAsset.tenantId,
      kind: "other",
      displayName: "foreign-tainted-asset",
      lifecycle: "admitted",
      createdAt: ctx.startedAt,
    });
  }
  return {
    tenantId: ctx.tenantId,
    assets,
    devices: [...ctx.devices.values()],
    twins: [...ctx.twins.values()],
    observations: ctx.observations,
    findings: ctx.findings,
    recoveryCases: [...ctx.recoveryCases.values()],
    plans: ctx.plans,
    orders: [...ctx.orders.values()],
    connectivity: ctx.connectivity.listStatuses(ctx.tenantId) as ReadonlyArray<TenantStatusRecord>,
  };
}
