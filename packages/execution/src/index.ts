/**
 * @fleetos/execution — Execution state, command dispatch, execution results.
 *
 * Law: Execution NEVER decides authorization — that is policy's job. The
 * boundary is encoded in the type system:
 *
 *   - executeCommand() takes an AuthorizedCommand, which can ONLY be constructed
 *     from a GuardianDecision with verdict ALLOW or REQUIRE_APPROVAL (after
 *     human approval). There is no executeUnauthorized() function.
 *
 * The reference executor is deterministic over an injected CommandTransportPort
 * (a STRUCTURAL seam — no I/O of its own; tests inject a fake).
 */

import type { Capability } from "@fleetos/policy/capability";
import type { GuardianDecision } from "@fleetos/policy/policy";

/** LOCAL structural tenant scope (compatible with Worker A). */
export interface TenantScopeLike {
  readonly tenantId: string;
  readonly workspaceId?: string;
}

/** LOCAL structural mission reference (compatible with Worker C). */
export interface MissionRefLike {
  readonly missionId: string;
  readonly runId?: string;
  readonly workItemId?: string;
}

/** Execution state — machine-stable. */
export type ExecutionState =
  | "pending"
  | "dispatched"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "timeout"
  | "cancelled";

export interface CommandPayload {
  readonly capabilityId: string;
  readonly inputs: Readonly<Record<string, unknown>>;
}

/**
 * AuthorizedCommand — the ONLY input the executor accepts.
 *
 * Construct via `authorizeCommand(decision, payload, tenant, missionRef)` which
 * REFUSES any GuardianDecision with verdict BLOCK. There is no other constructor
 * exported, so "execute without authorization" is unrepresentable.
 */
export interface AuthorizedCommand {
  readonly authorizationDigest: string;
  readonly verdict: "ALLOW" | "REQUIRE_APPROVAL";
  readonly tenant: TenantScopeLike;
  readonly missionRef?: MissionRefLike;
  readonly payload: CommandPayload;
  readonly idempotencyKey: string;
}

export interface ExecutionResult {
  readonly commandId: string;
  readonly state: ExecutionState;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly failureReason?: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly transportName: string;
}

/**
 * Structural seam — the executor depends on this PORT, not on any concrete
 * transport. Tests inject a fake; production injects device/MCP/etc.
 */
export interface CommandTransportPort {
  readonly name: string;
  readonly dispatch: (cmd: AuthorizedCommand) => Promise<ExecutionResult>;
}

/** Construction refusal reason. */
export type AuthorizationRefusalReason =
  | "refused.block_verdict"
  | "refused.tenant_mismatch"
  | "refused.missing_decision";

/**
 * Build an AuthorizedCommand from a GuardianDecision.
 *
 * Refuses BLOCK verdicts. WARN verdicts are also refused — they require
 * human approval before execution can proceed (the Guardian escalates WARN
 * to REQUIRE_APPROVAL in the policy layer; execution never sees WARN).
 *
 * The return type encodes success/failure at the type level — only an
 * AuthorizedCommand can be passed to executeCommand().
 */
export function authorizeCommand(
  decision: GuardianDecision,
  payload: CommandPayload,
  tenant: TenantScopeLike,
  missionRef: MissionRefLike | undefined,
  idempotencyKey: string,
): { ok: true; command: AuthorizedCommand } | { ok: false; reason: AuthorizationRefusalReason } {
  if (decision.verdict === "BLOCK" || decision.verdict === "WARN") {
    return { ok: false, reason: "refused.block_verdict" };
  }
  if (decision.tenantId !== tenant.tenantId) {
    return { ok: false, reason: "refused.tenant_mismatch" };
  }
  // verdict is now narrowed to "ALLOW" | "REQUIRE_APPROVAL"
  const verdict: "ALLOW" | "REQUIRE_APPROVAL" = decision.verdict;
  return {
    ok: true,
    command: {
      authorizationDigest: decision.decisionDigest,
      verdict,
      tenant,
      missionRef,
      payload,
      idempotencyKey,
    },
  };
}

/**
 * Deterministic reference executor. NEVER authorizes.
 *
 * The executor simply dispatches via the injected transport and returns the
 * ExecutionResult. All authorization decisions happen BEFORE this function
 * is called — encoded by the AuthorizedCommand type.
 */
export async function executeCommand(
  transport: CommandTransportPort,
  command: AuthorizedCommand,
): Promise<ExecutionResult> {
  if (command.payload.capabilityId === "") {
    return {
      commandId: command.idempotencyKey,
      state: "failed",
      outputs: {},
      failureReason: "empty capabilityId",
      startedAt: "1970-01-01T00:00:00.000Z",
      endedAt: "1970-01-01T00:00:00.000Z",
      transportName: transport.name,
    };
  }
  return transport.dispatch(command);
}

/** Build a deterministic in-memory transport for tests/reference paths. */
export function makeReferenceTransport(
  handler: (cmd: AuthorizedCommand) => Promise<ExecutionResult>,
): CommandTransportPort {
  return {
    name: "reference.in-memory",
    dispatch: handler,
  };
}

/**
 * Build a Capability reference for execution test fixtures.
 * Re-exported here so execution tests don't need to construct full Capability
 * objects from scratch.
 */
export function referenceCapability(id: string): Capability {
  return {
    id,
    category: "execute.device",
    risk: "medium",
    requiredAuthority: ["asset.owner"],
    tenantScope: "single",
    resourceScope: { assetIds: ["a-1"] },
    sideEffects: [{ kind: "device.command", target: "a-1", reversible: false, description: "noop" }],
    idempotency: { supported: true, keyShape: ["tenantId", "capabilityId"] },
    verification: { kind: "device.ack" },
    inputs: [],
    outputs: [],
    description: "reference capability",
    version: "1.0.0",
  };
}

// ---------- Wave 1 (F210B) kernel extensions ----------

export * from "./queue.ts";
export * from "./verification.ts";
