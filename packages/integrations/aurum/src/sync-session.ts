/**
 * @fleetos/aurum — cursor-based sync session lifecycle (Wave 5).
 *
 * Session states: opened → fetching → applying → committed (+ failed/aborted
 * from any non-terminal state). The session never talks to the network —
 * it folds CALLER-SUPPLIED batches (fetched by the composing application
 * through the AurumPort) onto the replica store via `applyDeltaBatch`.
 *
 * - LOGICAL-TIME CURSORS: the cursor is (source, logicalTime, sequence).
 *   logicalTime advances to the max delta logical time of each applied
 *   batch; batches that would move it backwards are refused
 *   (CURSOR_REGRESSION) — nothing is applied (atomic).
 * - IDEMPOTENCY-KEY DEDUP PER BATCH: deltas whose idempotency keys were
 *   already applied IN THIS SESSION are removed before application and
 *   counted in `duplicatesSkipped`; a fully-duplicate re-delivery leaves
 *   the store and sync digest byte-identical (idempotent batch re-apply).
 * - SYNC DIGEST CHAINING: each applied batch contributes its batch digest;
 *   `syncDigest` chains batch digests (law A19) and
 *   `verifySyncDigest` detects tampering.
 * - FAIL-CLOSED TENANCY: invalid tenant scopes, cross-tenant batches and
 *   cross-tenant stores are refused; nothing changes.
 *
 * Pure and deterministic throughout: logical `now` is caller-supplied;
 * inputs are never mutated.
 */
import { validateTenantScope, type TenantScope } from "./tenant.js";
import { fnv1a32Hex } from "./digest.js";
import {
  applyDeltaBatch,
  type DeltaApplyOutcome,
  type ExternalProjectionBatch,
  type ExternalProjectionDelta,
  type ProjectionStore,
} from "./delta-apply.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type SyncSessionStatus =
  | "opened"
  | "fetching"
  | "applying"
  | "committed"
  | "failed"
  | "aborted";

export interface LogicalCursor {
  readonly source: string;
  readonly logicalTime: number;
  readonly sequence: number;
}

export interface SyncSession {
  readonly sessionId: string;
  readonly tenant: TenantScope;
  readonly source: string;
  readonly status: SyncSessionStatus;
  readonly cursor: LogicalCursor;
  readonly batchesApplied: number;
  readonly batchDigests: readonly string[];
  /** Chained digest over the applied batch digests (law A19). */
  readonly syncDigest: string;
  readonly appliedIdempotencyKeys: readonly string[];
  readonly duplicatesSkipped: number;
  readonly quarantinedCount: number;
  readonly openedAt: number;
  readonly updatedAt: number;
  readonly failure: { readonly reasonCode: string; readonly detail: string } | null;
  readonly abortReason: string | null;
}

export const SYNC_DIGEST_GENESIS = "sync_genesis";

export type SessionRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "SESSION_ID_EMPTY"
  | "SOURCE_EMPTY"
  | "SOURCE_MISMATCH"
  | "CURSOR_SOURCE_MISMATCH"
  | "CURSOR_LOGICAL_TIME_INVALID"
  | "LOGICAL_TIME_INVALID"
  | "ILLEGAL_TRANSITION"
  | "TERMINAL_STATE"
  | "CURSOR_REGRESSION"
  | "NOTHING_TO_COMMIT"
  | "FAILURE_REASON_REQUIRED"
  | "ABORT_REASON_REQUIRED"
  | "BATCH_REFUSED"
  | "SYNC_DIGEST_CHAIN_BROKEN";

export type SessionResult =
  | { readonly ok: true; readonly session: SyncSession }
  | { readonly ok: false; readonly reasonCode: SessionRefusalCode; readonly detail: string };

export type ApplyToSessionResult =
  | {
      readonly ok: true;
      readonly session: SyncSession;
      readonly store: ProjectionStore;
      readonly outcome: DeltaApplyOutcome;
    }
  | { readonly ok: false; readonly reasonCode: SessionRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// openSyncSession / beginFetching.
// ---------------------------------------------------------------------------

export interface OpenSessionInput {
  readonly tenant: TenantScope;
  readonly source: string;
  readonly sessionId: string;
  readonly startCursor: LogicalCursor;
  readonly now: number;
}

export function openSyncSession(input: OpenSessionInput): SessionResult {
  const scope = validateTenantScope(input.tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  if (input.sessionId.trim().length === 0) {
    return { ok: false, reasonCode: "SESSION_ID_EMPTY", detail: "sessionId is empty" };
  }
  if (input.source.trim().length === 0) {
    return { ok: false, reasonCode: "SOURCE_EMPTY", detail: "source is empty" };
  }
  if (input.startCursor.source !== input.source) {
    return {
      ok: false,
      reasonCode: "CURSOR_SOURCE_MISMATCH",
      detail: `cursor source "${input.startCursor.source}" ≠ session source "${input.source}"`,
    };
  }
  if (!Number.isInteger(input.startCursor.logicalTime) || input.startCursor.logicalTime < 0) {
    return { ok: false, reasonCode: "CURSOR_LOGICAL_TIME_INVALID", detail: "start cursor logicalTime is not a non-negative integer" };
  }
  if (!Number.isInteger(input.now) || input.now < 0) {
    return { ok: false, reasonCode: "LOGICAL_TIME_INVALID", detail: "now is not a non-negative integer" };
  }
  return {
    ok: true,
    session: {
      sessionId: input.sessionId,
      tenant: scope.scope,
      source: input.source,
      status: "opened",
      cursor: { source: input.source, logicalTime: input.startCursor.logicalTime, sequence: 0 },
      batchesApplied: 0,
      batchDigests: [],
      syncDigest: SYNC_DIGEST_GENESIS,
      appliedIdempotencyKeys: [],
      duplicatesSkipped: 0,
      quarantinedCount: 0,
      openedAt: input.now,
      updatedAt: input.now,
      failure: null,
      abortReason: null,
    },
  };
}

export function beginFetching(session: SyncSession, now: number): SessionResult {
  if (isTerminal(session)) return terminalRefusal(session);
  if (session.status !== "opened") {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: `beginFetching requires "opened", got "${session.status}"` };
  }
  return { ok: true, session: { ...session, status: "fetching", updatedAt: now } };
}

// ---------------------------------------------------------------------------
// applyFetchedBatch — idempotency dedup, cursor advance, digest chaining.
// ---------------------------------------------------------------------------

export function applyFetchedBatch(
  session: SyncSession,
  store: ProjectionStore,
  batch: ExternalProjectionBatch,
  now: number,
): ApplyToSessionResult {
  if (isTerminal(session)) return terminalRefusal(session);
  if (session.status !== "fetching" && session.status !== "applying") {
    return {
      ok: false,
      reasonCode: "ILLEGAL_TRANSITION",
      detail: `applyFetchedBatch requires "fetching" or "applying", got "${session.status}"`,
    };
  }
  const sessionTenant = validateTenantScope(session.tenant);
  const batchTenant = validateTenantScope(batch.tenant);
  if (!sessionTenant.ok || !batchTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "invalid tenant scope" };
  }
  if (batchTenant.scope.tenantId !== sessionTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "batch tenant differs from session tenant" };
  }
  const storeTenant = validateTenantScope(store.tenant);
  if (!storeTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "store tenant invalid" };
  if (storeTenant.scope.tenantId !== sessionTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "store tenant differs from session tenant" };
  }
  if (store.source !== session.source || batch.source !== session.source) {
    return { ok: false, reasonCode: "SOURCE_MISMATCH", detail: "source mismatch between session, store and batch" };
  }

  // Per-batch idempotency-key dedup against keys already applied this session.
  const alreadyApplied = new Set(session.appliedIdempotencyKeys);
  const fresh: ExternalProjectionDelta[] = [];
  let duplicates = 0;
  for (const delta of batch.deltas) {
    if (typeof delta.idempotencyKey === "string" && alreadyApplied.has(delta.idempotencyKey)) {
      duplicates++;
      continue;
    }
    fresh.push(delta);
  }
  if (fresh.length === 0) {
    // Fully-duplicate re-delivery: idempotent no-op. Nothing is applied and
    // NO batch digest is chained — re-applying the same batch with the same
    // logical `now` reproduces the session byte-identically.
    return {
      ok: true,
      session: { ...session, duplicatesSkipped: session.duplicatesSkipped + duplicates, updatedAt: now },
      store,
      outcome: { applied: [], skippedStale: [], skippedDuplicate: [], quarantined: [] },
    };
  }

  const effectiveBatch: ExternalProjectionBatch = { ...batch, deltas: fresh };
  // Cursor advance covers only deltas with structurally valid logical times
  // (malformed ones are quarantined by the applier and must not move the
  // cursor); the cursor never regresses (checked below, atomically).
  const validTimes = fresh
    .filter((d) => Number.isInteger(d.logicalTime) && d.logicalTime >= 0)
    .map((d) => d.logicalTime);
  const maxLogicalTime = Math.max(session.cursor.logicalTime, ...(validTimes.length > 0 ? validTimes : [session.cursor.logicalTime]));
  const batchMax = validTimes.length > 0 ? Math.max(...validTimes) : session.cursor.logicalTime;
  if (batchMax < session.cursor.logicalTime) {
    return {
      ok: false,
      reasonCode: "CURSOR_REGRESSION",
      detail: `batch carries logical times behind cursor ${String(session.cursor.logicalTime)}`,
    };
  }

  const appliedResult = applyDeltaBatch(store, effectiveBatch);
  if (!appliedResult.ok) {
    return { ok: false, reasonCode: "BATCH_REFUSED", detail: `${appliedResult.reasonCode}: ${appliedResult.detail}` };
  }

  const batchDigest = appliedResult.batchDigest;
  const syncDigest = fnv1a32Hex("sync", `${session.syncDigest}\u241f${batchDigest}`);
  const newKeys = fresh
    .map((d) => d.idempotencyKey)
    .filter((k) => typeof k === "string" && k.trim().length > 0);
  return {
    ok: true,
    session: {
      ...session,
      status: "applying",
      cursor: { source: session.source, logicalTime: maxLogicalTime, sequence: session.batchesApplied + 1 },
      batchesApplied: session.batchesApplied + 1,
      batchDigests: [...session.batchDigests, batchDigest],
      syncDigest,
      appliedIdempotencyKeys: [...session.appliedIdempotencyKeys, ...newKeys],
      duplicatesSkipped: session.duplicatesSkipped + duplicates,
      quarantinedCount: session.quarantinedCount + appliedResult.outcome.quarantined.length,
      updatedAt: now,
    },
    store: appliedResult.store,
    outcome: appliedResult.outcome,
  };
}

// ---------------------------------------------------------------------------
// commit / fail / abort.
// ---------------------------------------------------------------------------

export function commitSyncSession(session: SyncSession, now: number): SessionResult {
  if (isTerminal(session)) return terminalRefusal(session);
  if (session.status !== "fetching" && session.status !== "applying") {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION", detail: `commitSyncSession requires "fetching" or "applying", got "${session.status}"` };
  }
  if (session.status === "fetching" && session.batchesApplied === 0) {
    return { ok: false, reasonCode: "NOTHING_TO_COMMIT", detail: "an empty sync must explicitly reach applying before committing" };
  }
  return { ok: true, session: { ...session, status: "committed", updatedAt: now } };
}

export function failSyncSession(session: SyncSession, reasonCode: string, now: number): SessionResult {
  if (isTerminal(session)) return terminalRefusal(session);
  if (reasonCode.trim().length === 0) {
    return { ok: false, reasonCode: "FAILURE_REASON_REQUIRED", detail: "failure reasonCode is empty" };
  }
  return {
    ok: true,
    session: { ...session, status: "failed", updatedAt: now, failure: { reasonCode, detail: "" } },
  };
}

export function abortSyncSession(session: SyncSession, reason: string, now: number): SessionResult {
  if (isTerminal(session)) return terminalRefusal(session);
  if (reason.trim().length === 0) {
    return { ok: false, reasonCode: "ABORT_REASON_REQUIRED", detail: "abort reason is empty" };
  }
  return { ok: true, session: { ...session, status: "aborted", updatedAt: now, abortReason: reason } };
}

// ---------------------------------------------------------------------------
// Digest chain verification.
// ---------------------------------------------------------------------------

export function verifySyncDigest(
  session: SyncSession,
): { ok: true } | { ok: false; reasonCode: "SYNC_DIGEST_CHAIN_BROKEN"; brokenAtBatch: number } {
  let digest = SYNC_DIGEST_GENESIS;
  for (let i = 0; i < session.batchDigests.length; i++) {
    digest = fnv1a32Hex("sync", `${digest}\u241f${session.batchDigests[i]}`);
  }
  if (digest !== session.syncDigest) {
    return { ok: false, reasonCode: "SYNC_DIGEST_CHAIN_BROKEN", brokenAtBatch: session.batchDigests.length };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function isTerminal(session: SyncSession): boolean {
  return session.status === "committed" || session.status === "failed" || session.status === "aborted";
}

function terminalRefusal(session: SyncSession): { ok: false; reasonCode: "TERMINAL_STATE"; detail: string } {
  return { ok: false, reasonCode: "TERMINAL_STATE", detail: `session is terminal ("${session.status}")` };
}
