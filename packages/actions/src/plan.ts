/**
 * @fleetos/actions — Action-plan composition (F220B, Wave 2).
 *
 * Action plan -> authorized command pipeline:
 *  - plan validation (typed rejection codes, tenant fail-closed);
 *  - Guardian-gated emission: every step emits ONLY with a GuardianDecision
 *    whose verdict is ALLOW or REQUIRE_APPROVAL — a BLOCKed or WARNing step
 *    refuses the emission (law A4/A5: agents and plans cannot bypass
 *    Guardian);
 *  - per-action idempotency keys: `${planId}|${stepId}|${nonce}`.
 *
 * Plan lifecycle: draft -> authorized -> dispatched -> settled
 * (completed/failed/voided) with legal-transition enforcement — a plan only
 * becomes `authorized` when EVERY step has an authorizing decision.
 *
 * Cross-worker seam rule: Capability and GuardianDecision are imported from
 * @fleetos/policy (worker-B-owned canonical types, law A15). No other
 * @fleetos/* import exists in this package.
 */

import type { Capability } from "@fleetos/policy/capability";
import type { GuardianDecision } from "@fleetos/policy/policy";
import type { TenantScopeLike } from "./index.ts";

// ---------------------------------------------------------------------------
// Plan shape + validation
// ---------------------------------------------------------------------------

export interface PlannedStep {
  readonly stepId: string;
  readonly capability: Capability;
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Caller-provided nonce — typically a digest of the step inputs. */
  readonly idempotencyNonce: string;
}

export interface ActionPlan {
  readonly planId: string;
  readonly tenant: TenantScopeLike;
  readonly steps: readonly PlannedStep[];
}

export type PlanValidationCode =
  | "plan.missing-plan-id"
  | "plan.missing-tenant"
  | "plan.empty-steps"
  | "plan.missing-step-id"
  | "plan.duplicate-step-id"
  | "plan.empty-capability-id"
  | "plan.missing-idempotency-nonce";

export type PlanValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PlanValidationCode };

/**
 * Validate an action plan — fail-closed.
 *
 * A plan must carry an id, a tenant scope, at least one step, unique
 * non-empty step ids, non-empty capability ids and an idempotency nonce per
 * step (the per-action idempotency contract, law A4).
 */
export function validatePlan(plan: ActionPlan): PlanValidationResult {
  if (plan.planId === "") return { ok: false, reason: "plan.missing-plan-id" };
  if (plan.tenant.tenantId === "") return { ok: false, reason: "plan.missing-tenant" };
  if (plan.steps.length === 0) return { ok: false, reason: "plan.empty-steps" };
  const seen = new Set<string>();
  for (const step of plan.steps) {
    if (step.stepId === "") return { ok: false, reason: "plan.missing-step-id" };
    if (seen.has(step.stepId)) return { ok: false, reason: "plan.duplicate-step-id" };
    seen.add(step.stepId);
    if (step.capability.id === "") return { ok: false, reason: "plan.empty-capability-id" };
    if (step.idempotencyNonce === "") return { ok: false, reason: "plan.missing-idempotency-nonce" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Guardian-gated emission
// ---------------------------------------------------------------------------

/** A step's Guardian decision binding. */
export interface StepDecision {
  readonly stepId: string;
  readonly decision: GuardianDecision;
}

/** The authorized command emitted for a plan step. */
export interface PlannedCommand {
  readonly planId: string;
  readonly stepId: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly authorizationDigest: string;
  readonly verdict: "ALLOW" | "REQUIRE_APPROVAL";
  readonly inputs: Readonly<Record<string, unknown>>;
  /** Per-action idempotency key: `${planId}|${stepId}|${nonce}`. */
  readonly idempotencyKey: string;
}

export type EmissionRefusalCode =
  | "emission.plan-invalid"
  | "emission.step-missing-decision"
  | "emission.step-blocked"
  | "emission.step-warn"
  | "emission.step-capability-mismatch"
  | "emission.step-tenant-mismatch"
  | "emission.unknown-step-decision"
  | "emission.duplicate-step-decision";

export type EmissionResult =
  | { readonly ok: true; readonly commands: readonly PlannedCommand[] }
  | { readonly ok: false; readonly reason: EmissionRefusalCode; readonly stepId: string | null };

/**
 * Build the per-action idempotency key for a plan step.
 *
 * Deterministic: the same plan/step/nonce always yields the same key. Two
 * DIFFERENT plans with the same step id never collide (planId prefixes).
 */
export function stepIdempotencyKey(planId: string, stepId: string, nonce: string): string {
  return `${planId}|${stepId}|${nonce}`;
}

/**
 * Emit the authorized commands for a plan — the Guardian gate.
 *
 * Every step must carry exactly one GuardianDecision with:
 *  - verdict ALLOW or REQUIRE_APPROVAL (BLOCK refuses with
 *    `emission.step-blocked`; WARN refuses with `emission.step-warn` — WARN
 *    means the Guardian escalated to human approval and execution has not
 *    been authorized yet);
 *  - capabilityId matching the step's capability;
 *  - tenantId matching the plan's tenant scope (A8 fail-closed).
 *
 * Emission is all-or-nothing: any refused step refuses the WHOLE emission —
 * a plan never partially executes (atomicity of the authorization boundary).
 */
export function emitPlanCommands(
  plan: ActionPlan,
  decisions: readonly StepDecision[],
): EmissionResult {
  const validation = validatePlan(plan);
  if (!validation.ok) return { ok: false, reason: "emission.plan-invalid", stepId: null };

  const byStep = new Map<string, GuardianDecision>();
  for (const sd of decisions) {
    if (!plan.steps.some((s) => s.stepId === sd.stepId)) {
      return { ok: false, reason: "emission.unknown-step-decision", stepId: sd.stepId };
    }
    if (byStep.has(sd.stepId)) {
      return { ok: false, reason: "emission.duplicate-step-decision", stepId: sd.stepId };
    }
    byStep.set(sd.stepId, sd.decision);
  }

  const commands: PlannedCommand[] = [];
  for (const step of plan.steps) {
    const decision = byStep.get(step.stepId);
    if (decision === undefined) {
      return { ok: false, reason: "emission.step-missing-decision", stepId: step.stepId };
    }
    if (decision.verdict === "BLOCK") {
      return { ok: false, reason: "emission.step-blocked", stepId: step.stepId };
    }
    if (decision.verdict === "WARN") {
      return { ok: false, reason: "emission.step-warn", stepId: step.stepId };
    }
    if (decision.capabilityId !== step.capability.id) {
      return { ok: false, reason: "emission.step-capability-mismatch", stepId: step.stepId };
    }
    if (decision.tenantId !== plan.tenant.tenantId) {
      return { ok: false, reason: "emission.step-tenant-mismatch", stepId: step.stepId };
    }
    commands.push({
      planId: plan.planId,
      stepId: step.stepId,
      tenantId: plan.tenant.tenantId,
      capabilityId: step.capability.id,
      authorizationDigest: decision.decisionDigest,
      verdict: decision.verdict,
      inputs: step.inputs,
      idempotencyKey: stepIdempotencyKey(plan.planId, step.stepId, step.idempotencyNonce),
    });
  }

  return { ok: true, commands };
}

// ---------------------------------------------------------------------------
// Plan lifecycle: draft -> authorized -> dispatched -> settled
// ---------------------------------------------------------------------------

export type PlanLifecycleState = "draft" | "authorized" | "dispatched" | "completed" | "failed" | "voided";

export interface PlanLifecycleTransition {
  readonly from: PlanLifecycleState;
  readonly to: PlanLifecycleState;
  readonly at: number;
  readonly reason: string;
  readonly actorId: string;
}

export interface PlanLifecycleRecord {
  readonly planId: string;
  readonly tenantId: string;
  readonly state: PlanLifecycleState;
  readonly stepCount: number;
  /** How many steps carry an authorizing decision (drives draft->authorized). */
  readonly authorizedStepCount: number;
  readonly dispatchRef: string | null;
  readonly completionRef: string | null;
  readonly failureReason: string | null;
  readonly transitions: readonly PlanLifecycleTransition[];
  readonly lastTransitionAt: number;
}

export type PlanAdvanceRefusalCode =
  | "plan-refused.missing-tenant"
  | "plan-refused.tenant-mismatch"
  | "plan-refused.invalid-at"
  | "plan-refused.illegal-transition"
  | "plan-refused.steps-not-authorized"
  | "plan-refused.missing-dispatch-ref"
  | "plan-refused.missing-settlement";

export type PlanAdvanceResult =
  | { readonly ok: true; readonly record: PlanLifecycleRecord }
  | { readonly ok: false; readonly reason: PlanAdvanceRefusalCode; readonly record: PlanLifecycleRecord };

const PLAN_LEGAL: Readonly<Record<PlanLifecycleState, readonly PlanLifecycleState[]>> = {
  draft: ["authorized", "voided"],
  authorized: ["dispatched", "voided"],
  dispatched: ["completed", "failed"],
  completed: [],
  failed: [],
  voided: [],
};

/** The plan legal-transition table — exported for tests and tooling. */
export function legalPlanTransitions(from: PlanLifecycleState): readonly PlanLifecycleState[] {
  return PLAN_LEGAL[from];
}

/**
 * Initialize a plan lifecycle record in the `draft` state.
 *
 * `authorizedStepCount` is supplied by the caller (typically the count of
 * steps with an ALLOW / REQUIRE_APPROVAL decision recorded in the decision
 * ledger). The plan REFUSES to become `authorized` until every step is
 * covered.
 */
export function initPlanLifecycle(
  plan: ActionPlan,
  authorizedStepCount: number,
): { readonly ok: true; readonly record: PlanLifecycleRecord } | { readonly ok: false; readonly reason: PlanValidationCode | "plan.invalid-authorized-count" } {
  const validation = validatePlan(plan);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  if (!Number.isInteger(authorizedStepCount) || authorizedStepCount < 0 || authorizedStepCount > plan.steps.length) {
    return { ok: false, reason: "plan.invalid-authorized-count" };
  }
  return {
    ok: true,
    record: {
      planId: plan.planId,
      tenantId: plan.tenant.tenantId,
      state: "draft",
      stepCount: plan.steps.length,
      authorizedStepCount,
      dispatchRef: null,
      completionRef: null,
      failureReason: null,
      transitions: [],
      lastTransitionAt: 0,
    },
  };
}

export interface PlanAdvanceContext {
  readonly tenantId: string;
  readonly actorId: string;
  readonly at: number;
  /** Dispatch receipt (required for `dispatched`). */
  readonly dispatchRef?: string;
  /** Completion evidence ref (required for `completed`). */
  readonly completionRef?: string;
  /** Failure reason (required for `failed`). */
  readonly failureReason?: string;
}

/**
 * Advance the plan lifecycle with legal-transition enforcement.
 *
 *  - draft -> authorized : EVERY step must be authorized
 *    (`authorizedStepCount === stepCount`), else
 *    `plan-refused.steps-not-authorized`.
 *  - authorized -> dispatched : requires `dispatchRef`.
 *  - dispatched -> completed : requires `completionRef` (evidence-gated).
 *  - dispatched -> failed    : requires `failureReason` (honest failure).
 *  - draft/authorized -> voided : operator void (not after dispatch).
 *
 * All other transitions refuse with `plan-refused.illegal-transition`.
 * Cross-tenant advance refuses (A8 fail-closed).
 */
export function advancePlanLifecycle(
  record: PlanLifecycleRecord,
  target: PlanLifecycleState,
  ctx: PlanAdvanceContext,
): PlanAdvanceResult {
  if (ctx.tenantId === "") return { ok: false, reason: "plan-refused.missing-tenant", record };
  if (ctx.tenantId !== record.tenantId) return { ok: false, reason: "plan-refused.tenant-mismatch", record };
  if (!Number.isInteger(ctx.at) || ctx.at < 0) return { ok: false, reason: "plan-refused.invalid-at", record };
  if (!(PLAN_LEGAL[record.state] ?? []).includes(target)) {
    return { ok: false, reason: "plan-refused.illegal-transition", record };
  }

  if (target === "authorized") {
    if (record.authorizedStepCount !== record.stepCount || record.stepCount === 0) {
      return { ok: false, reason: "plan-refused.steps-not-authorized", record };
    }
    return { ok: true, record: applyPlanTransition(record, "authorized", ctx, {}, "all-steps-authorized") };
  }

  if (target === "dispatched") {
    if (!ctx.dispatchRef || ctx.dispatchRef === "") {
      return { ok: false, reason: "plan-refused.missing-dispatch-ref", record };
    }
    return {
      ok: true,
      record: applyPlanTransition(record, "dispatched", ctx, { dispatchRef: ctx.dispatchRef }, `dispatch:${ctx.dispatchRef}`),
    };
  }

  if (target === "completed") {
    if (!ctx.completionRef || ctx.completionRef === "") {
      return { ok: false, reason: "plan-refused.missing-settlement", record };
    }
    return {
      ok: true,
      record: applyPlanTransition(record, "completed", ctx, { completionRef: ctx.completionRef }, `completed:${ctx.completionRef}`),
    };
  }

  if (target === "failed") {
    if (!ctx.failureReason || ctx.failureReason === "") {
      return { ok: false, reason: "plan-refused.missing-settlement", record };
    }
    return {
      ok: true,
      record: applyPlanTransition(record, "failed", ctx, { failureReason: ctx.failureReason }, `failed:${ctx.failureReason}`),
    };
  }

  // target === "voided"
  return { ok: true, record: applyPlanTransition(record, "voided", ctx, {}, "voided") };
}

function applyPlanTransition(
  record: PlanLifecycleRecord,
  to: PlanLifecycleState,
  ctx: PlanAdvanceContext,
  patch: Partial<PlanLifecycleRecord>,
  reason: string,
): PlanLifecycleRecord {
  const transition: PlanLifecycleTransition = {
    from: record.state,
    to,
    at: ctx.at,
    reason,
    actorId: ctx.actorId,
  };
  return {
    ...record,
    ...patch,
    state: to,
    transitions: [...record.transitions, transition],
    lastTransitionAt: ctx.at,
  };
}
