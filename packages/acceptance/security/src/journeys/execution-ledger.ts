/**
 * Journey 5 — execution + ledger (persona: site-reliability-engineer).
 *
 * An SRE runs the REAL command queue and execution ledger end-to-end:
 *   - happy path: submit -> ack -> complete;
 *   - failure path: submit -> ack -> fail x3 -> DEAD-LETTER (deterministic
 *     retry policy, maxAttempts 3);
 *   - the ledger appends one entry per operation with a hash chain;
 *   - the ledger REPLAYS back the queue view; re-replay is byte-identical;
 *   - tampering with any entry breaks verification;
 *   - a duplicate submit is idempotent (original ack, no re-enqueue).
 */

import type { AcceptanceJourney } from "../journey-contracts.ts";
import {
  appendExecutionLedger,
  createCommandQueue,
  ackCommand,
  completeCommand,
  deadLetteredCommands,
  failCommand,
  readCommand,
  replayExecutionLedger,
  submitCommand,
  tamperExecutionEntry,
  verifyExecutionLedger,
  verifyExecutionLedgerReplayDeterminism,
} from "@fleetos/execution";
import type { CommandQueueState, ExecutionLedgerEntry } from "@fleetos/execution";
import { EXECUTE_CAPABILITY, NOW_MS, TENANT } from "./fixture-world.ts";

function append(ledger: readonly ExecutionLedgerEntry[], input: Parameters<typeof appendExecutionLedger>[1]): readonly ExecutionLedgerEntry[] {
  const result = appendExecutionLedger(ledger, input);
  if (!result.ok) throw new Error(`ledger append refused: ${result.reason}`);
  return result.ledger;
}

export const executionLedgerJourney: AcceptanceJourney = {
  journeyId: "security.execution-ledger",
  persona: "site-reliability-engineer",
  capabilities: ["execution-ledger"],
  goal: "Run the command queue + execution ledger and trust the audit trail",
  steps: [
    {
      stepId: "queue-lifecycle",
      kind: "queue",
      description: "Drive one command to completion and one to dead-letter through the REAL queue",
      packages: ["@fleetos/execution"],
      operations: ["createCommandQueue", "submitCommand", "ackCommand", "completeCommand", "failCommand", "readCommand"],
      run: (ctx) => {
        const queue = createCommandQueue(TENANT.tenantId);
        if (!queue.ok) throw new Error("queue creation refused");
        let state: CommandQueueState = queue.state;

        const ok = submitCommand(state, {
          idempotencyKey: "exec-ok-1",
          capabilityId: EXECUTE_CAPABILITY.id,
          payloadInputs: { assetId: "pump-7" },
          at: NOW_MS,
          tenantId: TENANT.tenantId,
          authorizationDigest: "digest-allow-1",
          verdict: "ALLOW",
        });
        if (!ok.ok) throw new Error("ok submit refused");
        state = ok.state;
        const ack1 = ackCommand(state, "exec-ok-1", NOW_MS + 1_000, TENANT.tenantId);
        if (!ack1.ok) throw new Error("ack refused");
        state = ack1.state;
        const done = completeCommand(state, "exec-ok-1", { ack: true }, NOW_MS + 2_000, TENANT.tenantId);
        if (!done.ok) throw new Error("complete refused");
        state = done.state;

        const doomed = submitCommand(state, {
          idempotencyKey: "exec-doomed-1",
          capabilityId: EXECUTE_CAPABILITY.id,
          payloadInputs: { assetId: "pump-8" },
          at: NOW_MS,
          tenantId: TENANT.tenantId,
          authorizationDigest: "digest-allow-2",
          verdict: "ALLOW",
        });
        if (!doomed.ok) throw new Error("doomed submit refused");
        state = doomed.state;
        let attemptsSeen = 0;
        for (let round = 1; round <= 3; round += 1) {
          const ack = ackCommand(state, "exec-doomed-1", NOW_MS + round * 3_000, TENANT.tenantId);
          if (!ack.ok) throw new Error(`doomed ack ${round} refused`);
          state = ack.state;
          const failure = failCommand(state, "exec-doomed-1", `transport error ${round}`, NOW_MS + round * 3_000 + 500, TENANT.tenantId);
          if (!failure.ok) throw new Error(`doomed fail ${round} refused: ${failure.reason}`);
          state = failure.state;
          attemptsSeen = failure.command.attempts;
          ctx.record(`queue.doomed.round${round}.status`, failure.command.status);
        }
        const dead = deadLetteredCommands(state);
        ctx.record("queue.deadLetterCount", dead.length);
        ctx.record("queue.deadLetterKey", dead[0]?.idempotencyKey ?? "none");
        ctx.record("queue.deadLetterReason", dead[0]?.lastFailureReason ?? "none");
        ctx.record("queue.deadLetterAttempts", dead[0]?.attempts ?? -1);
        const read = readCommand(state, "exec-ok-1", TENANT.tenantId);
        if (!read.ok) throw new Error(`read refused: ${read.reason}`);
        ctx.record("queue.okFinalStatus", read.command.status);
        ctx.record("queue.okCompletedAt", read.command.completedAt);
        ctx.record("queue.doomedAttemptsFinal", attemptsSeen);
        const duplicate = submitCommand(state, {
          idempotencyKey: "exec-ok-1",
          capabilityId: EXECUTE_CAPABILITY.id,
          payloadInputs: {},
          at: NOW_MS + 30_000,
          tenantId: TENANT.tenantId,
        });
        if (!duplicate.ok) throw new Error("duplicate submit refused");
        ctx.record("queue.duplicate", duplicate.duplicate);
        ctx.record("queue.countAfterDuplicate", duplicate.state.commands.length);
      },
    },
    {
      stepId: "ledger-chain",
      kind: "ledger",
      description: "Append the audit ledger, verify, replay and tamper-check",
      packages: ["@fleetos/execution"],
      operations: ["appendExecutionLedger", "verifyExecutionLedger", "replayExecutionLedger", "tamperExecutionEntry"],
      run: (ctx) => {
        let ledger: readonly ExecutionLedgerEntry[] = [];
        ledger = append(ledger, { tenantId: TENANT.tenantId, idempotencyKey: "exec-ok-1", kind: "submitted", at: NOW_MS, detail: "" });
        ledger = append(ledger, { tenantId: TENANT.tenantId, idempotencyKey: "exec-ok-1", kind: "acked", at: NOW_MS + 1_000, detail: "" });
        ledger = append(ledger, { tenantId: TENANT.tenantId, idempotencyKey: "exec-ok-1", kind: "completed", at: NOW_MS + 2_000, detail: "" });
        ledger = append(ledger, { tenantId: TENANT.tenantId, idempotencyKey: "exec-doomed-1", kind: "submitted", at: NOW_MS, detail: "" });
        for (let round = 1; round <= 3; round += 1) {
          ledger = append(ledger, {
            tenantId: TENANT.tenantId,
            idempotencyKey: "exec-doomed-1",
            kind: round < 3 ? "retried" : "dead-lettered",
            at: NOW_MS + round * 3_000,
            detail: `transport error ${round}`,
          });
        }
        const verified = verifyExecutionLedger(ledger);
        ctx.record("ledger.verified", verified.verified);
        ctx.record("ledger.entryCount", ledger.length);
        ctx.record(
          "ledger.indexes",
          ledger.map((e) => e.index),
        );
        ctx.record(
          "ledger.kinds",
          ledger.map((e) => e.kind),
        );
        ctx.record("ledger.digestLength", (ledger[0]?.entryDigest ?? "").length);
        const replay = replayExecutionLedger(ledger);
        if (!replay.ok) throw new Error(`replay refused: ${replay.reason}`);
        ctx.record("replay.commandCount", replay.commands.length);
        const okCommand = replay.commands.find((c) => c.idempotencyKey === "exec-ok-1");
        const doomedCommand = replay.commands.find((c) => c.idempotencyKey === "exec-doomed-1");
        if (okCommand === undefined || doomedCommand === undefined) throw new Error("replayed commands missing");
        ctx.record("replay.okStatus", okCommand.status);
        ctx.record("replay.doomedStatus", doomedCommand.status);
        ctx.record("replay.doomedAttempts", doomedCommand.attempts);
        ctx.record("replay.doomedFailure", doomedCommand.lastFailureReason);
        const determinism = verifyExecutionLedgerReplayDeterminism(ledger);
        ctx.record("replay.deterministic", determinism.deterministic);
        const tampered = tamperExecutionEntry(ledger, 2, "forged-detail");
        const tamperVerify = verifyExecutionLedger(tampered);
        ctx.record("ledger.tampered.verified", tamperVerify.verified);
        ctx.record("ledger.tampered.brokenAt", tamperVerify.brokenAt);
        ctx.record("ledger.tampered.reason", tamperVerify.reason);
      },
    },
  ],
  assertions: [
    { assertionId: "ex-1", description: "Round 1 failure re-queues for retry", path: "queue.doomed.round1.status", expected: "queued" },
    { assertionId: "ex-2", description: "Round 2 failure re-queues for retry", path: "queue.doomed.round2.status", expected: "queued" },
    { assertionId: "ex-3", description: "Round 3 failure dead-letters (maxAttempts 3)", path: "queue.doomed.round3.status", expected: "dead-lettered" },
    { assertionId: "ex-4", description: "One dead letter surfaced", path: "queue.deadLetterCount", expected: 1 },
    { assertionId: "ex-5", description: "Dead letter names the command", path: "queue.deadLetterKey", expected: "exec-doomed-1" },
    { assertionId: "ex-6", description: "Dead letter preserves the last failure reason", path: "queue.deadLetterReason", expected: "transport error 3" },
    { assertionId: "ex-7", description: "Dead letter preserves attempts", path: "queue.deadLetterAttempts", expected: 3 },
    { assertionId: "ex-8", description: "Happy-path command completed", path: "queue.okFinalStatus", expected: "completed" },
    { assertionId: "ex-9", description: "Completion time recorded", path: "queue.okCompletedAt", expected: 1791831002000 },
    { assertionId: "ex-10", description: "Attempts observed on the doomed path", path: "queue.doomedAttemptsFinal", expected: 3 },
    { assertionId: "ex-11", description: "Duplicate idempotency key is a no-op", path: "queue.duplicate", expected: true },
    { assertionId: "ex-12", description: "No second enqueue on duplicate", path: "queue.countAfterDuplicate", expected: 2 },
    { assertionId: "ex-13", description: "Ledger verifies", path: "ledger.verified", expected: true },
    { assertionId: "ex-14", description: "Seven entries appended (one per op)", path: "ledger.entryCount", expected: 7 },
    { assertionId: "ex-15", description: "Append-only contiguous indexes 0..6", path: "ledger.indexes", expected: [0, 1, 2, 3, 4, 5, 6] },
    { assertionId: "ex-16", description: "Kinds in append order", path: "ledger.kinds", expected: ["submitted", "acked", "completed", "submitted", "retried", "retried", "dead-lettered"] },
    { assertionId: "ex-17", description: "Per-entry audit digest is FNV-1a 8-hex", path: "ledger.digestLength", expected: 8 },
    { assertionId: "ex-18", description: "Replay rebuilds both commands", path: "replay.commandCount", expected: 2 },
    { assertionId: "ex-19", description: "Replay rebuilds the completed status", path: "replay.okStatus", expected: "completed" },
    { assertionId: "ex-20", description: "Replay rebuilds the dead-letter status", path: "replay.doomedStatus", expected: "dead-lettered" },
    { assertionId: "ex-21", description: "Replay rebuilds attempts", path: "replay.doomedAttempts", expected: 3 },
    { assertionId: "ex-22", description: "Replay preserves the failure reason", path: "replay.doomedFailure", expected: "transport error 3" },
    { assertionId: "ex-23", description: "Re-replay is byte-identical", path: "replay.deterministic", expected: true },
    { assertionId: "ex-24", description: "Tampered entry fails verification", path: "ledger.tampered.verified", expected: false },
    { assertionId: "ex-25", description: "Break located at the tampered index", path: "ledger.tampered.brokenAt", expected: 2 },
    { assertionId: "ex-26", description: "Tamper reason names the digest mismatch", path: "ledger.tampered.reason", expected: "ledger.entry_digest_mismatch" },
  ],
};
