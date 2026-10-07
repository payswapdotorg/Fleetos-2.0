/**
 * @fleetos/control-tower — the mission replay view (F241 deliverable 4).
 *
 * The "replay important missions" surface, composed from `@fleetos/mission`
 * public surfaces only: the journal entries are CHAIN-VERIFIED with the
 * mission package's own `entryDigest`/`genesisDigest` (a tampered or gapped
 * chain refuses the whole view — fail closed), and the presented snapshot
 * IS the mission package's own pure `foldMission` output, so the replay
 * view is ALWAYS equal to the folded state by construction.
 *
 * Checkpoint/resume visibility: the view surfaces the last checkpoint, the
 * resume point (the first still-running stage in definition order — the
 * stage the runtime re-issues a work order for), and the machine-carried
 * `resumePolicy: "completed-stages-never-re-execute"` marker mirroring the
 * mission runtime's law. A journal timeline (seq, event kind, stage, at,
 * digest) presents the durable journal state itself.
 *
 * Determinism: pure fold over the caller-supplied entries; identical inputs
 * produce a byte-identical view including the replay digest.
 */

import {
  entryDigest,
  foldMission,
  type MissionInstanceState,
  type MissionJournalEntry,
  type MissionView,
  type ValidatedMissionDefinition,
} from "@fleetos/mission";
import { TOWER_SCHEMA_VERSION, towerDigestOf } from "./tower-core.js";

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface MissionReplayStageView {
  readonly stageId: string;
  readonly state: MissionView["stages"][number]["state"];
  readonly checkpointCount: number;
  readonly workOrderCount: number;
}

export interface MissionReplayTimelineEntry {
  readonly seq: number;
  readonly eventKind: MissionJournalEntry["event"]["kind"];
  readonly stageId: string | null;
  readonly at: number;
  readonly digest: string;
}

export interface MissionReplayView {
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly missionId: string;
  readonly definitionId: string;
  /** The folded mission state — `foldMission` output, verbatim. */
  readonly state: MissionInstanceState;
  readonly stages: readonly MissionReplayStageView[];
  readonly lastCheckpoint: MissionView["lastCheckpoint"];
  /** The stage a suspended mission resumes from (null when none is running). */
  readonly resumePoint: { readonly stageId: string } | null;
  /** Machine-carried resume law (mirrors the mission runtime's semantics). */
  readonly resumePolicy: "completed-stages-never-re-execute";
  readonly completedStageCount: number;
  readonly timeline: readonly MissionReplayTimelineEntry[];
  readonly journalLength: number;
  /** The journal head digest (the last entry's digest; null for an empty journal). */
  readonly headDigest: string | null;
  readonly replayDigest: string;
}

export type MissionReplayRefusal =
  | "missing-tenant"
  | "tenant-mismatch"
  | "mission-mismatch"
  | "chain-invalid";

export type MissionReplayResult =
  | { readonly ok: true; readonly view: MissionReplayView }
  | { readonly ok: false; readonly refused: MissionReplayRefusal; readonly detail: string };

// ---------------------------------------------------------------------------
// Chain verification — the mission package's own digest law
// ---------------------------------------------------------------------------

function verifyChain(
  tenantId: string,
  missionId: string,
  entries: readonly MissionJournalEntry[],
): MissionReplayResult | null {
  let prevDigest: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) {
      return refuse("chain-invalid", `journal entry ${i + 1} is missing`);
    }
    if (entry.seq !== i + 1) {
      return refuse("chain-invalid", `seq gap: entry ${entry.seq} where ${i + 1} was expected`);
    }
    if (String(entry.missionId) !== missionId) {
      return refuse("mission-mismatch", `entry ${entry.seq} belongs to mission ${String(entry.missionId)}`);
    }
    if (String(entry.tenantId) !== tenantId) {
      return refuse("tenant-mismatch", `entry ${entry.seq} belongs to tenant ${String(entry.tenantId)}`);
    }
    if (entry.prevDigest !== prevDigest) {
      return refuse("chain-invalid", `entry ${entry.seq} breaks the digest chain`);
    }
    const expected = entryDigest(prevDigest, {
      seq: entry.seq,
      tenantId: entry.tenantId,
      missionId: entry.missionId,
      event: entry.event,
      at: entry.at,
    });
    if (entry.digest !== expected) {
      return refuse("chain-invalid", `entry ${entry.seq} digest does not recompute (tampered)`);
    }
    prevDigest = entry.digest;
  }
  return null;
}

function refuse(
  refused: MissionReplayRefusal,
  detail: string,
): { readonly ok: false; readonly refused: MissionReplayRefusal; readonly detail: string } {
  return { ok: false, refused, detail };
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

/**
 * Build the mission replay view: verify the journal chain with the mission
 * package's own digests, fold the state with the mission package's own
 * `foldMission`, and present journal + snapshot + resume visibility.
 */
export function buildMissionReplayView(input: {
  readonly tenantId: string;
  readonly definition: ValidatedMissionDefinition;
  readonly entries: readonly MissionJournalEntry[];
}): MissionReplayResult {
  if (input.tenantId === "") {
    return refuse("missing-tenant", "replay tenant scope is empty");
  }
  const sorted = [...input.entries].sort((a, b) => a.seq - b.seq);
  const missionId = sorted.length > 0 ? String(sorted[0]?.missionId) : "";
  if (sorted.length > 0 && missionId === "") {
    return refuse("mission-mismatch", "journal entries carry no mission id");
  }
  const chainFailure = verifyChain(input.tenantId, missionId, sorted);
  if (chainFailure !== null) return chainFailure;

  // The folded snapshot IS the mission package's own fold — by construction
  // the replay view equals the folded state.
  const folded = foldMission(input.definition, sorted);

  const stages: MissionReplayStageView[] = folded.stages.map((stage) => ({
    stageId: stage.stageId,
    state: stage.state,
    checkpointCount: stage.checkpoints.length,
    workOrderCount: stage.workOrders.length,
  }));
  const timeline: MissionReplayTimelineEntry[] = sorted.map((entry) => ({
    seq: entry.seq,
    eventKind: entry.event.kind,
    stageId: entry.event.stageId ?? null,
    at: entry.at,
    digest: entry.digest,
  }));
  const runningStage = folded.stages.find((stage) => stage.state === "running");
  const headDigest = sorted.length > 0 ? sorted[sorted.length - 1]?.digest ?? null : null;

  const body = {
    tenantId: input.tenantId,
    missionId,
    definitionId: folded.definitionId,
    state: folded.state,
    stages: stages.map((stage) => [stage.stageId, stage.state, stage.checkpointCount, stage.workOrderCount]),
    lastCheckpoint: folded.lastCheckpoint,
    resumePoint: runningStage?.stageId ?? null,
    timeline: timeline.map((item) => [item.seq, item.eventKind, item.at]),
    journalLength: sorted.length,
    headDigest,
  };
  const view: MissionReplayView = {
    schemaVersion: TOWER_SCHEMA_VERSION,
    tenantId: input.tenantId,
    missionId,
    definitionId: folded.definitionId,
    state: folded.state,
    stages,
    lastCheckpoint: folded.lastCheckpoint,
    resumePoint: runningStage === undefined ? null : { stageId: runningStage.stageId },
    resumePolicy: "completed-stages-never-re-execute",
    completedStageCount: folded.stages.filter((stage) => stage.state === "completed").length,
    timeline,
    journalLength: sorted.length,
    headDigest,
    replayDigest: towerDigestOf("mission-replay", body),
  };
  return { ok: true, view };
}

/** Recompute the replay digest from the presented view; false = tampered. */
export function verifyMissionReplayDigest(view: MissionReplayView): boolean {
  const body = {
    tenantId: view.tenantId,
    missionId: view.missionId,
    definitionId: view.definitionId,
    state: view.state,
    stages: view.stages.map((stage) => [stage.stageId, stage.state, stage.checkpointCount, stage.workOrderCount]),
    lastCheckpoint: view.lastCheckpoint,
    resumePoint: view.resumePoint?.stageId ?? null,
    timeline: view.timeline.map((item) => [item.seq, item.eventKind, item.at]),
    journalLength: view.journalLength,
    headDigest: view.headDigest,
  };
  return towerDigestOf("mission-replay", body) === view.replayDigest;
}
