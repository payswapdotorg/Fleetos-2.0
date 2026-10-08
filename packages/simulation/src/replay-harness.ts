/**
 * @fleetos/simulation — deterministic replay harness (Wave 6, F260B).
 *
 * Drives a historical world-model journal through the REAL reference
 * predictive model step-by-step: fold order = journal seq order. At every
 * journal seq the harness resumes the REAL world-model fold from the previous
 * checkpoint (checkpointWorld/resumeWorld), maps the entity's observation
 * history into a `TwinStateInput`, and asks the REAL ModelPort for a
 * projection at that historical moment (asOfMs = the journal entry's atMs).
 *
 * Per-step predictions carry the model's OWN provenance digests and
 * uncertainty. Re-replay is byte-identical; a checkpoint resume at ANY journal
 * seq picks up identically. The replay digest covers every step.
 *
 * LAW (A2/A11): a replay is EVALUATION EVIDENCE ONLY (`kind: "REPLAY"`,
 * machine-carried `experimental: true`); it NEVER writes world state and is
 * never authoritative. Deterministic: no clock, no randomness, no I/O.
 */

import type {
  ModelPort,
  Prediction,
  ProjectionRejection,
} from "@fleetos/predictive";
import { makeReferenceModelPort } from "@fleetos/predictive";
import type {
  WorldCheckpoint,
  WorldJournalEntry,
  WorldStateView,
} from "@fleetos/world-model";
import { checkpointWorld, foldWorldState, resumeWorld, worldStateDigest } from "@fleetos/world-model";
import type { PredictiveInvocationParams } from "./benchmark-definition.ts";
import { BENCHMARK_ADVISORY_NOTE, canonicalJson, fnv1a } from "./benchmark-definition.ts";
import type { TenantScopeLike } from "./index.ts";

export type ReplayRejection =
  | "missing-tenant"
  | "missing-entity"
  | "invalid-invocation"
  | "journal-invalid"
  | "model-version-mismatch"
  | "replay-state-error";

export type ReplayResult =
  | { readonly ok: true; readonly run: ReplayRun }
  | { readonly ok: false; readonly rejected: ReplayRejection; readonly detail: string };

/** One replay step — the prediction (or honest rejection) at one journal seq. */
export interface ReplayStep {
  readonly seq: number;
  /** Journal entry time == the logical asOfMs the prediction was made at. */
  readonly atMs: number;
  readonly observationCount: number;
  readonly lastObservedAtMs: number | null;
  /** The model's OWN provenance input digest; null when the step was rejected. */
  readonly inputDigest: string | null;
  readonly outcome:
    | { readonly ok: true; readonly prediction: Prediction }
    | { readonly ok: false; readonly rejected: ProjectionRejection; readonly detail: string };
  readonly stepDigest: string;
}

export interface ReplayRun {
  readonly kind: "REPLAY";
  /** Machine-carried EXPERIMENTAL marker (A11) — cannot be stripped silently. */
  readonly experimental: true;
  readonly advisoryNote: typeof BENCHMARK_ADVISORY_NOTE;
  readonly runId: string;
  readonly tenant: TenantScopeLike;
  readonly entityId: string;
  readonly metric: string;
  readonly invocation: PredictiveInvocationParams;
  readonly portName: string;
  readonly portModelVersion: string;
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly journalHeadDigest: string;
  readonly journalLength: number;
  readonly steps: readonly ReplayStep[];
  readonly replayDigest: string;
}

/** Replay a full journal (seq 1..n) through the model. */
export function replayJournal(input: {
  readonly tenant: TenantScopeLike;
  readonly entityId: string;
  readonly journal: readonly WorldJournalEntry[];
  readonly invocation: PredictiveInvocationParams;
  readonly port?: ModelPort;
}): ReplayResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") return fail("missing-tenant", "tenant identifier is empty");
  if (input.entityId === "") return fail("missing-entity", "entityId is empty");
  const inv = input.invocation;
  if (inv.metric === "" || inv.modelVersion === "" || inv.modelPortName === "") {
    return fail("invalid-invocation", "modelPortName, modelVersion and metric are required");
  }
  if (input.journal.length === 0) {
    return fail("journal-invalid", "journal segment is empty");
  }
  // Upfront chain validation through the REAL full fold (fail-closed).
  const folded = foldWorldState(input.journal);
  if (!folded.ok) {
    return fail("journal-invalid", `world fold rejected: ${folded.rejected} (${folded.detail})`);
  }
  const genesis = checkpointWorld(input.journal, 0);
  if (!genesis.ok) return fail("journal-invalid", genesis.detail);
  return replayFrom(genesis.checkpoint, input.journal, tenantId, input, folded.state);
}

/** Resume a replay from a checkpoint at any journal seq — picks up identically. */
export function resumeReplay(input: {
  readonly checkpoint: WorldCheckpoint;
  readonly suffix: readonly WorldJournalEntry[];
  readonly tenant: TenantScopeLike;
  readonly entityId: string;
  readonly invocation: PredictiveInvocationParams;
  readonly port?: ModelPort;
}): ReplayResult {
  const tenantId = input.tenant.tenantId;
  if (tenantId === "") return fail("missing-tenant", "tenant identifier is empty");
  if (input.entityId === "") return fail("missing-entity", "entityId is empty");
  const inv = input.invocation;
  if (inv.metric === "" || inv.modelVersion === "" || inv.modelPortName === "") {
    return fail("invalid-invocation", "modelPortName, modelVersion and metric are required");
  }
  if (input.checkpoint.state.tenantId !== "" && input.checkpoint.state.tenantId !== tenantId) {
    return fail("missing-tenant", "checkpoint belongs to another tenant");
  }
  if (input.checkpoint.seq === 0) {
    // A seq-0 checkpoint means the suffix IS the full journal — validate it
    // upfront through the REAL full fold (fail-closed).
    const folded = foldWorldState(input.suffix);
    if (!folded.ok) {
      return fail("journal-invalid", `world fold rejected: ${folded.rejected} (${folded.detail})`);
    }
    return replayFrom(input.checkpoint, input.suffix, tenantId, input, folded.state);
  }
  return replayFrom(input.checkpoint, input.suffix, tenantId, input, null);
}

function replayFrom(
  start: WorldCheckpoint,
  entries: readonly WorldJournalEntry[],
  tenantId: string,
  input: { readonly entityId: string; readonly invocation: PredictiveInvocationParams; readonly port?: ModelPort },
  fullFoldState: WorldStateView | null,
): ReplayResult {
  const inv = input.invocation;
  const port = input.port ?? makeReferenceModelPort();
  if (port.modelVersion !== inv.modelVersion) {
    return fail(
      "model-version-mismatch",
      `case pins model ${inv.modelVersion}, port is ${port.modelVersion}`,
    );
  }
  const twinTenant = { tenantId };
  const steps: ReplayStep[] = [];
  let cp = start;
  for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) {
    const resumed = resumeWorld(cp, [entry]);
    if (!resumed.ok) {
      return fail("replay-state-error", `resume at seq ${entry.seq}: ${resumed.rejected} (${resumed.detail})`);
    }
    const entity = resumed.state.entities.find((e) => e.entityId === input.entityId);
    const observations = entity ? entity.observations : [];
    const lastObs = entity && entity.lastObservation ? entity.lastObservation : null;
    const twinInput = {
      tenant: twinTenant,
      asset: { assetId: input.entityId },
      metric: inv.metric,
      observations,
      asOfMs: entry.atMs,
    };
    const projected = port.project(twinInput, inv.horizon);
    const stepDigest = fnv1a(
      `replay-step|v1|${canonicalJson({ seq: entry.seq, atMs: entry.atMs, observationCount: observations.length, lastObservedAtMs: lastObs ? lastObs.atMs : null, outcome: projected.ok ? { ok: true, inputDigest: projected.prediction.provenance.inputDigest, points: projected.prediction.points } : { ok: false, rejected: projected.rejected } })}`,
    );
    steps.push({
      seq: entry.seq,
      atMs: entry.atMs,
      observationCount: observations.length,
      lastObservedAtMs: lastObs ? lastObs.atMs : null,
      inputDigest: projected.ok ? projected.prediction.provenance.inputDigest : null,
      outcome: projected.ok
        ? { ok: true, prediction: projected.prediction }
        : { ok: false, rejected: projected.rejected, detail: projected.detail },
      stepDigest,
    });
    cp = {
      seq: entry.seq,
      state: resumed.state,
      stateDigest: worldStateDigest(resumed.state),
      lastEntryDigest: entry.digest,
    };
  }
  // Cross-check the incremental path against the REAL full fold (fail-closed).
  if (fullFoldState !== null && worldStateDigest(cp.state) !== worldStateDigest(fullFoldState)) {
    return fail("replay-state-error", "incremental replay state diverges from the full fold");
  }
  // fromSeq = the FIRST replayed journal seq (1 for a full replay; the
  // checkpoint's successor seq for a resume) — never the checkpoint's own seq.
  const firstStep = steps.length > 0 ? (steps[0] as ReplayStep) : null;
  const head = entries.length > 0 ? (entries[entries.length - 1] as WorldJournalEntry) : null;
  const headDigest = head ? head.digest : (start.lastEntryDigest ?? "");
  const base = {
    kind: "REPLAY" as const,
    experimental: true as const,
    advisoryNote: BENCHMARK_ADVISORY_NOTE,
    runId: `replay-${tenantId}-${input.entityId}-${inv.metric}-${headDigest}`,
    tenant: twinTenant,
    entityId: input.entityId,
    metric: inv.metric,
    invocation: inv,
    portName: port.name,
    portModelVersion: port.modelVersion,
    fromSeq: firstStep ? firstStep.seq : start.seq,
    toSeq: cp.seq,
    journalHeadDigest: headDigest,
    journalLength: start.seq + steps.length,
    steps,
  };
  return { ok: true, run: { ...base, replayDigest: fnv1a(`replay|v1|${canonicalJson(base)}`) } };
}

/** Runtime guard — verifies the REPLAY + EXPERIMENTAL markers survive transit. */
export function isReplayRun(v: unknown): v is ReplayRun {
  if (typeof v !== "object" || v === null) return false;
  const r = v as { kind?: unknown; experimental?: unknown; steps?: unknown; replayDigest?: unknown };
  return (
    r.kind === "REPLAY" && r.experimental === true && Array.isArray(r.steps) &&
    typeof r.replayDigest === "string"
  );
}

function fail(rejected: ReplayRejection, detail: string): ReplayResult {
  return { ok: false, rejected, detail };
}
