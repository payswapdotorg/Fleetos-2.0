/**
 * @fleetos/assets — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * Owns (per spec/BOUNDED-CONTEXTS.md "Assets"):
 *   - managed assets, devices, device twins, lifecycle, capabilities,
 *     asset lineage references.
 *
 * Observations are immutable inputs; Assets owns the canonical durable twin
 * projection (A2). The Device Twin is authoritative durable operational
 * state; predictive twins are advisory.
 *
 * Cross-worker seam: uses structural `TenantIdLike` instead of importing
 * @fleetos/identity. Uses structural `ObservationRefLike` instead of
 * importing @fleetos/observations.
 */

// ---------------------------------------------------------------------------
// Structural seam types (cross-worker)
// ---------------------------------------------------------------------------

export type TenantIdLike = string;
export type DeviceIdLike = string;
export interface ObservationRefLike {
  readonly deviceId: DeviceIdLike;
  readonly seq: number;
  readonly observedAt: number;
  readonly payloadDigest: string;
}

// ---------------------------------------------------------------------------
// Branded ids — local to Assets context
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type AssetId = Brand<string, "AssetId">;
export type DeviceId = Brand<string, "DeviceId"> & DeviceIdLike;
export type TwinRevisionSeq = Brand<number, "TwinRevisionSeq">;

const ASSET_ID_RE = /^ast_[A-Za-z0-9_-]{4,128}$/;
const DEVICE_ID_RE = /^dev_[A-Za-z0-9_-]{4,128}$/;

export const isAssetId = (v: string): v is AssetId =>
  typeof v === "string" && ASSET_ID_RE.test(v);
export const isDeviceId = (v: string): v is DeviceId =>
  typeof v === "string" && DEVICE_ID_RE.test(v);

// ---------------------------------------------------------------------------
// Lifecycle vocabulary (admit / retire)
// ---------------------------------------------------------------------------

export type AssetLifecycleState = "admitted" | "active" | "retired";
export type AssetLifecycleCommand = "admit" | "activate" | "retire";

export type AssetTransitionRejectionCode =
  | "illegal-transition"
  | "already-in-target-state"
  | "unknown-command";

export type AssetTransitionResult =
  | { readonly ok: true; readonly from: AssetLifecycleState; readonly to: AssetLifecycleState }
  | { readonly ok: false; readonly reason: AssetTransitionRejectionCode };

const ASSET_TRANSITIONS: Readonly<Record<
  AssetLifecycleState,
  Partial<Record<AssetLifecycleCommand, AssetLifecycleState>>
>> = {
  admitted: { activate: "active", retire: "retired" },
  active: { retire: "retired" },
  retired: {},
};

export function evaluateAssetTransition(
  current: AssetLifecycleState,
  command: AssetLifecycleCommand,
): AssetTransitionResult {
  const known: ReadonlyArray<AssetLifecycleCommand> = ["admit", "activate", "retire"];
  if (!known.includes(command)) return { ok: false, reason: "unknown-command" };
  const next = ASSET_TRANSITIONS[current]?.[command];
  if (next === undefined) {
    if (command === "admit" && current !== "admitted") {
      // admit is the implicit creation; "re-admit" is illegal.
      return { ok: false, reason: "already-in-target-state" };
    }
    return { ok: false, reason: "illegal-transition" };
  }
  return { ok: true, from: current, to: next };
}

// ---------------------------------------------------------------------------
// ManagedAsset / Device / DeviceTwin
// ---------------------------------------------------------------------------

export type AssetKind = "vehicle" | "handheld" | "fixed" | "sensor" | "robot" | "other";

export interface ManagedAsset {
  readonly id: AssetId;
  readonly tenantId: TenantIdLike;
  readonly kind: AssetKind;
  readonly displayName: string;
  readonly lifecycle: AssetLifecycleState;
  readonly createdAt: number;
}

export interface Device {
  readonly id: DeviceId;
  readonly tenantId: TenantIdLike;
  readonly assetId: AssetId;
  readonly serial: string;
  readonly enrolledAt: number;
}

// Append-only twin revision — each revision is an immutable entry; the
// `DeviceTwin.revisions` array is only ever appended to, never mutated.
export interface TwinRevision {
  readonly seq: TwinRevisionSeq;
  readonly observedAt: number;
  readonly appliedAt: number;
  readonly source: "observation" | "manual";
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly observationRef?: ObservationRefLike;
}

export interface DeviceTwin {
  readonly deviceId: DeviceId;
  readonly tenantId: TenantIdLike;
  readonly revisions: ReadonlyArray<TwinRevision>;
  readonly lastSeq: TwinRevisionSeq;
  readonly lastObservedAt: number;
}

// ---------------------------------------------------------------------------
// applyTwinRevision — pure reducer enforcing append-only, monotonic seq.
//
//   - seq MUST be strictly greater than the current lastSeq (monotonic).
//   - observedAt MUST be >= current lastObservedAt (no time-travel).
//   - On rejection, returns a stable reason code; the input twin is never
//     mutated (revisions array untouched).
// ---------------------------------------------------------------------------

export type TwinRevisionRejectionCode =
  | "unknown-device"
  | "non-monotonic-seq"
  | "stale-observed-at"
  | "malformed-attributes";

export interface TwinRevisionInput {
  readonly deviceId: DeviceId;
  readonly tenantId: TenantIdLike;
  readonly seq: number;
  readonly observedAt: number;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly source: "observation" | "manual";
  readonly observationRef?: ObservationRefLike;
  readonly appliedAt: number;
}

export type TwinRevisionResult =
  | { readonly ok: true; readonly twin: DeviceTwin }
  | { readonly ok: false; readonly reason: TwinRevisionRejectionCode };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function applyTwinRevision(
  current: DeviceTwin | null,
  input: TwinRevisionInput,
): TwinRevisionResult {
  if (typeof input.deviceId !== "string" || input.deviceId === "") {
    return { ok: false, reason: "unknown-device" };
  }
  if (!isPlainObject(input.attributes)) {
    return { ok: false, reason: "malformed-attributes" };
  }

  // First revision: bootstrap a new twin.
  if (current === null) {
    if (!Number.isFinite(input.seq) || input.seq < 1) {
      return { ok: false, reason: "non-monotonic-seq" };
    }
    if (!Number.isFinite(input.observedAt) || input.observedAt <= 0) {
      return { ok: false, reason: "stale-observed-at" };
    }
    const seq = input.seq as TwinRevisionSeq;
    const revision: TwinRevision = {
      seq,
      observedAt: input.observedAt,
      appliedAt: input.appliedAt,
      source: input.source,
      attributes: input.attributes,
      observationRef: input.observationRef,
    };
    const twin: DeviceTwin = {
      deviceId: input.deviceId,
      tenantId: input.tenantId,
      revisions: [revision],
      lastSeq: seq,
      lastObservedAt: input.observedAt,
    };
    return { ok: true, twin };
  }

  // Append-only: seq MUST strictly exceed current.lastSeq.
  if (!Number.isFinite(input.seq) || input.seq <= current.lastSeq) {
    return { ok: false, reason: "non-monotonic-seq" };
  }
  // Time-travel protection: observedAt MUST not regress.
  if (!Number.isFinite(input.observedAt) || input.observedAt < current.lastObservedAt) {
    return { ok: false, reason: "stale-observed-at" };
  }

  const seq = input.seq as TwinRevisionSeq;
  const revision: TwinRevision = {
    seq,
    observedAt: input.observedAt,
    appliedAt: input.appliedAt,
    source: input.source,
    attributes: input.attributes,
    observationRef: input.observationRef,
  };

  // Append-only contract: build a new array containing prior revisions + new.
  const twin: DeviceTwin = {
    deviceId: current.deviceId,
    tenantId: current.tenantId,
    revisions: [...current.revisions, revision],
    lastSeq: seq,
    lastObservedAt: input.observedAt,
  };
  return { ok: true, twin };
}

// Helper: read latest attributes (pure projection).
export function latestAttributes(twin: DeviceTwin): Readonly<Record<string, unknown>> {
  const last = twin.revisions[twin.revisions.length - 1];
  return last?.attributes ?? {};
}
