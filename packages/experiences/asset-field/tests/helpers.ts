/**
 * F240A test fixtures — a deterministic tenant state slice.
 *
 * One fleet, three assets, four devices, three twinned + one never-observed
 * device, findings across severities and staleness classes, two open + two
 * terminal recovery cases, three service plans (recurring/one-time/bounded)
 * with orders in every maintenance state, and honest connectivity records
 * (fresh-online, stale-online, fresh-offline, absent).
 *
 * `makeState()` deep-clones the base so tests can mutate freely.
 */

import type {
  AssetId,
  Device,
  DeviceId,
  DeviceTwin,
  ManagedAsset,
  TwinRevisionSeq,
} from "@fleetos/assets";
import type { Finding } from "@fleetos/health";
import type { Observation, ObservationId, ObservationSeq } from "@fleetos/observations";
import type { RecoveryCase, RecoveryCaseId } from "@fleetos/recovery";
import type { MaintenanceOrder, MaintenanceOrderId, ServicePlan, ServicePlanId } from "@fleetos/maintenance";
import type { TenantStatusRecord } from "@fleetos/connectivity";
import type { ExperienceStateSlice } from "../src/state.js";

/**
 * Deeply-writable state slice — test fixtures are freely mutable. Primitives
 * (including branded string ids, which extend string) pass through untouched
 * so the domain types stay intact.
 */
export type DeepWritable<T> =
  T extends readonly (infer E)[]
    ? DeepWritable<E>[]
    : T extends string | number | boolean | bigint | symbol | null | undefined
      ? T
      : T extends Uint8Array | ArrayBuffer | Date
        ? T
        : T extends object
          ? { -readonly [K in keyof T]: DeepWritable<T[K]> }
          : T;

export type MutableExperienceState = DeepWritable<ExperienceStateSlice>;

export const TENANT = "tnt_f240a";
export const ACTOR = "act_fieldop01";
export const NOW = 1_700_000_000_000;
export const DAY_MS = 86_400_000;

const digest = (seed: string): string => seed.padEnd(64, "0").slice(0, 64);

function twin(
  deviceId: string,
  seq: number,
  observedAt: number,
  attributes: Record<string, unknown>,
): DeviceTwin {
  return {
    deviceId: deviceId as DeviceId,
    tenantId: TENANT,
    revisions: [
      {
        seq: seq as TwinRevisionSeq,
        observedAt,
        appliedAt: observedAt + 1,
        source: "observation",
        attributes,
      },
    ],
    lastSeq: seq as TwinRevisionSeq,
    lastObservedAt: observedAt,
  };
}

function finding(
  deviceId: string,
  code: string,
  severity: Finding["severity"],
  observedAt: number,
): Finding {
  return {
    deviceId,
    code,
    severity,
    observedAt,
    evidence: [{ digest: digest(code), kind: code, observedAt }],
  };
}

function observation(deviceId: string, seq: number, observedAt: number, kind: string): Observation {
  return {
    id: `obs_${deviceId.slice(4)}_${seq}` as ObservationId,
    tenantId: TENANT,
    deviceId: deviceId as DeviceId,
    seq: seq as ObservationSeq,
    observedAt,
    kind,
    payloadDigest: digest(`${deviceId}:${seq}`),
    admittedAt: observedAt + 1,
  };
}

const BASE_ASSETS: readonly ManagedAsset[] = [
  {
    id: "ast_bulldozer" as AssetId,
    tenantId: TENANT,
    kind: "vehicle",
    displayName: "Bulldozer 7",
    lifecycle: "active",
    createdAt: NOW - 90 * DAY_MS,
  },
  {
    id: "ast_handheld01" as AssetId,
    tenantId: TENANT,
    kind: "handheld",
    displayName: "Field Tablet 12",
    lifecycle: "active",
    createdAt: NOW - 30 * DAY_MS,
  },
  {
    id: "ast_sensor09" as AssetId,
    tenantId: TENANT,
    kind: "sensor",
    displayName: "Moisture Sensor 9",
    lifecycle: "admitted",
    createdAt: NOW - 3 * DAY_MS,
  },
];

const BASE_DEVICES: readonly Device[] = [
  { id: "dev_bulldoz7" as DeviceId, tenantId: TENANT, assetId: "ast_bulldozer" as AssetId, serial: "SN-BD-7", enrolledAt: NOW - 89 * DAY_MS },
  { id: "dev_tablet12" as DeviceId, tenantId: TENANT, assetId: "ast_handheld01" as AssetId, serial: "SN-FT-12", enrolledAt: NOW - 29 * DAY_MS },
  { id: "dev_sensor09a" as DeviceId, tenantId: TENANT, assetId: "ast_sensor09" as AssetId, serial: "SN-MS-9A", enrolledAt: NOW - 2 * DAY_MS },
  { id: "dev_sensor09b" as DeviceId, tenantId: TENANT, assetId: "ast_sensor09" as AssetId, serial: "SN-MS-9B", enrolledAt: NOW - 2 * DAY_MS },
];

const BASE_TWINS: readonly DeviceTwin[] = [
  twin("dev_bulldoz7", 41, NOW - 10_000, {
    fuelLevel: 0.42,
    engineTemp: 91,
    operatorContact: "+15550100",
    location: "site-A",
    nestedConfig: { secret: "never-leak" },
  }),
  twin("dev_tablet12", 12, NOW - 120_000, {
    battery: 76,
    operatorContact: "+15550111",
    location: "site-B",
  }),
  twin("dev_sensor09a", 7, NOW - 400_000, { moisture: 0.31 }),
];

const BASE_FINDINGS: readonly Finding[] = [
  finding("dev_bulldoz7", "engine.overheat.fault", "critical", NOW - 4_000),
  finding("dev_bulldoz7", "engine.temp.warn", "warning", NOW - 5_000),
  finding("dev_tablet12", "battery.low.warn", "warning", NOW - 100_000),
  finding("dev_sensor09a", "link.drop.warn", "warning", NOW - 390_000),
];

const BASE_OBSERVATIONS: readonly Observation[] = [
  observation("dev_bulldoz7", 40, NOW - 20_000, "telemetry.ok"),
  observation("dev_bulldoz7", 41, NOW - 10_000, "telemetry.ok"),
  observation("dev_tablet12", 12, NOW - 120_000, "telemetry.ok"),
  observation("dev_sensor09a", 7, NOW - 400_000, "moisture.ok"),
];

const BASE_CASES: readonly RecoveryCase[] = [
  {
    id: "rc_bulldoz01" as RecoveryCaseId,
    tenantId: TENANT,
    deviceId: "dev_bulldoz7",
    state: "investigating",
    openedAt: NOW - 3_600_000,
    evidence: [{ digest: digest("rc1") }],
    history: [{ from: "open", to: "investigating", command: "investigate", at: NOW - 3_000_000 }],
  },
  {
    id: "rc_tablet01" as RecoveryCaseId,
    tenantId: TENANT,
    deviceId: "dev_tablet12",
    state: "proposal",
    openedAt: NOW - 7_200_000,
    evidence: [{ digest: digest("rc2") }],
    history: [
      { from: "open", to: "investigating", command: "investigate", at: NOW - 6_000_000 },
      { from: "investigating", to: "proposal", command: "propose", at: NOW - 2_000_000 },
    ],
  },
  {
    id: "rc_sensor01" as RecoveryCaseId,
    tenantId: TENANT,
    deviceId: "dev_sensor09a",
    state: "resolved",
    openedAt: NOW - 9_000_000,
    evidence: [{ digest: digest("rc3") }],
    history: [
      { from: "proposal", to: "resolved", command: "resolve", at: NOW - 1_000_000 },
    ],
    resolution: { rootCause: "replaced cable", resolvedAt: NOW - 1_000_000 },
  },
  {
    id: "rc_sensor02" as RecoveryCaseId,
    tenantId: TENANT,
    deviceId: "dev_sensor09a",
    state: "closed",
    openedAt: NOW - 20 * DAY_MS,
    evidence: [],
    history: [{ from: "resolved", to: "closed", command: "close", at: NOW - 15 * DAY_MS }],
  },
];

const BASE_PLANS: readonly ServicePlan[] = [
  {
    id: "plan_bulldoz_svc" as ServicePlanId,
    tenantId: TENANT,
    assetId: "ast_bulldozer" as AssetId,
    kind: "preventive",
    schedule: { kind: "recurring", intervalMs: DAY_MS, startsAt: NOW - 5 * DAY_MS },
    createdAt: NOW - 80 * DAY_MS,
  },
  {
    id: "plan_handheld_chk" as ServicePlanId,
    tenantId: TENANT,
    assetId: "ast_handheld01" as AssetId,
    kind: "corrective",
    schedule: { kind: "one-time", at: NOW + 3_600_000 },
    createdAt: NOW - 2 * DAY_MS,
  },
  {
    id: "plan_sensor_cal" as ServicePlanId,
    tenantId: TENANT,
    assetId: "ast_sensor09" as AssetId,
    kind: "predictive",
    schedule: {
      kind: "recurring",
      intervalMs: 7 * DAY_MS,
      startsAt: NOW - 43_200_000,
      endsAt: NOW + 35 * DAY_MS,
    },
    createdAt: NOW - 40 * DAY_MS,
  },
];

const BASE_ORDERS: readonly MaintenanceOrder[] = [
  {
    id: "mo_bulldoz_q1" as MaintenanceOrderId,
    tenantId: TENANT,
    planId: "plan_bulldoz_svc" as ServicePlanId,
    state: "scheduled",
    createdAt: NOW - 100_000,
    assignedTo: "crew-3",
  },
  {
    id: "mo_tablet_fix" as MaintenanceOrderId,
    tenantId: TENANT,
    planId: "plan_handheld_chk" as ServicePlanId,
    state: "in-progress",
    createdAt: NOW - 200_000,
  },
  {
    id: "mo_sensor_cal" as MaintenanceOrderId,
    tenantId: TENANT,
    planId: "plan_sensor_cal" as ServicePlanId,
    state: "completed",
    createdAt: NOW - 500_000,
  },
  {
    id: "mo_bulldoz_q0" as MaintenanceOrderId,
    tenantId: TENANT,
    planId: "plan_bulldoz_svc" as ServicePlanId,
    state: "cancelled",
    createdAt: NOW - 50_000,
    cancelledReason: "superseded",
  },
];

const BASE_CONNECTIVITY: readonly TenantStatusRecord[] = [
  { tenantId: TENANT, deviceId: "dev_bulldoz7", state: "online", observedAt: NOW - 5_000 },
  { tenantId: TENANT, deviceId: "dev_tablet12", state: "online", observedAt: NOW - 100_000 },
  { tenantId: TENANT, deviceId: "dev_sensor09a", state: "offline", observedAt: NOW - 10_000 },
];

/** A deep-cloned base state slice tests can mutate freely. */
export function makeState(): MutableExperienceState {
  return structuredClone({
    tenantId: TENANT,
    assets: BASE_ASSETS,
    devices: BASE_DEVICES,
    twins: BASE_TWINS,
    observations: BASE_OBSERVATIONS,
    findings: BASE_FINDINGS,
    recoveryCases: BASE_CASES,
    plans: BASE_PLANS,
    orders: BASE_ORDERS,
    connectivity: BASE_CONNECTIVITY,
  }) as MutableExperienceState;
}

/** The same slice with every record array reversed — order-independence. */
export function makeReversedState(): ExperienceStateSlice {
  const state = makeState();
  return {
    ...state,
    assets: [...state.assets].reverse(),
    devices: [...state.devices].reverse(),
    twins: [...state.twins].reverse(),
    observations: [...state.observations].reverse(),
    findings: [...state.findings].reverse(),
    recoveryCases: [...state.recoveryCases].reverse(),
    plans: [...state.plans].reverse(),
    orders: [...state.orders].reverse(),
    connectivity: [...state.connectivity].reverse(),
  };
}
