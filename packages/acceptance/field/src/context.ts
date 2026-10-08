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
