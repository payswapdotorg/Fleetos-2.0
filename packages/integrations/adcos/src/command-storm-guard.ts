/**
 * @fleetos/adcos — Wave 8 retry-storm protection + bounded sweeps (F280A).
 *
 * The F250A lifecycle proved idempotency-key dedup at ISSUE time and a
 * deterministic backoff ladder. At fleet scale three gaps remain, closed
 * here as a sibling module (the existing lifecycle semantics are unchanged):
 *
 *   - **Delivery dedup under repeated delivery** — at-least-once transports
 *     re-deliver the same command to the edge. `DeliveryDedupWindow`
 *     deduplicates (tenant, commandId) deliveries within a LOGICAL-TIME
 *     window and returns the recorded outcome digest on a duplicate hit
 *     (idempotent — the command is NOT re-executed). Window semantics in
 *     logical time: a delivery observed at T suppresses re-deliveries in
 *     (T, T + windowMs); at exactly T + windowMs the entry is stale (the
 *     sweep evicts it and a re-delivery counts as first again). Bounded
 *     memory: at most `maxEntries` — under pressure the OLDEST entries are
 *     evicted and the eviction is COUNTED (never hidden).
 *   - **Dispatch rate guard (retry-storm protection)** — the caller consults
 *     `admitDispatchAttempt` BEFORE `dispatchAdcosCommand`:
 *     (a) per-command backoff enforcement — a retry before the ladder's
 *     `nextRetryAt` is refused `retry-backoff-not-elapsed` with the honest
 *     `eligibleAt`; (b) per-command attempt budget per logical window —
 *     refused `command-dispatch-rate-exceeded`; (c) per-tenant dispatch
 *     budget per logical window — refused `tenant-dispatch-rate-exceeded`
 *     (a storming device cannot consume the whole tenant's budget, and one
 *     tenant's storm never locks out another tenant — fail-closed isolation).
 *   - **Bounded expiry sweeps** — `expireAdcosCommandsBounded` expires at
 *     most `maxPerSweep` due commands per call, ordered deterministically
 *     (expiresAt asc, then commandId asc), and reports `remainingDue` —
 *     an honest partial sweep, never a hidden backlog.
 *
 * Tenant isolation is fail-closed everywhere: dedup entries are keyed
 * `${tenantId}|${commandId}` — a foreign tenant's identical commandId does
 * NOT dedup; rate-guard counters are per-tenant.
 *
 * Pure deterministic TypeScript; logical `now` everywhere; no Date.now, no
 * Math.random, no network, no timers.
 */

import type { TenantIdLike } from "./adcos.js";
import {
  applyCommandEvent,
  makeEventAudit,
  type CommandJournalEvent,
  type CommandJournalEventDraft,
  type CommandJournalEventWithSeq,
  type CommandJournalState,
} from "./command-journal.js";

// ---------------------------------------------------------------------------
// Delivery dedup window — logical-time dedup semantics.
// ---------------------------------------------------------------------------

export interface DeliveryDedupPolicy {
  readonly windowMs: number;
  readonly maxEntries: number;
}

export function defaultDeliveryDedupPolicy(): DeliveryDedupPolicy {
  return { windowMs: 10 * 60 * 1000, maxEntries: 4096 };
}

export interface DeliveryDedupEntry {
  readonly tenantId: TenantIdLike;
  readonly commandId: string;
  readonly at: number; // logical time of the FIRST delivery that was recorded
  readonly outcomeDigest: string; // the executed outcome — replayed on duplicates
}

export interface DeliveryDedupWindow {
  readonly entries: ReadonlyMap<string, DeliveryDedupEntry>; // `${tenantId}|${commandId}`
  readonly policy: DeliveryDedupPolicy;
  readonly pressureEvicted: number; // entries evicted under memory pressure — never hidden
}

export function emptyDeliveryDedupWindow(policy: DeliveryDedupPolicy = defaultDeliveryDedupPolicy()): DeliveryDedupWindow {
  if (policy.windowMs < 1 || policy.maxEntries < 1) {
    throw new TypeError("emptyDeliveryDedupWindow: windowMs and maxEntries must be >= 1");
  }
  return { entries: new Map(), policy, pressureEvicted: 0 };
}

export type DeliveryDedupDecision =
  | {
      readonly ok: true;
      readonly duplicate: true;
      readonly entry: DeliveryDedupEntry; // the prior delivery — outcome digest replayed
      readonly window: DeliveryDedupWindow;
    }
  | { readonly ok: true; readonly duplicate: false; readonly window: DeliveryDedupWindow }
  | { readonly ok: false; readonly reason: "missing-tenant-id" | "missing-command-id" };

/**
 * Observe a delivery. Dedup window semantics (logical time):
 *   - A delivery recorded at T suppresses re-deliveries in (T, T + windowMs).
 *   - At exactly T + windowMs the entry is STALE — a delivery at that
 *     logical instant counts as a FIRST delivery again (boundary included
 *     in expiry; tested at the edge).
 *   - Entries are keyed `${tenantId}|${commandId}` — cross-tenant delivery
 *     of the same commandId NEVER dedups (fail-closed tenant separation).
 */
export function observeDelivery(
  window: DeliveryDedupWindow,
  input: {
    readonly tenantId: TenantIdLike;
    readonly commandId: string;
    readonly at: number;
    readonly outcomeDigest: string;
  },
): DeliveryDedupDecision {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.commandId === "") return { ok: false, reason: "missing-command-id" };
  const key = `${input.tenantId}|${input.commandId}`;
  const existing = window.entries.get(key);
  if (existing && input.at < existing.at + window.policy.windowMs) {
    // Duplicate within the window — idempotent: replay the recorded outcome.
    return { ok: true, duplicate: true, entry: existing, window };
  }
  let entries = new Map(window.entries);
  let pressureEvicted = window.pressureEvicted;
  if (entries.size >= window.policy.maxEntries && !entries.has(key)) {
    // Memory pressure: evict the OLDEST entry (insertion order), counted.
    const oldestKey = entries.keys().next().value;
    if (oldestKey !== undefined) {
      entries.delete(oldestKey);
      pressureEvicted += 1;
    }
  }
  entries.set(key, {
    tenantId: input.tenantId,
    commandId: input.commandId,
    at: input.at,
    outcomeDigest: input.outcomeDigest,
  });
  return { ok: true, duplicate: false, window: { entries, policy: window.policy, pressureEvicted } };
}

/** Bounded sweep — removes entries older than the window (reason-coded). */
export interface DeliveryDedupEviction {
  readonly entry: DeliveryDedupEntry;
  readonly reason: "dedup-window-expired";
  readonly evictedAt: number;
}

export function sweepDeliveryDedupWindow(
  window: DeliveryDedupWindow,
  now: number,
): { readonly window: DeliveryDedupWindow; readonly evicted: ReadonlyArray<DeliveryDedupEviction> } {
  const entries = new Map<string, DeliveryDedupEntry>();
  const evicted: DeliveryDedupEviction[] = [];
  for (const [key, entry] of window.entries) {
    if (now >= entry.at + window.policy.windowMs) {
      evicted.push({ entry, reason: "dedup-window-expired", evictedAt: now });
    } else {
      entries.set(key, entry);
    }
  }
  return { window: { entries, policy: window.policy, pressureEvicted: window.pressureEvicted }, evicted };
}

// ---------------------------------------------------------------------------
// Dispatch rate guard — retry-storm protection at the dispatch boundary.
// ---------------------------------------------------------------------------

export interface DispatchRatePolicy {
  readonly windowMs: number; // logical window for rate budgets
  readonly maxAttemptsPerCommandPerWindow: number;
  readonly maxDispatchesPerTenantPerWindow: number;
}

export function defaultDispatchRatePolicy(): DispatchRatePolicy {
  return { windowMs: 60 * 1000, maxAttemptsPerCommandPerWindow: 5, maxDispatchesPerTenantPerWindow: 500 };
}

interface RateCounter {
  readonly at: number;
  readonly count: number;
}

export interface DispatchRateGuard {
  readonly perCommand: ReadonlyMap<string, ReadonlyArray<RateCounter>>; // `${tenantId}|${commandId}`
  readonly perTenant: ReadonlyMap<TenantIdLike, ReadonlyArray<RateCounter>>;
  readonly policy: DispatchRatePolicy;
}

export function emptyDispatchRateGuard(policy: DispatchRatePolicy = defaultDispatchRatePolicy()): DispatchRateGuard {
  if (
    policy.windowMs < 1 ||
    policy.maxAttemptsPerCommandPerWindow < 1 ||
    policy.maxDispatchesPerTenantPerWindow < 1
  ) {
    throw new TypeError("emptyDispatchRateGuard: policy bounds must be >= 1");
  }
  return { perCommand: new Map(), perTenant: new Map(), policy };
}

export type DispatchAdmissionRejectionCode =
  | "missing-tenant-id"
  | "missing-command-id"
  | "retry-backoff-not-elapsed"
  | "command-dispatch-rate-exceeded"
  | "tenant-dispatch-rate-exceeded";

export type DispatchAdmission =
  | {
      readonly ok: true;
      readonly guard: DispatchRateGuard;
    }
  | {
      readonly ok: false;
      readonly reason: DispatchAdmissionRejectionCode;
      readonly eligibleAt?: number; // retry-backoff-not-elapsed: when the retry may proceed
      readonly windowCount?: number; // rate refusals: the honest in-window count
      readonly windowLimit?: number;
    };

function inWindowBuckets(buckets: ReadonlyArray<RateCounter> | undefined, now: number, windowMs: number): RateCounter[] {
  return (buckets ?? []).filter((b) => now < b.at + windowMs);
}

function windowTotal(buckets: ReadonlyArray<RateCounter>, now: number, windowMs: number): number {
  return inWindowBuckets(buckets, now, windowMs).reduce((sum, b) => sum + b.count, 0);
}

/**
 * Admit a dispatch attempt. The caller consults this BEFORE
 * `dispatchAdcosCommand` and only proceeds when ok. On ok the caller
 * records the accepted attempt via the RETURNED guard (counters advanced).
 */
export function admitDispatchAttempt(
  guard: DispatchRateGuard,
  input: {
    readonly tenantId: TenantIdLike;
    readonly commandId: string;
    readonly at: number;
    readonly nextRetryAt?: number | null; // from the journal record's backoff ladder
  },
): DispatchAdmission {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (input.commandId === "") return { ok: false, reason: "missing-command-id" };

  // (a) Backoff ladder enforcement — a retry before nextRetryAt is a storm.
  if (input.nextRetryAt !== null && input.nextRetryAt !== undefined && input.at < input.nextRetryAt) {
    return { ok: false, reason: "retry-backoff-not-elapsed", eligibleAt: input.nextRetryAt };
  }

  const commandKey = `${input.tenantId}|${input.commandId}`;
  const commandTotal = windowTotal(guard.perCommand.get(commandKey) ?? [], input.at, guard.policy.windowMs);
  if (commandTotal >= guard.policy.maxAttemptsPerCommandPerWindow) {
    return {
      ok: false,
      reason: "command-dispatch-rate-exceeded",
      windowCount: commandTotal,
      windowLimit: guard.policy.maxAttemptsPerCommandPerWindow,
    };
  }
  const tenantTotal = windowTotal(guard.perTenant.get(input.tenantId) ?? [], input.at, guard.policy.windowMs);
  if (tenantTotal >= guard.policy.maxDispatchesPerTenantPerWindow) {
    return {
      ok: false,
      reason: "tenant-dispatch-rate-exceeded",
      windowCount: tenantTotal,
      windowLimit: guard.policy.maxDispatchesPerTenantPerWindow,
    };
  }

  // Accept + advance both counters (sliding logical window, deterministic).
  const perCommand = new Map(guard.perCommand);
  perCommand.set(commandKey, bumpBucket(perCommand.get(commandKey), input.at));
  const perTenant = new Map(guard.perTenant);
  perTenant.set(input.tenantId, bumpBucket(perTenant.get(input.tenantId), input.at));
  return { ok: true, guard: { perCommand, perTenant, policy: guard.policy } };
}

function bumpBucket(buckets: ReadonlyArray<RateCounter> | undefined, at: number): RateCounter[] {
  const next = [...(buckets ?? [])];
  const last = next[next.length - 1];
  if (last && last.at === at) {
    next[next.length - 1] = { at, count: last.count + 1 };
    return next;
  }
  next.push({ at, count: 1 });
  return next;
}

/** Deterministic prune — drops fully-expired buckets (bounded memory). */
export function pruneDispatchRateGuard(guard: DispatchRateGuard, now: number): DispatchRateGuard {
  const perCommand = new Map<string, ReadonlyArray<RateCounter>>();
  for (const [key, buckets] of guard.perCommand) {
    const kept = inWindowBuckets(buckets, now, guard.policy.windowMs);
    if (kept.length > 0) perCommand.set(key, kept);
  }
  const perTenant = new Map<TenantIdLike, ReadonlyArray<RateCounter>>();
  for (const [key, buckets] of guard.perTenant) {
    const kept = inWindowBuckets(buckets, now, guard.policy.windowMs);
    if (kept.length > 0) perTenant.set(key, kept);
  }
  return { perCommand, perTenant, policy: guard.policy };
}

// ---------------------------------------------------------------------------
// Bounded expiry sweep — batch sweeps with bounds at fleet scale.
// ---------------------------------------------------------------------------

export type BoundedSweepRejectionCode = "invalid-sweep-bound";

export type BoundedExpireResult =
  | { readonly ok: false; readonly reason: BoundedSweepRejectionCode }
  | {
      readonly ok: true;
      readonly state: CommandJournalState;
      readonly expired: ReadonlyArray<string>;
      readonly remainingDue: number; // honest partial sweep — the backlog is never hidden
    };

/**
 * Bounded variant of `expireAdcosCommands`: expires at most `maxPerSweep`
 * due commands per call. Due ordering is deterministic — (expiresAt asc,
 * commandId asc) — so repeated sweeps make deterministic progress. Each
 * expired command appends exactly one `expired` journal event through the
 * journal's own chained-audit primitives (`makeEventAudit` +
 * `applyCommandEvent` — the same append path the lifecycle uses), so the
 * digest chain and every projection stay byte-identical in semantics.
 */
export function expireAdcosCommandsBounded(
  state: CommandJournalState,
  input: {
    readonly tenantId: TenantIdLike;
    readonly now: number;
    readonly actor: string;
    readonly maxPerSweep: number;
  },
): BoundedExpireResult {
  if (!Number.isFinite(input.maxPerSweep) || input.maxPerSweep < 1) {
    return { ok: false, reason: "invalid-sweep-bound" };
  }
  if (input.tenantId === "") {
    // Tenant-scoped sweep with no tenant fails closed (nothing expires).
    return { ok: true, state, expired: [], remainingDue: 0 };
  }
  // Deterministic due list: expiresAt asc, then commandId asc.
  const due = [...state.byId.values()]
    .filter(
      (r) =>
        r.tenantId === input.tenantId &&
        (r.phase === "issued" || r.phase === "dispatched") &&
        r.expiresAt !== null &&
        r.expiresAt <= input.now,
    )
    .sort((a, b) => {
      const ea = a.expiresAt ?? 0;
      const eb = b.expiresAt ?? 0;
      if (ea !== eb) return ea - eb;
      return a.commandId < b.commandId ? -1 : 1;
    })
    .map((r) => r.commandId);

  const batch = due.slice(0, input.maxPerSweep);
  let next = state;
  for (const commandId of batch) {
    next = appendExpiredEvent(next, commandId, input.tenantId, input.now, input.actor);
  }
  return {
    ok: true,
    state: next,
    expired: batch,
    remainingDue: due.length - batch.length, // honest partial sweep — never hidden
  };
}

/** Appends exactly one chained `expired` event — the journal's own append path. */
function appendExpiredEvent(
  state: CommandJournalState,
  commandId: string,
  tenantId: TenantIdLike,
  at: number,
  actor: string,
): CommandJournalState {
  const seq = state.seq + 1;
  const draft: CommandJournalEventDraft = { kind: "expired", commandId, tenantId, at };
  const withoutAudit = { ...draft, seq } as CommandJournalEventWithSeq;
  const audit = makeEventAudit(state, withoutAudit, actor);
  const full = { ...withoutAudit, audit } as CommandJournalEvent;
  return applyCommandEvent(state, full);
}
