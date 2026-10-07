/**
 * @fleetos/world-model — deterministic world state as a pure fold (Wave 3, F230B).
 *
 * Mirrors the journal-fold pattern from `packages/mission` (the exemplar):
 * world state is a PURE FOLD over an append-only, digest-CHAINED world-event
 * journal — replaying the same entries reproduces the identical state, and
 * a tampered/gapped/mixed-tenant chain is refused with a reason code.
 *
 * Checkpoints fold a journal prefix once; `resumeWorld` continues the fold
 * from a checkpoint over a suffix without re-folding the prefix.
 *
 * Entities (assets/agents/orgs) are OPAQUE refs: the world model stores ids,
 * last-observation-driven state, tags and staleness classification — never
 * domain truth owned by other contexts.
 *
 * Predictive integration is TYPE-ONLY from `@fleetos/predictive` (intra-lane,
 * established): `askWorldProjection` maps a world entity's observation log
 * into a `TwinStateInput` and hands it to any `ModelPort`. LAW: the result is
 * ADVISORY — it carries `advisory: true`, and nothing in this module feeds a
 * projection back into the journal or into authoritative state.
 *
 * Deterministic: no clock, no randomness, no I/O; all ages/thresholds are
 * integer milliseconds.
 */

import type {
  ModelPort,
  ProjectionHorizon,
  ProjectionResult,
  TwinStateInput,
} from "@fleetos/predictive";

export type { ModelPort, ProjectionHorizon, ProjectionResult, TwinStateInput };

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
// Folded world state
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
// The pure fold
// ---------------------------------------------------------------------------

interface MutableEntity {
  entityId: string;
  entityType: WorldEntityType;
  state: "active" | "retired";
  observations: WorldObservationPoint[];
  tags: string[];
  registeredAtMs: number | null;
  retiredAtMs: number | null;
}

function validateEventPayload(event: WorldEvent): boolean {
  if (event.entityId === "") return false;
  if (event.entityType !== "asset" && event.entityType !== "agent" && event.entityType !== "org") {
    return false;
  }
  switch (event.kind) {
    case "entity-registered":
    case "entity-retired":
      return true;
    case "observation-recorded":
      return (
        typeof event.observationRef === "string" &&
        event.observationRef !== "" &&
        Number.isInteger(event.observedAtMs) &&
        typeof event.value === "number" &&
        Number.isFinite(event.value)
      );
    case "entity-tagged":
      return (
        Array.isArray(event.tags) && event.tags.every((t) => typeof t === "string" && t !== "")
      );
    default:
      return false;
  }
}

function foldEventsInto(
  entities: Map<string, MutableEntity>,
  entries: readonly WorldJournalEntry[],
): void {
  for (const entry of entries) {
    const ev = entry.event;
    let rec = entities.get(ev.entityId);
    if (!rec) {
      // Every event auto-registers an unknown entity (mechanical fold —
      // legality is enforced append-side; the journal records what happened).
      rec = {
        entityId: ev.entityId,
        entityType: ev.entityType,
        state: "active",
        observations: [],
        tags: [],
        registeredAtMs: entry.atMs,
        retiredAtMs: null,
      };
      entities.set(ev.entityId, rec);
    }
    switch (ev.kind) {
      case "entity-registered":
        // Registration of a known entity is idempotent — keeps the original
        // registeredAtMs and entityType.
        break;
      case "observation-recorded":
        rec.observations.push({
          observationRef: ev.observationRef ?? "",
          atMs: ev.observedAtMs ?? 0,
          value: ev.value ?? 0,
        });
        break;
      case "entity-tagged":
        for (const tag of ev.tags ?? []) {
          if (!rec.tags.includes(tag)) rec.tags.push(tag);
        }
        break;
      case "entity-retired":
        rec.state = "retired";
        rec.retiredAtMs = entry.atMs;
        break;
    }
  }
}

function viewOf(tenantId: string, entities: Map<string, MutableEntity>, journalLength: number): WorldStateView {
  const list = [...entities.values()].sort((a, b) => (a.entityId < b.entityId ? -1 : 1));
  return {
    tenantId,
    entities: list.map((e) => ({
      entityId: e.entityId,
      entityType: e.entityType,
      state: e.state,
      observations: [...e.observations],
      lastObservation:
        e.observations.length > 0 ? (e.observations[e.observations.length - 1] as WorldObservationPoint) : null,
      observationCount: e.observations.length,
      tags: [...e.tags],
      registeredAtMs: e.registeredAtMs,
      retiredAtMs: e.retiredAtMs,
    })),
    journalLength,
    lastSeq: journalLength,
  };
}

function verifyChain(
  sorted: readonly WorldJournalEntry[],
  tenantId: string,
): WorldFoldRejection | null {
  let prev: string | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const entry = sorted[i] as WorldJournalEntry;
    if (entry.seq !== i + 1) return "seq-gap";
    if (entry.tenantId !== tenantId) return "mixed-tenant";
    if (entry.prevDigest !== prev) return "bad-digest";
    if (entry.digest !== worldEntryDigest(prev, entry)) return "bad-digest";
    if (!validateEventPayload(entry.event)) return "invalid-event-payload";
    prev = entry.digest;
  }
  return null;
}

/**
 * Fold a full world journal into the world state. Pure + deterministic:
 * entries are folded in seq order (input order is irrelevant); seqs must be
 * contiguous from 1; the digest chain must be intact; the journal must be
 * single-tenant. Any violation fails with a reason code.
 */
export function foldWorldState(entries: readonly WorldJournalEntry[]): WorldFoldResult {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const tenantId = sorted.length > 0 ? (sorted[0] as WorldJournalEntry).tenantId : "";
  const rejected = verifyChain(sorted, tenantId);
  if (rejected !== null) {
    return { ok: false, rejected, detail: worldDetailFor(rejected) };
  }
  const entities = new Map<string, MutableEntity>();
  foldEventsInto(entities, sorted);
  return { ok: true, state: viewOf(tenantId, entities, sorted.length) };
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

export interface WorldCheckpoint {
  readonly seq: number;
  readonly state: WorldStateView;
  readonly stateDigest: string;
  readonly lastEntryDigest: string | null;
}

export function worldStateDigest(state: WorldStateView): string {
  const entities = state.entities
    .map(
      (e) =>
        `${e.entityId}|${e.entityType}|${e.state}|${e.registeredAtMs}|${e.retiredAtMs}|${e.tags.join(",")}|` +
        e.observations.map((o) => `${o.observationRef}@${o.atMs}=${o.value}`).join(","),
    )
    .join(";");
  return fnv1a(`world-state|${state.tenantId}|${state.journalLength}|${entities}`);
}

export type CheckpointResult =
  | { readonly ok: true; readonly checkpoint: WorldCheckpoint }
  | {
      readonly ok: false;
      readonly rejected: WorldFoldRejection | "invalid-checkpoint-seq";
      readonly detail: string;
    };

/** Fold the journal prefix [1..uptoSeq] into a checkpoint. */
export function checkpointWorld(
  entries: readonly WorldJournalEntry[],
  uptoSeq: number,
): CheckpointResult {
  if (!Number.isInteger(uptoSeq) || uptoSeq < 0 || uptoSeq > entries.length) {
    return {
      ok: false,
      rejected: "invalid-checkpoint-seq",
      detail: `uptoSeq must be an integer in [0, ${entries.length}]`,
    };
  }
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  const prefix = sorted.slice(0, uptoSeq);
  const tenantId = prefix.length > 0 ? (prefix[0] as WorldJournalEntry).tenantId : "";
  const rejected = verifyChain(prefix, tenantId);
  if (rejected !== null) {
    return { ok: false, rejected, detail: worldDetailFor(rejected) };
  }
  const entities = new Map<string, MutableEntity>();
  foldEventsInto(entities, prefix);
  const state = viewOf(tenantId, entities, prefix.length);
  const last = prefix.length > 0 ? (prefix[prefix.length - 1] as WorldJournalEntry) : undefined;
  return {
    ok: true,
    checkpoint: {
      seq: uptoSeq,
      state,
      stateDigest: worldStateDigest(state),
      lastEntryDigest: last ? last.digest : null,
    },
  };
}

export type ResumeResult =
  | { readonly ok: true; readonly state: WorldStateView }
  | {
      readonly ok: false;
      readonly rejected: "suffix-seq-mismatch" | "suffix-tenant-mismatch" | "bad-digest" | "invalid-event-payload";
      readonly detail: string;
    };

/** Continue the fold from a checkpoint over a suffix — no prefix re-fold. */
export function resumeWorld(
  checkpoint: WorldCheckpoint,
  suffix: readonly WorldJournalEntry[],
): ResumeResult {
  const sorted = [...suffix].sort((a, b) => a.seq - b.seq);
  const tenantId =
    checkpoint.seq === 0 && sorted.length > 0
      ? (sorted[0] as WorldJournalEntry).tenantId
      : checkpoint.state.tenantId;
  let prev: string | null = checkpoint.lastEntryDigest;
  for (let i = 0; i < sorted.length; i += 1) {
    const entry = sorted[i] as WorldJournalEntry;
    if (entry.seq !== checkpoint.seq + i + 1) {
      return {
        ok: false,
        rejected: "suffix-seq-mismatch",
        detail: `suffix seq must continue at ${checkpoint.seq + i + 1}, found ${entry.seq}`,
      };
    }
    if (entry.tenantId !== tenantId) {
      return { ok: false, rejected: "suffix-tenant-mismatch", detail: "suffix tenant differs" };
    }
    if (entry.prevDigest !== prev) {
      return { ok: false, rejected: "bad-digest", detail: "suffix chain does not link to checkpoint" };
    }
    if (entry.digest !== worldEntryDigest(prev, entry)) {
      return { ok: false, rejected: "bad-digest", detail: "suffix digest mismatch" };
    }
    if (!validateEventPayload(entry.event)) {
      return { ok: false, rejected: "invalid-event-payload", detail: "malformed event in suffix" };
    }
    prev = entry.digest;
  }
  // Copy the checkpoint entities (purity — the checkpoint is never mutated).
  const entities = new Map<string, MutableEntity>();
  for (const e of checkpoint.state.entities) {
    entities.set(e.entityId, {
      entityId: e.entityId,
      entityType: e.entityType,
      state: e.state,
      observations: [...e.observations],
      tags: [...e.tags],
      registeredAtMs: e.registeredAtMs,
      retiredAtMs: e.retiredAtMs,
    });
  }
  foldEventsInto(entities, sorted);
  return { ok: true, state: viewOf(tenantId, entities, checkpoint.seq + sorted.length) };
}

// ---------------------------------------------------------------------------
// Staleness classification (integer ms ages/thresholds)
// ---------------------------------------------------------------------------

export type StalenessClass = "fresh" | "stale" | "unknown";

export interface StalenessThresholds {
  readonly freshWithinMs: number;
  readonly staleWithinMs: number;
}

export type StalenessResult =
  | { readonly ok: true; readonly staleness: StalenessClass; readonly ageMs: number | null }
  | { readonly ok: false; readonly rejected: "invalid-thresholds" };

/**
 * Classify staleness by age thresholds. Null last-observation => unknown
 * (never observed); an age beyond the staleness window => unknown (data no
 * longer trustworthy). Ages beyond `freshWithinMs` but within
 * `staleWithinMs` => stale. Thresholds must be integers with
 * 0 <= freshWithinMs <= staleWithinMs.
 */
export function classifyStaleness(
  lastObservedAtMs: number | null,
  nowMs: number,
  thresholds: StalenessThresholds,
): StalenessResult {
  if (
    !Number.isInteger(thresholds.freshWithinMs) ||
    !Number.isInteger(thresholds.staleWithinMs) ||
    thresholds.freshWithinMs < 0 ||
    thresholds.staleWithinMs < thresholds.freshWithinMs
  ) {
    return { ok: false, rejected: "invalid-thresholds" };
  }
  if (lastObservedAtMs === null) {
    return { ok: true, staleness: "unknown", ageMs: null };
  }
  const ageMs = nowMs - lastObservedAtMs;
  if (ageMs <= thresholds.freshWithinMs) return { ok: true, staleness: "fresh", ageMs };
  if (ageMs <= thresholds.staleWithinMs) return { ok: true, staleness: "stale", ageMs };
  return { ok: true, staleness: "unknown", ageMs };
}

export interface EntityProjection extends WorldEntityView {
  readonly staleness: StalenessClass;
  readonly ageMs: number | null;
}

export type EntityProjectionResult =
  | { readonly ok: true; readonly projection: EntityProjection }
  | { readonly ok: false; readonly rejected: "invalid-thresholds" };

/** Project a world entity with staleness classification at `nowMs`. */
export function projectEntity(
  entity: WorldEntityView,
  nowMs: number,
  thresholds: StalenessThresholds,
): EntityProjectionResult {
  const classified = classifyStaleness(
    entity.lastObservation ? entity.lastObservation.atMs : null,
    nowMs,
    thresholds,
  );
  if (!classified.ok) return { ok: false, rejected: classified.rejected };
  return {
    ok: true,
    projection: { ...entity, staleness: classified.staleness, ageMs: classified.ageMs },
  };
}

// ---------------------------------------------------------------------------
// Predictive integration (advisory; ModelPort supplied by the caller)
// ---------------------------------------------------------------------------

/**
 * Ask a ModelPort for a forward projection of a world entity's observation
 * log. The result is ADVISORY (law: predictive output is never
 * authoritative) — it is never folded back into the world journal.
 */
export function askWorldProjection(input: {
  readonly tenantId: string;
  readonly entity: WorldEntityView;
  readonly metric: string;
  readonly asOfMs: number;
  readonly horizon: ProjectionHorizon;
  readonly port: ModelPort;
}): ProjectionResult {
  const twinInput: TwinStateInput = {
    tenant: { tenantId: input.tenantId },
    asset: { assetId: input.entity.entityId },
    metric: input.metric,
    observations: input.entity.observations,
    asOfMs: input.asOfMs,
  };
  return input.port.project(twinInput, input.horizon);
}

// ---------------------------------------------------------------------------
// Deterministic digest (private, same FNV-1a as the lane's other packages)
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function worldDetailFor(rejected: WorldFoldRejection): string {
  switch (rejected) {
    case "mixed-tenant":
      return "journal contains entries from more than one tenant";
    case "seq-gap":
      return "journal seq numbers must be contiguous from 1";
    case "bad-digest":
      return "journal digest chain is broken or tampered";
    case "invalid-event-payload":
      return "journal contains a malformed event payload";
  }
}
