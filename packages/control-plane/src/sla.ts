/**
 * @fleetos/control-plane — SLA / deadline tracker.
 *
 * Register a deadline against a command, evaluate breaches at a logical
 * `now`, and escalate deterministically: the severity ladder is a pure
 * function of (dueAt, config) — level k breaches at dueAt + (k-1) *
 * windowMs with a fixed severity mapping. Evaluation is idempotent:
 * re-evaluating the same (or an earlier) `now` records NO new escalation.
 *
 * Tenant fail-closed: cross-tenant access returns `deadline-not-found`
 * (no existence leak).
 */

import type { TenantContext, TenantId } from "@fleetos/kernel";
import { fail, ok, type Result } from "./result.js";
import { digestOf } from "./digest.js";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export interface EscalationConfig {
  /** Number of escalation levels in the ladder (>= 1). */
  readonly levels: number;
  /** Logical ms between ladder steps. */
  readonly windowMs: number;
}

export const DEFAULT_ESCALATION_CONFIG: EscalationConfig = {
  levels: 3,
  windowMs: 10_000,
};

export type SlaSeverity = "warning" | "critical" | "escalation" | "executive";

/** The deterministic severity ladder: level 1 warning → 4+ executive. */
export function severityForLevel(level: number): SlaSeverity {
  if (level <= 1) return "warning";
  if (level === 2) return "critical";
  if (level === 3) return "escalation";
  return "executive";
}

export interface EscalationLadderStep {
  readonly level: number;
  readonly severity: SlaSeverity;
  /** The logical time this level breaches at. */
  readonly at: number;
}

/** Pure: the exact ladder of breach times for a deadline. */
export function escalationLadder(
  dueAt: number,
  config: EscalationConfig,
): ReadonlyArray<EscalationLadderStep> {
  const steps: EscalationLadderStep[] = [];
  for (let level = 1; level <= config.levels; level++) {
    steps.push({
      level,
      severity: severityForLevel(level),
      at: dueAt + (level - 1) * config.windowMs,
    });
  }
  return steps;
}

export interface EscalationRecord {
  readonly level: number;
  readonly severity: SlaSeverity;
  readonly thresholdAt: number;
  /** The logical `now` at which the breach was first observed. */
  readonly recordedAt: number;
  readonly digest: string;
}

export interface SlaRegistration {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly commandId: string;
  readonly dueAt: number;
  readonly registeredAt: number;
  readonly config: EscalationConfig;
  readonly escalations: ReadonlyArray<EscalationRecord>;
  readonly digest: string;
}

export type SlaRejection =
  | "invalid-command-id"
  | "invalid-due-at"
  | "invalid-now"
  | "invalid-config"
  | "deadline-exists"
  | "deadline-not-found";

export interface SlaEvaluation {
  readonly registration: SlaRegistration;
  /** Escalations first observed by THIS evaluation (idempotency marker). */
  readonly newEscalations: ReadonlyArray<EscalationRecord>;
}

// ---------------------------------------------------------------------------
// SlaTracker
// ---------------------------------------------------------------------------

interface MutableRegistration {
  id: string;
  tenantId: TenantId;
  commandId: string;
  dueAt: number;
  registeredAt: number;
  config: EscalationConfig;
  escalations: EscalationRecord[];
  digest: string;
}

export class SlaTracker {
  private readonly registrations = new Map<string, MutableRegistration[]>();
  private counter = 0;

  /** Register a deadline for a command. One live deadline per (tenant, command). */
  register(input: {
    readonly ctx: TenantContext;
    readonly commandId: string;
    readonly dueAt: number;
    readonly now: number;
    readonly config?: EscalationConfig;
  }): Result<SlaRegistration, SlaRejection> {
    if (typeof input.commandId !== "string" || input.commandId === "") {
      return fail("invalid-command-id");
    }
    if (!Number.isFinite(input.dueAt) || input.dueAt <= 0) {
      return fail("invalid-due-at");
    }
    if (!Number.isFinite(input.now) || input.now <= 0) {
      return fail("invalid-now");
    }
    const config = input.config ?? DEFAULT_ESCALATION_CONFIG;
    if (
      !Number.isInteger(config.levels) ||
      config.levels < 1 ||
      config.levels > 10 ||
      !Number.isInteger(config.windowMs) ||
      config.windowMs <= 0
    ) {
      return fail("invalid-config");
    }
    const tenantKey = String(input.ctx.tenantId);
    const list = this.registrations.get(tenantKey) ?? [];
    if (list.some((r) => r.commandId === input.commandId)) {
      return fail("deadline-exists");
    }
    this.counter += 1;
    const id = `sla_${String(this.counter).padStart(10, "0")}`;
    const registration: MutableRegistration = {
      id,
      tenantId: input.ctx.tenantId,
      commandId: input.commandId,
      dueAt: input.dueAt,
      registeredAt: input.now,
      config,
      escalations: [],
      digest: digestOf(tenantKey, id, input.commandId, input.dueAt, input.now),
    };
    list.push(registration);
    this.registrations.set(tenantKey, list);
    return ok(registration);
  }

  /**
   * Evaluate a deadline at logical `now`: every ladder step whose time has
   * arrived and that has not been recorded yet becomes an escalation
   * record (recordedAt = now). Idempotent — re-evaluation records nothing
   * new. Ladder steps observed in one pass are recorded in ladder order.
   */
  evaluate(input: {
    readonly ctx: TenantContext;
    readonly commandId: string;
    readonly now: number;
  }): Result<SlaEvaluation, SlaRejection> {
    if (!Number.isFinite(input.now) || input.now <= 0) {
      return fail("invalid-now");
    }
    const registration = this.lookup(input.ctx, input.commandId);
    if (!registration) return fail("deadline-not-found");
    const ladder = escalationLadder(registration.dueAt, registration.config);
    const newEscalations: EscalationRecord[] = [];
    for (const step of ladder) {
      const already = registration.escalations.some(
        (e) => e.level === step.level,
      );
      if (!already && input.now >= step.at) {
        const record: EscalationRecord = {
          level: step.level,
          severity: step.severity,
          thresholdAt: step.at,
          recordedAt: input.now,
          digest: digestOf(
            String(registration.tenantId),
            registration.commandId,
            step.level,
            step.at,
            input.now,
          ),
        };
        registration.escalations.push(record);
        newEscalations.push(record);
      }
    }
    return ok({ registration, newEscalations });
  }

  /** Read a registration. Cross-tenant access fails closed. */
  registration(
    ctx: TenantContext,
    commandId: string,
  ): Result<SlaRegistration, SlaRejection> {
    const registration = this.lookup(ctx, commandId);
    if (!registration) return fail("deadline-not-found");
    return ok(registration);
  }

  registrationsFor(ctx: TenantContext): ReadonlyArray<SlaRegistration> {
    const list = this.registrations.get(String(ctx.tenantId));
    return list ? [...list] : [];
  }

  // --- internals ---

  private lookup(
    ctx: TenantContext,
    commandId: string,
  ): MutableRegistration | null {
    const list = this.registrations.get(String(ctx.tenantId));
    if (!list) return null;
    return list.find((r) => r.commandId === commandId) ?? null;
  }
}
