/**
 * @fleetos/experience-safety-intel — command-intents (F240B deliverable 5).
 *
 * Typed intent builders producing CommandDraft records — typed, inert
 * values that REQUEST work through the control plane. They never execute
 * and never bypass Guardian:
 *
 *  - A CommandDraft carries NO authorization surface: no verdict, no
 *    decision digest, no GuardianDecision. Compile-pinned in tests: a
 *    CommandDraft is not assignable to a GuardianDecision nor to an
 *    AuthorizedCommand (the only input the executor accepts).
 *  - The `intent` block machine-carries `draft: true` — a draft has never
 *    been submitted or executed, and this module exposes NO submit/execute
 *    function at all. Binding a draft into the real control-plane submit
 *    is TL composition (through the Guardian path, like every command).
 *
 * THE SEAM (for TL adjudication): the four top-level fields mirror
 * @fleetos/control-plane's `SubmitCommandInput`
 * (packages/control-plane/src/queue.ts) EXACTLY — `kind`, `payload`,
 * `idempotencyKey`, `issuedAt`, `notBefore?` — so a CommandDraft is
 * STRUCTURALLY ASSIGNABLE to the control-plane submit input with zero
 * adaptation. There is NO `@fleetos/control-plane` import here (packet
 * law): the mirror is LOCAL and compile-pinned in tests against a local
 * copy of the submit-contract shape. If the control-plane contract
 * changes, the TL re-adjudicates this seam.
 *
 * Every intent carries a capability requirement (`requiredCapabilityId`)
 * and a non-empty `reason` (A4's propose leg: intent must be explicit).
 *
 * Determinism: same inputs => byte-identical drafts; idempotency keys are
 * pure functions of the intent identity. Tenant fail-closed (A8).
 */

// ---------------------------------------------------------------------------
// The LOCAL structural seam
// ---------------------------------------------------------------------------

/**
 * LOCAL structural mirror of the control-plane submit contract —
 * `SubmitCommandInput` from packages/control-plane/src/queue.ts (fields
 * copied verbatim; the source of truth stays the control-plane package).
 */
export interface SubmitCommandInputMirror {
  readonly kind: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  /** Optional delayed availability (logical ms). Defaults to issuedAt. */
  readonly notBefore?: number;
}

/** Draft metadata — presentation-only; NOT part of the submit contract. */
export interface CommandIntentMetadata {
  readonly intentId: string;
  readonly tenantId: string;
  readonly actorId: string;
  /** The capability this intent requires — Guardian authorizes, never the draft. */
  readonly requiredCapabilityId: string;
  readonly reason: string;
  /** Machine-carried: a draft has never been submitted or executed. */
  readonly draft: true;
}

export interface CommandDraft {
  // --- the submit-contract mirror (the seam) ---
  readonly kind: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
  // --- draft metadata (presentation-only) ---
  readonly intent: CommandIntentMetadata;
}

export type IntentRefusalCode =
  | "intent.missing-tenant"
  | "intent.missing-intent-id"
  | "intent.missing-actor"
  | "intent.missing-capability"
  | "intent.missing-reason"
  | "intent.invalid-issued-at"
  | "intent.invalid-not-before"
  | "intent.missing-proposal"
  | "intent.missing-finding"
  | "intent.missing-plan"
  | "intent.missing-step"
  | "intent.missing-asset"
  | "intent.missing-metric"
  | "intent.invalid-horizon";

export type IntentBuildResult =
  | { readonly ok: true; readonly draft: CommandDraft }
  | { readonly ok: false; readonly refused: IntentRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

interface IntentBase {
  readonly intentId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly requiredCapabilityId: string;
  readonly reason: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
}

function validateBase(base: IntentBase): IntentBuildResult | null {
  if (base.tenantId === "") {
    return { ok: false, refused: "intent.missing-tenant", detail: "tenant identifier is empty" };
  }
  if (base.intentId === "") {
    return { ok: false, refused: "intent.missing-intent-id", detail: "intent identifier is empty" };
  }
  if (base.actorId === "") {
    return { ok: false, refused: "intent.missing-actor", detail: "actor identifier is empty" };
  }
  if (base.requiredCapabilityId === "") {
    return { ok: false, refused: "intent.missing-capability", detail: "required capability identifier is empty" };
  }
  if (base.reason === "") {
    return { ok: false, refused: "intent.missing-reason", detail: "intent reason is empty (A4: intent must be explicit)" };
  }
  if (!Number.isInteger(base.issuedAt) || base.issuedAt <= 0) {
    return { ok: false, refused: "intent.invalid-issued-at", detail: `issuedAt ${base.issuedAt} is not a positive integer` };
  }
  if (base.notBefore !== undefined && (!Number.isInteger(base.notBefore) || base.notBefore <= 0)) {
    return { ok: false, refused: "intent.invalid-not-before", detail: `notBefore ${base.notBefore} is not a positive integer` };
  }
  return null;
}

function draftOf(
  base: IntentBase,
  kind: string,
  payload: unknown,
): CommandDraft {
  const draft: CommandDraft = {
    kind,
    payload,
    idempotencyKey: `${kind}|${base.tenantId}|${base.intentId}`,
    issuedAt: base.issuedAt,
    ...(base.notBefore !== undefined ? { notBefore: base.notBefore } : {}),
    intent: {
      intentId: base.intentId,
      tenantId: base.tenantId,
      actorId: base.actorId,
      requiredCapabilityId: base.requiredCapabilityId,
      reason: base.reason,
      draft: true,
    },
  };
  return draft;
}

// ---------------------------------------------------------------------------
// Intent: request remediation
// ---------------------------------------------------------------------------

export function requestRemediation(input: IntentBase & {
  readonly proposalId: string;
  readonly findingIds: readonly string[];
  readonly remediationKind: string;
}): IntentBuildResult {
  const invalid = validateBase(input);
  if (invalid) return invalid;
  if (input.proposalId === "") {
    return { ok: false, refused: "intent.missing-proposal", detail: "remediation proposal id is empty" };
  }
  if (input.findingIds.length === 0 || input.findingIds.includes("")) {
    return { ok: false, refused: "intent.missing-finding", detail: "finding id set is empty or contains an empty id" };
  }
  const findingIds = [...new Set(input.findingIds)].sort();
  return {
    ok: true,
    draft: draftOf(
      input,
      "security.remediation.request",
      {
        proposalId: input.proposalId,
        findingIds,
        remediationKind: input.remediationKind,
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// Intent: propose an action-plan step
// ---------------------------------------------------------------------------

export function proposeActionPlanStep(input: IntentBase & {
  readonly planId: string;
  readonly stepId: string;
  readonly stepCapabilityId: string;
  readonly stepInputs: Readonly<Record<string, unknown>>;
}): IntentBuildResult {
  const invalid = validateBase(input);
  if (invalid) return invalid;
  if (input.planId === "") {
    return { ok: false, refused: "intent.missing-plan", detail: "plan id is empty" };
  }
  if (input.stepId === "") {
    return { ok: false, refused: "intent.missing-step", detail: "step id is empty" };
  }
  if (input.stepCapabilityId === "") {
    return { ok: false, refused: "intent.missing-capability", detail: "step capability id is empty" };
  }
  return {
    ok: true,
    draft: draftOf(
      input,
      "actions.plan-step.propose",
      {
        planId: input.planId,
        stepId: input.stepId,
        capabilityId: input.stepCapabilityId,
        inputs: input.stepInputs,
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// Intent: request an advisory refresh
// ---------------------------------------------------------------------------

export function requestAdvisoryRefresh(input: IntentBase & {
  readonly assetId: string;
  readonly metric: string;
  readonly horizonSteps: number;
  readonly horizonStepMs: number;
}): IntentBuildResult {
  const invalid = validateBase(input);
  if (invalid) return invalid;
  if (input.assetId === "") {
    return { ok: false, refused: "intent.missing-asset", detail: "asset id is empty" };
  }
  if (input.metric === "") {
    return { ok: false, refused: "intent.missing-metric", detail: "metric name is empty" };
  }
  if (!Number.isInteger(input.horizonSteps) || input.horizonSteps <= 0) {
    return { ok: false, refused: "intent.invalid-horizon", detail: `horizon steps ${input.horizonSteps} is not a positive integer` };
  }
  if (!Number.isInteger(input.horizonStepMs) || input.horizonStepMs <= 0) {
    return { ok: false, refused: "intent.invalid-horizon", detail: `horizon stepMs ${input.horizonStepMs} is not a positive integer` };
  }
  return {
    ok: true,
    draft: draftOf(
      input,
      "predictive.advisory.refresh-request",
      {
        assetId: input.assetId,
        metric: input.metric,
        horizon: { steps: input.horizonSteps, stepMs: input.horizonStepMs },
      },
    ),
  };
}
