/**
 * @fleetos/adcos — Wave 5 adapter health rollup (F250A).
 *
 * Aggregates command outcomes, session expiry, and posture-machine
 * signals (structural mirror — no connectivity import) into an honest
 * `AdcosHealth` (`healthy | degraded | unavailable`) with typed reason
 * codes, plus a DETERMINISTIC CIRCUIT classification
 * (`closed | open | half-open`) driven by logical time + observed
 * failure counts. No timers: `now` is always caller-supplied.
 *
 * Honesty law (F220A): never exaggerate — no observations at all is
 * `degraded` + `no-observations`, never `healthy`.
 *
 * Pure deterministic TypeScript.
 */

import { createHash } from "node:crypto";
import type { AdcosHealth, AdcosRejectionCode, TenantIdLike } from "./adcos.js";
import type { AuditEventRef } from "./kernel.js";
import type { SessionExpiryClass } from "./session-registry.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Command outcome (input) + session summary (input).
// ---------------------------------------------------------------------------

export interface CommandOutcomeObservation {
  readonly ok: boolean;
  readonly at: number;
  readonly code?: AdcosRejectionCode;
}

export interface SessionHealthSummary {
  readonly active: number;
  readonly fresh: number;
  readonly stale: number;
  readonly expired: number;
  readonly revoked: number;
}

/** Structural mirror of the connectivity posture-machine states. */
export type PostureSignalLike = "offline" | "degraded" | "connected";

export interface AdapterHealthConfig {
  readonly windowMs: number; // outcomes older than now - windowMs are ignored
  readonly degradedFailureBps: number; // integer bps (e.g. 2000 = 20%)
  readonly unavailableFailureBps: number; // integer bps (e.g. 8000 = 80%)
}

export function defaultAdapterHealthConfig(): AdapterHealthConfig {
  return { windowMs: 300_000, degradedFailureBps: 2_000, unavailableFailureBps: 8_000 };
}

export type AdapterHealthReasonCode =
  | "no-observations" // honest: no evidence to claim healthy
  | "failure-ratio-degraded"
  | "failure-ratio-unavailable"
  | "circuit-open"
  | "circuit-half-open"
  | "sessions-expired"
  | "sessions-stale"
  | "posture-degraded"
  | "posture-offline";

// ---------------------------------------------------------------------------
// Circuit state machine — closed -> open -> half-open -> closed/open.
// Driven ONLY by logical time + observed outcomes (no timers).
// ---------------------------------------------------------------------------

export type AdapterCircuitState = "closed" | "open" | "half-open";

export interface AdapterCircuitStatus {
  readonly state: AdapterCircuitState;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;
  readonly openedAt: number | null;
  readonly lastTransitionAt: number | null;
}

export interface AdapterCircuitConfig {
  readonly failureThreshold: number; // consecutive failures to open
  readonly cooldownMs: number; // open -> half-open after this long (logical)
}

export function defaultAdapterCircuitConfig(): AdapterCircuitConfig {
  return { failureThreshold: 3, cooldownMs: 60_000 };
}

export function emptyAdapterCircuit(): AdapterCircuitStatus {
  return {
    state: "closed",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    openedAt: null,
    lastTransitionAt: null,
  };
}

/** Fold ONE outcome into the circuit (logical time = outcome.at). */
export function foldAdapterCircuit(
  status: AdapterCircuitStatus,
  outcome: { readonly ok: boolean; readonly at: number },
  config: AdapterCircuitConfig,
): AdapterCircuitStatus {
  if (outcome.ok) {
    switch (status.state) {
      case "closed":
        return {
          ...status,
          consecutiveFailures: 0,
          consecutiveSuccesses: status.consecutiveSuccesses + 1,
        };
      case "half-open": // probe succeeded -> close
        return {
          state: "closed",
          consecutiveFailures: 0,
          consecutiveSuccesses: 1,
          openedAt: null,
          lastTransitionAt: outcome.at,
        };
      case "open": // still cooling (evaluate first) — a success closes it
        return {
          state: "closed",
          consecutiveFailures: 0,
          consecutiveSuccesses: 1,
          openedAt: null,
          lastTransitionAt: outcome.at,
        };
    }
  }
  switch (status.state) {
    case "closed": {
      const failures = status.consecutiveFailures + 1;
      if (failures >= config.failureThreshold) {
        return {
          state: "open",
          consecutiveFailures: failures,
          consecutiveSuccesses: 0,
          openedAt: outcome.at,
          lastTransitionAt: outcome.at,
        };
      }
      return { ...status, consecutiveFailures: failures, consecutiveSuccesses: 0 };
    }
    case "half-open": // probe failed -> reopen
      return {
        state: "open",
        consecutiveFailures: status.consecutiveFailures + 1,
        consecutiveSuccesses: 0,
        openedAt: outcome.at,
        lastTransitionAt: outcome.at,
      };
    case "open":
      return { ...status, consecutiveFailures: status.consecutiveFailures + 1 };
  }
}

/** Time-driven transition: open -> half-open once the cooldown elapsed. */
export function evaluateAdapterCircuit(
  status: AdapterCircuitStatus,
  now: number,
  config: AdapterCircuitConfig,
): AdapterCircuitStatus {
  if (status.state === "open" && status.openedAt !== null && now - status.openedAt >= config.cooldownMs) {
    return { ...status, state: "half-open", lastTransitionAt: now };
  }
  return status;
}

/** May the adapter dispatch now? (fail-closed while the circuit is open.) */
export function circuitDispatchDecision(
  status: AdapterCircuitStatus,
): { readonly ok: true; readonly state: AdapterCircuitState } | { readonly ok: false; readonly reason: "circuit-open" } {
  if (status.state === "open") return { ok: false, reason: "circuit-open" };
  return { ok: true, state: status.state };
}

// ---------------------------------------------------------------------------
// Health rollup.
// ---------------------------------------------------------------------------

export interface AdapterHealthReport {
  readonly tenantId: TenantIdLike;
  readonly at: number;
  readonly status: AdcosHealth;
  readonly reasons: ReadonlyArray<AdapterHealthReasonCode>; // deterministic order
  readonly circuit: AdapterCircuitState;
  readonly commandStats: {
    readonly total: number;
    readonly failures: number;
    readonly failureBps: number; // integer bps
  };
  readonly sessionSummary: SessionHealthSummary;
  readonly digest: string;
  readonly audit: AuditEventRef;
}

export function rollupAdapterHealth(
  input: {
    readonly tenantId: TenantIdLike;
    readonly now: number;
    readonly commandOutcomes: ReadonlyArray<CommandOutcomeObservation>;
    readonly sessionSummary: SessionHealthSummary;
    readonly postureSignals: ReadonlyArray<PostureSignalLike>;
  },
  circuit: AdapterCircuitStatus,
  config: AdapterHealthConfig = defaultAdapterHealthConfig(),
): AdapterHealthReport {
  const reasons: AdapterHealthReasonCode[] = [];

  // Windowed command outcomes (logical time; older ones ignored).
  const windowed = input.commandOutcomes.filter(
    (o) => o.at <= input.now && o.at > input.now - config.windowMs,
  );
  const total = windowed.length;
  const failures = windowed.filter((o) => !o.ok).length;
  const failureBps = total === 0 ? 0 : Math.floor((failures * 10_000) / total);

  const hasEvidence = total > 0 || input.sessionSummary.active > 0 || input.sessionSummary.fresh > 0;
  if (!hasEvidence) reasons.push("no-observations"); // honest: not healthy

  let unavailable = false;
  if (total > 0 && failureBps >= config.unavailableFailureBps) {
    reasons.push("failure-ratio-unavailable");
    unavailable = true;
  } else if (total > 0 && failureBps >= config.degradedFailureBps) {
    reasons.push("failure-ratio-degraded");
  }

  if (circuit.state === "open") {
    reasons.push("circuit-open");
    unavailable = true;
  } else if (circuit.state === "half-open") {
    reasons.push("circuit-half-open");
  }

  if (input.sessionSummary.expired > 0) reasons.push("sessions-expired");
  if (input.sessionSummary.stale > 0) reasons.push("sessions-stale");

  const postures = new Set(input.postureSignals);
  if (postures.has("offline")) reasons.push("posture-offline");
  else if (postures.has("degraded")) reasons.push("posture-degraded");

  const status: AdcosHealth = unavailable
    ? "unavailable"
    : reasons.length > 0
      ? "degraded"
      : "healthy";

  const digest = digestOf(
    input.tenantId,
    "adapter-health",
    input.now,
    status,
    reasons.join(","),
    circuit.state,
    total,
    failures,
    failureBps,
    input.sessionSummary.active,
    input.sessionSummary.expired,
    input.sessionSummary.stale,
  );

  return {
    tenantId: input.tenantId,
    at: input.now,
    status,
    reasons,
    circuit: circuit.state,
    commandStats: { total, failures, failureBps },
    sessionSummary: input.sessionSummary,
    digest,
    audit: {
      actor: "system:adcos-health",
      intent: `adcos:health:${status}`,
      tenant: input.tenantId,
      timestamp: input.now,
      digest: digestOf(input.tenantId, "adapter-health-audit", status, input.now, digest),
    },
  };
}

/** Tamper-evident re-verification of a report's own digest. */
export function verifyAdapterHealthReport(report: AdapterHealthReport): boolean {
  const recomputed = digestOf(
    report.tenantId,
    "adapter-health",
    report.at,
    report.status,
    report.reasons.join(","),
    report.circuit,
    report.commandStats.total,
    report.commandStats.failures,
    report.commandStats.failureBps,
    report.sessionSummary.active,
    report.sessionSummary.expired,
    report.sessionSummary.stale,
  );
  return recomputed === report.digest;
}

/** Convenience: fold a whole outcome list into a circuit (fold order). */
export function foldAdapterCircuitAll(
  outcomes: ReadonlyArray<{ readonly ok: boolean; readonly at: number }>,
  config: AdapterCircuitConfig,
): AdapterCircuitStatus {
  let status = emptyAdapterCircuit();
  for (const o of outcomes) status = foldAdapterCircuit(status, o, config);
  return status;
}

/** Session-expiry classification helper for building the summary input. */
export function sessionSummaryFromClasses(
  classes: ReadonlyArray<SessionExpiryClass | "revoked">,
): SessionHealthSummary {
  let active = 0;
  let fresh = 0;
  let stale = 0;
  let expired = 0;
  let revoked = 0;
  for (const c of classes) {
    if (c === "fresh") { active += 1; fresh += 1; }
    else if (c === "stale") { active += 1; stale += 1; }
    else if (c === "expired") { expired += 1; }
    else { revoked += 1; }
  }
  return { active, fresh, stale, expired, revoked };
}
