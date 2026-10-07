/**
 * @fleetos/execution — Reference transport with ack/timeout paths (F220B).
 *
 * The CommandTransportPort seam is KEPT unchanged. This module extends the
 * reference in-memory transport to model the real paths a transport takes:
 *
 *  - `ack`     — the transport ACCEPTS the command (state `dispatched`);
 *                completion arrives later through the queue's
 *                `completeCommand`.
 *  - `complete`— the command executed and verified (state `succeeded`).
 *  - `fail`    — the command failed (state `failed`).
 *  - `timeout` — the transport timed out (state `timeout`) — an honest
 *                degraded state, never a silent success (law A12).
 *
 * The transport consumes a DETERMINISTIC SCRIPT: dispatch N consumes step N.
 * Exceeding the script fails deterministically with `script-exhausted`.
 * Timestamps are derived from an explicit base time input (number) — no
 * wall-clock.
 *
 * `pumpCommandQueue` composes queue + ledger + transport: the operational
 * drain loop that acks, dispatches, and settles due commands.
 */

import type { AuthorizedCommand, CommandTransportPort, ExecutionResult } from "./index.ts";
import type { CommandQueueState, QueuedCommand } from "./command-queue.ts";
import { ackCommand, completeCommand, dueCommands, failCommand } from "./command-queue.ts";
import type { ExecutionLedgerEntry } from "./ledger.ts";
import { appendExecutionLedger } from "./ledger.ts";

// ---------------------------------------------------------------------------
// Scripted reference transport
// ---------------------------------------------------------------------------

export type TransportScriptStep =
  | { readonly kind: "ack" }
  | { readonly kind: "complete"; readonly outputs?: Readonly<Record<string, unknown>> }
  | { readonly kind: "fail"; readonly reason: string }
  | { readonly kind: "timeout" };

export interface ScriptedTransportOptions {
  readonly transportName?: string;
  /** Explicit base time (epoch ms) for deterministic startedAt/endedAt. */
  readonly baseAt?: number;
}

/**
 * Deterministic scripted transport — implements the existing
 * `CommandTransportPort` seam. Each dispatch consumes the next script step
 * in order; the dispatch log records every command seen (for idempotency
 * assertions).
 */
export class ScriptedReferenceTransport implements CommandTransportPort {
  readonly name: string;
  private readonly script: readonly TransportScriptStep[];
  private readonly baseAt: number;
  private cursor = 0;
  private readonly dispatchLog: readonly AuthorizedCommand[] = [];

  constructor(script: readonly TransportScriptStep[], options: ScriptedTransportOptions = {}) {
    this.script = script;
    this.name = options.transportName ?? "reference.scripted";
    this.baseAt = options.baseAt ?? 0;
  }

  async dispatch(cmd: AuthorizedCommand): Promise<ExecutionResult> {
    (this.dispatchLog as AuthorizedCommand[]).push(cmd);
    const step = this.script[this.cursor];
    this.cursor += 1;
    const at = new Date(this.baseAt + this.cursor * 1_000).toISOString();
    if (step === undefined) {
      return this.result(cmd, "failed", {}, "script-exhausted", at);
    }
    switch (step.kind) {
      case "ack":
        return this.result(cmd, "dispatched", {}, undefined, at);
      case "complete":
        return this.result(cmd, "succeeded", step.outputs ?? {}, undefined, at);
      case "fail":
        return this.result(cmd, "failed", {}, step.reason, at);
      case "timeout":
        return this.result(cmd, "timeout", {}, "transport timeout", at);
    }
  }

  private result(
    cmd: AuthorizedCommand,
    state: ExecutionResult["state"],
    outputs: Readonly<Record<string, unknown>>,
    failureReason: string | undefined,
    at: string,
  ): ExecutionResult {
    return {
      commandId: cmd.idempotencyKey,
      state,
      outputs,
      ...(failureReason !== undefined ? { failureReason } : {}),
      startedAt: at,
      endedAt: at,
      transportName: this.name,
    };
  }

  /** The idempotency keys dispatched, in dispatch order — test assertions. */
  dispatchedKeys(): readonly string[] {
    return this.dispatchLog.map((c) => c.idempotencyKey);
  }

  /** Steps of the script not yet consumed. */
  remaining(): number {
    return this.script.length - this.cursor;
  }

  /** Number of dispatches served. */
  dispatchCount(): number {
    return this.dispatchLog.length;
  }
}

// ---------------------------------------------------------------------------
// The pump — queue + ledger + transport composition
// ---------------------------------------------------------------------------

export interface PumpResult {
  readonly ok: true;
  readonly state: CommandQueueState;
  readonly ledger: readonly ExecutionLedgerEntry[];
  readonly results: readonly ExecutionResult[];
  readonly acked: number;
  readonly completed: number;
  readonly retried: number;
  readonly deadLettered: number;
}

export type PumpRefusal =
  | "pump.tenant-mismatch"
  | "pump.ledger-append-refused"
  | "pump.queue-refused";

/**
 * Pump the due commands through the transport — the operational drain loop.
 *
 * For each due command (deterministic arrival order):
 *  1. append `acked` to the ledger and mark the command in-flight;
 *  2. dispatch through the transport;
 *  3. settle by the result:
 *     - `succeeded` -> complete + ledger `completed`;
 *     - `failed`    -> fail + ledger `retried` (backoff scheduled) or
 *                      `dead-lettered` (max attempts);
 *     - `timeout`   -> fail with `transport timeout` (same retry policy);
 *     - `dispatched`-> stays in-flight (the ack path — completion arrives
 *                      later via completeCommand).
 *
 * Pure with respect to state: returns new state + ledger values.
 */
export async function pumpCommandQueue(
  state: CommandQueueState,
  ledger: readonly ExecutionLedgerEntry[],
  now: number,
  transport: CommandTransportPort,
): Promise<PumpResult | { readonly ok: false; readonly reason: PumpRefusal }> {
  let currentState = state;
  let currentLedger = ledger;
  const results: ExecutionResult[] = [];
  let acked = 0;
  let completed = 0;
  let retried = 0;
  let deadLettered = 0;

  const due = dueCommands(currentState, now);
  for (const command of due) {
    // 1. Ack.
    const ack = ackCommand(currentState, command.idempotencyKey, now, state.tenantId);
    if (!ack.ok) return { ok: false, reason: "pump.queue-refused" };
    currentState = ack.state;
    const ackEntry = appendExecutionLedger(currentLedger, {
      tenantId: state.tenantId,
      idempotencyKey: command.idempotencyKey,
      kind: "acked",
      at: now,
      detail: `attempt:${command.attempts}`,
    });
    if (!ackEntry.ok) return { ok: false, reason: "pump.ledger-append-refused" };
    currentLedger = ackEntry.ledger;
    acked += 1;

    // 2. Dispatch.
    const authorized = queuedToAuthorized(command);
    const result = await transport.dispatch(authorized);
    results.push(result);

    // 3. Settle.
    if (result.state === "succeeded") {
      const complete = completeCommand(currentState, command.idempotencyKey, result.outputs, now, state.tenantId);
      if (!complete.ok) return { ok: false, reason: "pump.queue-refused" };
      currentState = complete.state;
      const entry = appendExecutionLedger(currentLedger, {
        tenantId: state.tenantId,
        idempotencyKey: command.idempotencyKey,
        kind: "completed",
        at: now,
        detail: "succeeded",
      });
      if (!entry.ok) return { ok: false, reason: "pump.ledger-append-refused" };
      currentLedger = entry.ledger;
      completed += 1;
      continue;
    }

    if (result.state === "failed" || result.state === "timeout") {
      const reason = result.state === "timeout" ? "transport timeout" : (result.failureReason ?? "failed");
      const fail = failCommand(currentState, command.idempotencyKey, reason, now, state.tenantId);
      if (!fail.ok) return { ok: false, reason: "pump.queue-refused" };
      currentState = fail.state;
      const kind = fail.command.status === "dead-lettered" ? "dead-lettered" : "retried";
      if (kind === "dead-lettered") deadLettered += 1;
      else retried += 1;
      const entry = appendExecutionLedger(currentLedger, {
        tenantId: state.tenantId,
        idempotencyKey: command.idempotencyKey,
        kind,
        at: now,
        detail: reason,
      });
      if (!entry.ok) return { ok: false, reason: "pump.ledger-append-refused" };
      currentLedger = entry.ledger;
      continue;
    }

    // result.state === "dispatched": the ack path — the command stays
    // in-flight; completion arrives through completeCommand.
  }

  return { ok: true, state: currentState, ledger: currentLedger, results, acked, completed, retried, deadLettered };
}

/** Rebuild the AuthorizedCommand view of a queued command for transport dispatch. */
export function queuedToAuthorized(command: QueuedCommand): AuthorizedCommand {
  return {
    authorizationDigest: command.authorizationDigest ?? "",
    verdict: command.verdict ?? "ALLOW",
    tenant: { tenantId: command.tenantId },
    payload: {
      capabilityId: command.capabilityId,
      inputs: command.payloadInputs,
    },
    idempotencyKey: command.idempotencyKey,
  };
}
