/**
 * F321B journey — action compensation and rollback (persona: remediation-engineer).
 *
 * A remediation engineer unwinds a failed consequential action through the
 * REAL compensation protocol (@fleetos/actions compensation — law A4):
 *   - an executed action with REVERSIBLE side effects gets a revert_command
 *     contract naming the compensating capability, gated on Guardian
 *     authorization — the attempt REFUSES without it (`guardian_refused`)
 *     and succeeds with it (proposal-only: the contract never self-executes);
 *   - an executed action with IRREVERSIBLE side effects gets
 *     manual_intervention — the attempt honestly FAILS
 *     (`compensated.requires_manual_intervention`), never a fake rollback;
 *   - a cancelled-before-dispatch action has no side effects to undo
 *     (`compensated.no_side_effects`), and cancelling a TERMINAL record is
 *     a documented no-op that never rewrites history;
 *   - the idempotency key builder namespaces every dispatch
 *     (tenant|capability|nonce — law A14's dedupe surface).
 *
 * NOTE (async-signature API): `dispatchWithIdempotency` carries a Promise
 * signature over the IdempotencyLedgerPort. The security corpus runner
 * executes synchronous steps by contract (the TL-owned adoption seam), so
 * this journey drives the synchronous compensation surface + the key
 * builder; `dispatchWithIdempotency`/`InMemoryIdempotencyLedger` are
 * machine-run over deterministic ports in tests/async-dispatch.test.ts
 * (supporting evidence — not counted as a corpus journey).
 *
 * Determinism: logical epochs (NOW_MS offsets, pure isoOfEpochMs); no
 * clock, no randomness, no network.
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  advanceActionState,
  buildCompensationContract,
  buildIdempotencyKey,
  cancelAction,
  attemptCompensation,
  proposeAction,
} from "@fleetos/actions";
import type { ActionRecord, Capability } from "@fleetos/actions";
import { evaluateCapability } from "@fleetos/policy";
import { EXECUTE_CAPABILITY, READ_CAPABILITY, TENANT, NOW_MS, isoOfEpochMs, tenantPolicy } from "./fixture-world.ts";

/** A reversible control capability — compensation can revert its command. */
const REVERSIBLE_CONTROL: Capability = {
  id: "fleetos.device.set-throttle",
  category: "execute.device",
  risk: "low",
  requiredAuthority: [],
  tenantScope: "single",
  resourceScope: { assetIds: ["pump-7"] },
  sideEffects: [{ kind: "device.command", target: "pump-7", reversible: true, description: "throttle set" }],
  idempotency: { supported: true, keyShape: ["tenantId", "capabilityId", "nonce"] },
  verification: { kind: "device.ack", timeoutMs: 30_000 },
  inputs: ["assetId", "level"],
  outputs: ["ack"],
  description: "Set pump throttle (reversible)",
  version: "1.0.0",
};

/** An irreversible control capability — compensation escalates to humans. */
const IRREVERSIBLE_CONTROL: Capability = {
  ...EXECUTE_CAPABILITY,
  risk: "low",
  requiredAuthority: [],
  id: "fleetos.device.purge-buffer",
  sideEffects: [{ kind: "device.command", target: "pump-7", reversible: false, description: "buffer purge" }],
  description: "Purge the pump buffer (irreversible)",
};

/** Build a REAL action record driven to the EXECUTED state (law A4 chain). */
function executedAction(capability: Capability, intentId: string, nonce: string): ActionRecord {
  const policy = tenantPolicy();
  const decision = evaluateCapability(policy, capability, {
    tenant: TENANT,
    capability,
    actor: { actorId: "operator-ada", authority: ["tenant.operator", "human.approval", "asset.owner"], isAutonomous: false },
    degraded: false,
  });
  let record: ActionRecord = proposeAction({
    intentId,
    tenant: TENANT,
    capability,
    idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: capability.id, nonce },
    inputs: { assetId: "pump-7" },
    proposedAt: isoOfEpochMs(NOW_MS),
    proposedBy: "operator-ada",
  });
  const steps: readonly [ActionRecord["state"], Parameters<typeof advanceActionState>[2]][] = [
    ["authorized", { at: isoOfEpochMs(NOW_MS + 500), authorization: decision, tenantId: TENANT.tenantId }],
    ["confirmed", { at: isoOfEpochMs(NOW_MS + 1_000), confirmedBy: "operator-ada", tenantId: TENANT.tenantId }],
    ["dispatched", { at: isoOfEpochMs(NOW_MS + 1_500), dispatchReceipt: `receipt-${intentId}`, tenantId: TENANT.tenantId }],
    ["executing", { at: isoOfEpochMs(NOW_MS + 1_800), tenantId: TENANT.tenantId }],
    ["executed", {
      at: isoOfEpochMs(NOW_MS + 2_000),
      executionResult: { succeeded: true, outputs: { applied: true }, executedAt: isoOfEpochMs(NOW_MS + 2_000) },
      tenantId: TENANT.tenantId,
    }],
  ];
  for (const [target, ctx] of steps) {
    const result = advanceActionState(record, target, ctx);
    if (!result.ok) throw new Error(`advance ${intentId} to ${target} refused: ${result.reason}`);
    record = result.record;
  }
  return record;
}

const COMPENSATED_AT = isoOfEpochMs(NOW_MS + 60_000);

export const compensationRollbackJourney: AcceptanceJourney = {
  journeyId: "security.action-compensation-rollback",
  persona: "remediation-engineer",
  capabilities: ["action-plans"],
  goal: "Unwind failed actions through compensation contracts — reversible reverts, irreversible escalations, honest no-ops",
  steps: [
    {
      stepId: "reversible-revert",
      kind: "plan",
      description: "An executed reversible action gets a revert contract; the attempt refuses without Guardian authorization",
      packages: ["@fleetos/actions", "@fleetos/policy"],
      operations: ["proposeAction", "advanceActionState", "buildCompensationContract", "attemptCompensation"],
      run: (ctx) => {
        const executed = executedAction(REVERSIBLE_CONTROL, "intent-throttle-1", "nonce-throttle-1");
        ctx.record("reversible.executedState", executed.state);
        const contract = buildCompensationContract(executed);
        ctx.record("reversible.kind", contract.kind);
        ctx.record("reversible.contractId", contract.contractId);
        ctx.record("reversible.intentId", contract.intentId);
        ctx.record("reversible.tenantId", contract.tenantId);
        ctx.record("reversible.compensatingCapabilityId", contract.compensatingCapabilityId);
        ctx.record("reversible.requiresGuardian", contract.requiresGuardianAuthorization);
        ctx.record("reversible.reversible", contract.reversible);
        ctx.record("reversible.description", contract.description);

        // The attempt is a PROPOSAL — without Guardian authorization it REFUSES.
        const refused = attemptCompensation(contract, false, COMPENSATED_AT);
        ctx.record("reversible.refusedOk", refused.ok);
        ctx.record("reversible.refusedReason", refused.reasonCode);
        ctx.record("reversible.refusedAt", refused.compensatedAt);

        // With the Guardian path's authorization it compensates successfully.
        const succeeded = attemptCompensation(contract, true, COMPENSATED_AT);
        ctx.record("reversible.succeededOk", succeeded.ok);
        ctx.record("reversible.succeededReason", succeeded.reasonCode);
      },
    },
    {
      stepId: "irreversible-and-cancel",
      kind: "lifecycle",
      description: "Irreversible effects escalate to manual intervention; a pre-dispatch cancel is an honest no-op; terminal records are never rewritten",
      packages: ["@fleetos/actions"],
      operations: ["buildCompensationContract", "cancelAction", "attemptCompensation", "buildIdempotencyKey"],
      run: (ctx) => {
        // IRREVERSIBLE: the contract demands humans; the attempt HONESTLY fails.
        const purge = executedAction(IRREVERSIBLE_CONTROL, "intent-purge-1", "nonce-purge-1");
        const purgeContract = buildCompensationContract(purge);
        ctx.record("irreversible.kind", purgeContract.kind);
        ctx.record("irreversible.compensatingCapabilityId", purgeContract.compensatingCapabilityId);
        ctx.record("irreversible.requiresGuardian", purgeContract.requiresGuardianAuthorization);
        ctx.record("irreversible.reversible", purgeContract.reversible);
        const purgeAttempt = attemptCompensation(purgeContract, true, COMPENSATED_AT);
        ctx.record("irreversible.attemptOk", purgeAttempt.ok);
        ctx.record("irreversible.attemptReason", purgeAttempt.reasonCode);

        // CANCELLED BEFORE DISPATCH (a read — no side effects): no-op contract.
        const read: ActionRecord = proposeAction({
          intentId: "intent-read-1",
          tenant: TENANT,
          capability: READ_CAPABILITY,
          idempotencyKey: { tenantId: TENANT.tenantId, capabilityId: READ_CAPABILITY.id, nonce: "nonce-read-1" },
          inputs: { assetId: "pump-7" },
          proposedAt: isoOfEpochMs(NOW_MS),
          proposedBy: "operator-ada",
        });
        const cancelled = cancelAction(read, isoOfEpochMs(NOW_MS + 1_000));
        ctx.record("cancel.state", cancelled.record.state);
        ctx.record("cancel.kind", cancelled.contract.kind);
        ctx.record("cancel.description", cancelled.contract.description);
        ctx.record("cancel.requiresGuardian", cancelled.contract.requiresGuardianAuthorization);
        const cancelAttempt = attemptCompensation(cancelled.contract, false, COMPENSATED_AT);
        ctx.record("cancel.attemptOk", cancelAttempt.ok);
        ctx.record("cancel.attemptReason", cancelAttempt.reasonCode);
        ctx.record("cancel.transitions", cancelled.record.stateHistory.map((t) => `${t.from}>${t.to}`));

        // CANCELLING A TERMINAL RECORD is a no-op — history is never rewritten.
        const reCancel = cancelAction(cancelled.record, isoOfEpochMs(NOW_MS + 2_000));
        ctx.record("cancel.terminalNoop", reCancel.record === cancelled.record);
        ctx.record("cancel.terminalHistoryLen", reCancel.record.stateHistory.length);

        // A REJECTED action needs no compensation either.
        const rejectedRecord: ActionRecord = { ...read, state: "rejected" };
        const rejectedContract = buildCompensationContract(rejectedRecord);
        ctx.record("reject.kind", rejectedContract.kind);
        ctx.record("reject.description", rejectedContract.description);

        // IDEMPOTENCY KEY: tenant|capability|nonce namespacing (A14 surface).
        const keyA = buildIdempotencyKey({ tenantId: TENANT.tenantId, capabilityId: REVERSIBLE_CONTROL.id, nonce: "nonce-throttle-1" });
        const keyAagain = buildIdempotencyKey({ tenantId: TENANT.tenantId, capabilityId: REVERSIBLE_CONTROL.id, nonce: "nonce-throttle-1" });
        const keyB = buildIdempotencyKey({ tenantId: TENANT.tenantId, capabilityId: REVERSIBLE_CONTROL.id, nonce: "nonce-throttle-2" });
        ctx.record("idem.keyStable", keyA === keyAagain);
        ctx.record("idem.keyDistinctPerNonce", keyA !== keyB);
        ctx.record("idem.keyNamespacesTenant", keyA.startsWith(`${TENANT.tenantId}|${REVERSIBLE_CONTROL.id}|`));
      },
    },
  ],
  assertions: [
    { assertionId: "cr-1", description: "The action genuinely reached the executed state", path: "reversible.executedState", expected: "executed" },
    { assertionId: "cr-2", description: "Reversible side effects produce a revert_command contract", path: "reversible.kind", expected: "revert_command" },
    { assertionId: "cr-3", description: "The contract id derives from the intent", path: "reversible.contractId", expected: "comp-intent-throttle-1" },
    { assertionId: "cr-4", description: "The contract names the intent it compensates", path: "reversible.intentId", expected: "intent-throttle-1" },
    { assertionId: "cr-5", description: "The contract is tenant-scoped", path: "reversible.tenantId", expected: "acme-ops" },
    { assertionId: "cr-6", description: "The compensating capability is the revert twin", path: "reversible.compensatingCapabilityId", expected: "fleetos.device.set-throttle.revert" },
    { assertionId: "cr-7", description: "Reverting a side effect REQUIRES Guardian authorization", path: "reversible.requiresGuardian", expected: true },
    { assertionId: "cr-8", description: "The contract records reversibility", path: "reversible.reversible", expected: true },
    { assertionId: "cr-9", description: "The contract description names the revert", path: "reversible.description", expected: "revert the executed command" },
    { assertionId: "cr-10", description: "The attempt REFUSES without Guardian authorization (law A5)", path: "reversible.refusedOk", expected: false },
    { assertionId: "cr-11", description: "Refusal reason: guardian_refused", path: "reversible.refusedReason", expected: "compensated.guardian_refused" },
    { assertionId: "cr-12", description: "The refusal carries the compensation time", path: "reversible.refusedAt", expected: "2026-10-12T18:51:00.000Z" },
    { assertionId: "cr-13", description: "With authorization the attempt succeeds", path: "reversible.succeededOk", expected: true },
    { assertionId: "cr-14", description: "Success reason recorded", path: "reversible.succeededReason", expected: "compensated.successfully" },
    { assertionId: "cr-15", description: "Irreversible effects produce manual_intervention", path: "irreversible.kind", expected: "manual_intervention" },
    { assertionId: "cr-16", description: "No compensating capability exists for irreversible effects", path: "irreversible.compensatingCapabilityId", expected: null },
    { assertionId: "cr-17", description: "Manual intervention still requires the Guardian gate", path: "irreversible.requiresGuardian", expected: true },
    { assertionId: "cr-18", description: "The irreversible contract is honestly not reversible", path: "irreversible.reversible", expected: false },
    { assertionId: "cr-19", description: "The irreversible attempt HONESTLY fails — never a fake rollback", path: "irreversible.attemptOk", expected: false },
    { assertionId: "cr-20", description: "Irreversible attempt reason: manual intervention required", path: "irreversible.attemptReason", expected: "compensated.requires_manual_intervention" },
    { assertionId: "cr-21", description: "Cancelling before dispatch cancels the action", path: "cancel.state", expected: "cancelled" },
    { assertionId: "cr-22", description: "A side-effect-free cancel needs no compensation", path: "cancel.kind", expected: "none" },
    { assertionId: "cr-23", description: "The no-op contract says why", path: "cancel.description", expected: "cancelled before any side effects" },
    { assertionId: "cr-24", description: "A no-op contract needs no Guardian gate", path: "cancel.requiresGuardian", expected: false },
    { assertionId: "cr-25", description: "The no-op attempt succeeds (nothing to undo)", path: "cancel.attemptOk", expected: true },
    { assertionId: "cr-26", description: "No-op attempt reason", path: "cancel.attemptReason", expected: "compensated.no_side_effects" },
    { assertionId: "cr-27", description: "The cancel transition is recorded", path: "cancel.transitions", expected: ["proposed>cancelled"] },
    { assertionId: "cr-28", description: "Cancelling a TERMINAL record is a no-op (same record)", path: "cancel.terminalNoop", expected: true },
    { assertionId: "cr-29", description: "Terminal history is never rewritten", path: "cancel.terminalHistoryLen", expected: 1 },
    { assertionId: "cr-30", description: "A rejected action needs no compensation", path: "reject.kind", expected: "none" },
    { assertionId: "cr-31", description: "The rejected contract says why", path: "reject.description", expected: "rejected — no side effects were applied" },
    { assertionId: "cr-32", description: "Idempotency keys are stable for the same inputs", path: "idem.keyStable", expected: true },
    { assertionId: "cr-33", description: "A different nonce is a different key", path: "idem.keyDistinctPerNonce", expected: true },
    { assertionId: "cr-34", description: "Keys namespace tenant and capability (A14)", path: "idem.keyNamespacesTenant", expected: true },
  ],
};
