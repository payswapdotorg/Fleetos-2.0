/**
 * @fleetos/agent — Wave 3 command inbox lifecycle (F230A).
 *
 * The F220A `edge-path.ts` shipped durable ack types (received/duplicate/
 * rejected). The F220A `kernel.ts` shipped basic command acks. F230A
 * advances to the FULL command lifecycle:
 *
 *   - **ack/apply/verify lifecycle** — each command transitions through
 *     `received -> applying -> applied -> verified` (or `refused` at any
 *     stage). The lifecycle is a state machine; illegal transitions are
 *     refused with typed reason codes.
 *   - **idempotency** — a command applied twice reports once. The
 *     `applied` state is sticky: re-applying an already-applied command
 *     returns the prior `applied` result with `duplicate=true`. The
 *     command is NOT re-executed.
 *   - **refusal reasons** — `trust-too-low`, `command-malformed`,
 *     `already-applied`, `verify-failed`, `apply-failed`.
 *   - **verification evidence refs** — after a command is applied, the
 *     agent emits a verification evidence ref back to the sender. The
 *     evidence ref carries the command ID + the applied result's digest.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type { AgentIdLike, TenantIdLike } from "./agent.js";
import type { AuditEventRef } from "./kernel.js";
import { type Capability, type TrustLevel, hasCapability } from "./trust-ladder.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Command record + lifecycle states
// ---------------------------------------------------------------------------

export interface InboxCommand {
  readonly id: string;
  readonly tenantId: TenantIdLike;
  readonly agentId: AgentIdLike;
  readonly kind: string;
  readonly requiredCapability: Capability;
  readonly at: number;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export type CommandLifecycleState =
  | "received"
  | "applying"
  | "applied"
  | "verified"
  | "refused";

export interface InboxCommandRecord {
  readonly command: InboxCommand;
  readonly state: CommandLifecycleState;
  readonly receivedAt: number;
  readonly stateChangedAt: number;
  readonly refusalReason?: CommandRefusalCode;
  readonly appliedResultDigest?: string; // digest of the apply result (for verification)
  readonly verificationEvidenceDigest?: string; // digest of the verification evidence
  readonly applyAttempts: number;
}

// ---------------------------------------------------------------------------
// Refusal reasons
// ---------------------------------------------------------------------------

export type CommandRefusalCode =
  | "trust-too-low"
  | "command-malformed"
  | "already-applied"
  | "apply-failed"
  | "verify-failed"
  | "illegal-transition";

// ---------------------------------------------------------------------------
// CommandInboxLog — the agent's persistent log of command records. Keyed
// by command ID. Bounded; oldest records evicted when bound exceeded.
// ---------------------------------------------------------------------------

export interface CommandInboxLog {
  readonly records: ReadonlyMap<string, InboxCommandRecord>;
  readonly maxSize: number;
}

export function emptyCommandInboxLog(maxSize = 256): CommandInboxLog {
  return { records: new Map(), maxSize };
}

// ---------------------------------------------------------------------------
// receiveCommand — initial receipt. Idempotent: re-receiving the same
// command ID returns the existing record with `state=received` (or its
// current state if it has progressed).
// ---------------------------------------------------------------------------

export type ReceiveCommandResult =
  | {
      readonly ok: true;
      readonly record: InboxCommandRecord;
      readonly log: CommandInboxLog;
      readonly audit: AuditEventRef;
      readonly duplicate: boolean;
    }
  | { readonly ok: false; readonly reason: "command-malformed" };

export function receiveCommand(
  log: CommandInboxLog,
  command: InboxCommand,
  at: number,
): ReceiveCommandResult {
  if (command.id === "" || command.kind === "") {
    return { ok: false, reason: "command-malformed" };
  }
  const existing = log.records.get(command.id);
  if (existing) {
    const audit: AuditEventRef = {
      actor: command.agentId,
      intent: "agent:inbox:receive:duplicate",
      tenant: command.tenantId,
      timestamp: at,
      digest: digestOf(command.agentId, command.id, "receive-dup", at),
    };
    return { ok: true, record: existing, log, audit, duplicate: true };
  }
  const record: InboxCommandRecord = {
    command,
    state: "received",
    receivedAt: at,
    stateChangedAt: at,
    applyAttempts: 0,
  };
  let records = log.records;
  if (records.size >= log.maxSize) {
    // Drop oldest ~25%.
    const keep = Math.floor(log.maxSize * 0.75);
    const arr = [...records.entries()];
    records = new Map(arr.slice(arr.length - keep));
  }
  const next = new Map(records);
  next.set(command.id, record);
  const audit: AuditEventRef = {
    actor: command.agentId,
    intent: "agent:inbox:receive",
    tenant: command.tenantId,
    timestamp: at,
    digest: digestOf(command.agentId, command.id, "receive", at),
  };
  return { ok: true, record, log: { records: next, maxSize: log.maxSize }, audit, duplicate: false };
}

// ---------------------------------------------------------------------------
// applyCommand — the canonical apply step. Consults the trust level for
// capability gating. Idempotent: re-applying an already-applied command
// returns the prior result with `duplicate=true`; the command is NOT
// re-executed.
// ---------------------------------------------------------------------------

export interface ApplyResult {
  readonly ok: boolean;
  readonly resultDigest: string; // sha-256 of the apply result payload
  readonly at: number;
  readonly error?: string;
}

export type ApplyCommandResult =
  | {
      readonly ok: true;
      readonly record: InboxCommandRecord;
      readonly log: CommandInboxLog;
      readonly audit: AuditEventRef;
      readonly duplicate: boolean;
      readonly applyResult: ApplyResult;
    }
  | { readonly ok: false; readonly reason: CommandRefusalCode; readonly log: CommandInboxLog };

export function applyCommand(
  log: CommandInboxLog,
  commandId: string,
  trustLevel: TrustLevel,
  applyFn: (command: InboxCommand) => ApplyResult,
  at: number,
): ApplyCommandResult {
  const record = log.records.get(commandId);
  if (!record) {
    return { ok: false, reason: "command-malformed", log };
  }
  // Capability gate — trust-too-low refusal.
  if (!hasCapability(trustLevel, record.command.requiredCapability)) {
    const refused: InboxCommandRecord = {
      ...record,
      state: "refused",
      stateChangedAt: at,
      refusalReason: "trust-too-low",
    };
    const next = new Map(log.records);
    next.set(commandId, refused);
    return { ok: false, reason: "trust-too-low", log: { records: next, maxSize: log.maxSize } };
  }
  // Idempotency: already-applied command returns prior result with duplicate=true.
  if (record.state === "applied" || record.state === "verified") {
    const audit: AuditEventRef = {
      actor: record.command.agentId,
      intent: "agent:inbox:apply:duplicate",
      tenant: record.command.tenantId,
      timestamp: at,
      digest: digestOf(record.command.agentId, commandId, "apply-dup", at),
    };
    return {
      ok: true,
      record,
      log,
      audit,
      duplicate: true,
      applyResult: {
        ok: true,
        resultDigest: record.appliedResultDigest ?? "",
        at: record.stateChangedAt,
      },
    };
  }
  // Refused commands cannot be re-applied.
  if (record.state === "refused") {
    return { ok: false, reason: record.refusalReason ?? "apply-failed", log };
  }
  // Apply the command.
  const applyResult = applyFn(record.command);
  const newState: CommandLifecycleState = applyResult.ok ? "applied" : "refused";
  const updated: InboxCommandRecord = {
    ...record,
    state: newState,
    stateChangedAt: at,
    refusalReason: applyResult.ok ? undefined : "apply-failed",
    appliedResultDigest: applyResult.resultDigest,
    applyAttempts: record.applyAttempts + 1,
  };
  const next = new Map(log.records);
  next.set(commandId, updated);
  const audit: AuditEventRef = {
    actor: record.command.agentId,
    intent: applyResult.ok ? "agent:inbox:apply:ok" : "agent:inbox:apply:failed",
    tenant: record.command.tenantId,
    timestamp: at,
    digest: digestOf(record.command.agentId, commandId, "apply", applyResult.ok ? "ok" : "fail", at),
  };
  if (applyResult.ok) {
    return {
      ok: true,
      record: updated,
      log: { records: next, maxSize: log.maxSize },
      audit,
      duplicate: false,
      applyResult,
    };
  }
  return { ok: false, reason: "apply-failed", log: { records: next, maxSize: log.maxSize } };
}

// ---------------------------------------------------------------------------
// verifyCommand — emits a verification evidence ref back to the sender.
// The evidence ref carries the command ID + the applied result's digest.
// A command that was not applied cannot be verified.
// ---------------------------------------------------------------------------

export interface VerificationEvidence {
  readonly commandId: string;
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly appliedResultDigest: string;
  readonly verifiedAt: number;
  readonly evidenceDigest: string; // sha-256 over (commandId, agentId, appliedResultDigest, verifiedAt)
}

export type VerifyCommandResult =
  | {
      readonly ok: true;
      readonly record: InboxCommandRecord;
      readonly log: CommandInboxLog;
      readonly audit: AuditEventRef;
      readonly evidence: VerificationEvidence;
    }
  | { readonly ok: false; readonly reason: CommandRefusalCode; readonly log: CommandInboxLog };

export function verifyCommand(
  log: CommandInboxLog,
  commandId: string,
  at: number,
): VerifyCommandResult {
  const record = log.records.get(commandId);
  if (!record) {
    return { ok: false, reason: "command-malformed", log };
  }
  if (record.state !== "applied") {
    return { ok: false, reason: "verify-failed", log };
  }
  const evidenceDigest = digestOf(record.command.agentId, commandId, record.appliedResultDigest ?? "", at);
  const evidence: VerificationEvidence = {
    commandId,
    agentId: record.command.agentId,
    tenantId: record.command.tenantId,
    appliedResultDigest: record.appliedResultDigest ?? "",
    verifiedAt: at,
    evidenceDigest,
  };
  const updated: InboxCommandRecord = {
    ...record,
    state: "verified",
    stateChangedAt: at,
    verificationEvidenceDigest: evidenceDigest,
  };
  const next = new Map(log.records);
  next.set(commandId, updated);
  const audit: AuditEventRef = {
    actor: record.command.agentId,
    intent: "agent:inbox:verify",
    tenant: record.command.tenantId,
    timestamp: at,
    digest: digestOf(record.command.agentId, commandId, "verify", at),
  };
  return { ok: true, record: updated, log: { records: next, maxSize: log.maxSize }, audit, evidence };
}
