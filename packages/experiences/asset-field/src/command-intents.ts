/**
 * @fleetos/experience-asset-field — command intents (F240A deliverable 4).
 *
 * Typed intent builders for the experience plane's WRITE boundary:
 * enroll asset, request recovery, schedule maintenance. Each builder
 * produces an inert `CommandDraft` record via a LOCAL STRUCTURAL TYPE
 * SEAM that mirrors the control-plane submit contract:
 *
 *   CommandDraft.{kind, payload, idempotencyKey, issuedAt, notBefore?}
 *     mirrors control-plane `SubmitCommandInput` byte-for-byte; the
 *   draft's {tenantId, actorId} mirror the TenantContext the queue binds
 *   at submission; `validateCommandDraft` mirrors the queue's submit
 *   rejection vocabulary (missing-kind / missing-idempotency-key /
 *   invalid-issued-at / invalid-not-before) so a validated draft would
 *   pass the queue's own boundary checks.
 *
 * SEAM NOTE FOR TL ADJUDICATION: this module deliberately does NOT import
 * `@fleetos/control-plane` (cross-lane; experience sits above the domain
 * kernel, and application composition belongs to the TL). The structural
 * mirror is compile-checked shape-only; binding `toSubmitInput(draft)` to
 * a real `CommandQueue.submit({ ctx, command })` is TL composition work.
 *
 * GUARDIAN VOCABULARY (AGENTS.md: "Agents and workflows cannot bypass
 * Guardian"): `capabilityRequirement` is a REQUEST, never an authorization
 * — ceilings are not authorizations. Drafts are inert frozen data: they
 * never execute, carry no execute path, and defer all adjudication to the
 * control plane + Guardian. `reason` is mandatory (audit trail).
 *
 * Determinism: idempotency keys are derived from the intent SUBJECT
 * (tenant + kind + subject identity) by FNV-1a — never random — so the
 * same logical intent always produces the same key (a re-issued intent
 * dedupes at the queue). Deterministic, no clock: `issuedAt` is
 * caller-supplied.
 */

import { isAssetId, isDeviceId } from "@fleetos/assets";
import { isActorId, isTenantId } from "@fleetos/identity";
import { isServicePlanId } from "@fleetos/maintenance";
import { viewDigestOf } from "./digest.js";

export type CommandIntentKind =
  | "asset.enroll"
  | "recovery.request"
  | "maintenance.schedule";

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

export interface CommandDraft {
  readonly kind: CommandIntentKind;
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
  readonly intentDigest: string;
}

export type IntentRejection =
  | "missing-tenant"
  | "malformed-tenant-id"
  | "missing-actor"
  | "malformed-actor-id"
  | "missing-reason"
  | "invalid-issued-at"
  | "invalid-not-before"
  | "missing-asset-id"
  | "malformed-asset-id"
  | "missing-device-id"
  | "malformed-device-id"
  | "missing-plan-id"
  | "malformed-plan-id"
  | "invalid-schedule"
  // Mirror of the control-plane submit rejection vocabulary (draft-level):
  | "missing-kind"
  | "missing-idempotency-key"
  | "missing-capability-requirement";

export type IntentResult =
  | { readonly ok: true; readonly draft: CommandDraft }
  | { readonly ok: false; readonly rejected: IntentRejection; readonly detail: string };

/** A declarative maintenance schedule intent (mirrors the domain Schedule). */
export type IntentSchedule =
  | { readonly kind: "one-time"; readonly at: number }
  | {
      readonly kind: "recurring";
      readonly intervalMs: number;
      readonly startsAt: number;
      readonly endsAt?: number;
    };

interface CommonIntentInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly reason: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
}

function refuse(
  rejected: IntentRejection,
  detail: string,
): { readonly ok: false; readonly rejected: IntentRejection; readonly detail: string } {
  return { ok: false, rejected, detail };
}

function validateCommon(input: CommonIntentInput): ReturnType<typeof refuse> | null {
  if (input.tenantId === "") return refuse("missing-tenant", "tenantId is empty");
  if (!isTenantId(input.tenantId)) {
    return refuse("malformed-tenant-id", `tenantId ${input.tenantId} fails the tnt_ format`);
  }
  if (input.actorId === "") return refuse("missing-actor", "actorId is empty");
  if (!isActorId(input.actorId)) {
    return refuse("malformed-actor-id", `actorId ${input.actorId} fails the act_ format`);
  }
  if (input.reason === "") return refuse("missing-reason", "reason is required for the audit trail");
  if (!Number.isFinite(input.issuedAt) || input.issuedAt <= 0) {
    return refuse("invalid-issued-at", `issuedAt must be finite and positive`);
  }
  if (input.notBefore !== undefined && (!Number.isFinite(input.notBefore) || input.notBefore <= 0)) {
    return refuse("invalid-not-before", "notBefore must be finite and positive when present");
  }
  return null;
}

function validateSchedule(schedule: IntentSchedule): ReturnType<typeof refuse> | null {
  if (schedule.kind === "one-time") {
    if (!Number.isFinite(schedule.at) || schedule.at <= 0) {
      return refuse("invalid-schedule", "one-time schedule requires a finite positive at");
    }
    return null;
  }
  if (!Number.isInteger(schedule.intervalMs) || schedule.intervalMs <= 0) {
    return refuse("invalid-schedule", "recurring schedule requires an integer intervalMs > 0");
  }
  if (!Number.isFinite(schedule.startsAt) || schedule.startsAt <= 0) {
    return refuse("invalid-schedule", "recurring schedule requires a finite positive startsAt");
  }
  if (
    schedule.endsAt !== undefined &&
    (!Number.isFinite(schedule.endsAt) || schedule.endsAt <= schedule.startsAt)
  ) {
    return refuse("invalid-schedule", "endsAt must be finite and after startsAt");
  }
  return null;
}

function intentDigestOf(draft: Omit<CommandDraft, "intentDigest">): string {
  return viewDigestOf("command-intent", draft);
}

/** Recompute the draft digest; false means tampered draft content. */
export function verifyCommandDraftDigest(draft: CommandDraft): boolean {
  const { intentDigest, ...rest } = draft;
  return intentDigestOf(rest) === intentDigest;
}

function freezeDraft(draft: CommandDraft): CommandDraft {
  return Object.freeze(draft) as CommandDraft & { readonly payload: unknown };
}

function subjectIdempotencyKey(tenantId: string, kind: CommandIntentKind, subject: string): string {
  return `idem_${viewDigestOf("intent-idempotency", { tenantId, kind, subject })}`;
}

/** Build an asset-enrollment intent (kind `asset.enroll`). */
export function buildEnrollAssetIntent(input: {
  readonly tenantId: string;
  readonly actorId: string;
  readonly assetId: string;
  readonly deviceId: string;
  readonly serial?: string;
  readonly displayName?: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
  readonly reason: string;
}): IntentResult {
  const common = validateCommon(input);
  if (common) return common;
  if (input.assetId === "") return refuse("missing-asset-id", "assetId is empty");
  if (!isAssetId(input.assetId)) {
    return refuse("malformed-asset-id", `assetId ${input.assetId} fails the ast_ format`);
  }
  if (input.deviceId === "") return refuse("missing-device-id", "deviceId is empty");
  if (!isDeviceId(input.deviceId)) {
    return refuse("malformed-device-id", `deviceId ${input.deviceId} fails the dev_ format`);
  }
  const base: Omit<CommandDraft, "intentDigest"> = {
    kind: "asset.enroll",
    payload: {
      assetId: input.assetId,
      deviceId: input.deviceId,
      serial: input.serial ?? null,
      displayName: input.displayName ?? null,
    },
    idempotencyKey: subjectIdempotencyKey(input.tenantId, "asset.enroll", `${input.assetId}|${input.deviceId}`),
    issuedAt: input.issuedAt,
    ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
    tenantId: input.tenantId,
    actorId: input.actorId,
    capabilityRequirement: "assets.enroll",
    reason: input.reason,
  };
  return { ok: true, draft: freezeDraft({ ...base, intentDigest: intentDigestOf(base) }) };
}

/** Build a recovery-request intent (kind `recovery.request`). */
export function buildRequestRecoveryIntent(input: {
  readonly tenantId: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly issuedAt: number;
  readonly notBefore?: number;
  readonly reason: string;
}): IntentResult {
  const common = validateCommon(input);
  if (common) return common;
  if (input.deviceId === "") return refuse("missing-device-id", "deviceId is empty");
  if (!isDeviceId(input.deviceId)) {
    return refuse("malformed-device-id", `deviceId ${input.deviceId} fails the dev_ format`);
  }
  const base: Omit<CommandDraft, "intentDigest"> = {
    kind: "recovery.request",
    payload: { deviceId: input.deviceId, reason: input.reason },
    idempotencyKey: subjectIdempotencyKey(input.tenantId, "recovery.request", input.deviceId),
    issuedAt: input.issuedAt,
    ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
    tenantId: input.tenantId,
    actorId: input.actorId,
    capabilityRequirement: "recovery.request",
    reason: input.reason,
  };
  return { ok: true, draft: freezeDraft({ ...base, intentDigest: intentDigestOf(base) }) };
}

/** Build a maintenance-scheduling intent (kind `maintenance.schedule`). */
export function buildScheduleMaintenanceIntent(input: {
  readonly tenantId: string;
  readonly actorId: string;
  readonly assetId: string;
  readonly planId: string;
  readonly schedule: IntentSchedule;
  readonly issuedAt: number;
  readonly notBefore?: number;
  readonly reason: string;
}): IntentResult {
  const common = validateCommon(input);
  if (common) return common;
  if (input.assetId === "") return refuse("missing-asset-id", "assetId is empty");
  if (!isAssetId(input.assetId)) {
    return refuse("malformed-asset-id", `assetId ${input.assetId} fails the ast_ format`);
  }
  if (input.planId === "") return refuse("missing-plan-id", "planId is empty");
  if (!isServicePlanId(input.planId)) {
    return refuse("malformed-plan-id", `planId ${input.planId} fails the plan_ format`);
  }
  const scheduleFailure = validateSchedule(input.schedule);
  if (scheduleFailure) return scheduleFailure;
  const base: Omit<CommandDraft, "intentDigest"> = {
    kind: "maintenance.schedule",
    payload: { assetId: input.assetId, planId: input.planId, schedule: input.schedule },
    idempotencyKey: subjectIdempotencyKey(input.tenantId, "maintenance.schedule", input.planId),
    issuedAt: input.issuedAt,
    ...(input.notBefore !== undefined ? { notBefore: input.notBefore } : {}),
    tenantId: input.tenantId,
    actorId: input.actorId,
    capabilityRequirement: "maintenance.schedule",
    reason: input.reason,
  };
  return { ok: true, draft: freezeDraft({ ...base, intentDigest: intentDigestOf(base) }) };
}

/**
 * Validate a draft against the mirrored control-plane submit boundary
 * (plus the intent-specific mandatory fields). A validated draft carries
 * every field `CommandQueue.submit` requires — the TL binds the seam.
 */
export function validateCommandDraft(
  draft: CommandDraft,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly rejected: IntentRejection; readonly detail: string } {
  // Runtime input may arrive malformed (unsafe casts); validate the
  // widened shapes honestly rather than trusting the declared types.
  const kind = draft.kind as string;
  const idempotencyKey = draft.idempotencyKey as string;
  const reason = draft.reason as string;
  const capabilityRequirement = draft.capabilityRequirement as string;
  if (typeof kind !== "string" || kind === "") {
    return refuse("missing-kind", "draft kind is empty");
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey === "") {
    return refuse("missing-idempotency-key", "draft idempotencyKey is empty");
  }
  if (!Number.isFinite(draft.issuedAt) || draft.issuedAt <= 0) {
    return refuse("invalid-issued-at", "draft issuedAt must be finite and positive");
  }
  if (draft.notBefore !== undefined && (!Number.isFinite(draft.notBefore) || draft.notBefore <= 0)) {
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
 * `SubmitCommandInput` — the exact object shape the queue's submit
 * boundary consumes (tenant/actor/capability/reason/digest stay with the
 * experience plane's audit trail; the queue re-binds ctx itself).
 */
export function toSubmitInput(draft: CommandDraft): CommandSubmitInputMirror {
  const mirror: CommandSubmitInputMirror = {
    kind: draft.kind,
    payload: draft.payload,
    idempotencyKey: draft.idempotencyKey,
    issuedAt: draft.issuedAt,
    ...(draft.notBefore !== undefined ? { notBefore: draft.notBefore } : {}),
  };
  return Object.freeze(mirror);
}
