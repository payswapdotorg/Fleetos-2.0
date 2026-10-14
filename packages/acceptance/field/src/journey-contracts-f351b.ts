/**
 * @fleetos/acceptance-field — F351B contracts: the masked-industry
 * coverage lane tranche 1 (Wave 16 lane A, per the f351b packet).
 *
 * The executors (ops/f351b-*.ts) drive the REAL public APIs the F351B
 * census (lane report §1, machine-measured at the base tree `4f59ffe`)
 * verified as unexercised across ALL THREE corpora (field/security/
 * commerce — zero grep matches):
 *  - assets registry lifecycle: `evaluateAssetTransition`,
 *    `applyTwinRevision`, `latestAttributes`, `projectTwin`
 *    (packages/assets/src/assets.ts + kernel.ts);
 *  - work-order discipline: `advanceWorkItem`, `assignTo`, `reassignTo`,
 *    `progressEventForTransition`, `progressEventForAssignment`,
 *    `computeProgressDigest` (packages/work/src/lifecycle.ts + progress.ts);
 *  - project closeout: `archiveProject`, `readProjectForTenant`
 *    (packages/projects/src/stages.ts);
 *  - procurement ordering: `matchVendors`, `createOrder`
 *    (packages/procurement/src/matching.ts + lifecycle.ts);
 *  - equipment health thresholds: `triageWithConfidence` + the diagnosis
 *    registry (packages/health/src/kernel.ts + kernel-registry.ts).
 *
 * Pure data; no logic. Census citations are carried in the journey files.
 */

// ---------------------------------------------------------------------------
// Assets — registry lifecycle discipline (evaluate/apply/project).
// ---------------------------------------------------------------------------

export interface ArLifecycleEvaluateOp {
  readonly kind: "ar.lifecycle-evaluate";
  /** The declared current lifecycle state of the audited asset. */
  readonly state: "admitted" | "active" | "retired";
  /** The lifecycle command under audit. */
  readonly command: "admit" | "activate" | "retire";
}

export interface ArTwinReviseOp {
  readonly kind: "ar.twin-revise";
  readonly deviceId: string;
  /** Revision seq (must strictly exceed the twin's lastSeq). */
  readonly seq: number;
  readonly observedAt: number;
  /** Deterministic application time (journey data; never a wall clock). */
  readonly appliedAt: number;
  readonly source: "observation" | "manual";
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  /** Observation provenance ref (required honesty when source=observation). */
  readonly observationRef?: { readonly deviceId: string; readonly seq: number; readonly observedAt: number; readonly payloadDigest: string } | null;
}

export interface ArTwinLatestOp {
  readonly kind: "ar.twin-latest";
  readonly deviceId: string;
}

export interface ArTwinProjectOp {
  readonly kind: "ar.twin-project";
  readonly deviceId: string;
}

// ---------------------------------------------------------------------------
// Work — shift work-order discipline (advance/assign/reassign/progress).
// ---------------------------------------------------------------------------

export interface WoOpenOp {
  readonly kind: "wo.open";
  readonly itemId: string;
  readonly title: string;
  readonly deadline: string | null;
}

export interface WoTransitionOp {
  readonly kind: "wo.transition";
  readonly itemId: string;
  readonly command: "start" | "block" | "unblock" | "complete" | "cancel";
  /** The honest reason (required by law for block/cancel refusals to fire). */
  readonly reason?: string;
  /** Deterministic emission time of the transition's progress event. */
  readonly emittedAt: string;
}

export interface WoAssignOp {
  readonly kind: "wo.assign";
  readonly itemId: string;
  readonly assignmentId: string;
  readonly assigneeId: string;
  readonly assignedAt: string;
}

export interface WoReassignOp {
  readonly kind: "wo.reassign";
  readonly itemId: string;
  readonly assignmentId: string;
  readonly assigneeId: string;
  readonly reassignedAt: string;
}

export interface WoProgressDigestOp {
  readonly kind: "wo.progress-digest";
  readonly kindOf: "work.started" | "work.blocked" | "work.unblocked" | "work.completed" | "work.cancelled" | "work.assigned" | "work.reassigned";
  readonly itemId: string;
  readonly emittedAt: string;
  readonly fromStatus: "todo" | "in_progress" | "blocked" | "done" | "cancelled" | null;
  readonly toStatus: "todo" | "in_progress" | "blocked" | "done" | "cancelled" | null;
}

// ---------------------------------------------------------------------------
// Projects — closeout/archival discipline (terminal-state law).
// ---------------------------------------------------------------------------

export interface PjOpenOp {
  readonly kind: "pj.open";
  readonly projectId: string;
  readonly name: string;
}

export interface PjTransitionOp {
  readonly kind: "pj.transition";
  readonly projectId: string;
  readonly command: "activate" | "hold" | "resume" | "complete" | "cancel";
  readonly reason?: string;
}

export interface PjArchiveOp {
  readonly kind: "pj.archive";
  readonly projectId: string;
  readonly archivedAt: number;
}

export interface PjReadOp {
  readonly kind: "pj.read";
  readonly projectId: string;
  /** Absent = the context tenant; a foreign tenant probes the fail-closed read. */
  readonly tenantId?: string;
}

// ---------------------------------------------------------------------------
// Procurement — ordering discipline (match + authorized creation).
// ---------------------------------------------------------------------------

export interface PrVendorInput {
  readonly vendorId: string;
  /** Absent = the context tenant; a foreign tenant is fail-closed filtered. */
  readonly tenantId?: string;
  readonly capabilityTags: readonly string[];
  readonly serviceLevel: number;
  readonly unitCost: number;
}

export interface PrMatchOp {
  readonly kind: "pr.match";
  readonly needId: string;
  readonly quantity: number;
  readonly requiredBy: string;
  readonly capabilityTags: readonly string[];
  readonly vendors: readonly PrVendorInput[];
}

export interface PrOrderCreateOp {
  readonly kind: "pr.order-create";
  readonly orderId: string;
  readonly quoteId: string;
  /** Absent = NO Guardian decision presented (law A5 refusal path). */
  readonly guardian?: { readonly decisionId: string; readonly authorized: boolean; readonly reasonCode: string } | null;
}

export interface PrOrderTransitionOp {
  readonly kind: "pr.order-transition";
  readonly orderId: string;
  readonly command: "confirm" | "ship" | "receive" | "cancel";
}

// ---------------------------------------------------------------------------
// Health — equipment threshold escalation + diagnosis registry reads.
// ---------------------------------------------------------------------------

export interface HxObservationInput {
  readonly deviceId: string;
  /** The REAL severity vocabulary: *.error/*.fault/*.warn -> warning, *.ok -> info, else unknown. */
  readonly kind: string;
  readonly observedAt: number;
  readonly payloadDigest: string;
}

export interface HxTriageOp {
  readonly kind: "hx.triage";
  readonly observations: readonly HxObservationInput[];
  /** Deterministic triage time (journey data). */
  readonly triagedAt: number;
}

export interface HxTriageEmptyOp {
  readonly kind: "hx.triage-empty";
  readonly triagedAt: number;
}

export interface HxRegistryOpenOp {
  readonly kind: "hx.registry-open";
  readonly registryId: string;
}

export interface HxDiagnosisRegisterOp {
  readonly kind: "hx.diagnosis-register";
  readonly hypothesisId: string;
  readonly deviceId: string;
  readonly candidateCauses: readonly string[];
  readonly confidence: number;
  readonly evidence: readonly { readonly digest: string; readonly kind?: string; readonly observedAt?: number }[];
  readonly emittedAt: number;
  readonly state: "proposed" | "corroborated" | "resolved" | "superseded";
  readonly transitionSeq: number;
  readonly supersedes?: string | null;
  readonly supersededBy?: string | null;
}

export interface HxDiagnosisLookupOp {
  readonly kind: "hx.diagnosis-lookup";
  readonly hypothesisId: string;
  /** Absent = the context tenant; a foreign tenant probes the fail-closed lookup. */
  readonly tenantId?: string;
}

export interface HxDiagnosisListOp {
  readonly kind: "hx.diagnosis-list";
  readonly deviceId: string;
  /** Absent = the context tenant; a foreign tenant probes the fail-closed listing. */
  readonly tenantId?: string;
}

export interface HxDiagnosisCurrentOp {
  readonly kind: "hx.diagnosis-current";
  readonly deviceId: string;
}

export type F351BOperation =
  | ArLifecycleEvaluateOp
  | ArTwinReviseOp
  | ArTwinLatestOp
  | ArTwinProjectOp
  | WoOpenOp
  | WoTransitionOp
  | WoAssignOp
  | WoReassignOp
  | WoProgressDigestOp
  | PjOpenOp
  | PjTransitionOp
  | PjArchiveOp
  | PjReadOp
  | PrMatchOp
  | PrOrderCreateOp
  | PrOrderTransitionOp
  | HxTriageOp
  | HxTriageEmptyOp
  | HxRegistryOpenOp
  | HxDiagnosisRegisterOp
  | HxDiagnosisLookupOp
  | HxDiagnosisListOp
  | HxDiagnosisCurrentOp;

export const F351B_ASSET_OP_KINDS: ReadonlySet<string> = new Set([
  "ar.lifecycle-evaluate",
  "ar.twin-revise",
  "ar.twin-latest",
  "ar.twin-project",
]);

export const F351B_WORK_OP_KINDS: ReadonlySet<string> = new Set([
  "wo.open",
  "wo.transition",
  "wo.assign",
  "wo.reassign",
  "wo.progress-digest",
]);

export const F351B_PROJECT_OP_KINDS: ReadonlySet<string> = new Set([
  "pj.open",
  "pj.transition",
  "pj.archive",
  "pj.read",
]);

export const F351B_PROCUREMENT_OP_KINDS: ReadonlySet<string> = new Set([
  "pr.match",
  "pr.order-create",
  "pr.order-transition",
]);

export const F351B_HEALTH_OP_KINDS: ReadonlySet<string> = new Set([
  "hx.triage",
  "hx.triage-empty",
  "hx.registry-open",
  "hx.diagnosis-register",
  "hx.diagnosis-lookup",
  "hx.diagnosis-list",
  "hx.diagnosis-current",
]);
