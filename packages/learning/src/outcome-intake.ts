/**
 * @fleetos/learning — Outcome observation intake pipeline (Wave 5, F250B).
 *
 * validate -> dedupe -> correlate (by capability + window) -> classify
 * trend (`improving | stable | degrading`) — deterministic, logical-time
 * windows, tenant fail-closed.
 *
 * Laws:
 *   - Pure deterministic TS: no clock, no randomness, no I/O. Window time is
 *     INTEGER logical ms (caller-supplied) — `new Date` is never used here.
 *   - Tenant fail-closed: an empty intake tenant rejects the whole batch;
 *     results are stamped with the intake tenant.
 *   - Advisory-only: intake produces observations + trends, never
 *     authorizations (law A5 — the Guardian path owns that conversion).
 */

import type { CapabilityVersionRef, TenantScopeLike } from "./index.ts";

/** FNV-1a 32-bit — deterministic, NOT cryptographically secure. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Deterministic canonical JSON: object keys sorted at every depth. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NaN";
  if (typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return "undefined";
}

/** Intake rejection codes — fail-closed, machine-stable. */
export type IntakeRejectionCode =
  | "missing-tenant"
  | "empty-observation-id"
  | "empty-case-id"
  | "empty-observation-ref"
  | "invalid-observed-at"
  | "duplicate-observation-id";

export interface IntakeRejection {
  readonly ok: false;
  readonly code: IntakeRejectionCode;
  readonly reason: string;
}

/** An outcome observation candidate — pre-validation, integer-ms time. */
export interface OutcomeIntakeCandidate<T = unknown> {
  readonly observationId: string;
  readonly caseId: string;
  readonly capability: CapabilityVersionRef;
  readonly actual: T;
  /** Integer logical ms (caller-supplied, never wall clock). */
  readonly observedAtMs: number;
  readonly observationRef: string;
  readonly success: boolean;
}

/** An accepted intake observation — validated + digest-stamped. */
export interface IntakeOutcome<T = unknown> {
  readonly observationId: string;
  readonly caseId: string;
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly actual: T;
  readonly observedAtMs: number;
  readonly observationRef: string;
  readonly success: boolean;
  readonly observationDigest: string;
}

export interface IntakeResult<T = unknown> {
  readonly ok: true;
  readonly tenantId: string;
  readonly observations: readonly IntakeOutcome<T>[];
  /** ObservationIds dropped as exact duplicates (same digest). */
  readonly duplicates: readonly string[];
}

export type IntakeOutcomeResult<T = unknown> = IntakeResult<T> | IntakeRejection;

/** Deterministic observation digest over the FULL observation content. */
export function observationDigest<T>(o: OutcomeIntakeCandidate<T>): string {
  return fnv1a(
    `obs|v1|${o.observationId}|${o.caseId}|${o.capability.capabilityId}@${o.capability.version}` +
      `|${canonicalJson(o.actual)}|${o.observedAtMs}|${o.observationRef}|${o.success ? 1 : 0}`,
  );
}

/**
 * Outcome intake: validate -> dedupe by deterministic observation digest.
 *
 * Rules:
 *   - fail-closed on: empty tenant, empty observationId/caseId/observationRef,
 *     non-integer/negative observedAtMs, and the SAME observationId with
 *     DIFFERENT content (identity conflict — never silently overwritten);
 *   - exact duplicates (same digest) are dropped and reported in
 *     `duplicates` — intake is idempotent for replayed batches;
 *   - deterministic ordering (observedAtMs asc, observationId asc) — input
 *     order never leaks.
 */
export function intakeOutcomes<T>(
  candidates: readonly OutcomeIntakeCandidate<T>[],
  tenant: TenantScopeLike,
): IntakeOutcomeResult<T> {
  const tenantId = tenant.tenantId;
  if (tenantId === "") {
    return { ok: false, code: "missing-tenant", reason: "intake tenant identifier is empty" };
  }
  const ordered = [...candidates].sort((a, b) =>
    a.observedAtMs !== b.observedAtMs ? a.observedAtMs - b.observedAtMs : a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0,
  );
  const seenIds = new Map<string, string>();
  const seenDigests = new Set<string>();
  const duplicates: string[] = [];
  const accepted: IntakeOutcome<T>[] = [];
  for (const o of ordered) {
    if (o.observationId === "") {
      return { ok: false, code: "empty-observation-id", reason: "observation identifier is empty" };
    }
    if (o.caseId === "") {
      return { ok: false, code: "empty-case-id", reason: `observation ${o.observationId} has an empty caseId` };
    }
    if (o.observationRef === "") {
      return { ok: false, code: "empty-observation-ref", reason: `observation ${o.observationId} has an empty observationRef` };
    }
    if (!Number.isInteger(o.observedAtMs) || o.observedAtMs < 0) {
      return { ok: false, code: "invalid-observed-at", reason: `observation ${o.observationId} observedAtMs must be an integer >= 0` };
    }
    if (o.capability.capabilityId === "") {
      return { ok: false, code: "empty-case-id", reason: `observation ${o.observationId} has an empty capabilityId` };
    }
    const digest = observationDigest(o);
    const prior = seenIds.get(o.observationId);
    if (prior !== undefined && prior !== digest) {
      return {
        ok: false,
        code: "duplicate-observation-id",
        reason: `observationId ${o.observationId} submitted twice with different content`,
      };
    }
    seenIds.set(o.observationId, digest);
    if (seenDigests.has(digest)) {
      duplicates.push(o.observationId);
      continue;
    }
    seenDigests.add(digest);
    accepted.push({ ...o, tenantId, observationDigest: digest });
  }
  return { ok: true, tenantId, observations: accepted, duplicates };
}

/** One logical-time window of correlated outcomes for a capability. */
export interface OutcomeWindowGroup {
  readonly tenantId: string;
  readonly capability: CapabilityVersionRef;
  readonly windowIndex: number;
  readonly windowStartMs: number;
  /** Exclusive end: windowStartMs + windowMs. */
  readonly windowEndMs: number;
  readonly observations: readonly IntakeOutcome[];
  readonly count: number;
  readonly successes: number;
  /** Integer bps 0..10000 = round(successes / count * 10000). */
  readonly successRateBps: number;
  readonly groupDigest: string;
}

export type CorrelateResult =
  | { readonly ok: true; readonly groups: readonly OutcomeWindowGroup[] }
  | IntakeRejection;

/**
 * Correlate intake observations by capability version + logical-time window.
 * Windows are `floor(observedAtMs / windowMs)` — pure integer arithmetic.
 * Groups are ordered by (capabilityId, version, windowIndex); observations
 * inside a group keep intake order. Fail-closed on a non-integer or
 * non-positive windowMs.
 */
export function correlateOutcomes(
  observations: readonly IntakeOutcome[],
  input: { readonly tenant: TenantScopeLike; readonly windowMs: number },
): CorrelateResult {
  if (input.tenant.tenantId === "") {
    return { ok: false, code: "missing-tenant", reason: "correlation tenant identifier is empty" };
  }
  if (!Number.isInteger(input.windowMs) || input.windowMs <= 0) {
    return { ok: false, code: "invalid-observed-at", reason: "windowMs must be an integer > 0" };
  }
  const byKey = new Map<string, OutcomeWindowGroup>();
  for (const o of observations) {
    const windowIndex = Math.floor(o.observedAtMs / input.windowMs);
    const key = `${o.capability.capabilityId}@${o.capability.version}#${windowIndex}`;
    const existing = byKey.get(key);
    const members = existing ? [...existing.observations, o] : [o];
    const successes = members.filter((m) => m.success).length;
    byKey.set(key, {
      tenantId: input.tenant.tenantId,
      capability: o.capability,
      windowIndex,
      windowStartMs: windowIndex * input.windowMs,
      windowEndMs: (windowIndex + 1) * input.windowMs,
      observations: members,
      count: members.length,
      successes,
      successRateBps: Math.round((successes / members.length) * 10000),
      groupDigest: fnv1a(`win|v1|${input.tenant.tenantId}|${key}|${members.map((m) => m.observationDigest).join(",")}`),
    });
  }
  const groups = [...byKey.values()].sort((a, b) => {
    const ka = `${a.capability.capabilityId}@${a.capability.version}`;
    const kb = `${b.capability.capabilityId}@${b.capability.version}`;
    return ka !== kb ? (ka < kb ? -1 : 1) : a.windowIndex - b.windowIndex;
  });
  return { ok: true, groups };
}

/** Outcome trend classification. */
export type OutcomeTrend = "improving" | "stable" | "degrading";

/**
 * Trend delta threshold in integer bps: |delta| must EXCEED this to classify
 * improving/degrading (a delta of exactly +/-TREND_DELTA_BPS is stable).
 */
export const TREND_DELTA_BPS = 500;

/**
 * Classify the trend of an ordered success-rate sequence (integer bps).
 *
 * Deterministic method: compare the mean success rate of the first half of
 * the windows against the second half — delta = second - first:
 *   - delta >  +TREND_DELTA_BPS -> improving
 *   - delta <  -TREND_DELTA_BPS -> degrading
 *   - otherwise                -> stable (including the exact +/- boundary)
 *
 * Fewer than 2 points default to "stable" (no evidence of change — the
 * conservative-neutral reading; documented, not an error).
 */
export function classifyOutcomeTrend(ratesBps: readonly number[]): OutcomeTrend {
  if (ratesBps.length < 2) return "stable";
  const firstCount = Math.floor(ratesBps.length / 2);
  const first = ratesBps.slice(0, firstCount);
  const second = ratesBps.slice(firstCount);
  const mean = (xs: readonly number[]): number =>
    xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  const delta = mean(second) - mean(first);
  if (delta > TREND_DELTA_BPS) return "improving";
  if (delta < -TREND_DELTA_BPS) return "degrading";
  return "stable";
}

/** Classify a correlated group sequence directly (successRateBps per window). */
export function classifyGroupTrend(groups: readonly OutcomeWindowGroup[]): OutcomeTrend {
  return classifyOutcomeTrend(groups.map((g) => g.successRateBps));
}
