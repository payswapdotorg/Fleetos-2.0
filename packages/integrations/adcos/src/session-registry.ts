/**
 * @fleetos/adcos — Wave 5 connection session registry (F250A).
 *
 * Enrollment / heartbeat / expiry / revoke for ADCOS connection sessions,
 * over the event journal (`session-journal.ts`) with TRUST-LADDER GATING
 * via the LOCAL structural seam (`session-trust.ts` — no `apps/agent`
 * import):
 *
 *   - `enrollSession` — trust-gated (an `untrusted` principal cannot
 *     enroll; `low` is the enrollment floor — the F230A ladder law);
 *     nonce-deduped (idempotent).
 *   - `heartbeatSession` — refuses expired/revoked sessions; posture
 *     transitions are the journal fold's job.
 *   - `expireSessions` — deterministic sweep (sessionId order) of sessions
 *     whose last heartbeat is past the TTL dead threshold.
 *   - `adjustSessionTrust` — upward needs evidence, downward a reason.
 *   - Tenant-scoped fail-closed lookups (cross-tenant == unknown-session).
 *
 * Pure deterministic TypeScript; logical `now` everywhere.
 */

import type { DeviceIdLike, TenantIdLike } from "./adcos.js";
import {
  appendSessionEvent,
  classifySessionExpiry,
  defaultSessionTtl,
  type SessionHeartbeatTtl,
  type SessionRecord,
  type SessionRegistryEvent,
  type SessionRegistryState,
} from "./session-journal.js";
import {
  evaluateSessionTrustTransition,
  gateSessionCapability,
  type SessionEvidenceRef,
  type SessionTrustLevel,
} from "./session-trust.js";

export {
  emptySessionRegistry,
  foldSessionRegistry,
  applySessionEvent,
  appendSessionEvent,
  classifySessionExpiry,
  defaultSessionTtl,
} from "./session-journal.js";
export type {
  SessionEventDraft,
  SessionEventWithSeq,
  SessionRegistryEvent,
  SessionRegistryEventKind,
  SessionRegistryState,
  SessionRecord,
  SessionHeartbeatTtl,
  SessionExpiryClass,
  SessionPosture,
  SessionState,
} from "./session-journal.js";
export type { SessionTrustLevel, SessionTrustCapability, SessionEvidenceRef } from "./session-trust.js";
export {
  SESSION_TRUST_CAPABILITIES,
  SESSION_TRUST_ORDER,
  gateSessionCapability,
  sessionHasCapability,
  sessionEvidenceRequirement,
  evaluateSessionTrustTransition,
} from "./session-trust.js";

// ---------------------------------------------------------------------------
// Rejections.
// ---------------------------------------------------------------------------

export type SessionRegistryRejectionCode =
  | "missing-tenant-id" | "missing-device-id" | "missing-nonce" | "trust-too-low"
  | "unknown-session" // fail-closed: unknown == cross-tenant
  | "illegal-transition" | "session-expired" | "missing-reason"
  | "insufficient-evidence" | "missing-evidence-kind" | "same-level" | "invalid-now";

export type SessionRegistryResult =
  | { readonly ok: true; readonly event: SessionRegistryEvent; readonly state: SessionRegistryState }
  | { readonly ok: false; readonly reason: SessionRegistryRejectionCode };

function lookupSession(
  state: SessionRegistryState,
  tenantId: TenantIdLike,
  sessionId: string,
): SessionRecord | null {
  const record = state.byId.get(sessionId);
  if (!record || record.tenantId !== tenantId) return null; // fail-closed
  return record;
}

// ---------------------------------------------------------------------------
// enroll — trust-gated, nonce-deduped (idempotent).
// ---------------------------------------------------------------------------

export type EnrollSessionResult =
  | {
      readonly ok: true;
      readonly duplicate: false;
      readonly sessionId: string;
      readonly event: SessionRegistryEvent;
      readonly state: SessionRegistryState;
    }
  | { readonly ok: true; readonly duplicate: true; readonly sessionId: string; readonly state: SessionRegistryState }
  | { readonly ok: false; readonly reason: SessionRegistryRejectionCode };

export function enrollSession(
  state: SessionRegistryState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly deviceId: DeviceIdLike;
    readonly trustLevel: SessionTrustLevel;
    readonly nonce: string;
    readonly at: number;
    readonly actor: string;
    readonly ttl?: SessionHeartbeatTtl;
  },
): EnrollSessionResult {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.deviceId === "") return { ok: false, reason: "missing-device-id" };
  if (input.nonce === "") return { ok: false, reason: "missing-nonce" };
  if (!Number.isFinite(input.at) || input.at <= 0) return { ok: false, reason: "invalid-now" };
  if (!gateSessionCapability(input.trustLevel, "observe").ok) {
    return { ok: false, reason: "trust-too-low" }; // untrusted cannot enroll
  }

  const existing = state.byNonce.get(`${input.tenantId}|${input.nonce}`);
  if (existing !== undefined) {
    return { ok: true, duplicate: true, sessionId: existing, state };
  }

  const sessionId = `sess_${sessionIdDigest(input.tenantId, input.deviceId, input.nonce)}`;
  const appended = appendSessionEvent(
    state,
    {
      kind: "enrolled",
      sessionId,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      trustLevel: input.trustLevel,
      nonce: input.nonce,
      ttl: input.ttl ?? defaultSessionTtl(),
      at: input.at,
    },
    input.actor,
  );
  return { ok: true, duplicate: false, sessionId, event: appended.event, state: appended.state };
}

function sessionIdDigest(tenantId: string, deviceId: string, nonce: string): string {
  // FNV-1a 32-bit (lane convention for identifiers), hex, 24 chars.
  const text = `${tenantId}|${deviceId}|${nonce}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const h2 = Math.imul(h ^ text.length, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + (text.length % 256).toString(16).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// heartbeat / trust / expiry / revoke.
// ---------------------------------------------------------------------------

export function heartbeatSession(
  state: SessionRegistryState,
  input: { readonly tenantId: TenantIdLike; readonly sessionId: string; readonly at: number; readonly actor: string },
): SessionRegistryResult {
  const record = lookupSession(state, input.tenantId, input.sessionId);
  if (!record) return { ok: false, reason: "unknown-session" };
  if (record.state === "expired") return { ok: false, reason: "session-expired" };
  if (record.state !== "active") return { ok: false, reason: "illegal-transition" };
  const appended = appendSessionEvent(
    state,
    { kind: "heartbeat", sessionId: input.sessionId, tenantId: input.tenantId, at: input.at },
    input.actor,
  );
  return { ok: true, event: appended.event, state: appended.state };
}

export function adjustSessionTrust(
  state: SessionRegistryState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly sessionId: string;
    readonly to: SessionTrustLevel;
    readonly evidence: ReadonlyArray<SessionEvidenceRef>;
    readonly reason?: string;
    readonly at: number;
    readonly actor: string;
  },
): SessionRegistryResult {
  const record = lookupSession(state, input.tenantId, input.sessionId);
  if (!record) return { ok: false, reason: "unknown-session" };
  if (record.state !== "active") return { ok: false, reason: "illegal-transition" };
  const refusal = evaluateSessionTrustTransition(record.trustLevel, input.to, input.evidence, input.reason);
  if (refusal !== null) return { ok: false, reason: refusal };

  const appended = appendSessionEvent(
    state,
    {
      kind: "trust-changed",
      sessionId: input.sessionId,
      tenantId: input.tenantId,
      from: record.trustLevel,
      to: input.to,
      at: input.at,
    },
    input.actor,
  );
  return { ok: true, event: appended.event, state: appended.state };
}

export function expireSessions(
  state: SessionRegistryState,
  input: { readonly tenantId: TenantIdLike; readonly now: number; readonly actor: string },
): { readonly state: SessionRegistryState; readonly expired: ReadonlyArray<string> } {
  const due = [...state.byId.values()]
    .filter(
      (r) =>
        r.tenantId === input.tenantId &&
        r.state === "active" &&
        classifySessionExpiry(r, input.now) === "expired",
    )
    .map((r) => r.sessionId)
    .sort();
  let next = state;
  for (const sessionId of due) {
    const appended = appendSessionEvent(
      next,
      { kind: "expired", sessionId, tenantId: input.tenantId, at: input.now },
      input.actor,
    );
    next = appended.state;
  }
  return { state: next, expired: due };
}

export function revokeSession(
  state: SessionRegistryState,
  input: { readonly tenantId: TenantIdLike; readonly sessionId: string; readonly at: number; readonly reason: string; readonly actor: string },
): SessionRegistryResult {
  const record = lookupSession(state, input.tenantId, input.sessionId);
  if (!record) return { ok: false, reason: "unknown-session" };
  if (record.state !== "active") return { ok: false, reason: "illegal-transition" };
  if (input.reason === "") return { ok: false, reason: "missing-reason" };
  const appended = appendSessionEvent(
    state,
    { kind: "revoked", sessionId: input.sessionId, tenantId: input.tenantId, reason: input.reason, at: input.at },
    input.actor,
  );
  return { ok: true, event: appended.event, state: appended.state };
}

// ---------------------------------------------------------------------------
// Tenant-scoped fail-closed lookups (deterministic ordering).
// ---------------------------------------------------------------------------

export function findSession(
  state: SessionRegistryState,
  tenantId: TenantIdLike,
  sessionId: string,
): SessionRecord | null {
  return lookupSession(state, tenantId, sessionId);
}

export function listSessionsByTenant(
  state: SessionRegistryState,
  tenantId: TenantIdLike,
): ReadonlyArray<SessionRecord> {
  return [...state.byId.values()]
    .filter((r) => r.tenantId === tenantId)
    .sort((a, b) =>
      a.enrolledAt !== b.enrolledAt
        ? a.enrolledAt - b.enrolledAt
        : a.sessionId < b.sessionId
          ? -1
          : a.sessionId > b.sessionId
            ? 1
            : 0,
    );
}

export function listSessionsByDevice(
  state: SessionRegistryState,
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
): ReadonlyArray<SessionRecord> {
  return listSessionsByTenant(state, tenantId).filter((r) => r.deviceId === deviceId);
}
