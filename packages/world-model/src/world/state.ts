/**
 * @fleetos/world-model — the world state fold + checkpoints (Wave 3, F230B).
 *
 * World state as a PURE FOLD over the digest-chained world-event journal
 * (`./journal.ts`): replaying the same entries reproduces the identical
 * state, and a tampered/gapped/mixed-tenant chain is refused with a reason
 * code. Checkpoints fold a journal prefix once; `resumeWorld` continues the
 * fold from a checkpoint over a suffix without re-folding the prefix.
 *
 * Deterministic: no clock, no randomness, no I/O; all ages/thresholds are
 * integer milliseconds.
 *
 * Split note (F230B lint conformance): this implementation moved verbatim
 * from `../world-fold.ts` (now the subpath barrel) to keep every src file
 * under the repo's max-lines lint budget — zero behavior change.
 */

import type {
  WorldEntityType,
  WorldEvent,
  WorldFoldRejection,
  WorldFoldResult,
  WorldJournalEntry,
  WorldObservationPoint,
  WorldStateView,
} from "./journal.ts";
import { worldEntryDigest } from "./journal.ts";

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
// Private helpers
// ---------------------------------------------------------------------------

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

/** FNV-1a 32-bit — deterministic, not cryptographic; internal chaining only. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
