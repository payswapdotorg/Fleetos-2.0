/**
 * @fleetos/work — Deadline contracts with deterministic escalation
 * surface (law A4: machine-stable; law A12: deterministic reference
 * path — no clock, no random, no I/O).
 *
 * A deadline is approaching when `now` is within `approachingWindow` of
 * the deadline AND the deadline has not yet been breached. A deadline
 * is breached when `now` is past the deadline. Both checks are pure
 * functions of (deadline, now, window) — deterministic from timestamps.
 */

export type DeadlineStatus =
  | "none"
  | "scheduled"
  | "approaching"
  | "breached"
  | "met";

export interface DeadlineState {
  readonly status: DeadlineStatus;
  /** Milliseconds until the deadline (negative when breached). */
  readonly millisUntilDeadline: number;
  /** True when the deadline is in the future and within the approaching window. */
  readonly approaching: boolean;
  /** True when the deadline is in the past. */
  readonly breached: boolean;
}

export type DeadlineEvaluationReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "DEADLINE_MISSING"
  | "NOW_MISSING";

/**
 * evaluateDeadline — pure function. Returns the DeadlineState given the
 * deadline timestamp, the current time, and the approaching window.
 *
 * The window is in milliseconds. A deadline is "approaching" when
 * `0 <= millisUntilDeadline <= window` and not yet breached. A deadline
 * is "breached" when `millisUntilDeadline < 0`.
 *
 * Determinism: identical inputs produce identical outputs. No clock.
 */
export function evaluateDeadline(
  deadline: string | null,
  now: string,
  approachingWindowMillis: number,
): DeadlineState {
  if (deadline === null) {
    return {
      status: "none",
      millisUntilDeadline: 0,
      approaching: false,
      breached: false,
    };
  }
  const deadlineMs = Date.parse(deadline);
  const nowMs = Date.parse(now);
  if (Number.isNaN(deadlineMs) || Number.isNaN(nowMs)) {
    // Treat unparseable timestamps as "no deadline" — honest degradation.
    return {
      status: "none",
      millisUntilDeadline: 0,
      approaching: false,
      breached: false,
    };
  }
  const millisUntilDeadline = deadlineMs - nowMs;
  const breached = millisUntilDeadline < 0;
  const approaching =
    !breached && millisUntilDeadline <= approachingWindowMillis;
  let status: DeadlineStatus = "scheduled";
  if (breached) status = "breached";
  else if (approaching) status = "approaching";
  return { status, millisUntilDeadline, approaching, breached };
}

/**
 * DeadlineEscalation — the escalation surface. Each escalation carries
 * a machine-stable kind, the work item id, and the timestamp at which
 * the escalation was observed. The composing application (TL at F211)
 * attaches the audit-event refs and routes the escalation to the
 * mission runtime / notification plane.
 */
export type DeadlineEscalationKind =
  | "deadline.approaching"
  | "deadline.breached";

export interface DeadlineEscalation {
  readonly kind: DeadlineEscalationKind;
  readonly workItemId: string;
  readonly tenantId: string;
  readonly deadline: string;
  readonly observedAt: string;
  readonly millisUntilDeadline: number;
}

/**
 * produceDeadlineEscalation — pure factory. Produces an escalation
 * record iff the deadline state warrants one (approaching or breached);
 * returns null otherwise. Deterministic from inputs.
 */
export function produceDeadlineEscalation(inputs: {
  readonly workItemId: string;
  readonly tenantId: string;
  readonly deadline: string | null;
  readonly now: string;
  readonly approachingWindowMillis: number;
}): DeadlineEscalation | null {
  const state = evaluateDeadline(
    inputs.deadline,
    inputs.now,
    inputs.approachingWindowMillis,
  );
  if (state.status === "none" || state.status === "scheduled" || state.status === "met") {
    return null;
  }
  const kind: DeadlineEscalationKind =
    state.status === "breached" ? "deadline.breached" : "deadline.approaching";
  return {
    kind,
    workItemId: inputs.workItemId,
    tenantId: inputs.tenantId,
    deadline: inputs.deadline ?? "",
    observedAt: inputs.now,
    millisUntilDeadline: state.millisUntilDeadline,
  };
}

/**
 * Mark a deadline as met (work item reached a terminal state). Pure.
 */
export function markDeadlineMet(deadline: string | null): DeadlineState {
  if (deadline === null) {
    return {
      status: "none",
      millisUntilDeadline: 0,
      approaching: false,
      breached: false,
    };
  }
  return {
    status: "met",
    millisUntilDeadline: 0,
    approaching: false,
    breached: false,
  };
}
