/**
 * @fleetos/sim-worlds — fleet world definition (F260A).
 *
 * A `FleetWorld` is the deterministic initial state of an operational
 * simulation: assets (with integer-bps failure rates per logical-time
 * unit), devices (transient dropout bps + observation streams), a
 * connectivity topology (links with uptime bps), maintenance policies
 * (windows + service levels + MTBF preventive scheduling) and initial
 * health postures.
 *
 * Laws:
 *  - world digest (FNV-1a lane convention) + verify — tamper-evident;
 *  - validation is fail-closed: zero/negative or out-of-bounds rates are
 *    REFUSED with reason codes, tenant is mandatory, every reference
 *    must resolve, arrays must be deterministically ordered (sorted by
 *    id) so the digest is canonical;
 *  - pure deterministic TS — logical `now`, caller-supplied inputs only.
 *
 * Structural types are LOCAL (no cross-package imports): observation
 * streams mirror the observations package's admission inputs, postures
 * mirror the health vocabulary, as the packet's seam note allows.
 */

import { canonicalJson, fnv1a32 } from "./determinism.js";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Health posture trajectory states (structural mirror of the health
 * lane's severity vocabulary, extended with operational states). */
export type HealthPosture = "healthy" | "degraded" | "critical" | "down";

/** Maintenance service levels — decide steps-to-repair. */
export type ServiceLevel = "basic" | "standard" | "expedited";

export const REPAIR_STEPS_BY_SERVICE_LEVEL: Readonly<Record<ServiceLevel, number>> = {
  basic: 3,
  standard: 2,
  expedited: 1,
};

/** A single observable value stream on a device. */
export interface WorldObservationStream {
  readonly kind: string;
  readonly unit: string;
  readonly baseValue: number;
  readonly jitterMinOffset: number;
  readonly jitterMaxOffset: number;
}

/** An asset — failure-rate parameters in integer bps per logical step. */
export interface WorldAsset {
  readonly assetId: string;
  readonly assetClass: string;
  /** P(asset fails this step) = failureRateBps / 10000. Integer [1,10000]. */
  readonly failureRateBps: number;
}

/** A device bound to an asset — the observable edge endpoint. */
export interface WorldDevice {
  readonly deviceId: string;
  readonly assetId: string;
  /** P(transient dropout this step) = dropoutBps / 10000. Integer [1,10000]. */
  readonly dropoutBps: number;
  /** Emit observations on steps where step % emitEverySteps === 0. ≥ 1. */
  readonly emitEverySteps: number;
  readonly streams: readonly WorldObservationStream[];
}

/** A connectivity link between two devices. */
export interface WorldLink {
  readonly linkId: string;
  readonly endpoints: readonly [string, string];
  /** P(link up this step) = uptimeBps / 10000. Integer [1,10000]. */
  readonly uptimeBps: number;
}

/** A maintenance policy for one asset. */
export interface WorldMaintenancePolicy {
  readonly policyId: string;
  readonly assetId: string;
  /** A window opens at steps s>0 with s % windowEverySteps === 0. ≥ 1. */
  readonly windowEverySteps: number;
  /** The window stays open for this many steps. [1, windowEverySteps]. */
  readonly windowLengthSteps: number;
  readonly serviceLevel: ServiceLevel;
  /** Preventive service is due once this many steps pass since the last
   * service (MTBF-style scheduling). ≥ 1. */
  readonly mtbfSteps: number;
}

/** World-level posture trajectory parameters. */
export interface WorldHealthPolicy {
  /** A failed asset's posture goes `down` after this many failed steps. ≥ 1. */
  readonly downAfterSteps: number;
  /** Posture stays `degraded` for this many steps after a repair. ≥ 1. */
  readonly recoveryGraceSteps: number;
}

export interface WorldHealthPosture {
  readonly assetId: string;
  /** `healthy`/`degraded` start operational; `critical`/`down` start failed. */
  readonly posture: HealthPosture;
}

/** The fleet world definition — the deterministic initial state. */
export interface FleetWorld {
  readonly worldId: string;
  readonly tenantId: string;
  readonly version: number;
  readonly description: string;
  /** The world's entropy seed — part of the digest; same world + seed =>
   * byte-identical trajectories. */
  readonly seed: string;
  /** Logical step duration in ms (observation `observedAt` = step × unit). ≥ 1. */
  readonly timeUnitMs: number;
  readonly healthPolicy: WorldHealthPolicy;
  readonly assets: readonly WorldAsset[];
  readonly devices: readonly WorldDevice[];
  readonly links: readonly WorldLink[];
  readonly maintenancePolicies: readonly WorldMaintenancePolicy[];
  readonly initialHealthPostures: readonly WorldHealthPosture[];
}

// ---------------------------------------------------------------------------
// Digest — FNV-1a over canonical JSON of the whole world.
// ---------------------------------------------------------------------------

export function worldDigest(world: FleetWorld): string {
  return `world_${fnv1a32(["fleet-world", world.version, canonicalJson(world)])}`;
}

export function verifyWorldDigest(world: FleetWorld, digest: string): boolean {
  return worldDigest(world) === digest;
}

/** Tenant fail-closed scope check — every engine/scenario/adapter entry. */
export function worldTenantMatches(world: FleetWorld, tenantId: string): boolean {
  return typeof tenantId === "string" && tenantId === world.tenantId;
}

// ---------------------------------------------------------------------------
// Validation — fail-closed, reason-coded, deterministic ordering enforced.
// ---------------------------------------------------------------------------

export type WorldValidationCode =
  | "missing-world-id"
  | "missing-tenant"
  | "invalid-version"
  | "missing-seed"
  | "invalid-time-unit"
  | "invalid-health-policy"
  | "empty-assets"
  | "duplicate-asset"
  | "non-deterministic-asset-order"
  | "invalid-failure-rate"
  | "missing-asset-class"
  | "duplicate-device"
  | "non-deterministic-device-order"
  | "unknown-asset-ref"
  | "invalid-dropout-rate"
  | "invalid-emit-interval"
  | "empty-streams"
  | "invalid-stream"
  | "duplicate-stream-kind"
  | "duplicate-link"
  | "non-deterministic-link-order"
  | "invalid-uptime-bps"
  | "unknown-link-endpoint"
  | "duplicate-policy"
  | "duplicate-policy-asset"
  | "non-deterministic-policy-order"
  | "invalid-window"
  | "invalid-mtbf"
  | "duplicate-posture"
  | "non-deterministic-posture-order"
  | "unknown-posture-asset"
  | "invalid-posture";

export interface WorldValidationIssue {
  readonly code: WorldValidationCode;
  readonly ref: string;
  readonly detail?: string;
}

export type WorldValidation =
  | { readonly ok: true; readonly digest: string }
  | { readonly ok: false; readonly issues: ReadonlyArray<WorldValidationIssue> };

export function validateWorld(world: FleetWorld): WorldValidation {
  const issues: WorldValidationIssue[] = [];
  const push = (code: WorldValidationCode, ref: string, detail?: string): void => {
    issues.push({ code, ref, detail });
  };

  if (!world.worldId || typeof world.worldId !== "string") push("missing-world-id", "world");
  if (!world.tenantId || typeof world.tenantId !== "string") push("missing-tenant", "world");
  if (!Number.isInteger(world.version) || world.version < 1) push("invalid-version", "world");
  if (!world.seed || typeof world.seed !== "string") push("missing-seed", "world");
  if (!Number.isInteger(world.timeUnitMs) || world.timeUnitMs < 1) push("invalid-time-unit", "world");
  const hp = world.healthPolicy;
  if (
    !hp || !Number.isInteger(hp.downAfterSteps) || hp.downAfterSteps < 1 ||
    !Number.isInteger(hp.recoveryGraceSteps) || hp.recoveryGraceSteps < 1
  ) {
    push("invalid-health-policy", "world");
  }

  if (!Array.isArray(world.assets) || world.assets.length === 0) {
    push("empty-assets", "assets");
    return { ok: false, issues };
  }

  const assetIds = new Set<string>();
  let prevAssetId = "";
  for (const a of world.assets) {
    if (assetIds.has(a.assetId)) push("duplicate-asset", a.assetId);
    assetIds.add(a.assetId);
    if (a.assetId <= prevAssetId) push("non-deterministic-asset-order", a.assetId);
    prevAssetId = a.assetId;
    if (!Number.isInteger(a.failureRateBps) || a.failureRateBps < 1 || a.failureRateBps > 10_000) {
      push("invalid-failure-rate", a.assetId, `failureRateBps=${String(a.failureRateBps)}`);
    }
    if (!a.assetClass || typeof a.assetClass !== "string") push("missing-asset-class", a.assetId);
  }

  const deviceIds = new Set<string>();
  let prevDeviceId = "";
  for (const d of world.devices) {
    if (deviceIds.has(d.deviceId)) push("duplicate-device", d.deviceId);
    deviceIds.add(d.deviceId);
    if (d.deviceId <= prevDeviceId) push("non-deterministic-device-order", d.deviceId);
    prevDeviceId = d.deviceId;
    if (!assetIds.has(d.assetId)) push("unknown-asset-ref", d.deviceId, d.assetId);
    if (!Number.isInteger(d.dropoutBps) || d.dropoutBps < 1 || d.dropoutBps > 10_000) {
      push("invalid-dropout-rate", d.deviceId, `dropoutBps=${String(d.dropoutBps)}`);
    }
    if (!Number.isInteger(d.emitEverySteps) || d.emitEverySteps < 1) {
      push("invalid-emit-interval", d.deviceId);
    }
    if (!Array.isArray(d.streams) || d.streams.length === 0) {
      push("empty-streams", d.deviceId);
      continue;
    }
    const kinds = new Set<string>();
    for (const s of d.streams) {
      if (kinds.has(s.kind)) push("duplicate-stream-kind", d.deviceId, s.kind);
      kinds.add(s.kind);
      if (
        !s.kind || !s.unit ||
        !Number.isInteger(s.baseValue) ||
        !Number.isInteger(s.jitterMinOffset) || !Number.isInteger(s.jitterMaxOffset) ||
        s.jitterMinOffset > s.jitterMaxOffset
      ) {
        push("invalid-stream", d.deviceId, s.kind);
      }
    }
  }

  let prevLinkId = "";
  const linkIds = new Set<string>();
  for (const l of world.links) {
    if (linkIds.has(l.linkId)) push("duplicate-link", l.linkId);
    linkIds.add(l.linkId);
    if (l.linkId <= prevLinkId) push("non-deterministic-link-order", l.linkId);
    prevLinkId = l.linkId;
    if (!Number.isInteger(l.uptimeBps) || l.uptimeBps < 1 || l.uptimeBps > 10_000) {
      push("invalid-uptime-bps", l.linkId, `uptimeBps=${String(l.uptimeBps)}`);
    }
    if (!deviceIds.has(l.endpoints[0]) || !deviceIds.has(l.endpoints[1])) {
      push("unknown-link-endpoint", l.linkId, l.endpoints.join("~"));
    }
  }

  let prevPolicyId = "";
  const policyIds = new Set<string>();
  const policyAssets = new Set<string>();
  for (const p of world.maintenancePolicies) {
    if (policyIds.has(p.policyId)) push("duplicate-policy", p.policyId);
    policyIds.add(p.policyId);
    if (policyAssets.has(p.assetId)) push("duplicate-policy-asset", p.assetId);
    policyAssets.add(p.assetId);
    if (p.policyId <= prevPolicyId) push("non-deterministic-policy-order", p.policyId);
    prevPolicyId = p.policyId;
    if (!assetIds.has(p.assetId)) push("unknown-asset-ref", p.policyId, p.assetId);
    if (
      !Number.isInteger(p.windowEverySteps) || p.windowEverySteps < 1 ||
      !Number.isInteger(p.windowLengthSteps) ||
      p.windowLengthSteps < 1 || p.windowLengthSteps > p.windowEverySteps
    ) {
      push("invalid-window", p.policyId);
    }
    if (!Number.isInteger(p.mtbfSteps) || p.mtbfSteps < 1) push("invalid-mtbf", p.policyId);
  }

  let prevPostureAsset = "";
  const postureAssets = new Set<string>();
  for (const h of world.initialHealthPostures) {
    if (postureAssets.has(h.assetId)) push("duplicate-posture", h.assetId);
    postureAssets.add(h.assetId);
    if (h.assetId <= prevPostureAsset) push("non-deterministic-posture-order", h.assetId);
    prevPostureAsset = h.assetId;
    if (!assetIds.has(h.assetId)) push("unknown-posture-asset", h.assetId);
    if (
      h.posture !== "healthy" && h.posture !== "degraded" &&
      h.posture !== "critical" && h.posture !== "down"
    ) {
      push("invalid-posture", h.assetId, h.posture);
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, digest: worldDigest(world) };
}
