/**
 * @fleetos/control-plane — the tenant-scoped command queue.
 *
 * The command bus of the Control Plane (ARCHITECTURE-LOCK §2): submit →
 * ack → complete/fail, with idempotency-key dedupe (a duplicate submit
 * returns the ORIGINAL ack and NEVER double-executes), a pure
 * deterministic retry policy (integer basis-point math — see ./retry.ts),
 * dead-lettering after max attempts, and drain semantics (a drain pass
 * claims everything currently due at a given logical time `now`).
 *
 * Determinism laws: no Date.now(), no Math.random(), no timers, no
 * network. `now` is always an explicit input. Command ids are generated
 * from a per-tenant monotonic counter.
 *
 * Tenant isolation (A8): every read/write is scoped by the caller's
 * TenantContext. Cross-tenant access fails closed with
 * `command-not-found` (no existence leak).
 */

import type { ActorId, TenantContext, TenantId } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { digestOf } from "./digest.js";
import { asCommandId, isCommandId, type CommandId } from "./ids.js";
import {
  attemptDelayMs,
  DEFAULT_COMMAND_RETRY_POLICY,
  type CommandRetryPolicy,
} from "./retry.js";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface CommandEnvelope {
  readonly id: CommandId;
  readonly tenantId: TenantId;
  readonly kind: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly actorId: ActorId | string;
  readonly submittedAt: number;
  readonly availableAt: number;
  /** sha256 digest over the submit boundary inputs (A19). */
  readonly auditDigest: string;
}

export type CommandState =
  | "queued"
  | "executing"
  | "completed"
  | "retry-scheduled"
  | "dead-lettered";

export interface CommandRecord {
  readonly envelope: CommandEnvelope;
  readonly state: CommandState;
  /** Claims started (attempt count). */
  readonly attempts: number;
  /** Attempts that ended in failure. */
  readonly failures: number;
  readonly lastFailureReason: string | null;
  readonly nextAttemptAt: number | null;
  readonly claimedAt: number | null;
  readonly completedAt: number | null;
  readonly result: unknown;
}

export interface CommandAck {
  readonly command: CommandEnvelope;
  readonly receivedAt: number;
  /** True when the idempotency-key dedupe returned the original submission. */
  readonly duplicate: boolean;
}

export interface CommandOutcome {
  readonly commandId: CommandId;
  readonly state: "completed" | "dead-lettered";
  readonly attempts: number;
  readonly failures: number;
  /** null on completion; "max-attempts-exceeded" on dead-letter. */
  readonly reason: string | null;
  readonly at: number;
}

export interface CommandCompletion {
  readonly outcome: CommandOutcome;
  readonly duplicate: boolean;
}

export interface CommandFailResult {
  readonly commandId: CommandId;
  readonly state: "retry-scheduled" | "dead-lettered";
  readonly attempts: number;
  readonly failures: number;
  readonly nextAttemptAt: number | null;
  /** The executor-supplied failure reason; "max-attempts-exceeded" on dead-letter. */
  readonly reason: string;
}

export type CommandSubmitRejection =
  | "missing-kind"
  | "missing-idempotency-key"
  | "invalid-issued-at"
  | "invalid-not-before";

export type CommandQueueRejection =
  | "command-not-found" // includes cross-tenant access (fail closed, no existence leak)
  | "illegal-state";

export interface SubmitCommandInput {
  readonly kind: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  /** Optional delayed availability (logical ms). Defaults to issuedAt. */
  readonly notBefore?: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface MutableCommandRecord {
  envelope: CommandEnvelope;
  state: CommandState;
  attempts: number;
  failures: number;
  lastFailureReason: string | null;
  nextAttemptAt: number | null;
  claimedAt: number | null;
  completedAt: number | null;
  result: unknown;
}

interface TenantQueueState {
  readonly records: Map<string, MutableCommandRecord>;
  readonly byDedupe: Map<string, CommandId>;
  counter: number;
}

// ---------------------------------------------------------------------------
// CommandQueue
// ---------------------------------------------------------------------------

export class CommandQueue {
  private readonly policy: CommandRetryPolicy;
  private readonly tenants = new Map<string, TenantQueueState>();

  constructor(input?: { readonly policy?: CommandRetryPolicy }) {
    this.policy = input?.policy ?? DEFAULT_COMMAND_RETRY_POLICY;
  }

  /** The retry policy this queue dead-letters by. */
  policyOf(): CommandRetryPolicy {
    return this.policy;
  }

  // --- submit (idempotent) ---

  submit(input: {
    readonly ctx: TenantContext;
    readonly command: SubmitCommandInput;
    readonly now: number;
  }): Result<CommandAck, CommandSubmitRejection> {
    const { ctx, command, now } = input;
    if (typeof command.kind !== "string" || command.kind === "") {
      return fail("missing-kind");
    }
    if (typeof command.idempotencyKey !== "string" || command.idempotencyKey === "") {
      return fail("missing-idempotency-key");
    }
    if (!Number.isFinite(command.issuedAt) || command.issuedAt <= 0) {
      return fail("invalid-issued-at");
    }
    if (
      command.notBefore !== undefined &&
      (!Number.isFinite(command.notBefore) || command.notBefore <= 0)
    ) {
      return fail("invalid-not-before");
    }
    const tenantKey = String(ctx.tenantId);
    const state = this.tenantState(tenantKey);
    const dedupeKey = `${tenantKey}::${command.idempotencyKey}`;
    const existing = state.byDedupe.get(dedupeKey);
    if (existing) {
      const record = state.records.get(String(existing));
      if (record) {
        // Idempotency law: the duplicate submit returns the ORIGINAL ack.
        // The command is NEVER submitted twice.
        return ok({ command: record.envelope, receivedAt: now, duplicate: true });
      }
    }
    state.counter += 1;
    const id = asCommandId(
      `cmd_${String(state.counter).padStart(10, "0")}`,
    );
    const availableAt = Math.max(
      command.issuedAt,
      command.notBefore ?? command.issuedAt,
    );
    const auditDigest = digestOf(
      tenantKey,
      id,
      command.kind,
      command.idempotencyKey,
      command.issuedAt,
      now,
      String(ctx.actorId),
      String(ctx.sessionId),
    );
    const envelope: CommandEnvelope = {
      id,
      tenantId: ctx.tenantId,
      kind: command.kind,
      payload: command.payload,
      idempotencyKey: command.idempotencyKey,
      issuedAt: command.issuedAt,
      actorId: ctx.actorId,
      submittedAt: now,
      availableAt,
      auditDigest,
    };
    const record: MutableCommandRecord = {
      envelope,
      state: "queued",
      attempts: 0,
      failures: 0,
      lastFailureReason: null,
      nextAttemptAt: null,
      claimedAt: null,
      completedAt: null,
      result: null,
    };
    state.records.set(String(id), record);
    state.byDedupe.set(dedupeKey, id);
    return ok({ command: envelope, receivedAt: now, duplicate: false });
  }

  // --- claim (ack) ---

  /**
   * The executor acknowledges the command (claims it for execution):
   * queued/retry-scheduled → executing, attempts += 1. Idempotent: acking
   * an executing command is a no-op returning duplicate: true (the attempt
   * counter increments ONCE per claim).
   */
  ack(input: {
    readonly ctx: TenantContext;
    readonly commandId: CommandId | string;
    readonly now: number;
  }): Result<{ readonly record: CommandRecord; readonly duplicate: boolean }, CommandQueueRejection> {
    const record = this.find(input.ctx, input.commandId);
    if (!record) return fail("command-not-found");
    if (record.state === "executing") {
      return ok({ record, duplicate: true });
    }
    if (record.state !== "queued" && record.state !== "retry-scheduled") {
      return fail("illegal-state");
    }
    record.state = "executing";
    record.attempts += 1;
    record.claimedAt = input.now;
    record.nextAttemptAt = null;
    return ok({ record, duplicate: false });
  }

  // --- complete ---

  complete(input: {
    readonly ctx: TenantContext;
    readonly commandId: CommandId | string;
    readonly result?: unknown;
    readonly now: number;
  }): Result<CommandCompletion, CommandQueueRejection> {
    const record = this.find(input.ctx, input.commandId);
    if (!record) return fail("command-not-found");
    if (record.state === "completed") {
      return ok({ outcome: outcomeOf(record), duplicate: true });
    }
    if (record.state !== "executing") {
      return fail("illegal-state");
    }
    record.state = "completed";
    record.completedAt = input.now;
    record.result = input.result ?? null;
    return ok({ outcome: outcomeOf(record), duplicate: false });
  }

  // --- fail (retry / dead-letter) ---

  /**
   * Report a failed attempt from the executing state. Schedules the next
   * attempt at now + delay(failures) per the deterministic policy, or
   * dead-letters with reason "max-attempts-exceeded" when the policy is
   * exhausted.
   */
  fail(input: {
    readonly ctx: TenantContext;
    readonly commandId: CommandId | string;
    readonly reason: string;
    readonly now: number;
  }): Result<CommandFailResult, CommandQueueRejection> {
    const record = this.find(input.ctx, input.commandId);
    if (!record) return fail("command-not-found");
    if (record.state !== "executing") {
      return fail("illegal-state");
    }
    record.failures += 1;
    record.lastFailureReason = input.reason;
    const delay = attemptDelayMs(this.policy, record.failures);
    if (delay === null) {
      record.state = "dead-lettered";
      record.completedAt = input.now;
      record.nextAttemptAt = null;
      return ok({
        commandId: record.envelope.id,
        state: "dead-lettered",
        attempts: record.attempts,
        failures: record.failures,
        nextAttemptAt: null,
        reason: "max-attempts-exceeded",
      });
    }
    record.state = "retry-scheduled";
    record.nextAttemptAt = input.now + delay;
    return ok({
      commandId: record.envelope.id,
      state: "retry-scheduled",
      attempts: record.attempts,
      failures: record.failures,
      nextAttemptAt: record.nextAttemptAt,
      reason: input.reason,
    });
  }

  // --- drain semantics ---

  /**
   * Pure read: the commands currently DUE at logical time `now` — queued
   * commands whose availableAt <= now and retry-scheduled commands whose
   * nextAttemptAt <= now. Ordered by submission sequence.
   */
  due(input: {
    readonly ctx: TenantContext;
    readonly now: number;
  }): ReadonlyArray<CommandRecord> {
    const state = this.tenants.get(String(input.ctx.tenantId));
    if (!state) return [];
    const out: MutableCommandRecord[] = [];
    for (const record of state.records.values()) {
      if (
        (record.state === "queued" && record.envelope.availableAt <= input.now) ||
        (record.state === "retry-scheduled" &&
          record.nextAttemptAt !== null &&
          record.nextAttemptAt <= input.now)
      ) {
        out.push(record);
      }
    }
    return out;
  }

  /**
   * A drain pass: claims EVERYTHING currently due at the logical time
   * `now` (the same transition as `ack`, attempts += 1 each). A second
   * drain at the same `now` returns an empty array — the commands are
   * executing, not due.
   */
  drain(input: {
    readonly ctx: TenantContext;
    readonly now: number;
  }): ReadonlyArray<CommandRecord> {
    const claimed = this.due(input);
    for (const record of claimed) {
      const mutable = record as MutableCommandRecord;
      mutable.state = "executing";
      mutable.attempts += 1;
      mutable.claimedAt = input.now;
      mutable.nextAttemptAt = null;
    }
    return claimed;
  }

  // --- reads (tenant fail-closed) ---

  findById(
    ctx: TenantContext,
    commandId: CommandId | string,
  ): Result<CommandRecord, CommandQueueRejection> {
    const record = this.find(ctx, commandId);
    if (!record) return fail("command-not-found");
    return ok(record);
  }

  listByTenant(ctx: TenantContext): ReadonlyArray<CommandRecord> {
    const state = this.tenants.get(String(ctx.tenantId));
    if (!state) return [];
    return [...state.records.values()];
  }

  // --- internals ---

  private tenantState(tenantKey: string): TenantQueueState {
    let state = this.tenants.get(tenantKey);
    if (!state) {
      state = {
        records: new Map<string, MutableCommandRecord>(),
        byDedupe: new Map<string, CommandId>(),
        counter: 0,
      };
      this.tenants.set(tenantKey, state);
    }
    return state;
  }

  /** Tenant-scoped lookup; cross-tenant ids are NOT found (fail closed). */
  private find(
    ctx: TenantContext,
    commandId: CommandId | string,
  ): MutableCommandRecord | null {
    const id = String(commandId);
    if (!isCommandId(id)) return null;
    const state = this.tenants.get(String(ctx.tenantId));
    if (!state) return null;
    return state.records.get(id) ?? null;
  }
}

function outcomeOf(record: MutableCommandRecord): CommandOutcome {
  return {
    commandId: record.envelope.id,
    state: record.state === "completed" ? "completed" : "dead-lettered",
    attempts: record.attempts,
    failures: record.failures,
    reason:
      record.state === "dead-lettered"
        ? "max-attempts-exceeded"
        : record.lastFailureReason,
    at: record.completedAt ?? 0,
  };
}

// ---------------------------------------------------------------------------
// queueAsSubmitPort — the composition seam for the mission package.
//
// Structurally satisfies the mission package's `CommandSubmitPort`
// contract (submit → { commandId, duplicate } | string rejection) without
// importing mission: the TL binds a CommandQueue behind the mission
// runtime through this adapter. Compile-pinned in the test suite against
// the mission port's structural mirror.
// ---------------------------------------------------------------------------

export interface SubmitPortAck {
  readonly commandId: string;
  readonly duplicate: boolean;
}

export interface CommandSubmitPortShape {
  submit(input: {
    readonly ctx: TenantContext;
    readonly command: SubmitCommandInput;
  }): Result<SubmitPortAck, CommandSubmitRejection>;
}

export function queueAsSubmitPort(queue: CommandQueue): CommandSubmitPortShape {
  return {
    submit(input) {
      const submitted = queue.submit({
        ctx: input.ctx,
        command: input.command,
        now: input.command.issuedAt,
      });
      if (!submitted.ok) return fail(submitted.reason);
      return ok({
        commandId: String(submitted.value.command.id),
        duplicate: submitted.value.duplicate,
      });
    },
  };
}
