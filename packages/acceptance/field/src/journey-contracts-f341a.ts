/**
 * @fleetos/acceptance-field — F341A contracts: the three field remainder
 * journeys' typed operations (Wave 14 lane A, per the F340 freeze §4).
 *
 * The executors (ops/f341a-*.ts) drive the REAL public APIs the F340 §1
 * census verified as unexercised:
 *  - A1 backpressure: `@fleetos/observations` backpressure.ts surface
 *    (re-exported through ingestion.ts — OverflowPolicy, BackpressurePolicy,
 *    QueueState, EnqueueDecision, the ok/warn/critical levels);
 *  - A2 retention/projection: the retention.ts surface (ImmutableObservation
 *    store, buildDeviceSummary + ProjectionMetadata, RetentionPolicy,
 *    projectionStale);
 *  - A3 sim-worlds checkpoint/resume: the world-engine's own law ("a run
 *    resumed from a checkpoint is byte-identical") via advanceWorldSteps,
 *    checkpointWorldRun, resumeWorldRun, foldWorldEvents.
 *
 * Pure data; no logic. Census citations (F340 §1 rows) are carried in the
 * journey files.
 */

// ---------------------------------------------------------------------------
// A1 — observations backpressure discipline (bounded queue overflow law).
// ---------------------------------------------------------------------------

export interface BpQueueOpenOp {
  readonly kind: "bp.queue-open";
  readonly queueId: string;
  /** REAL BackpressurePolicy shape: thresholds + the overflow discipline. */
  readonly policy: {
    readonly maxQueueDepth: number;
    readonly warnDepth: number;
    readonly criticalDepth: number;
    readonly overflow: "refuse" | "shed-oldest";
  };
}

export interface BpEnqueueBatchOp {
  readonly kind: "bp.enqueue-batch";
  readonly queueId: string;
  /** Present this many items; the REAL enqueue decides each one. */
  readonly count: number;
}

export interface BpDequeueBatchOp {
  readonly kind: "bp.dequeue-batch";
  readonly queueId: string;
  readonly count: number;
}

export interface BpLevelProbeOp {
  readonly kind: "bp.level-probe";
  readonly queueId: string;
  /** Depths to classify through the REAL evaluateBackpressureLevel. */
  readonly depths: readonly number[];
}

export interface BpPolicyDefaultsOp {
  readonly kind: "bp.policy-defaults";
}

// ---------------------------------------------------------------------------
// A2 — observations retention + projection (immutable store law).
// ---------------------------------------------------------------------------

export interface RetStoreOpenOp {
  readonly kind: "ret.store-open";
  readonly storeId: string;
}

export interface RetAppendIngestedOp {
  readonly kind: "ret.append-ingested";
  readonly storeId: string;
  /** Append the REAL pipeline-admitted observations of this device. */
  readonly deviceId: string;
}

export interface RetReadOp {
  readonly kind: "ret.read";
  readonly storeId: string;
  readonly deviceId: string;
  readonly seq: number;
  /** Absent = the context tenant; a foreign tenant probes the fail-closed read. */
  readonly tenantId?: string;
}

export interface RetDeviceSummaryOp {
  readonly kind: "ret.device-summary";
  readonly storeId: string;
  readonly deviceId: string;
  /** Caller-supplied logical build time (the projection is disposable and
   * rebuildable at any time — the journey fixes it deterministically). */
  readonly builtAt: number;
}

export interface RetProjectionStaleOp {
  readonly kind: "ret.projection-stale";
  readonly storeId: string;
  readonly deviceId: string;
  /** Caller-supplied logical build time the offsets classify against. */
  readonly builtAt: number;
  /** Offsets from the projection's builtAt (ms) to classify through projectionStale. */
  readonly offsets: readonly number[];
}

export interface RetRebuildSummaryOp {
  readonly kind: "ret.rebuild-summary";
  readonly storeId: string;
  readonly deviceId: string;
  /** The caller-supplied logical build time of the rebuilt projection. */
  readonly builtAt: number;
}

export interface RetImmutabilityProbeOp {
  readonly kind: "ret.immutability-probe";
  readonly storeId: string;
  readonly deviceId: string;
  readonly seq: number;
}

export interface RetDefaultsOp {
  readonly kind: "ret.retention-defaults";
}

// ---------------------------------------------------------------------------
// A3 — sim-worlds checkpoint determinism (the engine's own resume law).
// ---------------------------------------------------------------------------

export interface WorldRunFullOp {
  readonly kind: "world.run-full";
  readonly runId: string;
  readonly worldId: string;
  readonly steps: number;
  readonly scenarioId?: string;
}

export interface WorldAdvancePrefixOp {
  readonly kind: "world.advance-prefix";
  readonly runId: string;
  readonly steps: number;
}

export interface WorldCheckpointOp {
  readonly kind: "world.checkpoint";
  readonly runId: string;
}

export interface WorldAdvanceResumeOp {
  readonly kind: "world.advance-resume";
  readonly runId: string;
  readonly steps: number;
}

export interface WorldResumeFoldOp {
  readonly kind: "world.resume-fold";
  readonly runId: string;
}

export interface WorldFoldRebuildOp {
  readonly kind: "world.fold-rebuild";
  readonly runId: string;
}

export interface WorldRefusalProbeOp {
  readonly kind: "world.refusal-probe";
  readonly probe: "invalid-step-count" | "state-world-mismatch" | "state-tenant-mismatch";
}

export type F341AOperation =
  | BpQueueOpenOp
  | BpEnqueueBatchOp
  | BpDequeueBatchOp
  | BpLevelProbeOp
  | BpPolicyDefaultsOp
  | RetStoreOpenOp
  | RetAppendIngestedOp
  | RetReadOp
  | RetDeviceSummaryOp
  | RetProjectionStaleOp
  | RetRebuildSummaryOp
  | RetImmutabilityProbeOp
  | RetDefaultsOp
  | WorldRunFullOp
  | WorldAdvancePrefixOp
  | WorldCheckpointOp
  | WorldAdvanceResumeOp
  | WorldResumeFoldOp
  | WorldFoldRebuildOp
  | WorldRefusalProbeOp;

export const F341A_BP_OP_KINDS: ReadonlySet<string> = new Set([
  "bp.queue-open",
  "bp.enqueue-batch",
  "bp.dequeue-batch",
  "bp.level-probe",
  "bp.policy-defaults",
]);

export const F341A_RET_OP_KINDS: ReadonlySet<string> = new Set([
  "ret.store-open",
  "ret.append-ingested",
  "ret.read",
  "ret.device-summary",
  "ret.projection-stale",
  "ret.rebuild-summary",
  "ret.immutability-probe",
  "ret.retention-defaults",
]);

export const F341A_WORLD_OP_KINDS: ReadonlySet<string> = new Set([
  "world.run-full",
  "world.advance-prefix",
  "world.checkpoint",
  "world.advance-resume",
  "world.resume-fold",
  "world.fold-rebuild",
  "world.refusal-probe",
]);
