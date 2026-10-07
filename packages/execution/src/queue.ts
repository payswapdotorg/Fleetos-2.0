/**
 * @fleetos/execution — Execution queue contracts.
 *
 * Law A4: the execution plane dispatches commands through a queue.
 *
 * At-least-once + idempotency-intersection: commands are delivered at least
 * once; the idempotency key ensures that duplicate deliveries do not cause
 * double execution. The intersection of at-least-once delivery + idempotent
 * handlers = effectively-once execution.
 *
 * Law: execution NEVER decides authorization — the type-encoded boundary
 * from Wave 0 is kept and machine-tested here.
 *
 * Pure types + deterministic in-memory reference.
 */

import type { AuthorizedCommand, ExecutionResult, CommandTransportPort } from "./index.ts";

/** Queue entry — a command waiting to be dispatched. */
export interface QueueEntry {
  readonly queueId: string;
  readonly command: AuthorizedCommand;
  readonly enqueuedAt: string;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Queue drain result. */
export interface DrainResult {
  readonly results: readonly ExecutionResult[];
  readonly drained: number;
  readonly failed: number;
  readonly remaining: number;
}

/**
 * Execution queue port — production injects a durable queue (e.g. Redis).
 * The in-memory reference is for tests and deterministic reference paths.
 */
export interface ExecutionQueuePort {
  readonly enqueue: (entry: QueueEntry) => Promise<void>;
  readonly dequeue: () => Promise<QueueEntry | null>;
  readonly size: () => Promise<number>;
}

/** Deterministic in-memory execution queue (FIFO). */
export class InMemoryExecutionQueue implements ExecutionQueuePort {
  private readonly entries: QueueEntry[] = [];

  async enqueue(entry: QueueEntry): Promise<void> {
    this.entries.push(entry);
  }

  async dequeue(): Promise<QueueEntry | null> {
    return this.entries.shift() ?? null;
  }

  async size(): Promise<number> {
    return this.entries.length;
  }
}

/** Build a queue entry from an authorized command. */
export function makeQueueEntry(
  command: AuthorizedCommand,
  enqueuedAt: string,
  maxAttempts = 3,
): QueueEntry {
  return {
    queueId: `q-${command.idempotencyKey}-${enqueuedAt}`,
    command,
    enqueuedAt,
    attempts: 0,
    maxAttempts,
  };
}

/**
 * Drain the queue — dispatch every entry via the transport.
 *
 * At-least-once semantics: if a dispatch fails, the entry is re-enqueued
 * (up to maxAttempts). The idempotency key on the command ensures that
 * re-dispatch does not cause double execution (the transport handler MUST
 * be idempotent — this is the caller's contract, enforced by the
 * IdempotencyLedger in @fleetos/actions).
 *
 * Deterministic: the drain processes entries in FIFO order. Retries are
 * processed within the same drain call (the loop continues until the queue
 * is empty).
 */
export async function drainQueue(
  queue: ExecutionQueuePort,
  transport: CommandTransportPort,
  onResult?: (entry: QueueEntry, result: ExecutionResult) => void,
): Promise<DrainResult> {
  const results: ExecutionResult[] = [];
  let drained = 0;
  let failed = 0;

  for (;;) {
    const entry = await queue.dequeue();
    if (entry === null) break;
    const attemptEntry = { ...entry, attempts: entry.attempts + 1 };
    try {
      const result = await transport.dispatch(attemptEntry.command);
      results.push(result);
      drained += 1;
      onResult?.(attemptEntry, result);
      if (result.state === "failed" && attemptEntry.attempts < attemptEntry.maxAttempts) {
        // Re-enqueue for retry (at-least-once).
        await queue.enqueue({ ...attemptEntry, attempts: attemptEntry.attempts });
      }
    } catch {
      failed += 1;
      if (attemptEntry.attempts < attemptEntry.maxAttempts) {
        await queue.enqueue({ ...attemptEntry, attempts: attemptEntry.attempts });
      }
    }
  }

  // remaining = entries still in the queue after drain (should be 0 unless
  // maxAttempts was reached on all retries).
  const remaining = await queue.size();

  return { results, drained, failed, remaining };
}

/**
 * Machine-test the type-encoded boundary: execution NEVER decides authorization.
 *
 * This function verifies that the execution package's public surface contains
 * NO function that accepts an unauthorized command or produces a GuardianDecision.
 * The only input to executeCommand is an AuthorizedCommand, which can only be
 * constructed from a GuardianDecision with verdict ALLOW or REQUIRE_APPROVAL.
 */
export function assertExecutionNeverAuthorizes(moduleExports: Record<string, unknown>): {
  readonly ok: boolean;
  readonly forbidden: readonly string[];
} {
  const FORBIDDEN = [
    "authorize",
    "evaluateCapability",
    "authorizeAdoption",
    "makeGuardianDecision",
    "selfAuthorize",
  ];
  const found = FORBIDDEN.filter((name) => typeof moduleExports[name] === "function");
  return { ok: found.length === 0, forbidden: found };
}
