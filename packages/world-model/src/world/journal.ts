/**
 * @fleetos/world-model — the world-event journal (Wave 3, F230B).
 *
 * The append-only, digest-CHAINED journal the world state folds over —
 * mirrors the journal-fold pattern from `packages/mission` (the exemplar).
 * Entries carry `seq`/`digest`/`prevDigest` with a per-tenant genesis digest;
 * `nextWorldEntry` builds (never appends) the next entry deterministically.
 *
 * Entities (assets/agents/orgs) are OPAQUE refs: the journal stores ids and
 * observation refs only — never domain truth owned by other contexts.
 *
 * Deterministic: no clock, no randomness, no I/O.
 *
 * Split note (F230B lint conformance): these declarations moved verbatim
 * from `../world-fold.ts` (now the subpath barrel) to keep every src file
 * under the repo's max-lines lint budget. The exported surface is
 * symbol-for-symbol identical.
 */

// ---------------------------------------------------------------------------
// World events + journal entries
// ---------------------------------------------------------------------------

/** Entities are opaque refs — asset / agent / org identities only. */
export type WorldEntityType = "asset" | "agent" | "org";

export type WorldEventKind =
  | "entity-registered"
  | "observation-recorded"
  | "entity-tagged"
  | "entity-retired";

export interface WorldEvent {
  readonly kind: WorldEventKind;
  readonly entityId: string;
  readonly entityType: WorldEntityType;
  readonly observationRef?: string;
  readonly observedAtMs?: number;
  readonly value?: number;
  readonly tags?: readonly string[];
  readonly reason?: string;
}

export interface WorldJournalEntry {
  readonly seq: number;
  readonly tenantId: string;
  readonly event: WorldEvent;
  readonly atMs: number;
  readonly digest: string;
  readonly prevDigest: string | null;
}

// ---------------------------------------------------------------------------
// Folded world state (the fold's output contracts)
// ---------------------------------------------------------------------------

/** One immutable recorded observation for a world entity. */
export interface WorldObservationPoint {
  readonly observationRef: string;
  readonly atMs: number;
  readonly value: number;
}

export interface WorldEntityView {
  readonly entityId: string;
  readonly entityType: WorldEntityType;
  readonly state: "active" | "retired";
  readonly observations: readonly WorldObservationPoint[];
  readonly lastObservation: WorldObservationPoint | null;
  readonly observationCount: number;
  readonly tags: readonly string[];
  readonly registeredAtMs: number | null;
  readonly retiredAtMs: number | null;
}

export interface WorldStateView {
  readonly tenantId: string;
  readonly entities: readonly WorldEntityView[]; // sorted by entityId — deterministic
  readonly journalLength: number;
  readonly lastSeq: number;
}

export type WorldFoldRejection =
  | "mixed-tenant"
  | "seq-gap"
  | "bad-digest"
  | "invalid-event-payload";

export type WorldFoldResult =
  | { readonly ok: true; readonly state: WorldStateView }
  | { readonly ok: false; readonly rejected: WorldFoldRejection; readonly detail: string };

// ---------------------------------------------------------------------------
// Digest chaining (mirrors the mission journal chain)
// ---------------------------------------------------------------------------

export function worldGenesisDigest(tenantId: string): string {
  return fnv1a(`world-genesis|${tenantId}`);
}

function serializeWorldEvent(event: WorldEvent): string {
  return [
    event.kind,
    event.entityId,
    event.entityType,
    event.observationRef ?? "",
    event.observedAtMs ?? "",
    event.value ?? "",
    (event.tags ?? []).join(","),
    event.reason ?? "",
  ].join("|");
}

export function worldEntryDigest(
  prevDigest: string | null,
  entry: Omit<WorldJournalEntry, "digest" | "prevDigest">,
): string {
  return fnv1a(
    `world|${prevDigest ?? worldGenesisDigest(entry.tenantId)}|${entry.seq}|${entry.tenantId}|${serializeWorldEvent(entry.event)}|${entry.atMs}`,
  );
}

/**
 * Build (not append) the next journal entry for a tenant's world — used by
 * the append-side runtime and by tests. Pure + deterministic.
 */
export function nextWorldEntry(input: {
  readonly tenantId: string;
  readonly existing: readonly WorldJournalEntry[];
  readonly event: WorldEvent;
  readonly atMs: number;
}): WorldJournalEntry {
  const sorted = [...input.existing].sort((a, b) => a.seq - b.seq);
  const last = sorted.length > 0 ? sorted[sorted.length - 1] : undefined;
  const prevDigest = last ? last.digest : null;
  const base = {
    seq: (last ? last.seq : 0) + 1,
    tenantId: input.tenantId,
    event: input.event,
    atMs: input.atMs,
  };
  return { ...base, digest: worldEntryDigest(prevDigest, base), prevDigest };
}

// ---------------------------------------------------------------------------
// Deterministic digest (private; same FNV-1a pattern as the lane's other
// packages — each module keeps its own private copy by design, see the
// lane's established pattern in predictive/index.ts and world-context).
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
