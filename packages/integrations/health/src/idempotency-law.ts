/**
 * @fleetos/integration-health — the shared idempotency law (F251 deliverable 3).
 *
 * An `IdempotencyLedger` binding the REAL lane dedup seams:
 *   - adcos command-journal idempotency keys (`byIdempotencyKey`);
 *   - aurum sync batch re-apply (`appliedIdempotencyKeys` — a fully-duplicate
 *     re-delivery leaves the store byte-identical);
 *   - apify actor-job idempotency (`createActorJobIdempotent` — manifest
 *     digest equality);
 *   - vendors catalog import dedupe (external-id content digest equality).
 *
 * THE LAW: at-least-once delivery → exactly-once applied effect. A duplicate
 * submission is ACKED (the original effect is returned); there is ONE state
 * mutation per key everywhere. A key re-used for a DIFFERENT effect is a
 * typed conflict naming the offending adapter + key.
 *
 * `proveIdempotencyLaw` machine-proves the law across ALL adapters in one
 * call from per-adapter delivery traces (the tests drive the REAL lane seams
 * to produce them). Violation reports name the offending adapter + key.
 *
 * Pure deterministic TypeScript; logical `now` is caller-supplied.
 */

import type { CommandJournalState } from "@fleetos/adcos";
import type { SyncSession } from "@fleetos/aurum";
import type { ActorJobRecord } from "@fleetos/apify";
import type { VendorCatalog } from "@fleetos/external-vendors";
import { fnv1a32, healthDigestOf } from "./health-core.js";

// ---------------------------------------------------------------------------
// Vocabulary.
// ---------------------------------------------------------------------------

export type IdempotencyAdapter = "adcos" | "aurum" | "apify" | "vendors";
export type IdempotencyScope = "command" | "sync-batch" | "actor-job" | "catalog-import";

export interface IdempotencyKeyRecord {
  readonly adapter: IdempotencyAdapter;
  readonly scope: IdempotencyScope;
  readonly tenantId: string;
  readonly key: string;
  /** Digest of the ONE applied effect for this key. */
  readonly effectDigest: string;
  readonly appliedAt: number;
  /** At-least-once re-deliveries acked after the first application. */
  readonly deliveries: number;
}

export interface IdempotencyLedgerState {
  readonly entries: ReadonlyMap<string, IdempotencyKeyRecord>;
}

export function emptyIdempotencyLedger(): IdempotencyLedgerState {
  return { entries: new Map() };
}

export function idempotencyLedgerKeyOf(tenantId: string, scope: IdempotencyScope, key: string): string {
  return `${tenantId}␟${scope}␟${key}`;
}

// ---------------------------------------------------------------------------
// The ledger — duplicate acks, exactly-once effect, typed key conflicts.
// ---------------------------------------------------------------------------

export interface IdempotentSubmission {
  readonly adapter: IdempotencyAdapter;
  readonly scope: IdempotencyScope;
  readonly tenantId: string;
  readonly key: string;
  readonly effectDigest: string;
  readonly now: number;
}

export type IdempotencySubmitResult =
  | {
      readonly ok: true;
      readonly ledger: IdempotencyLedgerState;
      readonly record: IdempotencyKeyRecord;
      /** true = duplicate submission ACKED (no new mutation). */
      readonly duplicate: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "missing-tenant" | "missing-key" | "missing-effect-digest" | "idempotency-key-conflict";
      readonly adapter: IdempotencyAdapter;
      readonly key: string;
      readonly detail: string;
    };

export function submitIdempotent(
  ledger: IdempotencyLedgerState,
  submission: IdempotentSubmission,
): IdempotencySubmitResult {
  if (submission.tenantId === "") {
    return { ok: false, reason: "missing-tenant", adapter: submission.adapter, key: submission.key, detail: "tenant is empty" };
  }
  if (submission.key === "") {
    return { ok: false, reason: "missing-key", adapter: submission.adapter, key: "", detail: "key is empty" };
  }
  if (submission.effectDigest === "") {
    return { ok: false, reason: "missing-effect-digest", adapter: submission.adapter, key: submission.key, detail: "effect digest is empty" };
  }
  const ledgerKey = idempotencyLedgerKeyOf(submission.tenantId, submission.scope, submission.key);
  const existing = ledger.entries.get(ledgerKey);
  if (existing !== undefined) {
    if (existing.effectDigest !== submission.effectDigest) {
      return {
        ok: false,
        reason: "idempotency-key-conflict",
        adapter: submission.adapter,
        key: submission.key,
        detail: `key "${submission.key}" was applied with effect ${existing.effectDigest}, not ${submission.effectDigest}`,
      };
    }
    // Duplicate submission ACKED — ONE mutation per key, everywhere.
    const record: IdempotencyKeyRecord = { ...existing, deliveries: existing.deliveries + 1 };
    return { ok: true, ledger: { entries: new Map(ledger.entries).set(ledgerKey, record) }, record, duplicate: true };
  }
  const record: IdempotencyKeyRecord = {
    adapter: submission.adapter,
    scope: submission.scope,
    tenantId: submission.tenantId,
    key: submission.key,
    effectDigest: submission.effectDigest,
    appliedAt: submission.now,
    deliveries: 1,
  };
  return { ok: true, ledger: { entries: new Map(ledger.entries).set(ledgerKey, record) }, record, duplicate: false };
}

// ---------------------------------------------------------------------------
// Binders — extract key records from the REAL lane dedup seams.
// ---------------------------------------------------------------------------

/** adcos: the command journal's own tenant-scoped idempotency index. */
export function bindAdcosCommandKeys(journal: CommandJournalState): readonly IdempotencyKeyRecord[] {
  const records: IdempotencyKeyRecord[] = [];
  for (const command of journal.byId.values()) {
    records.push({
      adapter: "adcos",
      scope: "command",
      tenantId: command.tenantId,
      key: command.idempotencyKey,
      effectDigest: fnv1a32(["adcos-command", command.commandId, command.idempotencyKey, command.commandKind, command.issuedAt]),
      appliedAt: command.issuedAt,
      deliveries: 1,
    });
  }
  return records.sort((a, b) => (a.tenantId + a.key < b.tenantId + b.key ? -1 : 1));
}

/**
 * aurum: the sync session's applied keys (per-key dedup; the effect digest is
 * the session's chained sync digest — a fully-duplicate re-delivery leaves
 * it byte-identical, so the applied effect is stable).
 */
export function bindAurumSessionKeys(session: SyncSession): readonly IdempotencyKeyRecord[] {
  const effectDigest = fnv1a32(["aurum-sync-batch", session.sessionId, session.syncDigest]);
  return session.appliedIdempotencyKeys.map((key) => ({
    adapter: "aurum" as const,
    scope: "sync-batch" as const,
    tenantId: session.tenant.tenantId,
    key,
    effectDigest,
    appliedAt: session.updatedAt,
    deliveries: 1,
  }));
}

/** apify: actor jobs carry the lane's own manifest (content) digest. */
export function bindApifyJobKeys(jobs: readonly ActorJobRecord[]): readonly IdempotencyKeyRecord[] {
  return jobs.map((job) => ({
    adapter: "apify" as const,
    scope: "actor-job" as const,
    tenantId: job.tenant.tenantId,
    key: job.idempotencyKey,
    effectDigest: job.manifest.manifestDigest,
    appliedAt: job.createdAt,
    deliveries: 1,
  }));
}

/** vendors: catalog import dedupe — the entry digest is the applied effect. */
export function bindVendorsCatalogKeys(catalog: VendorCatalog): readonly IdempotencyKeyRecord[] {
  return [...catalog.entries.values()].map((entry) => ({
    adapter: "vendors" as const,
    scope: "catalog-import" as const,
    tenantId: catalog.tenant.tenantId,
    key: entry.externalId,
    effectDigest: entry.entryDigest,
    appliedAt: entry.importedAt,
    deliveries: 1,
  }));
}

export type BindResult =
  | { readonly ok: true; readonly ledger: IdempotencyLedgerState }
  | { readonly ok: false; readonly reason: "idempotency-key-conflict"; readonly adapter: IdempotencyAdapter; readonly key: string; readonly detail: string };

/** Merge lane-binder records into the shared ledger (law-enforced). */
export function mergeIdempotencyRecords(
  ledger: IdempotencyLedgerState,
  records: readonly IdempotencyKeyRecord[],
): BindResult {
  let current = ledger;
  for (const record of records) {
    const submitted = submitIdempotent(current, {
      adapter: record.adapter,
      scope: record.scope,
      tenantId: record.tenantId,
      key: record.key,
      effectDigest: record.effectDigest,
      now: record.appliedAt,
    });
    if (!submitted.ok) {
      return { ok: false, reason: "idempotency-key-conflict", adapter: submitted.adapter, key: submitted.key, detail: submitted.detail };
    }
    current = submitted.ledger;
  }
  return { ok: true, ledger: current };
}

// ---------------------------------------------------------------------------
// The machine proof — at-least-once delivery → exactly-once applied effect.
// ---------------------------------------------------------------------------

export interface AdapterIdempotencyProbe {
  readonly adapter: IdempotencyAdapter;
  readonly tenantId: string;
  /** One entry per DELIVERY (at-least-once), in delivery order. */
  readonly deliveries: readonly {
    readonly key: string;
    readonly effectDigest: string;
    /** State mutations caused by THIS delivery (0 for re-deliveries). */
    readonly mutations: number;
  }[];
}

export type IdempotencyLawViolationKind = "key-conflict" | "duplicate-mutated" | "first-delivery-no-effect";

export interface IdempotencyLawViolation {
  readonly adapter: IdempotencyAdapter;
  readonly key: string;
  readonly violation: IdempotencyLawViolationKind;
  readonly detail: string;
}

export type IdempotencyLawProof =
  | { readonly ok: true; readonly checked: number; readonly digest: string }
  | { readonly ok: false; readonly checked: number; readonly violations: readonly IdempotencyLawViolation[]; readonly digest: string };

/** Machine-prove the idempotency law over per-adapter delivery traces. */
export function proveIdempotencyLaw(probes: readonly AdapterIdempotencyProbe[]): IdempotencyLawProof {
  const violations: IdempotencyLawViolation[] = [];
  let checked = 0;
  for (const probe of probes) {
    const byKey = new Map<string, { readonly key: string; readonly effectDigest: string; readonly mutations: number }[]>();
    for (const delivery of probe.deliveries) {
      checked += 1;
      const group = byKey.get(delivery.key) ?? [];
      group.push(delivery);
      byKey.set(delivery.key, group);
    }
    for (const [key, deliveries] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const first = deliveries[0]!;
      if (deliveries.some((d) => d.effectDigest !== first.effectDigest)) {
        violations.push({
          adapter: probe.adapter,
          key,
          violation: "key-conflict",
          detail: `key "${key}" was delivered with different effect digests`,
        });
      }
      if (first.mutations < 1) {
        violations.push({
          adapter: probe.adapter,
          key,
          violation: "first-delivery-no-effect",
          detail: `first delivery of key "${key}" caused ${String(first.mutations)} mutations (law: exactly one)`,
        });
      }
      for (let i = 1; i < deliveries.length; i++) {
        const duplicate = deliveries[i]!;
        if (duplicate.mutations > 0) {
          violations.push({
            adapter: probe.adapter,
            key,
            violation: "duplicate-mutated",
            detail: `re-delivery ${String(i + 1)} of key "${key}" caused ${String(duplicate.mutations)} mutations (law: zero)`,
          });
        }
      }
    }
  }
  const sorted = [...violations].sort((a, b) =>
    a.adapter !== b.adapter ? (a.adapter < b.adapter ? -1 : 1) : a.key !== b.key ? (a.key < b.key ? -1 : 1) : a.violation < b.violation ? -1 : 1,
  );
  const digest = healthDigestOf("idempotency-law-proof", { checked, violations: sorted.map((v) => [v.adapter, v.key, v.violation]) });
  return sorted.length === 0 ? { ok: true, checked, digest } : { ok: false, checked, violations: sorted, digest };
}

// ---------------------------------------------------------------------------
// Law digest + verify (over the shared ledger).
// ---------------------------------------------------------------------------

export function idempotencyLawDigest(ledger: IdempotencyLedgerState): string {
  const entries = [...ledger.entries.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, record]) => [key, record.effectDigest, record.deliveries]);
  return healthDigestOf("idempotency-law", { entries });
}

export function verifyIdempotencyLawDigest(ledger: IdempotencyLedgerState, digest: string): boolean {
  return idempotencyLawDigest(ledger) === digest;
}
