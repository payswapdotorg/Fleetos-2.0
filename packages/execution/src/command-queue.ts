/**
 * @fleetos/execution — Command queue at truth grade (F220B, Wave 2).
 *
 * submit (idempotency-key dedupe) -> ack -> complete/fail with a
 * DETERMINISTIC retry policy (pure backoff schedule) and DEAD-LETTER after
 * max attempts.
 *
 * The queue is a PURE VALUE: every operation returns a new state, nothing is
 * mutated. Time is an explicit `number` input — no wall-clock, no randomness.
 *
 * Laws:
 *  - A4/A14: submit is idempotent — a duplicate idempotency key returns the
 *    ORIGINAL ack, never a second enqueue.
 *  - A8: the queue is tenant-scoped; submitting or transitioning commands
 *    under a different tenant REFUSES (fail-closed).
 *  - Execution NEVER decides authorization (unchanged boundary — see
 *    assertExecutionNeverAuthorizes in queue.ts).
 */

import type { AuthorizedCommand } from "./index.ts";

// ---------------------------------------------------------------------------
// Retry policy + deterministic backoff
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Total attempts allowed before dead-letter. */
  readonly maxAttempts: number;
  /** Base backoff in ms — integer. */
  readonly baseBackoffMs: number;
  /** Backoff cap in ms — integer. */
  readonly maxBackoffMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
};

/**
 * Deterministic exponential backoff for attempt N (1-based):
 * `base * 2^(N-1)`, capped at `maxBackoffMs`.
 *
 * Pure: no jitter, no randomness — the schedule for a given policy is a pure
 * function of the attempt number. All outputs are integers (the exponent is
 * capped at 30 so `2^k` never exceeds the safe integer range).
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  if (!Number.isInteger(attempt) || attempt < 1) return policy.baseBackoffMs;
  const exponent = Math.min(attempt - 1, 30);
  const raw = policy.baseBackoffMs * 2 ** exponent;
  return Math.min(policy.maxBackoffMs, raw);
}

// ---------------------------------------------------------------------------
// Queue state
// ---------------------------------------------------------------------------

export type CommandStatus = "queued" | "in-flight" | "completed" | "failed" | "dead-lettered";

export interface QueuedCommand {
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly payloadInputs: Readonly<Record<string, unknown>>;
  /** Authorization audit digest carried from the Guardian decision (A4/A13). */
  readonly authorizationDigest: string | null;
  /** Verdict carried from the Guardian decision. */
  readonly verdict: "ALLOW" | "REQUIRE_APPROVAL" | null;
  readonly status: CommandStatus;
  /** Attempts STARTED so far (submit = attempt 1). */
  readonly attempts: number;
  readonly submittedAt: number;
  /** Due time of the next attempt (attempt 1 is due immediately). */
  readonly nextAttemptAt: number;
  readonly lastFailureReason: string | null;
  readonly completedOutputs: Readonly<Record<string, unknown>> | null;
  readonly completedAt: number | null;
  readonly deadLetteredAt: number | null;
  /** Arrival order — deterministic drain ordering. */
  readonly submissionSeq: number;
}

export interface CommandQueueState {
  readonly tenantId: string;
  readonly retryPolicy: RetryPolicy;
  readonly nextSeq: number;
  readonly commands: readonly QueuedCommand[];
}

export type QueueRefusalCode =
  | "queue.missing-tenant"
  | "submit.missing-idempotency-key"
  | "submit.missing-capability-id"
  | "submit.missing-tenant"
  | "submit.tenant-mismatch"
  | "submit.invalid-at"
  | "ack.unknown-key"
  | "ack.not-queued"
  | "ack.missing-tenant"
  | "ack.tenant-mismatch"
  | "ack.invalid-at"
  | "complete.unknown-key"
  | "complete.not-in-flight"
  | "complete.tenant-mismatch"
  | "complete.invalid-at"
  | "fail.unknown-key"
  | "fail.not-in-flight"
  | "fail.tenant-mismatch"
  | "fail.invalid-at";

export type QueueOperationResult =
  | { readonly ok: true; readonly state: CommandQueueState; readonly command: QueuedCommand; readonly duplicate: boolean }
  | { readonly ok: false; readonly reason: QueueRefusalCode };

/** Create an empty tenant-scoped queue. Refuses an empty tenant scope (A8). */
export function createCommandQueue(
  tenantId: string,
  retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY,
): { readonly ok: true; readonly state: CommandQueueState } | { readonly ok: false; readonly reason: "queue.missing-tenant" } {
  if (tenantId === "") return { ok: false, reason: "queue.missing-tenant" };
  return { ok: true, state: { tenantId, retryPolicy, nextSeq: 1, commands: [] } };
}

function findCommand(state: CommandQueueState, key: string): QueuedCommand | undefined {
  return state.commands.find((c) => c.idempotencyKey === key);
}

function replaceCommand(state: CommandQueueState, updated: QueuedCommand): CommandQueueState {
  return {
    ...state,
    commands: state.commands.map((c) => (c.idempotencyKey === updated.idempotencyKey ? updated : c)),
  };
}

// ---------------------------------------------------------------------------
// Submit — idempotency-key dedupe
// ---------------------------------------------------------------------------

/**
 * Submit a command to the queue.
 *
 * Idempotent (law A4/A14): submitting an idempotency key that already exists
 * returns the EXISTING command with `duplicate: true` — the queue state is
 * unchanged, no second enqueue happens.
 *
 * Refuses: missing key, missing capability id, missing/mismatched tenant
 * (A8 fail-closed — the queue is single-tenant), invalid `at`.
 */
export function submitCommand(
  state: CommandQueueState,
  input: {
    readonly idempotencyKey: string;
    readonly capabilityId: string;
    readonly payloadInputs?: Readonly<Record<string, unknown>>;
    readonly at: number;
    readonly tenantId: string;
    /** Authorization audit digest carried from the Guardian decision. */
    readonly authorizationDigest?: string;
    readonly verdict?: "ALLOW" | "REQUIRE_APPROVAL";
  },
): QueueOperationResult {
  if (input.tenantId === "") return { ok: false, reason: "submit.missing-tenant" };
  if (input.tenantId !== state.tenantId) return { ok: false, reason: "submit.tenant-mismatch" };
  if (input.idempotencyKey === "") return { ok: false, reason: "submit.missing-idempotency-key" };
  if (input.capabilityId === "") return { ok: false, reason: "submit.missing-capability-id" };
  if (!Number.isInteger(input.at) || input.at < 0) return { ok: false, reason: "submit.invalid-at" };

  const existing = findCommand(state, input.idempotencyKey);
  if (existing !== undefined) {
    return { ok: true, state, command: existing, duplicate: true };
  }

  const command: QueuedCommand = {
    idempotencyKey: input.idempotencyKey,
    tenantId: state.tenantId,
    capabilityId: input.capabilityId,
    payloadInputs: input.payloadInputs ?? {},
    authorizationDigest: input.authorizationDigest ?? null,
    verdict: input.verdict ?? null,
    status: "queued",
    attempts: 1,
    submittedAt: input.at,
    nextAttemptAt: input.at,
    lastFailureReason: null,
    completedOutputs: null,
    completedAt: null,
    deadLetteredAt: null,
    submissionSeq: state.nextSeq,
  };
  return {
    ok: true,
    state: { ...state, nextSeq: state.nextSeq + 1, commands: [...state.commands, command] },
    command,
    duplicate: false,
  };
}

// ---------------------------------------------------------------------------
// Ack — queued -> in-flight
// ---------------------------------------------------------------------------

/**
 * Acknowledge a queued command: the transport accepted it and the attempt is
 * in flight. Refuses unknown keys, non-queued commands, cross-tenant acks.
 */
export function ackCommand(
  state: CommandQueueState,
  idempotencyKey: string,
  at: number,
  tenantId: string,
): QueueOperationResult {
  if (tenantId === "") return { ok: false, reason: "ack.missing-tenant" };
  if (tenantId !== state.tenantId) return { ok: false, reason: "ack.tenant-mismatch" };
  if (!Number.isInteger(at) || at < 0) return { ok: false, reason: "ack.invalid-at" };
  const command = findCommand(state, idempotencyKey);
  if (command === undefined) return { ok: false, reason: "ack.unknown-key" };
  if (command.status !== "queued") return { ok: false, reason: "ack.not-queued" };
  const updated: QueuedCommand = { ...command, status: "in-flight" };
  return { ok: true, state: replaceCommand(state, updated), command: updated, duplicate: false };
}

// ---------------------------------------------------------------------------
// Complete — in-flight -> completed
// ---------------------------------------------------------------------------

/** Complete an in-flight command with its outputs. */
export function completeCommand(
  state: CommandQueueState,
  idempotencyKey: string,
  outputs: Readonly<Record<string, unknown>>,
  at: number,
  tenantId: string,
): QueueOperationResult {
  if (tenantId !== state.tenantId) return { ok: false, reason: "complete.tenant-mismatch" };
  if (!Number.isInteger(at) || at < 0) return { ok: false, reason: "complete.invalid-at" };
  const command = findCommand(state, idempotencyKey);
  if (command === undefined) return { ok: false, reason: "complete.unknown-key" };
  if (command.status !== "in-flight") return { ok: false, reason: "complete.not-in-flight" };
  const updated: QueuedCommand = {
    ...command,
    status: "completed",
    completedOutputs: outputs,
    completedAt: at,
  };
  return { ok: true, state: replaceCommand(state, updated), command: updated, duplicate: false };
}

// ---------------------------------------------------------------------------
// Fail — retry with deterministic backoff, or dead-letter
// ---------------------------------------------------------------------------

/**
 * Fail an in-flight attempt. The retry policy decides deterministically:
 *  - attempts started so far < maxAttempts -> re-QUEUED with
 *    `nextAttemptAt = at + backoffDelayMs(attempts + 1)` (the pure schedule);
 *  - otherwise -> DEAD-LETTERED with the failure reason preserved.
 */
export function failCommand(
  state: CommandQueueState,
  idempotencyKey: string,
  failureReason: string,
  at: number,
  tenantId: string,
): QueueOperationResult {
  if (tenantId !== state.tenantId) return { ok: false, reason: "fail.tenant-mismatch" };
  if (!Number.isInteger(at) || at < 0) return { ok: false, reason: "fail.invalid-at" };
  const command = findCommand(state, idempotencyKey);
  if (command === undefined) return { ok: false, reason: "fail.unknown-key" };
  if (command.status !== "in-flight") return { ok: false, reason: "fail.not-in-flight" };

  if (command.attempts >= state.retryPolicy.maxAttempts) {
    const updated: QueuedCommand = {
      ...command,
      status: "dead-lettered",
      lastFailureReason: failureReason,
      deadLetteredAt: at,
    };
    return { ok: true, state: replaceCommand(state, updated), command: updated, duplicate: false };
  }

  const nextAttempt = command.attempts + 1;
  const updated: QueuedCommand = {
    ...command,
    status: "queued",
    attempts: nextAttempt,
    nextAttemptAt: at + backoffDelayMs(nextAttempt, state.retryPolicy),
    lastFailureReason: failureReason,
  };
  return { ok: true, state: replaceCommand(state, updated), command: updated, duplicate: false };
}

// ---------------------------------------------------------------------------
// Queries — deterministic orderings, tenant fail-closed
// ---------------------------------------------------------------------------

/** Commands due for dispatch at `now`: queued AND nextAttemptAt <= now, in arrival order. */
export function dueCommands(state: CommandQueueState, now: number): readonly QueuedCommand[] {
  return state.commands
    .filter((c) => c.status === "queued" && c.nextAttemptAt <= now)
    .sort((a, b) => a.submissionSeq - b.submissionSeq);
}

/** The dead-lettered commands, in arrival order — the honest failure surface. */
export function deadLetteredCommands(state: CommandQueueState): readonly QueuedCommand[] {
  return state.commands
    .filter((c) => c.status === "dead-lettered")
    .sort((a, b) => a.submissionSeq - b.submissionSeq);
}

/** Look up a command under a tenant scope — cross-tenant reads fail closed (A8). */
export function readCommand(
  state: CommandQueueState,
  idempotencyKey: string,
  tenantId: string,
): { readonly ok: true; readonly command: QueuedCommand } | { readonly ok: false; readonly reason: "read.missing-tenant" | "read.tenant-mismatch" | "read.unknown-key" } {
  if (tenantId === "") return { ok: false, reason: "read.missing-tenant" };
  if (tenantId !== state.tenantId) return { ok: false, reason: "read.tenant-mismatch" };
  const command = findCommand(state, idempotencyKey);
  if (command === undefined) return { ok: false, reason: "read.unknown-key" };
  return { ok: true, command };
}

/** Extract the queue-relevant fields of an AuthorizedCommand for submission. */
export function commandFromAuthorized(command: AuthorizedCommand, at: number): {
  readonly idempotencyKey: string;
  readonly capabilityId: string;
  readonly payloadInputs: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
  readonly at: number;
} {
  return {
    idempotencyKey: command.idempotencyKey,
    capabilityId: command.payload.capabilityId,
    payloadInputs: command.payload.inputs,
    tenantId: command.tenant.tenantId,
    at,
  };
}
