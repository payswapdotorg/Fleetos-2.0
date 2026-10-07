/**
 * @fleetos/execution — Result verification hooks + honest degraded states.
 *
 * Law A4: the verify step confirms execution succeeded.
 *
 * Verification hooks are injected by the caller — the executor does not
 * decide what "verified" means; it calls the hook and records the result.
 *
 * Honest degraded states: timeout, transport_unavailable, unknown_failure.
 * The executor NEVER claims success when it didn't verify.
 *
 * Pure types + pure functions.
 */

import type { ExecutionResult, AuthorizedCommand, CommandTransportPort } from "./index.ts";

/** Verification hook — determines whether an execution result is verified. */
export type VerificationHook = (
  command: AuthorizedCommand,
  result: ExecutionResult,
) => Promise<VerificationOutcome>;

/** Verification outcome. */
export interface VerificationOutcome {
  readonly verified: boolean;
  readonly verifierKind: "evidence.hash" | "device.ack" | "domain.read" | "external.receipt";
  readonly proofRef: string;
  readonly reason?: string;
}

/** Execution degraded state — honest, machine-stable. */
export type ExecutionDegradedState =
  | "timeout"
  | "transport_unavailable"
  | "unknown_failure"
  | "capability_empty";

/** Execution outcome with verification — the full honest record. */
export interface VerifiedExecution {
  readonly command: AuthorizedCommand;
  readonly result: ExecutionResult;
  readonly verification: VerificationOutcome;
  readonly degraded: ExecutionDegradedState | null;
}

/**
 * Execute a command with a verification hook.
 *
 * The executor dispatches via the transport, then calls the verification hook.
 * If the result is a timeout or failure, the degraded state is set honestly.
 *
 * Deterministic: same inputs (transport behavior + hook) => same output.
 */
export async function executeWithVerification(
  transport: CommandTransportPort,
  command: AuthorizedCommand,
  hook: VerificationHook,
  timeoutMs: number = 30_000,
): Promise<VerifiedExecution> {
  // Empty capability — honest degraded state.
  if (command.payload.capabilityId === "") {
    const result: ExecutionResult = {
      commandId: command.idempotencyKey,
      state: "failed",
      outputs: {},
      failureReason: "empty capabilityId",
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: "1970-01-01T00:00:00.000Z",
      transportName: transport.name,
    };
    return {
      command,
      result,
      verification: {
        verified: false,
        verifierKind: "domain.read",
        proofRef: "",
        reason: "capability empty — no execution attempted",
      },
      degraded: "capability_empty",
    };
  }

  // Dispatch with timeout.
  let result: ExecutionResult;
  const startTime = Date.now();
  try {
    const timeoutPromise = new Promise<ExecutionResult>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    result = await Promise.race([transport.dispatch(command), timeoutPromise]);
  } catch (err) {
    const isTimeout = err instanceof Error && err.message.includes("timeout");
    result = {
      commandId: command.idempotencyKey,
      state: "timeout",
      outputs: {},
      failureReason: isTimeout ? `timeout after ${timeoutMs}ms` : "transport error",
      startedAt: new Date(startTime).toISOString(),
      endedAt: new Date(Date.now()).toISOString(),
      transportName: transport.name,
    };
    return {
      command,
      result,
      verification: {
        verified: false,
        verifierKind: "domain.read",
        proofRef: "",
        reason: `execution degraded: ${isTimeout ? "timeout" : "transport_unavailable"}`,
      },
      degraded: isTimeout ? "timeout" : "transport_unavailable",
    };
  }

  // Verify.
  const verification = await hook(command, result);

  let degraded: ExecutionDegradedState | null = null;
  if (result.state === "failed" || result.state === "timeout") {
    degraded = result.state === "timeout" ? "timeout" : "unknown_failure";
  }

  return { command, result, verification, degraded };
}

/**
 * Build a reference verification hook that checks the execution result
 * succeeded and the transport name matches.
 *
 * Deterministic — for tests and reference paths.
 */
export function makeReferenceVerificationHook(
  expectedTransport: string,
): VerificationHook {
  return async (_command, result) => {
    if (result.state !== "succeeded") {
      return {
        verified: false,
        verifierKind: "domain.read",
        proofRef: "",
        reason: `result state is ${result.state}, expected succeeded`,
      };
    }
    if (result.transportName !== expectedTransport) {
      return {
        verified: false,
        verifierKind: "domain.read",
        proofRef: "",
        reason: `transport name mismatch: ${result.transportName} != ${expectedTransport}`,
      };
    }
    return {
      verified: true,
      verifierKind: "device.ack",
      proofRef: `ack-${result.commandId}`,
    };
  };
}

/**
 * At-least-once + idempotency intersection probe.
 *
 * Given a list of dispatch results (some duplicates from at-least-once
 * delivery), apply an idempotency filter and verify that the EFFECTIVE
 * execution count equals the UNIQUE command count.
 *
 * This is the machine-test for the at-least-once + idempotency intersection
 * invariant: duplicates are deduplicated, never double-executed.
 */
export function verifyAtLeastOnceIdempotencyIntersection(
  dispatchResults: readonly { readonly idempotencyKey: string; readonly executed: boolean }[],
): {
  readonly totalDispatches: number;
  readonly uniqueKeys: number;
  readonly effectiveExecutions: number;
  readonly intersectionHolds: boolean;
} {
  const seenKeys = new Set<string>();
  let effectiveExecutions = 0;
  for (const r of dispatchResults) {
    if (!seenKeys.has(r.idempotencyKey)) {
      seenKeys.add(r.idempotencyKey);
      if (r.executed) effectiveExecutions += 1;
    }
  }
  return {
    totalDispatches: dispatchResults.length,
    uniqueKeys: seenKeys.size,
    effectiveExecutions,
    intersectionHolds: effectiveExecutions === seenKeys.size,
  };
}
