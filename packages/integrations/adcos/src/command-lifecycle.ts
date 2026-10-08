/**
 * @fleetos/adcos — Wave 5 command lifecycle machine (F250A).
 *
 * `issue → dispatch → ack → result → reconcile` with `expired` and
 * `dead-letter` terminal paths, over the append-only journal
 * (`command-journal.ts`). State is a pure fold; every transition below
 * validates and appends exactly one journal event (or refuses, typed).
 *
 *   - **idempotency-key dedup at issue** — the same (tenant, key) re-issue
 *     returns the EXISTING command (duplicate=true), never a second one.
 *   - **tenant fail-closed** — lookups are tenant-scoped; a cross-tenant
 *     commandId is indistinguishable from an unknown one (`unknown-command`).
 *   - **deterministic backoff ladder** — retry delays come from the F230A
 *     `EdgeAdcosRetryPolicy` / `computeBackoffMs` seam (integer ms,
 *     per attempt class: transient climbs the ladder, permanent
 *     short-circuits to dead-letter).
 *   - **refusal codes** — extend (never duplicate) the `AdcosRejectionCode`
 *     vocabulary with lifecycle-specific codes.
 *
 * Pure deterministic TypeScript; logical `now` everywhere.
 */

import type { AdcosCommandKind, AdcosRejectionCode, DeviceIdLike, TenantIdLike } from "./adcos.js";
import {
  classifyAdcosError,
  computeBackoffMs,
  type EdgeAdcosRetryPolicy,
} from "./edge-adapter.js";
import {
  applyCommandEvent,
  makeEventAudit,
  type AdcosCommandRecord,
  type CommandJournalEvent,
  type CommandJournalEventDraft,
  type CommandJournalEventWithSeq,
  type CommandJournalState,
} from "./command-journal.js";

// ---------------------------------------------------------------------------
// Refusal codes — the base AdcosRejectionCode vocabulary reused, extended
// with lifecycle-specific codes (no duplicate meanings).
// ---------------------------------------------------------------------------

export type CommandLifecycleRejectionCode =
  | AdcosRejectionCode
  | "unknown-command" // fail-closed: same refusal for unknown + cross-tenant
  | "illegal-transition"
  | "already-in-state"
  | "missing-idempotency-key"
  | "invalid-deadline"
  | "command-expired"
  | "retry-exhausted";

export type CommandTransitionResult =
  | {
      readonly ok: true;
      readonly event: CommandJournalEvent;
      readonly state: CommandJournalState;
      readonly record: AdcosCommandRecord;
    }
  | { readonly ok: false; readonly reason: CommandLifecycleRejectionCode };

// Fail-closed tenant-scoped lookup: cross-tenant is identical to unknown.
function lookup(
  state: CommandJournalState,
  tenantId: TenantIdLike,
  commandId: string,
): AdcosCommandRecord | null {
  const record = state.byId.get(commandId);
  if (!record || record.tenantId !== tenantId) return null;
  return record;
}

function append(
  state: CommandJournalState,
  event: CommandJournalEventDraft,
  actor: string,
): { readonly event: CommandJournalEvent; readonly state: CommandJournalState } {
  const seq = state.seq + 1;
  const withoutAudit = { ...event, seq } as CommandJournalEventWithSeq;
  const audit = makeEventAudit(state, withoutAudit, actor);
  const full = { ...withoutAudit, audit } as CommandJournalEvent;
  return { event: full, state: applyCommandEvent(state, full) };
}

// ---------------------------------------------------------------------------
// issue — idempotency-key dedup at the boundary.
// ---------------------------------------------------------------------------

export interface IssueCommandInput {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly kind: AdcosCommandKind;
  readonly idempotencyKey: string;
  readonly actor: string;
  readonly at: number;
  readonly expiresAt?: number; // ack deadline (logical ms); null = no deadline
}

export type IssueCommandResult =
  | {
      readonly ok: true;
      readonly duplicate: false;
      readonly commandId: string;
      readonly event: CommandJournalEvent;
      readonly state: CommandJournalState;
    }
  | { readonly ok: true; readonly duplicate: true; readonly commandId: string; readonly state: CommandJournalState }
  | { readonly ok: false; readonly reason: CommandLifecycleRejectionCode };

export function issueAdcosCommand(
  state: CommandJournalState,
  input: IssueCommandInput,
): IssueCommandResult {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.deviceId === "") return { ok: false, reason: "missing-device-id" };
  if (input.idempotencyKey === "") return { ok: false, reason: "missing-idempotency-key" };
  if (input.expiresAt !== undefined && input.expiresAt <= input.at) {
    return { ok: false, reason: "invalid-deadline" };
  }

  // Tenant-scoped idempotency dedup — idempotent re-issue, never a duplicate.
  const existingId = state.byIdempotencyKey.get(`${input.tenantId}|${input.idempotencyKey}`);
  if (existingId !== undefined) {
    return { ok: true, duplicate: true, commandId: existingId, state };
  }

  const commandId = `cmd_${sha(commandIdParts(input))}`;
  const { event, state: next } = append(
    state,
    {
      kind: "issued",
      commandId,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      commandKind: input.kind,
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt ?? null,
      at: input.at,
    },
    input.actor,
  );
  return { ok: true, duplicate: false, commandId, event, state: next };
}

function commandIdParts(input: IssueCommandInput): ReadonlyArray<string> {
  return [input.tenantId, input.idempotencyKey, input.kind, input.deviceId];
}

function sha(parts: ReadonlyArray<string>): string {
  // Deterministic commandId (content-addressed). Kept local so this module
  // carries no crypto import of its own.
  let h = 0x811c9dc5; // FNV-1a 32-bit (lane convention for identifiers)
  const text = parts.join("|");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + (text.length % 97).toString(16).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// dispatch — issued -> dispatched (attempt N of the policy ladder).
// ---------------------------------------------------------------------------

export interface DispatchCommandInput {
  readonly tenantId: TenantIdLike;
  readonly commandId: string;
  readonly at: number;
  readonly actor: string;
  readonly policy: EdgeAdcosRetryPolicy;
}

export function dispatchAdcosCommand(
  state: CommandJournalState,
  input: DispatchCommandInput,
): CommandTransitionResult {
  const record = lookup(state, input.tenantId, input.commandId);
  if (!record) return { ok: false, reason: "unknown-command" };
  if (record.phase === "dispatched") return { ok: false, reason: "already-in-state" };
  if (record.phase !== "issued") return { ok: false, reason: "illegal-transition" };
  if (record.expiresAt !== null && input.at > record.expiresAt) {
    return { ok: false, reason: "command-expired" };
  }
  const attempt = record.attempts + 1;
  if (attempt > input.policy.maxAttempts) return { ok: false, reason: "retry-exhausted" };

  const { event, state: next } = append(
    state,
    {
      kind: "dispatched",
      commandId: input.commandId,
      tenantId: input.tenantId,
      attempt,
      at: input.at,
    },
    input.actor,
  );
  const updated = next.byId.get(input.commandId)!;
  return { ok: true, event, state: next, record: updated };
}

// ---------------------------------------------------------------------------
// dispatch failure — the deterministic backoff ladder + dead-letter paths.
// ---------------------------------------------------------------------------

export interface DispatchFailureInput {
  readonly tenantId: TenantIdLike;
  readonly commandId: string;
  readonly at: number;
  readonly code: AdcosRejectionCode;
  readonly actor: string;
  readonly policy: EdgeAdcosRetryPolicy;
}

export function recordAdcosDispatchFailure(
  state: CommandJournalState,
  input: DispatchFailureInput,
): CommandTransitionResult {
  const record = lookup(state, input.tenantId, input.commandId);
  if (!record) return { ok: false, reason: "unknown-command" };
  if (record.phase !== "dispatched") return { ok: false, reason: "illegal-transition" };

  const error = classifyAdcosError(input.code); // attempt class: transient | permanent
  const exhausted = record.attempts >= input.policy.maxAttempts;
  if (error.class === "permanent" || exhausted) {
    // Terminal: permanent errors short-circuit; transient exhaustion dead-letters.
    const { event, state: next } = append(
      state,
      {
        kind: "dead-lettered",
        commandId: input.commandId,
        tenantId: input.tenantId,
        code: input.code,
        attempts: record.attempts,
        at: input.at,
      },
      input.actor,
    );
    return { ok: true, event, state: next, record: next.byId.get(input.commandId)! };
  }

  const backoffMs = computeBackoffMs(input.policy, record.attempts); // the ladder
  const { event, state: next } = append(
    state,
    {
      kind: "dispatch-failed",
      commandId: input.commandId,
      tenantId: input.tenantId,
      attempt: record.attempts,
      code: input.code,
      backoffMs,
      at: input.at,
    },
    input.actor,
  );
  return { ok: true, event, state: next, record: next.byId.get(input.commandId)! };
}

// ---------------------------------------------------------------------------
// ack / result / reconcile.
// ---------------------------------------------------------------------------

export function acknowledgeAdcosCommand(
  state: CommandJournalState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly commandId: string;
    readonly at: number;
    readonly requestId: string;
    readonly actor: string;
  },
): CommandTransitionResult {
  const record = lookup(state, input.tenantId, input.commandId);
  if (!record) return { ok: false, reason: "unknown-command" };
  if (record.phase === "acknowledged") return { ok: false, reason: "already-in-state" };
  if (record.phase !== "dispatched") return { ok: false, reason: "illegal-transition" };
  if (record.expiresAt !== null && input.at > record.expiresAt) {
    return { ok: false, reason: "command-expired" };
  }
  const { event, state: next } = append(
    state,
    {
      kind: "acknowledged",
      commandId: input.commandId,
      tenantId: input.tenantId,
      requestId: input.requestId,
      at: input.at,
    },
    input.actor,
  );
  return { ok: true, event, state: next, record: next.byId.get(input.commandId)! };
}

export function recordAdcosResult(
  state: CommandJournalState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly commandId: string;
    readonly at: number;
    readonly ok: boolean;
    readonly resultDigest: string;
    readonly actor: string;
  },
): CommandTransitionResult {
  const record = lookup(state, input.tenantId, input.commandId);
  if (!record) return { ok: false, reason: "unknown-command" };
  if (record.phase === "resulted") return { ok: false, reason: "already-in-state" };
  if (record.phase !== "acknowledged") return { ok: false, reason: "illegal-transition" };
  const { event, state: next } = append(
    state,
    {
      kind: "resulted",
      commandId: input.commandId,
      tenantId: input.tenantId,
      ok: input.ok,
      resultDigest: input.resultDigest,
      at: input.at,
    },
    input.actor,
  );
  return { ok: true, event, state: next, record: next.byId.get(input.commandId)! };
}

export function reconcileAdcosCommand(
  state: CommandJournalState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly commandId: string;
    readonly at: number;
    readonly actor: string;
  },
): CommandTransitionResult {
  const record = lookup(state, input.tenantId, input.commandId);
  if (!record) return { ok: false, reason: "unknown-command" };
  if (record.phase === "reconciled") return { ok: false, reason: "already-in-state" };
  if (record.phase !== "resulted") return { ok: false, reason: "illegal-transition" };
  const { event, state: next } = append(
    state,
    { kind: "reconciled", commandId: input.commandId, tenantId: input.tenantId, at: input.at },
    input.actor,
  );
  return { ok: true, event, state: next, record: next.byId.get(input.commandId)! };
}

// ---------------------------------------------------------------------------
// expired sweep — deterministic, tenant-scoped, ordered by commandId.
// ---------------------------------------------------------------------------

export function expireAdcosCommands(
  state: CommandJournalState,
  input: { readonly tenantId: TenantIdLike; readonly now: number; readonly actor: string },
): { readonly state: CommandJournalState; readonly expired: ReadonlyArray<string> } {
  const due = [...state.byId.values()]
    .filter(
      (r) =>
        r.tenantId === input.tenantId &&
        (r.phase === "issued" || r.phase === "dispatched") &&
        r.expiresAt !== null &&
        r.expiresAt <= input.now,
    )
    .map((r) => r.commandId)
    .sort();
  let next = state;
  for (const commandId of due) {
    const appended = append(
      next,
      { kind: "expired", commandId, tenantId: input.tenantId, at: input.now },
      input.actor,
    );
    next = appended.state;
  }
  return { state: next, expired: due };
}

// ---------------------------------------------------------------------------
// The backoff ladder (per attempt class) — deterministic, from the F230A seam.
// ---------------------------------------------------------------------------

export function backoffLadder(
  policy: EdgeAdcosRetryPolicy,
  errorClass: "transient" | "permanent",
): ReadonlyArray<number> {
  if (errorClass === "permanent") return []; // permanent: no ladder — dead-letter
  const ladder: number[] = [];
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    ladder.push(computeBackoffMs(policy, attempt));
  }
  return ladder;
}
