/**
 * @fleetos/experience-asset-field — the tenant-scoped state slice.
 *
 * The experience plane sits ABOVE the domain kernel (ARCHITECTURE-LOCK):
 * it projects READ-ONLY views over the lane's public domain state. Every
 * record type is consumed from the owning package's PUBLIC entry point
 * (type-only imports; the identity validator is the one runtime reuse).
 *
 * TENANT FAIL-CLOSED (A8): `guardExperienceState` refuses the WHOLE
 * assembly — no partial state — when:
 *   - `now` is not a finite positive logical time            -> invalid-now
 *   - the slice tenant is empty / malformed                  -> missing-tenant / malformed-tenant-id
 *   - any record belongs to another tenant                   -> cross-tenant-ref (names the offender)
 *   - a record references an unknown asset/device/plan       -> unknown-*-ref (names the offender)
 *   - two records claim the same identity                    -> duplicate-ref
 *
 * Findings carry no tenant of their own (health contracts are
 * device-keyed); their tenant association is PROVEN via the device
 * directory — a finding for a device outside this tenant's directory is
 * refused as `unknown-device-ref`, never assumed in-tenant.
 */

import { isTenantId } from "@fleetos/identity";
import type { TenantIdLike } from "@fleetos/tenancy";
import type { Device, DeviceTwin, ManagedAsset } from "@fleetos/assets";
import type { Observation } from "@fleetos/observations";
import type { Finding } from "@fleetos/health";
import type { RecoveryCase } from "@fleetos/recovery";
import type { MaintenanceOrder, ServicePlan } from "@fleetos/maintenance";
import type { TenantStatusRecord } from "@fleetos/connectivity";

/** A tenant's edge/asset domain state, as projected into experiences. */
export interface ExperienceStateSlice {
  readonly tenantId: TenantIdLike;
  readonly assets: readonly ManagedAsset[];
  readonly devices: readonly Device[];
  readonly twins: readonly DeviceTwin[];
  readonly observations: readonly Observation[];
  readonly findings: readonly Finding[];
  readonly recoveryCases: readonly RecoveryCase[];
  readonly plans: readonly ServicePlan[];
  readonly orders: readonly MaintenanceOrder[];
  readonly connectivity: readonly TenantStatusRecord[];
}

export type StateRejection =
  | "invalid-now"
  | "missing-tenant"
  | "malformed-tenant-id"
  | "cross-tenant-ref"
  | "unknown-asset-ref"
  | "unknown-device-ref"
  | "unknown-plan-ref"
  | "duplicate-ref";

export type StateGuard =
  | { readonly ok: true }
  | { readonly ok: false; readonly rejected: StateRejection; readonly detail: string };

function refuse(
  rejected: StateRejection,
  detail: string,
): { readonly ok: false; readonly rejected: StateRejection; readonly detail: string } {
  return { ok: false, rejected, detail };
}

/**
 * Validate the whole slice against the tenant boundary before any view is
 * assembled. Checks run in a fixed order (records: assets, devices, twins,
 * observations, findings, recovery cases, plans, orders, connectivity) so
 * refusals are deterministic; the FIRST violation wins and names the
 * offender record.
 */
export function guardExperienceState(
  state: ExperienceStateSlice,
  now: number,
): StateGuard {
  if (!Number.isFinite(now) || now <= 0) {
    return refuse("invalid-now", `logical now must be finite and positive, got ${String(now)}`);
  }
  const tenantId = state.tenantId;
  if (tenantId === "") {
    return refuse("missing-tenant", "state slice tenant identifier is empty");
  }
  if (!isTenantId(tenantId)) {
    return refuse("malformed-tenant-id", `tenant identifier ${tenantId} fails the tnt_ format`);
  }

  const assetIds = new Set<string>();
  for (const asset of state.assets) {
    if (asset.tenantId !== tenantId) {
      return refuse(
        "cross-tenant-ref",
        `asset ${asset.id} belongs to tenant ${asset.tenantId}, not ${tenantId}`,
      );
    }
    if (assetIds.has(asset.id)) {
      return refuse("duplicate-ref", `two assets claim id ${asset.id}`);
    }
    assetIds.add(asset.id);
  }

  const deviceIds = new Set<string>();
  for (const device of state.devices) {
    if (device.tenantId !== tenantId) {
      return refuse(
        "cross-tenant-ref",
        `device ${device.id} belongs to tenant ${device.tenantId}, not ${tenantId}`,
      );
    }
    if (!assetIds.has(device.assetId)) {
      return refuse(
        "unknown-asset-ref",
        `device ${device.id} references unknown asset ${device.assetId}`,
      );
    }
    if (deviceIds.has(device.id)) {
      return refuse("duplicate-ref", `two devices claim id ${device.id}`);
    }
    deviceIds.add(device.id);
  }

  const twinDevices = new Set<string>();
  for (const twin of state.twins) {
    if (twin.tenantId !== tenantId) {
      return refuse(
        "cross-tenant-ref",
        `twin for device ${twin.deviceId} belongs to tenant ${twin.tenantId}, not ${tenantId}`,
      );
    }
    if (!deviceIds.has(twin.deviceId)) {
      return refuse(
        "unknown-device-ref",
        `twin references unknown device ${twin.deviceId}`,
      );
    }
    if (twinDevices.has(twin.deviceId)) {
      return refuse("duplicate-ref", `two twins claim device ${twin.deviceId}`);
    }
    twinDevices.add(twin.deviceId);
  }

  for (const observation of state.observations) {
    if (observation.tenantId !== tenantId) {
      return refuse(
        "cross-tenant-ref",
        `observation ${observation.id} belongs to tenant ${observation.tenantId}, not ${tenantId}`,
      );
    }
    if (!deviceIds.has(observation.deviceId)) {
      return refuse(
        "unknown-device-ref",
        `observation ${observation.id} references unknown device ${observation.deviceId}`,
      );
    }
  }

  for (const finding of state.findings) {
    // Findings are device-keyed; tenant association is PROVEN via the
    // device directory — never assumed.
    if (!deviceIds.has(finding.deviceId)) {
      return refuse(
        "unknown-device-ref",
        `finding ${finding.code} targets device ${finding.deviceId} outside the tenant device directory`,
      );
    }
  }

  for (const recoveryCase of state.recoveryCases) {
    if (recoveryCase.tenantId !== tenantId) {
      return refuse(
        "cross-tenant-ref",
        `recovery case ${recoveryCase.id} belongs to tenant ${recoveryCase.tenantId}, not ${tenantId}`,
      );
    }
    if (!deviceIds.has(recoveryCase.deviceId)) {
      return refuse(
        "unknown-device-ref",
        `recovery case ${recoveryCase.id} references unknown device ${recoveryCase.deviceId}`,
      );
    }
  }

  const planIds = new Set<string>();
  for (const plan of state.plans) {
    if (plan.tenantId !== tenantId) {
      return refuse(
        "cross-tenant-ref",
        `service plan ${plan.id} belongs to tenant ${plan.tenantId}, not ${tenantId}`,
      );
    }
    if (!assetIds.has(plan.assetId)) {
      return refuse(
        "unknown-asset-ref",
        `service plan ${plan.id} references unknown asset ${plan.assetId}`,
      );
    }
    if (planIds.has(plan.id)) {
      return refuse("duplicate-ref", `two service plans claim id ${plan.id}`);
    }
    planIds.add(plan.id);
  }

  for (const order of state.orders) {
    if (order.tenantId !== tenantId) {
      return refuse(
        "cross-tenant-ref",
        `maintenance order ${order.id} belongs to tenant ${order.tenantId}, not ${tenantId}`,
      );
    }
    if (!planIds.has(order.planId)) {
      return refuse(
        "unknown-plan-ref",
        `maintenance order ${order.id} references unknown plan ${order.planId}`,
      );
    }
  }

  for (const record of state.connectivity) {
    if (record.tenantId !== tenantId) {
      return refuse(
        "cross-tenant-ref",
        `connectivity record for device ${record.deviceId} belongs to tenant ${record.tenantId}, not ${tenantId}`,
      );
    }
    if (!deviceIds.has(record.deviceId)) {
      return refuse(
        "unknown-device-ref",
        `connectivity record references unknown device ${record.deviceId}`,
      );
    }
  }

  return { ok: true };
}
