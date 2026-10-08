/**
 * @fleetos/connectivity — Wave 5 intent registry (F250A).
 *
 * Tenant-scoped registry of connectivity intents as an EVENT FOLD over the
 * append-only journal (`intent-journal.ts`):
 *
 *   - `proposeIntent` — validated, idempotency-key deduped (tenant-scoped);
 *   - `transitionRegistryIntent` — consults the lifecycle machine
 *     (`intent-lifecycle.ts`): the Guardian law is enforced there;
 *   - `supersedeIntent` — supersedes a non-active predecessor with a new
 *     intent, carrying PROVENANCE (actor + reason + at);
 *   - fail-closed cross-tenant lookups (tenant mismatch == unknown-intent);
 *   - deterministic ordering everywhere ((deviceId, proposedAt, intentId));
 *   - checkpoints let the fold resume from a prefix (fold replay == state).
 *
 * Pure deterministic TypeScript; logical `now` everywhere.
 */

import type { ConnectivityDesiredState, DeviceIdLike, TenantIdLike } from "./connectivity.js";
import type { AuditEventRef } from "./kernel.js";
import {
  transitionIntentLifecycle,
  type AuthorizationGrant,
  type IntentLifecycleEventKind,
  type IntentLifecycleRejectionCode,
  type IntentPolicyCeiling,
} from "./intent-lifecycle.js";
import {
  appendIntentRegistryEvent,
  deviceIndexKey,
  type IntentRegistryEvent,
  type IntentRegistryEventDraft,
  type IntentRegistryState,
  type RegistryIntentRecord,
} from "./intent-journal.js";

export type { AuditEventRef };
export {
  emptyIntentRegistry,
  deviceIndexKey,
  applyIntentRegistryEvent,
  foldIntentRegistry,
  checkpointIntentRegistry,
  resumeIntentRegistry,
  appendIntentRegistryEvent,
} from "./intent-journal.js";
export type {
  IntentProposedEvent,
  IntentTransitionedEvent,
  IntentSupersededEvent,
  IntentRegistryEvent,
  IntentRegistryEventKind,
  IntentRegistryEventDraft,
  RegistryIntentRecord,
  IntentRegistryState,
  IntentRegistryCheckpoint,
} from "./intent-journal.js";

// ---------------------------------------------------------------------------
// Rejections + results.
// ---------------------------------------------------------------------------

export type IntentRegistryRejectionCode =
  | IntentLifecycleRejectionCode // reused vocabulary (missing-tenant-id, policy-denied, ...)
  | "unknown-intent" // fail-closed: unknown == cross-tenant
  | "missing-idempotency-key"
  | "invalid-now"
  | "not-supersedeable" // active/terminated intents must be suspended/terminated first
  | "missing-provenance-reason";

export type IntentRegistryTransitionResult =
  | {
      readonly ok: true;
      readonly event: IntentRegistryEvent;
      readonly state: IntentRegistryState;
      readonly record: RegistryIntentRecord;
    }
  | { readonly ok: false; readonly reason: IntentRegistryRejectionCode };

function lookupIntent(
  state: IntentRegistryState,
  tenantId: TenantIdLike,
  intentId: string,
): RegistryIntentRecord | null {
  const record = state.byId.get(intentId);
  if (!record || record.tenantId !== tenantId) return null; // fail-closed
  return record;
}

// ---------------------------------------------------------------------------
// propose — idempotency-key dedup (tenant-scoped).
// ---------------------------------------------------------------------------

export type ProposeIntentResult =
  | {
      readonly ok: true;
      readonly duplicate: false;
      readonly intentId: string;
      readonly event: IntentRegistryEvent;
      readonly state: IntentRegistryState;
    }
  | { readonly ok: true; readonly duplicate: true; readonly intentId: string; readonly state: IntentRegistryState }
  | { readonly ok: false; readonly reason: IntentRegistryRejectionCode };

export function proposeIntent(
  state: IntentRegistryState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly deviceId: DeviceIdLike;
    readonly desiredState: ConnectivityDesiredState;
    readonly idempotencyKey: string;
    readonly at: number;
    readonly actor: string;
  },
): ProposeIntentResult {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.deviceId === "") return { ok: false, reason: "missing-device-id" };
  if (input.idempotencyKey === "") return { ok: false, reason: "missing-idempotency-key" };
  if (!Number.isFinite(input.at) || input.at <= 0) return { ok: false, reason: "invalid-now" };

  const existing = state.byIdempotencyKey.get(`${input.tenantId}|${input.idempotencyKey}`);
  if (existing !== undefined) {
    return { ok: true, duplicate: true, intentId: existing, state };
  }

  const intentId = `intent_${intentIdDigest(input.tenantId, input.idempotencyKey)}`;
  const appended = appendIntentRegistryEvent(
    state,
    {
      kind: "proposed",
      intentId,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      desiredState: input.desiredState,
      idempotencyKey: input.idempotencyKey,
      at: input.at,
    },
    input.actor,
  );
  return { ok: true, duplicate: false, intentId, event: appended.event, state: appended.state };
}

function intentIdDigest(tenantId: string, idempotencyKey: string): string {
  // FNV-1a 32-bit (lane convention for identifiers) — deterministic.
  const text = `${tenantId}|${idempotencyKey}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const h2 = Math.imul(h ^ text.length, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + (text.length % 256).toString(16).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// transition — through the lifecycle machine (Guardian law enforced there).
// ---------------------------------------------------------------------------

export function transitionRegistryIntent(
  state: IntentRegistryState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly intentId: string;
    readonly eventKind: IntentLifecycleEventKind;
    readonly now: number;
    readonly actor: string;
    readonly reason?: string;
    readonly authorization?: AuthorizationGrant;
    readonly ceiling?: IntentPolicyCeiling;
  },
): IntentRegistryTransitionResult {
  const record = lookupIntent(state, input.tenantId, input.intentId);
  if (!record) return { ok: false, reason: "unknown-intent" };

  const machine = transitionIntentLifecycle({
    tenantId: input.tenantId,
    deviceId: record.deviceId,
    from: record.state,
    event: input.eventKind,
    now: input.now,
    actor: input.actor,
    reason: input.reason,
    authorization: input.authorization,
    ceiling: input.ceiling,
  });
  if (!machine.ok) return { ok: false, reason: machine.reason };

  const appended = appendIntentRegistryEvent(
    state,
    {
      kind: "transitioned",
      intentId: input.intentId,
      tenantId: input.tenantId,
      eventKind: input.eventKind,
      from: machine.from,
      to: machine.to,
      authorizationDigest: input.authorization?.authorizationDigest,
      at: input.now,
    },
    input.actor,
  );
  return {
    ok: true,
    event: appended.event,
    state: appended.state,
    record: appended.state.byId.get(input.intentId)!,
  };
}

// ---------------------------------------------------------------------------
// supersede — provenance-carried replacement (non-active predecessors only).
// ---------------------------------------------------------------------------

export function supersedeIntent(
  state: IntentRegistryState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly predecessorIntentId: string;
    readonly successor: {
      readonly deviceId: DeviceIdLike;
      readonly desiredState: ConnectivityDesiredState;
      readonly idempotencyKey: string;
    };
    readonly provenance: { readonly actor: string; readonly reason: string; readonly at: number };
  },
): ProposeIntentResult | { readonly ok: false; readonly reason: IntentRegistryRejectionCode } {
  const predecessor = lookupIntent(state, input.tenantId, input.predecessorIntentId);
  if (!predecessor) return { ok: false, reason: "unknown-intent" };
  if (predecessor.state === "active") {
    return { ok: false, reason: "not-supersedeable" }; // suspend/terminate first
  }
  if (predecessor.state === "terminated" || predecessor.supersededBy !== null) {
    return { ok: false, reason: "not-supersedeable" };
  }
  if (input.provenance.reason === "") return { ok: false, reason: "missing-provenance-reason" };

  const proposed = proposeIntent(state, {
    tenantId: input.tenantId,
    deviceId: input.successor.deviceId,
    desiredState: input.successor.desiredState,
    idempotencyKey: input.successor.idempotencyKey,
    at: input.provenance.at,
    actor: input.provenance.actor,
  });
  if (!proposed.ok || proposed.duplicate) return proposed;

  const appended = appendIntentRegistryEvent(
    proposed.state,
    {
      kind: "superseded",
      intentId: input.predecessorIntentId,
      tenantId: input.tenantId,
      successorIntentId: proposed.intentId,
      provenance: input.provenance,
      at: input.provenance.at,
    },
    input.provenance.actor,
  );
  return { ...proposed, event: appended.event, state: appended.state };
}

// ---------------------------------------------------------------------------
// Tenant-scoped fail-closed lookups (deterministic ordering).
// ---------------------------------------------------------------------------

export function findIntent(
  state: IntentRegistryState,
  tenantId: TenantIdLike,
  intentId: string,
): RegistryIntentRecord | null {
  return lookupIntent(state, tenantId, intentId);
}

export function listIntentsByTenant(
  state: IntentRegistryState,
  tenantId: TenantIdLike,
): ReadonlyArray<RegistryIntentRecord> {
  const out = [...state.byId.values()].filter((r) => r.tenantId === tenantId);
  return sortIntents(out);
}

export function listIntentsByDevice(
  state: IntentRegistryState,
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
): ReadonlyArray<RegistryIntentRecord> {
  const ids = state.byDevice.get(deviceIndexKey(tenantId, deviceId)) ?? [];
  return sortIntents(ids.map((id) => state.byId.get(id)!));
}

function sortIntents(records: ReadonlyArray<RegistryIntentRecord>): ReadonlyArray<RegistryIntentRecord> {
  return [...records].sort((a, b) =>
    a.deviceId !== b.deviceId
      ? a.deviceId < b.deviceId
        ? -1
        : 1
      : a.proposedAt !== b.proposedAt
        ? a.proposedAt - b.proposedAt
        : a.intentId < b.intentId
          ? -1
          : 1,
  );
}

/** The active intent for a device (latest by proposedAt, ties by intentId). */
export function activeIntentForDevice(
  state: IntentRegistryState,
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
): RegistryIntentRecord | null {
  const active = listIntentsByDevice(state, tenantId, deviceId).filter((r) => r.state === "active");
  if (active.length === 0) return null;
  return active.reduce((best, r) =>
    r.proposedAt > best.proposedAt || (r.proposedAt === best.proposedAt && r.intentId > best.intentId) ? r : best,
  );
}
