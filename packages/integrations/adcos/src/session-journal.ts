/**
 * @fleetos/adcos — Wave 5 session journal (F250A).
 *
 * The append-only event journal behind the session registry
 * (`session-registry.ts`). Session posture is a PURE FOLD over the
 * journal: enroll -> `degraded` (transport-up alone is NOT connected —
 * F230A law), fresh heartbeat -> `connected`, stale-gap heartbeat ->
 * `degraded`, dead-gap heartbeat -> `offline`. Expiry classification is
 * deterministic against logical `now` and the session's own TTL.
 *
 * Pure deterministic TypeScript; no timers, no network, no randomness.
 */

import { createHash } from "node:crypto";
import type { AuditEventRef } from "./kernel.js";
import type { SessionTrustLevel } from "./session-trust.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Events + state.
// ---------------------------------------------------------------------------

export type SessionPosture = "offline" | "degraded" | "connected"; // structural mirror
export type SessionState = "active" | "expired" | "revoked";

interface SessionEventBase {
  readonly seq: number;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly at: number;
  readonly audit: AuditEventRef;
}

export interface SessionEnrolledEvent extends SessionEventBase {
  readonly kind: "enrolled";
  readonly deviceId: string;
  readonly trustLevel: SessionTrustLevel;
  readonly nonce: string;
  readonly ttl: SessionHeartbeatTtl;
}

export interface SessionHeartbeatEvent extends SessionEventBase {
  readonly kind: "heartbeat";
}

export interface SessionTrustChangedEvent extends SessionEventBase {
  readonly kind: "trust-changed";
  readonly from: SessionTrustLevel;
  readonly to: SessionTrustLevel;
}

export interface SessionExpiredEvent extends SessionEventBase {
  readonly kind: "expired";
}

export interface SessionRevokedEvent extends SessionEventBase {
  readonly kind: "revoked";
  readonly reason: string;
}

export type SessionRegistryEvent =
  | SessionEnrolledEvent
  | SessionHeartbeatEvent
  | SessionTrustChangedEvent
  | SessionExpiredEvent
  | SessionRevokedEvent;

export type SessionRegistryEventKind = SessionRegistryEvent["kind"];

// Distributive omit (plain Omit would collapse the union).
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type SessionEventDraft = DistributiveOmit<SessionRegistryEvent, "audit" | "seq">;
export type SessionEventWithSeq = DistributiveOmit<SessionRegistryEvent, "audit">;

export interface SessionHeartbeatTtl {
  readonly staleMs: number;
  readonly deadMs: number;
}

export function defaultSessionTtl(): SessionHeartbeatTtl {
  return { staleMs: 30_000, deadMs: 120_000 };
}

export type SessionExpiryClass = "fresh" | "stale" | "expired";

export interface SessionRecord {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly trustLevel: SessionTrustLevel;
  readonly enrolledAt: number;
  readonly lastHeartbeatAt: number | null;
  readonly heartbeatCount: number;
  readonly state: SessionState;
  readonly posture: SessionPosture;
  readonly lastEventAt: number;
  readonly ttl: SessionHeartbeatTtl;
}

export interface SessionRegistryState {
  readonly events: ReadonlyArray<SessionRegistryEvent>;
  readonly byId: ReadonlyMap<string, SessionRecord>;
  readonly byNonce: ReadonlyMap<string, string>; // `${tenantId}|${nonce}` -> sessionId
  readonly seq: number;
}

export function emptySessionRegistry(): SessionRegistryState {
  return { events: [], byId: new Map(), byNonce: new Map(), seq: 0 };
}

/** Deterministic expiry classification vs logical now (session's own TTL). */
export function classifySessionExpiry(record: SessionRecord, now: number): SessionExpiryClass {
  const anchor = record.lastHeartbeatAt ?? record.enrolledAt;
  const elapsed = now - anchor;
  if (elapsed >= record.ttl.deadMs) return "expired";
  if (elapsed >= record.ttl.staleMs) return "stale";
  return "fresh";
}

// ---------------------------------------------------------------------------
// Fold — the pure reducer.
// ---------------------------------------------------------------------------

function sessionAudit(event: SessionEventWithSeq, actor: string): AuditEventRef {
  return {
    actor,
    intent: `adcos:session:${event.kind}:${event.sessionId}`,
    tenant: event.tenantId,
    timestamp: event.at,
    digest: digestOf(event.tenantId, event.sessionId, event.kind, event.seq, event.at),
  };
}

export function applySessionEvent(
  state: SessionRegistryState,
  event: SessionRegistryEvent,
): SessionRegistryState {
  if (event.seq !== state.seq + 1) return state; // append-only journal discipline
  const byId = new Map(state.byId);
  const byNonce = new Map(state.byNonce);
  const prev = byId.get(event.sessionId) ?? null;

  switch (event.kind) {
    case "enrolled": {
      byId.set(event.sessionId, {
        sessionId: event.sessionId,
        tenantId: event.tenantId,
        deviceId: event.deviceId,
        trustLevel: event.trustLevel,
        enrolledAt: event.at,
        lastHeartbeatAt: null,
        heartbeatCount: 0,
        state: "active",
        posture: "degraded", // enrolled != connected — first heartbeat confirms
        lastEventAt: event.at,
        ttl: event.ttl,
      });
      byNonce.set(`${event.tenantId}|${event.nonce}`, event.sessionId);
      break;
    }
    case "heartbeat": {
      if (prev) {
        const anchor = prev.lastHeartbeatAt ?? prev.enrolledAt;
        const gap = event.at - anchor;
        const posture: SessionPosture =
          gap >= prev.ttl.deadMs ? "offline" : gap >= prev.ttl.staleMs ? "degraded" : "connected";
        byId.set(event.sessionId, {
          ...prev,
          lastHeartbeatAt: event.at,
          heartbeatCount: prev.heartbeatCount + 1,
          posture,
          lastEventAt: event.at,
        });
      }
      break;
    }
    case "trust-changed": {
      if (prev) byId.set(event.sessionId, { ...prev, trustLevel: event.to, lastEventAt: event.at });
      break;
    }
    case "expired": {
      if (prev) byId.set(event.sessionId, { ...prev, state: "expired", posture: "offline", lastEventAt: event.at });
      break;
    }
    case "revoked": {
      if (prev) byId.set(event.sessionId, { ...prev, state: "revoked", posture: "offline", lastEventAt: event.at });
      break;
    }
  }

  return { events: [...state.events, event], byId, byNonce, seq: event.seq };
}

export function foldSessionRegistry(
  events: ReadonlyArray<SessionRegistryEvent>,
  from: SessionRegistryState = emptySessionRegistry(),
): SessionRegistryState {
  let state = from;
  for (const e of events) state = applySessionEvent(state, e);
  return state;
}

/** Append one event with its audit (seq + chained fields). */
export function appendSessionEvent(
  state: SessionRegistryState,
  event: SessionEventDraft,
  actor: string,
): { readonly event: SessionRegistryEvent; readonly state: SessionRegistryState } {
  const seq = state.seq + 1;
  const withSeq = { ...event, seq } as SessionEventWithSeq;
  const full = { ...withSeq, audit: sessionAudit(withSeq, actor) } as SessionRegistryEvent;
  return { event: full, state: applySessionEvent(state, full) };
}
