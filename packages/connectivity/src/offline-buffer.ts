/**
 * @fleetos/connectivity — Wave 8 offline tolerance hardening (F280A).
 *
 * The F230A posture machine + message durability queue proved offline
 * transitions and at-least-once outbox semantics at unit scale. This module
 * hardens OFFLINE TOLERANCE for the real field lifecycle:
 *
 *   - **Deterministic offline queue with replay-in-order semantics** —
 *     entries captured while the device is offline are replayed strictly in
 *     capture (FIFO) order; the replay report carries a replay digest over
 *     the ordered entry ids, so ordering is machine-checkable.
 *   - **Divergence accounting across posture changes** — every entry is
 *     stamped with the runtime posture at CAPTURE time. When the device was
 *     offline across posture changes, the replayed batch lands against the
 *     CURRENT posture and every entry whose capture posture differs gets a
 *     typed `OfflineDivergenceRecord` (capture posture, replay posture, the
 *     posture transitions observed while the entry was pending, and the
 *     truncation count when the posture log overflowed its bound). Divergence
 *     is RECORDED, never hidden.
 *   - **Expiry of stale offline entries with reason-coded eviction** — a
 *     deterministic sweep evicts entries older than the logical-time TTL
 *     with reason `offline-entry-expired`; every evicted entry is SURFACED
 *     in the sweep result (never silently dropped). Expired iff
 *     `now >= capturedAt + ttlMs` (boundary included — tested at the edge).
 *   - **Bounded with caller-chosen overflow policy** — `reject-newest`
 *     (refuse with `offline-buffer-full`) or `drop-oldest` (evict the
 *     oldest, surfaced, reason `offline-buffer-pressured`).
 *
 * Tenant/device scope is fail-closed: the buffer is constructed for one
 * (tenantId, deviceId); a capture input that carries a foreign tenant or
 * device is refused with `tenant-mismatch` / `device-mismatch`.
 *
 * Pure deterministic TypeScript; logical `now` everywhere; no Date.now, no
 * Math.random, no network, no timers.
 */

import { createHash } from "node:crypto";
import type { PostureState } from "./posture-machine.js";
import type { AuditEventRef } from "./kernel.js";
import type { DeviceIdLike, TenantIdLike } from "./connectivity.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Offline buffer policy + entries.
// ---------------------------------------------------------------------------

export type OfflineOverflowPolicy = "drop-oldest" | "reject-newest";

export interface OfflineBufferPolicy {
  readonly maxEntries: number;
  readonly ttlMs: number; // logical-time TTL for stale-entry expiry
  readonly overflow: OfflineOverflowPolicy;
  readonly maxPostureTransitions: number; // bound on the posture log
}

export function defaultOfflineBufferPolicy(): OfflineBufferPolicy {
  return {
    maxEntries: 512,
    ttlMs: 30 * 60 * 1000, // 30 minutes in logical ms
    overflow: "reject-newest",
    maxPostureTransitions: 64,
  };
}

export interface OfflineBufferEntry {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly entryId: string; // caller-assigned, unique per buffer
  readonly sequence: number; // per-buffer monotonic capture order (FIFO law)
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly capturedAt: number; // logical time
  readonly capturedPosture: PostureState; // posture at capture — divergence anchor
}

export interface PostureTransitionRecord {
  readonly from: PostureState;
  readonly to: PostureState;
  readonly at: number;
}

export interface OfflineBuffer {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly entries: ReadonlyArray<OfflineBufferEntry>;
  readonly nextSequence: number;
  readonly postureLog: ReadonlyArray<PostureTransitionRecord>;
  readonly postureLogTruncated: number; // transitions dropped when the log bound was hit — never hidden
  readonly policy: OfflineBufferPolicy;
  readonly droppedOldest: number;
  readonly rejectedNewest: number;
}

export function emptyOfflineBuffer(
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
  policy: OfflineBufferPolicy = defaultOfflineBufferPolicy(),
): OfflineBuffer {
  if (tenantId === "") throw new TypeError("emptyOfflineBuffer: missing tenantId");
  if (deviceId === "") throw new TypeError("emptyOfflineBuffer: missing deviceId");
  if (policy.maxEntries < 1 || policy.ttlMs < 1 || policy.maxPostureTransitions < 1) {
    throw new TypeError("emptyOfflineBuffer: policy bounds must be >= 1");
  }
  return {
    tenantId,
    deviceId,
    entries: [],
    nextSequence: 1,
    postureLog: [],
    postureLogTruncated: 0,
    policy,
    droppedOldest: 0,
    rejectedNewest: 0,
  };
}

// ---------------------------------------------------------------------------
// Capture — bounded, fail-closed tenant/device scope, overflow policies.
// ---------------------------------------------------------------------------

export type OfflineCaptureRejectionCode =
  | "missing-entry-id"
  | "missing-kind"
  | "missing-tenant-id"
  | "missing-device-id"
  | "tenant-mismatch"
  | "device-mismatch"
  | "duplicate-entry-id"
  | "offline-buffer-full";

export type OfflineCaptureResult =
  | {
      readonly ok: true;
      readonly entry: OfflineBufferEntry;
      readonly buffer: OfflineBuffer;
      readonly evicted: OfflineBufferEntry | null; // drop-oldest only — surfaced
    }
  | { readonly ok: false; readonly reason: OfflineCaptureRejectionCode; readonly buffer: OfflineBuffer };

export function captureOfflineEntry(
  buffer: OfflineBuffer,
  input: {
    readonly entryId: string;
    readonly kind: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly at: number;
    readonly posture: PostureState;
    readonly tenantId?: TenantIdLike; // optional scope check — fail-closed when present
    readonly deviceId?: DeviceIdLike; // optional scope check — fail-closed when present
  },
): OfflineCaptureResult {
  if (input.entryId === "") return { ok: false, reason: "missing-entry-id", buffer };
  if (input.kind === "") return { ok: false, reason: "missing-kind", buffer };
  // Fail-closed tenant/device scope: the buffer is one tenant's device buffer.
  if (buffer.tenantId === "") return { ok: false, reason: "missing-tenant-id", buffer };
  if (input.tenantId !== undefined && input.tenantId !== buffer.tenantId) {
    return { ok: false, reason: "tenant-mismatch", buffer };
  }
  if (input.deviceId !== undefined && input.deviceId !== buffer.deviceId) {
    return { ok: false, reason: "device-mismatch", buffer };
  }
  if (buffer.entries.some((e) => e.entryId === input.entryId)) {
    return { ok: false, reason: "duplicate-entry-id", buffer };
  }

  const entry: OfflineBufferEntry = {
    tenantId: buffer.tenantId,
    deviceId: buffer.deviceId,
    entryId: input.entryId,
    sequence: buffer.nextSequence,
    kind: input.kind,
    payload: input.payload,
    capturedAt: input.at,
    capturedPosture: input.posture,
  };

  if (buffer.entries.length >= buffer.policy.maxEntries) {
    if (buffer.policy.overflow === "reject-newest") {
      return {
        ok: false,
        reason: "offline-buffer-full",
        buffer: { ...buffer, rejectedNewest: buffer.rejectedNewest + 1 },
      };
    }
    // drop-oldest: evict from the front, SURFACE the evicted entry.
    const evicted = buffer.entries[0]!;
    const entries = [...buffer.entries.slice(1), entry];
    return {
      ok: true,
      entry,
      evicted,
      buffer: {
        ...buffer,
        entries,
        nextSequence: buffer.nextSequence + 1,
        droppedOldest: buffer.droppedOldest + 1,
      },
    };
  }

  const entries = [...buffer.entries, entry];
  return {
    ok: true,
    entry,
    evicted: null,
    buffer: { ...buffer, entries, nextSequence: buffer.nextSequence + 1 },
  };
}

// ---------------------------------------------------------------------------
// Posture transition stamping — records what changed while entries waited.
// ---------------------------------------------------------------------------

export function stampPostureTransition(
  buffer: OfflineBuffer,
  transition: { readonly from: PostureState; readonly to: PostureState; readonly at: number },
): OfflineBuffer {
  const record: PostureTransitionRecord = { from: transition.from, to: transition.to, at: transition.at };
  const log = [...buffer.postureLog, record];
  if (log.length <= buffer.policy.maxPostureTransitions) {
    return { ...buffer, postureLog: log };
  }
  // Bounded log: oldest evicted, and the eviction COUNTED — never hidden.
  return {
    ...buffer,
    postureLog: log.slice(log.length - buffer.policy.maxPostureTransitions),
    postureLogTruncated: buffer.postureLogTruncated + 1,
  };
}

// ---------------------------------------------------------------------------
// Replay — strictly in capture order; divergence recorded, not hidden.
// ---------------------------------------------------------------------------

export interface OfflineDivergenceRecord {
  readonly entryId: string;
  readonly capturedPosture: PostureState;
  readonly replayedPosture: PostureState; // the CURRENT posture at replay
  readonly transitionsWhilePending: ReadonlyArray<PostureTransitionRecord>;
  readonly transitionsTruncated: number;
  readonly reason: "posture-changed-while-offline";
}

export interface OfflineReplayReport {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly replayedPosture: PostureState; // the batch lands against the CURRENT posture
  readonly replayedAt: number;
  readonly entries: ReadonlyArray<OfflineBufferEntry>; // strict FIFO capture order
  readonly divergences: ReadonlyArray<OfflineDivergenceRecord>;
  readonly replayDigest: string; // sha-256 over ordered entry ids + divergences
  readonly audit: AuditEventRef;
}

export function replayOfflineBuffer(
  buffer: OfflineBuffer,
  currentPosture: PostureState,
  now: number,
): OfflineReplayReport {
  // Replay-in-order law: entries are emitted strictly in capture (FIFO) order.
  const ordered = [...buffer.entries].sort((a, b) => a.sequence - b.sequence);

  const divergences: OfflineDivergenceRecord[] = [];
  for (const entry of ordered) {
    if (entry.capturedPosture !== currentPosture) {
      // Divergence accounting: the entry was captured under a different
      // posture than the one it is replayed against — recorded, not hidden.
      const transitionsWhilePending = buffer.postureLog.filter(
        (t) => t.at >= entry.capturedAt && t.at <= now,
      );
      divergences.push({
        entryId: entry.entryId,
        capturedPosture: entry.capturedPosture,
        replayedPosture: currentPosture,
        transitionsWhilePending,
        transitionsTruncated: buffer.postureLogTruncated,
        reason: "posture-changed-while-offline",
      });
    }
  }

  const replayDigest = digestOf(
    buffer.tenantId,
    buffer.deviceId,
    ordered.map((e) => e.entryId).join(","),
    divergences.map((d) => `${d.entryId}:${d.capturedPosture}->${d.replayedPosture}`).join(","),
    currentPosture,
    now,
  );
  const audit: AuditEventRef = {
    actor: `system:offline-buffer:${buffer.deviceId}`,
    intent: divergences.length > 0 ? "connectivity:offline:replay:with-divergence" : "connectivity:offline:replay",
    tenant: buffer.tenantId,
    timestamp: now,
    digest: replayDigest,
  };
  return {
    tenantId: buffer.tenantId,
    deviceId: buffer.deviceId,
    replayedPosture: currentPosture,
    replayedAt: now,
    entries: ordered,
    divergences,
    replayDigest,
    audit,
  };
}

// ---------------------------------------------------------------------------
// Expiry sweep — reason-coded eviction of stale entries (never silent).
// ---------------------------------------------------------------------------

export interface OfflineEviction {
  readonly entry: OfflineBufferEntry;
  readonly reason: "offline-entry-expired" | "offline-buffer-pressured";
  readonly evictedAt: number;
}

export interface OfflineSweepResult {
  readonly buffer: OfflineBuffer; // entries remaining after the sweep
  readonly evicted: ReadonlyArray<OfflineEviction>; // every evicted entry surfaced
}

export function sweepExpiredOfflineEntries(buffer: OfflineBuffer, now: number): OfflineSweepResult {
  // Expired iff now >= capturedAt + ttlMs (boundary inclusive — tested).
  const kept: OfflineBufferEntry[] = [];
  const evicted: OfflineEviction[] = [];
  for (const entry of buffer.entries) {
    if (now >= entry.capturedAt + buffer.policy.ttlMs) {
      evicted.push({ entry, reason: "offline-entry-expired", evictedAt: now });
    } else {
      kept.push(entry);
    }
  }
  // Preserve FIFO order of the kept entries (they were already in order).
  return { buffer: { ...buffer, entries: kept }, evicted };
}
