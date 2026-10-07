/**
 * @fleetos/experience-work-commerce — typed command INTENT builders (F240C,
 * Wave 4 lane C).
 *
 * The experience plane NEVER writes domain truth. These builders produce
 * `CommandDraft` records — INERT DATA describing an operator intent:
 *   - `draft.command` is a LOCAL structural mirror of the control plane's
 *     submit contract (kind / payload / idempotencyKey / issuedAt /
 *     optional notBefore) so the TL's composition site can submit it
 *     without translation. This module does NOT import
 *     @fleetos/control-plane — the seam is documented for TL adjudication
 *     (see docs/evidence/F240C/report.md §6).
 *   - every draft carries `requiredCapability` + `reason`: the Guardian
 *     capability that must adjudicate the intent, and why. A draft NEVER
 *     executes, NEVER authorizes, and NEVER bypasses Guardian — there is
 *     no submit/execute function here at all (law: agents and workflows
 *     cannot bypass Guardian).
 *
 * Deterministic: `draftDigest` is FNV-1a over a canonical serialization
 * (payload keys sorted recursively) — byte-identical for identical
 * inputs regardless of key order. Time is the caller-supplied `issuedAt`
 * (logical). No clock, no randomness, no I/O.
 */

import type { TenantScopeLike } from "./internal-view.js";
import { checkTenantScope, fnv1a32 } from "./internal-view.js";

// ---------------------------------------------------------------------------
// The LOCAL structural seam — mirrors the control-plane submit contract
// ---------------------------------------------------------------------------

/**
 * CommandSubmitContract — field-for-field mirror of the control plane's
 * `SubmitCommandInput` (packages/control-plane/src/queue.ts). LOCAL
 * structural type: no @fleetos/control-plane import (ownership law A20 +
 * packet rule). TL adjudication: whether to unify this with the canonical
 * contract at the composition site.
 */
export interface CommandSubmitContract {
  readonly kind: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  /** Optional delayed availability (logical ms). */
  readonly notBefore?: number;
}

export interface CommandDraft {
  /** Marker: this is an inert draft, never a live command. */
  readonly recordType: "command-draft";
  readonly tenantId: string;
  readonly command: CommandSubmitContract;
  /** The capability Guardian must adjudicate before submission. */
  readonly requiredCapability: string;
  readonly reason: string;
  readonly draftDigest: string;
}

// ---------------------------------------------------------------------------
// Reason codes — the four lowercase codes mirror the control-plane
// CommandSubmitRejection literals byte-for-byte; the rest are intent codes.
// ---------------------------------------------------------------------------

export type CommandDraftReasonCode =
  | "TENANT_ID_EMPTY"
  | "TENANT_ID_TOO_LONG"
  | "TENANT_ID_INVALID_CHARS"
  | "CAPABILITY_REQUIRED"
  | "INTENT_REASON_REQUIRED"
  | "missing-kind"
  | "missing-idempotency-key"
  | "invalid-issued-at"
  | "invalid-not-before"
  | "TITLE_REQUIRED"
  | "QUOTE_ID_REQUIRED"
  | "BUDGET_ID_REQUIRED"
  | "NON_INTEGER_AMOUNT"
  | "NEGATIVE_AMOUNT"
  | "DIGEST_MISMATCH"
  | "NOT_A_DRAFT";

export type CommandDraftResult =
  | { readonly ok: true; readonly draft: CommandDraft }
  | { readonly ok: false; readonly reasonCode: CommandDraftReasonCode; readonly detail: string };

// ---------------------------------------------------------------------------
// Canonical serialization + digest
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function computeDraftDigest(draft: Omit<CommandDraft, "draftDigest">): string {
  return `draft_${fnv1a32([
    draft.tenantId,
    draft.recordType,
    draft.command.kind,
    canonicalJson(draft.command.payload),
    draft.command.idempotencyKey,
    draft.command.issuedAt,
    draft.command.notBefore ?? "",
    draft.requiredCapability,
    draft.reason,
  ])}`;
}

export function isCommandDraft(value: unknown): value is CommandDraft {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["recordType"] === "command-draft"
  );
}

// ---------------------------------------------------------------------------
// Shared validation — mirrors the control-plane submit checks exactly
// ---------------------------------------------------------------------------

function validateSubmitContract(command: CommandSubmitContract): CommandDraftReasonCode | null {
  if (typeof command.kind !== "string" || command.kind === "") return "missing-kind";
  if (typeof command.idempotencyKey !== "string" || command.idempotencyKey === "") {
    return "missing-idempotency-key";
  }
  if (!Number.isFinite(command.issuedAt) || command.issuedAt <= 0) return "invalid-issued-at";
  if (
    command.notBefore !== undefined &&
    (!Number.isFinite(command.notBefore) || command.notBefore <= 0)
  ) {
    return "invalid-not-before";
  }
  return null;
}

function validateEnvelope(input: {
  readonly tenant: TenantScopeLike;
  readonly requiredCapability: string;
  readonly reason: string;
}): CommandDraftReasonCode | null {
  const tenant = checkTenantScope(input.tenant);
  if (!tenant.ok) {
    // A single-scope envelope has no cross-tenant dimension — a missing or
    // malformed scope collapses to the empty-id code.
    switch (tenant.reasonCode) {
      case "TENANT_ID_TOO_LONG":
        return "TENANT_ID_TOO_LONG";
      case "TENANT_ID_INVALID_CHARS":
        return "TENANT_ID_INVALID_CHARS";
      default:
        return "TENANT_ID_EMPTY";
    }
  }
  if (typeof input.requiredCapability !== "string" || input.requiredCapability.length === 0) {
    return "CAPABILITY_REQUIRED";
  }
  if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
    return "INTENT_REASON_REQUIRED";
  }
  return null;
}

function build(
  input: {
    readonly tenant: TenantScopeLike;
    readonly idempotencyKey: string;
    readonly issuedAt: number;
    readonly notBefore?: number;
    readonly reason: string;
    readonly requiredCapability?: string;
  },
  kind: string,
  defaultCapability: string,
  payload: unknown,
): CommandDraftResult {
  const envelopeError = validateEnvelope({
    tenant: input.tenant,
    requiredCapability: input.requiredCapability ?? defaultCapability,
    reason: input.reason,
  });
  if (envelopeError !== null) return { ok: false, reasonCode: envelopeError, detail: "envelope" };

  const command: CommandSubmitContract = {
    kind,
    payload,
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.issuedAt,
    ...(input.notBefore === undefined ? {} : { notBefore: input.notBefore }),
  };
  const submitError = validateSubmitContract(command);
  if (submitError !== null) return { ok: false, reasonCode: submitError, detail: kind };

  const base = {
    recordType: "command-draft" as const,
    tenantId: input.tenant.tenantId,
    command,
    requiredCapability: input.requiredCapability ?? defaultCapability,
    reason: input.reason,
  };
  return { ok: true, draft: { ...base, draftDigest: computeDraftDigest(base) } };
}

// ---------------------------------------------------------------------------
// Intent builders — typed payloads, fixed command kinds
// ---------------------------------------------------------------------------

export const CREATE_WORK_ORDER_KIND = "work.create-work-order";
export const APPROVE_QUOTE_KIND = "procurement.approve-quote";
export const PLACE_ORDER_KIND = "procurement.place-order";
export const ALLOCATE_BUDGET_KIND = "org.allocate-budget";

export const CREATE_WORK_ORDER_CAPABILITY = "work.order.create";
export const APPROVE_QUOTE_CAPABILITY = "procurement.quote.approve";
export const PLACE_ORDER_CAPABILITY = "procurement.order.place";
export const ALLOCATE_BUDGET_CAPABILITY = "org.budget.allocate";

export function draftCreateWorkOrder(input: {
  readonly tenant: TenantScopeLike;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly title: string;
  readonly projectId?: string;
  readonly assigneeId?: string;
  readonly reason: string;
  readonly requiredCapability?: string;
  readonly notBefore?: number;
}): CommandDraftResult {
  if (typeof input.title !== "string" || input.title.trim().length === 0) {
    return { ok: false, reasonCode: "TITLE_REQUIRED", detail: "title" };
  }
  return build(
    input,
    CREATE_WORK_ORDER_KIND,
    CREATE_WORK_ORDER_CAPABILITY,
    {
      title: input.title,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    },
  );
}

export function draftApproveQuote(input: {
  readonly tenant: TenantScopeLike;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly quoteId: string;
  readonly demandId?: string;
  readonly reason: string;
  readonly requiredCapability?: string;
  readonly notBefore?: number;
}): CommandDraftResult {
  if (typeof input.quoteId !== "string" || input.quoteId.length === 0) {
    return { ok: false, reasonCode: "QUOTE_ID_REQUIRED", detail: "quoteId" };
  }
  return build(
    input,
    APPROVE_QUOTE_KIND,
    APPROVE_QUOTE_CAPABILITY,
    { quoteId: input.quoteId, ...(input.demandId === undefined ? {} : { demandId: input.demandId }) },
  );
}

export function draftPlaceOrder(input: {
  readonly tenant: TenantScopeLike;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly quoteId: string;
  readonly vendorId?: string;
  readonly totalCostMinor?: number;
  readonly reason: string;
  readonly requiredCapability?: string;
  readonly notBefore?: number;
}): CommandDraftResult {
  if (typeof input.quoteId !== "string" || input.quoteId.length === 0) {
    return { ok: false, reasonCode: "QUOTE_ID_REQUIRED", detail: "quoteId" };
  }
  if (input.totalCostMinor !== undefined) {
    if (!Number.isInteger(input.totalCostMinor)) {
      return { ok: false, reasonCode: "NON_INTEGER_AMOUNT", detail: "totalCostMinor" };
    }
    if (input.totalCostMinor < 0) {
      return { ok: false, reasonCode: "NEGATIVE_AMOUNT", detail: "totalCostMinor" };
    }
  }
  return build(
    input,
    PLACE_ORDER_KIND,
    PLACE_ORDER_CAPABILITY,
    {
      quoteId: input.quoteId,
      ...(input.vendorId === undefined ? {} : { vendorId: input.vendorId }),
      ...(input.totalCostMinor === undefined ? {} : { totalCostMinor: input.totalCostMinor }),
    },
  );
}

export function draftAllocateBudget(input: {
  readonly tenant: TenantScopeLike;
  readonly idempotencyKey: string;
  readonly issuedAt: number;
  readonly budgetId: string;
  readonly additionalUnits: number;
  readonly additionalSpendMinor: number;
  readonly reason: string;
  readonly requiredCapability?: string;
  readonly notBefore?: number;
}): CommandDraftResult {
  if (typeof input.budgetId !== "string" || input.budgetId.length === 0) {
    return { ok: false, reasonCode: "BUDGET_ID_REQUIRED", detail: "budgetId" };
  }
  if (!Number.isInteger(input.additionalUnits) || !Number.isInteger(input.additionalSpendMinor)) {
    return { ok: false, reasonCode: "NON_INTEGER_AMOUNT", detail: "additionalUnits|additionalSpendMinor" };
  }
  if (input.additionalUnits < 0 || input.additionalSpendMinor < 0) {
    return { ok: false, reasonCode: "NEGATIVE_AMOUNT", detail: "additionalUnits|additionalSpendMinor" };
  }
  return build(
    input,
    ALLOCATE_BUDGET_KIND,
    ALLOCATE_BUDGET_CAPABILITY,
    { budgetId: input.budgetId, additionalUnits: input.additionalUnits, additionalSpendMinor: input.additionalSpendMinor },
  );
}

// ---------------------------------------------------------------------------
// Full draft validation — the contract check the composition site can reuse
// ---------------------------------------------------------------------------

export function validateCommandDraft(draft: unknown): CommandDraftResult {
  if (!isCommandDraft(draft)) {
    return { ok: false, reasonCode: "NOT_A_DRAFT", detail: "recordType" };
  }
  const submitError = validateSubmitContract(draft.command);
  if (submitError !== null) return { ok: false, reasonCode: submitError, detail: "command" };
  const envelopeError = validateEnvelope({
    tenant: { tenantId: draft.tenantId },
    requiredCapability: draft.requiredCapability,
    reason: draft.reason,
  });
  if (envelopeError !== null) return { ok: false, reasonCode: envelopeError, detail: "envelope" };
  const expected = computeDraftDigest(draft);
  if (draft.draftDigest !== expected) {
    return { ok: false, reasonCode: "DIGEST_MISMATCH", detail: draft.draftDigest };
  }
  return { ok: true, draft };
}
