/**
 * @fleetos/acceptance-field — F321A contracts: the care-operations family
 * (Wave 12 lane A). Slots 16 (diagnosis lifecycle), 17 (anomaly confidence
 * triage), 18 (evidence-gated recovery) and 19 (maintenance calendar scale).
 *
 * Split out of journey-contracts-f321a.ts to hold the ≤400-line file law
 * (the F310C commerce split-file precedent). Pure data; no logic.
 */

// ---------------------------------------------------------------------------
// Slot 16 — diagnosis lifecycle (health kernel).
// ---------------------------------------------------------------------------

export interface DiagnosisProposeOp {
  readonly kind: "diagnosis.propose";
  readonly hypothesisId: string;
  readonly deviceId: string;
  readonly candidateCauses: ReadonlyArray<string>;
  readonly confidence: number;
  /** Evidence drawn from the REAL triage findings (provenance-honest). */
  readonly fromFindings: boolean;
}

export interface DiagnosisCommandOp {
  readonly kind: "diagnosis.command";
  readonly hypothesisId: string;
  readonly command: "corroborate" | "resolve" | "supersede";
  readonly reason?: string;
  /** Number of evidence refs attached to the command (from findings). */
  readonly newEvidenceCount?: number;
}

export interface DiagnosisSupersedeOp {
  readonly kind: "diagnosis.supersede";
  readonly hypothesisId: string;
  readonly successorId: string;
  readonly candidateCauses: ReadonlyArray<string>;
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Slot 17 — anomaly detection + confidence propagation (health signals).
// ---------------------------------------------------------------------------

export interface AnomalyWindowOp {
  readonly kind: "anomaly.window";
  readonly deviceId: string;
  /** The numeric payload field the extractor reads from REAL observations. */
  readonly field: string;
  readonly maxSize: number;
}

export interface AnomalyRunOp {
  readonly kind: "anomaly.run";
  readonly values: ReadonlyArray<{ readonly value: number; readonly at: number }>;
  readonly enterThreshold: number;
  readonly exitThreshold: number;
}

export interface AnomalyEvaluateOp {
  readonly kind: "anomaly.evaluate";
  readonly deviceId: string;
  readonly value: number;
  readonly at: number;
  readonly enterThreshold: number;
  readonly exitThreshold: number;
}

export interface AnomalyPropagateOp {
  readonly kind: "anomaly.propagate";
  readonly hypothesisId: string;
  readonly corroborations: number;
  readonly contradictions: number;
}

// ---------------------------------------------------------------------------
// Slot 18 — evidence-gated recovery (recovery kernel-evidence + pagination).
// ---------------------------------------------------------------------------

export interface RecoveryCommandGatedOp {
  readonly kind: "recovery.command-gated";
  readonly caseId: string;
  readonly command: "investigate" | "propose" | "resolve" | "close";
  readonly reason?: string;
  readonly evidence: ReadonlyArray<{ readonly kind: string; readonly observedAt: number }>;
}

export interface RecoveryPostmortemOp {
  readonly kind: "recovery.postmortem";
  readonly caseId: string;
}

export interface RecoveryPaginateOp {
  readonly kind: "recovery.paginate";
  readonly limit: number;
  readonly cursor?: string;
  /** When set, the executor mints the keyset cursor from THIS real case via
   * the REAL public encoder (exactly what a page-2 caller does). */
  readonly afterCaseId?: string;
}

export interface RecoveryPaginateTenantOp {
  readonly kind: "recovery.paginate-tenant";
  readonly limit: number;
  readonly cursor?: string;
  /** The tenant whose scoped view is paginated (defaults to the journey's). */
  readonly asTenant?: string;
  /** When set, the executor mints the cursor from THIS foreign tenant via
   * the REAL public encoder — the fail-closed cursor-tenant-mismatch probe. */
  readonly foreignCursorFrom?: string;
}

// ---------------------------------------------------------------------------
// Slot 19 — maintenance calendar scale (maintenance scheduling-scale).
// ---------------------------------------------------------------------------

export interface CalendarWindowSpec {
  readonly id: string;
  readonly assetId: string;
  readonly startsAt: number;
  readonly endsAt: number;
}

export interface CalendarBuildOp {
  readonly kind: "calendar.build";
  readonly windows: ReadonlyArray<CalendarWindowSpec>;
}

export interface CalendarConflictOp {
  readonly kind: "calendar.conflict";
  readonly window: CalendarWindowSpec;
  /** Optional tenant override — the slot-isolation probe (a foreign tenant's
   * window on the SAME asset never conflicts). */
  readonly tenantId?: string;
}

export interface CalendarNextFreeOp {
  readonly kind: "calendar.next-free";
  readonly assetId: string;
  readonly durationMs: number;
  readonly notBefore: number;
  readonly horizonMs: number;
}

export interface CalendarBatchOp {
  readonly kind: "calendar.batch";
  readonly proposals: ReadonlyArray<CalendarWindowSpec>;
  readonly resolution: "refuse-conflicts" | "reallocate-next-free";
  readonly maxProposalsPerBatch: number;
  readonly reallocationHorizonMs: number;
  readonly now: number;
}

/** The care-operations sub-union of the F321A operations. */
export type F321ACareOperation =
  | DiagnosisProposeOp
  | DiagnosisCommandOp
  | DiagnosisSupersedeOp
  | AnomalyWindowOp
  | AnomalyRunOp
  | AnomalyEvaluateOp
  | AnomalyPropagateOp
  | RecoveryCommandGatedOp
  | RecoveryPostmortemOp
  | RecoveryPaginateOp
  | RecoveryPaginateTenantOp
  | CalendarBuildOp
  | CalendarConflictOp
  | CalendarNextFreeOp
  | CalendarBatchOp;
