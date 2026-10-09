/**
 * @fleetos/adcos — Wave 5 command journal (F250A).
 *
 * The append-only dispatch journal behind the command lifecycle machine
 * (`command-lifecycle.ts`). Every lifecycle step is a typed journal event;
 * the lifecycle state is a PURE FOLD over the journal (same events ->
 * byte-identical state), with checkpoints to resume a fold from a prefix.
 * Events carry a strictly increasing `seq` and a CHAINED `AuditEventRef`
 * (each digest covers the previous digest + the event's own identity —
 * tamper-evident). `verifyCommandJournal` replays legality + the chain.
 * Fail-closed tenancy: keys are tenant-scoped; lookups never cross tenants.
 *
 * Pure deterministic TypeScript. Logical `now` everywhere; no timers, no
 * network, no randomness.
 */

import { createHash } from "node:crypto";
import type { AdcosCommandKind, AdcosRejectionCode } from "./adcos.js";
import type { AuditEventRef } from "./kernel.js";

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Journal events — append-only, one per lifecycle step.
// ---------------------------------------------------------------------------

interface JournalEventBase {
  readonly seq: number;
  readonly commandId: string;
  readonly tenantId: string;
  readonly at: number;
  readonly audit: AuditEventRef;
}

export interface CommandIssuedEvent extends JournalEventBase {
  readonly kind: "issued";
  readonly deviceId: string;
  readonly commandKind: AdcosCommandKind;
  readonly idempotencyKey: string;
  readonly expiresAt: number | null;
}

export interface CommandDispatchedEvent extends JournalEventBase {
  readonly kind: "dispatched";
  readonly attempt: number;
}

export interface CommandDispatchFailedEvent extends JournalEventBase {
  readonly kind: "dispatch-failed";
  readonly attempt: number;
  readonly code: AdcosRejectionCode;
  readonly backoffMs: number;
}

export interface CommandAcknowledgedEvent extends JournalEventBase {
  readonly kind: "acknowledged";
  readonly requestId: string;
}

export interface CommandResultedEvent extends JournalEventBase {
  readonly kind: "resulted";
  readonly ok: boolean;
  readonly resultDigest: string;
}

export interface CommandReconciledEvent extends JournalEventBase {
  readonly kind: "reconciled";
}

export interface CommandExpiredEvent extends JournalEventBase {
  readonly kind: "expired";
}

export interface CommandDeadLetteredEvent extends JournalEventBase {
  readonly kind: "dead-lettered";
  readonly code: AdcosRejectionCode;
  readonly attempts: number;
}

export type CommandJournalEvent =
  | CommandIssuedEvent
  | CommandDispatchedEvent
  | CommandDispatchFailedEvent
  | CommandAcknowledgedEvent
  | CommandResultedEvent
  | CommandReconciledEvent
  | CommandExpiredEvent
  | CommandDeadLetteredEvent;

export type CommandJournalEventKind = CommandJournalEvent["kind"];

// Distributive omit (a plain Omit collapses the union and would reject
// variant-specific fields on object literals).
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type CommandJournalEventDraft = DistributiveOmit<CommandJournalEvent, "audit" | "seq">;
export type CommandJournalEventWithSeq = DistributiveOmit<CommandJournalEvent, "audit">;

// ---------------------------------------------------------------------------
// Lifecycle phase per command. Terminal: `reconciled`, `expired`,
// `dead-letter`.
// ---------------------------------------------------------------------------

export type AdcosCommandPhase =
  | "issued"
  | "dispatched"
  | "acknowledged"
  | "resulted"
  | "reconciled"
  | "expired"
  | "dead-letter";

export interface AdcosCommandRecord {
  readonly commandId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly commandKind: AdcosCommandKind;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly expiresAt: number | null;
  readonly phase: AdcosCommandPhase;
  readonly attempts: number;
  readonly lastDispatchAt: number | null;
  readonly lastFailureCode: AdcosRejectionCode | null;
  readonly nextRetryAt: number | null;
  readonly backoffMs: number | null;
  readonly requestId: string | null;
  readonly acknowledgedAt: number | null;
  readonly resultOk: boolean | null;
  readonly resultDigest: string | null;
  readonly reconciledAt: number | null;
  readonly terminalAt: number | null;
  readonly deadLetterCode: AdcosRejectionCode | null;
}

export interface CommandJournalState {
  readonly events: ReadonlyArray<CommandJournalEvent>;
  readonly byId: ReadonlyMap<string, AdcosCommandRecord>;
  readonly byIdempotencyKey: ReadonlyMap<string, string>; // `${tenantId}|${key}` -> commandId
  readonly seq: number;
  readonly lastAuditDigest: string;
}

export const GENESIS_AUDIT_DIGEST = "adcos:command-journal:genesis";

export function emptyCommandJournal(): CommandJournalState {
  return {
    events: [],
    byId: new Map(),
    byIdempotencyKey: new Map(),
    seq: 0,
    lastAuditDigest: GENESIS_AUDIT_DIGEST,
  };
}

// Chained audit digest: covers the previous digest + the event identity.
export function chainedAuditDigest(
  prevDigest: string,
  event: CommandJournalEventWithSeq,
): string {
  return digestOf(
    prevDigest,
    event.kind,
    event.commandId,
    event.tenantId,
    event.seq,
    event.at,
  );
}

export function makeEventAudit(
  state: CommandJournalState,
  event: CommandJournalEventWithSeq,
  actor: string,
): AuditEventRef {
  const digest = chainedAuditDigest(state.lastAuditDigest, event);
  return {
    actor,
    intent: `adcos:command:${event.kind}:${event.commandId}`,
    tenant: event.tenantId,
    timestamp: event.at,
    digest,
  };
}

// ---------------------------------------------------------------------------
// Fold — apply one event; the pure reducer shared by every transition.
// ---------------------------------------------------------------------------

function issuedRecord(e: CommandIssuedEvent): AdcosCommandRecord {
  return {
    commandId: e.commandId,
    tenantId: e.tenantId,
    deviceId: e.deviceId,
    commandKind: e.commandKind,
    idempotencyKey: e.idempotencyKey,
    issuedAt: e.at,
    expiresAt: e.expiresAt,
    phase: "issued",
    attempts: 0,
    lastDispatchAt: null,
    lastFailureCode: null,
    nextRetryAt: null,
    backoffMs: null,
    requestId: null,
    acknowledgedAt: null,
    resultOk: null,
    resultDigest: null,
    reconciledAt: null,
    terminalAt: null,
    deadLetterCode: null,
  };
}

export function applyCommandEvent(
  state: CommandJournalState,
  event: CommandJournalEvent,
): CommandJournalState {
  if (event.seq !== state.seq + 1) return state; // append-only: out-of-order ignored
  const byId = new Map(state.byId);
  const byKey = new Map(state.byIdempotencyKey);
  const prev = byId.get(event.commandId) ?? null;

  switch (event.kind) {
    case "issued": {
      byId.set(event.commandId, issuedRecord(event));
      byKey.set(`${event.tenantId}|${event.idempotencyKey}`, event.commandId);
      break;
    }
    case "dispatched": {
      if (prev) byId.set(event.commandId, {
        ...prev,
        phase: "dispatched",
        attempts: event.attempt,
        lastDispatchAt: event.at,
      });
      break;
    }
    case "dispatch-failed": {
      if (prev) byId.set(event.commandId, {
        ...prev,
        phase: "issued", // retryable — back to issued with a scheduled retry
        lastFailureCode: event.code,
        backoffMs: event.backoffMs,
        nextRetryAt: event.at + event.backoffMs,
      });
      break;
    }
    case "acknowledged": {
      if (prev) byId.set(event.commandId, {
        ...prev,
        phase: "acknowledged",
        requestId: event.requestId,
        acknowledgedAt: event.at,
      });
      break;
    }
    case "resulted": {
      if (prev) byId.set(event.commandId, {
        ...prev,
        phase: "resulted",
        resultOk: event.ok,
        resultDigest: event.resultDigest,
      });
      break;
    }
    case "reconciled": {
      if (prev) byId.set(event.commandId, { ...prev, phase: "reconciled", terminalAt: event.at });
      break;
    }
    case "expired": {
      if (prev) byId.set(event.commandId, { ...prev, phase: "expired", terminalAt: event.at });
      break;
    }
    case "dead-lettered": {
      if (prev) byId.set(event.commandId, {
        ...prev,
        phase: "dead-letter",
        terminalAt: event.at,
        deadLetterCode: event.code,
      });
      break;
    }
  }

  return {
    events: [...state.events, event],
    byId,
    byIdempotencyKey: byKey,
    seq: event.seq,
    lastAuditDigest: event.audit.digest,
  };
}

export function foldCommandJournal(
  events: ReadonlyArray<CommandJournalEvent>,
  from: CommandJournalState = emptyCommandJournal(),
): CommandJournalState {
  let state = from;
  for (const e of events) state = applyCommandEvent(state, e);
  return state;
}

// ---------------------------------------------------------------------------
// Checkpoint — fold a prefix, resume with the suffix without replaying.
// ---------------------------------------------------------------------------

export interface CommandJournalCheckpoint {
  readonly foldedSeq: number;
  readonly state: CommandJournalState;
}

export function checkpointCommandJournal(state: CommandJournalState): CommandJournalCheckpoint {
  return { foldedSeq: state.seq, state };
}

export function resumeCommandJournal(
  checkpoint: CommandJournalCheckpoint,
  events: ReadonlyArray<CommandJournalEvent>,
): CommandJournalState {
  if (events.length === 0) return checkpoint.state;
  const suffix = events.filter((e) => e.seq > checkpoint.foldedSeq);
  return foldCommandJournal(suffix, checkpoint.state);
}

// ---------------------------------------------------------------------------
// Journal verification — replay legality (fold replay == state) + the
// audit digest chain. Tampering any event field fails verification.
//
// F280A: `options` allows verifying a COMPACTED journal's retained suffix
// with the SAME chain semantics — `anchor` replaces the genesis digest and
// `firstSeq` replaces the initial expected seq (see journal-compaction.ts).
// The chain rule itself is unchanged: every event's audit digest must equal
// chainedAuditDigest(prevDigest, event). Omitting the options verifies a
// full journal exactly as before (anchor = genesis, firstSeq = 1).
// ---------------------------------------------------------------------------

const LEGAL_PRIOR_PHASES: Readonly<Record<CommandJournalEventKind, ReadonlyArray<AdcosCommandPhase>>> = {
  issued: [], // must be a brand-new commandId
  dispatched: ["issued"],
  "dispatch-failed": ["dispatched"],
  acknowledged: ["dispatched"],
  resulted: ["acknowledged"],
  reconciled: ["resulted"],
  expired: ["issued", "dispatched"],
  "dead-lettered": ["issued", "dispatched", "acknowledged"],
};

export interface JournalVerificationOptions {
  /** Chain anchor for the first event (compaction checkpoint digest). */
  readonly anchor?: string;
  /** Expected seq of the first event (compaction cutoff + 1). */
  readonly firstSeq?: number;
}

export type JournalVerificationFailure = {
  readonly seq: number;
  readonly reason: "seq-out-of-order" | "unknown-command" | "illegal-event" | "audit-chain-broken";
};

export type CommandJournalVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly failures: ReadonlyArray<JournalVerificationFailure> };

export function verifyCommandJournal(
  events: ReadonlyArray<CommandJournalEvent>,
  options?: JournalVerificationOptions,
): CommandJournalVerification {
  const phases = new Map<string, AdcosCommandPhase>();
  const failures: JournalVerificationFailure[] = [];
  let expectedSeq = options?.firstSeq ?? 1;
  let prevDigest = options?.anchor ?? GENESIS_AUDIT_DIGEST;

  for (const e of events) {
    if (e.seq !== expectedSeq) {
      failures.push({ seq: e.seq, reason: "seq-out-of-order" });
      return { ok: false, failures };
    }
    const current = phases.get(e.commandId);
    if (e.kind === "issued") {
      if (current !== undefined) failures.push({ seq: e.seq, reason: "unknown-command" });
    } else {
      if (current === undefined) {
        failures.push({ seq: e.seq, reason: "unknown-command" });
      } else if (!LEGAL_PRIOR_PHASES[e.kind]!.includes(current)) {
        failures.push({ seq: e.seq, reason: "illegal-event" });
      }
    }
    if (e.audit.digest !== chainedAuditDigest(prevDigest, e)) {
      failures.push({ seq: e.seq, reason: "audit-chain-broken" });
    }
    phases.set(e.commandId, phaseAfter(e));
    prevDigest = e.audit.digest;
    expectedSeq += 1;
  }
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}

function phaseAfter(e: CommandJournalEvent): AdcosCommandPhase {
  switch (e.kind) {
    case "issued": return "issued";
    case "dispatched": return "dispatched";
    case "dispatch-failed": return "issued";
    case "acknowledged": return "acknowledged";
    case "resulted": return "resulted";
    case "reconciled": return "reconciled";
    case "expired": return "expired";
    case "dead-lettered": return "dead-letter";
  }
}
