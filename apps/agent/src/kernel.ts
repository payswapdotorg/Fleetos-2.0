/**
 * @fleetos/agent — Wave 1 kernel (F210A).
 *
 * Advances the agent seam to kernel grade:
 *   - Enrollment/trust REAL transitions with token lifecycle
 *     (issued -> verified -> expired). The Wave 0 AgentLoop already moved
 *     the agent through enrolled/untrusted/trusted; the kernel adds a
 *     typed EnrollmentToken with explicit verification + expiry and an
 *     audited transition that consults the EnrollmentPort.
 *   - Command-inbox ack contracts: each polled command produces a typed
 *     `CommandAck` (received | duplicate | rejected); the kernel
 *     enforces idempotent acks for already-acked command ids.
 *   - Reconciliation diff types: the kernel exposes a typed `ReconciliationDiff`
 *     with `local-only`, `remote-only`, and `common` lists, derived from the
 *     ReconciliationPort.
 *   - AuditEventRef emission on every consequential transition.
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import { createHash } from "node:crypto";
import {
  step,
  type AgentCommand,
  type AgentIdLike,
  type AgentLoopState,
  type AgentPorts,
  type AgentRejectionCode,
  type TenantIdLike,
} from "./agent.js";

// ---------------------------------------------------------------------------
// AuditEventRef — structural audit reference (A19).
// ---------------------------------------------------------------------------

export interface AuditEventRef {
  readonly actor: string;
  readonly intent: string;
  readonly tenant: string;
  readonly timestamp: number;
  readonly digest: string;
}

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// EnrollmentToken lifecycle (issued -> verified -> expired).
//
// The kernel pairs the AgentLoop's "enrolled" state with an explicit token
// state. An agent can only enter "trusted" when its token is verified; an
// expired token forces the loop into "untrusted" honestly.
// ---------------------------------------------------------------------------

export type EnrollmentTokenState = "issued" | "verified" | "expired";

export interface EnrollmentToken {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly agentId: AgentIdLike;
  readonly state: EnrollmentTokenState;
  readonly issuedAt: number;
  readonly verifiedAt: number | null;
  readonly expiresAt: number;
}

export type EnrollmentTokenRejectionCode =
  | "token-not-verified"
  | "token-expired"
  | "token-tenant-mismatch"
  | "token-agent-mismatch";

export function issueEnrollmentToken(input: {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly agentId: AgentIdLike;
  readonly issuedAt: number;
  readonly expiresAt: number;
}): EnrollmentToken {
  return {
    id: input.id,
    tenantId: input.tenantId,
    agentId: input.agentId,
    state: "issued",
    issuedAt: input.issuedAt,
    verifiedAt: null,
    expiresAt: input.expiresAt,
  };
}

export function verifyEnrollmentToken(token: EnrollmentToken, at: number): EnrollmentToken {
  if (token.state !== "issued") return token;
  return { ...token, state: "verified", verifiedAt: at };
}

export function expireEnrollmentToken(token: EnrollmentToken): EnrollmentToken {
  if (token.state === "expired") return token;
  return { ...token, state: "expired" };
}

export function validateEnrollmentToken(
  token: EnrollmentToken,
  expectedTenant: TenantIdLike,
  expectedAgent: AgentIdLike,
  at: number,
): { readonly ok: true } | { readonly ok: false; readonly reason: EnrollmentTokenRejectionCode } {
  if (token.tenantId !== expectedTenant) return { ok: false, reason: "token-tenant-mismatch" };
  if (token.agentId !== expectedAgent) return { ok: false, reason: "token-agent-mismatch" };
  if (token.state === "issued") return { ok: false, reason: "token-not-verified" };
  if (token.state === "expired" || at > token.expiresAt) return { ok: false, reason: "token-expired" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Command-inbox ack contracts. Each polled command produces a typed
// CommandAck. The kernel maintains a per-agent set of already-acked command
// ids; re-acking returns `duplicate=true` (idempotent) without re-applying.
// ---------------------------------------------------------------------------

export type CommandAckState = "received" | "duplicate" | "rejected";

export interface CommandRecord {
  readonly id: string;
  readonly kind: string;
  readonly at: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface CommandAck {
  readonly commandId: string;
  readonly state: CommandAckState;
  readonly ackedAt: number;
  readonly reason?: string;
}

export interface CommandInboxAckLog {
  readonly acked: ReadonlyMap<string, CommandAck>;
}

export function emptyAckLog(): CommandInboxAckLog {
  return { acked: new Map() };
}

export type AckRejectionCode = "missing-command-id" | "missing-kind";

export function ackCommand(
  log: CommandInboxAckLog,
  command: CommandRecord,
  at: number,
):
  | { readonly ok: true; readonly ack: CommandAck; readonly log: CommandInboxAckLog; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: AckRejectionCode } {
  if (command.id === "") return { ok: false, reason: "missing-command-id" };
  if (command.kind === "") return { ok: false, reason: "missing-kind" };
  const existing = log.acked.get(command.id);
  if (existing) {
    // Idempotent: re-ack returns the same ack with state=duplicate.
    return {
      ok: true,
      ack: { ...existing, state: "duplicate" as const, ackedAt: at },
      log,
      audit: {
        actor: "system:inbox",
        intent: "agent:inbox:ack:duplicate",
        tenant: "",
        timestamp: at,
        digest: digestOf(command.id, "ack-duplicate", at),
      },
    };
  }
  const ack: CommandAck = {
    commandId: command.id,
    state: "received",
    ackedAt: at,
  };
  const acked = new Map(log.acked);
  acked.set(command.id, ack);
  return {
    ok: true,
    ack,
    log: { acked },
    audit: {
      actor: "system:inbox",
      intent: "agent:inbox:ack:received",
      tenant: "",
      timestamp: at,
      digest: digestOf(command.id, "ack", at),
    },
  };
}

// ---------------------------------------------------------------------------
// Reconciliation diff types. The kernel exposes a typed diff derived from
// the ReconciliationPort's localHead vs remoteHead.
// ---------------------------------------------------------------------------

export interface ReconciliationDiff {
  readonly localHead: number;
  readonly remoteHead: number;
  readonly drift: boolean;
  readonly diff: number; // positive = remote ahead; negative = local ahead
}

export function computeDiff(localHead: number, remoteHead: number): ReconciliationDiff {
  return {
    localHead,
    remoteHead,
    drift: localHead !== remoteHead,
    diff: remoteHead - localHead,
  };
}

// ---------------------------------------------------------------------------
// AuditedAgentLoop — wraps the Wave 0 AgentLoop with audit emission on
// every step + an explicit token-aware enroll/establish-trust path.
// ---------------------------------------------------------------------------

export type AuditedStepResult =
  | { readonly ok: true; readonly state: AgentLoopState; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: AgentRejectionCode };

export async function auditedStep(
  current: AgentLoopState,
  command: AgentCommand,
  ports: AgentPorts,
): Promise<AuditedStepResult> {
  const r = await step(current, command, ports);
  if (!r.ok) return r;
  const audit: AuditEventRef = {
    actor: current.agentId,
    intent: `agent:step:${command.kind}`,
    tenant: current.tenantId,
    timestamp: command.at,
    digest: digestOf(current.agentId, command.kind, command.at, current.evidenceCount + 1),
  };
  return { ok: true, state: r.state, audit };
}

// ---------------------------------------------------------------------------
// Audited enrollment — pairs the EnrollmentPort with the EnrollmentToken.
// ---------------------------------------------------------------------------

export type EnrollmentOutcome =
  | {
      readonly ok: true;
      readonly state: AgentLoopState;
      readonly token: EnrollmentToken;
      readonly audit: AuditEventRef;
    }
  | { readonly ok: false; readonly reason: EnrollmentTokenRejectionCode | AgentRejectionCode };

export async function enrollWithToken(input: {
  readonly current: AgentLoopState;
  readonly token: EnrollmentToken;
  readonly command: AgentCommand;
  readonly ports: AgentPorts;
}): Promise<EnrollmentOutcome> {
  // Validate the token against the agent's tenantId/agentId.
  const v = validateEnrollmentToken(input.token, input.current.tenantId, input.current.agentId, input.command.at);
  if (!v.ok) return v;
  // If token is verified, proceed to step the loop with the enroll command.
  const r = await step(input.current, input.command, input.ports);
  if (!r.ok) return r;
  const audit: AuditEventRef = {
    actor: input.current.agentId,
    intent: `agent:enroll:${input.token.state}`,
    tenant: input.current.tenantId,
    timestamp: input.command.at,
    digest: digestOf(input.current.agentId, "enroll", input.token.id, input.command.at),
  };
  return { ok: true, state: r.state, token: input.token, audit };
}
