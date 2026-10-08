/**
 * @fleetos/connectivity — Wave 5 intent journal (F250A).
 *
 * The append-only event journal behind the intent registry
 * (`intent-registry.ts`). Registry state is a PURE FOLD over the journal
 * (same events -> byte-identical state); checkpoints let the fold resume
 * from a prefix without replaying it.
 *
 * Pure deterministic TypeScript; logical `now` everywhere.
 */

import { createHash } from "node:crypto";
import type { ConnectivityDesiredState } from "./connectivity.js";
import type { AuditEventRef } from "./kernel.js";
import type {
  IntentLifecycleEventKind,
  IntentLifecycleState,
} from "./intent-lifecycle.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Events.
// ---------------------------------------------------------------------------

interface RegistryEventBase {
  readonly seq: number;
  readonly intentId: string;
  readonly tenantId: string;
  readonly at: number;
  readonly audit: AuditEventRef;
}

export interface IntentProposedEvent extends RegistryEventBase {
  readonly kind: "proposed";
  readonly deviceId: string;
  readonly desiredState: ConnectivityDesiredState;
  readonly idempotencyKey: string;
}

export interface IntentTransitionedEvent extends RegistryEventBase {
  readonly kind: "transitioned";
  readonly eventKind: IntentLifecycleEventKind;
  readonly from: IntentLifecycleState;
  readonly to: IntentLifecycleState;
  readonly authorizationDigest?: string;
}

export interface IntentSupersededEvent extends RegistryEventBase {
  readonly kind: "superseded";
  readonly successorIntentId: string;
  readonly provenance: { readonly actor: string; readonly reason: string; readonly at: number };
}

export type IntentRegistryEvent =
  | IntentProposedEvent
  | IntentTransitionedEvent
  | IntentSupersededEvent;

export type IntentRegistryEventKind = IntentRegistryEvent["kind"];

// Distributive omit (plain Omit would collapse the union).
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type IntentRegistryEventDraft = DistributiveOmit<IntentRegistryEvent, "audit" | "seq">;

// ---------------------------------------------------------------------------
// Records + state.
// ---------------------------------------------------------------------------

export interface RegistryIntentRecord {
  readonly intentId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly desiredState: ConnectivityDesiredState;
  readonly state: IntentLifecycleState;
  readonly proposedAt: number;
  readonly lastTransitionAt: number;
  readonly transitionCount: number;
  readonly authorizedAt: number | null;
  readonly authorizationDigest: string | null;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
}

export interface IntentRegistryState {
  readonly events: ReadonlyArray<IntentRegistryEvent>;
  readonly byId: ReadonlyMap<string, RegistryIntentRecord>;
  readonly byIdempotencyKey: ReadonlyMap<string, string>; // `${tenantId}|${key}` -> intentId
  readonly byDevice: ReadonlyMap<string, ReadonlyArray<string>>; // `${tenantId}|${deviceId}` -> intentIds
  readonly seq: number;
}

export function emptyIntentRegistry(): IntentRegistryState {
  return { events: [], byId: new Map(), byIdempotencyKey: new Map(), byDevice: new Map(), seq: 0 };
}

export function deviceIndexKey(tenantId: string, deviceId: string): string {
  return `${tenantId}|${deviceId}`;
}

function proposedRecord(e: IntentProposedEvent): RegistryIntentRecord {
  return {
    intentId: e.intentId,
    tenantId: e.tenantId,
    deviceId: e.deviceId,
    desiredState: e.desiredState,
    state: "proposed",
    proposedAt: e.at,
    lastTransitionAt: e.at,
    transitionCount: 0,
    authorizedAt: null,
    authorizationDigest: null,
    supersedes: null,
    supersededBy: null,
  };
}

// ---------------------------------------------------------------------------
// Fold — the pure reducer.
// ---------------------------------------------------------------------------

export function applyIntentRegistryEvent(
  state: IntentRegistryState,
  event: IntentRegistryEvent,
): IntentRegistryState {
  if (event.seq !== state.seq + 1) return state; // append-only discipline
  const byId = new Map(state.byId);
  const byKey = new Map(state.byIdempotencyKey);
  const byDevice = new Map(state.byDevice);
  const prev = byId.get(event.intentId) ?? null;

  switch (event.kind) {
    case "proposed": {
      byId.set(event.intentId, proposedRecord(event));
      byKey.set(`${event.tenantId}|${event.idempotencyKey}`, event.intentId);
      const key = deviceIndexKey(event.tenantId, event.deviceId);
      byDevice.set(key, [...(byDevice.get(key) ?? []), event.intentId]);
      break;
    }
    case "transitioned": {
      if (prev) {
        byId.set(event.intentId, {
          ...prev,
          state: event.to,
          lastTransitionAt: event.at,
          transitionCount: prev.transitionCount + 1,
          authorizedAt: event.to === "authorized" ? event.at : prev.authorizedAt,
          authorizationDigest:
            event.to === "authorized"
              ? (event.authorizationDigest ?? prev.authorizationDigest)
              : prev.authorizationDigest,
        });
      }
      break;
    }
    case "superseded": {
      if (prev) {
        byId.set(event.intentId, { ...prev, supersededBy: event.successorIntentId });
        const successor = byId.get(event.successorIntentId);
        if (successor) {
          byId.set(event.successorIntentId, { ...successor, supersedes: event.intentId });
        }
      }
      break;
    }
  }

  return { events: [...state.events, event], byId, byIdempotencyKey: byKey, byDevice, seq: event.seq };
}

export function foldIntentRegistry(
  events: ReadonlyArray<IntentRegistryEvent>,
  from: IntentRegistryState = emptyIntentRegistry(),
): IntentRegistryState {
  let state = from;
  for (const e of events) state = applyIntentRegistryEvent(state, e);
  return state;
}

export interface IntentRegistryCheckpoint {
  readonly foldedSeq: number;
  readonly state: IntentRegistryState;
}

export function checkpointIntentRegistry(state: IntentRegistryState): IntentRegistryCheckpoint {
  return { foldedSeq: state.seq, state };
}

export function resumeIntentRegistry(
  checkpoint: IntentRegistryCheckpoint,
  events: ReadonlyArray<IntentRegistryEvent>,
): IntentRegistryState {
  if (events.length === 0) return checkpoint.state;
  const suffix = events.filter((e) => e.seq > checkpoint.foldedSeq);
  return foldIntentRegistry(suffix, checkpoint.state);
}

/** Append one event with its audit (deterministic digest over seq + identity). */
export function appendIntentRegistryEvent(
  state: IntentRegistryState,
  event: IntentRegistryEventDraft,
  actor: string,
): { readonly event: IntentRegistryEvent; readonly state: IntentRegistryState } {
  const seq = state.seq + 1;
  const audit: AuditEventRef = {
    actor,
    intent: `connectivity:registry:${event.kind}:${event.intentId}`,
    tenant: event.tenantId,
    timestamp: event.at,
    digest: digestOf(event.tenantId, event.intentId, event.kind, seq, event.at),
  };
  const full = { ...event, seq, audit } as IntentRegistryEvent;
  return { event: full, state: applyIntentRegistryEvent(state, full) };
}
