/**
 * @fleetos/acceptance-field — LOCAL structural mirror of the tower's
 * mission-replay contract (@fleetos/mission `journal.ts`).
 *
 * SEAM NOTE (documented for TL adjudication): cross-lane imports are
 * forbidden for this package, so the mission-replay journey binds a LOCAL
 * structural mirror — field-for-field the tower's vocabulary (journal event
 * kinds, MissionView/StageRuntimeView/WorkOrderView/CheckpointView shapes,
 * `workOrderIdempotencyKey(missionId, stageId)`) — and drives it over THIS
 * lane's REAL state (observation-batch stages executed through the REAL
 * observations pipeline + twin admission). Symbol-level equivalence with
 * the real mission fold is a TL test-time composition, not claimed here.
 *
 * The resume law under test is the tower's documented semantic: a suspended
 * mission resumes from the last recorded checkpoint and NEVER re-executes
 * completed stages — the runtime re-issues work orders ONLY for incomplete
 * stages, with the SAME idempotency key.
 *
 * Pure deterministic TS; logical `now` everywhere.
 */

import { digestOf } from "./determinism.js";

// ---------------------------------------------------------------------------
// Mirror vocabulary (shapes mirror @fleetos/mission; no import).
// ---------------------------------------------------------------------------

export type MirrorMissionEventKind =
  | "mission-created"
  | "mission-started"
  | "stage-started"
  | "checkpoint-recorded"
  | "stage-completed"
  | "stage-failed"
  | "mission-suspended"
  | "mission-resumed"
  | "mission-completed"
  | "mission-cancelled"
  | "work-order-issued"
  | "guard-rejected";

export interface MirrorMissionEvent {
  readonly kind: MirrorMissionEventKind;
  readonly stageId?: string;
  readonly checkpointId?: string;
  readonly reason?: string;
  readonly commandId?: string;
  readonly idempotencyKey?: string;
  readonly attempt?: number;
}

export interface MirrorMissionEntry {
  readonly seq: number;
  readonly tenantId: string;
  readonly missionId: string;
  readonly event: MirrorMissionEvent;
  readonly at: number;
}

export type MirrorInstanceState = "pending" | "running" | "suspended" | "completed" | "failed" | "cancelled";
export type MirrorStageState = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface MirrorWorkOrderView {
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly attempt: number;
}

export interface MirrorCheckpointView {
  readonly checkpointId: string;
  readonly seq: number;
  readonly at: number;
}

export interface MirrorStageView {
  readonly stageId: string;
  readonly state: MirrorStageState;
  readonly workOrders: readonly MirrorWorkOrderView[];
  readonly checkpoints: readonly MirrorCheckpointView[];
}

export interface MirrorMissionView {
  readonly missionId: string;
  readonly definitionId: string;
  readonly state: MirrorInstanceState;
  readonly stages: readonly MirrorStageView[];
  readonly lastCheckpoint: { readonly stageId: string; readonly checkpointId: string; readonly seq: number } | null;
  readonly createdAt: number | null;
  readonly startedAt: number | null;
  readonly suspendedAt: number | null;
  readonly resumedAt: number | null;
  readonly endedAt: number | null;
  readonly journalLength: number;
}

/** The journal a mission-replay journey accumulates (the mission mirror's state). */
export interface MirrorMissionJournal {
  readonly missionId: string;
  readonly definitionId: string;
  readonly tenantId: string;
  readonly stageIds: readonly string[];
  readonly entries: readonly MirrorMissionEntry[];
  readonly digest: string;
}

// Mirror of the tower's `workOrderIdempotencyKey` (packages/mission/src/ids.ts).
export function mirrorWorkOrderIdempotencyKey(missionId: string, stageId: string): string {
  return `wo:${missionId}:${stageId}`;
}

function journalDigestOf(journal: Omit<MirrorMissionJournal, "digest">): string {
  return digestOf("mission-mirror-journal", journal as unknown as object);
}

export function verifyMirrorJournal(journal: MirrorMissionJournal): boolean {
  const { digest, ...rest } = journal;
  return journalDigestOf(rest) === digest;
}

// ---------------------------------------------------------------------------
// The fold — pure state function over the journal (mirrors foldMission).
// ---------------------------------------------------------------------------

export function foldMirrorMission(journal: MirrorMissionJournal): MirrorMissionView {
  const stages: { stageId: string; state: MirrorStageState; workOrders: MirrorWorkOrderView[]; checkpoints: MirrorCheckpointView[] }[] =
    journal.stageIds.map((stageId) => ({ stageId, state: "pending", workOrders: [], checkpoints: [] }));
  let state: MirrorInstanceState = "pending";
  let createdAt: number | null = null;
  let startedAt: number | null = null;
  let suspendedAt: number | null = null;
  let resumedAt: number | null = null;
  let endedAt: number | null = null;
  let lastCheckpoint: MirrorMissionView["lastCheckpoint"] = null;

  for (const entry of journal.entries) {
    const event = entry.event;
    const stage = event.stageId ? stages.find((s) => s.stageId === event.stageId) : undefined;
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
          stage.checkpoints.push({ checkpointId: event.checkpointId ?? "", seq: entry.seq, at: entry.at });
        }
        lastCheckpoint = { stageId: event.stageId ?? "", checkpointId: event.checkpointId ?? "", seq: entry.seq };
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
        for (const s of stages) if (s.state === "running") s.state = "cancelled";
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
    missionId: journal.missionId,
    definitionId: journal.definitionId,
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
    journalLength: journal.entries.length,
  };
}

// ---------------------------------------------------------------------------
// Resume — the completed-stages-never-re-execute policy, as a pure function.
// ---------------------------------------------------------------------------

export interface MirrorResumeInput {
  readonly journal: MirrorMissionJournal;
  readonly at: number;
  /** The deterministic work-order command ids for re-issuance (one per incomplete stage). */
  readonly commandIds: Readonly<Record<string, string>>;
}

export interface MirrorResumeResult {
  readonly ok: true;
  readonly journal: MirrorMissionJournal;
  /** Stages that received a NEW work order on resume (incomplete stages only). */
  readonly reissuedStages: readonly string[];
  /** Stages that were NOT re-executed (already terminal before the resume). */
  readonly skippedStages: readonly string[];
}

/**
 * Resume a suspended mission: mission-resumed + one work-order-issued per
 * INCOMPLETE stage (same idempotency key as the original issuance — the
 * tower's dedup semantic) + stage-started. Completed stages never receive a
 * new work order — that is the resume policy this journey asserts.
 */
export function resumeMirrorMission(input: MirrorResumeInput): MirrorResumeResult {
  const view = foldMirrorMission(input.journal);
  const reissued: string[] = [];
  const skipped: string[] = [];
  const newEntries: MirrorMissionEntry[] = [];
  let seq = input.journal.entries.length;

  if (view.state !== "suspended") {
    return { ok: true, journal: input.journal, reissuedStages: [], skippedStages: [] };
  }
  newEntries.push({
    seq: ++seq,
    tenantId: input.journal.tenantId,
    missionId: input.journal.missionId,
    event: { kind: "mission-resumed" },
    at: input.at,
  });
  for (const stage of view.stages) {
    if (stage.state === "completed" || stage.state === "failed" || stage.state === "cancelled") {
      skipped.push(stage.stageId);
      continue;
    }
    const key = mirrorWorkOrderIdempotencyKey(input.journal.missionId, stage.stageId);
    newEntries.push({
      seq: ++seq,
      tenantId: input.journal.tenantId,
      missionId: input.journal.missionId,
      event: { kind: "work-order-issued", stageId: stage.stageId, commandId: input.commandIds[stage.stageId] ?? "", idempotencyKey: key, attempt: 2 },
      at: input.at,
    });
    newEntries.push({
      seq: ++seq,
      tenantId: input.journal.tenantId,
      missionId: input.journal.missionId,
      event: { kind: "stage-started", stageId: stage.stageId },
      at: input.at,
    });
    reissued.push(stage.stageId);
  }
  const next: Omit<MirrorMissionJournal, "digest"> = {
    missionId: input.journal.missionId,
    definitionId: input.journal.definitionId,
    tenantId: input.journal.tenantId,
    stageIds: input.journal.stageIds,
    entries: [...input.journal.entries, ...newEntries],
  };
  return { ok: true, journal: { ...next, digest: journalDigestOf(next) }, reissuedStages: reissued, skippedStages: skipped };
}

/** Append entries (the initial run's executor) — pure. */
export function appendMirrorEntries(
  journal: MirrorMissionJournal,
  events: ReadonlyArray<{ readonly at: number; readonly event: MirrorMissionEvent }>,
): MirrorMissionJournal {
  let seq = journal.entries.length;
  const entries: MirrorMissionEntry[] = [...journal.entries];
  for (const e of events) {
    entries.push({ seq: ++seq, tenantId: journal.tenantId, missionId: journal.missionId, event: e.event, at: e.at });
  }
  const next: Omit<MirrorMissionJournal, "digest"> = {
    missionId: journal.missionId,
    definitionId: journal.definitionId,
    tenantId: journal.tenantId,
    stageIds: journal.stageIds,
    entries,
  };
  return { ...next, digest: journalDigestOf(next) };
}

export function makeMirrorJournal(input: {
  readonly missionId: string;
  readonly definitionId: string;
  readonly tenantId: string;
  readonly stageIds: readonly string[];
}): MirrorMissionJournal {
  const base: Omit<MirrorMissionJournal, "digest"> = { ...input, entries: [] };
  return { ...base, digest: journalDigestOf(base) };
}
