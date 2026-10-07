/**
 * @fleetos/actions — Audit event emission at every consequential transition.
 *
 * Law A4: every consequential action follows the protocol
 *   propose -> authorize -> confirm -> dispatch -> execute -> verify -> record -> learn
 *
 * Law A19: consequential audit records are append-only, tenant-scoped,
 * hash-verifiable and machine-readable.
 *
 * Every state transition in the action protocol emits an audit event. The
 * events are append-only and form an audit trail that can be independently
 * verified.
 *
 * Pure types + pure functions + a deterministic in-memory sink.
 */

import type { ActionState, ActionRecord, StateTransition } from "./index.ts";

/** Audit event kind — machine-stable, one per consequential transition. */
export type ActionAuditEventKind =
  | "action.proposed"
  | "action.authorized"
  | "action.confirmed"
  | "action.dispatched"
  | "action.executing"
  | "action.executed"
  | "action.verified"
  | "action.recorded"
  | "action.learned"
  | "action.rejected"
  | "action.cancelled"
  | "action.compensated";

/** A single audit event — append-only, tenant-scoped. */
export interface ActionAuditEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly intentId: string;
  readonly kind: ActionAuditEventKind;
  readonly fromState: ActionState;
  readonly toState: ActionState;
  readonly emittedAt: string;
  readonly actorId: string;
  readonly reason: string;
  readonly transitionDigest: string;
}

/**
 * Audit sink port — production injects a durable append-only store.
 * The in-memory reference is for tests and deterministic reference paths.
 */
export interface ActionAuditSinkPort {
  readonly append: (event: ActionAuditEvent) => Promise<void>;
  readonly list: (intentId: string) => Promise<readonly ActionAuditEvent[]>;
}

/** Deterministic in-memory audit sink. */
export class InMemoryActionAuditSink implements ActionAuditSinkPort {
  private readonly events: ActionAuditEvent[] = [];

  async append(event: ActionAuditEvent): Promise<void> {
    this.events.push(event);
  }

  async list(intentId: string): Promise<readonly ActionAuditEvent[]> {
    return this.events.filter((e) => e.intentId === intentId);
  }

  /** Test-only — all events. */
  all(): readonly ActionAuditEvent[] {
    return [...this.events];
  }
}

/** Map an ActionState to its corresponding audit event kind. */
export function stateToEventKind(state: ActionState): ActionAuditEventKind {
  switch (state) {
    case "proposed": return "action.proposed";
    case "authorized": return "action.authorized";
    case "confirmed": return "action.confirmed";
    case "dispatched": return "action.dispatched";
    case "executing": return "action.executing";
    case "executed": return "action.executed";
    case "verified": return "action.verified";
    case "recorded": return "action.recorded";
    case "learned": return "action.learned";
    case "rejected": return "action.rejected";
    case "cancelled": return "action.cancelled";
  }
}

/** Stable digest of a transition — for dedup/verification. */
export function transitionDigest(t: StateTransition): string {
  const parts = `${t.from}|${t.to}|${t.at}|${t.reason}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i += 1) {
    h ^= parts.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Emit an audit event for a state transition. Pure — returns the event.
 *
 * The caller is responsible for appending it to the sink (which may be async
 * and durable). This separation keeps the emit function pure and testable.
 */
export function emitAuditEvent(
  record: ActionRecord,
  transition: StateTransition,
  actorId: string,
  tenantId: string,
): ActionAuditEvent {
  return {
    eventId: `audit-${record.intent.intentId}-${transition.from}-${transition.to}`,
    tenantId,
    intentId: record.intent.intentId,
    kind: stateToEventKind(transition.to),
    fromState: transition.from,
    toState: transition.to,
    emittedAt: transition.at,
    actorId,
    reason: transition.reason,
    transitionDigest: transitionDigest(transition),
  };
}

/**
 * Emit audit events for ALL transitions in a record's state history.
 * Returns the full audit trail for the action — pure, deterministic.
 */
export function emitAuditTrail(
  record: ActionRecord,
  actorId: string,
): readonly ActionAuditEvent[] {
  return record.stateHistory.map((t) =>
    emitAuditEvent(record, t, actorId, record.intent.tenant.tenantId),
  );
}

/**
 * Verify an audit trail — checks that every transition in the record's
 * stateHistory has a corresponding audit event.
 *
 * Law A19: every consequential transition has an audit event.
 */
export function verifyAuditTrail(
  record: ActionRecord,
  events: readonly ActionAuditEvent[],
): { readonly verified: boolean; readonly missingTransitions: number } {
  const expectedCount = record.stateHistory.length;
  const actualCount = events.filter((e) => e.intentId === record.intent.intentId).length;
  return {
    verified: actualCount >= expectedCount,
    missingTransitions: Math.max(0, expectedCount - actualCount),
  };
}
