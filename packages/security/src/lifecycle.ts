/**
 * @fleetos/security — Finding lifecycle with suppression discipline.
 *
 * Suppressed != resolved. Suppressions expire. A suppressed finding is still
 * open — it is hidden from the posture score but not marked as resolved.
 *
 * Law A12: honest degradation — if signals are insufficient, return degraded.
 *
 * Law A19: append-only lifecycle — finding state transitions are recorded.
 *
 * Pure types + pure functions + deterministic in-memory reference.
 */

import type { SecurityFinding } from "./index.ts";

/** Finding lifecycle state — machine-stable. */
export type FindingLifecycleState = "open" | "suppressed" | "resolved" | "expired_suppression";

/** A suppression record — suppressions expire. */
export interface FindingSuppression {
  readonly suppressionId: string;
  readonly findingId: string;
  readonly tenantId: string;
  readonly suppressedBy: string;
  readonly suppressedAt: string;
  readonly expiresAt: string;
  readonly reason: string;
  readonly active: boolean;
}

/** A lifecycle transition — append-only. */
export interface LifecycleTransition {
  readonly from: FindingLifecycleState;
  readonly to: FindingLifecycleState;
  readonly at: string;
  readonly reason: string;
  readonly actorId: string;
}

/** A finding with its lifecycle state + history. */
export interface FindingWithLifecycle {
  readonly finding: SecurityFinding;
  readonly state: FindingLifecycleState;
  readonly suppression: FindingSuppression | null;
  readonly transitions: readonly LifecycleTransition[];
  readonly lastTransitionAt: string;
}

/**
 * Suppress a finding — the finding remains open, but is hidden from posture.
 *
 * Suppressed != resolved. The suppression has an expiry — when it expires,
 * the finding returns to "open" state (transitioned to "expired_suppression"
 * which is treated as "open" for posture purposes).
 *
 * Pure — returns a new FindingWithLifecycle.
 */
export function suppressFinding(
  fwl: FindingWithLifecycle,
  suppression: Omit<FindingSuppression, "active" | "findingId" | "tenantId">,
): FindingWithLifecycle {
  const fullSuppression: FindingSuppression = {
    ...suppression,
    findingId: fwl.finding.findingId,
    tenantId: fwl.finding.tenantId,
    active: true,
  };
  const transition: LifecycleTransition = {
    from: fwl.state,
    to: "suppressed",
    at: suppression.suppressedAt,
    reason: suppression.reason,
    actorId: suppression.suppressedBy,
  };
  return {
    ...fwl,
    state: "suppressed",
    suppression: fullSuppression,
    transitions: [...fwl.transitions, transition],
    lastTransitionAt: suppression.suppressedAt,
  };
}

/**
 * Resolve a finding — the finding is marked as resolved.
 *
 * Resolving a suppressed finding clears the suppression (it's no longer needed).
 */
export function resolveFinding(
  fwl: FindingWithLifecycle,
  resolvedAt: string,
  resolvedBy: string,
): FindingWithLifecycle {
  const transition: LifecycleTransition = {
    from: fwl.state,
    to: "resolved",
    at: resolvedAt,
    reason: "resolved",
    actorId: resolvedBy,
  };
  return {
    ...fwl,
    state: "resolved",
    suppression: null,
    transitions: [...fwl.transitions, transition],
    lastTransitionAt: resolvedAt,
  };
}

/**
 * Expire suppressions that have passed their expiresAt.
 *
 * A finding with an expired suppression transitions from "suppressed" to
 * "expired_suppression" (which is treated as "open" for posture purposes).
 *
 * Pure — returns a new array of findings with expired suppressions transitioned.
 */
export function expireSuppressions(
  findings: readonly FindingWithLifecycle[],
  now: string,
): readonly FindingWithLifecycle[] {
  return findings.map((fwl) => {
    if (fwl.state !== "suppressed" || !fwl.suppression) return fwl;
    if (fwl.suppression.expiresAt > now) return fwl;
    // Suppression has expired.
    const transition: LifecycleTransition = {
      from: "suppressed",
      to: "expired_suppression",
      at: now,
      reason: "suppression expired",
      actorId: "system",
    };
    return {
      ...fwl,
      state: "expired_suppression",
      suppression: { ...fwl.suppression, active: false },
      transitions: [...fwl.transitions, transition],
      lastTransitionAt: now,
    };
  });
}

/**
 * Check if a finding is "effectively open" — open or expired_suppression.
 *
 * Suppressed findings are NOT effectively open (they're hidden from posture).
 * Resolved findings are NOT effectively open.
 */
export function isEffectivelyOpen(fwl: FindingWithLifecycle): boolean {
  return fwl.state === "open" || fwl.state === "expired_suppression";
}

/** Initialize a finding's lifecycle — starts in "open" state. */
export function initLifecycle(finding: SecurityFinding): FindingWithLifecycle {
  return {
    finding,
    state: "open",
    suppression: null,
    transitions: [],
    lastTransitionAt: finding.detectedAt,
  };
}
