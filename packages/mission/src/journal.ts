/**
 * @fleetos/mission — the event-sourced mission journal.
 *
 * Append-only journal entries (mission created/started, stage started,
 * checkpoint recorded, stage completed/failed, mission suspended/resumed/
 * completed/failed/cancelled, work-order issued, guard rejected), each
 * with a sha256 digest CHAINED to its predecessor. The mission state is
 * a PURE FOLD over the journal — replaying the journal reproduces the
 * state exactly. Resume semantics live in the fold: a suspended mission
 * resumes from the last recorded checkpoint and never re-executes
 * completed stages (the runtime re-issues work orders ONLY for
 * incomplete stages, with the SAME idempotency key).
 */

import type { TenantContext, TenantId } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { digestOf } from "./digest.js";
import type { MissionId } from "./ids.js";
import { asMissionId } from "./ids.js";
import type { ValidatedMissionDefinition } from "./definition.js";
import type { MissionStore } from "./outbox.js";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type MissionJournalEventKind =
  | "mission-created"
  | "mission-started"
  | "stage-started"
  | "checkpoint-recorded"
  | "stage-completed"
  | "stage-failed"
  | "mission-suspended"
  | "mission-resumed"
  | "mission-completed"
  | "mission-failed"
  | "mission-cancelled"
  | "work-order-issued"
  | "guard-rejected";

export interface MissionJournalEvent {
  readonly kind: MissionJournalEventKind;
  readonly stageId?: string;
  readonly checkpointId?: string;
  readonly reason?: string;
  readonly commandId?: string;
  readonly idempotencyKey?: string;
  readonly attempt?: number;
  readonly duplicate?: boolean;
}

export interface MissionJournalEntry {
  readonly seq: number;
  readonly tenantId: TenantId;
  readonly missionId: MissionId;
  readonly event: MissionJournalEvent;
  readonly at: number;
  readonly digest: string;
  readonly prevDigest: string | null;
}

// ---------------------------------------------------------------------------
// Mission instance + stage states
// ---------------------------------------------------------------------------

export type MissionInstanceState =
  | "pending"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export type MissionStageState =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface WorkOrderView {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly attempt: number;
}

export interface CheckpointView {
  readonly checkpointId: string;
  readonly seq: number;
  readonly at: number;
}

export interface StageRuntimeView {
  readonly stageId: string;
  readonly state: MissionStageState;
  readonly workOrders: ReadonlyArray<WorkOrderView>;
  readonly checkpoints: ReadonlyArray<CheckpointView>;
}

export interface MissionView {
  readonly missionId: string;
  readonly definitionId: string;
  readonly state: MissionInstanceState;
  readonly stages: ReadonlyArray<StageRuntimeView>;
  readonly lastCheckpoint: {
    readonly stageId: string;
    readonly checkpointId: string;
    readonly seq: number;
  } | null;
  readonly createdAt: number | null;
  readonly startedAt: number | null;
  readonly suspendedAt: number | null;
  readonly resumedAt: number | null;
  readonly endedAt: number | null;
  readonly journalLength: number;
}

// ---------------------------------------------------------------------------
// Fold — the pure state function over the journal.
// ---------------------------------------------------------------------------

/**
 * Folds the journal into the mission view. Pure: the same entries always
 * produce the identical view. The fold is mechanical — transition
 * legality is enforced by the RUNTIME before entries are appended; the
 * journal is the durable record of already-legal transitions.
 */
export function foldMission(
  validated: ValidatedMissionDefinition,
  entries: ReadonlyArray<MissionJournalEntry>,
): MissionView {
  const stages: Array<{
    stageId: string;
    state: MissionStageState;
    workOrders: WorkOrderView[];
    checkpoints: CheckpointView[];
  }> = validated.definition.stages.map((stage) => ({
    stageId: stage.id,
    state: "pending",
    workOrders: [],
    checkpoints: [],
  }));
  let state: MissionInstanceState = "pending";
  let createdAt: number | null = null;
  let startedAt: number | null = null;
  let suspendedAt: number | null = null;
  let resumedAt: number | null = null;
  let endedAt: number | null = null;
  let lastCheckpoint: MissionView["lastCheckpoint"] = null;

  for (const entry of entries) {
    const event = entry.event;
    const stage = event.stageId
      ? stages.find((s) => s.stageId === event.stageId)
      : undefined;
    switch (event.kind) {
      case "mission-created":
        createdAt = entry.at;
        break;
      case "mission-started":
        state = "running";
        startedAt = entry.at;
        break;
      case "stage-started":
        if (stage) stage.state = "running";
        break;
      case "checkpoint-recorded":
        if (stage) {
          stage.checkpoints.push({
            checkpointId: event.checkpointId ?? "",
            seq: entry.seq,
            at: entry.at,
          });
        }
        lastCheckpoint = {
          stageId: event.stageId ?? "",
          checkpointId: event.checkpointId ?? "",
          seq: entry.seq,
        };
        break;
      case "stage-completed":
        if (stage) stage.state = "completed";
        break;
      case "stage-failed":
        if (stage) stage.state = "failed";
        state = "failed";
        endedAt = entry.at;
        break;
      case "mission-suspended":
        state = "suspended";
        suspendedAt = entry.at;
        break;
      case "mission-resumed":
        state = "running";
        resumedAt = entry.at;
        break;
      case "mission-completed":
        state = "completed";
        endedAt = entry.at;
        break;
      case "mission-cancelled":
        state = "cancelled";
        endedAt = entry.at;
        // Only IN-FLIGHT stages are cancelled (aborted mid-execution);
        // completed stages keep their terminal state and never-started
        // stages stay pending — the fold distinguishes "aborted" from
        // "never began".
        for (const s of stages) {
          if (s.state === "running") s.state = "cancelled";
        }
        break;
      case "work-order-issued":
        if (stage) {
          stage.workOrders.push({
            commandId: event.commandId ?? "",
            idempotencyKey: event.idempotencyKey ?? "",
            issuedAt: entry.at,
            attempt: event.attempt ?? 1,
          });
        }
        break;
      case "guard-rejected":
        break;
    }
  }

  return {
    missionId: entries.length > 0 ? String(entries[0]?.missionId) : "",
    definitionId: validated.definition.id,
    state,
    stages: stages.map((s) => ({
      stageId: s.stageId,
      state: s.state,
      workOrders: [...s.workOrders],
      checkpoints: [...s.checkpoints],
    })),
    lastCheckpoint,
    createdAt,
    startedAt,
    suspendedAt,
    resumedAt,
    endedAt,
    journalLength: entries.length,
  };
}

// ---------------------------------------------------------------------------
// Serialization + digest chaining.
// ---------------------------------------------------------------------------

export function genesisDigest(tenantId: TenantId, missionId: string): string {
  return digestOf("genesis", String(tenantId), missionId);
}

function serializeEvent(event: MissionJournalEvent): string {
  return [
    event.kind,
    event.stageId ?? "",
    event.checkpointId ?? "",
    event.reason ?? "",
    event.commandId ?? "",
    event.idempotencyKey ?? "",
    event.attempt ?? 0,
    event.duplicate ? 1 : 0,
  ].join("|");
}

export function entryDigest(
  prevDigest: string | null,
  entry: Omit<MissionJournalEntry, "digest" | "prevDigest">,
): string {
  return digestOf(
    prevDigest ?? genesisDigest(entry.tenantId, String(entry.missionId)),
    entry.seq,
    String(entry.missionId),
    serializeEvent(entry.event),
    entry.at,
  );
}

// ---------------------------------------------------------------------------
// MissionJournal — reads + replay over the committed store.
// ---------------------------------------------------------------------------

export const JOURNAL_COLLECTION = "mission-journal";

export class MissionJournal {
  constructor(private readonly store: MissionStore) {}

  /** Committed entries for a mission, seq-ordered (tenant-scoped by construction). */
  committedEntries(
    ctx: TenantContext,
    missionId: string,
  ): ReadonlyArray<MissionJournalEntry> {
    const all = this.store.collection(
      ctx.tenantId,
      JOURNAL_COLLECTION,
    ) as ReadonlyArray<MissionJournalEntry>;
    return all
      .filter((entry) => String(entry.missionId) === missionId)
      .sort((a, b) => a.seq - b.seq);
  }

  /**
   * Replay a journal into THIS store: every entry is verified against the
   * digest chain (genesis → seq 1 → …) and appended VERBATIM — digests and
   * seqs are preserved, so the folded state of the replayed journal is
   * byte-identical to the original. A tampered or gapped chain is refused.
   */
  replay(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly entries: ReadonlyArray<MissionJournalEntry>;
  }): Result<{ readonly replayed: number }, "chain-invalid" | "mission-mismatch"> {
    const sorted = [...input.entries].sort((a, b) => a.seq - b.seq);
    let prevDigest: string | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i];
      if (!entry) return fail("chain-invalid");
      if (entry.seq !== i + 1) return fail("chain-invalid");
      if (String(entry.missionId) !== input.missionId) {
        return fail("mission-mismatch");
      }
      if (String(entry.tenantId) !== String(input.ctx.tenantId)) {
        return fail("mission-mismatch");
      }
      if (entry.prevDigest !== prevDigest) return fail("chain-invalid");
      const expected = entryDigest(prevDigest, {
        seq: entry.seq,
        tenantId: entry.tenantId,
        missionId: entry.missionId,
        event: entry.event,
        at: entry.at,
      });
      if (entry.digest !== expected) return fail("chain-invalid");
      prevDigest = entry.digest;
    }
    // Append verbatim through a session per entry (state reconstruction
    // only — outbox events are NOT re-published on replay).
    for (const entry of sorted) {
      const session = this.store.openSession({ ctx: input.ctx, now: entry.at });
      const begin = session.begin();
      if (!begin.ok) return fail("chain-invalid");
      const staged = session.stage((stage) => {
        stage.put(
          JOURNAL_COLLECTION,
          `${input.missionId}#${String(entry.seq)}`,
          entry,
        );
      });
      if (!staged.ok) return fail("chain-invalid");
      const commit = session.commit();
      if (!commit.ok) return fail("chain-invalid");
    }
    return ok({ replayed: sorted.length });
  }

  /** Build (not append) the next entry for a mission — used by the runtime. */
  nextEntry(input: {
    readonly ctx: TenantContext;
    readonly missionId: string;
    readonly event: MissionJournalEvent;
    readonly now: number;
  }): MissionJournalEntry {
    const existing = this.committedEntries(input.ctx, input.missionId);
    const prevDigest =
      existing.length > 0 ? existing[existing.length - 1]?.digest ?? null : null;
    const seq = existing.length + 1;
    const base = {
      seq,
      tenantId: input.ctx.tenantId,
      missionId: asMissionId(input.missionId),
      event: input.event,
      at: input.now,
    };
    return { ...base, digest: entryDigest(prevDigest, base), prevDigest };
  }
}
