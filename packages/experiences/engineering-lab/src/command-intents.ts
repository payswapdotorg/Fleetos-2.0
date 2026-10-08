/**
 * @fleetos/experience-engineering-lab — command intents (F261 deliverable 5).
 *
 * Typed intent builders for the lab's WRITE boundary:
 *   - launch an experiment (`lab.experiment.launch`);
 *   - request a benchmark run (`lab.benchmark.run-request`);
 *   - submit an optimization proposal to review
 *     (`lab.optimization.submit-proposal`).
 *
 * Each builder produces an inert `LabCommandDraft` record via a LOCAL
 * STRUCTURAL TYPE SEAM mirroring the control-plane submit contract
 * (F240/F240A precedent, TL-adjudicated): `CommandSubmitInputMirror`
 * mirrors control-plane `SubmitCommandInput` field-for-field; the draft's
 * {tenantId, actorId} mirror the TenantContext the queue binds at
 * submission; `validateLabCommandDraft` mirrors the queue's submit
 * rejection vocabulary (missing-kind / missing-idempotency-key /
 * invalid-issued-at / invalid-not-before). SEAM NOTE: this module
 * deliberately does NOT import `@fleetos/control-plane` (the lab composes
 * only the three Wave-6 lane packages); the mirror is compile-checked
 * shape-only and binding `toSubmitInput(draft)` to a real
 * `CommandQueue.submit({ctx, command})` is TL composition work.
 *
 * GUARDIAN VOCABULARY: `capabilityRequirement` is a REQUEST, never an
 * authorization — ceilings are not authorizations. Drafts are inert frozen
 * data: they never execute, carry no execute path, and defer all
 * adjudication to the control plane + Guardian. `reason` is mandatory
 * (audit trail). Determinism: idempotency keys derive from the intent
 * SUBJECT (tenant + kind + subject) by FNV-1a — never random.
 */

import { CEILING_NOT_AUTHORIZATION, labDigestOf } from "./lab-core.js";

export type LabCommandIntentKind =
  | "lab.experiment.launch"
  | "lab.benchmark.run-request"
  | "lab.optimization.submit-proposal";

export type ProposalKind = "role-allocation" | "budget-rebalance" | "routing" | "what-if";

/**
 * The LOCAL structural mirror of the control-plane `SubmitCommandInput`
 * (byte-shape identical; the TL binds this to the real contract).
 */
export interface CommandSubmitInputMirror {
  readonly kind: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
}

export interface LabCommandDraft {
  readonly kind: LabCommandIntentKind;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
  /** Tenant the command is scoped to (mirrors ctx.tenantId). */
  readonly tenantId: string;
  /** Requesting actor (mirrors ctx.actorId). */
  readonly actorId: string;
  /** REQUESTED capability — a request, never an authorization. */
  readonly capabilityRequirement: string;
  /** Mandatory audit reason. */
  readonly reason: string;
  /** Machine-carried Guardian-law marker: ceilings are not authorizations. */
  readonly ceiling: typeof CEILING_NOT_AUTHORIZATION;
  readonly intentDigest: string;
}

export type LabIntentRejection =
  | "missing-tenant"
  | "missing-actor"
  | "missing-reason"
  | "invalid-issued-at"
  | "invalid-not-before"
  | "missing-world-id"
  | "missing-scenario-id"
  | "invalid-step-count"
  | "missing-set-digest"
  | "missing-metric"
  | "missing-organization-id"
  | "missing-proposal-digest"
  | "invalid-proposal-kind"
  // Mirror of the control-plane submit rejection vocabulary (draft-level):
  | "missing-kind"
  | "missing-idempotency-key"
  | "missing-capability-requirement";

export type LabIntentResult =
  | { readonly ok: true; readonly draft: LabCommandDraft }
  | { readonly ok: false; readonly rejected: LabIntentRejection; readonly detail: string };

function refuse(rejected: LabIntentRejection, detail: string): LabIntentResult {
  return { ok: false, rejected, detail };
}

interface CommonIntentInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly reason: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
}

function validateCommon(input: CommonIntentInput): LabIntentResult | null {
  if (input.tenantId === "") return refuse("missing-tenant", "tenantId is empty");
  if (input.actorId === "") return refuse("missing-actor", "actorId is empty");
  if (input.reason === "") return refuse("missing-reason", "reason is required for the audit trail");
  if (!Number.isFinite(input.issuedAt) || input.issuedAt <= 0) {
    return refuse("invalid-issued-at", "issuedAt must be finite and positive");
  }
  if (input.notBefore !== undefined && (!Number.isFinite(input.notBefore) || input.notBefore <= 0)) {
    return refuse("invalid-not-before", "notBefore must be finite and positive when present");
  }
  return null;
}

function intentDigestOf(draft: Omit<LabCommandDraft, "intentDigest">): string {
  return labDigestOf("lab-command-intent", draft);
}

/** Recompute the draft digest; false means tampered draft content. */
export function verifyLabCommandDraftDigest(draft: LabCommandDraft): boolean {
  const { intentDigest, ...rest } = draft;
  return intentDigestOf(rest) === intentDigest;
}

function freezeDraft(draft: LabCommandDraft): LabCommandDraft {
  return Object.freeze(draft) as LabCommandDraft & { readonly payload: unknown };
}

function subjectIdempotencyKey(tenantId: string, kind: LabCommandIntentKind, subject: string): string {
  return `labidem_${labDigestOf("intent-idempotency", { tenantId, kind, subject })}`;
}

function draft(
  kind: LabCommandIntentKind,
  capability: string,
  payload: unknown,
  subject: string,
  input: CommonIntentInput,
): LabCommandDraft {
  const base: Omit<LabCommandDraft, "intentDigest"> = {
    kind,
    payload,
    idempotencyKey: subjectIdempotencyKey(input.tenantId, kind, subject),
    issuedAt: input.issuedAt,
    ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
    tenantId: input.tenantId,
    actorId: input.actorId,
    capabilityRequirement: capability,
    reason: input.reason,
    ceiling: CEILING_NOT_AUTHORIZATION,
  };
  return freezeDraft({ ...base, intentDigest: intentDigestOf(base) });
}

/** Build a launch-experiment intent (kind `lab.experiment.launch`). */
export function buildLaunchExperimentIntent(input: {
  readonly tenantId: string;
  readonly actorId: string;
  readonly worldId: string;
  readonly scenarioId: string;
  readonly steps: number;
  readonly issuedAt: number;
  readonly notBefore?: number;
  readonly reason: string;
}): LabIntentResult {
  const common = validateCommon(input);
  if (common) return common;
  if (input.worldId === "") return refuse("missing-world-id", "worldId is empty");
  if (input.scenarioId === "") return refuse("missing-scenario-id", "scenarioId is empty");
  if (!Number.isInteger(input.steps) || input.steps < 0) {
    return refuse("invalid-step-count", `steps must be a non-negative integer, got ${String(input.steps)}`);
  }
  return {
    ok: true,
    draft: draft(
      "lab.experiment.launch",
      "lab.experiment.launch",
      { worldId: input.worldId, scenarioId: input.scenarioId, steps: input.steps },
      `${input.worldId}|${input.scenarioId}|${String(input.steps)}`,
      input,
    ),
  };
}

/** Build a benchmark-run-request intent (kind `lab.benchmark.run-request`). */
export function buildRequestBenchmarkRunIntent(input: {
  readonly tenantId: string;
  readonly actorId: string;
  readonly setDigest: string;
  readonly metric: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
  readonly reason: string;
}): LabIntentResult {
  const common = validateCommon(input);
  if (common) return common;
  if (input.setDigest === "") return refuse("missing-set-digest", "setDigest is empty");
  if (input.metric === "") return refuse("missing-metric", "metric is empty");
  return {
    ok: true,
    draft: draft(
      "lab.benchmark.run-request",
      "lab.benchmark.run",
      { setDigest: input.setDigest, metric: input.metric },
      `${input.setDigest}|${input.metric}`,
      input,
    ),
  };
}

/** Build a submit-optimization-proposal intent (kind `lab.optimization.submit-proposal`). */
export function buildSubmitOptimizationProposalIntent(input: {
  readonly tenantId: string;
  readonly actorId: string;
  readonly organizationId: string;
  readonly proposalKind: ProposalKind;
  readonly proposalDigest: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
  readonly reason: string;
}): LabIntentResult {
  const common = validateCommon(input);
  if (common) return common;
  if (input.organizationId === "") return refuse("missing-organization-id", "organizationId is empty");
  if (input.proposalDigest === "") return refuse("missing-proposal-digest", "proposalDigest is empty");
  const kinds: readonly ProposalKind[] = ["role-allocation", "budget-rebalance", "routing", "what-if"];
  if (!kinds.includes(input.proposalKind)) {
    return refuse("invalid-proposal-kind", `proposalKind ${String(input.proposalKind)} is not one of ${kinds.join(", ")}`);
  }
  return {
    ok: true,
    draft: draft(
      "lab.optimization.submit-proposal",
      "lab.optimization.proposal.submit",
      {
        organizationId: input.organizationId,
        proposalKind: input.proposalKind,
        proposalDigest: input.proposalDigest,
      },
      `${input.organizationId}|${input.proposalKind}|${input.proposalDigest}`,
      input,
    ),
  };
}

/**
 * Validate a draft against the mirrored control-plane submit boundary
 * (plus the intent-specific mandatory fields). A validated draft carries
 * every field `CommandQueue.submit` requires — the TL binds the seam.
 */
export function validateLabCommandDraft(
  draftInput: LabCommandDraft,
): { readonly ok: true } | { readonly ok: false; readonly rejected: LabIntentRejection; readonly detail: string } {
  // Runtime input may arrive malformed (unsafe casts); validate the
  // widened shapes honestly rather than trusting the declared types.
  const kind = draftInput.kind as string;
  const idempotencyKey = draftInput.idempotencyKey as string;
  const reason = draftInput.reason as string;
  const capabilityRequirement = draftInput.capabilityRequirement as string;
  const tenantId = draftInput.tenantId as string;
  if (typeof kind !== "string" || kind === "") return refuse("missing-kind", "draft kind is empty");
  if (typeof idempotencyKey !== "string" || idempotencyKey === "") {
    return refuse("missing-idempotency-key", "draft idempotencyKey is empty");
  }
  if (typeof tenantId !== "string" || tenantId === "") return refuse("missing-tenant", "draft tenantId is empty");
  if (!Number.isFinite(draftInput.issuedAt) || draftInput.issuedAt <= 0) {
    return refuse("invalid-issued-at", "draft issuedAt must be finite and positive");
  }
  if (draftInput.notBefore !== undefined && (!Number.isFinite(draftInput.notBefore) || draftInput.notBefore <= 0)) {
    return refuse("invalid-not-before", "draft notBefore must be finite and positive when present");
  }
  if (typeof reason !== "string" || reason === "") {
    return refuse("missing-reason", "draft reason is required");
  }
  if (typeof capabilityRequirement !== "string" || capabilityRequirement === "") {
    return refuse("missing-capability-requirement", "draft capabilityRequirement is required");
  }
  return { ok: true };
}

/**
 * Project a draft onto the LOCAL structural mirror of the control-plane
 * `SubmitCommandInput` — the exact object shape the queue's submit boundary
 * consumes (tenant/actor/capability/reason/ceiling/digest stay with the
 * lab's audit trail; the queue re-binds ctx itself).
 */
export function toSubmitInput(draftInput: LabCommandDraft): CommandSubmitInputMirror {
  const mirror: CommandSubmitInputMirror = {
    kind: draftInput.kind,
    payload: draftInput.payload,
    idempotencyKey: draftInput.idempotencyKey,
    issuedAt: draftInput.issuedAt,
    ...(draftInput.notBefore !== undefined ? { notBefore: draftInput.notBefore } : {}),
  };
  return Object.freeze(mirror);
}
