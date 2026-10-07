/**
 * @fleetos/adcos — Wave 3 edge-grade adapter (F230A).
 *
 * The F220A `posture.ts` shipped provider-degradation posture + a circuit
 * breaker. F230A advances to the EDGE-grade adapter: a typed error
 * taxonomy (transient vs permanent) with per-error retry policies, and
 * normalization at the boundary with digests. The edge adapter wraps a
 * base AdcosProviderPort and applies:
 *
 *   - **typed error classification** — every failure is mapped to
 *     `transient` (retryable: provider-unavailable, rate-limited) or
 *     `permanent` (not retryable: device-not-found, command-unsupported,
 *     missing-tenant-id, missing-device-id).
 *   - **retry policy** — transient failures are retried up to `maxAttempts`
 *     with exponential backoff (computed as a pure function of attempt
 *     number, not via real timers). Permanent failures short-circuit.
 *   - **boundary normalization** — every external result is normalized to
 *     a typed `EdgeAdcosResult` with a content-addressed digest over the
 *     (tenantId, deviceId, kind, result) tuple. The digest lets the
 *     caller dedup at the boundary.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type {
  AdcosCommand,
  AdcosHealth,
  AdcosProviderPort,
  AdcosRejection,
  AdcosRejectionCode,
  AdcosResult,
  AdcosSuccess,
  DeviceIdLike,
  TenantIdLike,
} from "./adcos.js";
import type { AuditEventRef } from "./kernel.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Typed error taxonomy — transient vs permanent.
//
// Transient errors MAY be retried (the failure mode is environmental).
// Permanent errors MUST NOT be retried (the failure mode is structural).
// ---------------------------------------------------------------------------

export type EdgeAdcosErrorClass = "transient" | "permanent";

export interface TypedEdgeError {
  readonly code: AdcosRejectionCode;
  readonly class: EdgeAdcosErrorClass;
  readonly retryable: boolean; // derived from class but explicit for the caller
  readonly message: string;
}

const ERROR_CLASS: Readonly<Record<AdcosRejectionCode, EdgeAdcosErrorClass>> = {
  "provider-unavailable": "transient",
  "rate-limited": "transient",
  "unknown-error": "transient", // unknown is conservatively transient (retry to learn more)
  "device-not-found": "permanent",
  "command-unsupported": "permanent",
  "missing-tenant-id": "permanent",
  "missing-device-id": "permanent",
};

export function classifyAdcosError(code: AdcosRejectionCode): TypedEdgeError {
  const cls = ERROR_CLASS[code] ?? "transient";
  return {
    code,
    class: cls,
    retryable: cls === "transient",
    message: errorMessage(code),
  };
}

function errorMessage(code: AdcosRejectionCode): string {
  switch (code) {
    case "provider-unavailable": return "ADCOS provider is currently unavailable";
    case "rate-limited": return "ADCOS provider rate-limited the request";
    case "unknown-error": return "ADCOS provider returned an unknown error";
    case "device-not-found": return "Device is not registered with the ADCOS provider";
    case "command-unsupported": return "Command kind is not supported by the ADCOS provider";
    case "missing-tenant-id": return "Tenant id is required at the boundary";
    case "missing-device-id": return "Device id is required at the boundary";
  }
}

// ---------------------------------------------------------------------------
// Retry policy — pure functions of attempt number.
//
// `computeBackoffMs` returns the delay for attempt N (1-indexed). The
// policy is exponential with optional jitter factor (deterministic given
// the same seed; real production would use a CSPRNG, but the kernel
// exposes the policy, not the RNG).
// ---------------------------------------------------------------------------

export interface EdgeAdcosRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffFactor: number; // e.g., 2 = exponential
}

export function defaultRetryPolicy(): EdgeAdcosRetryPolicy {
  return { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5_000, backoffFactor: 2 };
}

export function computeBackoffMs(
  policy: EdgeAdcosRetryPolicy,
  attempt: number, // 1-indexed
): number {
  if (attempt < 1) return 0;
  const raw = policy.baseDelayMs * Math.pow(policy.backoffFactor, attempt - 1);
  return Math.min(raw, policy.maxDelayMs);
}

// Decide whether to retry given the current attempt count and the typed error.
export function shouldRetry(
  policy: EdgeAdcosRetryPolicy,
  attempt: number,
  error: TypedEdgeError,
): boolean {
  if (!error.retryable) return false;
  return attempt < policy.maxAttempts;
}

// ---------------------------------------------------------------------------
// Boundary normalization — every external result is normalized to a typed
// EdgeAdcosResult with a content-addressed digest.
// ---------------------------------------------------------------------------

export interface EdgeAdcosSuccess {
  readonly ok: true;
  readonly digest: string; // sha-256 over (tenantId, deviceId, kind, requestId, result)
  readonly normalized: Readonly<Record<string, unknown>>;
  readonly requestId: string;
  readonly degraded: boolean; // true if the upstream reported degraded
}

export interface EdgeAdcosFailure {
  readonly ok: false;
  readonly error: TypedEdgeError;
  readonly digest: string; // sha-256 over (tenantId, deviceId, kind, code)
}

export type EdgeAdcosResult = EdgeAdcosSuccess | EdgeAdcosFailure;

export function normalizeSuccess(
  command: AdcosCommand,
  success: AdcosSuccess,
): EdgeAdcosSuccess {
  const degraded = Boolean(success.result.degraded);
  const digest = digestOf(
    command.tenantId,
    command.deviceId,
    command.kind,
    success.requestId,
    JSON.stringify(success.result),
  );
  return {
    ok: true,
    digest,
    normalized: { ...success.result, degraded },
    requestId: success.requestId,
    degraded,
  };
}

export function normalizeFailure(
  command: AdcosCommand,
  rejection: AdcosRejection,
): EdgeAdcosFailure {
  const error = classifyAdcosError(rejection.reason);
  const digest = digestOf(
    command.tenantId,
    command.deviceId,
    command.kind,
    rejection.reason,
  );
  return { ok: false, error, digest };
}

// ---------------------------------------------------------------------------
// EdgeAdcosAdapter — wraps a base AdcosProviderPort. The adapter applies
// the retry policy to transient failures and normalizes every result at
// the boundary. The adapter does NOT own business truth; it only translates
// between the external ADCOS vocabulary and the FleetOS edge vocabulary.
//
// The adapter is pure in the sense that it doesn't hold mutable state
// across calls (each call is independent). The retry loop is bounded by
// `maxAttempts` and the caller observes every attempt via the audit trail.
// ---------------------------------------------------------------------------

export interface EdgeAdcosCallOptions {
  readonly policy?: EdgeAdcosRetryPolicy;
  readonly now: number; // injected clock — pure
  readonly sleep?: (ms: number) => Promise<void>; // injected sleeper (test: deterministic; prod: real)
}

export interface EdgeAdcosCallAudit {
  readonly attempts: ReadonlyArray<{
    readonly attempt: number;
    readonly ok: boolean;
    readonly code?: AdcosRejectionCode;
    readonly backoffMs: number;
    readonly at: number;
  }>;
  readonly finalResult: EdgeAdcosResult;
  readonly audit: AuditEventRef;
}

export class EdgeAdcosAdapter {
  constructor(private readonly base: AdcosProviderPort) {}

  async sendCommand(
    command: AdcosCommand,
    options: EdgeAdcosCallOptions,
  ): Promise<EdgeAdcosCallAudit> {
    const policy = options.policy ?? defaultRetryPolicy();
    const sleep = options.sleep ?? defaultSleep;
    type AttemptEntry = {
      readonly attempt: number;
      readonly ok: boolean;
      readonly code?: AdcosRejectionCode;
      readonly backoffMs: number;
      readonly at: number;
    };
    const attempts: AttemptEntry[] = [];
    let lastResult: EdgeAdcosResult | null = null;
    let now = options.now;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      const raw: AdcosResult = await this.base.sendCommand(command);
      if (raw.ok) {
        const normalized = normalizeSuccess(command, raw);
        attempts.push({ attempt, ok: true, backoffMs: 0, at: now });
        lastResult = normalized;
        break;
      }
      const normalized = normalizeFailure(command, raw);
      if (!shouldRetry(policy, attempt, normalized.error)) {
        attempts.push({ attempt, ok: false, code: raw.reason, backoffMs: 0, at: now });
        lastResult = normalized;
        break;
      }
      const backoff = computeBackoffMs(policy, attempt);
      attempts.push({ attempt, ok: false, code: raw.reason, backoffMs: backoff, at: now });
      lastResult = normalized;
      await sleep(backoff);
      now += backoff;
    }

    const final = lastResult!;
    const audit = makeCallAudit(command, final, attempts, now);
    return { attempts, finalResult: final, audit };
  }

  async healthCheck(): Promise<AdcosHealth> {
    return this.base.healthCheck();
  }
}

// ---------------------------------------------------------------------------
// Audit helper — produces a typed AuditEventRef for an edge-adapter call.
// ---------------------------------------------------------------------------

function makeCallAudit(
  command: AdcosCommand,
  result: EdgeAdcosResult,
  attempts: ReadonlyArray<EdgeAdcosCallAudit["attempts"][number]>,
  at: number,
): AuditEventRef {
  const intent = result.ok
    ? "adcos:edge:send:ok"
    : `adcos:edge:send:failed:${result.error.code}`;
  return {
    actor: `system:adcos-edge:${command.deviceId}`,
    intent,
    tenant: command.tenantId,
    timestamp: at,
    digest: digestOf(
      command.tenantId,
      command.deviceId,
      command.kind,
      result.digest,
      attempts.length,
      at,
    ),
  };
}

// Default sleeper — resolves after the given delay. Tests inject a no-op
// sleeper to keep the test suite deterministic and fast.
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Honest edge-grade health — combines the base provider's healthCheck with
// the adapter's posture state to produce an honest edge-grade health report.
// ---------------------------------------------------------------------------

export interface EdgeHealthReport {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly baseHealth: AdcosHealth;
  readonly edgePosture: "healthy" | "degraded" | "unavailable";
  readonly at: number;
  readonly audit: AuditEventRef;
}

export function buildEdgeHealthReport(
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
  baseHealth: AdcosHealth,
  at: number,
): EdgeHealthReport {
  // The edge posture mirrors the base health — we don't exaggerate.
  const edgePosture: EdgeHealthReport["edgePosture"] = baseHealth;
  return {
    tenantId,
    deviceId,
    baseHealth,
    edgePosture,
    at,
    audit: {
      actor: `system:adcos-edge:${deviceId}`,
      intent: `adcos:edge:health:${edgePosture}`,
      tenant: tenantId,
      timestamp: at,
      digest: digestOf(tenantId, deviceId, "edge-health", edgePosture, at),
    },
  };
}
