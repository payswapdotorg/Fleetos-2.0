/**
 * @fleetos/actions — Compensation and cancellation contracts.
 *
 * Law A4: the action protocol supports compensation/cancellation. When an
 * action fails or is cancelled, a compensation contract describes how to
 * roll back the side effects.
 *
 * Compensation is PROPOSAL-only — it does not self-execute. The control plane
 * (TL-owned) reads the compensation contract and dispatches the compensating
 * action through the Guardian path.
 *
 * Pure types + pure functions only.
 */

import type { ActionRecord, ActionState } from "./index.ts";

/** Compensation kind — what type of rollback is needed. */
export type CompensationKind =
  | "none"
  | "undo_write"
  | "revert_command"
  | "emit_reversal_event"
  | "manual_intervention";

/** Compensation contract — describes how to roll back an action's effects. */
export interface CompensationContract {
  readonly contractId: string;
  readonly intentId: string;
  readonly tenantId: string;
  readonly kind: CompensationKind;
  readonly description: string;
  readonly requiresGuardianAuthorization: boolean;
  readonly compensatingCapabilityId: string | null;
  readonly reversible: boolean;
}

/** Result of a compensation attempt. */
export interface CompensationResult {
  readonly ok: boolean;
  readonly contractId: string;
  readonly reasonCode: CompensationReasonCode;
  readonly compensatedAt: string;
}

export type CompensationReasonCode =
  | "compensated.successfully"
  | "compensated.irreversible_action"
  | "compensated.no_side_effects"
  | "compensated.requires_manual_intervention"
  | "compensated.guardian_refused";

/**
 * Build a compensation contract for an action record.
 *
 * Determines the compensation kind based on the action's state and side effects:
 *   - cancelled before dispatch => no compensation needed (no side effects).
 *   - executed with reversible side effects => revert_command.
 *   - executed with irreversible side effects => manual_intervention.
 *   - executed with no side effects => none.
 *
 * The contract NEVER self-executes — it is a PROPOSAL. The control plane
 * reads it and dispatches the compensating action through the Guardian path.
 */
export function buildCompensationContract(record: ActionRecord): CompensationContract {
  const intent = record.intent;
  const hasSideEffects = intent.capability.sideEffects.length > 0;
  const allReversible = intent.capability.sideEffects.every((s) => s.reversible);

  let kind: CompensationKind = "none";
  let compensatingCapabilityId: string | null = null;
  let description = "no compensation needed";

  if (record.state === "cancelled" || record.state === "rejected") {
    if (record.state === "cancelled" && !hasSideEffects) {
      kind = "none";
      description = "cancelled before any side effects";
    } else if (record.state === "cancelled" && hasSideEffects) {
      kind = allReversible ? "revert_command" : "manual_intervention";
      compensatingCapabilityId = allReversible ? `${intent.capability.id}.revert` : null;
      description = allReversible
        ? "revert the dispatched command"
        : "irreversible side effects require manual intervention";
    } else {
      kind = "none";
      description = "rejected — no side effects were applied";
    }
  } else if (record.state === "executed" || record.state === "verified" || record.state === "recorded") {
    if (!hasSideEffects) {
      kind = "none";
      description = "executed with no side effects";
    } else if (allReversible) {
      kind = "revert_command";
      compensatingCapabilityId = `${intent.capability.id}.revert`;
      description = "revert the executed command";
    } else {
      kind = "manual_intervention";
      description = "irreversible side effects require manual intervention";
    }
  } else if (record.state === "learned") {
    kind = "none";
    description = "action completed learning — compensation is a no-op";
  }

  const requiresGuardian = kind === "revert_command" || kind === "manual_intervention";

  return {
    contractId: `comp-${intent.intentId}`,
    intentId: intent.intentId,
    tenantId: intent.tenant.tenantId,
    kind,
    description,
    requiresGuardianAuthorization: requiresGuardian,
    compensatingCapabilityId,
    reversible: allReversible,
  };
}

/**
 * Cancel an action — produces a cancelled record + a compensation contract.
 *
 * Cancellation is reachable from any pre-terminal state (law A4). The
 * compensation contract describes what (if anything) needs to be rolled back.
 *
 * Pure: returns the cancelled record + contract. Does NOT execute compensation.
 */
export function cancelAction(
  record: ActionRecord,
  cancelledAt: string,
): {
  readonly record: ActionRecord;
  readonly contract: CompensationContract;
} {
  const terminalStates: ActionState[] = ["learned", "rejected", "cancelled"];
  if (terminalStates.includes(record.state)) {
    // Already terminal — return as-is with a no-op contract.
    return { record, contract: buildCompensationContract(record) };
  }

  const transition: { from: ActionState; to: ActionState; at: string; reason: string } = {
    from: record.state,
    to: "cancelled",
    at: cancelledAt,
    reason: "cancelled_by_operator",
  };

  const cancelledRecord: ActionRecord = {
    ...record,
    state: "cancelled",
    lastTransitionAt: cancelledAt,
    stateHistory: [...record.stateHistory, transition],
  };

  return {
    record: cancelledRecord,
    contract: buildCompensationContract(cancelledRecord),
  };
}

/**
 * Attempt compensation — PROPOSAL only.
 *
 * Returns a CompensationResult describing what happened. The actual compensating
 * action (if any) is dispatched by the control plane through the Guardian path.
 *
 * Law A5: compensation that involves side effects requires Guardian authorization.
 */
export function attemptCompensation(
  contract: CompensationContract,
  guardianAuthorized: boolean,
  compensatedAt: string = "1970-01-01T00:00:00.000Z",
): CompensationResult {
  if (contract.kind === "none") {
    return {
      ok: true,
      contractId: contract.contractId,
      reasonCode: "compensated.no_side_effects",
      compensatedAt,
    };
  }

  if (contract.kind === "manual_intervention") {
    return {
      ok: false,
      contractId: contract.contractId,
      reasonCode: "compensated.requires_manual_intervention",
      compensatedAt,
    };
  }

  if (!contract.reversible) {
    return {
      ok: false,
      contractId: contract.contractId,
      reasonCode: "compensated.irreversible_action",
      compensatedAt,
    };
  }

  if (contract.requiresGuardianAuthorization && !guardianAuthorized) {
    return {
      ok: false,
      contractId: contract.contractId,
      reasonCode: "compensated.guardian_refused",
      compensatedAt,
    };
  }

  return {
    ok: true,
    contractId: contract.contractId,
    reasonCode: "compensated.successfully",
    compensatedAt,
  };
}
