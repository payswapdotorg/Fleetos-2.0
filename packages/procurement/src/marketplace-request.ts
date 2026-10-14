/**
 * @fleetos/procurement — The marketplace equipment-request contract
 * (F361C, Wave 17 lane C; the F360 freeze §3.1).
 *
 * The frozen state machine:
 *   draft -> submitted -> resolving -> offer_window_closed -> comparing
 *     -> selected -> approval_requested -> [approved | refused]
 *     -> ordered -> [fulfilled | cancelled | disputed]
 *
 * Documented laws (machine-tested in tests/marketplace-request.test.ts):
 *   - TYPED TRANSITIONS: every command is a typed discriminator; the
 *     allowed-transition matrix below is the single source of legality.
 *     `refused`, `fulfilled`, `cancelled` and `disputed` are TERMINAL —
 *     every further command refuses ILLEGAL_TRANSITION.
 *   - REASON CODES: refusal (approval), cancellation and dispute each
 *     REQUIRE an operator reason (law A4 — never a silent consequential
 *     action); selection requires the offer id it selects.
 *   - IDEMPOTENT CREATE/SUBMIT: keyed tenant + natural key (the freeze
 *     §3.1). A replay of the SAME natural key with the SAME semantic
 *     content returns the ORIGINAL request (duplicate=true — the
 *     registry never creates twice, even when the replay names a
 *     different requestId); the same natural key with DIFFERENT content
 *     refuses NATURAL_KEY_CONFLICT (a typed conflict, never a silent
 *     overwrite).
 *   - TENANT FAIL-CLOSED reads: a request of another tenant is never
 *     returned (indistinguishable from absence).
 *   - AUDIT: every accepted transition emits a typed
 *     EquipmentRequestEvent (append-only; the caller accumulates).
 *
 * Pure deterministic TS. Time is an explicit `number` input (epoch ms).
 *
 * Laws: A1, A4, A8, A16 (a request is never a quote), A19, A20.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// The equipment request (freeze §3.1) — its own contract identity (A16).
// ---------------------------------------------------------------------------

export type EquipmentRequestStatus =
  | "draft"
  | "submitted"
  | "resolving"
  | "offer_window_closed"
  | "comparing"
  | "selected"
  | "approval_requested"
  | "approved"
  | "refused"
  | "ordered"
  | "fulfilled"
  | "cancelled"
  | "disputed";

export interface EquipmentRequest {
  readonly requestId: string;
  readonly tenant: TenantScope;
  /** Tenant-scoped natural key (e.g. site+category+budget ref) — the idempotency key. */
  readonly naturalKey: string;
  readonly sku: string;
  /** Integer quantity >= 1. */
  readonly quantity: number;
  readonly requiredBy: string;
  readonly status: EquipmentRequestStatus;
  /** The offer selected in the `selected` transition (and beyond). */
  readonly selectedOfferId: string | null;
  readonly createdAt: number;
  readonly submittedAt: number | null;
  readonly lastTransitionAt: number | null;
}

export type EquipmentRequestCommand =
  | { type: "submit"; at: number }
  | { type: "resolve"; at: number }
  | { type: "close_offer_window"; at: number }
  | { type: "compare"; at: number }
  | { type: "select"; at: number; offerId: string }
  | { type: "request_approval"; at: number }
  | { type: "approve"; at: number }
  | { type: "refuse"; at: number; reason: string }
  | { type: "order"; at: number }
  | { type: "fulfill"; at: number }
  | { type: "cancel"; at: number; reason: string }
  | { type: "dispute"; at: number; reason: string };

/** The allowed-transition matrix — the single source of legality. */
export const EQUIPMENT_REQUEST_ALLOWED: Readonly<
  Record<EquipmentRequestStatus, readonly EquipmentRequestCommand["type"][]>
> = {
  draft: ["submit"],
  submitted: ["resolve"],
  resolving: ["close_offer_window"],
  offer_window_closed: ["compare"],
  comparing: ["select"],
  selected: ["request_approval"],
  approval_requested: ["approve", "refuse"],
  approved: ["order"],
  ordered: ["fulfill", "cancel", "dispute"],
  refused: [],
  fulfilled: [],
  cancelled: [],
  disputed: [],
};

export type EquipmentRequestReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "REQUEST_ID_REQUIRED"
  | "NATURAL_KEY_REQUIRED"
  | "NATURAL_KEY_CONFLICT"
  | "SKU_REQUIRED"
  | "INVALID_QUANTITY"
  | "REQUIRED_BY_REQUIRED"
  | "INVALID_SUBMIT_TIME"
  | "REFUSE_REASON_REQUIRED"
  | "CANCEL_REASON_REQUIRED"
  | "DISPUTE_REASON_REQUIRED"
  | "SELECT_OFFER_ID_REQUIRED";

export type EquipmentRequestTransition =
  | { readonly ok: true; readonly next: EquipmentRequest; readonly event: EquipmentRequestEvent }
  | { readonly ok: false; readonly reasonCode: EquipmentRequestReasonCode };

/** Typed append-only event (law A19) — one per accepted transition. */
export interface EquipmentRequestEvent {
  readonly kind: "marketplace.request.transitioned";
  readonly requestId: string;
  readonly fromStatus: EquipmentRequestStatus;
  readonly toStatus: EquipmentRequestStatus;
  readonly at: number;
}

const REQUIRED_REASON_MIN_LENGTH = 1;

function nonEmptyReason(reason: string): boolean {
  return reason.trim().length >= REQUIRED_REASON_MIN_LENGTH;
}

/**
 * transitionEquipmentRequest — the pure §3.1 machine. Illegal transitions
 * refuse with ILLEGAL_TRANSITION (first-class, never coerced); the
 * consequential refusal/cancellation/dispute commands require reasons.
 */
export function transitionEquipmentRequest(
  current: EquipmentRequest,
  command: EquipmentRequestCommand,
): EquipmentRequestTransition {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const allowed = EQUIPMENT_REQUEST_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "submit":
      return accept(current, "submitted", command.at, { submittedAt: command.at });
    case "resolve":
      return accept(current, "resolving", command.at);
    case "close_offer_window":
      return accept(current, "offer_window_closed", command.at);
    case "compare":
      return accept(current, "comparing", command.at);
    case "select": {
      if (command.offerId.length === 0) {
        return { ok: false, reasonCode: "SELECT_OFFER_ID_REQUIRED" };
      }
      return accept(current, "selected", command.at, { selectedOfferId: command.offerId });
    }
    case "request_approval":
      return accept(current, "approval_requested", command.at);
    case "approve":
      return accept(current, "approved", command.at);
    case "refuse": {
      if (!nonEmptyReason(command.reason)) {
        return { ok: false, reasonCode: "REFUSE_REASON_REQUIRED" };
      }
      return accept(current, "refused", command.at);
    }
    case "order":
      return accept(current, "ordered", command.at);
    case "fulfill":
      return accept(current, "fulfilled", command.at);
    case "cancel": {
      if (!nonEmptyReason(command.reason)) {
        return { ok: false, reasonCode: "CANCEL_REASON_REQUIRED" };
      }
      return accept(current, "cancelled", command.at);
    }
    case "dispute": {
      if (!nonEmptyReason(command.reason)) {
        return { ok: false, reasonCode: "DISPUTE_REASON_REQUIRED" };
      }
      return accept(current, "disputed", command.at);
    }
  }
}

function accept(
  current: EquipmentRequest,
  toStatus: EquipmentRequestStatus,
  at: number,
  extra: Partial<EquipmentRequest> = {},
): EquipmentRequestTransition {
  const next: EquipmentRequest = {
    ...current,
    ...extra,
    status: toStatus,
    lastTransitionAt: at,
  };
  const event: EquipmentRequestEvent = {
    kind: "marketplace.request.transitioned",
    requestId: current.requestId,
    fromStatus: current.status,
    toStatus,
    at,
  };
  return { ok: true, next, event };
}

// ---------------------------------------------------------------------------
// Idempotent create/submit — keyed tenant + natural key (freeze §3.1).
// ---------------------------------------------------------------------------

export interface EquipmentRequestSubmitInput {
  readonly requestId: string;
  readonly naturalKey: string;
  readonly sku: string;
  readonly quantity: number;
  readonly requiredBy: string;
  readonly at: number;
}

export type EquipmentRequestSubmitResult =
  | {
      readonly ok: true;
      readonly request: EquipmentRequest;
      readonly duplicate: boolean;
      readonly event: EquipmentRequestEvent | null;
    }
  | { readonly ok: false; readonly reasonCode: EquipmentRequestReasonCode };

/**
 * submitEquipmentRequest — the idempotent create+submit operation over a
 * request population. The FIRST submission of a tenant+natural key
 * creates the request and submits it (draft -> submitted, one event).
 * A REPLAY with identical semantic content (sku, quantity, requiredBy)
 * returns the ORIGINAL request — whatever status it has reached since —
 * with duplicate=true and NO new event (the registry never creates
 * twice, even when the replay names a different requestId). The same
 * natural key with DIFFERENT content refuses NATURAL_KEY_CONFLICT.
 */
export function submitEquipmentRequest(
  tenant: TenantScope,
  input: EquipmentRequestSubmitInput,
  existing: readonly EquipmentRequest[],
): EquipmentRequestSubmitResult {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (input.requestId.length === 0) return { ok: false, reasonCode: "REQUEST_ID_REQUIRED" };
  if (input.naturalKey.length === 0) return { ok: false, reasonCode: "NATURAL_KEY_REQUIRED" };
  if (input.sku.length === 0) return { ok: false, reasonCode: "SKU_REQUIRED" };
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, reasonCode: "INVALID_QUANTITY" };
  }
  if (input.requiredBy.length === 0) return { ok: false, reasonCode: "REQUIRED_BY_REQUIRED" };
  if (!Number.isInteger(input.at) || input.at < 0) {
    return { ok: false, reasonCode: "INVALID_SUBMIT_TIME" };
  }
  const original = existing.find(
    (r) =>
      r.tenant.tenantId === tenantCheck.scope.tenantId && r.naturalKey === input.naturalKey,
  );
  if (original !== undefined) {
    const sameContent =
      original.sku === input.sku &&
      original.quantity === input.quantity &&
      original.requiredBy === input.requiredBy;
    if (!sameContent) return { ok: false, reasonCode: "NATURAL_KEY_CONFLICT" };
    return { ok: true, request: original, duplicate: true, event: null };
  }
  const draft: EquipmentRequest = {
    requestId: input.requestId,
    tenant: tenantCheck.scope,
    naturalKey: input.naturalKey,
    sku: input.sku,
    quantity: input.quantity,
    requiredBy: input.requiredBy,
    status: "draft",
    selectedOfferId: null,
    createdAt: input.at,
    submittedAt: null,
    lastTransitionAt: null,
  };
  const submitted = transitionEquipmentRequest(draft, { type: "submit", at: input.at });
  if (!submitted.ok) return { ok: false, reasonCode: submitted.reasonCode };
  return { ok: true, request: submitted.next, duplicate: false, event: submitted.event };
}

// ---------------------------------------------------------------------------
// Tenant fail-closed read + deterministic board.
// ---------------------------------------------------------------------------

/** findEquipmentRequest — fail-closed: another tenant's request is never returned. */
export function findEquipmentRequest(
  tenant: TenantScope,
  requests: readonly EquipmentRequest[],
  requestId: string,
): EquipmentRequest | null {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return null;
  const found = requests.find(
    (r) => r.requestId === requestId && r.tenant.tenantId === tenantCheck.scope.tenantId,
  );
  return found ?? null;
}

export interface EquipmentRequestBoard {
  readonly total: number;
  readonly byStatus: Readonly<Record<EquipmentRequestStatus, number>>;
  /** Deterministic order: requestId lexical. */
  readonly requestIds: readonly string[];
}

/** buildEquipmentRequestBoard — deterministic per-tenant summary (own tenant only). */
export function buildEquipmentRequestBoard(
  tenant: TenantScope,
  requests: readonly EquipmentRequest[],
): EquipmentRequestBoard {
  const tenantCheck = validateTenantScope(tenant);
  const byStatus: Record<EquipmentRequestStatus, number> = {
    draft: 0,
    submitted: 0,
    resolving: 0,
    offer_window_closed: 0,
    comparing: 0,
    selected: 0,
    approval_requested: 0,
    approved: 0,
    refused: 0,
    ordered: 0,
    fulfilled: 0,
    cancelled: 0,
    disputed: 0,
  };
  if (!tenantCheck.ok) return { total: 0, byStatus, requestIds: [] };
  const scoped = requests.filter((r) => r.tenant.tenantId === tenantCheck.scope.tenantId);
  for (const r of scoped) byStatus[r.status] += 1;
  const requestIds = scoped.map((r) => r.requestId).sort((a, b) => a.localeCompare(b));
  return { total: scoped.length, byStatus, requestIds };
}
