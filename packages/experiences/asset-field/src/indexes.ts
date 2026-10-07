/**
 * @fleetos/experience-asset-field — deterministic state indexes.
 *
 * Read-model support: after the state guard passes, build the lookup maps
 * every view projection walks. All lists are deterministically ordered at
 * build time (devices by id; findings by severity rank then code then
 * observedAt; observations by observedAt then seq; orders by createdAt
 * then id) so views never depend on input order.
 */

import type { Device, DeviceTwin, ManagedAsset } from "@fleetos/assets";
import type { Finding, Severity } from "@fleetos/health";
import type { Observation } from "@fleetos/observations";
import type { MaintenanceOrder, ServicePlan } from "@fleetos/maintenance";
import type { RecoveryCase } from "@fleetos/recovery";
import type { TenantStatusRecord } from "@fleetos/connectivity";
import type { ExperienceStateSlice } from "./state.js";

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export interface StateIndexes {
  readonly assetById: ReadonlyMap<string, ManagedAsset>;
  readonly deviceById: ReadonlyMap<string, Device>;
  /** Deterministically ordered (deviceId asc). */
  readonly devicesByAsset: ReadonlyMap<string, readonly Device[]>;
  readonly twinByDevice: ReadonlyMap<string, DeviceTwin>;
  /** Severity rank, then code, then observedAt. */
  readonly findingsByDevice: ReadonlyMap<string, readonly Finding[]>;
  /** observedAt asc, then seq asc. */
  readonly observationsByDevice: ReadonlyMap<string, readonly Observation[]>;
  readonly caseById: ReadonlyMap<string, RecoveryCase>;
  /** openedAt asc, then caseId asc. */
  readonly recoveryCasesByDevice: ReadonlyMap<string, readonly RecoveryCase[]>;
  readonly planById: ReadonlyMap<string, ServicePlan>;
  readonly plansByAsset: ReadonlyMap<string, readonly ServicePlan[]>;
  /** createdAt asc, then orderId asc. */
  readonly ordersByPlan: ReadonlyMap<string, readonly MaintenanceOrder[]>;
  readonly connectivityByDevice: ReadonlyMap<string, TenantStatusRecord>;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

/** Build the deterministic lookup indexes over a guarded state slice. */
export function buildStateIndexes(state: ExperienceStateSlice): StateIndexes {
  const assetById = new Map<string, ManagedAsset>();
  for (const asset of [...state.assets].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    assetById.set(asset.id, asset);
  }

  const deviceById = new Map<string, Device>();
  const devicesByAsset = new Map<string, Device[]>();
  for (const device of [...state.devices].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    deviceById.set(device.id, device);
    pushTo(devicesByAsset, device.assetId, device);
  }

  const twinByDevice = new Map<string, DeviceTwin>();
  for (const twin of state.twins) {
    // First twin wins deterministically (a well-formed slice has one twin
    // per device; the guard's duplicate discipline keeps this stable).
    if (!twinByDevice.has(twin.deviceId)) twinByDevice.set(twin.deviceId, twin);
  }

  const findingsByDevice = new Map<string, Finding[]>();
  for (const finding of [...state.findings].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.observedAt - b.observedAt;
  })) {
    pushTo(findingsByDevice, finding.deviceId, finding);
  }

  const observationsByDevice = new Map<string, Observation[]>();
  for (const observation of [...state.observations].sort((a, b) => {
    if (a.observedAt !== b.observedAt) return a.observedAt - b.observedAt;
    return a.seq - b.seq;
  })) {
    pushTo(observationsByDevice, observation.deviceId, observation);
  }

  const caseById = new Map<string, RecoveryCase>();
  const recoveryCasesByDevice = new Map<string, RecoveryCase[]>();
  for (const recoveryCase of [...state.recoveryCases].sort((a, b) => {
    if (a.openedAt !== b.openedAt) return a.openedAt - b.openedAt;
    return a.id < b.id ? -1 : 1;
  })) {
    caseById.set(recoveryCase.id, recoveryCase);
    pushTo(recoveryCasesByDevice, recoveryCase.deviceId, recoveryCase);
  }

  const planById = new Map<string, ServicePlan>();
  const plansByAsset = new Map<string, ServicePlan[]>();
  for (const plan of [...state.plans].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    planById.set(plan.id, plan);
    pushTo(plansByAsset, plan.assetId, plan);
  }

  const ordersByPlan = new Map<string, MaintenanceOrder[]>();
  for (const order of [...state.orders].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id < b.id ? -1 : 1;
  })) {
    pushTo(ordersByPlan, order.planId, order);
  }

  const connectivityByDevice = new Map<string, TenantStatusRecord>();
  for (const record of state.connectivity) {
    const current = connectivityByDevice.get(record.deviceId);
    // Latest observation wins (deterministic read-model semantic);
    // exact observedAt ties break by lowest state string.
    if (
      !current ||
      record.observedAt > current.observedAt ||
      (record.observedAt === current.observedAt && record.state < current.state)
    ) {
      connectivityByDevice.set(record.deviceId, record);
    }
  }

  return {
    assetById,
    deviceById,
    devicesByAsset,
    twinByDevice,
    findingsByDevice,
    observationsByDevice,
    caseById,
    recoveryCasesByDevice,
    planById,
    plansByAsset,
    ordersByPlan,
    connectivityByDevice,
  };
}
