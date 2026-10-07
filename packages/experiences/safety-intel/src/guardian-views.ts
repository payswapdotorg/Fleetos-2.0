/**
 * @fleetos/experience-safety-intel — guardian-views (F240B deliverable 2).
 *
 * Guardian/policy/action views:
 *  - a rule catalog with applicability summaries;
 *  - capability-ceiling views that PRESERVE the "ceilings are not
 *    authorizations" vocabulary STRUCTURALLY: every ceiling view carries the
 *    machine-carried `ceilingSatisfiedIsNotAuthorization: true` marker and
 *    NO authorization field exists anywhere on it (law A5 — the Guardian is
 *    the sole authorization authority; AGENTS.md: "budgets/ceilings are not
 *    authorizations"). No function in this module produces a
 *    GuardianDecision.
 *  - an action-plan board joined against the execution command queue, with
 *    DEAD-LETTER visibility.
 *
 * Tenant fail-closed (A8): every cross-tenant input refuses the whole view,
 * offender named, no partial state. Deterministic: derived orderings only.
 */

import { stepIdempotencyKey } from "@fleetos/actions";
import type {
  ActionPlan,
  PlanLifecycleRecord,
  PlannedStep,
} from "@fleetos/actions";
import type {
  CommandQueueState,
  CommandStatus,
  QueuedCommand,
} from "@fleetos/execution";
import type {
  AuthorityKind,
  Capability,
  CapabilityRisk,
  DecisionFlavor,
  GrantRecord,
  Policy,
  PolicyRuleId,
  PolicyVerdict,
} from "@fleetos/policy";

// ---------------------------------------------------------------------------
// Rule catalog
// ---------------------------------------------------------------------------

export interface RuleCatalogEntryView {
  readonly ruleId: PolicyRuleId;
  readonly description: string;
  readonly verdict: PolicyVerdict;
  readonly flavor: DecisionFlavor;
  readonly priority: number;
  /** Deterministic applicability summary, e.g. "risks low..high". */
  readonly applicability: string;
  readonly requiredAuthority: readonly AuthorityKind[];
  readonly tenantScope: Policy["rules"][number]["tenantScope"];
}

export interface RuleCatalogView {
  readonly tenantId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  /** Ordered by priority desc, then ruleId asc. */
  readonly entries: readonly RuleCatalogEntryView[];
  readonly counts: Readonly<Record<DecisionFlavor, number>>;
  readonly digest: string;
}

function flavorOfVerdict(verdict: PolicyVerdict): DecisionFlavor {
  switch (verdict) {
    case "ALLOW": return "allow";
    case "BLOCK": return "deny";
    case "REQUIRE_APPROVAL": return "escalate";
    case "WARN": return "soft-allow";
  }
}

// ---------------------------------------------------------------------------
// Capability ceilings — NOT authorizations (structural law)
// ---------------------------------------------------------------------------

export interface CapabilityCeilingEntryView {
  readonly capabilityId: string;
  readonly version: string;
  readonly risk: CapabilityRisk;
  readonly requiredAuthority: readonly AuthorityKind[];
  readonly activeGrantCount: number;
  /** required ∩ held (declared-order projection of the requirement). */
  readonly coveredAuthority: readonly AuthorityKind[];
  /** required − held, in declared order. */
  readonly missingAuthority: readonly AuthorityKind[];
  readonly ceilingSatisfied: boolean;
  /**
   * STRUCTURAL LAW (A5): a satisfied ceiling is NOT an authorization. This
   * marker is machine-carried; this view type has NO `authorized` field and
   * no `verdict`; assignment to a GuardianDecision is a compile error
   * (pinned in tests). Authorization comes only from the Guardian path.
   */
  readonly ceilingSatisfiedIsNotAuthorization: true;
}

export interface CapabilityCeilingBoardView {
  readonly tenantId: string;
  /** Ordered by capabilityId asc. */
  readonly entries: readonly CapabilityCeilingEntryView[];
  readonly satisfiedCount: number;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Action-plan board
// ---------------------------------------------------------------------------

export type PlanBoardStepStatus = CommandStatus | "not-submitted";

export interface PlanBoardStepView {
  readonly stepId: string;
  readonly capabilityId: string;
  readonly idempotencyKey: string;
  readonly queueStatus: PlanBoardStepStatus;
  readonly attempts: number;
  readonly lastFailureReason: string | null;
  readonly deadLettered: boolean;
  readonly deadLetteredAt: number | null;
  readonly completedAt: number | null;
}

export interface ActionPlanBoardView {
  readonly tenantId: string;
  readonly planId: string;
  readonly planState: PlanLifecycleRecord["state"];
  readonly stepCount: number;
  readonly authorizedStepCount: number;
  /** Ordered by stepId asc. */
  readonly steps: readonly PlanBoardStepView[];
  readonly deadLetterCount: number;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type GuardianViewRefusal =
  | "views.missing-tenant"
  | "views.cross-tenant-policy"
  | "views.cross-tenant-capability"
  | "views.cross-tenant-grant"
  | "views.cross-tenant-plan"
  | "views.cross-tenant-lifecycle"
  | "views.cross-tenant-queue"
  | "views.plan-lifecycle-mismatch"
  | "views.plan-step-count-mismatch"
  | "views.queue-command-foreign"
  | "views.duplicate-queue-key";

export type GuardianViewResult<T> =
  | { readonly ok: true; readonly view: T }
  | { readonly ok: false; readonly refused: GuardianViewRefusal; readonly detail: string };

// ---------------------------------------------------------------------------
// Rule catalog builder
// ---------------------------------------------------------------------------

export function buildRuleCatalog(input: {
  readonly tenantId: string;
  readonly policy: Policy;
}): GuardianViewResult<RuleCatalogView> {
  if (input.tenantId === "") {
    return { ok: false, refused: "views.missing-tenant", detail: "tenant identifier is empty" };
  }
  if (input.policy.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "views.cross-tenant-policy",
      detail: `policy ${input.policy.id} belongs to tenant ${input.policy.tenantId}, not ${input.tenantId}`,
    };
  }
  const entries = [...input.policy.rules]
    .sort((a, b) => (a.priority !== b.priority ? b.priority - a.priority : a.id < b.id ? -1 : 1))
    .map((rule) => ({
      ruleId: rule.id,
      description: rule.description,
      verdict: rule.verdict,
      flavor: flavorOfVerdict(rule.verdict),
      priority: rule.priority,
      applicability: `risks ${rule.riskFloor}..${rule.riskCeiling}, tenant-scope ${rule.tenantScope}, authority ${rule.requiredAuthority.length === 0 ? "none" : rule.requiredAuthority.join("+")}`,
      requiredAuthority: [...rule.requiredAuthority],
      tenantScope: rule.tenantScope,
    }));
  const counts: Record<DecisionFlavor, number> = { allow: 0, deny: 0, escalate: 0, "soft-allow": 0 };
  for (const e of entries) counts[e.flavor] = (counts[e.flavor] ?? 0) + 1;
  const digest = fnv1a(
    `rc|v1|${input.tenantId}|${input.policy.id}@${input.policy.version}|` +
      entries.map((e) => `${e.ruleId}:${e.flavor}/${e.priority}`).join(","),
  );
  return {
    ok: true,
    view: {
      tenantId: input.tenantId,
      policyId: input.policy.id,
      policyVersion: input.policy.version,
      entries,
      counts,
      digest,
    },
  };
}

// ---------------------------------------------------------------------------
// Capability-ceiling board builder
// ---------------------------------------------------------------------------

export function buildCapabilityCeilingBoard(input: {
  readonly tenantId: string;
  readonly capabilities: readonly Capability[];
  readonly grants: readonly GrantRecord[];
  /**
   * The acting principal's held authority kinds (caller-supplied — the
   * identity domain's read side; this package stays read-only).
   */
  readonly actorAuthority: readonly AuthorityKind[];
  /** Logical now (epoch ms) — grant expiry is evaluated against it. */
  readonly nowMs: number;
}): GuardianViewResult<CapabilityCeilingBoardView> {
  if (input.tenantId === "") {
    return { ok: false, refused: "views.missing-tenant", detail: "tenant identifier is empty" };
  }
  for (const g of input.grants) {
    if (g.tenantId !== input.tenantId) {
      return { ok: false, refused: "views.cross-tenant-grant", detail: `grant ${g.grantId} belongs to tenant ${g.tenantId}, not ${input.tenantId}` };
    }
  }
  const held = new Set<AuthorityKind>(input.actorAuthority);
  const entries = [...input.capabilities]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((cap) => ceilingEntryOf(cap, input.grants, held, input.nowMs));
  const digest = fnv1a(
    `cb|v1|${input.tenantId}|` +
      entries.map((e) => `${e.capabilityId}#${e.ceilingSatisfied ? 1 : 0}+${e.activeGrantCount}!${e.missingAuthority.join("+")}`).join(","),
  );
  return {
    ok: true,
    view: {
      tenantId: input.tenantId,
      entries,
      satisfiedCount: entries.filter((e) => e.ceilingSatisfied).length,
      digest,
    },
  };
}

function ceilingEntryOf(
  cap: Capability,
  grants: readonly GrantRecord[],
  held: ReadonlySet<AuthorityKind>,
  nowMs: number,
): CapabilityCeilingEntryView {
  const active = grants.filter(
    (g) => g.capabilityId === cap.id && g.status === "active" && (g.expiresAt === null || g.expiresAt > nowMs),
  );
  const covered = cap.requiredAuthority.filter((a) => held.has(a));
  const missing = cap.requiredAuthority.filter((a) => !held.has(a));
  return {
    capabilityId: cap.id,
    version: cap.version,
    risk: cap.risk,
    requiredAuthority: [...cap.requiredAuthority],
    activeGrantCount: active.length,
    coveredAuthority: covered,
    missingAuthority: missing,
    ceilingSatisfied: missing.length === 0,
    ceilingSatisfiedIsNotAuthorization: true,
  };
}

// ---------------------------------------------------------------------------
// Action-plan board builder
// ---------------------------------------------------------------------------

export function buildActionPlanBoard(input: {
  readonly tenantId: string;
  readonly plan: ActionPlan;
  readonly lifecycle: PlanLifecycleRecord;
  readonly queue: CommandQueueState;
}): GuardianViewResult<ActionPlanBoardView> {
  if (input.tenantId === "") {
    return { ok: false, refused: "views.missing-tenant", detail: "tenant identifier is empty" };
  }
  if (input.plan.tenant.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "views.cross-tenant-plan",
      detail: `plan ${input.plan.planId} belongs to tenant ${input.plan.tenant.tenantId}, not ${input.tenantId}`,
    };
  }
  if (input.lifecycle.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "views.cross-tenant-lifecycle",
      detail: `lifecycle record for ${input.lifecycle.planId} belongs to tenant ${input.lifecycle.tenantId}, not ${input.tenantId}`,
    };
  }
  if (input.queue.tenantId !== input.tenantId) {
    return {
      ok: false,
      refused: "views.cross-tenant-queue",
      detail: `command queue belongs to tenant ${input.queue.tenantId}, not ${input.tenantId}`,
    };
  }
  if (input.lifecycle.planId !== input.plan.planId) {
    return {
      ok: false,
      refused: "views.plan-lifecycle-mismatch",
      detail: `lifecycle record is for plan ${input.lifecycle.planId}, not ${input.plan.planId}`,
    };
  }
  if (input.lifecycle.stepCount !== input.plan.steps.length) {
    return {
      ok: false,
      refused: "views.plan-step-count-mismatch",
      detail: `lifecycle records ${input.lifecycle.stepCount} steps, plan carries ${input.plan.steps.length}`,
    };
  }
  // Join queue commands onto plan steps by the domain idempotency key.
  const byKey = new Map<string, QueuedCommand>();
  for (const cmd of input.queue.commands) {
    if (byKey.has(cmd.idempotencyKey)) {
      return {
        ok: false,
        refused: "views.duplicate-queue-key",
        detail: `queue carries duplicate idempotency key ${cmd.idempotencyKey}`,
      };
    }
    byKey.set(cmd.idempotencyKey, cmd);
  }
  const stepKeys = new Set<string>();
  for (const step of input.plan.steps) {
    stepKeys.add(stepIdempotencyKey(input.plan.planId, step.stepId, step.idempotencyNonce));
  }
  for (const key of byKey.keys()) {
    if (!stepKeys.has(key)) {
      return {
        ok: false,
        refused: "views.queue-command-foreign",
        detail: `queue command ${key} does not belong to plan ${input.plan.planId}`,
      };
    }
  }
  const steps = [...input.plan.steps]
    .sort((a, b) => (a.stepId < b.stepId ? -1 : 1))
    .map((step) => planBoardStepOf(input.plan.planId, step, byKey));
  const deadLetterCount = steps.filter((s) => s.deadLettered).length;
  const digest = fnv1a(
    `pb|v1|${input.tenantId}|${input.plan.planId}@${input.lifecycle.state}|` +
      steps.map((s) => `${s.stepId}:${s.queueStatus}${s.deadLettered ? "!" : ""}`).join(","),
  );
  return {
    ok: true,
    view: {
      tenantId: input.tenantId,
      planId: input.plan.planId,
      planState: input.lifecycle.state,
      stepCount: steps.length,
      authorizedStepCount: input.lifecycle.authorizedStepCount,
      steps,
      deadLetterCount,
      digest,
    },
  };
}

function planBoardStepOf(planId: string, step: PlannedStep, byKey: Map<string, QueuedCommand>): PlanBoardStepView {
  const key = stepIdempotencyKey(planId, step.stepId, step.idempotencyNonce);
  const cmd = byKey.get(key) ?? null;
  return {
    stepId: step.stepId,
    capabilityId: step.capability.id,
    idempotencyKey: key,
    queueStatus: cmd === null ? "not-submitted" : cmd.status,
    attempts: cmd === null ? 0 : cmd.attempts,
    lastFailureReason: cmd === null ? null : cmd.lastFailureReason,
    deadLettered: cmd !== null && cmd.status === "dead-lettered",
    deadLetteredAt: cmd === null ? null : cmd.deadLetteredAt,
    completedAt: cmd === null ? null : cmd.completedAt,
  };
}

// ---------------------------------------------------------------------------
// Deterministic digest (private FNV-1a — the lane's presentation convention)
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
