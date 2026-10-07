/**
 * @fleetos/actions — Action Intent + consequential-action protocol state machine.
 *
 * Law A4: every consequential action follows
 *   propose -> authorize -> confirm -> dispatch -> execute -> verify -> record -> learn
 *
 * Pure `advanceActionState` REFUSES illegal jumps:
 *   - execute without authorization is unrepresentable / refused
 *   - dispatch without confirmation is refused
 *   - verify without execute is refused
 *   - learn without record is refused
 *
 * Cross-worker seam rule: TenantScopeLike (Worker A) and MissionRefLike
 * (Worker C) are LOCAL STRUCTURAL interfaces — no import of those workers'
 * packages. Structural-compatibility is verified by tests/structural.test.ts.
 *
 * Capability and GuardianDecision ARE imported from @fleetos/policy because
 * those are Worker-B-owned canonical types (law A15).
 */

import type { Capability } from "@fleetos/policy/capability";
import type { GuardianDecision } from "@fleetos/policy/policy";

/** LOCAL structural tenant scope (compatible with Worker A's tenant package). */
export interface TenantScopeLike {
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly impersonatedBy?: string;
}

/** LOCAL structural mission reference (compatible with Worker C's mission package). */
export interface MissionRefLike {
  readonly missionId: string;
  readonly runId?: string;
  readonly workItemId?: string;
}

/** Protocol state — machine-stable. */
export type ActionState =
  | "proposed"
  | "authorized"
  | "confirmed"
  | "dispatched"
  | "executing"
  | "executed"
  | "verified"
  | "recorded"
  | "learned"
  | "rejected"
  | "cancelled";

/** Idempotency key — required for dispatch (law A4 + A14). */
export interface IdempotencyKey {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly missionId?: string;
  readonly nonce: string;
}

/** ActionIntent — proposed consequential action. */
export interface ActionIntent {
  readonly intentId: string;
  readonly tenant: TenantScopeLike;
  readonly capability: Capability;
  readonly missionRef?: MissionRefLike;
  readonly idempotencyKey: IdempotencyKey;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly proposedAt: string;
  readonly proposedBy: string;
}

/** Full action record — state machine snapshot. */
export interface ActionRecord {
  readonly intent: ActionIntent;
  readonly state: ActionState;
  readonly authorization?: GuardianDecision;
  readonly confirmedBy?: string;
  readonly dispatchReceipt?: string;
  readonly executionResult?: ExecutionResult;
  readonly verificationRecord?: VerificationRecord;
  readonly evidenceRef?: string;
  readonly learningRef?: string;
  readonly lastTransitionAt: string;
  readonly stateHistory: readonly StateTransition[];
}

export interface StateTransition {
  readonly from: ActionState;
  readonly to: ActionState;
  readonly at: string;
  readonly reason: string;
}

export interface ExecutionResult {
  readonly succeeded: boolean;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly failureReason?: string;
  readonly executedAt: string;
}

export interface VerificationRecord {
  readonly verified: boolean;
  readonly verifierKind: "evidence.hash" | "device.ack" | "domain.read" | "external.receipt";
  readonly verifiedAt: string;
  readonly proofRef: string;
}

/** Refusal reason — machine-stable. */
export type AdvanceRefusalReason =
  | "refused.execute_without_authorization"
  | "refused.dispatch_without_confirmation"
  | "refused.verify_without_execution"
  | "refused.record_without_verification"
  | "refused.learn_without_record"
  | "refused.transition_from_terminal"
  | "refused.no_op_transition"
  | "refused.tenant_mismatch";

export type AdvanceResult =
  | { readonly ok: true; readonly record: ActionRecord }
  | { readonly ok: false; readonly reason: AdvanceRefusalReason; readonly record: ActionRecord };

/** Allowed forward transitions from each state. */
const ALLOWED: Readonly<Record<ActionState, readonly ActionState[]>> = {
  proposed: ["authorized", "rejected", "cancelled"],
  authorized: ["confirmed", "rejected", "cancelled"],
  confirmed: ["dispatched", "cancelled"],
  dispatched: ["executing", "cancelled"],
  executing: ["executed", "cancelled"],
  executed: ["verified", "cancelled"],
  verified: ["recorded"],
  recorded: ["learned"],
  learned: [],
  rejected: [],
  cancelled: [],
};

function isAllowed(from: ActionState, to: ActionState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

function transition(rec: ActionRecord, to: ActionState, reason: string, at: string, patch: Partial<ActionRecord> = {}): ActionRecord {
  const t: StateTransition = { from: rec.state, to, at, reason };
  return {
    ...rec,
    ...patch,
    state: to,
    lastTransitionAt: at,
    stateHistory: [...rec.stateHistory, t],
  };
}

/**
 * Pure state-machine advance. Refuses illegal jumps.
 *
 * Law A4: an action CANNOT jump to "executing" without first being "authorized"
 * (and confirmed, and dispatched). The refusal is encoded as a returned
 * AdvanceResult with `ok: false` — the type system makes "execute without
 * authorization" unrepresentable as a successful transition.
 */
export function advanceActionState(
  record: ActionRecord,
  target: ActionState,
  ctx: {
    readonly at: string;
    readonly authorization?: GuardianDecision;
    readonly confirmedBy?: string;
    readonly dispatchReceipt?: string;
    readonly executionResult?: ExecutionResult;
    readonly verificationRecord?: VerificationRecord;
    readonly evidenceRef?: string;
    readonly learningRef?: string;
    readonly tenantId: string;
  },
): AdvanceResult {
  // Tenant fail-closed.
  if (ctx.tenantId !== record.intent.tenant.tenantId) {
    return {
      ok: false,
      reason: "refused.tenant_mismatch",
      record,
    };
  }

  if (record.state === target) {
    return { ok: false, reason: "refused.no_op_transition", record };
  }
  if (!isAllowed(record.state, target)) {
    if (target === "executing" && record.state !== "dispatched") {
      return { ok: false, reason: "refused.execute_without_authorization", record };
    }
    if (target === "dispatched" && record.state !== "confirmed") {
      return { ok: false, reason: "refused.dispatch_without_confirmation", record };
    }
    if (target === "verified" && record.state !== "executed") {
      return { ok: false, reason: "refused.verify_without_execution", record };
    }
    if (target === "recorded" && record.state !== "verified") {
      return { ok: false, reason: "refused.record_without_verification", record };
    }
    if (target === "learned" && record.state !== "recorded") {
      return { ok: false, reason: "refused.learn_without_record", record };
    }
    return { ok: false, reason: "refused.transition_from_terminal", record };
  }

  if (target === "authorized") {
    if (!ctx.authorization || ctx.authorization.verdict === "BLOCK") {
      return { ok: false, reason: "refused.execute_without_authorization", record };
    }
    return { ok: true, record: transition(record, "authorized", "guardian.authorized", ctx.at, { authorization: ctx.authorization }) };
  }
  if (target === "confirmed") {
    if (!ctx.confirmedBy) {
      return { ok: false, reason: "refused.dispatch_without_confirmation", record };
    }
    return { ok: true, record: transition(record, "confirmed", `confirmed_by:${ctx.confirmedBy}`, ctx.at, { confirmedBy: ctx.confirmedBy }) };
  }
  if (target === "dispatched") {
    if (!ctx.dispatchReceipt) {
      return { ok: false, reason: "refused.dispatch_without_confirmation", record };
    }
    return { ok: true, record: transition(record, "dispatched", `dispatch:${ctx.dispatchReceipt}`, ctx.at, { dispatchReceipt: ctx.dispatchReceipt }) };
  }
  if (target === "executing") {
    return { ok: true, record: transition(record, "executing", "execution.started", ctx.at) };
  }
  if (target === "executed") {
    if (!ctx.executionResult) {
      return { ok: false, reason: "refused.verify_without_execution", record };
    }
    return { ok: true, record: transition(record, "executed", `executed.succeeded=${ctx.executionResult.succeeded}`, ctx.at, { executionResult: ctx.executionResult }) };
  }
  if (target === "verified") {
    if (!ctx.verificationRecord) {
      return { ok: false, reason: "refused.record_without_verification", record };
    }
    return { ok: true, record: transition(record, "verified", `verified=${ctx.verificationRecord.verified}`, ctx.at, { verificationRecord: ctx.verificationRecord }) };
  }
  if (target === "recorded") {
    if (!ctx.evidenceRef) {
      return { ok: false, reason: "refused.learn_without_record", record };
    }
    return { ok: true, record: transition(record, "recorded", `evidence:${ctx.evidenceRef}`, ctx.at, { evidenceRef: ctx.evidenceRef }) };
  }
  if (target === "learned") {
    if (!ctx.learningRef) {
      return { ok: false, reason: "refused.learn_without_record", record };
    }
    return { ok: true, record: transition(record, "learned", `learning:${ctx.learningRef}`, ctx.at, { learningRef: ctx.learningRef }) };
  }
  if (target === "rejected") {
    return { ok: true, record: transition(record, "rejected", "rejected", ctx.at) };
  }
  if (target === "cancelled") {
    return { ok: true, record: transition(record, "cancelled", "cancelled", ctx.at) };
  }
  return { ok: false, reason: "refused.transition_from_terminal", record };
}

/** Construct an initial ActionRecord in the "proposed" state. */
export function proposeAction(intent: ActionIntent): ActionRecord {
  return {
    intent,
    state: "proposed",
    lastTransitionAt: intent.proposedAt,
    stateHistory: [],
  };
}
